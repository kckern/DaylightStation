# Piano tablet cutover: one sitting

**Nothing in this runbook has been run.** It is the piano tablet's path through
`kiosk-cutover.md` (the long form, stages 0 to 11) as one supervised sitting,
with the acceptance runner doing the checking. The way back from any step is
that file's first section, "If the kiosk is dark or unreachable".

What is special about the tablet: Android 10, no device owner; Fully is a device
admin with `force-lock` only (its screen-off). The old bridge APK
(`net.kckern.pianobridge`) holds the MIDI link and the speaker, and the backend
watches it. The tablet is in daily lesson use: **the sitting is outside lesson
hours**, and the old bridge's config is backed up first because a
replace-install wipes it.

**Have a USB cable at the tablet.** ADB over WiFi may not come back after a
reboot, and the rollback (stage 11) needs ADB. After each reboot from step 7 on,
check `adb connect {device-address}:5555`; if it fails, connect the cable and run
`adb -s <usb-serial> tcpip 5555`.

## Placeholders

| Placeholder | Meaning |
|---|---|
| `dd` | `node cli/daylight-device.cli.mjs piano` |
| `acc` | `node cli/daylight-acceptance.cli.mjs piano` |
| `pbctl` | `node _extensions/piano-bridge/pbctl.mjs`, pointed at the tablet |
| `fkb` | `node cli/fkb.cli.mjs`, pointed at the tablet |
| `<serial>` | `{device-address}:5555`; `<usb-serial>` is the cable's serial from `adb devices` |
| `{backend-id}` | the tablet's id in the backend's devices.yml |
| `{log-store-url}` | the log store's base URL (`CLAUDE.local.md`) |
| `{laptop-address}:{port}` | this machine's LAN address and a free port, for `--serve-bad-payload` |

**What `acc` does to the device.** A plain `acc` only reads. `--active` also
reloads the page, foregrounds the kiosk, resets the renderer, shows a message for
a moment, turns the screen off for about two seconds and back, writes the volume
back at its level, runs `6*7` in the page and `id` through exec (refused while
exec is off), and sends one probe note to the instrument through the loopback.
`--restart` restarts the payload: MIDI, synth and the page drop for a few seconds.
**Never pass `--active` or `--restart` while someone is playing.**

**Backend changes take a restart.** The bridge supervisor, the MIDI wake and the
device adapters are built once when the backend starts; a config reload does not
switch them. Every "restart the backend" below means restarting the prod
container, as in a deploy.

## Before the sitting (no device contact)

