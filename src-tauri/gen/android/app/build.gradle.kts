import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Hand-edited (init regenerates this file): release signing from
// key.properties (gitignored here), falling back to the debug keystore so a
// machine without one — CI — still emits an installable APK.
val keyProperties = Properties().apply {
    val propFile = file("key.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Hand-written (init regenerates this file): the fourth version segment.
//
// Karasu versions as MAJOR.MINOR.PATCH.COMMIT#, and only the first three reach
// `tauri.properties` -- the Tauri CLI writes it from `tauri.conf.json`, which
// carries the semver core and nothing else. Its versionCode formula is
// `major * 1000000 + minor * 1000 + patch`, so two release APKs that differ
// only in COMMIT_NUMBER were the same version to Android: `adb install -r`
// could not tell them apart, and neither could the settings screen.
//
// COMMIT_NUMBER is the one counter in this project that is monotonic by
// definition (+1 on every commit, never reset), which is exactly what a
// versionCode wants to be, so it is used directly. The base is what keeps the
// switch installable: the old formula's last shipped value was 190020, and
// Android refuses to install a lower versionCode over a higher one. A million
// clears every code that formula ever produced, leaving ~2.1 billion of
// headroom -- about four million more commits than this project will see.
//
// Read from the Rust const rather than a copy, because `scripts/bump-version.mjs`
// already owns that line and a sixth place to update is a sixth place to
// forget. There is deliberately no fallback: a silent one would reinstate the
// bug it is here to fix, and do it quietly.
val VERSION_CODE_BASE = 1_000_000

val commitNumber = run {
    val src = file("../../../src/commands/update.rs")
    if (!src.exists()) {
        throw GradleException("Cannot read the commit number: ${src.absolutePath} does not exist")
    }
    val match = Regex("""COMMIT_NUMBER: u32 = (\d+);""").find(src.readText())
        ?: throw GradleException("No `COMMIT_NUMBER: u32 = <n>;` in ${src.absolutePath}")
    match.groupValues[1].toInt()
}

android {
    compileSdk = 36
    namespace = "dev.kyu.karasu"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "dev.kyu.karasu"
        minSdk = 24
        targetSdk = 36
        versionCode = commitNumber + VERSION_CODE_BASE
        versionName =
            tauriProperties.getProperty("tauri.android.versionName", "1.0") + ".$commitNumber"
    }
    signingConfigs {
        create("release") {
            if (keyProperties.containsKey("storeFile")) {
                storeFile = file(keyProperties.getProperty("storeFile"))
                storePassword = keyProperties.getProperty("storePassword")
                keyAlias = keyProperties.getProperty("keyAlias")
                keyPassword = keyProperties.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            // Cleartext stays allowed in release, deliberately: Android
            // detection is Jellyfin-only, LAN Jellyfin over plain HTTP is the
            // documented answer to self-signed certificates (see net.rs), and
            // a release build that silently blocks exactly that would strand
            // the one detection source the platform has.
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            signingConfig = if (keyProperties.containsKey("storeFile"))
                signingConfigs.getByName("release")
            else
                signingConfigs.getByName("debug")
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")