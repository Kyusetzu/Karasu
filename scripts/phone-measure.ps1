# Reads the phone's side of Jellyfin background tracking over adb; the Rust log never reaches logcat, hence -Diagnostics.
#
#   scripts\phone-measure.ps1                       service, standby bucket, Doze state, the job, Kotlin logcat
#   scripts\phone-measure.ps1 -Diagnostics x.md     ...plus polls per hour, from an exported diagnostics file
#   scripts\phone-measure.ps1 -Idle                 "unplug" the charger and force Doze (the negative run)
#   scripts\phone-measure.ps1 -Reset                undo -Idle
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

Section "process (isFrozen=true is the process stopped in its tracks, whatever the service says)"
adb shell dumpsys activity processes $Package | Select-String -Pattern "ProcessRecord\{|isFrozen|curProcState|lastActivityTime"

Section "freeze events (am_freeze / am_unfreeze, from the events log buffer)"
$events = adb logcat -b events -d -v time | Select-String -Pattern "am_freeze|am_unfreeze|am_proc_died|am_kill" | Select-String -Pattern $Package | Select-Object -Last 12
if ($events) { $events | ForEach-Object { $_.Line } } else { "none in the buffer" }

Section "standby bucket"
adb shell am get-standby-bucket $Package

Section "battery-optimisation whitelist (listed = exempt)"
adb shell dumpsys deviceidle whitelist | Select-String -Pattern $Package

Section "Doze state"
adb shell dumpsys deviceidle get deep
adb shell dumpsys deviceidle get light

Section "notification job (46231)"
# The job's own entry, not the package's first mention: the dump opens with a scheduling history naming every package.
$job = adb shell dumpsys jobscheduler | Select-String -Pattern "JOB #.*$Package/\.NotifJobService" -Context 0,25 | Select-Object -First 1
if ($job) { $job } else { "not registered - the check interval is off (Settings -> AniList -> Notifications), or the app has not started since it was set" }

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
