# Piano Kiosk — Out-of-process watchdog + heartbeat + self-heal ladder

**Date:** 2026-07-03
**Status:** implementing
**Trigger:** Reported "Fully Kiosk completely unusable — stuck, won't reload, won't respond."

## Incident diagnosis (live-confirmed 2026-07-03)

Probed the tablet directly:

| Probe | Result | Meaning |
|---|---|---|
| `ping 10.0.0.245` | 44 ms | tablet up |
| `:2323` FKB REST | HTTP 200 | Fully Kiosk alive |
| `:8770` bridge | **connection refused** | **piano-bridge APK was dead** |
| screenshot | SPA rendered, instrument dot RED | not a dead/error page; WS to bridge down |
| `fkb.cli jank` (reloads) | **61 fps** | a *fresh* page renders fine → not the hard-latch |

**Root cause of the user-visible failure: the bridge APK had died.** That produced two
symptoms at once, both of which read as "unusable" to a player:

1. **No sound / dead piano** — the bridge hosts the synth, owns BLE-MIDI, relays notes.
   Dead bridge ⇒ keys produce nothing.
2. **UI frame-throttle decay** — `TouchPulser` (in the bridge) is the only working lever
   against the SM-T590 OS input-recency throttle (BLE-MIDI is not "touch"). Dead bridge ⇒
   the WebView decays to ~8 fps, feels frozen and reload-resistant, even though a forced
   reload restores 61 fps ("fresh page lies" trap from `performance.md`).

The bridge was recovered live with `fkb.cli launch net.kckern.pianobridge`. **We could not
recover *why* it died** — `Diag` is an in-memory ring that died with the process and logcat
had already rolled. That missing durable record is the core telemetry gap.

## The architectural flaw

> The health sensor lives inside the dying patient; the one process that survives is blind.

- `useRenderWatchdog.js` runs **inside the FKB WebView** and reports over WS **to the DS
  backend**. When the WebView latches or the JS loop starves, the sensor stops and its
  telemetry channel dies with it. Its self-heal is `SELF_HEAL_RESTART=false` anyway.
- The **piano-bridge APK is a separate native process that survives** WebView failure and
  already commands FKB over REST — but has **zero visibility into WebView health**. A 200
  from FKB's REST proves FKB's HTTP server is up, not that the renderer presents frames.
- **No page→bridge heartbeat.** The bridge can't tell a healthy kiosk from a frozen one.
- **No durable crash record.** When the bridge dies we learn nothing.

## Design

Move the watchdog to the survivor (the bridge), feed it a heartbeat from the page, give it
an escalation ladder, and make death durable.

### 1. Heartbeat (page → bridge)  [frontend]

`useRenderWatchdog.js` already computes fps every second. Additionally POST a beat to
`http://localhost:8770/kiosk/beat` each second:

```json
{ "fps": 58, "visibility": "visible", "url": "…/piano", "uptimeMs": 123456, "ts": 1720033000000 }
```

Fire-and-forget (`keepalive`, short timeout, `mode:no-cors`), guarded off in SSR/tests.
localhost is a secure context, so the HTTPS kiosk may POST to `http://localhost:8770`
(same exemption that already lets `ws://localhost:8770` work).

### 2. Bridge health monitor  [APK: `KioskWatchdog`]

Ingests beats; a timer evaluates health every ~2 s:

- **DEAD** — no beat for `beatTimeoutMs` (default 12 s). Page JS loop dead/latched.
- **DECAYED** — beats arriving, `visibility=visible`, `fps < minFps` (default 12) sustained
  for `sustainSeconds` (default 5).

Screen-off / quiet-window aware: disruptive rungs (L2–L4) are suppressed inside the
configured `fkbWakeQuiet*` window and when the last beat was not `visible` (backlight-off
rAF throttles to ~1 fps — not a fault). L1 (touch) is harmless and always allowed.

### 3. Escalation ladder (fires immediately on stall — decision: ignore session state)

Each rung acts via FKB REST on `localhost:2323` (needs `fkbPassword` in config), then waits
and checks subsequent beats for recovery before escalating:

| Rung | Action | Clears | Wait |
|---|---|---|---|
| L1 | `TouchPulser.burst()` synthetic touches | the common throttle/decay | ~3 s |
| L2 | `loadStartUrl` (reload) | aged-page decay, dead JS loop | ~6 s |
| L3 | `restartApp` (renderer respawn) | stuck renderer | ~8 s |
| L4 | `rebootDevice` (FKB REST) | the hard WebView latch | — |

