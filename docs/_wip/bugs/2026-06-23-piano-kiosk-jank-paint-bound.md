# Piano Kiosk Jank — GPU Paint-Bound Investigation

**Date:** 2026-06-23
**Status:** Active investigation (autonomous goal — build ironclad root-cause case)
**Device:** Yellow Room Piano Tablet — Samsung **SM-T595** (Snapdragon 450, **Adreno 506**, Android 10),
FKB at `10.0.0.245:2323` (auth `fullykiosk-piano`). adb reachable **from inside the
`daylight-station` container** at `adb -s 10.0.0.245:5555` (not from the host).
**App:** PianoVisualizer note-waterfall (`/piano`), the fullscreen overlay shown while playing.

## Symptom

Playback on the kiosk is intermittently janky — "sometimes butter smooth, sometimes vengeance."
A fixed CSS cost can't explain intermittency, so the cost must be load- and/or state-dependent.

## Method (every test captures BOTH layers)

A self-driving harness route renders the **real** `NoteWaterfall` + `PianoKeyboard` from a
synthesized, deterministic MIDI note stream (no human at the keyboard):

```
/piano/test/<scene>/<nps>/<poly>/<dur>     scene = waterfall | keyboard | full
```

`measure.cjs` (in-container) drives FKB to a scenario, samples telemetry for a 16s window, reads gfxinfo:

- **Internal (gfxinfo):** Total frames, janky %, 90/95/99th frame-time percentiles, Slow {issue-draw / UI-thread / bitmap-upload} counts.
- **Bare metal (adb):** Adreno `gpu_busy_percentage` (avg/max), `gpuclk` MHz (avg/max, of 600 max), CPU busy % (from `/proc/stat` deltas), MemAvailable MB, WebView renderer RSS MB.

Budget = 16.7 ms/frame (60 fps). A frame > budget = janky.

### Results table legend

`frames (fps)` · `janky%` · `p90/95/99 ms` · `slowDraw/UI/bmp` · `GPU avg/max %` · `GPUclk avg/max MHz` · `CPU%` · `memAvail/rendRSS MB`

## Fixed baseline facts (pre-investigation)

- `graphicsAccelerationMode = 0` already (the documented old fix is intact — NOT this regression).
- **Idle is clean** (0% janky). Jank only during animated play.
- No CPU saturation: ~2.5 of 8 cores busy, all cores pinned at max 1.8 GHz, no thermal throttle (~39 °C).
- ⇒ Single-thread **GPU/compositor** wall, confirmed by gfxinfo "Slow issue draw commands" dominating.

## Fixes applied so far

1. `4fbf65ebe` — remove 3-stack blurred box-shadow + blur flares on animated waterfall/game notes.
2. `88744c2bc` — flat fill (was 4-stop gradient) + drop `::after` active-note flare.

## Results

| build / change | scene/nps/poly | frames (fps) | janky | p90/95/99 ms | slowDraw/UI/bmp | GPU avg/max % | GPUclk avg/max | CPU | mem/RSS MB |
|---|---|---|---|---|---|---|---|---|---|
<!-- rows appended by measure.cjs below -->

### Build 88744c2bc — density sweep (waterfall): jank scales with note count; GPU idle + underclocked

| build / change | scene/nps/poly | frames (fps) | janky | p90/95/99 ms | slowDraw/UI/bmp | GPU avg/max % | GPUclk avg/max | CPU | mem/RSS MB |
|---|---|---|---|---|---|---|---|---|---|
| sweep-88744c2b | waterfall/2/4 | 91 (5.7) | 9.89% | 16/18/42 | 9/0/0 | 13/33 | 320/320 | 21% | 941/532 |
| sweep-88744c2b | waterfall/4/6 | 107 (6.7) | 65.42% | 26/27/32 | 70/0/0 | 20/31 | 335/400 | 20% | 903/553 |
| sweep-88744c2b | waterfall/8/8 | 76 (4.8) | 81.58% | 34/36/44 | 62/0/0 | 14/28 | 330/400 | 21% | 901/534 |
| sweep-88744c2b | waterfall/16/10 | 89 (5.6) | 86.52% | 44/46/48 | 77/0/0 | 16/25 | 349/510 | 22% | 1122/352 |
| sweep-88744c2b | waterfall/24/12 | 86 (5.4) | 84.88% | 46/48/57 | 73/0/0 | 14/27 | 364/510 | 22% | 1101/366 |

### COLD fresh-renderer test (FKB force-stopped + relaunched) — rules out memory/heap leak

Cold trajectory waterfall/16/10 (8x4s windows): **100% janky every window**, p90 ~40ms,
GPU 20-28% busy, clock pinned 320-400MHz. Identical to warm → NOT a leak; pure render work.

