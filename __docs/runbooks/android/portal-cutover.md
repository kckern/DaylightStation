# Portal cutover: one sitting

**Nothing in this runbook has been run.** It is the Portal's path through
`kiosk-cutover.md` (the long form, stages 0 to 11) as one supervised sitting,
with the acceptance runner doing the checking. Where a step says "stage N", the
long form has the detail; the way back from any step is that file's first
section, "If the kiosk is dark or unreachable".

What is special about the Portal: Android 9 (API 28), and the old helper
`net.kckern.portalkeys` is **device owner**. Ownership moves to this app with
`DevicePolicyManager.transferOwnership`, built into both apps and never run on
this firmware. ADB over WiFi does not survive a Portal reboot, so the lifeline
and `dd update` must be proven before any reboot with lockdown on.

## Placeholders

| Placeholder | Meaning |
|---|---|
| `dd` | `node cli/daylight-device.cli.mjs portal` |
| `acc` | `node cli/daylight-acceptance.cli.mjs portal` |
| `pkctl` | `node _extensions/portal-keys/pkctl.mjs`, pointed at the Portal |
| `fkb` | `node cli/fkb.cli.mjs`, pointed at the Portal |
| `<serial>` | `{device-address}:5555` |
| `{log-store-url}` | the log store's base URL (`CLAUDE.local.md`) |
| `{build-host}:{port}` | a machine on the LAN serving build outputs |
| `<pk-receiver>` | `net.kckern.portalkeys/net.kckern.portalkeys.PortalAdminReceiver` |

Set `DAYLIGHT_ANDROID_TOKENS` to the private tokens file before `dd` or `acc`.

## Before the sitting (no device contact)

- [ ] The seams branch is deployed (backend adapters); the Portal's backend entry
      still says `provider: fully-kiosk`.
- [ ] `./gradlew build --rerun-tasks`; `node tools/verify-build.mjs portal --legacy`: one `✓` line.
- [ ] `acc --list` prints the checks. `node --test` of `_extensions/daylight-android/cli/*.test.mjs` passes.
- [ ] The owner has decided: the exit PIN; what to do if a transfer is refused
      (cut over in `app` mode, or stop); whether to install portal-keys shell 34 first.
- [ ] A bad payload to push: `acc --serve-bad-payload {laptop-address}:{port}`
      generates and serves one, or serve any small non-payload file and pass its
      URL and sha256.

## The sitting

Mark each line `ok <time>`, or write what was seen. A **no-go** line stops the
sitting at that step; its **rollback** leaves the Portal as it was before it.

| # | Do | Go when | No-go: rollback |
|---|---|---|---|
| 1 | Stage 1 backups: `pkctl config` and USB allowlist, `fkb get > {private-notes}/fully-portal.json`, `fkb get kioskAppWhitelist`, HOME resolution, `settings get secure enabled_accessibility_services`, `dumpsys device_policy \| head -40` | all saved outside the repo | nothing changed |
| 2 | `pkctl shell` reads versionCode 34; `pkctl status` reads payload `p9-owner-transfer` or later. If the payload is older: `pkctl payload <jar-url> <sha256>` (no tap). If the shell is older and the way back is wanted: `adb -s <serial> install -r` portal-keys shell 34 | both read as required | `pkctl rollback` |
| 3 | Install this app (stage 2) and run the home-candidate check | HOME resolution and candidate list unchanged | `adb -s <serial> uninstall net.kckern.daylight.portal` |
| 4 | Stage 3 grants; the keep-alive broadcast (stage 4) | `dd lifeline status` answers | force-stop the app; revoke |
| 5 | `acc --only core,routes,settings,lifeline,payload,lockdown,debug.logcat,debug.exec,debug.log` | no FAIL. The page checks wait: lock task allows only Fully | force-stop the app |
| 6 | **Transfer out (rehearsal).** `pkctl transfer-owner` | `transferred: true`; `dd lockdown`: `deviceOwner: true`, `mode: app`, `ownerHold` set; Fully still home | refused: `pkctl resume-policy`, `pkctl kiosk-verify`; the owner's decision says whether to continue in `app` mode |
| 7 | Start the kiosk Activity (stage 4). `acc` | no FAIL; MANUAL lines read "lockdown is off" | `dd settings reset` anything changed |
| 8 | **Transfer back (rehearsal).** `dd settings set lockdown.ownerTransferTarget <pk-receiver>`; `dd lockdown owner transfer <pk-receiver>`; `dd settings reset lockdown.ownerTransferTarget`; `pkctl resume-policy`; `pkctl kiosk-verify` | portal-keys is owner and its kiosk verifies | refused: this app stays owner with nothing applied; `dd lockdown owner resume` if the owner chooses to stay |
| 9 | Stage 8 proofs. `dd update` twice with a bumped versionCode; then `acc --only reboot --reboot` three times | lifeline back 3 of 3; ADB does not come back (expected) | stop here; Fully runs the Portal |
| 10 | `acc --only payload.bad,crash --kill --serve-bad-payload {laptop-address}:{port}` | `payload.bad` and `crash.*` PASS | `dd payload rollback` |
| 11 | Stage 10 steps 1 to 3: `lockdown.allowedApps` and `launcher.allowed` from step 1's whitelist; `dd settings set lockdown.exitPin <pin>`; backend `provider: daylight-android`, `volume.provider: daylight-android`, reload | `dd lockdown` shows the lists, no `allowedAppsError`; the admin console reaches the app | backend back to `fully-kiosk`, reload |
| 12 | Hand the hardware over, one switch at a time: `hid.enabled`, `volumeKeys.enabled`, `presence.enabled` (stop portal-keys' use of each first) | `dd status` each `active: true`, and the part works (a USB key, a volume key, a presence report) | `dd settings set <key> false`; restart portal-keys |
| 13 | Transfer out for good: `pkctl transfer-owner`. `dd lockdown home on`; `adb -s <serial> shell cmd package set-home-activity net.kckern.daylight.portal/net.kckern.daylight.cap.lockdown.shell.KioskHome`; force-stop Fully and portal-keys | HOME resolves to the alias; Home shows the kiosk | stage 11 |
| 14 | `dd settings set lockdown.enabled true`; `dd lockdown owner resume` | `dd lockdown`: `locked: true`, `mode: owner`, `lockTaskActive: true` | stage 11 |
| 15 | `acc` again, all groups, and walk every MANUAL line: Home, Recents, status bar, Control Center swipe, power menu, volume keys, double volume-down, touch and the seven-tap PIN prompt, five minutes without WiFi | no FAIL; each escape recalled within about 2 s | stage 11 |
| 16 | Only now: `acc --only reboot --reboot` with lockdown on, no touch | PASS; page shows; `locked: true` | first section of `kiosk-cutover.md` (lifeline `owner-release`) |
| 17 | After an hour: `acc --only logstore --log-store {log-store-url}` | events under `context.app:"daylight-portal"` | n/a |
| 18 | The next day: stage 10 step 12 (`lockdown.required: true`, switches `true`, allowlists as defaults in `devices/portal.yml`; bump versionCode; `dd update`) | `dd lockdown` reads `required: true` | `dd update` with a build that says `required: false` |

Record the two transfer results and firmware build in the long form's Record table.

## The soak: two weeks

Starts the day step 18 is done. Fully and portal-keys stay installed and stopped.

Watched, once a day (a minute each):

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
