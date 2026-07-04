# Sheet Music Modes — Design

Reframes the sheet-music player's four modes as a learning progression:
**Listen · Learn · Polish · Perform**. Builds on the overhaul in
`2026-07-03-sheet-music-overhaul.md` (bottom transport bar, `activeParts`,
`useFollowTracker`, `NoteHighlightLayer`, telemetry, paint-first render).

## Mode taxonomy

| Mode | Idea | Waits? | Sound | Light-up | Replaces |
|------|------|--------|-------|----------|----------|
| **Listen** | Player-piano/jukebox. Kiosk performs; you watch or play along. | no (at tempo) | kiosk plays all parts | optional play-along | `Play` + `Metronome` |
| **Learn** | Wait-for-notes practice; no tempo pressure. | yes (right notes) | you play | targets + hits | `Follow` |
| **Polish** | At-tempo, doesn't wait; per-measure R/Y/G scoring. | no (at tempo) | silent for your parts | targets + hits + measure grade | *(new)* |
| **Perform** | Static concert sheet; pedal page-turns. | n/a | you play | none | `Manual` |

Standalone **Metronome** dissolves into a **toggle** (audible click at tempo)
available in Listen and Learn, inherent in Polish.

## Shared primitives (new)

### Measure model
`processStep` tags each step with `cursor.Iterator.CurrentMeasureIndex` → every
`step` carries `measure`. Derive `measures[] = { index, number, firstStep,
lastStep, section }`. Powers tap-to-jump, focus ranges, section chips, per-measure
grading.

### Section model (rehearsal marks)
Rehearsal marks (boxed letters A/B/C or named markers) are `<rehearsal>`
directions in the MusicXML. `parseMusicXml` extracts them into
`sections[] = { label, startMeasure, endMeasure }` (a mark runs to the next mark
or piece end). No marks → no section selector (custom ranges still work). OSMD
computes marks internally but exposes no clean accessor, so parse the raw XML we
already hold.

### Focus range = whole / section / custom
A `focus: { inMeasure, outMeasure } | null`, set three ways, all feeding one
`[inMeasure, outMeasure]`:
1. Whole piece (default, `null`).
2. A **section** chip → snaps to that section's measures.
3. A **custom** bracket → tap start measure, tap end measure.
Learn and Polish clamp the cursor to the range and **wrap at the out-point** to
loop. Clear releases. Shared code path.

## Per-mode behavior

### Listen (jukebox)
- `buildPlayTimeline` with **all staves = `play`** → merged full performance onto
  the piano at tempo.
- Transport: reset · ▶/❚❚ · scrub/position · **tempo** · **key** · play-along
  toggle · metronome-click toggle.
- **Tempo:** multiplier/BPM → rebuild timeline with scaled ms (no re-engrave).
- **Key:** ± semitone → `osmd.TransposeCalculator = new TransposeCalculator();
  osmd.Sheet.Transpose = n; osmd.render()` on the paint-first/sliced-extract
  resize path. Notation AND played pitches move together (re-extraction).
- **Play-along (optional):** your MIDI lights currently-sounding noteheads green.
- No focus range, no scoring.

### Learn (wait-for-notes)
- `useFollowTracker` (all-notes-rule advance; wrong notes flash, don't advance).
- Light-up: `NoteHighlightLayer` targets → hits.
- Tap a measure/note to jump. Deactivate a staff to drill one hand.
- **Focus range** (section/custom): confine + wrap to loop the span ("successive
  retries until right").
- **Optional metronome click:** free-running reference at tempo; does NOT gate
  advancement (notes are the only exit criteria).

### Polish (at-tempo, scored)
- At-tempo cursor (transport clock) but **silent for your parts** (kiosk doesn't
  play what you should).
- **`useScoreEvaluator`** (new): per measure, compares your MIDI input to the
  expected notes (active parts), grading on **notes + timing**:
  - noteScore = fraction of expected notes struck (penalize extras lightly).
  - timingScore = from `driftMs` vs `timingToleranceMs`.
  - combined vs config `thresholds` → **red / yellow / green**, painted on the
    measure as the cursor leaves it.
- **Auto-stop** after `silentMeasuresToStop` (config) empty measures → run
  **summary** (per-measure strip + overall grade).
- **Focus range** loops the span at tempo, re-scored each pass.
- **Scoring toggle** — off = plain at-tempo play-along, no colors/summary.

### Perform (concert)
- Static sheet; no cursor, light-up, follow, or scoring.
- Page turn by config pedal: `advancePedalCC` (default 67, una corda) forward,
  `backPedalCC` (default 66, sostenuto) back; rising-edge; `scrollBy` a viewport.
- Subtle page indicator ("2 / 5").

## Config (`piano.yml` → `sheetmusic:`)
```yaml
sheetmusic:
  defaultMode: learn
  perform: { advancePedalCC: 67, backPedalCC: 66 }
  scoring:
    silentMeasuresToStop: 4
    timingToleranceMs: 80
    thresholds: { green: 0.9, yellow: 0.6 }
```

## Transport bar (mode-aware)
Same pinned bar, four tabs **Listen·Learn·Polish·Perform**, different clusters:
- Listen: tempo · key · scrub · play-along · click
- Learn: section+focus · click · parts
- Polish: section+focus · scoring toggle · parts
- Perform: page indicator

## Logging & observability (both frameworks)
Frontend `getLogger().child({ component, app: 'piano-sheetmusic' })` → buffered WS
→ backend `ingestFrontendLogs` → dispatcher → console + file + Loggly, **plus a
per-session JSONL** when `context.sessionLog` is set.

- **Session-scoped practice log:** on score open / Learn / Polish run, emit
  `session-log.start` (context `app: 'piano-sheetmusic'`, `sessionLog: true`) and
  tag that run's events `sessionLog: true`. The whole attempt (load phases, every
  `follow.timing` / `polish.measure` with its ms drift, stalls, summary) lands in
  one ordered, wall-clock-stamped `media/logs/piano-sheetmusic/{ts}.jsonl` — the
  beat-by-beat record.
- **Event catalog:** `score.load`, `score.playback.stall/stats`,
  `score.follow.timing/stats`, `score.polish.measure/summary`, `score.focus.set`,
  `score.transpose`, `score.mode`, `notation.geometry`. Streams at
  `debug`+`sampled`; lifecycle `info`; stalls `warn`.
- **Backend knobs:** register the component in `config/logging.yml`
  (`loggers:`/`componentLevels:`) + `LOG_LEVEL_*` env overrides; session logs
  prune after `maxAgeDays`.

## Testing
Pure-unit (DOM-free, TDD): section extraction, measure model, focus-range
clamp/wrap, evaluator notes+timing→R/Y/G, tempo rescale. Component: mode-aware
bar, section chips. Live/on-device: OSMD transpose, pedal page-turn, paint under
transpose, session JSONL contents.
