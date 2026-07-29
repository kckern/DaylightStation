# Sheet Music Player

The piano kiosk's engraved-score mode: browse a folder of scores, open a MusicXML
file, and follow / auto-play it with per-notehead light-up. Lives in
`frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/`, engraving through the
shared OSMD renderer in `frontend/src/modules/MusicNotation/renderers/`.

## Chrome layout

- **Top:** the standard always-on breadcrumb (`PianoChrome`) — `🎹 › Sheet
  Music › [thumb] {title} › ⦿ {Mode}`. The mode publishes two crumbs via
  `usePianoBreadcrumb`: a title crumb carrying a small square score thumbnail,
  and a trailing **mode crumb** (icon + the current mode's name — Listen,
  Learn, Polish, or Perform). The mode crumb is tappable even though it's the
  last (current) segment: it opens a centered **Mode** sheet listing all four
  modes with their icons; picking one switches modes and closes the sheet.
  This is how **every** mode — including Perform — changes mode; there is no
  in-bar mode selector. Back = the breadcrumb's parent crumb. Score titles
  come from the score's own metadata (an explicit title, then the MusicXML's
  embedded work title); a score with neither falls back to a title derived
  from its filename rather than showing a bare "Score".
- **Bottom:** a pinned `ScoreTransportBar` (`ScoreTransportBar.jsx`) with a
  **stable three-zone grid**: an empty left zone (keeps the center cluster
  truly centered) · metronome, restart, play/pause, **Loop**, position readout
  (center) · Hands toggles, Key, Tempo, View menu, **Volume** (right). The
  geography never reshuffles — modes **disable/dim controls in place** instead
  of unmounting them, so Play is always where Play was; **Perform** is the
  sole exception (bar strips to just the page indicator). One button grammar
  throughout: shared inline-SVG icons (no text glyphs/emoji), ≥48px touch
  targets, one radius, **blue = a setting is on** (metronome armed, loop
  active), **green = the transport is running**, and a chevron on every button
  that opens a popover or sheet.
  **Key, Tempo, and Loop are modal sheets**, not popovers: tapping the button
  opens a centered modal sheet with its own scrim, a direct-pick ladder of
  steps, and a close affordance — one tap commits and dismisses, so there's no
  separate "confirm" step. The **View** menu is the same sheet shell —
  layout, size, and keyboard-visibility controls only, no metadata list; size
  is a discrete tap-commit stepper, so the score repaints once per step.
  **Volume** opens the same volume sheet every player in the kiosk uses —
  Media and MIDI levels as five-step ladders, with a Log/Linear curve toggle —
  so turning the piano or the media down works identically here as in
  Karaoke, Music, or a video course.

## Browsing scores

The score grid is a Courses-style browser: `sheetmusic.collections` in
`piano.yml` names an ordered set of `{label, ref}` folders/collections, each
becoming a tab (`Video Games`, `TV Shows`, …) above the grid; a household with
a single collection gets the tabless grid unchanged. The last tab a player
picked is remembered per device, so returning to Sheet Music opens where they
left off.

## Modes — a learning progression

Four modes, **Listen · Learn · Polish · Perform**, selected from the header's
Mode sheet (see "Chrome layout" above). The bar is **mode-aware**: controls a
mode doesn't use disable/dim in place (only Perform unmounts them). The
metronome is an icon-only **click toggle** (audible tempo reference), not a
mode — see "Metronome" below for its per-mode semantics.

| Mode | Idea | Cursor | Light-up | Sound |
|------|------|--------|----------|-------|
| **Listen** | Jukebox / player-piano | auto, at tempo (settable) | play-along green (always on) | kiosk performs **all** parts |
| **Learn** | Wait-for-notes practice | waits — advances only when all active-part notes of the step are struck | dim `target` → green `hit`; wrong notes flash | you play |
| **Polish** | At-tempo, scored | auto, at tempo | current onset lights (bouncing ball) + measure R/Y/G washes | silent for your parts |
| **Perform** | Concert / recital | none (config pedal turns pages) | none | you play |

- **Listen** (`playParts.allPlayRoles` → `buildPlayTimeline` → `scaleTimeline`): the
  kiosk plays everything; a **tempo** control (multiplier, cheap timeline rescale)
  and a **key** control (± semitone, OSMD transpose — see below); **play-along**
  light-up marks notes green as you match them (always on, non-gating). With a
  loop active, **Listen plays only the loop**.
- **Learn** (`useFollowTracker`): notes-only exit criteria, no timing pressure. The
  loop confines practice; the metronome free-runs at the practice tempo
  (reference-only — never gates).
