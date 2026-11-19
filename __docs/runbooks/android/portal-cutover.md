# Portal cutover: one sitting

**Nothing in this runbook has been run.** It is the Portal's path through
`kiosk-cutover.md` (the long form, stages 0 to 11) as one supervised sitting,
with the acceptance runner doing the checking. Where a step says "stage N", the
long form has the detail; the way back from any step is that file's first
section, "If the kiosk is dark or unreachable".

What is special about the Portal: Android 9 (API 28), and the old helper
`net.kckern.portalkeys` is **device owner**. Ownership moves to this app with
`DevicePolicyManager.transferOwnership`, built into both apps and never run on
this firmware.

**A USB cable to the Portal is required for the whole sitting.** ADB over WiFi
does not survive a Portal reboot, and the rollback (stage 11) needs ADB: the home
preference, force-stops and the accessibility list. After every reboot (steps 9,
14 and 16), reconnect over USB and run `adb -s <usb-serial> tcpip 5555`, then
`adb connect {device-address}:5555`. Without the cable, stop before step 9.
The home switch itself needs no ADB on this device: as owner, this app sets the
persistent home preference (`dd lockdown owner resume`), which survives reboots.

## Placeholders

| Placeholder | Meaning |
|---|---|
| `dd` | `node cli/daylight-device.cli.mjs portal` |
| `acc` | `node cli/daylight-acceptance.cli.mjs portal` |
| `pkctl` | `node _extensions/portal-keys/pkctl.mjs`, pointed at the Portal |
| `fkb` | `node cli/fkb.cli.mjs`, pointed at the Portal |
| `<serial>` | `{device-address}:5555`; `<usb-serial>` is the cable's serial from `adb devices` |
| `{log-store-url}` | the log store's base URL (`CLAUDE.local.md`) |
| `{laptop-address}:{port}` | this machine's LAN address and a free port, for `--serve-bad-payload` |
| `<pk-receiver>` | `net.kckern.portalkeys/net.kckern.portalkeys.PortalAdminReceiver` |

Set `DAYLIGHT_ANDROID_TOKENS` to the private tokens file before `dd` or `acc`.

**What `acc` does to the device.** A plain `acc` only reads (GETs, plus one LogsQL
query with `--log-store`). `--active` also reloads the page, loads the start URL,
tries a foreign URL (refused), foregrounds the kiosk, resets the renderer, shows a
message for a moment, turns the screen off for about two seconds and back, writes
the volume back at its level, runs `6*7` in the page and `id` through exec
(refused while exec is off). `--restart` restarts the payload (page and helpers
drop for a few seconds). `--kill`, `--reboot` and the bad-payload options do what
they name. Each SKIP line says which flag it needs.

**Backend changes take a restart.** The device adapters are built once when the
backend starts; a config reload does not switch them. Every "restart the backend"
below means restarting the prod container, as in a deploy.

## Before the sitting (no device contact)

- [ ] The seams branch is deployed (backend adapters); the Portal's backend entry
      still says `provider: fully-kiosk`.
- [ ] `./gradlew build --rerun-tasks`; `node tools/verify-build.mjs portal --legacy`: one `✓` line.
- [ ] `acc --list` prints the checks. `node --test` of `_extensions/daylight-android/cli/*.test.mjs` passes.
- [ ] The owner has approved the helper upgrade and transfer rehearsal,
      chosen the exit PIN and arranged supervision through recovery.
- [ ] Build and test the legacy Portal Keys helper following its README. Record
      the exact approved APK and payload SHA-256 digests and signer certificate
      fingerprint in the private sitting record. The candidate is shell
      `versionCode 36` with payload `p10-ordered-owner-transfer`. Run
      `bash verify-cutover-apk.sh <helper-apk> <android-build-tools-dir>` from
      `_extensions/portal-keys/app` on that APK. Confirm the standalone payload
      digest matches the baked payload digest. The checks cover receiving
      `support-transfer-ownership`, the protocol 2 lockdown revision ACK, and
      the payload's outgoing transfer operation. The JVM tests exercise stale
      release rejection before and after a payload rollback.

