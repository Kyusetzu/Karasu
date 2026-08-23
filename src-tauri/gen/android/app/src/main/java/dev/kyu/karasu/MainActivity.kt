package dev.kyu.karasu

import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.view.ViewGroup
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Hand-edited from the generated file (a bare enableEdgeToEdge()), and
    // `tauri android init` will regenerate it back — re-apply this if the
    // app's header ever climbs under the clock again.
    //
    // With targetSdk 35+ Android *enforces* edge-to-edge, so opting out via
    // setDecorFitsSystemWindows is ignored there; the WebView cannot see the
    // status bar either (env(safe-area-inset-top) stays 0 for it). So the
    // insets are applied natively: the content view is padded by the real
    // system-bar and cutout insets, and the exposed strips wear the app's
    // own surface-950 so they read as chrome, not as a hole.
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    window.setBackgroundDrawable(ColorDrawable(Color.parseColor("#0b0d12")))
    val root = findViewById<ViewGroup>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
    // Dark surface behind the (now transparent) status bar: light glyphs.
    WindowInsetsControllerCompat(window, root).isAppearanceLightStatusBars = false
  }
}
