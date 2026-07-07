# Piano Kiosk — Playback/Render Decoupling Performance Audit

**Date:** 2026-07-06
**Scope:** `frontend/src/modules/Piano/PianoKiosk/` with deep focus on `modes/SheetMusic/`
(ScorePlayer, useScoreTransport, useMetronomeClick, useFollowTracker, overlays), the shared
MIDI surface (`useWebMidiBLE.js`, `PianoMidiContext.jsx`), and the engraving layer
(`MusicNotation/renderers/MusicXmlRenderer.jsx`, `osmdRender.js`).
**Hardware context:** Samsung SM-T590 (2018), Android 10, Chrome 149 WebView in Fully Kiosk.
See [`docs/reference/piano/performance.md`](../../reference/piano/performance.md) for the
device's known frame-clock pathologies (the OS input-recency throttle that clamps
main-thread frame delivery to ~4–8 fps during hands-on-piano/hands-off-glass use, and the
aged-page decay). This audit assumes those findings as ground truth.
**User symptom:** during sheet-music playback "the MIDI can't keep tempo — rendering is
trying to keep up." Ask: separate playback/rhythm (low-resource, must never skip) from
engraving/scrolling/UI (allowed to be slow).

---

## Executive summary

The symptom is architecturally guaranteed, not incidental. The score transport — the thing
that decides *when a MIDI note sounds* — ticks on `requestAnimationFrame`, which on this
tablet is **the single most throttled, most jank-coupled clock available**: it is the exact
clock the SM-T590's input-recency throttle clamps to 4–8 fps, and it is delayed by every
long main-thread task (React commits, OSMD geometry slices, scroll tweens). MIDI sends then
go out **immediately at tick time with no timestamp**, so every frame delay is a rhythm
delay, 1:1.

Meanwhile each fired note triggers a cascade of **3–5 React state updates across two
component trees** (transport `struck` set + MIDI-context `activeNotes` Map + `noteHistory`),
and the MIDI context's identity churn re-renders **every kiosk consumer** (header chrome,
transport bar, keyboard, score player) on **every note on and every note off** — so the act
of playing notes *creates* the render load that then starves the clock that times the next
note. That feedback loop is the jank spiral.

The escape is already half-built: `useWebMidiBLE.scheduleNotes()`
(`useWebMidiBLE.js:328-338`) sends with **Web MIDI timestamps**, which Chromium dispatches
from the browser-process MIDI service — *outside* the page's main thread scheduling. A
lookahead scheduler (~400 ms window) built on timestamped sends makes the note stream
immune to main-thread jank entirely: even if the page freezes for a quarter second, notes
already handed to the MIDI service leave on time. The visual cursor then becomes a
*follower* of the audio clock instead of its gatekeeper. This is the classic "two clocks"
architecture (audio-scheduling lookahead), and it is the P0 recommendation below.

Severity legend: 🔴 direct cause of the reported symptom · 🟡 significant contributor ·
🔵 secondary / polish.

---

## 1. The timing plane — where the rhythm actually lives

### T1. 🔴 The transport ticks on `requestAnimationFrame` — rhythm inherits every frame stall

`useScoreTransport.js:25-43`: the play loop is

```js
const tick = () => {
  const pos = performance.now() - anchorRef.current;
  while (idx < tl.length && tl[idx].t <= pos) { fire(tl[idx]); idx++; }
  rafRef.current = requestAnimationFrame(tick);
};
```

The `performance.now()` anchor (2026-07-02 audit fix A2) means lateness never *accumulates*
— aggregate tempo is right. But **per-event latency = the gap until the next rAF fires**,
and on this device that gap is the whole problem:

- **The OS input-recency throttle** (performance.md, 2026-07-01 finding) clamps rAF to
  ~120–250 ms/frame when the glass hasn't been touched — and playing the piano is *not*
  touch. At ♩=120, eighth notes are due every 250 ms: **every note quantizes to a frame
  boundary and can land up to a full frame late**, unevenly. This is audible as exactly
  "can't keep tempo."
