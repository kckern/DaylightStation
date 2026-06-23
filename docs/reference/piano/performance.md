# Piano Kiosk — Performance and jank

The piano tablet is a low-end 2018 device (Samsung SM-T590, Android 10, ~3 GB RAM)
running the app full-screen in Fully Kiosk Browser. The SPA is light — mostly static
surfaces reacting to MIDI — so when it feels slow the cause is almost never React render
load. This document describes how the kiosk measures frame health, what actually limits
frame rate on this hardware, and how to read the signals.

## What "smooth" costs here

The dominant performance fact is that this WebView is **frame-clock / compositor bound, not
main-thread bound.** With the app idle on the home menu, the JavaScript main thread is free
(macrotasks flow at their normal rate with small gaps), yet the compositor presents frames
at a ceiling below 60 — a fresh load settles to roughly the low-50s fps, dipping into the
high-30s for the first few seconds while the SPA boots. There is no continuously-running CSS
animation on the menu to explain it; it is simply what this GPU does compositing the menu's
layered surfaces and the 88-key keyboard. This is the baseline to optimise against, and the
lever is **compositing cost** (layer count, shadows, blurs, large filters), not more
memoisation.

Things that are **not** the bottleneck, and have been ruled out by measurement:

- **GPU acceleration** — hardware acceleration is on; forcing it and rebooting did not change
  the ceiling.
- **Memory** — about half the tablet's RAM is free; the JS heap is a few tens of MB against a
  far larger limit.
- **Camera / motion detection** — FKB's motion and acoustic detection are disabled, so nothing
  is holding the camera or an extra core.
- **Logging / WebSocket storms** — event volume from the tablet is a handful per minute, not a
  flood; the backend sends application-level heartbeats so the stale-connection watchdog does
  not thrash a healthy socket.
- **Multiple tabs** — the kiosk runs a single page context.
- **Periodic reloads** — there is no automatic page reload on a healthy connection; the
  WebSocket service only reloads after sustained connection failure, and that path is quiet in
  normal operation.

## How jank is measured

Two instruments observe frame health, both sampling `requestAnimationFrame`:

- **The render watchdog** (`useRenderWatchdog`) runs for the life of the app as a passive
  sensor. Each second it compares effective fps against a floor; when fps stays below the
  floor long enough it opens a **jank episode** (`piano.watchdog.jank-start`) and closes it on
  recovery (`piano.watchdog.jank-end`, carrying the worst fps seen). Episodes are logged once
  per occurrence, so a steady stall produces one start and no flood.
- **Process diagnostics** (`perf.diagnostics`, from the shared logger) periodically report fps,
  per-frame timing (average / min / max), jank-frame count, heap usage, and DOM node count.

Read both from the running container's logs, filtered to the tablet. A healthy idle session
shows no jank episodes and no reloads.

## The watchdog is a sensor, not an actuator

The watchdog can self-heal by restarting the WebView through the FKB interface, but that
behaviour is **gated off** (`SELF_HEAL_RESTART = false`). On this hardware a restart does not
recover a stalled frame clock — fps returns to the same low value after the reload — so an
enabled watchdog degenerates into a restart loop: it remounts the entire app on a fixed
interval, which is itself the worst kind of jank (a full white-flash reload every time) and
buries the real signal in churn. Disabling the restart and keeping only the measurement is
what makes a clean baseline readable and stops the felt lag of constant remounts.

If the restart is ever re-enabled, it must come with a cap and backoff (stop after N restarts
that don't help, widen the interval each time) and only after a restart is proven to actually
recover frame presentation on the target device. Until then, a genuinely wedged WebView is
recovered by reloading or restarting it by hand over the FKB control channel.

## Diagnosing on the device

The tablet is administered over the Fully Kiosk REST/JS control channel (see `cli/fkb.cli.mjs`),
which survives reboots when ADB over Wi-Fi does not. That channel can read device info and
settings, screenshot the screen, reload or restart the app, and inject a snippet of JavaScript
into the running page. The injection path is how frame behaviour is probed directly: a small
script that counts `requestAnimationFrame` against a self-rescheduling timer separates a
throttled frame clock (animation slow, timer fine) from a blocked main thread (both slow), and
reports page visibility — the single most useful experiment when fps is low for no obvious
reason. What that channel deliberately cannot do without ADB is read per-process CPU; jank is
judged from the frame-rate probe instead.

---

*Subsystem overview: [README.md](./README.md). Hardware and tablet setup: [kiosk-setup.md](./kiosk-setup.md).*
