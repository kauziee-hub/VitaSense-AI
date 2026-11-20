package expo.modules.vitasensedevice

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build
import android.os.Process
import java.util.Calendar

/**
 * Screen time from the phone's own usage log (Settings > Usage access).
 *
 * Screen-on intervals come from SCREEN_INTERACTIVE / SCREEN_NON_INTERACTIVE events, so the
 * numbers match what the user sees in Digital Wellbeing. Per day we report total screen
 * minutes, minutes between 00:00 and 05:00, the longest unbroken session, unlocks, first and
 * last use, and — for the night that ended that morning — the longest screen-off stretch
 * between 20:00 and 12:00, which is a reasonable sleep window when no wearable is worn.
 * Only these daily numbers leave the phone; app names never do.
 */
object UsageReader {
  private const val MINUTE = 60_000L
  private const val HOUR = 60 * MINUTE
  private const val DAY = 24 * HOUR

  fun hasAccess(context: Context): Boolean {
    val ops = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
    } else {
      @Suppress("DEPRECATION")
      ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
    }
    return mode == AppOpsManager.MODE_ALLOWED
  }

  private fun midnight(time: Long): Long = Calendar.getInstance().run {
    timeInMillis = time
    set(Calendar.HOUR_OF_DAY, 0)
    set(Calendar.MINUTE, 0)
    set(Calendar.SECOND, 0)
    set(Calendar.MILLISECOND, 0)
    timeInMillis
  }

  private fun dateKey(time: Long): String = Calendar.getInstance().run {
    timeInMillis = time
    "%04d-%02d-%02d".format(get(Calendar.YEAR), get(Calendar.MONTH) + 1, get(Calendar.DAY_OF_MONTH))
  }

  private fun clock(time: Long): String = Calendar.getInstance().run {
    timeInMillis = time
    "%02d:%02d".format(get(Calendar.HOUR_OF_DAY), get(Calendar.MINUTE))
  }

  private fun overlap(a0: Long, a1: Long, b0: Long, b1: Long): Long = maxOf(0L, minOf(a1, b1) - maxOf(a0, b0))

  fun readDays(context: Context, days: Int): List<Map<String, Any?>> {
    if (!hasAccess(context) || Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return emptyList()
    val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val now = System.currentTimeMillis()
    val firstDay = midnight(now) - (days - 1).coerceAtLeast(0) * DAY
    // Start the evening before the first day so its sleep window can be found.
    val start = firstDay - 4 * HOUR

    val sessions = mutableListOf<Pair<Long, Long>>()
    val unlocks = mutableListOf<Long>()
    var openedAt: Long? = null
    val events = manager.queryEvents(start, now)
    val event = UsageEvents.Event()
    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      when (event.eventType) {
        UsageEvents.Event.SCREEN_INTERACTIVE -> if (openedAt == null) openedAt = event.timeStamp
        UsageEvents.Event.SCREEN_NON_INTERACTIVE -> openedAt?.let {
          if (event.timeStamp > it) sessions.add(it to event.timeStamp)
          openedAt = null
        }
        UsageEvents.Event.KEYGUARD_HIDDEN -> unlocks.add(event.timeStamp)
      }
    }
    openedAt?.let { sessions.add(it to now) }

    val out = mutableListOf<Map<String, Any?>>()
    var day = firstDay
    while (day <= now) {
      val dayEnd = day + DAY
      var screen = 0L
      var late = 0L
      var longest = 0L
      var first: Long? = null
      var last: Long? = null
      for ((s, e) in sessions) {
        val inDay = overlap(s, e, day, dayEnd)
        if (inDay <= 0) continue
        screen += inDay
        late += overlap(s, e, day, day + 5 * HOUR)
        longest = maxOf(longest, inDay)
        val clippedStart = maxOf(s, day)
        if (first == null || clippedStart < first!!) first = clippedStart
        val clippedEnd = minOf(e, dayEnd)
        if (last == null || clippedEnd > last!!) last = clippedEnd
      }

      // Longest screen-off gap in the night ending this morning (previous 20:00 .. 12:00).
      val windowStart = day - 4 * HOUR
      val windowEnd = minOf(day + 12 * HOUR, now)
      var cursor = windowStart
      var bestStart = 0L
      var bestEnd = 0L
      for ((s, e) in sessions.sortedBy { it.first }) {
        if (e <= windowStart || s >= windowEnd) continue
        val gapEnd = maxOf(windowStart, s)
        if (gapEnd - cursor > bestEnd - bestStart) {
          bestStart = cursor
          bestEnd = gapEnd
        }
        cursor = maxOf(cursor, minOf(e, windowEnd))
      }
      if (windowEnd - cursor > bestEnd - bestStart && windowEnd < now) {
        bestStart = cursor
        bestEnd = windowEnd
      }
      val quietMinutes = (bestEnd - bestStart) / MINUTE

      out.add(
        mapOf(
          "date" to dateKey(day),
          "screen_minutes" to (screen / MINUTE).toDouble(),
          "late_night_minutes" to (late / MINUTE).toDouble(),
          "longest_session_minutes" to (longest / MINUTE).toDouble(),
          "unlocks" to unlocks.count { it in day until dayEnd },
          "first_use" to first?.let { clock(it) },
          "last_use" to last?.let { clock(it) },
          // Only a plausible night counts as a sleep estimate (3–14 h with the screen off).
          "quiet_start" to if (quietMinutes in 180..840) clock(bestStart) else null,
          "quiet_end" to if (quietMinutes in 180..840) clock(bestEnd) else null,
          "quiet_minutes" to if (quietMinutes in 180..840) quietMinutes.toDouble() else null,
        ),
      )
      day = dayEnd
    }
    return out
  }
}
