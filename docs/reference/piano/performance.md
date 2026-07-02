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

### Measuring jank (the right way — and a pitfall)

**`node cli/fkb.cli.mjs jank [minFps]`** is the canonical check: it injects a `requestAnimationFrame`
counter, reads the steady-state fps back out of an offscreen DOM node via `getHtmlSource`, and exits
non-zero below the threshold (default 20). It is **pure FKB REST — no ADB** — so it works after a
reboot (adb-over-wifi is non-persistent and dies on reboot; FKB's REST on `:2323` comes back on its
own). Healthy steady-state on this tablet is **~60 fps**. Cron it to catch regressions.

> **Measurement pitfalls (2026-07-01):** (1) the older `fkb.cli fps` (screenshot) probe samples rAF
> only ~2.5 s after a cold `loadStartUrl` — during the SPA's load/hydration burst — and under-reads a
> healthy page; measure at steady state (the `jank` command waits ~10 s). (2) Always confirm
> `screenOn:true` first — rAF throttles to ~1 fps while the FKB backlight is off. (3) **Both CLI
> probes reload the page, and a fresh page can read 60 fps while the aged page the user actually
> lives on has decayed to ~10 fps** (see the keep-alive regression below). Spot probes only measure
> the latch state; aged-page decay is only visible in the passive `piano.watchdog` telemetry.
> (4) Do NOT test via `injectJsCode` experiments containing `history.pushState`: FKB re-evaluates the
> injected JS on history changes, so such probes multiply into an instance storm on an SPA.

### The 2026-07-01 finding: an OS-level input-recency throttle (page-side unfixable)

Late-evening conclusion after instrumented elimination. The SM-T590 clamps the WebView's
**main-thread frame delivery to ~4-8 fps** when there has been no **touch** input for a while:

- **Everything main-thread** (rAF, React commits, key highlights) hits a hard ~120-250 ms/frame
  floor; **compositor-thread CSS animations stay smooth at 60** (visibly: the header pill is
  butter while the app janks) — so "the CSS driver looks fine" proves nothing about the app.
- **BLE-MIDI is NOT user activity** to Android/Chromium — only touch/keys are. A piano kiosk is
  "idle" *while being played*: measured MIDI→pixels lag ≈ 250 ms avg / 0.8 s worst during play.
- **Real touch lifts it to 60 fps instantly** (adb `input tap` test: idle 2.5 → 60 fps, 0% janky);
  load/navigation and reboot give a temporary boost window — which is why fresh-page probes lie.

**Page-side levers all FAILED** (each verified live via the always-on telemetry): compositor CSS
animation ✗, playing muted video (silent-AAC track, exempt from the video-only power-pause) ✗,
30 Hz `setInterval` canvas main-thread paint damage ✗, **unmuted audible playback** (subsonic
40 Hz @ −35 dB, FKB `autoplayAudio=true`) ✗. The keep-alive stack in `KeepAliveVideo.jsx` is kept
(harmless, and it still covers the older starvation modes), but no page content defeats this
throttle.

**Next steps (require a one-time USB/ADB session at the tablet):**
1. Re-enable adb-over-wifi (`adb tcpip 5555`) — it does not survive reboots.
2. During throttle, capture mechanism: `dumpsys gfxinfo`, CPU freqs (`cat /sys/devices/system/cpu/*/cpufreq/scaling_cur_freq`),
   renderer cgroup/priority — distinguishes Chromium renderer scheduling vs Samsung touch-boost DVFS.
3. Try WebView command-line flags (`/data/local/tmp/webview-command-line`).
4. **The designed fix:** add an `AccessibilityService` to the piano-bridge APK that `dispatchGesture`s
   a 1-px corner tap when MIDI notes flow (it already owns `MidiManager`) — playing the piano becomes
   the OS-level input that un-throttles the UI, precisely when latency matters. Periodic idle ticks
   optional for the screensaver-era wake paths.

### The 2026-07-01 regression: removing the keep-alive video

Commit `7de308f70` ("gut KeepAliveVideo to CSS-only vsync driver") shipped in the 12:31 build on
2026-07-01; the first `piano.watchdog.jank-start` fired at 13:03 — 32 minutes later — and sustained
~8–10 fps episodes (a hard ~100 ms/frame floor, `frameMs min ≈ 100`) recurred all day. The observed
shape: **pages load at ~60 fps and decay to ~10 as they age**; prolonged decayed operation can latch
the whole WebView (fresh pages read ~8 too; survives reload and `restartApp`; a device reboot clears
it until pages decay again). CPU idle, RAM free, cool, heap/DOM flat — a throttled frame clock, not
load. The working theory: the CSS driver's near-invisible animation (`opacity 0.012`) is eventually
classified imperceptible by the current WebView (Chrome 149) and unscheduled.

**Fix: belt-and-suspenders keep-alive, both drivers compositor-perceptible** (KeepAliveVideo.jsx):
a muted looping 2 KB near-black H.264 video (`public/vsync-keepalive.mp4`, 48 px, opaque, parked in
the dark header band — FKB has `autoplayVideos=true` so no gesture is needed; the old video's real
defects were a broken source, 6 px size, and a needless gesture gate) **plus** the CSS transform
driver, now opaque near-background color instead of ghost opacity. Telemetry (`keepalive.playing` /
`keepalive.play-blocked` / `keepalive.stalled`) shows whether the media path is live on-device.
Do not remove either driver based on a fresh-page measurement — validate on an **aged page**
(>30 min) via `piano.watchdog` before believing any "X alone is sufficient" claim.

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
