# Piano Kiosk — Performance and jank

The piano tablet (Samsung SM-T590, Android 10, ~3 GB RAM) runs the app full-screen in
Fully Kiosk Browser. The SPA is light, so when it feels slow the cause is almost never
React render load — and it turned out not to be the GPU's raw speed either. This document
records what actually limited frame rate, how to diagnose it on-device, and the watchdog
that observes frame health.

## The root cause: a forced single hardware layer

The dominant historical symptom was brutal, systemic jank — **every** mode (menu, games,
waterfall, Music) stuttering with "a little flash," frames landing at 60–300ms, and the
state persisting until the WebView was reloaded or the device rebooted. It looked like a
CPU or GPU ceiling, but it was neither:

- **CPU was idle** during the jank — `top -H` showed ~6 of 8 cores idle; no thread pegged.
- **The GPU draws fast** — `dumpsys gfxinfo` showed only a handful of "Slow issue draw
  commands"; many frames rendered in 5ms (the panel is capable of 200fps).
- **Yet nearly every frame did a "Slow bitmap upload"** of a single **full-screen
  (1920×1200×4 ≈ 9.2 MB) texture.**

That fingerprint is **Fully Kiosk's `graphicsAccelerationMode = 1`**, which calls
`WebView.setLayerType(LAYER_TYPE_HARDWARE)` and collapses the entire WebView into one
Android hardware layer. That **bypasses Chromium's tiled compositing**: instead of
re-uploading only the dirty 256×256 tiles, Android's hwui `RenderThread` re-captures and
re-uploads the **whole screen** as one 9.2 MB texture on every invalidate. The CPU and GPU
sit idle waiting on that wholesale DMA upload — hence idle cores, fast draws, and 60–300ms
frames, on every screen at once.

**The fix is `graphicsAccelerationMode = 0`** (system default — hardware-accelerated *with*
tiled partial updates). Measured impact, same session, same interaction:

| | mode = 1 (forced HW layer) | mode = 0 (default, tiled) |
|---|---|---|
| Slow bitmap uploads | 299 / 371 frames | **0 / 234** |
| Slow UI thread | 306 | 16 |
| Missed Vsync | 241 | 2 |
| 50th pct frame | 77 ms | 27 ms |
| 90th pct frame | 300 ms | 38 ms |

> `graphicsAccelerationMode` is a per-device Fully Kiosk setting (persists across reboots).
> It must be **0** on the piano tablet. A value of **1** (forced hardware) is the trap —
> it sounds faster but disables tiling; **2** is software rendering. Set via the FKB REST
> API: `node cli/fkb.cli.mjs set graphicsAccelerationMode 0` then restart FKB.

### Self-heal a dead kiosk page

A transient load failure (e.g. the app restarts mid-load) can strand the WebView on Chrome's
**"Webpage not available"** page. Because our JS is gone at that point, nothing in the SPA can
recover it — the screensaver, MIDI wake, everything is dead until the page reloads. The
symptom looks like "the screensaver stopped working" (screen stuck on), but the whole app is
down. Confirm by fetching the DOM (`getHtmlSource` shows `<title>Webpage not available</title>`
instead of `id="root"`); recover immediately with `node cli/fkb.cli.mjs reload` (`loadStartUrl`).

FKB's own auto-reload settings prevent it from getting stuck: run **`node cli/fkb.cli.mjs
recovery`** (idempotent — re-run after any re-provision, like `keepawake`). It sets
`reloadPageFailure=30` (retry a failed load after 30s — the key one), `reloadOnInternet` /
`reloadOnWifiOn` / `waitInternetOnReload` (recover on connectivity return), and asserts
`reloadOnIdle`/`reloadEachSeconds` **off** so a healthy idle session (e.g. a paused video) is
never force-reloaded. These are per-device FKB settings and persist across reboots.

## Diagnosing on-device (what worked, what misled)

The decisive tools were **adb** (via the in-container `AdbAdapter`, `cli/pianobridge.cli.mjs`
for the no-adb fallback) and Fully's REST/JS channel:

- **`adb shell dumpsys gfxinfo de.ozerov.fully`** — the breakthrough. Its per-stage counters
  (*Slow UI thread*, *Slow bitmap uploads*, *Slow issue draw commands*) split the frame time
  into CPU-UI vs texture-upload vs GPU-draw. "Slow bitmap uploads on nearly every frame" +
  a single full-screen texture in the GPU cache named the cause directly.
- **`adb shell top -H`** — per-thread CPU. Showed the render threads *blocked*, not burning
  CPU (idle cores), proving it was an upload/wait stall, not compute.
- **What misled:** the **JS Self-Profiling API** (`window.Profiler`, enabled via the
  `Document-Policy: js-profiling` header) showed the JS main thread ~idle, and the in-page
  rAF probe showed low fps — both true but both pointed *away* from JS, because the stall
  was in the native upload path the JS profiler can't see. Heap and DOM node counts were
  flat (ruling out leaks). Do not conclude "compositor ceiling / weak hardware" from a
  low-fps + idle-JS reading; confirm with `gfxinfo` before blaming paint cost or the GPU.

The bridge's own `cpu`/`exec` diagnostics are limited to its own process (SELinux blocks
other-app `/proc` from `untrusted_app`); FKB CPU needs adb (shell uid). When adb-over-wifi
is off (it does not survive reboots on this tablet), re-enable it (Developer Options →
wireless debugging / `adb tcpip 5555`); the container's `AdbAdapter` reaches it from there.

## Paint cost is the secondary lever

With tiling restored, frames sit at ~27ms during interaction — usable but short of 60. The
remaining cost is ordinary paint, and the playbook in
[`webview-paint-performance.md`](../core/webview-paint-performance.md) applies: flat colors
over gradients, no per-element `box-shadow`/`filter: blur` on repeated elements,
`transform`-only animation, and `contain: layout style paint` to bound repaints. The
keyboard (rendered in every mode) was flattened — solid key fills instead of gradients, the
per-note blurred glow dropped — and the Music cover-wash blur cut from 40px to 8px. These
trim the per-frame paint that tiling now has to do.

## How jank is measured in-app

Two in-app instruments sample `requestAnimationFrame`:

- **The render watchdog** (`useRenderWatchdog`) runs for the life of the app as a passive
  sensor, logging jank **episodes** (`piano.watchdog.jank-start` / `jank-end` with worst
  fps). Its self-heal restart is **gated off** (`SELF_HEAL_RESTART = false`): restarting the
  WebView did not recover frame presentation and degenerated into a remount loop (every
  ~40s), which was its own felt lag — a separate bug fixed by disabling the restart.
- **Process diagnostics** (`perf.diagnostics`, from the shared logger) periodically report
  fps, frame timing, jank-frame count, heap, and DOM node count.

These give fps and rule out JS/memory, but they cannot see the native upload stall — that is
what `dumpsys gfxinfo` is for.

---

*Subsystem overview: [README.md](./README.md). Hardware and tablet setup: [kiosk-setup.md](./kiosk-setup.md).*