- **Every long main-thread task delays the tick**: a React commit storm (see §2), an OSMD
  extraction slice (§3), a GC pause. The in-product telemetry already names this —
  `score.playback.stall` fires when a note is ≥120 ms late or the frame gap ≥50 ms
  (`useScoreTelemetry.js:38-44`).
- **After a stall, the `while` loop machine-guns the backlog**: every event whose time
  passed during a 500 ms freeze fires in one burst — chords smear together, then silence,
  then another burst. That's the characteristic "MIDI trying to catch up" texture the user
  hears.

The transport is otherwise well-built (drift-free anchor, pause/seek, ref-read callbacks).
The defect is *which clock wakes it* and *that sends carry no timestamp*.

### T2. 🔴 MIDI sends are immediate, not timestamped — the fix is already in the codebase

`ScorePlayer.jsx:218-225` fires `pressNote(e.note, …)` / `releaseNote(e.note)` at tick
time; `useWebMidiBLE.js:160-167` sends `out.send([0x90, …])` with **no timestamp** — "as
soon as possible."

Web MIDI's `output.send(data, timestamp)` accepts a future `performance.now()`-domain
timestamp, and Chromium queues the message in the **browser-process MIDI service**, which
dispatches on schedule regardless of what the page's main thread is doing. The codebase
already uses this: `scheduleNotes()` (`useWebMidiBLE.js:328-338`) and even `sendNote`'s
`durationMs` note-off (`useWebMidiBLE.js:303-311`). The Studio loop transport established
the pattern. **ScorePlayer's Listen mode simply doesn't use it.**

**Recommended architecture — lookahead scheduler ("a tale of two clocks"):**

1. Keep the absolute anchor (`anchorRef`) as-is — it's correct.
2. Replace "fire what's due now" with "**schedule everything due in the next ~400 ms**,
   with explicit timestamps": on each scheduler wakeup,
   `out.send(bytes, anchorWall + ev.t)` for all events in `(lastScheduled, pos + LOOKAHEAD]`.
3. Wake the scheduler on a coarse timer (`setInterval(…, 100)`), **not rAF**. Timer
   callbacks on a visible foreground page are not vsync-gated; and even if a wakeup lands
   200 ms late, the lookahead window has already covered the gap — lateness only ever eats
   margin, never rhythm.
4. The **visual cursor** consumes the same timeline separately, on rAF, computing "current
   step = last event with `t ≤ pos`" per frame. On a janky frame the cursor is late —
   which is fine and unavoidable — but the *sound* is not.
5. **Pause/seek/role-change semantics:** messages already handed to the MIDI service can't
   be reliably recalled (`MIDIOutput.clear()` is in the spec but has historically been a
   no-op in Chromium — verify on Chrome 149 WebView; do not depend on it). So keep the
   lookahead modest (300–500 ms), and on pause/seek send the existing flushed
   `sendPanic()` (CC120+123, `useWebMidiBLE.js:294-301`) *plus* per-note note-offs for
   `soundingRef` — the current `silence()` contract (`ScorePlayer.jsx:180-189`) already
   does exactly this. Worst case after the fix: ≤ lookahead-window of tail notes cut by
   the panic, identical to today's behavior on pause.
6. **BLE reality check:** Android's BLE-MIDI link adds its own ~10–30 ms connection-interval
   jitter and the Jamcorder is the actual DIN clock. That floor exists regardless; the
   point of timestamped scheduling is to remove the *hundreds* of ms of main-thread jitter
   sitting on top of it.

**Verification:** the telemetry hook is already in place — extend `recordFire` to log
*scheduled-timestamp drift* (should collapse to ~0) separately from *wakeup drift* (may
stay large under throttle, harmlessly). Compare `score.playback.stats` p95DriftMs
before/after on the physical tablet, on an **aged page** (>30 min — see performance.md's
fresh-page pitfall), while deliberately scrolling/zooming during playback.

