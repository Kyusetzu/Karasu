package dev.kyu.karasu

// Hand-written, like NotifJob.kt: `tauri android init` will not overwrite
// this file, but a wiped gen/ tree will not recreate it either — restore it
// from git after any re-init. Platform APIs plus androidx.core only, which
// MainActivity already pulls in for its insets; no new Gradle dependency in
// the generated tree, for the reason net.rs and TokenCipher give. The
// proguard keep for TrackingControl is load-bearing: it is reached from Rust
// over JNI by name, has no native methods and no manifest entry, so neither
// default rule protects it.

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * The switches Rust flips over JNI (`background.rs`): the foreground service
 * that keeps the process alive and unfrozen while Jellyfin tracking runs
 * with the screen off, and the battery-optimisation exemption that keeps
 * Android from stretching the notification job of a rarely-opened app.
 *
 * Every answer is a string: empty for "done", otherwise the platform's own
 * reason — the NotifScheduler convention, which exists because a swallowed
 * refusal is a pane that reads "on" beside a service that is not running.
 */
object TrackingControl {
  const val CHANNEL = "karasu.tracking"
  const val NOTIF_ID = 46233

  /** Starts the service. Android 12+ refuses a foreground start from the
   *  background (ForegroundServiceStartNotAllowedException), which is the
   *  expected reason here; Rust only asks while the activity is on screen. */
  @JvmStatic
  fun start(context: Context, title: String, body: String): String {
    return try {
      val intent = Intent(context, TrackingService::class.java)
        .putExtra(TrackingService.EXTRA_TITLE, title)
        .putExtra(TrackingService.EXTRA_BODY, body)
      ContextCompat.startForegroundService(context, intent)
      ""
    } catch (t: Throwable) {
      Log.w("KarasuTracking", "start failed", t)
      t.toString()
    }
  }

  @JvmStatic
  fun stop(context: Context) {
    try {
      context.stopService(Intent(context, TrackingService::class.java))
    } catch (t: Throwable) {
      Log.w("KarasuTracking", "stop failed", t)
    }
  }

  @JvmStatic
  fun isBatteryExempt(context: Context): Boolean {
    return try {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.isIgnoringBatteryOptimizations(context.packageName)
    } catch (t: Throwable) {
      false
    }
  }

  /** Opens the system dialog that asks the user to exempt Karasu. The dialog
   *  answers nothing back; the pane re-reads `isBatteryExempt` on focus. */
  @JvmStatic
  fun requestBatteryExemption(context: Context): String {
    return try {
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
        .setData(Uri.parse("package:" + context.packageName))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      ""
    } catch (t: Throwable) {
      Log.w("KarasuTracking", "battery exemption request failed", t)
      t.toString()
    }
  }
}

/**
 * Does no work of its own. The Rust loops — the 5 s detection poll, the
 * scrobbler, the alert passes — already run inside this process; what
 * Android freezes a few minutes after the screen goes off is the *process*,
 * and a foreground service with its persistent notification is the one
 * thing that stops it. `specialUse`, not `dataSync`: Android 15 caps
 * `dataSync` at six hours a day, and this APK is sideloaded, so there is
 * no store review to justify the subtype to — the manifest property says
 * what it is for anyway.
 *
 * START_NOT_STICKY on purpose: a service Android resurrects without Tauri
 * has nothing to keep alive.
 */
class TrackingService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Karasu"
    val body = intent?.getStringExtra(EXTRA_BODY) ?: ""

    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      // Idempotent, and re-creating updates the visible name — which is the
      // localized title Rust rendered, so the channel reads right in the
      // system's notification settings too.
      nm.createNotificationChannel(
        NotificationChannel(TrackingControl.CHANNEL, title, NotificationManager.IMPORTANCE_LOW)
      )
    }
    val open = PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val notification: Notification = NotificationCompat.Builder(this, TrackingControl.CHANNEL)
      // The launcher mark — the same fallback NotifJob uses; there is no
      // dedicated status-bar glyph in the res tree.
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(title)
      .setContentText(body)
      .setContentIntent(open)
      .setOngoing(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()

    val type =
      if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
    try {
      ServiceCompat.startForeground(this, TrackingControl.NOTIF_ID, notification, type)
    } catch (t: Throwable) {
      // A refused promotion leaves a plain background service, which is
      // worth nothing and would be killed with the process; end it cleanly.
      Log.w("KarasuTracking", "startForeground failed", t)
      stopSelf()
    }
    return START_NOT_STICKY
  }

  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"
  }
}
