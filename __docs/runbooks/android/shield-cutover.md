# Shield cutover: one sitting

**Nothing in this runbook has been run.** It is the Shield's path through
`kiosk-cutover.md` (the long form, stages 0 to 11) as one supervised sitting,
with the acceptance runner doing the checking. The way back from any step is
that file's first section.

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
- [ ] The private tokens file has the `shield` entry and an alias entry under
      `{backend-id}` (`shield: &shield ...`, `{backend-id}: *shield`).
- [ ] `./gradlew build --rerun-tasks`; `node tools/verify-build.mjs shield --legacy`.
- [ ] The owner has decided: keep the overlay anchor if the mic needs it; provision
      `lease-gate` now or leave it idle; accept updates that need the remote.

## The sitting

| # | Do | Go when | No-go: rollback |
|---|---|---|---|
| 1 | Backups: audio-bridge state, supervision-guard provisioning if any, `fkb get`, `fkb get kioskAppWhitelist`, HOME resolution, the accessibility list; `adb -s <serial> shell pm list features` (confirm no `device_admin`) | saved | nothing changed |
| 2 | Install (stage 2), home-candidate check; grants (stage 3) including `SYSTEM_ALERT_WINDOW` and `ACCESS_FINE_LOCATION` | unchanged HOME | `adb -s <serial> uninstall net.kckern.daylight.shield` |
| 3 | Whitelist this app in Fully (stage 4); start the Activity | page shows | restore the whitelist |
| 4 | **Microphone first.** Stop audio-bridge (`adb -s <serial> shell am force-stop net.kckern.audiobridge`); `dd settings set mic.enabled true`; open the call page | `acc --only mic.status` reports a running service; `acc --only mic.capture` gives the manual capture instructions for step 5 | `dd settings set mic.enabled false`; start audio-bridge. **Stop the sitting** and record `lastError`, `lastErrorDetail` |
| 5 | A Home Line call from a phone, five minutes, both ways | the consumer receives PCM audio frames from the Shield and a person confirms audible speech; audio and video work both ways | as step 4 |
| 6 | `acc --active --launch com.retroarch.aarch64` (after the call; opens the emulator and returns) | no FAIL; `launch.app` sees the emulator in front and the kiosk returns | `dd foreground` |
| 7 | Stage 8 proofs: `dd update <apk-url> <sha256>` twice (confirm on the TV each time); `acc --only reboot --reboot --reboot-wait 600` three times, power-cycling by hand when it says so (ADB check after each); `acc --only payload.bad,crash --restart --kill --serve-bad-payload {laptop-address}:{port}` | `reboot.survives` PASS 3 of 3; complete the `reboot.mic-capture` proof below after each reboot | stop; Fully and audio-bridge run the Shield |
| 8 | Backend: `{backend-id}` `content_control.provider: daylight-android`, `auth_ref: daylight-android`, volume provider; **restart the backend** | the admin console and a play from the menu reach the app; `prepareForContent` logs no mic restart loop | back to `fully-kiosk`, restart the backend |
| 9 | Home and lockdown: `launcher.allowed` and `lockdown.allowedApps` from step 1; `dd lockdown home on`; `adb -s <serial> shell cmd package set-home-activity net.kckern.daylight.shield/net.kckern.daylight.cap.lockdown.shell.KioskHome`; force-stop Fully; `dd settings set lockdown.enabled true` | `locked: true`, `mode: app`, `homeIsKiosk: true` | stage 11 |
| 10 | `acc --active --launch com.retroarch.aarch64`; then the MANUAL lines: Home, Recents, the assistant button, the remote's D-pad, select, back and play/pause against the `fkb.keyCapture` audit, controller pairing from the Controllers screen | no FAIL; each escape recalled | stage 11 |
| 11 | Only with the lease provisioned: `dd settings set lease.endpoint …`, `lease.packageName …`, `lease.credential …`, then `lease.enabled true` | `acc --only lease` reads `configured true, ready true`; no lease: the game is recalled; with a lease: it runs | `dd settings set lease.enabled false` |
| 12 | `acc --only reboot --reboot --reboot-wait 600` with lockdown on (power-cycle by hand); `acc --only logstore --log-store {log-store-url}` | `reboot.survives` PASS; complete the `reboot.mic-capture` proof below with lockdown on | stage 11 |
| 13 | The next day: make it permanent (stage 10 step 12). In `devices/shield.yml`: `cutover: done`, `lockdown.enabled` and `lockdown.required` `true`, `mic.enabled` `true`, and `lease.enabled` `true` only if the lease was provisioned at step 11 | `required: true`; `node --test tools/roadmap-capabilities.test.mjs` passes | an update with `required: false`, confirmed on the TV |

### Microphone capture after each reboot

Wait for `reboot.survives` to pass. With no one touching the Shield after boot,
start a Home Line call from another device. Use the same consumer and listening
checks for the initial hand-over in step 5.

1. In the log store, find this Shield call's frontend events using
   `context.component:"useNativeAudioBridge" AND _msg:"bridge-volume" AND _time:5m`.
   Match the events to the call's timestamp and the Shield's kiosk session.
   Speak near the Shield and require a fresh `maxLevel` greater than zero.
   The worklet computes this level from decoded PCM playback samples. A format
   header can initialize the worklet, but cannot produce a positive level.
2. If frontend logs are unavailable and the Shield WebView inspector was enabled
   for the approved sitting, open the consumer's WebView in Chrome via
   `chrome://inspect/#devices`. Open **Network → WS** before the call opens
   the mic connection. Select the socket whose port matches `GET /mic/status`
   and open **Messages**. Require incoming **Binary Message** rows with a
   nonzero even byte length after the `pcm_s16le` text format header.
   Do not reload the Shield page or restart anything to make capture succeed.
3. Have the person on the other end confirm they hear intelligible speech from
   the Shield. Record the time, the positive level or binary message count and
   byte lengths, and the listening result in the private sitting notes. Keep
   the audio payload out of the notes and do not export the WebSocket capture.

The runner reports `reboot.mic-capture` as MANUAL when the service reports
healthy. A disabled or unhealthy service fails the check. Require both the
consumer evidence and the listening result before proceeding.

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