- [ ] The seams branch is deployed: it carries the piano switch
      (`bridge_provider`, see `__docs/reference/integrations/adb.md`, "The piano
      bridge on the Android kiosk app"). The tablet's backend entry still says
      `provider: fully-kiosk`, and the piano config has no `bridge_provider`.
- [ ] The private tokens file has the `piano` entry, and an alias entry under
      `{backend-id}` for the backend, which reads the file by its own device id.
      No token is copied: give the `piano` entry an anchor and alias it
      (`piano: &piano ...` then `{backend-id}: *piano`).
- [ ] `./gradlew build --rerun-tasks`; `node tools/verify-build.mjs piano --legacy`.
- [ ] The owner has decided: device owner or `app` mode; the window; whether
      the log store name changes to `daylight-piano` now.

## The sitting

| # | Do | Go when | No-go: rollback |
|---|---|---|---|
| 1 | Backups: `pbctl config > {private-notes}/piano-bridge-config.json` (all of `GET /config`), `fkb get`, `fkb get kioskAppWhitelist`, HOME resolution, the accessibility list, `adb -s <serial> shell dumpsys device_policy` | saved | nothing changed |
| 2 | Baselines with the old bridge: `fkb jank` idle and mid-game; `pbctl loopback` (its round trip) | numbers written down as `<fps>` and `<rtt>` | |
| 3 | Install (stage 2), home-candidate check | unchanged | `adb -s <serial> uninstall net.kckern.daylight.piano` |
| 4 | Stage 3 grants, including this app's device admin (Fully's stays active) | `dd lockdown` `adminActive: true` | revoke |
| 5 | Add this app to Fully's whitelist for the test (stage 4); start the Activity | page shows | restore the whitelist |
| 6 | `acc --active --fps-baseline <fps>` with the switches still off (reloads and briefly darkens the page; no probe note while `midi.enabled` is off) | no FAIL; `midi.status` and `speaker.status` say the switch is not active | |
| 7 | Stage 8 proofs: `dd update <apk-url> <sha256>` twice, `acc --only reboot --reboot` three times (ADB check after each), `acc --only payload.bad,crash --restart --kill --serve-bad-payload {laptop-address}:{port}` | lifeline 3 of 3; PASS | stop; Fully and the old bridge run the tablet |
| 8a | **Stop the old supervisor first.** Piano config: `bridge_supervisor.enabled: false`; **restart the backend**. Otherwise it sees the old bridge go down at step 8 and relaunches it through Fully, and two apps then hold the same BLE-MIDI link | backend logs `piano-bridge.supervisor.disabled` | set it back to `true`, restart the backend |
| 8 | **MIDI hand-over.** `pbctl forget` (the old bridge drops the link), then force-stop it: `adb -s <serial> shell am force-stop net.kckern.pianobridge`. `dd settings set midi.enabled true` | `acc --only midi --active --rtt-baseline <rtt>` PASS (echo within 10%; sends one probe note) | `dd settings set midi.enabled false`; start the old bridge (`fkb launch net.kckern.pianobridge`), `pbctl connect`; restore its config from step 1 if it was lost; set `bridge_supervisor.enabled` back and restart the backend |
| 9 | **Speaker hand-over.** `dd settings set speaker.enabled true` | `acc --only speaker` PASS; a key sounds from the speaker | `speaker.enabled false`; old bridge as in 8 |
| 10 | **Backend.** save the device control and volume blocks and original piano settings. Under `{backend-id}.content_control`, keep the host and set `provider: daylight-android`, `port: 8780` and `auth_ref: daylight-android`. Confirm the lifeline resolves to 8781 (default control port + 1); set `volume.provider: daylight-android`. Piano config: `bridge_provider: daylight-android` and `bridge_supervisor.enabled: true`, in the same edit. **Restart the backend** | backend logs `piano-bridge.supervisor.created` with `provider: daylight-android`; no `provider-mismatch`, no `no-token`; a piano power off turns the screen off and on again; a manual screen-off for 10 minutes sets `dd settings get power.wakeSuppressUntilSec` to that deadline (log store `piano-midi-wake.suppress-relayed`), a key press in that time leaves the screen dark, and waking it from the admin console sets it back to 0 | restore the saved control and volume blocks (including Fully port and auth reference) and piano bridge/supervisor settings, restart the backend |
| 11 | Log store name, if chosen: `dd settings set logstore.app daylight-piano` | new lines under `daylight-piano` | `dd settings reset logstore.app` |
| 12 | Home and lockdown: allowlists from step 1 (stage 10 step 1); exit PIN; `dd lockdown home on`; `adb -s <serial> shell cmd package set-home-activity net.kckern.daylight.piano/net.kckern.daylight.cap.lockdown.shell.KioskHome`; force-stop Fully; `dd settings set lockdown.enabled true` | `locked: true`, `mode: app`, `homeIsKiosk: true` | stage 11 |
| 13 | `acc --active --fps-baseline <fps> --rtt-baseline <rtt>`, then each MANUAL line: escapes, touch and the PIN prompt, synth audible on the speaker and no sound when the speaker is off, a pairing started from the page keeps Android's dialog in front, five minutes without WiFi | no FAIL | stage 11 |
| 14 | Device owner, only with the owner's go-ahead: remove the Google account in Settings, `adb -s <serial> shell dpm set-device-owner net.kckern.daylight.piano/net.kckern.daylight.cap.lockdown.shell.DaylightAdminReceiver`, re-add the account; `dd lockdown owner resume` | `deviceOwner: true`, `mode: owner` | the app has no route that gives ownership up: `dd lockdown owner release` undoes every owner policy, and removing ownership itself takes a factory reset. If `set-device-owner` is refused, stay in `app` mode and record why |
| 15 | `acc --only reboot --reboot` with lockdown on (ADB check after); then `acc --only logstore --log-store {log-store-url}` | PASS | stage 11 |
| 16 | The next day: make it permanent (stage 10 step 12). In `devices/piano.yml`: `cutover: done`, `lockdown.enabled` and `lockdown.required` `true`, `midi.enabled`, `speaker.enabled` `true`, `logstore.app` as chosen | `required: true`; `node --test tools/roadmap-capabilities.test.mjs` passes | `dd update` with `required: false` |

Rollback for the backend alone (stage 11 step 8 on this tablet): set the
devices.yml entry back to `fully-kiosk`, remove `bridge_provider`, and set
`bridge_supervisor.enabled: false`, then restart the backend. Start the old
bridge and check it (`pbctl status`), then turn the supervisor back on and
restart the backend again. The supervisor refuses `daylight-android` while the
device says `fully-kiosk`, and must not watch the old bridge before it runs.

## The soak: two weeks

Starts the day step 16 is done. Fully and the old bridge stay installed and stopped.

Watched daily, read-only:

- `acc --only core,midi.status,speaker,kiosk.status,debug.fps --fps-baseline <fps> --log-store {log-store-url} --log-window 24h`: no FAIL.
- The log store: the supervisor's module (`context.module:piano-bridge-supervisor`)
  has no `relaunch` and no down alert; heartbeats with `linkVerdict` `VERIFIED`;
  no `piano-wake-hold.resync-failed`.
- Lessons: notes, credit, games and the screensaver behave as before; the tablet
  does not run hot (fps drops are the first sign).

The soak restarts on any rollback, or any recovery that needed the lifeline or
ADB. Fourteen clean days and the tablet is done; phase 8 waits for all three devices.

### Lesson transport check during the approved piano sitting

With the legacy bridge stopped, open a lesson on the trusted piano page. Play and release real keys and the sustain pedal. Confirm the lesson grades each note once. Play scheduled score notes, change instrument voice and apply a SysEx effect. Listen at the speaker and check the instrument echo verdict separately from accepted writes. Reconnect the instrument with a key previously held, then hold a new key manually. Confirm the old highlight clears and the new highlight lasts until release. Repeat after recreating the renderer. With the legacy bridge still stopped, use Repair in the lesson UI and record the reported recovery rung or failure verdict. Record results in the private sitting log.