- **Polish** (`useScoreEvaluator`): the clock runs; each completed measure is graded
  and washed R/Y/G; after N silent measures a **run summary** appears. The loop
  repeats at tempo; **scoring is always on** during Polish runs.
- **Perform**: static sheet; `advancePedalCC` (default 67) / `backPedalCC` (default
  66) turn pages (rising-edge, config-driven); a `page / pages` indicator.

The current-step notehead itself is recolored directly on the engraved SVG
rather than drawn as an overlay: it takes a subtle near-black ink, the same
fixed shade in every mode (only the cursor band keeps the per-mode accent
color). A note struck correctly glows green with a soft drop-shadow — a fixed
color, independent of mode or the current-step ink, so "hit" always reads the
same regardless of what's playing. In Learn, a note still owed a strike shows
an unfilled, gently pulsing outline until it's struck.

## Active parts (full-hand model)

`activeParts.js` is the single "which staves am I responsible for" model, shared by
Learn/Polish advancement + grading, note light-up, and the keyboard target set.
Staves are 0-indexed (`0`=RH, `1`=LH, …); **default = all staves on (full hand)**.
A standard two-staff (grand-staff) piano score gets **two icon-only hand
toggles** in the bar's right zone (a hairline divider sets them apart from the
neighboring view controls) — no text label, just the left-/right-hand glyphs,
lit when that staff is active. In Learn/Polish they toggle a staff on/off, and
the last active staff can't be toggled off (would deadlock Learn). In Listen
both toggles can go off together — that's the kiosk-plays-everything state,
nothing is marked "yours" to light up — or either/both can be on to mark that
hand's part as yours to play along with. A score with more than two staves
falls back to one labeled chip per staff instead of the hand icons: Learn/Polish
toggle a chip on/off, and Listen cycles each chip through Play/You/Mute.
Advancement uses the **all-notes rule** — every expected midi at a step must
be struck. A left-hand-only intro is a real cursor stop (see alignment note).

## The loop (focus range & sections)

`focusRange.js` confines practice to `[inMeasure, outMeasure]` and **loops** it
(wrap at the out-point). The loop is a first-class transport control: a
**repeat-icon** toggle in the center zone. With no range set, tapping it
starts the on-score two-tap selection immediately (see "Select measures…"
below). Once a range exists, the same tap toggles looping on/off **without
losing the range** — the toggle then also carries the range's scope label
(e.g. "m9–16") as a secondary cue, lit when looping is on. A one-tap ✕ clear
sits beside it whenever a range is active. A separate chevron opens the Loop
sheet, which offers, all feeding one range:
- **A section** — rehearsal marks (`<rehearsal>` letter/named blocks) parsed from
  the MusicXML by `parseMusicXml.extractSections` → `layout.sections`; picking one
  snaps the range to that section (`sectionToRange`, mapping XML measure
  **numbers** to measure **indices**).
- **Select measures…** — the guided two-tap flow (tap the start measure, then the
  end). Taps farther than `SELECT_MAX_DIST` from any note — margins, between
  systems, blank paper — are rejected rather than snapped to the mathematically
  nearest note (`nearestEvent.js`).
- **±1-measure nudges** — when a loop is active, Start/End −/+ rows adjust either
  endpoint without redoing the selection (the menu stays open so endpoints can be
  walked).

Loop semantics:
- **Follows Listen ↔ Learn ↔ Polish.** Hop to Listen to hear the passage, back to
  Learn to drill it — the range survives. It is **cleared** on entering Perform
  or opening a new score.
- **Restart returns to the loop in-point** (`homeStep`), not measure 1.
- In Listen, a loop that ends at the piece's final measure wraps at `onDone` (a
  one-beat dwell covers the zero-span edge).
- The on-score tint draws **one band per system** the range spans
  (`FocusRangeLayer`), so a loop across a line break highlights exactly its own
  measures; the endpoint brackets mark in/out.

The **measure model** (`osmdRender.buildMeasures`) tags each step with its OSMD
measure `index` and XML `number`, giving `measures[] = {index, number, firstStep,
lastStep}` — the basis for tap-to-jump, ranges, chips, and per-measure grading.

## Metronome

One icon-only toggle beside Play — a quarter-note glyph, no BPM readout on its
own face (the effective BPM lives on the Tempo chip instead; `useMetronomeClick`
keeps the exact bpm regardless). Per-mode semantics:
- **Learn** — a **free-running** click at the practice tempo: toggling it ON
  starts the beat immediately, transport running or not. Session-local by design
  (not persisted) — it's an ambient practice aid, not a score setting.
- **Polish** — the toggle **arms** a reference click that sounds only while a run
  is playing; the armed state persists per score.
