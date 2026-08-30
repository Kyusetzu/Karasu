# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Hand-added (init does not regenerate this file's content, but keep the note
# anyway): TokenCipher is reached from Rust over JNI by name — minification
# renaming or stripping it fails only at runtime, as a failed sign-in.
-keep class dev.kyu.karasu.TokenCipher { *; }

# The background notification job. NotifScheduler is the load-bearing one:
# it is reached from Rust over JNI by name, has no native methods and no
# manifest entry, so *neither* default keep rule protects it — the same
# runtime-only failure mode TokenCipher's note describes. KarasuNative and
# the JobService are covered by defaults (native methods / manifest), kept
# explicitly anyway so a default-rule change cannot break them silently.
-keep class dev.kyu.karasu.NotifScheduler { *; }
-keep class dev.kyu.karasu.KarasuNative { *; }
-keep class dev.kyu.karasu.NotifJobService { *; }
