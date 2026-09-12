package dev.kyu.karasu

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  // Hand-edited: the deep-link plugin rejects ACTION_SEND, so the first URL in EXTRA_TEXT is re-sent as a VIEW it routes.
  private fun asView(intent: Intent?): Intent? {
    if (intent?.action != Intent.ACTION_SEND || intent.type != "text/plain") return null
    // A styled share arrives as a Spanned, and getStringExtra answers null for anything but a String.
    val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: return null
    val url = Regex("https?://\\S+").find(text)?.value?.trimEnd(')', '"', '\'', '.', ',', ';')
      ?: return null
    return Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(packageName)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    asView(intent)?.let { setIntent(it) } // before super: tao reads getIntent there
    // Hand-edited; `tauri android init` regenerates this file back to a bare enableEdgeToEdge().
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    window.setBackgroundDrawable(ColorDrawable(Color.parseColor("#0b0d12"))) // surface-950: the exposed strips read as chrome, not a hole
    val root = findViewById<ViewGroup>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets -> // native insets: edge-to-edge is enforced, and the WebView cannot see the system bars
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
    // Dark surface behind the (now transparent) status bar: light glyphs.
    WindowInsetsControllerCompat(window, root).isAppearanceLightStatusBars = false
  }

  override fun onResume() {
    super.onResume()
    // Hand-edited: Rust speeds the poll back up and gets its one chance to start a wanted tracking service.
    try {
      KarasuNative.setForeground(true)
    } catch (t: Throwable) {
      // A missing symbol must never take the activity lifecycle down.
    }
  }

  override fun onPause() {
    super.onPause()
    // Hand-edited: the home screen is about to show, so the widgets pick up what this session changed.
    try {
      WidgetRefresher.refresh(applicationContext)
    } catch (t: Throwable) {
      // A widget refresh must never take the activity lifecycle down.
    }
    try {
      KarasuNative.setForeground(false)
    } catch (t: Throwable) {
      // A missing symbol must never take the activity lifecycle down.
    }
  }

  override fun onNewIntent(intent: Intent) {
    // Share target, warm path: the plugin reads the parameter, so it and the stored intent are both rewritten.
    val rewritten = asView(intent) ?: intent
    setIntent(rewritten)
    super.onNewIntent(rewritten)
  }
}
