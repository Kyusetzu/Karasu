package dev.kyu.karasu

import android.content.Context
import android.os.Build

// Hand-written (restore from git after a wiped re-init). Reached from Rust over JNI by name, so proguard keeps it.
object SystemAccent {
  // Material You's primary accent, the shade the theme store derives a ramp from; empty below Android 12.
  @JvmStatic
  fun get(context: Context): String {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return ""
    val argb = context.getColor(android.R.color.system_accent1_500)
    return String.format("#%06x", argb and 0xffffff)
  }
}
