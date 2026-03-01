# Piano Game Jank: CPU Contention on KCKERN.NET

**Date:** 2026-02-28
**Status:** RESOLVED — replaced GNOME/Mutter with sway compositor
**Affected:** Piano side-scroller (and all 60fps games) on KCKERN.NET

## Symptom

~250ms single-frame jank spikes every ~10 seconds during piano game play on Firefox/Linux (KCKERN.NET).

```
=== PRE-FIX SESSION (2026-02-28T03:14:15Z) ===
Jank windows: 26/55 (47%)
Spike range: 55ms - 433ms
Spike avg: 268ms

=== POST-FIX SESSION (2026-02-28T03:44:02Z) ===
Jank windows: 2/6 (33%)   ← same pattern, just shorter session
Spike range: 287ms - 334ms
Spike avg: 310ms
```

Pattern: exactly 1 jank frame per affected 5-second window, DOM stable (275-351 nodes), `heap: null` (Firefox doesn't expose `performance.memory`).

## Investigation Timeline

### 1. Initial hypothesis: frontend allocation pressure (WRONG)

Suspected NoteWaterfall's `setInterval(16ms)` driving 60fps React re-renders and `Array.shift()` in the perf diagnostics RAF loop were generating GC pressure.

**Fixes applied:**
- `1cb0f3fe` — Replaced `Array.shift()` with `Float64Array` circular buffer in `diagFrame`
- `4fff2a4f` — Replaced `setInterval(16ms)` with `requestAnimationFrame` in NoteWaterfall
- `1972a364` — Unmount NoteWaterfall during fullscreen games (eliminated hidden 60fps render loop)

**Result:** Jank persisted at identical magnitude and cadence. DOM nodes dropped (confirming unmount worked), but spikes unchanged.

### 2. Codebase timer audit (NO MATCH)

Searched entire frontend for timers matching ~10s cadence:
- `useDeviceMonitor` (10s interval) — NOT mounted in piano component tree
- WebSocket flush (1s) — too frequent
- `usePlaybackBroadcast` (5s) — inactive during piano (no media playing)
- `FitnessContext` pruning (3s) — not mounted on `/office` route

### 3. Prometheus system metrics (ROOT CAUSE)

Queried `node_pressure_cpu_waiting_seconds_total` and `node_load1` for the piano session window:

```
KCKERN.NET load1 during piano session: 4.33 - 5.90
(16 cores, so 27-37% utilized but bursty)

CPU pressure spikes on KCKERN.NET:
  03:14:20  6.8%  <<<
  03:15:30  6.1%  <<<
  03:16:30  4.3%
  03:17:50  7.7%  <<<
  03:19:00  8.3%  <<<
  03:20:00  8.6%  <<<

IO pressure on KCKERN.NET:
  03:14:30  8.1%  <<<
  03:14:50  3.8%
  03:18:30  1.4%

Other nodes (Garage, KCKERN.NAS): < 0.5% CPU pressure throughout
```

**Top CPU consumers on the host (cadvisor):**
| Process | CPU% |
|---------|------|
| system.slice (all system services) | 287% |
| user.slice (user processes incl. Firefox) | 118% |
| cadvisor | 58% |
| plex | 46% |
| user-1000 session | 45% |

## Root Cause

**GNOME Shell / Mutter compositor** — not CPU contention, not Firefox, not frontend code.

Initial investigation focused on CPU contention (cadvisor 58%, Plex 46%, Dropbox sync). Reducing container load brought system load from 4-6 down to 1.04 on 16 cores — but jank persisted at identical magnitude. Switching from Snap Firefox to native Brave also had zero effect. The jank was the compositor itself stalling the browser's rendering pipeline.

GNOME's overhead on this host:
- `gnome-shell`: 7.6% CPU, 984 MB RAM
- `ding@rastersoft.com` (desktop icons extension): 2.1% CPU, **3.6 GB RAM**
- Multiple `gjs` processes for notifications, screensaver

### 4. Eliminated hypotheses in order

| Hypothesis | Action | Result |
|------------|--------|--------|
| Frontend GC pressure | Circular buffer, rAF, unmount NoteWaterfall | Jank unchanged |
| Timer cadence match | Audited all frontend timers | No match |
| CPU contention | Capped cadvisor (58%→2%), killed tubearchivist (100%) | Load 4.3→1.04, jank unchanged |
| Snap Firefox | Switched to native Brave | Jank unchanged (44% windows, 267-300ms) |
| GNOME/Mutter compositor | Switched to sway | **Jank eliminated — 0/9 windows, 75fps locked** |

## Resolution

Replaced GNOME Shell + Mutter with **sway** (lightweight Wayland compositor). Installed **Brave** (native .deb) as kiosk browser. Added **wl-mirror** for display mirroring to VIZIO TV.

### Before vs After

```
=== GNOME + Firefox (Snap) ===
Jank windows: 26/55 (47%)
Spike range: 55ms - 433ms
FPS: 56-60 (unstable)

=== Sway + Brave (native) ===
Jank windows: 0/9 (0%)
Max frame time: 13.5ms
FPS: 75.0 (locked to monitor refresh)
```

### Changes applied

| Change | Detail |
|--------|--------|
| Window manager | GNOME → sway (135 MB vs 4.5 GB) |
| Browser | Snap Firefox → native Brave |
| Display mirroring | Mutter built-in → wl-mirror |
| Login | GDM auto-login into sway session |
| cadvisor | Scrape 1s→10s, CPU capped at 0.5 cores |
| tubearchivist | Removed (3 containers, 100% CPU) |

Full kiosk configuration documented in `docs/reference/piano/kiosk-setup.md`.

## Code Changes (kept — good optimizations, just not the root cause)

- Circular buffer eliminates O(n) `Array.shift()` at 60fps
- `requestAnimationFrame` aligns NoteWaterfall with browser paint cycle
- NoteWaterfall unmount during fullscreen games removes ~280 unnecessary DOM nodes
