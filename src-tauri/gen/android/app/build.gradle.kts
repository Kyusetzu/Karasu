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

// Hand-edited; `tauri android init` regenerates this file: release signing from key.properties, debug fallback for CI.
val keyProperties = Properties().apply {
    val propFile = file("key.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Hand-written; `tauri android init` regenerates this file: versionCode is COMMIT_NUMBER, which tauri.properties omits.
val VERSION_CODE_BASE = 1_000_000 // above every code the old formula produced; Android refuses a lower versionCode

val commitNumber = run { // read from the Rust const, never a copy: scripts/bump-version.mjs owns that line
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
            // Kept on purpose: a LAN Jellyfin over plain HTTP is a supported setup, and Android has no other detection source.
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