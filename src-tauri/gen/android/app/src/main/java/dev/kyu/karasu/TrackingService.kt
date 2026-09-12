package dev.kyu.karasu

// Hand-written; `tauri android init` will not recreate it, restore from git; platform APIs only, no Gradle dependency.

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

/** Flipped from Rust over JNI by name (proguard keep load-bearing); each answers "" or the platform's own reason. */
object TrackingControl {
  const val CHANNEL = "karasu.tracking"
  const val NOTIF_ID = 46233

  /** Android refuses a foreground start from the background, so Rust only asks while the activity is on screen. */
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

  /** Opens the system exemption dialog; it answers nothing back, so the pane re-reads isBatteryExempt on focus. */
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

/** Does no work itself; a foreground service is what keeps Android from freezing the process the Rust loops run in. */
class TrackingService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Karasu"
    val body = intent?.getStringExtra(EXTRA_BODY) ?: ""

    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      // Idempotent; re-creating updates the visible name to the localized title Rust rendered.
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
      // The launcher mark, as NotifJob falls back to; the res tree has no status-bar glyph.
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(title)
      .setContentText(body)
      .setContentIntent(open)
      .setOngoing(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()

    val type =
      if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0 // not dataSync: Android caps that per day
    try {
      ServiceCompat.startForeground(this, TrackingControl.NOTIF_ID, notification, type)
    } catch (t: Throwable) {
      // A refused promotion leaves a plain background service, worth nothing; end it cleanly.
      Log.w("KarasuTracking", "startForeground failed", t)
      stopSelf()
    }
    return START_NOT_STICKY // a service Android resurrects without Tauri has nothing to keep alive
  }

  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"
  }
}
