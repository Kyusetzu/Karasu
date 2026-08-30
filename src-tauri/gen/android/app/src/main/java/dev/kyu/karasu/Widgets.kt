package dev.kyu.karasu

// Hand-written, like TokenCipher.kt and NotifJob.kt: `tauri android init`
// will not overwrite this file, but a wiped gen/ tree will not recreate it —
// restore from git after any re-init. Pure platform APIs (AppWidgetProvider,
// RemoteViews, org.json); no Glance, no Compose, no new Gradle dependency —
// the net.rs/TokenCipher precedent. WidgetRefresher's proguard keep is
// load-bearing: it is reached from Rust over JNI by name with no native
// methods and no manifest entry.
//
// All data comes from <filesDir>/widgets.json, written by Rust
// (`widgets.rs`) — pre-filtered, pre-titled, pre-localized. Kotlin's only
// arithmetic is bucketing raw airingAtMs into "today"/weekday at *render*
// time, which is what keeps a days-stale file honestly dated.

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** Rust pokes this after every projection write while the app runs; the
 *  NotifJobService and MainActivity.onPause poke it too. It only broadcasts
 *  the standard update to whichever widget types are actually placed. */
object WidgetRefresher {
  private val TYPES = listOf(
    Widgets.AiringToday::class.java,
    Widgets.ContinueWatching::class.java,
    Widgets.ContinueReading::class.java,
    Widgets.Week::class.java,
  )

  @JvmStatic
  fun refresh(context: Context) {
    try {
      val mgr = AppWidgetManager.getInstance(context)
      for (cls in TYPES) {
        val ids = mgr.getAppWidgetIds(ComponentName(context, cls))
        if (ids.isEmpty()) continue
        val intent = Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
          .setClass(context, cls)
          .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
        context.sendBroadcast(intent)
      }
    } catch (t: Throwable) {
      Log.w("KarasuWidgets", "refresh failed", t)
    }
  }
}

/** Shared machinery: read the projection, fill the shared layout, hand the
 *  per-type rendering to a subclass. */
abstract class KarasuWidgetBase : AppWidgetProvider() {
  companion object {
    const val MAX_ROWS = 8
    /** Past this age the footer says "open Karasu" — the file is a cache. */
    const val STALE_MS = 48L * 60 * 60 * 1000

    val ROW_IDS = intArrayOf(
      R.id.w_row1, R.id.w_row2, R.id.w_row3, R.id.w_row4,
      R.id.w_row5, R.id.w_row6, R.id.w_row7, R.id.w_row8,
    )

    fun doc(context: Context): JSONObject? = try {
      // dataDir, NOT filesDir: tauri's app_data_dir resolves to
      // Context.getDataDir() (the package root — see the PathPlugin's
      // getDataDir), and that is where widgets.rs writes beside karasu.db.
      // filesDir is one level below and was the four-empty-widgets bug.
      JSONObject(File(context.dataDir, "widgets.json").readText())
    } catch (t: Throwable) {
      null
    }
  }

  /** The title's label key and the rows for this widget type. */
  abstract fun titleKey(): String
  abstract fun rows(doc: JSONObject, now: Long): List<String>

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val doc = doc(context)
    val labels = doc?.optJSONObject("labels")
    val now = System.currentTimeMillis()

