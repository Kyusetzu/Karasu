# Reads the phone's side of the Jellyfin background-tracking story over adb —
# the measurement the plan for the foreground service asks for.
#
#   scripts\phone-measure.ps1                       service, standby bucket, Doze state, the job, Kotlin logcat
#   scripts\phone-measure.ps1 -Diagnostics x.md     ...plus polls per hour, from an exported diagnostics file
#   scripts\phone-measure.ps1 -Idle                 "unplug" the charger and force Doze (the negative run)
#   scripts\phone-measure.ps1 -Reset                undo -Idle
#
# Karasu's Rust log never reaches logcat on Android (logging.rs writes the
# file and the in-memory ring, nothing else), and a release APK is not
# debuggable, so `run-as` cannot read the file either. The poll count
# therefore comes from Settings -> Advanced -> Export diagnostics, which
# appends the log: save the file and pass it with -Diagnostics. The
# "N polls in the last 5 min" lines it counts exist only with verbose
# logging on (Settings -> Advanced), and the first one appears five minutes
# after the app started.
#
# What the numbers mean: the detection loop ticks every 5 s on screen and
# every 15 s with the screen off, so 720/h is "on screen", 240/h is "screen
# off but alive", and a stretch with no lines at all is the process frozen —
# the thing the tracking service exists to prevent. The standby bucket is
# what stretches the notification job: 10 active, 20 working set, 30
# frequent, 40 rare, 45 restricted, 5 exempted (the battery exemption).
param(
  [string]$Package = "dev.kyu.karasu",
  [string]$Diagnostics = "",
  [switch]$Idle,
  [switch]$Reset
)
$ErrorActionPreference = "Continue"

function Section($title) { ""; "== $title" }

Section "device"
adb devices

if ($Reset) {
  Section "undo the idle run"
  adb shell dumpsys deviceidle unforce
  adb shell dumpsys battery reset
}
if ($Idle) {
  Section "force Doze with the charger 'unplugged'"
  adb shell dumpsys battery unplug
  adb shell dumpsys deviceidle force-idle
}

Section "tracking service (TrackingService with isForeground=true is the healthy line)"
adb shell dumpsys activity services $Package | Select-String -Pattern "TrackingService|isForeground|foregroundNoti|createTime|startRequested"

Section "standby bucket"
adb shell am get-standby-bucket $Package

Section "battery-optimisation whitelist (listed = exempt)"
adb shell dumpsys deviceidle whitelist | Select-String -Pattern $Package

Section "Doze state"
adb shell dumpsys deviceidle get deep
adb shell dumpsys deviceidle get light

Section "notification job (46231)"
adb shell dumpsys jobscheduler | Select-String -Pattern $Package -Context 0,25 | Select-Object -First 1

Section "logcat, the Kotlin side (last 50 lines)"
adb logcat -d -s KarasuTracking:V KarasuNotifJob:V | Select-Object -Last 50

if ($Diagnostics -ne "") {
  Section "polls per hour, from the exported diagnostics"
  if (-not (Test-Path $Diagnostics)) { "no such file: $Diagnostics"; exit 1 }
  $hits = Get-Content $Diagnostics | Select-String -Pattern "polls in the last"
  if (-not $hits) {
    "no poll lines - was verbose logging on, and did the app run for five minutes?"
  }
  foreach ($hit in $hits) {
    $m = [regex]::Match($hit.Line, "^(\S+).*?(\d+) polls in the last (\d+) min")
    if ($m.Success) {
      $polls = [int]$m.Groups[2].Value
      $mins = [int]$m.Groups[3].Value
      $perHour = [math]::Round($polls * 60 / $mins)
      $cadence = if ($polls -gt 0) { [math]::Round($mins * 60 / $polls, 1) } else { "-" }
      "{0}  {1,4} polls / {2} min  = {3,4}/h  (one every {4} s)" -f $m.Groups[1].Value, $polls, $mins, $perHour, $cadence
    }
  }
}