At the USB sitting, record the installed helper version and pull its base APK
using `adb -s <usb-serial> shell pm path net.kckern.portalkeys` and
`adb -s <usb-serial> pull <installed-base-apk-path> <private-installed-apk>`.
Repeat the packaging check with `<private-installed-apk>` as the third
argument to verify certificate continuity. Confirm both printed artifact
digests equal the approved values and that the approved versionCode exceeds the
installed version before the first replacement. If the approved shell is
already installed, verify the installed APK digest and signer against the
approved record. Stop on any mismatch or when the installed version is newer.

## The sitting

Mark each line `ok <time>`, or write what was seen. A **no-go** line stops the
sitting at that step; record the observed owner and recovery outcome before leaving the panel.

| # | Do | Go when | No-go: rollback |
|---|---|---|---|
| 1 | Connect the USB cable. Stage 1 backups: `pkctl config`, `pkctl hid status` (the USB allowlist), `fkb get > {private-notes}/fully-portal.json`, `fkb get kioskAppWhitelist`, HOME resolution, `adb -s <serial> shell settings get secure enabled_accessibility_services`, `adb -s <serial> shell dumpsys device_policy \| head -40` | all saved outside the repo | nothing changed |
| 2 | With the owner's approval and after the digest and signer checks above, run `adb -s <usb-serial> install -r <helper-apk>` if needed. An APK upgrade preserves the active payload. Activate the approved bytes with `pkctl payload <jar-url> <approved-payload-sha256>` and record the result. On a repeat sitting, the prior verified activation can be reused if the active file and payload version still match the recorded result. | `pkctl shell` reports versionCode 36. `pkctl payload` reports `activeVersion: p10-ordered-owner-transfer` and the active file from the digest-verified swap. Verify the protocol 2 ACK on the existing safety path with the approved short Stop check from the helper README. | Stop the rehearsal. If the payload swap caused a regression, `pkctl rollback` and confirm the helper is still owner and serving lockdown. Keep the installed shell and preserve the private evidence. |
| 3 | Install this app (stage 2) and run the home-candidate check | HOME resolution and candidate list unchanged | `adb -s <serial> uninstall net.kckern.daylight.portal` |
| 4 | Stage 3 grants; the keep-alive broadcast (stage 4) | `dd lifeline status` answers | `adb -s <serial> shell am force-stop net.kckern.daylight.portal`; revoke |
| 5 | `acc` (read-only) | no FAIL except the page checks: lock task allows only Fully, so `kiosk.status` may fail here | force-stop the app |
| 6 | **Transfer out (rehearsal).** `pkctl transfer-owner`. **From here to step 8 the Portal is unlocked:** portal-keys has released lock task, the status bar, its restrictions and its hidden packages, and this app applies nothing. Someone stays at the Portal and nobody else uses it | `transferred: true`; `dd lockdown`: `deviceOwner: true`, `mode: app`, `ownerHold` set; Fully still home | Stop permanent transfer and lockdown. Follow the ownership recovery below. |
| 7 | Start the kiosk Activity (stage 4). `acc --active` (reloads, foregrounds and briefly darkens the page, as above) | no FAIL; MANUAL lines read "lockdown is off" | `dd settings reset` anything changed |
| 8 | **Transfer back (rehearsal).** `dd settings set lockdown.ownerTransferTarget <pk-receiver>`; `dd lockdown owner transfer <pk-receiver>`; `dd settings reset lockdown.ownerTransferTarget`; `pkctl resume-policy`; `pkctl kiosk-verify` | portal-keys is owner, its kiosk verifies, Fully pinned again | Stop permanent transfer and lockdown. Follow the ownership recovery below. |
| 9 | Stage 8 proofs. `dd update <apk-url> <sha256>` twice with a bumped versionCode; then `acc --only reboot --reboot` three times. After each reboot: USB, `adb -s <usb-serial> tcpip 5555` | lifeline back 3 of 3 | stop here; Fully runs the Portal |
| 10 | `acc --only payload.bad,crash --restart --kill --serve-bad-payload {laptop-address}:{port}` (pushes a file that is not a payload; restarts the payload; kills the app's process with exec turned on and put back) | `payload.bad` and `crash.*` PASS | Check lifeline status and follow the primary runbook’s payload recovery procedure. |
| 11 | Stage 10 steps 1 and 2: `lockdown.allowedApps` and `launcher.allowed` from step 1's whitelist; `dd settings set lockdown.exitPin <pin>`. Save the current control and volume blocks. In `content_control`, keep the host and set `provider: daylight-android`, `port: 8780` and `auth_ref: daylight-android`; set `volume.provider: daylight-android`, then **restart the backend** | `dd lockdown` shows the lists, no `allowedAppsError`; after the restart the admin console reaches the app | restore the saved control and volume blocks including the Fully port and auth reference, restart the backend |
| 12 | Hand the hardware over, one switch at a time: `hid.enabled`, `volumeKeys.enabled`, `presence.enabled` (stop portal-keys' use of each first) | `dd status` each `active: true`, and the part works (a USB key, a volume key, a presence report) | `dd settings set <key> false`; restart portal-keys |
| 13 | After a verified forward and return rehearsal, transfer out for good: `pkctl transfer-owner`. `dd lockdown home on`. Force-stop Fully and portal-keys: `adb -s <serial> shell am force-stop de.ozerov.fully`, the same for `net.kckern.portalkeys` | `homeAlias: enabled` | stage 11 |
| 14 | `dd settings set lockdown.enabled true`; `dd lockdown owner resume` (applies owner policy: lock task, the persistent home preference, restrictions) | `dd lockdown`: `locked: true`, `mode: owner`, `lockTaskActive: true`, `homeIsKiosk: true`; Home shows the kiosk | stage 11 |
| 15 | `acc --active`, then walk every MANUAL line: Home, Recents, status bar, Control Center swipe, power menu, volume keys, double volume-down, touch and the seven-tap PIN prompt, five minutes without WiFi | no FAIL; each escape recalled within about 2 s | stage 11 |
| 16 | Only now: `acc --only reboot --reboot` with lockdown on, no touch. Then USB and `tcpip 5555` again | PASS; page shows; `locked: true` | first section of `kiosk-cutover.md` (lifeline `owner-release`) |
| 17 | After an hour: `acc --only logstore --log-store {log-store-url}` | events under `context.app:"daylight-portal"` | n/a |
| 18 | The next day: stage 10 step 12. In `devices/portal.yml`: `cutover: done`, `lockdown.enabled` and `lockdown.required` `true`, the switches `true`, the allowlists as defaults. Complete the [permanent build qualification](kiosk-cutover.md#permanent-build-qualification). | Exact installed bytes pass the post-install workflow and cold-boot checks. Record approval and results. | Hold the soak and use the documented reversible recovery. |

A failed, refused or ambiguous rehearsal in either direction is a no-go.
Record the actual current owner using Android device policy and the Daylight
owner status. If portal-keys owns the panel, resume its policy and verify Fully
is pinned. If Daylight owns it, keep the hold and lockdown off and supervise
the approved return to the old owner. If the return fails or ownership is
unclear, keep both apps installed, preserve USB access and supervise the panel.
Permanent transfer and lockdown require a successful rehearsed return with
portal-keys policy and Fully HOME verified. Repeat a failed rehearsal at a
separately approved sitting.

Record the two transfer results and firmware build in the long form's Record table.

After the provider change and backend restart, verify a Portal stop, retry and
release through supervision. Confirm the returned input state and command
revision, and check that volume presses are suppressed while stopped. The
shutdown reconciler uses the same provider for timed stops. If rolling back,
restore the saved Fully provider, port, auth reference and volume block, and restart the backend before verifying the legacy
PUT. When a historical helper payload is restored, only the shell on
`:8771` is authoritative for lockdown. Transfer on `:8773` is unavailable
until the approved p10 payload is active again.

## The soak: two weeks

Starts after step 18's newly qualified permanent build passes its recorded post-install checks. Fully and portal-keys stay installed and stopped.

Watched, once a day (a minute each), read-only:

- `acc --only core,lockdown.status,kiosk.status --log-store {log-store-url} --log-window 24h`:
  no FAIL; `recallsSinceBoot` small and each `lastRecall` explainable.
- The log store: heartbeats under `daylight-portal` with no gap over 10 minutes
  (`context.app:"daylight-portal" AND _time:24h | stats by (_msg) count()`).
- Household reports: the school page, volume keys, the USB keyboard, the screen
  waking.

The soak restarts on any rollback to Fully, or any recovery that needed the
lifeline or ADB. After 14 days with neither, the Portal is done; when the piano
tablet and the Shield are also done, phase 8 (cleanup) may start. Its deletion
list and order are in the phases 4 to 6 plan (ops docs).
