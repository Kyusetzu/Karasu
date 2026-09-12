# Cargo-checks the tree for Android with the NDK toolchain exported, which only `tauri android build` otherwise does.
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

# Its own target dir, so cross-target churn does not dirty the desktop build or trip Defender's first-execute race on it.
$env:CARGO_TARGET_DIR = Join-Path $PSScriptRoot "../src-tauri/target/android-check"

Set-Location (Join-Path $PSScriptRoot "..\src-tauri")
# cargo reports progress on stderr, which a Stop preference turns into a terminating error at the first "Compiling" line.
$ErrorActionPreference = "Continue"
cargo check --target aarch64-linux-android @args
exit $LASTEXITCODE
