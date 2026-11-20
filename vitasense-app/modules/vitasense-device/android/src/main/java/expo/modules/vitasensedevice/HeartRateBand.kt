package expo.modules.vitasensedevice

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import java.util.UUID

/**
 * Live heart rate from any band, watch or chest strap that speaks the standard Bluetooth
 * Heart Rate profile (service 0x180D). Many bands only broadcast it after you turn on
 * "heart rate sharing" / "broadcast heart rate" in their own app. Battery (0x180F) is read
 * when the device offers it.
 */
@SuppressLint("MissingPermission") // runtime permissions are requested from JS before any call
class HeartRateBand(
  private val context: Context,
  private val emit: (event: String, body: Map<String, Any?>) -> Unit,
) {
  companion object {
    val HEART_RATE_SERVICE: UUID = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb")
    val HEART_RATE_MEASUREMENT: UUID = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb")
    val BATTERY_SERVICE: UUID = UUID.fromString("0000180f-0000-1000-8000-00805f9b34fb")
    val BATTERY_LEVEL: UUID = UUID.fromString("00002a19-0000-1000-8000-00805f9b34fb")
    val CLIENT_CONFIG: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    /** Heart Rate Measurement: flags bit0 = 16-bit value, bits1-2 = sensor contact support/status. */
    fun parseHeartRate(value: ByteArray): Pair<Int, Boolean?>? {
      if (value.isEmpty()) return null
      val flags = value[0].toInt() and 0xFF
      val sixteenBit = flags and 0x01 != 0
      val bpm = if (sixteenBit) {
        if (value.size < 3) return null
        (value[1].toInt() and 0xFF) or ((value[2].toInt() and 0xFF) shl 8)
      } else {
        if (value.size < 2) return null
        value[1].toInt() and 0xFF
      }
      val contactSupported = flags and 0x04 != 0
      val contact = if (contactSupported) flags and 0x02 != 0 else null
      return bpm to contact
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  private val adapter: BluetoothAdapter? = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
  private var gatt: BluetoothGatt? = null
  private var scanning = false
  private val seen = mutableSetOf<String>()

  fun state(): String = when {
    adapter == null -> "unsupported"
    !adapter.isEnabled -> "off"
    else -> "on"
  }

  private val scanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      val device = result.device ?: return
      if (!seen.add(device.address)) return
      emit(
        "onBandDevice",
        mapOf("id" to device.address, "name" to (result.scanRecord?.deviceName ?: device.name ?: "Heart-rate device"), "rssi" to result.rssi),
      )
    }

    override fun onScanFailed(errorCode: Int) {
      scanning = false
      emit("onBandState", mapOf("state" to "scan_failed", "code" to errorCode))
    }
  }

  fun startScan(seconds: Int) {
    val scanner = adapter?.bluetoothLeScanner ?: throw IllegalStateException("Bluetooth is off or not available")
    stopScan()
    seen.clear()
    val filters = listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(HEART_RATE_SERVICE)).build())
    val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
    scanner.startScan(filters, settings, scanCallback)
    scanning = true
    emit("onBandState", mapOf("state" to "scanning"))
    handler.postDelayed({ if (scanning) { stopScan(); emit("onBandState", mapOf("state" to "scan_done")) } }, seconds.coerceIn(3, 60) * 1000L)
  }

  fun stopScan() {
    if (!scanning) return
    scanning = false
    try {
      adapter?.bluetoothLeScanner?.stopScan(scanCallback)
    } catch (_: Exception) {
    }
  }

  fun connect(address: String) {
    val device: BluetoothDevice = adapter?.getRemoteDevice(address) ?: throw IllegalStateException("Bluetooth is off or not available")
    stopScan()
    disconnect()
    emit("onBandState", mapOf("state" to "connecting", "id" to address))
    gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
    } else {
      device.connectGatt(context, false, gattCallback)
    }
  }

  fun disconnect() {
    gatt?.let {
      try {
        it.disconnect()
        it.close()
      } catch (_: Exception) {
      }
    }
    gatt = null
  }

  private fun enableNotifications(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
    g.setCharacteristicNotification(characteristic, true)
    val descriptor = characteristic.getDescriptor(CLIENT_CONFIG) ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      g.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
    } else {
      @Suppress("DEPRECATION")
      descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
      @Suppress("DEPRECATION")
      g.writeDescriptor(descriptor)
    }
  }

  private val gattCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
      when (newState) {
        BluetoothProfile.STATE_CONNECTED -> {
          emit("onBandState", mapOf("state" to "connected", "id" to g.device.address, "name" to (g.device.name ?: "Band")))
          g.discoverServices()
        }
        BluetoothProfile.STATE_DISCONNECTED -> emit("onBandState", mapOf("state" to "disconnected", "id" to g.device.address))
      }
    }

    override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
      val hr = g.getService(HEART_RATE_SERVICE)?.getCharacteristic(HEART_RATE_MEASUREMENT)
      if (hr == null) {
        emit("onBandState", mapOf("state" to "no_heart_rate", "id" to g.device.address))
        return
      }
      enableNotifications(g, hr)
    }

    override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      // Read battery after notifications are on: one GATT operation at a time.
      g.getService(BATTERY_SERVICE)?.getCharacteristic(BATTERY_LEVEL)?.let { g.readCharacteristic(it) }
      emit("onBandState", mapOf("state" to "streaming", "id" to g.device.address))
    }

    private fun handle(characteristic: BluetoothGattCharacteristic, value: ByteArray) {
      when (characteristic.uuid) {
        HEART_RATE_MEASUREMENT -> parseHeartRate(value)?.let { (bpm, contact) ->
          emit("onHeartRate", mapOf("bpm" to bpm, "contact" to contact, "at" to System.currentTimeMillis().toDouble()))
        }
        BATTERY_LEVEL -> if (value.isNotEmpty()) emit("onBandState", mapOf("state" to "battery", "battery" to (value[0].toInt() and 0xFF)))
      }
    }

    override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) = handle(characteristic, value)

    @Deprecated("Android 12 and older")
    override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
      @Suppress("DEPRECATION")
      handle(characteristic, characteristic.value ?: return)
    }

    override fun onCharacteristicRead(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray, status: Int) =
      handle(characteristic, value)

    @Deprecated("Android 12 and older")
    override fun onCharacteristicRead(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
      @Suppress("DEPRECATION")
      handle(characteristic, characteristic.value ?: return)
    }
  }
}