- **Listen / Perform** — no metronome.

The Tempo chip's face is a quarter-note icon + the effective BPM
(`round(baseBpm × tempoMult)`); tapping it opens a 3×3 grid of percent steps
(50, 60, 70, 80, 90, 100, 110, 125, 150 — finer resolution near 100%, coarser
toward the extremes), each cell sub-labeled with the BPM it produces, so a
step always reads against a concrete ♩ value rather than a bare percentage.

## Per-score persistence

`scoreSettings.js` stores `mode, tempoMult, focus, activeParts, myStaves,
clickOn` per score — device-local (`localStorage`, key `daylight.piano.sm.<id>`,
merge-on-write, degrades to no-op without storage) — so a walk-up user finds a
piece exactly the way they left it. The Learn free-run click is deliberately
excluded (session-local, above).

## Polish scoring

`scoreEvaluator.gradeMeasure` grades each measure on **notes + timing**:
`noteScore` = fraction of expected midis struck; `timingScore` = from each hit's
`driftMs` vs `scoring.timingToleranceMs`; `combined = noteScore·(0.6+0.4·timingScore)`
→ **green / yellow / red** per `scoring.thresholds`. `useScoreEvaluator` buffers
your input per measure (multi-subscriber `subscribe`), grades on measure advance,
and fires an auto-stop after `scoring.silentMeasuresToStop` silent measures.
`MeasureGradeLayer` washes graded measures; `RunSummary` shows the strip + tallies.

## Key transpose (Listen · Learn · Polish)

The Key sheet's grid cells speak **sounding key names** — each cell's primary
label is the key that offset produces (e.g. "D major"), with the semitone
offset (`+2`, `0`, `−6`, …) as a sub-label; a score with no written key falls
back to offset-only cells. Picking a step sets `osmd.TransposeCalculator` +
`osmd.Sheet.Transpose` and re-engraves on the paint-first path (transpose is
part of the renderer `cacheKey`, so a change re-parses cleanly and re-extracts
pitches — notation **and** playback move to the new key). Returning to 0
restores the written key; transpose resets on a new document. The control is
live in all three practice modes — Learn and Polish transpose the engrave
their advancement and grading read from, so practice stays consistent with
what's sounding — and is unavailable only in Perform (no chrome at all).

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
| `piano.score-open-failed` | warn | `id, error` — the score's XML fetch failed. Emitted from `SheetMusic.jsx` (`NotationScore`), not this hook: a failed fetch renders `PianoEmpty` and never mounts `ScorePlayer`. It carries `app: 'piano-sheetmusic', sessionLog: true` on its own context so it still lands in the run's session file without creating a second one. |
| `score.playback.stall` | debug | `step, driftMs, gapMs, effectiveBpm, stallMs` (drift past a tempo-scaled budget, or a tick gap that skipped whole ticks) |
| `score.playback.stats` | info | `mode, events, meanDriftMs, p95DriftMs, maxDriftMs, stalls, maxFrameGapMs` (at pause/stop/done/unmount) |
| `score.follow.timing` | sampled | `step, note, sinceAdvanceMs` (how long the player took to answer the cursor — no verdict) |
| `score.follow.stats` | info | `hits, wrongs, count, medianStepMs, p95StepMs` (on leaving Learn) |
| `score.polish.measure` | info | `measure, grade, noteScore, timingScore` (per graded measure) |
| `score.polish.summary` | info | `greens, yellows, reds, overall` (at run end) |
| `score.focus.set` | info | `kind (section/custom), inMeasure, outMeasure` |
| `score.transpose` | info | `semitones` |
| `score.mode` | info | `mode` |
| `notation.geometry` | debug | `total, graphical, fallback` (per-notehead vs cursor-box fallback counts) |
| `session-log.start` | info | `scoreId` — opens the per-session JSONL |

**Reading "on beat":** transport jitter is `driftMs` = actual fire time − scheduled
`t`; single-digit ms = tight, a `score.playback.stall` = a stutter.

**Learn timing is descriptive, not graded.** Learn is SELF-PACED — the cursor waits
for the player and advances only once every active-staff note of the step is struck
— so there is nothing to be late for. `score.follow.timing.sinceAdvanceMs` is simply
how long the player took to answer, and `score.follow.stats` reports the median and
p95 of those intervals. It passes no rush/tight/drag verdict: the old shape compared
the response against the written note duration (~94ms in most records), which made
every human response a `drag` and `tight` unreachable — 24 of 31 field records were
`drag`, up to 47s (audit M5b). `classifyFollowHit` still exists in `scoreTelemetry.js`
for Polish, which IS graded at tempo, but the Learn path no longer calls it.

