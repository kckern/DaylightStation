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

## Modes — a learning progression

Four modes, **Listen · Learn · Polish · Perform**, selected by the bar's tabs. The
bar is **mode-aware** (each mode shows only its relevant cluster). Standalone
metronome is a **click toggle** (audible tempo reference), not a mode.

| Mode | Idea | Cursor | Light-up | Sound |
|------|------|--------|----------|-------|
| **Listen** | Jukebox / player-piano | auto, at tempo (settable) | optional play-along green | kiosk performs **all** parts |
| **Learn** | Wait-for-notes practice | waits — advances only when all active-part notes of the step are struck | dim `target` → green `hit`; wrong notes flash | you play |
| **Polish** | At-tempo, scored | auto, at tempo | current onset lights (bouncing ball) + measure R/Y/G washes | silent for your parts |
| **Perform** | Concert / recital | none (config pedal turns pages) | none | you play |

- **Listen** (`playParts.allPlayRoles` → `buildPlayTimeline` → `scaleTimeline`): the
  kiosk plays everything; a **tempo** control (multiplier, cheap timeline rescale)
  and a **key** control (± semitone, OSMD transpose — see below); an optional
  **play-along** toggle lights notes green as you match them (non-gating).
- **Learn** (`useFollowTracker`): notes-only exit criteria, no timing pressure. A
  **focus range** and an optional **click** (reference-only — never gates).
- **Polish** (`useScoreEvaluator`): the clock runs; each completed measure is graded
  and washed R/Y/G; after N silent measures a **run summary** appears. Focus range
  loops at tempo; **scoring is toggleable**.
- **Perform**: static sheet; `advancePedalCC` (default 67) / `backPedalCC` (default
  66) turn pages (rising-edge, config-driven); a `page / pages` indicator.

## Active parts (full-hand model)

`activeParts.js` is the single "which staves am I responsible for" model, shared by
Learn/Polish advancement + grading, note light-up, and the keyboard target set.
Staves are 0-indexed (`0`=RH, `1`=LH, …); **default = all staves on (full hand)**.
Per-staff chips toggle a staff on/off (Learn/Polish) or cycle its Listen role
(`play`/`you`/`mute`). The last active staff can't be toggled off (would deadlock
Learn). Advancement uses the **all-notes rule** — every expected midi at a step
must be struck. A left-hand-only intro is a real cursor stop (see alignment note).

## Focus range & sections (Learn + Polish)

`focusRange.js` confines practice to `[inMeasure, outMeasure]` and **loops** it
(wrap at the out-point). Set three ways, all feeding one range:
- **Whole piece** (default).
- **A section** — rehearsal marks (`<rehearsal>` letter/named blocks) parsed from
  the MusicXML by `parseMusicXml.extractSections` → `layout.sections`; a chip snaps
  the range to that section (`sectionToRange`, mapping XML measure **numbers** to
  measure **indices**).
- **A custom bracket** — tap the start measure, then the end measure.

The **measure model** (`osmdRender.buildMeasures`) tags each step with its OSMD
measure `index` and XML `number`, giving `measures[] = {index, number, firstStep,
lastStep}` — the basis for tap-to-jump, ranges, chips, and per-measure grading.

## Polish scoring

`scoreEvaluator.gradeMeasure` grades each measure on **notes + timing**:
`noteScore` = fraction of expected midis struck; `timingScore` = from each hit's
`driftMs` vs `scoring.timingToleranceMs`; `combined = noteScore·(0.6+0.4·timingScore)`
→ **green / yellow / red** per `scoring.thresholds`. `useScoreEvaluator` buffers
your input per measure (multi-subscriber `subscribe`), grades on measure advance,
and fires an auto-stop after `scoring.silentMeasuresToStop` silent measures.
`MeasureGradeLayer` washes graded measures; `RunSummary` shows the strip + tallies.

## Key transpose (Listen)

`± semitone` sets `osmd.TransposeCalculator` + `osmd.Sheet.Transpose` and re-engraves
on the paint-first path (transpose is part of the renderer `cacheKey`, so a change
re-parses cleanly and re-extracts pitches — notation **and** playback move to the
new key). Returning to 0 restores the written key. Reset on new document.

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
| `score.follow.stats` | info | `hits, wrongs, meanAbsDriftMs, rushPct, dragPct` (on leaving Learn) |
| `score.polish.measure` | info | `measure, grade, noteScore, timingScore` (per graded measure) |
| `score.polish.summary` | info | `greens, yellows, reds, overall` (at run end) |
| `score.focus.set` | info | `kind (section/custom), inMeasure, outMeasure` |
| `score.transpose` | info | `semitones` |
| `score.mode` | info | `mode` |
| `notation.geometry` | debug | `total, graphical, fallback` (per-notehead vs cursor-box fallback counts) |
| `session-log.start` | info | `scoreId` — opens the per-session JSONL |

**Reading "on beat":** transport jitter is `driftMs` = actual fire time − scheduled
`t`; single-digit ms = tight, a `score.playback.stall` = a stutter. In Learn,
`score.follow.timing.driftMs` is signed (− rush, + drag) vs the notated rhythm.

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
| `ScorePlayer.jsx` | orchestrator: modes, transport, overlays, telemetry wiring |
| `ScoreTransportBar.jsx` | pinned bottom bar (presentational) |
| `NoteHighlightLayer.jsx` / `MeasureGradeLayer.jsx` | per-notehead chips / per-measure R/Y/G washes |
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
