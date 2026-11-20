package expo.modules.vitasensedevice

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.content.pm.ApplicationInfo
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject

/**
 * Keeps order and delivery alerts from food, grocery and pharmacy apps (and nothing else) so
 * VitaSense knows what was eaten or bought without anyone typing it. Alerts stay on the phone
 * in a small queue until the app uploads them for reading, then they are cleared.
 */
class OrderAlertListener : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    sbn ?: return
    val pkg = sbn.packageName ?: return
    if (!OrderAlertStore.isWatched(applicationContext, pkg)) return
    val extras = sbn.notification?.extras ?: return
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
    val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString().orEmpty()
    if (title.isBlank() && text.isBlank()) return
    // Group summaries repeat their children; skip them.
    if ((sbn.notification.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return
    OrderAlertStore.add(applicationContext, pkg, title.take(300), text.take(1500), sbn.postTime)
  }
}

object OrderAlertStore {
  private const val PREFS = "vitasense_order_alerts"
  private const val KEY = "alerts"
  private const val MAX_ALERTS = 300
  private const val KEEP_MS = 30L * 24 * 60 * 60 * 1000

  /** Food, grocery, pharmacy and clinic apps common in India. Everything else is ignored. */
  val WATCHED = setOf(
    "in.swiggy.android",
    "com.application.zomato",
    "com.grofers.customerapp",
    "com.zeptoconsumerapp",
    "com.bigbasket.mobileapp",
    "com.jpl.jiomart",
    "com.done.faasos",
    "com.dominos",
    "com.aranoah.healthkart.plus",
    "com.phonegap.rxpal",
    "com.netmedsmarketplace.netmeds",
    "com.apollo.patientapp",
    "com.practo.fabric",
  )

  fun isWatched(context: Context, pkg: String): Boolean {
    if (pkg.lowercase() in WATCHED) return true
    // Debug builds also accept alerts posted from `adb shell cmd notification post`, for testing.
    val debuggable = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    return debuggable && pkg == "com.android.shell"
  }

  fun hasAccess(context: Context): Boolean {
    val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: return false
    val me = ComponentName(context, OrderAlertListener::class.java).flattenToString()
    return enabled.split(":").any { it == me || it.startsWith(context.packageName + "/") }
  }

  @Synchronized
  fun add(context: Context, pkg: String, title: String, text: String, postedAt: Long) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val list = JSONArray(prefs.getString(KEY, "[]"))
    val id = "${pkg}:${(title + text).hashCode()}:${postedAt / 60_000}"
    for (i in 0 until list.length()) {
      if (list.getJSONObject(i).optString("id") == id) return // same alert re-posted
    }
    val cutoff = System.currentTimeMillis() - KEEP_MS
    val kept = JSONArray()
    for (i in 0 until list.length()) {
      val item = list.getJSONObject(i)
      if (item.optLong("posted_at") >= cutoff) kept.put(item)
    }
    kept.put(JSONObject().put("id", id).put("package", pkg).put("title", title).put("text", text).put("posted_at", postedAt))
    while (kept.length() > MAX_ALERTS) kept.remove(0)
    prefs.edit().putString(KEY, kept.toString()).apply()
  }

  @Synchronized
  fun read(context: Context, sinceMs: Long): List<Map<String, Any?>> {
    val list = JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]"))
    val out = mutableListOf<Map<String, Any?>>()
    for (i in 0 until list.length()) {
      val item = list.getJSONObject(i)
      if (item.optLong("posted_at") <= sinceMs) continue
      out.add(
        mapOf(
          "id" to item.optString("id"),
          "package" to item.optString("package"),
          "title" to item.optString("title"),
          "text" to item.optString("text"),
          "postedAt" to item.optLong("posted_at").toDouble(),
        ),
      )
    }
    return out
  }

  @Synchronized
  fun clear(context: Context, untilMs: Long) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val list = JSONArray(prefs.getString(KEY, "[]"))
    val kept = JSONArray()
    for (i in 0 until list.length()) {
      val item = list.getJSONObject(i)
      if (item.optLong("posted_at") > untilMs) kept.put(item)
    }
    prefs.edit().putString(KEY, kept.toString()).apply()
  }
}