### T3. 🟡 The metronome click is a raw `setInterval` firing audio "now"

`useMetronomeClick.js:12-17` = `setInterval(onTick, 60000/bpm)`; `click.js:17-33` starts
the oscillator at `ac.currentTime` — i.e. the click sounds whenever the timer callback
happens to run. Main-thread timer jitter lands directly on the click, and `setInterval`
drift is unbounded (each callback re-queues relative to actual firing). A metronome that
itself swings is worse than none for a practice tool.

**Fix:** schedule clicks on the **AudioContext clock** with the same lookahead pattern: a
coarse timer wakes every ~100 ms and calls `osc.start(t)` for every beat due in the next
~300 ms, computing beat times as `t0 + n × 60/bpm` in `ac.currentTime` domain
(never "now + period"). WebAudio playback of already-scheduled nodes is driven by the audio
thread — sample-accurate regardless of main-thread jank. This is a ~30-line change confined
to `click.js`/`useMetronomeClick.js`, unit-testable with a mock context.
(Bonus: it gives the deferred count-in from the 2026-07-02 audit (A3) a solid foundation.)

### T4. 🟡 Polish-mode timing *measurement* is taken on the janky clock

`stepStartRef.current = performance.now()` runs inside a `useEffect` on `step` change
(`ScorePlayer.jsx:261`) — i.e. **after** the React commit that the step update caused. Under
jank, the "beat began" reference is late by the commit+frame delay, so `driftForNote`
(`ScorePlayer.jsx:262`) systematically *flatters* late playing and can mis-grade measures
(`useScoreEvaluator`). Once T1's scheduler exists, stamp the step's *musical* time
(`anchorWall + stepTimeline[i].t`) instead of commit-observed wall time. Zero-cost fix
bundled with T1.

---

## 2. The render plane — self-inflicted commit storms per note

### R1. 🔴 The MIDI context value churns identity on every note event → whole-kiosk re-render per note

`useWebMidiBLE.js:392-413`: the hook's return object is memoized **on `activeNotes`,
`noteHistory`, `sustainPedal`, …** — all of which change on *every* note-on and note-off
(`applyNoteOn/applyNoteOff`, lines 134-154, each build a fresh Map + history array). That
object is the **context value** (`PianoMidiContext.jsx:10-13`), so every one of the ~24
`usePianoMidi()` consumers re-renders **twice per keystroke** (on + off) — including:

- `PianoChrome` (`PianoChrome.jsx:24`) — reads only `connected`, yet re-renders per note;
- `ScorePlayer` — a 780-line component whose render rebuilds `targetNotes`/`litNotes` Sets,
  `stepBoxes`, and reconciles the full overlay tree;
- `ScoreTransportBar` — 455 lines, **not memoized**, re-renders with its parent;
- `PianoMenu`, mode shells, settings — whatever is mounted.

Play both hands at moderate speed (~10 notes/sec → ~20 events/sec) and the kiosk performs
**~20 full context-consumer render cascades per second** on a 2018 SoC — while the same
main thread is supposed to wake the transport. In Listen mode it's worse: the kiosk's *own*
scheduled notes route through `pressNote → applyNoteOn` (`useWebMidiBLE.js:160-163`), so
**machine playback generates the same per-note render storm as human playing**, plus a
`setStruck` Set copy per note in ScorePlayer (`ScorePlayer.jsx:221`).

**Fix (highest render-side leverage, benefits every mode — games, studio, waterfall):**
split the surface by volatility, mirroring what `subscribe`/`subscribeRaw` already do right:

1. **Commands + status context** (stable): `connect`, senders, `subscribe*`, `status`,
   `inputName`, `connected`. Changes ~never. Chrome, menus, transport bars live here.
2. **Live-note state** via **subscription, not context value**: expose
   `getActiveNotes()/getNoteHistory()` + a change-subscription, consumed through
   `useSyncExternalStore` by the few leaf components that genuinely display live notes
   (`PianoKeyboard` wrapper, waterfall, monitor). Only those leaves re-render per note.
