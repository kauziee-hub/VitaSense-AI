package expo.modules.vitasensedevice

import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Phone-side collectors that no Expo library covers:
 *  - phone usage (screen time, night use, unlocks, overnight quiet window) — Usage access;
 *  - order alerts from food, grocery and pharmacy apps — Notification access;
 *  - live heart rate from a Bluetooth band / watch / chest strap.
 * Every one is off until the user switches it on in Android settings or taps connect.
 */
class VitasenseDeviceModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private var band: HeartRateBand? = null

  private fun band(): HeartRateBand =
    band ?: HeartRateBand(context) { event, body -> sendEvent(event, body) }.also { band = it }

  private fun openSettings(action: String) {
    val intent = Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
  }

  override fun definition() = ModuleDefinition {
    Name("VitasenseDevice")

    Events("onBandDevice", "onHeartRate", "onBandState")

    // ---- phone usage ----
    Function("hasUsageAccess") { UsageReader.hasAccess(context) }
    Function("openUsageAccessSettings") { openSettings(Settings.ACTION_USAGE_ACCESS_SETTINGS) }
    AsyncFunction("readUsageDays") { days: Int -> UsageReader.readDays(context, days.coerceIn(1, 30)) }

    // ---- order alerts ----
    Function("hasNotificationAccess") { OrderAlertStore.hasAccess(context) }
    Function("openNotificationAccessSettings") { openSettings(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS) }
    Function("watchedApps") { OrderAlertStore.WATCHED.toList() }
    AsyncFunction("readOrderAlerts") { sinceMs: Double -> OrderAlertStore.read(context, sinceMs.toLong()) }
    Function("clearOrderAlerts") { untilMs: Double -> OrderAlertStore.clear(context, untilMs.toLong()) }

    // ---- Bluetooth heart rate ----
    Function("bluetoothState") { band().state() }
    Function("openBluetoothSettings") { openSettings(Settings.ACTION_BLUETOOTH_SETTINGS) }
    Function("startBandScan") { seconds: Int -> band().startScan(seconds) }
    Function("stopBandScan") { band?.stopScan() }
    Function("connectBand") { address: String -> band().connect(address) }
    Function("disconnectBand") { band?.disconnect() }

    OnDestroy {
      band?.stopScan()
      band?.disconnect()
    }
  }
}
