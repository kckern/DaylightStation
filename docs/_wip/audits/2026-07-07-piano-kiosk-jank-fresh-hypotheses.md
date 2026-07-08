# Piano Kiosk Jank — Fresh Hypotheses & Untried Levers

**Date:** 2026-07-07
**Scope:** the *frame-rate/responsiveness* jank on the SM-T590 kiosk — NOT the MIDI-timing
problem (solved separately by the 2026-07-06 playback/render decoupling). Input: a fresh
read of [`performance.md`](../../reference/piano/performance.md), the kiosk code, and the
device's actual silicon. Goal: ideas beyond what's already been tried.

**Hardware reality check (Galaxy Tab A 10.5, SM-T590, 2018):** Snapdragon 450 — eight
Cortex-A53 @ 1.8 GHz, **no big cores at all**; Adreno 506; 3 GB RAM; 1920×1200; final OS
Android 10 (One UI 2.x). Chrome/WebView 149 requires Android 10+ — this tablet sits at the
**absolute floor of current WebView support**, the least-tested OS/driver combo Chromium
still ships to.

---

## 0. The under-used constraint that reorders everything

The user's own observation — *"sometimes the keep-alive CSS animation at the top runs fine
while everything else is unusable"* — is not just a symptom, it's a **precision diagnostic**:

In Android WebView, a composited CSS animation ticks on the **renderer process's compositor
(cc impl) thread**; the app's RenderThread just draws the frames via the draw functor. So
when the crawl dot is butter-smooth while the app is dead, we know the renderer **process**
is alive, scheduled, getting vsync at 60 Hz, and its GPU path works. **Only the renderer
MAIN thread** (BeginMainFrame / rAF / timers / main-thread input handling) is starved.

That single fact **kills or demotes whole hypothesis families** that the investigation has
been circling: process-level freezing (Samsung freecess), renderer-process demotion/cgroup
jail, GPU/driver stalls, thermal caps, memory pressure — all of those would starve the impl
thread too. What survives is narrow:

1. **A Chromium main-thread scheduling policy** (wake-up alignment, battery-saver behavior,
   user-inactivity heuristics) that deliberately stops issuing/aligning main-thread work while
   leaving impl-thread animation alone; or
2. **Thread-level starvation** — the main thread specifically landing in a restricted
   cgroup / huge `timer_slack_ns` while the display-priority compositor thread keeps its slot.

Both are testable with commands nobody has run yet (§ 5). And note the two-syndrome split
performance.md hints at but doesn't operationalize:

- **Syndrome A — input-recency throttle:** touch restores 60 fps *instantly*. This is a live
  policy, not damage.
- **Syndrome B — aged-page decay → hard latch:** survives reload/`restartApp`, usually (not
  always) cleared by reboot. This is accumulated state.

They need different kill-chains; conflating them is why "sometimes a reboot fixes it,
sometimes it doesn't" feels random.

---

## 1. H1 (front-runner): OS battery saver / Samsung Adaptive power saving — persisted, auto-toggling, and honored by Chromium

Chromium changes main-thread scheduling when the OS reports power-save mode: Blink aligns
and throttles main-thread timer wake-ups while compositor-thread animations continue —
**exactly the observed signature**. Two properties make this hypothesis fit the weirdest
part of the symptom history:

- **Samsung "Adaptive power saving" toggles battery saver automatically** on its own
  schedule/heuristics → episodes come and go with no page-side cause.
- **`low_power` is a persisted global setting → it survives reboot** → "sometimes a reboot
  doesn't fix it." An in-memory latch would always clear; a persisted setting wouldn't.

**Kill tests (10 minutes, do these first):**
```bash
# during an episode:
adb shell settings get global low_power            # 1 = battery saver ON
adb shell dumpsys power | grep -iE "mLowPowerMode|battery"
# historically — correlate with existing piano.watchdog jank-start timestamps:
adb shell dumpsys batterystats | grep -i "power_save"   # mode transition history
```
Also check Settings → Battery: **Adaptive power saving** (off), **Adaptive battery** (off),
and (present on some One UI builds) **Processing speed → High/Maximum**.

**Fix if confirmed:** the piano-bridge APK already holds `WRITE_SECURE_SETTINGS` — teach the
KioskWatchdog to **assert `low_power == 0` every beat-check** and clear it if Samsung flips
it (a "settings sentry," one config knob). Zero user-visible cost on a wall-powered kiosk.

## 2. H2: a Chromium 149 main-thread inactivity policy (the "input-recency throttle," reframed)