3. Alternatively (smaller step): two nested providers — `PianoMidiCommandContext` and
   `PianoMidiNotesContext` — and migrate consumers. `PianoKey` is already `React.memo`
   (`PianoKeyboard.jsx:14`), so the keyboard interior is prepared; it's the *tree above it*
   that thrashes.

### R2. 🟡 Each transport event performs multiple independent `setState`s — batch to one commit per frame

Per fired step: `setStep` + `setStruck(new Set())` (`ScorePlayer.jsx:214-215`). Per fired
note: `setStruck(copy)` + (via `pressNote`) `setActiveNotes(copy)` + `setNoteHistory(copy)`.
React 18 batches same-tick updates into one commit, but the *work inside* the commit —
rebuilding Sets/Maps, re-rendering ScorePlayer + overlays + keyboard + (per R1) everything
else — runs per event burst, on the thread that times the music (until T1 decouples it).

**Fix:** after T1, drive **all** visual state from one rAF-coalesced reader: on each
animation frame, compute `{step, struckSet, activeNotes}` snapshots from refs the scheduler
maintains, and commit **one** state update per frame *only if something changed*. During a
janky 250 ms frame the UI does one catch-up commit instead of N; the music (already
scheduled) doesn't care. `NoteHighlightLayer` and the cursor need no per-event fidelity —
they can only ever be as current as the frame they paint in.

### R3. 🟡 `ScoreTransportBar` (455 lines) re-renders on every cursor step

It receives `step` (`ScorePlayer.jsx:734`) to draw a position readout, so the whole bar —
mode pills, part chips, focus chips, meta popover — reconciles at note cadence even when
nothing visible changed but a counter. Wrap it in `React.memo` and isolate the step
counter into a tiny child (or drive the counter off the same rAF snapshot as R2). Same
treatment for `RunSummary`/`MeasureGradeLayer` parents if profiling shows them hot
(`MeasureGradeLayer` is small, 49 lines, and gated to Polish+scoring — fine).

### R4. 🔵 Cursor / highlight chips move via `left/top` (layout properties)

`ScorePlayer.jsx:687-694` positions the cursor with `left/top/width/height`, and
`.piano-score-cursor` transitions those (2026-07-02 audit C2 kept the 140 ms tween;
`is-jump` teleports across systems). `NoteHighlightLayer` chips likewise set `left/top`
(`NoteHighlightLayer.jsx:37-43`). Every step therefore invalidates layout inside the huge
engraved-SVG container rather than staying compositor-only.

**Fix:** position both via `transform: translate3d(x, y, 0)` (transition `transform` only),
`will-change: transform` on the cursor, and `contain: strict` on the fixed-size chip
elements. With tiled compositing restored (`graphicsAccelerationMode=0`, performance.md)
the repaint cost of a moving 18 px box is small — but layout invalidation in a
several-thousand-node SVG document is not, and on this GPU every ms of main-thread style/
layout is a ms the (pre-T1) transport can't tick. After T1 this drops to 🔵 polish.

### R5. 🔵 Fresh `Set` identities per render for keyboard targets

`targetNotes`/`litNotes` construct new Sets every ScorePlayer render
(`ScorePlayer.jsx:654-669` via `expectedMidisAtStep`). `PianoKey`'s memo still bails
(booleans are computed per key), so the cost is the Set construction + 88 `has()` calls
per render — trivial alone, multiplied by R1's render storm. Fixing R1/R2 makes this moot;
optionally memo on `[steps, step, activeParts]`.

---

## 3. The engraving plane — load-time cost that leaks into play-time

Prior audit F1/D1 already landed the big wins (instance reuse for zoom, paint-first +
sliced extraction, abort protocol). Remaining leaks:

### E1. 🟡 Geometry extraction slices are big and layout-thrashing, and can run *during* playback