**L4 reboot is capped and persisted** (`lastRebootAt` on disk, default min gap 1 h). Because
a reboot restarts this process, the cap MUST survive process death or it boot-loops: on
startup, if we rebooted < gap ago and are still unhealthy, do NOT reboot again — log
"unrecoverable by soft ladder — needs human" and stop. A `ladderCooldownMs` after any
sequence prevents thrash.

### 4. Durable crash / death logging  [APK: `CrashLog`]

- `Thread.setDefaultUncaughtExceptionHandler` → append stacktrace + timestamp to
  `getExternalFilesDir()/diag/crash.log` (ring, last N). Also snapshot the `Diag` ring.
- **Running-marker**: write `diag/running` on start, delete on clean `onDestroy`. If present
  at next start ⇒ previous death was unclean (kill/native-crash/reboot) — record it.
- Expose `GET /crashlog` and `GET /kiosk` (watchdog state + counters + last action).
- (Native SIGSEGV in sfizz/Oboe won't hit the Java handler — the running-marker still flags
  the unclean death; a native breakpad handler is a future follow-up.)

### 5. Consolidated diagnostics snapshot  [APK: `GET /diagnostics`]

One endpoint that aggregates *everything the bridge can see* so `pbctl diag` gives a full
picture in a single call. The bridge already exposes `/cpu /info /ps /logcat /props` piecemeal;
this composes them plus new signals and the co-resident FKB app's state:

- **time** — device wall clock (epoch + ISO) and `uptimeMs` (SystemClock).
- **cpu** — own per-thread + process% (`ProcStats`), top threads.
- **memory** — avail/total/threshold/lowMemory + our process RSS (`DeviceProbe` + `/proc/self`).
- **thermal** — battery temperature (`DeviceProbe`) plus best-effort CPU/SoC temps from
  `/sys/class/thermal/thermal_zone*/temp` (may be SELinux-blocked on this Knox build → degrade
  gracefully with a note).
- **battery / power** — level, status, plugged (`DeviceProbe`).
- **bridge** — BLE/MIDI + A2DP speaker + engine state (from `/status`).
- **kiosk (FKB insight)** — the two independent liveness views:
  - *WebView health* (from `KioskWatchdog`): last fps, last-beat-age, verdict
    (`healthy|decayed|dead|screen-off`), recovery counters, last action + outcome.
  - *FKB app health*: bridge-side GET to `localhost:2323/?cmd=deviceInfo&type=json` — if it
    doesn't answer, **FKB itself** is wedged (distinct from the WebView being stalled); if it
    does, surface FKB's own RAM/screen-state/current-URL/foreground-package.
- **lifecycle** — bridge uptime, prev-death cleanliness, reboot counters/last-reboot.

`pbctl diag` pretty-prints this as a health dashboard; the raw JSON stays machine-readable for
cron/alerting. This is the "see as much of the system as is available" surface.

### 6. Surfacing  [CLI + docs]

- `pbctl diag` — full consolidated diagnostics snapshot (health dashboard).
- `pbctl kiosk` — watchdog state (last fps, last-beat-age, current verdict, recovery counters).
- `pbctl crashlog` — durable death/crash log.
- `pbctl status` — one-line watchdog summary added.
- Update `docs/reference/piano/performance.md` with the new watchdog story.

## Config knobs (all live-tunable via `pbctl config set`, no rebuild)

```
watchdogEnabled            true
watchdogRecoverEnabled     true      # master switch for L1–L4 actions (false = observe-only)
watchdogMinFps             12
watchdogSustainSec         5
watchdogBeatTimeoutMs      12000
watchdogRebootEnabled      true      # L4 on/off independently
watchdogRebootMinGapMs     3600000   # ≤1 reboot/hour
watchdogLadderCooldownMs   60000
fkbPassword                <set>     # REQUIRED for L2–L4 REST auth (currently missing!)
```

## Required deploy step

The bridge config currently has **no `fkbPassword`** (`ScreenWaker … hasPassword=false`), so
FKB REST recovery calls would 401. Set it from `data/household/auth/fullykiosk.yml` via
`pbctl config set fkbPassword <pw>` at deploy.

## Test plan

- Frontend: unit-test the beat POST (endpoint, payload, guarded-off in tests) alongside the
  existing `tickWatchdog` tests.
- APK: keep the health-verdict decision pure/static and unit-test it if JVM test infra exists;
  otherwise validate on-device.
- Live smoke: install; confirm beats arrive (`pbctl kiosk`); simulate a stall
  (`watchdogMinFps` high, or stop beats) and confirm L1/L2/L3 fire and log — **do NOT** fire a
  real reboot without explicit go-ahead (set `watchdogRebootEnabled=false` during the smoke).
</content>
</invoke>