If `low_power` reads 0 during episodes, the same signature points at a Blink/cc scheduling
heuristic keyed to user activity — arriving with the Chrome-149-era WebView on
floor-of-support hardware. Two untried levers:

- **WebView DevTools flags UI** — the production-safe way to toggle features per-device
  (`adb shell am start -a "com.android.webview.SHOW_DEV_UI"`). Note:
  `/data/local/tmp/webview-command-line` (performance.md next-step #3) is **ignored on
  production builds** unless a debug-app is set — the DevTools UI is the lever that actually
  works on this tablet. Walk the feature list on 149 and A/B the scheduling-ish ones.
- **Pin/downgrade the WebView version.** Uninstall updates for
  `com.google.android.webview`, sideload a known-good earlier version (pick one predating
  the first aged-decay telemetry), **disable Play auto-update for it**, and watch a week of
  `piano.watchdog` episodes. The decay's arrival correlating with a WebView version would be
  cheap, decisive evidence — and version-pinning is a legitimate permanent posture for a
  single-purpose kiosk (accepting the security trade-off on a LAN-only device).

## 3. H3: main-thread-only starvation via cgroup/timer-slack at idle DVFS

Weaker than H1/H2 (idle cores should still schedule a normal-priority thread), but the test
is cheap and specific — during an episode:
```bash
RPID=$(adb shell ps -A | grep -E "sandboxed|u0_i" | awk '{print $2}' | head -1)  # isolated renderer
adb shell "cat /proc/$RPID/task/*/comm"                     # find CrRendererMain vs Compositor TIDs
adb shell "cat /proc/$RPID/task/<tid>/cgroup"               # main vs impl thread cgroups — DIFFERENT? found it
adb shell cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq   # DVFS floor during jank vs during touch
```
(Also answers single- vs multi-process WebView on this device, which nothing has recorded.)
Fixes if confirmed: never-sleep whitelist **both** `de.ozerov.fully` AND
`com.google.android.webview`; `adb shell am set-standby-bucket de.ozerov.fully active` (and
the WebView package); `adb shell cmd appops set de.ozerov.fully RUN_ANY_IN_BACKGROUND allow`.

## 4. H4/H5: two one-command rule-outs never actually captured

- **GOS (Game Optimizing Service):** Samsung throttles apps it classifies as games
  (fullscreen immersive + constant animation is game-shaped). Check Game Booster's app list /
  `adb shell pm list packages | grep -i game`; exclude FKB if listed.
- **Thermal, with data instead of touch:** `adb shell dumpsys thermalservice` during an
  episode. Android 10's thermal service reports the live throttling status — one command
  permanently rules thermal in or out. ("It felt cool" is not a measurement.)

---

## 5. Syndrome B (aged decay → hard latch): a doc/code mismatch is suspect #1

**`KeepAliveVideo.jsx` no longer matches `performance.md`.** The doc prescribes
belt-and-suspenders (2 KB muted H.264 video + an *opaque* CSS transform driver) and warns
"do not remove either driver." The shipped component is now a **single 3×2 px CSS crawl
dot at `rgba(255,255,255,0.22)`** (`PianoApp.scss:62-80` — the comment literally says
"minimal contrast on the dark chrome"; consolidated per direction, for aesthetics). That is
structurally the same configuration the doc's own 2026-07-01 postmortem blames for the
aged-decay regression: a near-imperceptible animation that Chrome 149's heuristics
eventually classify as not-worth-scheduling — after which pages decay as they age, and
prolonged decay can latch the WebView. (The rule's own `z-index: 2147483647` comment shows
occlusion-culling already defeated one iteration of this driver — the perceptibility
heuristic is the adjacent trap, and 22 %-alpha white over light content is near-invisible
to it.)

- **Cheap experiment before anything else:** make the dot **fully opaque and
  higher-contrast** (1 px tall is fine — contrast is what the perceptibility heuristic sees),
  or re-add the 2 KB video driver. Then watch a week of `piano.watchdog` aged-page telemetry.
  If decay episodes started clustering after the consolidation shipped, this is the whole
  Syndrome-B story.
- **Preventive nightly reboot.** The watchdog's L4 reboot is *reactive* — users feel the
  latch first. Add a **scheduled quiet-hours reboot** (bridge cron or FKB REST
  `rebootDevice`, e.g. 04:00): latch states then can't accumulate past 24 h. Boring,
  standard kiosk hygiene, one line — and it converts "sometimes reboot doesn't fix it" into
  a daily controlled experiment (if jank exists at 04:05, it's persisted state → H1).

---

## 6. Mitigations that pay off regardless of root cause

- **M1 — Compositor-owned playback visuals (the biggest page-side idea).** The compositor
  demonstrably survives every syndrome — so put what users watch during play *on it*. In
  Listen/Polish the entire timeline is known up front: build **one Web-Animations-API
  keyframe animation** (transform-only) driving the cursor across the whole piece, synced to
  the transport anchor; cancel/rebuild only on pause/seek/tempo change. The cursor then
  glides at 60 fps under total main-thread starvation — same physics as the crawl dot. The
  2026-07-06 branch already moved the cursor to `transform: translate3d` positioning, so the
  remaining work is generating keyframes from `stepTimeline` instead of committing one
  transform per step. (Do NOT layerize the whole score for a continuous pan — a
  multi-screen score strip is tens of MB of texture on an Adreno 506; if pan is wanted,
  window it. Cursor first: tiny layer, pure win.)
- **M2 — Drop the render resolution.** `adb shell wm size 1280x800` (persists across
  reboot; `wm size reset` reverts). Cuts every raster/upload/composite cost ~2.25× on the
  SoC whose documented historical pathology was literally full-screen texture-upload
  bandwidth. A 10″ kiosk read from a piano bench does not need 1920×1200. Cheapest global
  win available; trial it for a day against the watchdog numbers.
- **M3 — Guaranteed-real input (fallback if TouchPulser fails validation).** The
  accessibility-injected micro-swipe (built 2026-07-02) is still **unvalidated** — whether
  injected gestures satisfy the input-recency signal is an open question. The guaranteed
  fallback is *hardware*: a cheap USB/BT HID gadget emitting a benign periodic event (F24
  keypress / 1 px scroll every ~20 s) enters through InputFlinger exactly like a finger; no
  OS heuristic can tell the difference. Ugly, effective, $5.
- **M4 — Telemetry that separates the syndromes automatically.** Tag every
  `piano.watchdog` episode with **"recovered-by-input?"**: the bridge's L1 rung already
  fires a `TouchPulser.burst` on stall — log fps in the beats immediately before/after each
  burst. That one number (a) validates or kills the tap-wake bet with zero extra hardware
  sessions, and (b) classifies every episode as Syndrome A (input recovers it) vs B (it
  doesn't) in the passive telemetry, permanently.

---

## 7. The decisive instrument nobody has used: Perfetto

`gfxinfo` and `top` see symptoms; a **system trace during a live episode** sees causes — in
one artifact: per-thread scheduling states (Running/Runnable/Sleeping/frozen) for
`CrRendererMain` vs the compositor thread, CPU frequencies, and the BeginFrame pipeline.
It directly distinguishes the three surviving mechanisms: *BeginMainFrame not issued*
(Chromium policy → H1/H2), *issued but thread starved* (cgroup/DVFS → H3), *thread frozen*
(process management — largely excluded by § 0, but the trace settles it).

```bash
adb shell setprop persist.traced.enable 1     # once (Android 10 ships perfetto)
adb shell perfetto -o /data/misc/perfetto-traces/jank.pftrace -t 30s sched freq gfx view
adb pull /data/misc/perfetto-traces/jank.pftrace   # → ui.perfetto.dev
```
Capture one trace during Syndrome A (pre-touch), one during Syndrome B, one healthy. Thirty
seconds each; this likely ends the guessing.

---

## 8. Suggested attack order

| # | Action | Cost | Kills/confirms |
|---|--------|------|----------------|
| 1 | `low_power` + `batterystats` power-save correlation vs watchdog timestamps; disable Adaptive power saving/battery | 10 min | **H1** |
| 2 | `dumpsys thermalservice` + GOS check during an episode | 5 min | H4/H5 |
| 3 | Crawl-dot contrast fix + nightly quiet-hours reboot + settings-sentry knob | small PRs | Syndrome B triggers |
| 4 | `wm size 1280x800` one-day trial vs watchdog numbers | 1 min | M2 payoff |
| 5 | Perfetto captures (A episode / B episode / healthy) | one session | H1 vs H2 vs H3 mechanism |
| 6 | TouchPulser validation via M4's before/after-burst logging | telemetry only | the tap-wake bet + A/B classifier |
| 7 | WebView DevTools flag walk; then version pin/downgrade A/B for a week | medium | H2 / Chrome-149 regression |
| 8 | WAAPI whole-piece cursor animation | eng task | M1 — visuals immune even if all else fails |

---

*Relates to: [`performance.md`](../../reference/piano/performance.md) (device pathology),
[2026-07-06 decoupling audit](./2026-07-06-piano-kiosk-playback-render-decoupling-audit.md)
(the MIDI-timing half, solved). Update performance.md's keep-alive section to match the
shipped crawl-dot reality when acting on § 5.*
