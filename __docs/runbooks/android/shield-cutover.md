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
first, and the sitting stops if it fails.

## Placeholders

| Placeholder | Meaning |
|---|---|
| `dd` | `node cli/daylight-device.cli.mjs shield` |
| `acc` | `node cli/daylight-acceptance.cli.mjs shield` |
| `fkb` | `node cli/fkb.cli.mjs`, pointed at the Shield |
| `<serial>` | `{device-address}:5555` |
| `{backend-id}` | the Shield's id in the backend's devices.yml |
| `{log-store-url}` | the log store's base URL (`CLAUDE.local.md`) |

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
| 4 | **Microphone first.** Stop audio-bridge (`am force-stop net.kckern.audiobridge`); `dd settings set mic.enabled true`; open the call page | `acc --only mic` PASS with `lastError: null` and `heldByOther: false` | `mic.enabled false`; start audio-bridge. **Stop the sitting** and record `lastError`, `lastErrorDetail` |
| 5 | A Home Line call from a phone, five minutes, both ways | heard and seen both ways | as step 4 |
| 6 | `acc --launch com.retroarch.aarch64` | no FAIL; `launch.app` sees the emulator in front and the kiosk returns | `dd foreground` |
| 7 | Stage 8 proofs: `dd update` twice (confirm on the TV each time); `acc --only reboot --reboot --reboot-wait 600` three times, power-cycling by hand when it says so; `acc --only payload.bad,crash --kill --serve-bad-payload {laptop-address}:{port}` | lifeline back 3 of 3; the mic comes back after each reboot with no one touching it (`acc --only mic`) | stop; Fully and audio-bridge run the Shield |
| 8 | Backend: `{backend-id}` `content_control.provider: daylight-android`, `auth_ref: daylight-android`, volume provider; reload | the admin console and a play from the menu reach the app; `prepareForContent` logs no mic restart loop | back to `fully-kiosk`, reload |
| 9 | Home and lockdown: `launcher.allowed` and `lockdown.allowedApps` from step 1; `dd lockdown home on`; `set-home-activity`; force-stop Fully; `dd settings set lockdown.enabled true` | `locked: true`, `mode: app`, `homeIsKiosk: true` | stage 11 |
| 10 | `acc --launch com.retroarch.aarch64`, all groups; then the MANUAL lines: Home, Recents, the assistant button, the remote's D-pad, select, back and play/pause against the `fkb.keyCapture` audit, controller pairing from the Controllers screen | no FAIL; each escape recalled | stage 11 |
| 11 | Only with the lease provisioned: `dd settings set lease.endpoint …`, `lease.packageName …`, `lease.credential …`, then `lease.enabled true` | `acc --only lease` reads `configured true, ready true`; no lease: the game is recalled; with a lease: it runs | `dd settings set lease.enabled false` |
| 12 | `acc --only reboot --reboot --reboot-wait 600` with lockdown on (power-cycle by hand); `acc --only logstore --log-store {log-store-url}` | PASS; page shows; mic running | stage 11 |
| 13 | The next day: make it permanent (stage 10 step 12) with `mic.enabled` (and `lease.enabled` if provisioned) `true` in `devices/shield.yml` | `required: true` | an update with `required: false`, confirmed on the TV |

## The soak: two weeks

Starts the day step 13 is done. Fully and audio-bridge stay installed and stopped.

Watched daily:

- `acc --only core,mic,kiosk.status,lockdown.status --log-store {log-store-url} --log-window 24h`: no FAIL.
- The log store under `daylight-shield`: no `capture_denied`, no mic restart loop
  in the backend (`daylightandroid.prepareForContent.micRestarted`).
- Calls, the media menu, the arcade (launch, the countdown overlay, return).

The soak restarts on any rollback or any recovery that needed the lifeline or
ADB. When all three devices have had fourteen clean days, phase 8 starts; its
deletion list and order are in the phases 4 to 6 plan (ops docs).
