package dev.kyu.karasu

// Hand-written, like TokenCipher.kt: `tauri android init` will not overwrite
// this file, but a wiped gen/ tree will not recreate it either — restore it
// from git after any re-init. Pure platform APIs only (JobScheduler,
// NotificationManager, org.json) — a Gradle dependency inside this generated
// tree is exactly what net.rs refused for TLS and TokenCipher refused for
// crypto. The proguard keeps in proguard-rules.pro are load-bearing:
// NotifScheduler is reached over JNI by name with no native methods and no
// manifest entry, so neither default rule protects it.

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

/**
 * The one exported Rust symbol the job calls. Everything substantive —
 * reading the interval, unsealing the token, the request, the cursor —
 * happens in Rust (`background.rs`); what comes back is a rendered
 * `{"title","body"}` or an empty string for "post nothing". The token never
 * enters Kotlin.
 */
object KarasuNative {
  init {
    System.loadLibrary("karasu_lib")
  }

  @JvmStatic
  external fun backgroundNotifCheck(context: Context): String
}

/** Registers/cancels the periodic job — called from Rust over JNI whenever
 *  the setting changes, and re-asserted at every app start. */
object NotifScheduler {
  private const val JOB_ID = 46231 // the callback port's digits, reused as an id

  @JvmStatic
  fun schedule(context: Context, minutes: Int) {
    try {
      val js = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
      val job = JobInfo.Builder(JOB_ID, ComponentName(context, NotifJobService::class.java))
        // Android floors periodic jobs at 15 minutes and clamps silently;
        // the Rust side already refuses smaller values, so the two agree.
        .setPeriodic(minutes.toLong() * 60_000L)
        // Survives a reboot. RECEIVE_BOOT_COMPLETED is declared in the
        // manifest (setPersisted throws without it).
        .setPersisted(true)
        .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
        .build()
      js.schedule(job)
    } catch (t: Throwable) {
      Log.w("KarasuNotifJob", "schedule failed", t)
    }
  }

  @JvmStatic
  fun cancel(context: Context) {
    try {
      val js = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
      js.cancel(JOB_ID)
    } catch (t: Throwable) {
      Log.w("KarasuNotifJob", "cancel failed", t)
    }
  }
}

/**
 * Runs the check with the app possibly dead. `onStartJob` is on the main
 * thread, so the work moves to its own thread and `jobFinished` reports
 * back; a reschedule is never requested — the period itself is the retry.
 */
class NotifJobService : JobService() {
  private val channelId = "karasu.site"

  override fun onStartJob(params: JobParameters?): Boolean {
    Thread {
      try {
        val json = KarasuNative.backgroundNotifCheck(applicationContext)
        if (json.isNotEmpty()) post(json)
      } catch (t: Throwable) {
        Log.w("KarasuNotifJob", "check failed", t)
      }
      jobFinished(params, false)
    }.start()
    return true
  }

  override fun onStopJob(params: JobParameters?): Boolean = true

  private fun post(json: String) {
    if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) return
    val body = JSONObject(json)

    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    // Idempotent: creating an existing channel is a no-op.
    nm.createNotificationChannel(
      NotificationChannel(channelId, "AniList", NotificationManager.IMPORTANCE_DEFAULT)
    )

    val open = PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val notification = NotificationCompat.Builder(this, channelId)
      // The launcher mark — the same fallback the notification plugin uses;
      // there is no dedicated status-bar glyph in the res tree.
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(body.optString("title"))
      .setContentText(body.optString("body"))
      .setContentIntent(open)
      .setAutoCancel(true)
      .build()
    try {
      nm.notify(JOB_NOTIF_ID, notification)
    } catch (t: Throwable) {
      Log.w("KarasuNotifJob", "notify failed", t)
    }
  }

  private companion object {
    const val JOB_NOTIF_ID = 46232
  }
}
