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

## Placeholders

| Placeholder | Meaning |
|---|---|
| `dd` | `node cli/daylight-device.cli.mjs piano` |
| `acc` | `node cli/daylight-acceptance.cli.mjs piano` |
| `pbctl` | `node _extensions/piano-bridge/pbctl.mjs`, pointed at the tablet |
| `fkb` | `node cli/fkb.cli.mjs`, pointed at the tablet |
| `<serial>` | `{device-address}:5555` |
| `{backend-id}` | the tablet's id in the backend's devices.yml |
| `{log-store-url}` | the log store's base URL (`CLAUDE.local.md`) |

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
| 1 | Backups: `pbctl config > {private-notes}/piano-bridge-config.json` (all of `GET /config`), `fkb get`, `fkb get kioskAppWhitelist`, HOME resolution, the accessibility list, `dumpsys device_policy` | saved | nothing changed |
| 2 | Baselines with the old bridge: `fkb jank` idle and mid-game; the old bridge's loopback round trip (`GET /loopback` on its port) | numbers written down as `<fps>` and `<rtt>` | |
| 3 | Install (stage 2), home-candidate check | unchanged | `adb -s <serial> uninstall net.kckern.daylight.piano` |
| 4 | Stage 3 grants, including this app's device admin (Fully's stays active) | `dd lockdown` `adminActive: true` | revoke |
| 5 | Add this app to Fully's whitelist for the test (stage 4); start the Activity | page shows | restore the whitelist |
| 6 | `acc --fps-baseline <fps>` with the switches still off | no FAIL; `midi.status` and `speaker.status` say the switch is off | |
| 7 | Stage 8 proofs: `dd update` twice, `acc --only reboot --reboot` three times, `acc --only payload.bad,crash --kill --serve-bad-payload {laptop-address}:{port}` | lifeline 3 of 3; PASS | stop; Fully and the old bridge run the tablet |
| 8 | **MIDI hand-over.** Stop the old bridge (`pbctl` disconnect, then force-stop). `dd settings set midi.enabled true` | `acc --only midi --rtt-baseline <rtt>` PASS (echo within 10%) | `midi.enabled false`; start the old bridge; restore its config from step 1 if it was lost |
| 9 | **Speaker hand-over.** `dd settings set speaker.enabled true` | `acc --only speaker` PASS; a key sounds from the speaker | `speaker.enabled false`; old bridge as in 8 |
| 10 | **Backend.** devices.yml `{backend-id}`: `content_control.provider: daylight-android`, `auth_ref: daylight-android`, `volume.provider: daylight-android`. Piano config: `bridge_provider: daylight-android`. Reload | backend logs `piano-bridge.supervisor.created` with `provider: daylight-android`; no `provider-mismatch`, no `no-token`; a piano power off turns the screen off and on again | both keys back, reload |
| 11 | Log store name, if chosen: `dd settings set logstore.app daylight-piano` | new lines under `daylight-piano` | `dd settings reset logstore.app` |
| 12 | Home and lockdown: allowlists from step 1 (stage 10 step 1); exit PIN; `dd lockdown home on`; `set-home-activity`; force-stop Fully; `dd settings set lockdown.enabled true` | `locked: true`, `mode: app`, `homeIsKiosk: true` | stage 11 |
| 13 | `acc --fps-baseline <fps> --rtt-baseline <rtt>`, all groups, then each MANUAL line: escapes, touch and the PIN prompt, synth audible on the speaker and no sound when the speaker is off, a pairing started from the page keeps Android's dialog in front, five minutes without WiFi | no FAIL | stage 11 |
| 14 | Device owner, only with the owner's go-ahead: remove the Google account in Settings, `adb -s <serial> shell dpm set-device-owner net.kckern.daylight.piano/net.kckern.daylight.cap.lockdown.shell.DaylightAdminReceiver`, re-add the account; `dd lockdown owner resume` | `deviceOwner: true`, `mode: owner` | the app has no route that gives ownership up: `dd lockdown owner release` undoes every owner policy, and removing ownership itself takes a factory reset. If `set-device-owner` is refused, stay in `app` mode and record why |
| 15 | `acc --only reboot --reboot` with lockdown on; then `acc --only logstore --log-store {log-store-url}` | PASS | stage 11 |
| 16 | The next day: make it permanent (stage 10 step 12) with `midi.enabled`, `speaker.enabled` `true` and `logstore.app` as chosen in `devices/piano.yml` | `required: true` | `dd update` with `required: false` |

Rollback for the backend alone (stage 11 step 8 on this tablet): remove
`bridge_provider` from the piano config and set the devices.yml entry back to
`fully-kiosk`, then reload. Both must go back together: the supervisor refuses
`daylight-android` while the device says `fully-kiosk`, and the old bridge must
be running again before the backend watches it.

## The soak: two weeks

Starts the day step 16 is done. Fully and the old bridge stay installed and stopped.

Watched daily:

- `acc --only core,midi,speaker,kiosk.status,debug.fps --fps-baseline <fps> --log-store {log-store-url} --log-window 24h`: no FAIL.
- The log store: the supervisor's module (`context.module:piano-bridge-supervisor`)
  has no `relaunch` and no down alert; heartbeats with `linkVerdict` `VERIFIED`.
- Lessons: notes, credit, games and the screensaver behave as before; the tablet
  does not run hot (fps drops are the first sign).

The soak restarts on any rollback, or any recovery that needed the lifeline or
ADB. Fourteen clean days and the tablet is done; phase 8 waits for all three devices.
