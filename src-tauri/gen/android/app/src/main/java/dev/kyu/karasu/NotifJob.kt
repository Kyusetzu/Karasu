package dev.kyu.karasu

// Hand-written; `tauri android init` will not recreate it, restore from git; platform APIs only, no Gradle dependency.

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

/** The exported Rust symbols; the check itself runs in background.rs, so the token never enters Kotlin. */
object KarasuNative {
  init {
    System.loadLibrary("karasu_lib")
  }

  @JvmStatic
  external fun backgroundNotifCheck(context: Context): String

  /** Set by MainActivity; Rust reads it for the poll cadence and the one moment a foreground service may start. */
  @JvmStatic
  external fun setForeground(foreground: Boolean)
}

/** Registers or cancels the job from Rust over JNI by name, so its proguard keep is load-bearing. */
object NotifScheduler {
  private const val JOB_ID = 46231 // the callback port's digits, reused as an id

  /** Empty when the job is registered, otherwise the refusal in the platform's own words, which the Settings pane shows. */
  @JvmStatic
  fun schedule(context: Context, minutes: Int): String {
    return try {
      val js = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
      val job = JobInfo.Builder(JOB_ID, ComponentName(context, NotifJobService::class.java))
        // Android floors the period and clamps silently; the Rust side refuses smaller values, so the two agree.
        .setPeriodic(minutes.toLong() * 60_000L)
        // Survives a reboot; setPersisted throws without RECEIVE_BOOT_COMPLETED in the manifest.
        .setPersisted(true)
        // A connectivity constraint needs ACCESS_NETWORK_STATE in the manifest, or schedule() throws.
        .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
        .build()
      if (js.schedule(job) == JobScheduler.RESULT_SUCCESS) "" else "JobScheduler answered RESULT_FAILURE"
    } catch (t: Throwable) {
      Log.w("KarasuNotifJob", "schedule failed", t)
      t.toString()
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

/** Runs the check with the app possibly dead; only an interrupted run reschedules, since the period itself is the retry. */
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
      // A bonus widget tick: their date bucketing shifts at midnight even when the data file has not moved.
      WidgetRefresher.refresh(applicationContext)
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
      // The launcher mark, as the notification plugin falls back to; the res tree has no status-bar glyph.
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