### Smooth-boundary sweep on the COLD renderer (where is it actually smooth?)

| build / change | scene/nps/poly | frames (fps) | janky | p90/95/99 ms | slowDraw/UI/bmp | GPU avg/max % | GPUclk avg/max | CPU | mem/RSS MB |
|---|---|---|---|---|---|---|---|---|---|
| cold-smooth | waterfall/1/2 | 148 (9.3) | 4.73% | 15/16/19 | 5/1/0 | 25/28 | 337/510 | 23% | 1151/310 |
| cold-smooth | waterfall/2/3 | 65 (4.1) | 10.77% | 16/17/19 | 7/0/0 | 22/27 | 330/400 | 22% | 1140/315 |
| cold-smooth | waterfall/3/4 | 140 (8.8) | 27.14% | 18/19/22 | 38/0/0 | 22/29 | 330/400 | 23% | 1159/309 |
| cold-smooth | full/2/3 | 168 (10.5) | 27.98% | 20/21/28 | 45/1/1 | 28/31 | 355/400 | 23% | 1142/329 |

### POST FULL-REBOOT (uptime ~2min, fresh kernel/DVFS/GPU/FKB) — does system state matter?

| build / change | scene/nps/poly | frames (fps) | janky | p90/95/99 ms | slowDraw/UI/bmp | GPU avg/max % | GPUclk avg/max | CPU | mem/RSS MB |
|---|---|---|---|---|---|---|---|---|---|
| post-reboot | waterfall/16/10 | 134 (8.4) | 82.84% | 48/53/57 | 106/16/1 | 24/33 | 340/400 | 36% | 1316/246 |
| post-reboot | waterfall/2/3 | 149 (9.3) | 50.34% | 21/22/31 | 68/3/0 | 26/32 | 335/400 | 28% | 1360/247 |

## PIVOT: it's a WebView frame-clock (vsync/BeginFrame) stall, not paint

The app's own `useRenderWatchdog` already measures true rAF fps and logs it. Live evidence:
- `piano.watchdog.jank-start {"fps":7..9, minFps:12}` and `jank-end {"fps":42, "worstFps":3}`.
- So the frame-presentation clock **oscillates ~3 ↔ 42 fps**; mostly stuck ~7–9 fps ("unplayable").

`useRenderWatchdog.js` header comment (prior field work, 2026-06): self-heal restart was DISABLED
because **restarting the WebView did NOT recover fps — it stayed ~10fps across restarts, even on a
near-empty screen with hardware acceleration.** ⇒ NOT content/paint, NOT a leak.

### Eliminations (all measured this session)
| Suspect | Result |
|---|---|
| graphicsAccelerationMode=1 | ❌ already 0 |
| Paint cost (shadows/blur/gradients) | ⚠️ real per-frame savings (105ms→27ms) but NOT the stall (near-empty screen stalls too) |
| GPU fill saturated | ❌ GPU ≤34% busy, mostly 0% |
| GPU clock throttle | ❌ free range 133–600, governor just never boosts (idle) |
| CPU saturated / thermal | ❌ ~20% CPU, cores at max 1.8GHz, ~39°C |
| Renderer heap/memory leak | ❌ cold == warm (100% janky both) |
| Display refresh rate | ❌ panel is 60Hz (VSYNC 16.67ms) |
| **Bluetooth (BLE-MIDI) flap** | ❌ **BT turned OFF → still 9 fps** |
| Full device reboot | ❌ dense still ~83% janky post-reboot |

### Remaining root cause
Intermittent **Chromium WebView BeginFrame/vsync delivery stall** on this stack (Android 10 +
WebView/Chromium 149 + Adreno 506, FKB drawing WebView into its Activity window). rAF AND
compositor CSS animations both throttle to ~7–10fps while GPU/CPU idle; bursts to ~42fps. Survives
reboot, WebView restart, BT-off. Bistable.

### Candidate fixes (untested)
1. **WebView command-line flags** via WebView DevTools (`com.google.android.webview` dev UI) or
   `/data/local/tmp/webview-command-line` (needs DevTools "use command line" enabled): try
   `--disable-features=UseSurfaceControl` (Android-Q SurfaceControl vsync path is the prime suspect),
   and/or `--disable-gpu-vsync` / `--disable-frame-rate-limit`.
2. **App-level keep-alive frame driver**: a perpetual muted looping `<video>` (own present path)
   to force BeginFrame at 60fps even when rAF/compositor are starved — a known WebView workaround.
3. Re-enable the watchdog self-heal with a recovery action that actually works (TBD by #1/#2).
