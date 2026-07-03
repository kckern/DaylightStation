# Sheet Music Player

The piano kiosk's engraved-score mode: browse a folder of scores, open a MusicXML
file, and follow / auto-play it with per-notehead light-up. Lives in
`frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/`, engraving through the
shared OSMD renderer in `frontend/src/modules/MusicNotation/renderers/`.

## Chrome layout

- **Top:** the standard always-on breadcrumb (`PianoChrome`) only — `🎹 › Sheet
  Music › {title}`. The mode publishes its title crumb via `usePianoBreadcrumb`;
  it does **not** render its own header. Back = the breadcrumb's mode crumb.
- **Bottom:** a pinned `ScoreTransportBar` (`ScoreTransportBar.jsx`) holds all
  controls — mode tabs (left), the playback cluster (reset · ▶/❚❚ · position,
  center), and view/parts (right): per-staff part chips, keyboard toggle, flow
  toggle, a single **Size** button (opens a modal; scale commits on release, so
  the score repaints once, not per drag), and an ⓘ metadata popover.

## Modes

| Mode | Cursor advance | Light-up | Sound |
|------|----------------|----------|-------|
| **Follow** | on your MIDI input, when all active-part notes of the step are struck | noteheads: dim `target` → green `hit` as you play them; wrong notes flash | you play the piano |
| **Metronome** | auto, at tempo | current onset's active-part noteheads light (bouncing ball) | silent (no `pressNote`) |
| **Play** | auto, at tempo | played (`play`-role) notes light as they sound; `you`-role notes show as targets | kiosk performs the `play`/`you` parts per role |
| **Manual** | none (sostenuto CC66 pedal / tap / swipe turn the page) | none | you play the piano |

## Active parts (full-hand model)

`activeParts.js` is the single "which staves am I responsible for" model, shared by
Follow advancement, note light-up, and the keyboard target set. Staves are
0-indexed (`0`=RH, `1`=LH, …); **default = all staves on (full hand)**. Per-staff
chips in the bar toggle a staff on/off (Follow/Metronome) or cycle its Play role
(`play`/`you`/`mute`). The last active staff can't be toggled off (would deadlock
Follow). Advancement uses the **all-notes rule** — every expected midi at a step
must be struck. A left-hand-only intro is a real cursor stop (see alignment note).

## Load pipeline (paint-first, non-blocking)

The freeze users saw came from doing OSMD load + render + full geometry extraction
in one main-thread block. The pipeline now decouples paint from extraction:

1. **Prefetch** — `prefetchOsmd()` warms the lazy `opensheetmusicdisplay` chunk
   when the score **grid** mounts, so the engine is loaded before a score opens.
2. **Fetch** the MusicXML (`SheetMusic.jsx`).
3. **`osmdEngrave`** — load + `render()` only → returns dims. The sheet **paints
   here** and Manual mode is immediately usable.
4. **`extractLayoutSliced`** — the geometry walk (cursor → per-notehead boxes),
   run in **yielded ~256-step slices** (`runSliced`/`scheduleYield`) so the main
   thread stays responsive; a determinate `.musicxml-renderer__progress` bar
   covers it. On completion, `onLayout(...)` + `onReady()` arm Follow/Play.
5. **Zoom/resize** takes the cheap path: `osmdRepaint` (paint-only, no extract) +
   one sliced extract — no blocking double-walk.

`extractEvents` (sync) and `extractLayoutSliced` (yielded) share one `processStep`
closure, so their output can't diverge.

### events / steps alignment

`extractEvents` returns both `events` (the cursor track) and `steps` (per-onset,
all-staff notehead geometry). `events` is **derived from `steps`** — one entry per
onset, index-aligned — so a single `step` integer indexes the cursor and the
light-up interchangeably, **including left-hand-only onsets** (which have no
top-staff melody note but must still be cursor stops). `events[i].midi` is the
representative pitch: top-staff highest, else overall highest.

## Telemetry (logs-only)

All timing goes through the logging framework (`component: 'piano-score-player'`;
geometry counts under `osmd-render`), measured with `performance.now()` and
stamped to wall-clock by the framework. Math is in `scoreTelemetry.js`; collection
+ emit in `useScoreTelemetry.js`.

| Event | Level | Fields |
|-------|-------|--------|
| `score.load` | info | `id, fetchMs, openToReadyMs, steps, …` (phase totals) |
| `score.load.failed` | warn | `id, phase, error` |
| `score.playback.stall` | warn | `step, driftMs, gapMs, bpm` (fire later than ~120 ms, or a >50 ms frame gap) |
| `score.playback.stats` | info | `mode, events, meanDriftMs, p95DriftMs, maxDriftMs, stalls, maxFrameGapMs` (at pause/stop/done/unmount) |
| `score.follow.timing` | sampled | `step, note, expectedMs, actualMs, driftMs, feel` (rush/tight/drag) |
| `score.follow.stats` | info | `hits, wrongs, meanAbsDriftMs, rushPct, dragPct` (on leaving Follow) |
| `notation.geometry` | debug | `total, graphical, fallback` (per-notehead vs cursor-box fallback counts) |

**Reading "on beat":** transport jitter is `driftMs` = actual fire time − scheduled
`t`; single-digit ms = tight, a `score.playback.stall` = a stutter. In Follow,
`score.follow.timing.driftMs` is signed (− rush, + drag) vs the notated rhythm.

## Note geometry fallback

Per-notehead boxes come from `osmd.EngravingRules.GNote(note).getSVGGElement()`
measured relative to the cursor's `offsetParent` (same coordinate space as the
cursor). If that's unavailable for a note it falls back to the cursor-band box
(coarser, per-step). `notation.geometry` logs the hit/fallback split — if
`graphical` is ~0, per-notehead precision isn't working and the light-up is
running on the per-step fallback (keyboard stays note-precise regardless).

## Key files

| File | Role |
|------|------|
| `SheetMusic.jsx` | routing (grid ↔ viewer), MusicXML fetch + load timing |
| `ScorePlayer.jsx` | orchestrator: modes, transport, overlays, telemetry wiring |
| `ScoreTransportBar.jsx` | pinned bottom bar (presentational) |
| `NoteHighlightLayer.jsx` | per-notehead `target`/`hit`/`missed` chips |
| `activeParts.js` | full-hand staff-responsibility model |
| `useFollowTracker.js` | Follow-mode matching + advancement |
| `useScoreTransport.js` | rAF playback engine (+ `onFire` jitter) |
| `useScoreTelemetry.js` / `scoreTelemetry.js` | logs-only telemetry emit / math |
| `playParts.js` | Play-mode roles + merged play timeline |
| `../../MusicNotation/renderers/osmdRender.js` | OSMD adapter: engrave, sliced extract, geometry |
| `../../MusicNotation/renderers/MusicXmlRenderer.jsx` | React wrapper: paint-first + progress |

Design/history: `docs/plans/2026-07-03-sheet-music-overhaul.md`.
