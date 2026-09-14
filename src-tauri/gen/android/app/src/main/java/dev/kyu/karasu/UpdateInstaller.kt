package dev.kyu.karasu

// Hand-written; `tauri android init` will not recreate it, restore from git; platform APIs only, no Gradle dependency.

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Build
import android.os.StatFs
import android.provider.Settings
import android.util.Log
import androidx.core.content.FileProvider
import java.io.File

/** The device facts and the installer hand-off Rust's apk_update asks for over JNI by name; proguard keep load-bearing. */
object UpdateInstaller {
  private const val TAG = "KarasuUpdate"

  /** The first supported ABI, which picks the manifest leg: arm64 gets its own APK, everything else the universal one. */
  @JvmStatic
  fun abi(context: Context): String = Build.SUPPORTED_ABIS.firstOrNull() ?: ""

  /** Where the download lives; the FileProvider's cache-path entry is what lets the installer read it from here. */
  @JvmStatic
  fun cacheDir(context: Context): String = context.cacheDir.absolutePath

  @JvmStatic
  fun freeBytes(context: Context): String = try {
    StatFs(context.cacheDir.absolutePath).availableBytes.toString()
  } catch (t: Throwable) {
    Log.w(TAG, "statfs failed", t)
    Long.MAX_VALUE.toString()
  }

  /** "true" on a metered network, so the automatic download waits for Wi-Fi unless the user said otherwise. */
  @JvmStatic
  fun isMetered(context: Context): String {
    val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return "false"
    return cm.isActiveNetworkMetered.toString()
  }

  /** "" when the installer may be opened, "permission" while the "install unknown apps" switch is off for Karasu. */
  @JvmStatic
  fun canInstall(context: Context): String =
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()) "" else "permission"

  /** Opens the per-app "install unknown apps" switch; it answers nothing back, so About re-reads canInstall on focus. */
  @JvmStatic
  fun openInstallPermission(context: Context): String = try {
    val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
      .setData(Uri.parse("package:" + context.packageName))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
    ""
  } catch (t: Throwable) {
    Log.w(TAG, "install permission screen failed", t)
    t.toString()
  }

  /** "<versionCode>|same" or "<versionCode>|different" for the file's signing certificates against the installed app's. */
  @JvmStatic
  fun inspect(context: Context, path: String): String {
    val pm = context.packageManager
    return try {
      val archive = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        pm.getPackageArchiveInfo(path, PackageManager.GET_SIGNING_CERTIFICATES)
      } else {
        @Suppress("DEPRECATION")
        pm.getPackageArchiveInfo(path, PackageManager.GET_SIGNATURES)
      } ?: return "unreadable"
      val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) archive.longVersionCode else @Suppress("DEPRECATION") archive.versionCode.toLong()
      val same = archive.packageName == context.packageName && certs(archive) == certs(installed(context))
      "$code|" + if (same) "same" else "different"
    } catch (t: Throwable) {
      Log.w(TAG, "inspect failed", t)
      "unreadable"
    }
  }

  private fun installed(context: Context) = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
    context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
  } else {
    @Suppress("DEPRECATION")
    context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES)
  }

  /** The signing certificates as a sorted set of hashes, so rotation history and order cannot make equal keys differ. */
  private fun certs(info: android.content.pm.PackageInfo): Set<Int> {
    val sigs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val s = info.signingInfo ?: return emptySet()
      if (s.hasMultipleSigners()) s.apkContentsSigners else s.signingCertificateHistory
    } else {
      @Suppress("DEPRECATION") info.signatures
    } ?: return emptySet()
    return sigs.map { it.hashCode() }.toSet()
  }

  /** Hands the verified file to the system installer; the user's tap on its dialog is the install. */
  @JvmStatic
  fun install(context: Context, path: String): String = try {
    val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", File(path))
    val intent = Intent(Intent.ACTION_VIEW)
      .setDataAndType(uri, "application/vnd.android.package-archive")
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
    ""
  } catch (t: Throwable) {
    Log.w(TAG, "installer failed to open", t)
    t.toString()
  }
}
