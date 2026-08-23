# Compiles the Rust tree for Android without building an APK — the fast
# feedback loop for `#[cfg(mobile)]` work.
#
# A bare `cargo check --target aarch64-linux-android` fails with "failed to
# find tool clang.exe": the C toolchain for the target comes from the NDK, and
# only `tauri android build/dev` exports it. This script exports the same
# five variables and nothing else, so cfg mistakes surface in seconds instead
# of at the end of a full Gradle build.
#
# Prerequisites (the A0 toolchain): JDK 17 under Eclipse Adoptium, the SDK at
# %LOCALAPPDATA%\Android\Sdk with ndk;27.1.12297006, and the rustup target
# `aarch64-linux-android`.
$ErrorActionPreference = "Stop"

$jdk = Get-ChildItem "C:\Program Files\Eclipse Adoptium" -Directory |
  Where-Object { $_.Name -like "jdk-17*" } | Select-Object -First 1
if (-not $jdk) { throw "JDK 17 not found under Eclipse Adoptium" }
$env:JAVA_HOME = $jdk.FullName

$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA "Android\Sdk"
$ndk = Get-ChildItem (Join-Path $env:ANDROID_HOME "ndk") -Directory |
  Sort-Object Name -Descending | Select-Object -First 1
if (-not $ndk) { throw "No NDK under $env:ANDROID_HOME\ndk" }
$env:NDK_HOME = $ndk.FullName

$bin = Join-Path $env:NDK_HOME "toolchains\llvm\prebuilt\windows-x86_64\bin"
# API 24 matches the generated project's minSdk.
$env:CC_aarch64_linux_android = Join-Path $bin "aarch64-linux-android24-clang.cmd"
$env:CXX_aarch64_linux_android = Join-Path $bin "aarch64-linux-android24-clang++.cmd"
$env:AR_aarch64_linux_android = Join-Path $bin "llvm-ar.exe"
$env:RANLIB_aarch64_linux_android = Join-Path $bin "llvm-ranlib.exe"
$env:CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER = $env:CC_aarch64_linux_android

# Its own target dir, for two reasons: the desktop dev loop's incremental
# state is not dirtied by cross-target churn, and Windows Defender's
# scan-on-first-execute race against freshly built build scripts ("Zugriff
# verweigert") stops hitting the artifacts the desktop build also wants.
$env:CARGO_TARGET_DIR = Join-Path $PSScriptRoot "../src-tauri/target/android-check"

Set-Location (Join-Path $PSScriptRoot "..\src-tauri")
# cargo reports progress on stderr; under Windows PowerShell 5.1 a Stop
# preference turns that into a terminating NativeCommandError at the first
# "Compiling" line. The strict preference was for the setup above, not this.
$ErrorActionPreference = "Continue"
cargo check --target aarch64-linux-android @args
exit $LASTEXITCODE
