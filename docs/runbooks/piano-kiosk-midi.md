# Runbook — piano kiosk MIDI (the one-way outage)

**Symptom that brings you here:** keys light up on the kiosk screen, but the piano
makes no sound from voice changes, the on-screen keyboard, or score playback.
MIDI is one-way: IN works, OUT is dead.

Recurred 2026-08-22, 2026-08-23, 2026-08-26. Each time the diagnosis stalled
because **every layer reports success**. Read §2 before trusting any signal.

---

## 0. The only question that matters

> Did the **piano** echo our probe?

The APK sends an inaudible probe note (C#-1, velocity 1) once per heartbeat and
waits for the MDG-400 to echo it. The piano is the only witness downstream of every
component that can lie.

```bash
node cli/piano-midi-e2e.cli.mjs        # reads the loopback verdict; exit 0 = healthy
curl -s http://{tablet}:8770/loopback  # the raw verdict
```

`outVerified: true` → OUT works, right now. `outVerified: false` with
`lastEchoAgoMs: -1` → it has **never** worked this process lifetime.

⚠️ **`ble.in` is cumulative.** Before 2026-08-26 this CLI thresholded that lifetime
counter at zero, so a counter frozen 19 hours earlier still printed
`VERDICT: healthy (both directions)` — during the exact outage it was written to
catch. Any signal that cannot go false while the fault is present is not a health
check. Use the echo.

---

## 1. Triage ladder — stop at the first false

| # | Check | Command | Healthy |
|---|---|---|---|
| 1 | Piano powered + on USB | `curl -s --compressed http://{jamcorder}/api/device-state/get \| grep -o '"usbState".\{0,200\}'` | `MG-300 Grand Piano`, `isOutTaskRunning: true` |
| 2 | JamCorder routing | `curl -s http://{jamcorder}/api/midi-io/settings/get` | `bleToDin: true`, `bleToUsb: true`, `filtering: false` |
| 3 | Tablet↔JamCorder BLE up | `curl -s http://{tablet}:8770/status` | `ble.state: CONNECTED` |
| 4 | **The piano echoes** | `curl -s http://{tablet}:8770/loopback` | `outVerified: true` |
| 5 | Far-end receipt climbs | `node cli/piano-midi-e2e.cli.mjs --send` | `ble.in` **delta** > 0 |

Checks 1–3 were green during every outage so far. They are necessary, never
sufficient.

---

## 2. What each layer can actually prove

| Signal | Proves | Does NOT prove |
|---|---|---|
| `pbctl status` → `CONNECTED` | A GATT link exists | That writes traverse it |
| `midiWrite.open: true` | Android handed us a port object | That the port reaches the air |
| `dumpsys midi` → `mInputPortOpen=[true]` | The framework thinks a writer exists | Anything about delivery |
| Web MIDI `port.state: connected` | The browser's opinion of its own link | Delivery (wrong for hours on 08-22) |
| Bridge `/midi/send` → `200 {"ok":true}` | The APK accepted the bytes | Delivery — it is fire-and-forget |
| `ble.in` **cumulative** | Something arrived once | That anything arrives now |
| `ble.in` **delta** | Bytes crossed the BLE hop | That the piano acted on them |
| **loopback `outVerified`** | **The piano's CPU received it** | That it was audible (volume, local control) |

**Rule:** never derive a link's health from the subsystem that owns it.

---

## 3. The asymmetry is the sharpest clue

IN working while OUT is dead is not noise. All three flows share ONE characteristic
on ONE GATT connection and differ only in ATT mechanism:

| Flow | ATT mechanism | 2026-08-26 |
|---|---|---|
| IN (piano → screen) | Notification — the JamCorder's transmit | **works** |
| Subscribe | Write **Request** — acked, retried, flow-controlled | **works** |
| MIDI OUT | Write **Command** — no ack, no error path | **dead** |

What that rules out with no further testing:

- **Not a stale/wrong handle.** Notifications route by handle against the same cache
  the CCCD write used. A shifted cache breaks IN too.
- **Not a security/bond mismatch.** Subscribing *is* a write. If writes were rejected
  for insufficient authentication there would be no subscription — and there is one.
- **It is Write-Command-specific**, i.e. the tablet's BLE *transmit* path: the one
  mechanism with no acknowledgement and no error path back to the app.

---

## 4. Root cause (2026-08-26) — two GATT clients, one queue

Android exposes **one `BluetoothGatt`** for `jam-7e6`, shared by the piano-bridge APK
and Chromium's Web MIDI, and it permits **one outstanding GATT operation at a time**.

When the kiosk page re-acquires Web MIDI while the BLE link is rebuilding, its
operation stalls and blocks the queue behind it. Every ATT Write Command — all MIDI
OUT — is silently discarded. Notifications keep flowing because inbound data never
touches that queue. Hence one-way.

**The tell: MTU pinned at 23.** Android requests a larger MTU on every fresh BLE MIDI
connection. A pinned 23 means that request never completed — the queue is stuck.
Check it with `curl -s http://{jamcorder}/api/bluetooth/state/get`.

This is why the failure survived everything: reconnects, a radio bounce, a JamCorder
reboot, a WebView restart, and a **full tablet reboot** — because the kiosk page
re-creates the wedge within seconds of every boot.

### The cure

Quiesce the browser, *then* rebuild the link. Order is the whole trick.

```bash
PW=<fkb password>                      # data/household/auth/fullykiosk.yml
# 1. park the WebView so it holds no Web MIDI
curl -s "http://{tablet}:2323/?cmd=loadUrl&password=$PW&type=json&url=about%3Ablank"
sleep 10
# 2. NOW bounce the link — the same rung that fails while the page is live
curl -s -X POST http://{tablet}:8770/reset
# 3. bring the kiosk back
curl -s "http://{tablet}:2323/?cmd=loadStartUrl&password=$PW&type=json"
# 4. verify
curl -s http://{tablet}:8770/loopback
```

Measured 2026-08-26: step 2 returned `{"fixed":true,"recoveredAt":"L2",
"linkVerdict":"VERIFIED"}` — the identical `/reset` had returned
`"STILL DOWN after radio bounce — likely physical"` three times earlier that day
with the page live. `ble.in` +12, echo at 30ms. OUT survived the kiosk reload.

**Do not trust `/reset`'s "likely physical (JamCorder/USB/piano power)" verdict.**
That string is a guess baked into the endpoint. It is what sent this investigation
downstream into a JamCorder reboot, a speaker teardown, and a tablet reboot — none
of which were the problem.

---

## 5. Reading the history

The APK heartbeat already carries the verdict, once a minute.

```bash
# When did OUT last work?
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query=context.app:piano-bridge AND "data.linkVerdict":VERIFIED AND _time:7d | sort by (_time desc) | limit 1'

# Chronic or new?
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query=context.app:piano-bridge AND _time:7d | stats by ("data.linkVerdict") count() as n'
```

Fields: `data.linkVerdict` (`VERIFIED`/`ZOMBIE`/`DOWN`), `data.outVerified`,
`data.loopMisses`, `data.loopRttMs`, `data.bleUptimeS`, `data.bleReconnects`.

**`ZOMBIE` = BLE says CONNECTED and the piano never echoed.** That is the outage,
named, in every heartbeat. Nothing alerts on it.

### Two LogsQL traps that cost real time

- **`-d 'limit=N'` truncates BEFORE the `| sort by (_time)` pipe** — you get an
  arbitrary N rows and then sort them, not the newest N. Put the limit inside the
  pipe: `| sort by (_time desc) | limit 120`.
- Quote dotted field names in `by (...)`: `by ("data.linkVerdict")`.

---

## 6. Confirmed history

| Date | Root cause | Cured by |
|---|---|---|
| 2026-08-22 | Web MIDI output handle went zombie; watchdog guarded on conditions that were false | `resetLink()` auto-escalation |
| 2026-08-23 | Same, one layer down — sends moved to the APK bridge path | `forceResetLink` (L2 radio bounce) |
| 2026-08-26 | **Chromium's Web MIDI wedging the shared Android GATT queue** | quiesce browser → L2 → reload (§4) |

**2026-08-26 timeline.** Last `VERIFIED` beat `2026-08-25T17:49:28Z` (RTT 38ms);
`ZOMBIE` from `17:51:30` **on the same unbroken GATT connection** (`bleUptimeS` kept
climbing, `bleReconnects` unchanged) — the link never dropped, writes just stopped
landing. 1,148 probes / 0 echoes over 19h.

**Ruled out by test, in order** — every one of these returned `ble.in` delta 0:
`/connect` ×104 · `/reset` with the page live · JamCorder reboot · FKB `restartApp` ·
**full tablet reboot** · removing `speakerMac` to stop a 3,781-reconnect A2DP loop.
Ruled out by logic: stale GATT handle cache, and bond/security permission (§3).

The A2DP theory was the strongest fit and still died: BR/EDR paging starving BLE TX
would explain a Write-Command-only failure exactly, but stopping the loop
(`reconnects: 0`) changed nothing.

---

## 7. Fixed in code (2026-08-26)

1. **The browser no longer touches Web MIDI when the bridge owns OUT.**
   `useWebMidiBLE` skips `requestMIDIAccess()` entirely in bridge mode and
   *relinquishes* any ports grabbed during the boot race (`bridgeOwnsOut` /
   `relinquishWebMidi`). This removes the second GATT client — the root cause, not
   another recovery rung — and makes §4's manual quiesce unnecessary.
   Covered by `useWebMidiBLE.bridgeOwnsOut.test.js`.
2. **The escalation ladder re-arms on continued failure.** `episodeEscalated` was a
   one-shot boolean cleared only by an echo, so with no echo the strong rung fired
   once per process lifetime and degraded permanently to `connectNow()` every 10 min
   — 104 useless kicks over 19 hours. Now exponential backoff (0, 30m, 1h, 2h, 4h
   cap) that never abandons the rung. `Loopback.escalationBackoffMs()`.
   **Requires an APK payload build + `pbctl payload` deploy — NOT yet deployed.**
3. **`bridgeOutUp()` reads the body it already fetched.** `outVerified` is surfaced
   as `bridgeOutVerified()` and logged (`bridge-out.unverified`). It deliberately
   does **not** gate routing: falling back to Web MIDI on an unverified link would
   re-create the second GATT client at the worst possible moment.
4. **The e2e CLI uses the loopback echo**, not a lifetime counter thresholded at zero.

## 8. Still open

- **Nothing alerts.** `linkVerdict: ZOMBIE` sat in every heartbeat for 19 hours,
  fully observable and entirely unobserved. Schedule
  `node cli/piano-midi-e2e.cli.mjs` (exits non-zero when unhealthy).
- **Chromium leaks MIDI device connections.** Observed 9 listeners / 6 device
  connections to a one-device list, same device listed twice; an FKB `restartApp`
  does not free them (same PID). Fix 7.1 avoids creating them on the kiosk, but the
  leak itself remains for any page that does use Web MIDI.
- **Heartbeats ship lossily** — `data.beatFailures.logStore: 271`,
  `IOException: unexpected end of stream`. Gaps are the shipper, not the device.
- **The A2DP speaker reconnect loop** (3,781 reconnects, attempt every ~3s) is real
  and unexplained. Not this bug, but worth its own look.
- **Bridge config corruption** — literal `{"tapX": "200"}` keys from the old
  config-clobber bug; `tapX/tapY/tapLen/tapDurationMs` now read `3/6/34/20` where the
  corrupt keys held `200/420/400/250`. Corrupt keys dropped 2026-08-26; the values
  were left alone.

---

## 9. Reference

- Tablet (kiosk): `10.0.0.245` — bridge API `:8770`, FKB REST `:2323`
- JamCorder (`jam-7e6`): web `10.0.0.243` (**DHCP — it drifts**), BLE `10:65:36:36:62:66`
- Piano: Roland MDG-400 / `MG-300 Grand Piano` on JamCorder USB
- Path IN:  piano →USB→ JamCorder →BLE→ APK →WebSocket→ browser
- Path OUT: browser →HTTP→ APK →BLE→ JamCorder →USB/DIN→ piano
- FKB sets `mdmDisableADB: true`, so ADB is refused until flipped via `setBooleanSetting`
- Prior investigation: `docs/_wip/bugs/2026-08-22-piano-midi-one-way-outage.md`
