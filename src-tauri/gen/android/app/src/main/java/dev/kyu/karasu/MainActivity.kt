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
  // Hand-edited: the share target. A shared link arrives as ACTION_SEND with
  // the URL inside EXTRA_TEXT (usually wrapped in words — "Title https://…")
  // and a null data field, which the deep-link plugin rejects twice over. A
  // synthetic VIEW built from the first extracted URL rides the plugin's own
  // validation and routing instead — deliberately not tao's SEND parsing,
  // whose Android path dead-ends and turns wordy shares into data: URLs.
  // The rewrite runs before super in onCreate (tao reads getIntent there)
  // and rewrites both the parameter and setIntent on the warm path.
  private fun asView(intent: Intent?): Intent? {
    if (intent?.action != Intent.ACTION_SEND || intent.type != "text/plain") return null
    val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return null
    val url = Regex("https?://\\S+").find(text)?.value?.trimEnd(')', '"', '\'', '.', ',', ';')
      ?: return null
    return Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(packageName)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    asView(intent)?.let { setIntent(it) }
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

  override fun onPause() {
    super.onPause()
    // Hand-edited: leaving the app is the moment the home screen becomes
    // visible again, and whatever this session changed should be on it.
    try {
      WidgetRefresher.refresh(applicationContext)
    } catch (t: Throwable) {
      // A widget refresh must never take the activity lifecycle down.
    }
  }

  override fun onNewIntent(intent: Intent) {
    // Warm path of the share target: singleTask delivers here, and the
    // plugin reads the *parameter*, so both it and the activity's stored
    // intent are rewritten.
    val rewritten = asView(intent) ?: intent
    setIntent(rewritten)
    super.onNewIntent(rewritten)
  }
}
