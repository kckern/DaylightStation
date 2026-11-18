# Shield cutover: one sitting

**Nothing in this runbook has been run.** It is the Shield's path through
[kiosk cutover runbook](kiosk-cutover.md) as one supervised sitting, with the
acceptance runner doing the checking. Start with the
[kiosk recovery instructions](kiosk-cutover.md#if-the-kiosk-is-dark-or-unreachable)
when the screen or control API is unavailable. Follow the
[Shield microphone rollback](#microphone-rollback) before restarting audio-bridge.

What is special about the Shield: Android 11 (API 30), no
`android.software.device_admin` feature, so no device admin and no device owner
are possible. Lockdown is app-level only, there is no remote reboot and no
tap-free update (`dd update` needs someone with the remote), and `lease-gate`
can only block and recall. The microphone is the design's named risk: it goes
first, and the sitting stops if it fails. Check that ADB reconnects after each
reboot (`adb connect {device-address}:5555`); the rollback needs it.

## Placeholders

| Placeholder | Meaning |
|---|---|
| `dd` | `node cli/daylight-device.cli.mjs shield` |
| `acc` | `node cli/daylight-acceptance.cli.mjs shield` |
| `fkb` | `node cli/fkb.cli.mjs`, pointed at the Shield |
| `<serial>` | `{device-address}:5555` |
| `{backend-id}` | the Shield's id in the backend's devices.yml |
| `{log-store-url}` | the log store's base URL (`CLAUDE.local.md`) |
| `{laptop-address}:{port}` | this machine's LAN address and a free port, for `--serve-bad-payload` |

**What `acc` does to the device.** A plain `acc` only reads. `--active` also
reloads the page, foregrounds the kiosk, resets the renderer, shows a message for
a moment, turns the screen off for about two seconds and back, writes the volume
back at its level, runs `6*7` in the page and `id` through exec (refused while
exec is off). `--restart` restarts the payload: the page and the mic stream drop
for a few seconds. `--launch <package>` opens that app and returns. **No
`--active` or `--restart` during a call.**

**Backend changes take a restart.** The device adapters are built once when the
backend starts; a config reload does not switch them. Every "restart the backend"
below means restarting the prod container, as in a deploy.

## Before the sitting (no device contact)

- [ ] The seams branch is deployed; the Shield's backend entry still says `provider: fully-kiosk`.
- [ ] In the private household hardware `devices.yml`, check that the Shield's
      `input.audio_bridge.url` is a loopback WebSocket on port 8765. Weekly Review
      uses the same port. Keep the existing URL through handover and rollback.
      Confirm the Home Line and Weekly Review pages are on the origin of the
      Shield's configured kiosk start URL.
- [ ] The private tokens file has the `shield` entry and an alias entry under
      `{backend-id}` (`shield: &shield ...`, `{backend-id}: *shield`).
- [ ] `./gradlew build --rerun-tasks`; `node tools/verify-build.mjs shield --legacy`.
- [ ] The owner has decided: keep the overlay anchor if the mic needs it; provision
      `lease-gate` now or leave it idle; accept updates that need the remote.

## The sitting

| # | Do | Go when | No-go: rollback |
|---|---|---|---|
| 1 | Backups: audio-bridge state and its working launch method (launcher activity or service, exact component and command) in the private sitting notes, supervision-guard provisioning if any, `fkb get`, `fkb get kioskAppWhitelist`, HOME resolution, the accessibility list; `adb -s <serial> shell pm list features` (confirm no `device_admin`) | saved, including the command to bring audio-bridge back | nothing changed |
| 2 | Install (stage 2), home-candidate check; grants (stage 3) including `SYSTEM_ALERT_WINDOW` and `ACCESS_FINE_LOCATION` | unchanged HOME | `adb -s <serial> uninstall net.kckern.daylight.shield` |
| 3 | Whitelist this app in Fully (stage 4); start the Activity | page shows | restore the whitelist |
| 4 | **Microphone first.** Follow the [handover](#microphone-handover) | `dd get /mic/status` shows `running: true`, `port: 8765` and no error. `acc --only mic.capture` gives the manual capture gate for step 5 | follow [microphone rollback](#microphone-rollback) and stop the sitting |
| 5 | Run both [consumer checks](#microphone-capture-at-handover-and-after-each-cold-boot) with audio-bridge stopped | a five-minute Home Line call with audible speech both ways and a playable Weekly Review recording, each with PCM evidence | as step 4 |
| 6 | `acc --active --launch com.retroarch.aarch64` (after the call; opens the emulator and returns) | no FAIL; `launch.app` sees the emulator in front and the kiosk returns | `dd foreground` |
| 7 | Stage 8 proofs: `dd update <apk-url> <sha256>` twice (confirm on the TV each time); `acc --only reboot --reboot --reboot-wait 600` three times, power-cycling by hand when it says so (ADB check after each); `acc --only payload.bad,crash --restart --kill --serve-bad-payload {laptop-address}:{port}` | `reboot.survives` PASS 3 of 3; complete the [capture proof](#microphone-capture-at-handover-and-after-each-cold-boot) before proceeding after each reboot | stop the sitting and follow [microphone rollback](#microphone-rollback). Fully is still HOME |
| 8 | Backend: `{backend-id}` `content_control.provider: daylight-android`, `auth_ref: daylight-android`, volume provider; **restart the backend** | the admin console and a play from the menu reach the app; `prepareForContent` logs no mic restart loop | restore `fully-kiosk` and restart the backend. If ending the sitting, use [rollback to Fully](#rollback-to-fully) |
| 9 | Home and lockdown: `launcher.allowed` and `lockdown.allowedApps` from step 1; `dd lockdown home on`; `adb -s <serial> shell cmd package set-home-activity net.kckern.daylight.shield/net.kckern.daylight.cap.lockdown.shell.KioskHome`; force-stop Fully; `dd settings set lockdown.enabled true` | `locked: true`, `mode: app`, `homeIsKiosk: true` | [rollback to Fully](#rollback-to-fully) |
| 10 | `acc --active --launch com.retroarch.aarch64`; then the MANUAL lines: Home, Recents, the assistant button, the remote's D-pad, select, back and play/pause against the `fkb.keyCapture` audit, controller pairing from the Controllers screen | no FAIL; each escape recalled | [rollback to Fully](#rollback-to-fully) |
| 11 | Only with the lease provisioned: `dd settings set lease.endpoint …`, `lease.packageName …`, `lease.credential …`, then `lease.enabled true` | `acc --only lease` reads `configured true, ready true`; no lease: the game is recalled; with a lease: it runs | `dd settings set lease.enabled false` |
| 12 | `acc --only reboot --reboot --reboot-wait 600` with lockdown on (power-cycle by hand); `acc --only logstore --log-store {log-store-url}` | `reboot.survives` PASS; complete the [capture proof](#microphone-capture-at-handover-and-after-each-cold-boot) with lockdown on | [rollback to Fully](#rollback-to-fully) |
| 13 | The next day: make it permanent (stage 10 step 12). In `devices/shield.yml`: `cutover: done`, `lockdown.enabled` and `lockdown.required` `true`, `mic.enabled` `true`, and `lease.enabled` `true` only if the lease was provisioned at step 11 | `required: true`; `node --test tools/roadmap-capabilities.test.mjs` passes | confirm an update with `required: false` on the TV, then follow [rollback to Fully](#rollback-to-fully) |

### Microphone handover

1. During coexistence, confirm `mic.enabled` is false in `dd status` and
   `dd get /mic/status` shows `running: false` and `port: 8765`. If a previous
   install retained a different port, run `dd settings set mic.port 8765` while
   the switch is off and read it back. The legacy app still owns the listener.
2. End any call or recording. Stop audio-bridge with
   `adb -s <serial> shell am force-stop net.kckern.audiobridge`. Confirm its
   process has exited with `adb -s <serial> shell pidof net.kckern.audiobridge`.
   Enable the new listener with `dd settings set mic.enabled true`, then read
   `dd get /mic/status`. If it fails, record `lastError` and `lastErrorDetail`
   privately. A port conflict appears as `bind_failed`.

### Microphone rollback

1. Run `dd settings set mic.enabled false`. Verify `dd settings get mic.enabled`
   reports false and `dd get /mic/status` reports `running: false`. If either
   check is unavailable or fails, run `adb -s <serial> shell am force-stop net.kckern.daylight.shield`.
   Verify that `adb -s <serial> shell pidof net.kckern.daylight.shield` returns no
   process ID. Keep the new app stopped while audio-bridge owns the port.
2. Start audio-bridge using the working launch command saved in sitting step 1.
   Verify that it serves capture through the same loopback URL.

### Rollback to Fully

Follow [stage 11](kiosk-cutover.md#stage-11-rollback-to-fully) for a full rollback.
Use step 1 of [microphone rollback](#microphone-rollback) at stage 11 step 3 to
release the shared port. Use step 2 at stage 11 step 7 to restore audio-bridge.
If the control API is unavailable, use the ADB recovery path and restore Fully's
HOME as described in the [kiosk recovery instructions](kiosk-cutover.md#if-the-kiosk-is-dark-or-unreachable).

### Microphone capture at handover and after each cold boot

For step 5, use `acc --only mic.capture`. After each cold boot, wait for
`reboot.survives` to pass and follow its `reboot.mic-capture` manual gate.
Confirm audio-bridge's process is still stopped. Use both consumers below after
each boot without a microphone restart or a preparatory page reload.

- Start a Home Line call from another device. Keep audio and video working in
  both directions for five minutes and confirm audible speech at both ends.
  For PCM evidence, match the Shield session and call timestamp to frontend
  events using `context.component:"useNativeAudioBridge" AND _msg:"bridge-volume" AND _time:5m`.
  Speak near the Shield and require a fresh `maxLevel` greater than zero.
- After ending the call, record spoken words in Weekly Review on the Shield.
  Match `recorder.bridge-acquired` and `recorder.first-audible-frame` from
  `weekly-review-recorder` to the same recording session. The first event
  identifies the bridge path and the second shows that audio reached the
  recorder. Play the resulting recording and confirm intelligible speech.

If frontend logs are unavailable and the Shield WebView inspector was enabled
for the approved sitting, open the consumer's WebView in Chrome via
`chrome://inspect/#devices`. Open **Network → WS** before starting the call or
recording. Select the socket on port 8765 and open **Messages**. Require incoming
**Binary Message** rows with nonzero even byte lengths after the `pcm_s16le`
text format header in each consumer. The listening and playback checks still
apply.

Record timestamps, PCM evidence and the listening and playback results in the
private sitting notes. Save only evidence metadata and listening results.
The runner reports the capture gate as MANUAL when the service reports healthy.
A disabled or unhealthy service fails the check. Complete both consumer checks
before proceeding.

## The soak: two weeks

Starts the day step 13 is done. Fully and audio-bridge stay installed and stopped.

Watched daily, read-only:

- `acc --only core,mic.status,kiosk.status,lockdown.status --log-store {log-store-url} --log-window 24h`: no FAIL.
- The log store under `daylight-shield`: no `capture_denied`, no mic restart loop
  in the backend (`daylightandroid.prepareForContent.micRestarted`).
- Calls, the media menu, the arcade (launch, the countdown overlay, return).

The soak restarts on any rollback or any recovery that needed the lifeline or
ADB. When all three devices have had fourteen clean days, phase 8 starts; its
deletion list and order are in the phases 4 to 6 plan (ops docs).