    for (id in ids) {
      val views = RemoteViews(context.packageName, R.layout.karasu_widget)
      views.setTextViewText(R.id.w_title, labels?.optString(titleKey()) ?: "Karasu")

      val rows = if (doc != null) rows(doc, now) else emptyList()
      for ((i, rowId) in ROW_IDS.withIndex()) {
        if (i < rows.size) {
          views.setTextViewText(rowId, rows[i])
          views.setViewVisibility(rowId, android.view.View.VISIBLE)
        } else {
          views.setViewVisibility(rowId, android.view.View.GONE)
        }
      }

      val generated = doc?.optLong("generatedAtMs") ?: 0L
      val footer = when {
        doc == null || now - generated > STALE_MS -> labels?.optString("stale") ?: "Open Karasu"
        rows.isEmpty() -> labels?.optString("empty") ?: ""
        else -> null
      }
      if (footer.isNullOrEmpty()) {
        views.setViewVisibility(R.id.w_footer, android.view.View.GONE)
      } else {
        views.setTextViewText(R.id.w_footer, footer)
        views.setViewVisibility(R.id.w_footer, android.view.View.VISIBLE)
      }

      // The whole widget opens the app; per-row targets would need a
      // collection service, which fixed rows exist to avoid.
      views.setOnClickPendingIntent(
        R.id.w_title,
        PendingIntent.getActivity(
          context,
          0,
          Intent(context, MainActivity::class.java),
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        ),
      )
      manager.updateAppWidget(id, views)
    }
  }

  protected fun airing(doc: JSONObject): JSONArray = doc.optJSONArray("airing") ?: JSONArray()

  protected fun progressRows(doc: JSONObject, key: String): List<String> {
    val arr = doc.optJSONArray(key) ?: return emptyList()
    return (0 until minOf(arr.length(), MAX_ROWS)).map { i ->
      val row = arr.getJSONObject(i)
      val total = if (row.isNull("total")) "?" else row.optLong("total").toString()
      "${row.optString("title")} · ${row.optLong("progress")}/$total"
    }
  }

  /** Monday-first index for the projection's `days` array. */
  protected fun dayIndex(ms: Long): Int {
    val cal = Calendar.getInstance().apply { timeInMillis = ms }
    return (cal.get(Calendar.DAY_OF_WEEK) + 5) % 7
  }

  protected fun sameDay(a: Long, b: Long): Boolean {
    val ca = Calendar.getInstance().apply { timeInMillis = a }
    val cb = Calendar.getInstance().apply { timeInMillis = b }
    return ca.get(Calendar.YEAR) == cb.get(Calendar.YEAR) &&
      ca.get(Calendar.DAY_OF_YEAR) == cb.get(Calendar.DAY_OF_YEAR)
  }

  protected fun clock(ms: Long): String =
    SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ms))
}

/** The four launcher-facing types, as nested classes so the manifest refs
 *  stay one file: `.Widgets$AiringToday` and friends. */
class Widgets {
  class AiringToday : KarasuWidgetBase() {
    override fun titleKey() = "airingToday"
    override fun rows(doc: JSONObject, now: Long): List<String> {
      val arr = airing(doc)
      val ep = doc.optJSONObject("labels")?.optString("episode") ?: "Ep"
      return (0 until arr.length())
        .map { arr.getJSONObject(it) }
        .filter { sameDay(it.optLong("airingAtMs"), now) }
        .take(MAX_ROWS)
        .map { "${clock(it.optLong("airingAtMs"))} · ${it.optString("title")} · $ep ${it.optLong("episode")}" }
    }
  }

  class ContinueWatching : KarasuWidgetBase() {
    override fun titleKey() = "continueWatching"
    override fun rows(doc: JSONObject, now: Long) = progressRows(doc, "continueWatching")
  }

  class ContinueReading : KarasuWidgetBase() {
    override fun titleKey() = "continueReading"
    override fun rows(doc: JSONObject, now: Long) = progressRows(doc, "continueReading")
  }

  class Week : KarasuWidgetBase() {
    override fun titleKey() = "week"
    override fun rows(doc: JSONObject, now: Long): List<String> {
      val arr = airing(doc)
      val days = doc.optJSONArray("days")
      val ep = doc.optJSONObject("labels")?.optString("episode") ?: "Ep"
      return (0 until arr.length())
        .map { arr.getJSONObject(it) }
        .filter { it.optLong("airingAtMs") >= now - 60L * 60 * 1000 }
        .take(MAX_ROWS)
        .map {
          val at = it.optLong("airingAtMs")
          val day = days?.optString(dayIndex(at)) ?: ""
          "$day ${clock(at)} · ${it.optString("title")} · $ep ${it.optLong("episode")}"
        }
    }
  }
}