`extractLayoutSliced` (`osmdRender.js:301-350`) yields only every **256 steps**; each step
moves OSMD's cursor element (style mutation → layout invalidation) and then reads
`getBoundingClientRect` per notehead (`noteheadBox`, `osmdRender.js:122-139`) plus the
cursor's `offsetLeft/offsetParent` — i.e. **a forced synchronous reflow per cursor step,
inside a multi-thousand-node SVG**. A 256-step slice on the SM-T590 is plausibly hundreds
of ms of blocked main thread; the 2026-07-02 audit deferred this as D3 ("measure first")
and it's still live in both walk paths.

Triggers that re-run extraction while music could be playing: **zoom** (`scale` in the
effect deps, `MusicXmlRenderer.jsx:139`), **flow toggle**, **ResizeObserver** width changes,
**transpose**. The transport is not paused for any of them.

**Fixes, in order of value:**
1. **Cut `sliceSize` to 16–32 on this device** (or time-box each slice: process until
   `performance.now() - sliceStart > 8ms`, then yield). One-line, zero-risk.
2. **Pause-or-defer during playback:** if `transport.playing`, either defer extraction
   until pause (zoom/flow already repaint immediately — only overlay geometry waits) or
   auto-pause with a toast. Cheap policy, kills the worst interaction.
3. **Avoid the per-note reflow** (old D3): batch-read all notehead rects **after** the walk
   completes per system/measure, or read the cursor element's inline `style.left/top`
   (written by OSMD, no layout read) for the fallback box. Requires care to keep geometry
   identical — behind a flag, verify with `notation.geometry` fallback counters.

### E2. 🔵 First-open cost is inherent but front-loadable

`prefetchOsmd()` exists (`osmdRender.js:30`) — confirm the score **grid** calls it on mount
(prior audit said it should) so the OSMD chunk + parse happen before a score is tapped.
Load-time `score.load` telemetry already measures fetch/openToReady; keep watching it.

---

## 4. Always-on kiosk load (context for every mode)

- **`useRenderWatchdog`** (`PianoApp.jsx:324`): one rAF loop + one localhost POST/s — cheap,
  and it is the *only* aged-page truth source; keep. (Its rAF loop also makes a handy
  in-app fps read for before/after checks.)
- **`KeepAliveVideo`** (`PianoApp.jsx:263`): required per performance.md (belt-and-braces
  against the imperceptible-animation unscheduling). Keep; do not "optimize away."
- **Stale-note sweeper** (`useWebMidiBLE.js:341-364`): 2 s interval, allocates a Map copy
  per sweep even when nothing changes (returns `prev` after, so no re-render). Negligible;
  optionally guard the copy behind a first-pass scan.
- **Logging**: WS transport batches (20/1 s, `sharedTransport.js`) and notes are explicitly
  not routed through the per-message `emitOut` info logs — sane. `logger.sampled` guards
  the per-hit follow logs. No hot-path logging defect found.
- **The OS input-recency throttle remains the ceiling for *visuals*.** Even with every fix
  above, a hands-on-keys/hands-off-glass session renders at 4–8 fps until the
  `PianoTouchService` tap-wake (or another OS-level lever) is validated on hardware
  (performance.md "next steps"). The point of this audit's P0 is that **rhythm stops
  caring**: timestamped MIDI + AudioContext clicks are immune to that throttle; only the
  cursor/keyboard visuals stay frame-bound, degrading gracefully.

---

## 5. Prioritized remediation plan