**`score.playback.stall` is debug-level** — on a bad run it fires per tick, so
the count you want is `stalls` in `score.playback.stats`. Raise the level with
`window.DAYLIGHT_LOG_LEVEL='debug'` only while investigating a specific run.
Its `effectiveBpm` is the tempo the music is actually playing at (written bpm ×
`tempoMult`), so it will NOT match the `bpm` on `score.transport.play`, which
logs the written tempo and `tempoMult` as separate fields.

**Per-session practice log.** The telemetry child logger carries
`app: 'piano-sheetmusic'` + `sessionLog: true`, and `startSession(scoreId)` emits
`session-log.start` on score open. The backend `sessionFile` transport then writes
the whole run — load phases, every `follow.timing`/`polish.measure` with its ms
drift, stalls, and the summary — to one ordered, wall-clock-stamped
`media/logs/piano-sheetmusic/{ts}.jsonl`: the beat-by-beat record of a practice
attempt. Level is dialable via `config/logging.yml` (`loggers: { piano-sheetmusic }`,
gitignored/deployment-managed) or `LOG_LEVEL_*`.

## Config (`piano.yml` → `sheetmusic:`)

Resolved (with defaults) by `sheetMusicConfig.resolveSheetMusicConfig`:
```yaml
sheetmusic:
  defaultMode: learn
  perform: { advancePedalCC: 67, backPedalCC: 66 }
  scoring:
    silentMeasuresToStop: 4     # Polish auto-stop
    timingToleranceMs: 80       # inside this = on-beat
    thresholds: { green: 0.9, yellow: 0.6 }   # combined note+timing score
```

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
| `ScoreGrid.jsx` / `scoreGroups.js` | score browser grid + `sheetmusic.collections` → tab strip |
| `scoreTitle.js` | filename → title fallback shared by the grid and the player |
| `ScorePlayer.jsx` | orchestrator: modes, transport, overlays, telemetry wiring |
| `ScoreTransportBar.jsx` | pinned bottom bar (presentational, three-zone grid) |
| `ModeSheet.jsx` | header mode crumb's Listen/Learn/Polish/Perform picker |
| `LoopControl.jsx` | Loop repeat-icon toggle button, opens the shared Loop sheet (sections · select measures · nudges · clear) |
| `HandsControl.jsx` | icon-only left/right-hand toggle (grand-staff scores) |
| `ViewSheet.jsx` | layout/size/keyboard-visibility sheet (controls only, no metadata) |
| `../../transport/` | shared transport primitives: the button, sheet shell, direct-pick step ladder, and the Key/Tempo/Loop/Volume sheets themselves |
| `../../icons/Icon.jsx` | shared inline-SVG icon set for all chrome buttons |
| `nearestEvent.js` | tap→note mapping with `SELECT_MAX_DIST` miss rejection |
| `scoreSettings.js` | per-score localStorage persistence |
| `NoteHighlightLayer.jsx` / `MeasureGradeLayer.jsx` | per-notehead chips / per-measure R/Y/G washes |
| `FocusRangeLayer.jsx` | loop brackets + per-system tint bands |
| `countIn.js` / `useCountIn.js` | count-in beats before a run |
| `clickScheduler.js` | look-ahead scheduling for the metronome click |
| `RunSummary.jsx` | Polish end-of-run summary |
| `activeParts.js` / `focusRange.js` | staff-responsibility model / practice-range math |
| `useFollowTracker.js` | Learn matching + advancement (range-aware) |
| `useScoreEvaluator.js` / `scoreEvaluator.js` | Polish per-measure grading hook / math |
| `useMetronomeClick.js` / `click.js` | click scheduler / WebAudio blip |
| `pedalEdge.js` | Perform pedal rising-edge |
| `sheetMusicConfig.js` | `sheetmusic:` config resolver (modes, pedals, scoring) |
| `useScoreTransport.js` | rAF playback engine (+ `onFire` jitter) |
| `useScoreTelemetry.js` / `scoreTelemetry.js` | logs-only telemetry + session log / math |
| `playParts.js` | Listen roles + merged/full-performance timeline |
| `../../MusicNotation/parseMusicXml.js` | parser + `extractSections` (rehearsal marks) |
| `../../MusicNotation/renderers/osmdRender.js` | OSMD adapter: engrave, sliced extract, geometry, transpose, measure model |
| `../../MusicNotation/renderers/MusicXmlRenderer.jsx` | React wrapper: paint-first + progress + transpose |

Design/history: `docs/plans/2026-07-03-sheet-music-overhaul.md` (infra),
`docs/plans/2026-07-03-sheet-music-modes-design.md` + `-modes.md` (four modes).