| P | Item | Effort | Files | Payoff |
|---|------|--------|-------|--------|
| **P0** | **T1+T2: lookahead transport with timestamped `send()`** — coarse-timer scheduler, ~400 ms window; rAF-driven cursor as follower; pause = panic + note-off flush (existing contract) | M | `useScoreTransport.js`, `ScorePlayer.jsx`, `useWebMidiBLE.js` (reuse `scheduleNotes` shape) | Rhythm becomes immune to main-thread jank & the OS rAF throttle — the reported symptom |
| **P0** | **T3: metronome click on the AudioContext clock** (lookahead beat scheduling) | S | `click.js`, `useMetronomeClick.js` | Sample-accurate click regardless of UI load |
| **P1** | **R1: split MIDI context (commands vs live-note store via `useSyncExternalStore`)** | M | `useWebMidiBLE.js`, `PianoMidiContext.jsx`, consumers | Kills the per-note whole-kiosk render cascade; benefits all modes incl. games/studio |
| **P1** | **R2: rAF-coalesced visual state** (one commit/frame from scheduler refs); stop routing Listen's own playback through `applyNoteOn` if R1 not yet landed | S–M | `ScorePlayer.jsx` | Bounded render cost during playback bursts |
| **P1** | **E1.1/E1.2: extraction slice time-boxing (~8 ms) + defer/pause extraction while playing** | S | `osmdRender.js`, `MusicXmlRenderer.jsx`, `ScorePlayer.jsx` | Removes multi-hundred-ms stalls during zoom/resize mid-piece |
| **P2** | R3: memoize `ScoreTransportBar`, isolate step counter | S | `ScoreTransportBar.jsx` | Per-step commit shrinks to overlay-only |
| **P2** | R4: transform-based cursor/highlight positioning, `will-change`/`contain` | S | `ScorePlayer.jsx`, `NoteHighlightLayer.jsx`, `PianoApp.scss` | Compositor-only cursor motion |
| **P2** | T4: musical-time step stamps for Polish grading | S | `ScorePlayer.jsx` | Honest grades under jank |
| **P3** | E1.3: reflow-free notehead geometry (old D3, flagged + counter-verified) | M | `osmdRender.js` | Faster first-open/zoom on tablet |
| **P3** | R5: memo target/lit Sets | XS | `ScorePlayer.jsx` | Marginal after R1/R2 |

### On-device validation protocol (per performance.md pitfalls)

1. Measure on an **aged page** (>30 min uptime), screen on, no touch for ≥2 min before the
   run (to be inside the throttle) — fresh-page probes lie.
2. **Before/after per fix:** play a dense score in Listen at ♩≥120 while (a) idle-hands,
   (b) actively pinch-zooming mid-playback. Compare `score.playback.stats`
   (`meanDriftMs`/`p95DriftMs`/`stalls`) and count `score.playback.stall` warns.
3. After T1, add a `scheduledDriftMs` field (timestamp honored vs. wakeup lateness) to
   `recordFire` — the success criterion is scheduled drift ≈ 0 while wakeup drift stays
   ugly under throttle.
4. Ear test on the MDG-400: the pause-tail behavior (≤ lookahead window, panic-flushed)
   must be verified on the physical Jamcorder chain — `MIDIOutput.clear()` support on
   Chrome 149 WebView decides whether pause can be made cleaner than today.
5. Watch `piano.watchdog` episode telemetry for a week — R1 should measurably reduce
   jank-episode frequency during actual playing (fewer self-inflicted commit storms).

### Open questions

- Does Chrome 149 WebView's Web MIDI honor future timestamps over **Android BLE MIDI**
  faithfully (browser-process queue → BLE-MIDI packet timestamps)? Studio's `scheduleNotes`
  usage suggests yes in practice; confirm with a scheduled arpeggio + audio recording
  before committing to a long lookahead.
- Is `MIDIOutput.clear()` implemented (affects max safe lookahead)? If not: cap at ~400 ms.
- Whether the piano-bridge APK's `TouchPulser` tap-wake un-throttles rAF (performance.md
  open question) is orthogonal to this plan but decides how good the *visuals* can get.

---

*Prior related audits: [2026-07-02 sheet-music playback audit](./2026-07-02-piano-sheetmusic-metronome-playback-audit.md)
(tempo map / drift-free anchor / OSMD reuse — all landed; this audit builds on that as-built state),
[2026-06-22 kiosk design/UX sins](./2026-06-22-piano-kiosk-design-ux-sins-audit.md).
Device pathology reference: [piano/performance.md](../../reference/piano/performance.md).*
