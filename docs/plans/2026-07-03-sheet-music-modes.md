# Sheet Music Modes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reframe the sheet-music player as four learning-progression modes — **Listen · Learn · Polish · Perform** — with a measure model, XML-sourced sections, a shared focus-range/loop, per-measure R/Y/G scoring (notes + timing), key transpose, config-defined pedal page-turns, and per-session JSONL logging.

**Architecture:** Extends the overhaul (`2026-07-03-sheet-music-overhaul.md`): bottom `ScoreTransportBar`, `activeParts`, `useFollowTracker`, `NoteHighlightLayer`, `useScoreTransport` (+`onFire`), `useScoreTelemetry`, paint-first `MusicXmlRenderer`. New pure modules (measure model, sections, focus range, scoring) are DOM-free and TDD'd; OSMD-touching bits (transpose, measure index) ride the existing `osmdRender.js` walk + resize path and are verified live. Design: `2026-07-03-sheet-music-modes-design.md`.

**Tech Stack:** React 18, react-router, Vitest + @testing-library/react, OpenSheetMusicDisplay 2.0 (installed, lazy), the frontend + backend logging frameworks.

---

## Context the executor needs

**Key files (all exist):**
- Mode host: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx`
- Bottom bar: `.../SheetMusic/ScoreTransportBar.jsx`
- Active parts: `.../SheetMusic/activeParts.js`
- Follow tracker: `.../SheetMusic/useFollowTracker.js`
- Transport: `.../SheetMusic/useScoreTransport.js` (has `onFire(ev, driftMs, gapMs)`)
- Telemetry: `.../SheetMusic/useScoreTelemetry.js` + `scoreTelemetry.js`
- Play timeline / roles: `.../SheetMusic/playParts.js`
- Light-up: `.../SheetMusic/NoteHighlightLayer.jsx`
- OSMD adapter: `frontend/src/modules/MusicNotation/renderers/osmdRender.js` (shared `makeCursorWalk`/`processStep`; `extractEvents`/`extractLayoutSliced`; `osmdEngrave`/`osmdRepaint`/`osmdReRender`; each `step` = `{ onsetQuarter, notes:[{midi,staff,x,top,bottom,width}] }`; `events` derived from `steps`, index-aligned)
- React renderer: `.../renderers/MusicXmlRenderer.jsx` (`onLayout`, `onProgress`, `onReady`)
- MusicXML parser: `frontend/src/modules/MusicNotation/parseMusicXml.js` (DOM parse; returns `{ divisions, tempo, timeSig, key, title, parts:[{ measures:[{number, notes}] }] }`)
- Timeline math: `.../MusicNotation/scoreTimeline.js` (`buildTempoMap`, `msAtQuarter`, `buildStepTimeline`, `buildNoteTimeline`)
- Styles: `frontend/src/Apps/PianoApp.scss` (`piano-score-*`)
- Config read: `usePianoKioskConfig()` in `.../PianoKiosk/PianoConfig.jsx`; live config file `data/household[-{hid}]/config/piano.yml` (cached at startup — nodemon touch to reload)
- Frontend logger: `import getLogger from '.../lib/logging/Logger.js'`; `getLogger().child({ component, app })`. Session file transport writes `media/logs/{app}/{ts}.jsonl` when an event has `context.sessionLog` and a `session-log.start` opened the session (see `backend/src/0_system/logging/transports/sessionFile.mjs`, `ingestion.mjs`).
- Backend log config: `config/logging.yml` (`loggers:` per-name level, `componentLevels:` per-source) + `LOG_LEVEL_*` env.

**OSMD facts (verified from installed 2.0 type defs):**
- Transpose: `import { TransposeCalculator } from 'opensheetmusicdisplay'`; `osmd.TransposeCalculator = new TransposeCalculator(); osmd.Sheet.Transpose = <semitones>; osmd.render();`
- Measure index at a cursor stop: `cursor.Iterator.CurrentMeasureIndex` (0-based).

**Testing:** run one file `npx vitest run <path>` (config `vitest.config.mjs`, jsdom). NEVER pass `--reporter=line` (fails to load here). rAF/timer pattern: copy `useScoreTransport.test.js`. OSMD can't run in jsdom — keep OSMD calls behind pure functions and test those; OSMD-driven behavior is verified live.

**Conventions:** never raw `console.*` (use the logging framework); `.js` utils/hooks, `.jsx` components; relative router nav; commit after each task; TDD (failing test first). Match existing code idiom/comment density.

**Verification-before-completion:** the final phase drives the real player on the kiosk (OSMD-dependent behavior can't be locally live-tested).

---

## Phase 1 — Foundations (pure, DOM-free)

### Task 1: Sections from MusicXML rehearsal marks

**Files:**
- Modify: `frontend/src/modules/MusicNotation/parseMusicXml.js`
- Test: `frontend/src/modules/MusicNotation/parseSections.test.js` (new)

**Step 1: Failing test** — a pure exported `extractSections(doc | xml)`:
```javascript
import { describe, it, expect } from 'vitest';
import { extractSections } from './parseMusicXml.js';

const XML = `<score-partwise><part id="P1">
  <measure number="1"><direction><direction-type><rehearsal>A</rehearsal></direction-type></direction></measure>
  <measure number="2"></measure>
  <measure number="3"><direction><direction-type><rehearsal>B</rehearsal></direction-type></direction></measure>
  <measure number="4"></measure>
</part></score-partwise>`;

describe('extractSections', () => {
  it('maps rehearsal marks to measure ranges (mark → next mark or end)', () => {
    const s = extractSections(XML);
    expect(s).toEqual([
      { label: 'A', startMeasure: 1, endMeasure: 2 },
      { label: 'B', startMeasure: 3, endMeasure: 4 },
    ]);
  });
  it('returns [] when there are no rehearsal marks', () => {
    expect(extractSections('<score-partwise><part id="P1"><measure number="1"/></part></score-partwise>')).toEqual([]);
  });
});
```

**Step 2:** `npx vitest run frontend/src/modules/MusicNotation/parseSections.test.js` → FAIL.

**Step 3:** Implement `extractSections(xmlOrDoc)`: accept a string (parse via `DOMParser`) or a `Document`. Collect `<rehearsal>` elements; for each, find its ancestor `<measure>`'s `number` attr (Number). Sort by measure. Build ranges where `endMeasure` = (next mark's measure − 1) or the last measure number in the score. Return `[{ label, startMeasure, endMeasure }]`. Export it AND call it inside `parseMusicXml` so the returned score gains `sections`. Defensive: unknown/no marks → `[]`; a rehearsal with empty text → skip.

**Step 4:** test PASS (2).

**Step 5:** Commit `feat(notation): extract rehearsal-mark sections from MusicXML`.

---

### Task 2: Measure index on each step

**Files:**
- Modify: `frontend/src/modules/MusicNotation/renderers/osmdRender.js` (`processStep`, `buildSteps`)
- Test: `frontend/src/modules/MusicNotation/renderers/measureModel.test.js` (new)

**Step 1: Failing test** for a pure `buildMeasures(steps)` helper:
```javascript
import { describe, it, expect } from 'vitest';
import { buildMeasures } from './osmdRender.js';

const STEPS = [
  { onsetQuarter: 0, measure: 0, notes: [] },
  { onsetQuarter: 1, measure: 0, notes: [] },
  { onsetQuarter: 2, measure: 1, notes: [] },
];

describe('buildMeasures', () => {
  it('groups steps into measures with first/last step indices', () => {
    expect(buildMeasures(STEPS)).toEqual([
      { index: 0, firstStep: 0, lastStep: 1 },
      { index: 1, firstStep: 2, lastStep: 2 },
    ]);
  });
});
```

**Step 2:** run → FAIL.

**Step 3:** In `processStep`, read `const measure = cursor.Iterator?.CurrentMeasureIndex ?? 0;` and include `measure` on each `onsetRecords` entry; carry it onto the step in `buildSteps` (add `measure` to the step object from the first record of that onset). Add + export pure `buildMeasures(steps)` that scans `steps` in order and produces `[{ index, firstStep, lastStep }]` (contiguous runs of equal `measure`). Return `measures` from `makeCursorWalk.finalize()` and thread it through `extractEvents`/`extractLayoutSliced` → `MusicXmlRenderer` `onLayout`.

**Step 4:** run → PASS. Also run `osmdRender.test.js` + `extractSteps.test.js` (no regression).

**Step 5:** Commit `feat(notation): tag steps with measure index + buildMeasures model`.

---

### Task 3: Focus-range model (clamp + wrap)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/focusRange.js`
- Test: `.../SheetMusic/focusRange.test.js`

**Step 1: Failing test:**
```javascript
import { describe, it, expect } from 'vitest';
import { rangeSteps, clampStepToRange, nextStepInRange, sectionToRange } from './focusRange.js';

const MEAS = [
  { index: 0, firstStep: 0, lastStep: 1 },
  { index: 1, firstStep: 2, lastStep: 3 },
  { index: 2, firstStep: 4, lastStep: 5 },
];

describe('focusRange', () => {
  it('rangeSteps → [firstStep, lastStep] spanning the measure range', () => {
    expect(rangeSteps(MEAS, { inMeasure: 1, outMeasure: 2 })).toEqual([2, 5]);
  });
  it('clampStepToRange keeps a step inside the range', () => {
    expect(clampStepToRange(0, [2, 5])).toBe(2);
    expect(clampStepToRange(9, [2, 5])).toBe(5);
    expect(clampStepToRange(3, [2, 5])).toBe(3);
  });
  it('nextStepInRange wraps at the out-point', () => {
    expect(nextStepInRange(3, [2, 5])).toBe(4);
    expect(nextStepInRange(5, [2, 5])).toBe(2); // wrap
  });
  it('sectionToRange maps a section to measure in/out', () => {
    expect(sectionToRange({ startMeasure: 3, endMeasure: 4 }, [{ number: 3, index: 1 }, { number: 4, index: 2 }]))
      .toEqual({ inMeasure: 1, outMeasure: 2 });
  });
});
```
(For `sectionToRange`, measures carry a `number` from the score and an `index`; map the section's measure NUMBERS to measure INDICES.)

**Step 2–4:** FAIL → implement the four pure fns → PASS. `rangeSteps(measures, {inMeasure,outMeasure})` returns `[measures[inMeasure].firstStep, measures[outMeasure].lastStep]` (guard bounds). `clampStepToRange(step,[lo,hi])`. `nextStepInRange(step,[lo,hi])` → `step>=hi ? lo : step+1`. `sectionToRange(section, measures)` finds the measure indices whose `number` matches start/end.

**Step 5:** Commit `feat(piano): focus-range model (section/custom clamp + loop wrap)`.

---

### Task 4: Config schema + reader

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/sheetMusicConfig.js`
- Test: `.../SheetMusic/sheetMusicConfig.test.js`
- Docs: note the new `sheetmusic:` keys in `docs/reference/piano/sheet-music-player.md` (Phase 8).

**Step 1: Failing test** for a pure `resolveSheetMusicConfig(raw)` that fills defaults:
```javascript
import { describe, it, expect } from 'vitest';
import { resolveSheetMusicConfig } from './sheetMusicConfig.js';

describe('resolveSheetMusicConfig', () => {
  it('applies defaults when unset', () => {
    expect(resolveSheetMusicConfig(undefined)).toEqual({
      defaultMode: 'learn',
      perform: { advancePedalCC: 67, backPedalCC: 66 },
      scoring: { silentMeasuresToStop: 4, timingToleranceMs: 80, thresholds: { green: 0.9, yellow: 0.6 } },
    });
  });
  it('merges partial overrides', () => {
    const c = resolveSheetMusicConfig({ perform: { advancePedalCC: 64 }, scoring: { thresholds: { green: 0.95 } } });
    expect(c.perform).toEqual({ advancePedalCC: 64, backPedalCC: 66 });
    expect(c.scoring.thresholds).toEqual({ green: 0.95, yellow: 0.6 });
    expect(c.scoring.silentMeasuresToStop).toBe(4);
  });
});
```

**Step 2–4:** FAIL → implement deep-ish merge with the documented defaults → PASS.

**Step 5:** Commit `feat(piano): sheet-music config resolver (modes, pedals, scoring thresholds)`.

---

## Phase 2 — Mode framework

### Task 5: Rename modes + mode-aware bar props

**Files:**
- Modify: `.../SheetMusic/ScorePlayer.jsx`, `.../SheetMusic/ScoreTransportBar.jsx`, and their tests.

**Changes (TDD where a test exists; adapt `ScoreTransportBar.test.jsx`):**
- Replace the mode set with `listen · learn · polish · perform` (tabs + internal `mode` values). Map old behavior onto the new names as a starting point: listen←(play, all parts), learn←follow, polish←(new; start as metronome-clock scaffold), perform←manual.
- Remove the standalone metronome tab; add a **metronome-click** toggle prop (`clickOn`, `onToggleClick`) shown in Listen/Learn.
- Make the bar **mode-aware**: render only the relevant cluster per mode (see design). Keep it presentational; ScorePlayer passes what each mode needs.
- Update `ScoreTransportBar.test.jsx`: assert the four tabs; assert Listen shows tempo/key controls and Perform shows a page indicator (adapt selectors).

**Commit** `feat(piano): four named modes (Listen/Learn/Polish/Perform) + mode-aware bar`.

---

### Task 6: Metronome click

**Files:**
- Create: `.../SheetMusic/useMetronomeClick.js` + test.

**Step 1: Failing test** (fake timers, like useScoreTransport.test): a hook `useMetronomeClick({ enabled, bpm, onTick })` that calls `onTick` every `60000/bpm` ms while enabled, stops on disable/unmount.
```javascript
it('ticks at the tempo while enabled', () => {
  const ticks = [];
  const { rerender } = renderHook(({ on }) => useMetronomeClick({ enabled: on, bpm: 120, onTick: () => ticks.push(1) }), { initialProps: { on: true } });
  act(() => vi.advanceTimersByTime(1000)); // 120bpm → 500ms → 2 ticks
  expect(ticks.length).toBe(2);
  rerender({ on: false });
  act(() => vi.advanceTimersByTime(1000));
  expect(ticks.length).toBe(2);
});
```

**Step 2–4:** FAIL → implement (setInterval-based off a ref; clean up) → PASS. `onTick` plays a click (a short WebAudio blip or an existing cue) — but the HOOK only schedules; the sound is the caller's `onTick`. Keep the hook sound-agnostic (testable).

**Step 5:** Commit `feat(piano): metronome-click scheduler hook`.

---

## Phase 3 — Listen

### Task 7: Full-performance timeline + tempo rescale

**Files:**
- Modify: `.../SheetMusic/playParts.js` (add `allPlayRoles(parts)` helper) + test; wire in ScorePlayer for `listen`.
- Modify: `.../SheetMusic/scoreTimeline.js`? No — tempo scaling is a timeline transform.

**Step 1: Failing tests** (pure):
```javascript
import { allPlayRoles } from './playParts.js';
it('allPlayRoles → every staff set to play', () => {
  expect(allPlayRoles([{ staff: 0 }, { staff: 1 }])).toEqual({ 0: 'play', 1: 'play' });
});
```
Plus a `scaleTimeline(timeline, factor)` (put in `scoreTimeline.js`) test: multiplies each `t` by `factor` (0.5 = half speed → 2× ms), stable order.

**Step 2–4:** implement both → PASS. Listen builds its timeline via `buildPlayTimeline(events, notes, tempoMap, allPlayRoles(parts))`, then `scaleTimeline(tl, tempoFactor)`.

**Step 5:** Commit `feat(piano): full-performance timeline + tempo rescale for Listen`.

### Task 8: Listen wiring (transport, scrub, tempo, play-along)

**Files:** Modify `ScorePlayer.jsx`, `ScoreTransportBar.jsx`.
- Listen: kiosk performs (all parts play) at the scaled tempo; transport cluster (reset/run/position/scrub/tempo modal/play-along toggle/click toggle).
- Play-along toggle: when on, feed your MIDI to the light-up `hit` set (reuse the follow `onHit` matching against the currently-sounding notes) without gating anything.
- No unit test for the OSMD-driven play; keep the tempo/timeline pieces (Task 7) tested. Live-verify.

**Commit** `feat(piano): Listen mode — jukebox transport, tempo, play-along light-up`.

### Task 9: Key transpose (OSMD) on the resize path

**Files:** Modify `osmdRender.js` (`osmdEngrave`/`osmdRepaint` accept `transpose` semitones), `MusicXmlRenderer.jsx` (new `transpose` prop → re-engrave), `ScorePlayer.jsx` (Listen key ± → `transpose` state), `ScoreTransportBar.jsx` (key control).

**Changes:**
- In `osmdEngrave`: after building the OSMD instance, if `opts.transpose`, set `osmd.TransposeCalculator = new TransposeCalculator()` (import it) and `osmd.Sheet.Transpose = opts.transpose` BEFORE `osmd.render()`. In `osmdRepaint`: set `osmd.Sheet.Transpose = opts.transpose` before `osmd.render()` (calculator already attached from engrave).
- `MusicXmlRenderer`: add `transpose` to props + the effect deps + the `cacheKey` (so a transpose change re-renders in place via `osmdRepaint`, re-extracting steps → played pitches follow). Pass `transpose` through to both paths.
- ScorePlayer Listen: `transpose` state, ± semitone buttons in the bar (clamp e.g. −7..+7), emit `score.transpose`.
- No jsdom test (OSMD); live-verify that notation + light-up + playback all move to the new key.

**Commit** `feat(piano): Listen key transpose via OSMD on the paint-first resize path`.

---

## Phase 4 — Learn

### Task 10: Focus range + section selector in Learn

**Files:** Modify `ScorePlayer.jsx`, `ScoreTransportBar.jsx`; use `focusRange.js`, `sections`/`measures` from layout.

**Changes:**
- `focus` state `{ inMeasure, outMeasure } | null`. Setters: pick a section chip (`sectionToRange`), or tap start-measure then end-measure (a small `focusPick` state machine: first tap sets a pending in-measure, second sets out; tap-clear resets). Bar shows section chips (from `layout.sections`) + a "Loop" affordance + the current range / Clear.
- Wire `useFollowTracker`'s advancement through `nextStepInRange` when `focus` is set (wrap to loop), and clamp the initial/seek step via `clampStepToRange`. On tap-jump, clamp into range.
- Emit `score.focus.set { kind:'section'|'custom', inMeasure, outMeasure }`.
- Section-highlight styling in `PianoApp.scss` (range bracket over measures) — minimal.

Add a focused unit test where possible (the tracker wrap uses `nextStepInRange`, already tested; here test the tap→range state machine if you extract it as a pure reducer). Live-verify the loop.

**Commit** `feat(piano): Learn focus range — section chips + custom loop with wrap`.

### Task 11: Learn click + one-hand drill polish

**Files:** Modify `ScorePlayer.jsx` (wire `useMetronomeClick` in Learn, sound via a WebAudio blip helper), `ScoreTransportBar.jsx` (click toggle).
- Click is a free-running reference; does NOT gate the tracker.
- Confirm deactivating a staff (existing `activeParts`) drills one hand within the focus range.

**Commit** `feat(piano): Learn metronome click (reference-only) + one-hand focus`.

---

## Phase 5 — Polish

### Task 12: Scoring math (pure)

**Files:**
- Create: `.../SheetMusic/scoreEvaluator.js` + test.

**Step 1: Failing test:**
```javascript
import { describe, it, expect } from 'vitest';
import { gradeMeasure } from './scoreEvaluator.js';

const cfg = { timingToleranceMs: 80, thresholds: { green: 0.9, yellow: 0.6 } };

describe('gradeMeasure', () => {
  it('all notes on time → green', () => {
    const g = gradeMeasure({ expected: [60, 64], hits: [{ note: 60, driftMs: 10 }, { note: 64, driftMs: -20 }] }, cfg);
    expect(g.grade).toBe('green'); expect(g.noteScore).toBe(1);
  });
  it('missed a note → drops toward yellow/red', () => {
    const g = gradeMeasure({ expected: [60, 64], hits: [{ note: 60, driftMs: 5 }] }, cfg);
    expect(g.noteScore).toBe(0.5);
    expect(['yellow', 'red']).toContain(g.grade);
  });
  it('right notes but late → timing pulls the grade down', () => {
    const g = gradeMeasure({ expected: [60], hits: [{ note: 60, driftMs: 300 }] }, cfg);
    expect(g.noteScore).toBe(1); expect(g.timingScore).toBeLessThan(1);
  });
  it('empty measure → red, silent flag', () => {
    const g = gradeMeasure({ expected: [60], hits: [] }, cfg);
    expect(g.grade).toBe('red'); expect(g.silent).toBe(true);
  });
});
```

**Step 2–4:** implement `gradeMeasure({expected, hits}, cfg)`:
- `noteScore` = matched / expected.length (matched = expected midis present in hits; ignore extras or lightly penalize).
- `timingScore` = mean over matched hits of `clamp(1 - max(0, |driftMs|-tol)/(tol*k), 0, 1)` (pick k≈4 so ~5×tol → 0); no hits → 0.
- `combined` = `noteScore * (0.6 + 0.4*timingScore)` (notes dominate, timing refines) — or a documented blend; grade via thresholds (`>=green`→green, `>=yellow`→yellow, else red).
- `silent` = hits.length === 0.
Return `{ noteScore, timingScore, combined, grade, silent }`.

**Step 5:** Commit `feat(piano): per-measure scoring math (notes + timing → R/Y/G)`.

### Task 13: `useScoreEvaluator` (collect input per measure, grade, auto-stop)

**Files:**
- Create: `.../SheetMusic/useScoreEvaluator.js` + test (fake subscribe like `useFollowTracker.test.js`).

**Behavior (TDD the collection/auto-stop with a fake subscribe + injected time):**
- `useScoreEvaluator({ enabled, measures, steps, activeParts, currentMeasure, subscribe, nowRef, expectedAt, cfg, onMeasureGrade, onSilentStop })`.
- Buffers `note_on` events (note + a `driftMs` computed vs the nearest expected onset time in the current measure — reuse `stepTimeline`) while a measure is current.
- When `currentMeasure` advances, `gradeMeasure(...)` the measure that just ended → `onMeasureGrade({ measure, ...grade })`; if it was `silent`, increment a silent-run counter, else reset it; when the counter hits `cfg.scoring.silentMeasuresToStop`, call `onSilentStop()`.
- Reset on disable/unmount; subscribe once (ref-based), like the tracker.
- Test: feed notes across two measures + advance `currentMeasure`, assert one `onMeasureGrade` per completed measure; feed N silent measures, assert `onSilentStop` fires once.

**Commit** `feat(piano): useScoreEvaluator — per-measure grading + silent auto-stop`.

### Task 14: Polish wiring (clock, colors, summary, loop, toggle)

**Files:** Modify `ScorePlayer.jsx`, `ScoreTransportBar.jsx`, `NoteHighlightLayer.jsx`/new `MeasureGradeLayer.jsx`, `PianoApp.scss`.
- Polish runs the at-tempo transport (like Listen) but does NOT `pressNote` your parts (silent for you). Cursor advances on the clock.
- Wire `useScoreEvaluator` with the current measure derived from `steps[step].measure`.
- Paint each completed measure R/Y/G (a `MeasureGradeLayer` overlay keyed to `measures[]` boxes, colored from grades; styles in scss).
- On `onSilentStop` (or end/loop end): show a **run summary** (per-measure strip + counts + overall) — a small panel component.
- Focus range loops at tempo (reuse Task 10's range; wrap the transport to the in-point).
- Scoring **toggle** in the bar: off → no evaluator/colors/summary, plain at-tempo play-along.
- Live-verify (OSMD/tempo).

**Commit** `feat(piano): Polish mode — at-tempo scoring, measure colors, run summary, loop`.

---

## Phase 6 — Perform

### Task 15: Config pedal page-turn (forward + back)

**Files:** Modify `ScorePlayer.jsx` (Perform branch), `ScoreTransportBar.jsx` (page indicator), use `sheetMusicConfig`.

**Changes:**
- Perform: no cursor/light-up/scoring. Subscribe raw MIDI; on rising edge of `advancePedalCC` → page forward (`scrollBy` a viewport in the current flow), of `backPedalCC` → page back. CCs from resolved config.
- Page indicator `{page} / {pages}` derived from scroll position / content size.
- Extract the pedal-edge logic into a tiny pure `pedalEdge(prev, value, threshold=64)` helper + unit test (rising-edge detection), reuse for both pedals.

**Commit** `feat(piano): Perform mode — config-defined pedal page-turn (forward + back)`.

---

## Phase 7 — Logging

### Task 16: Session-scoped practice log + app context + event catalog

**Files:** Modify `.../SheetMusic/useScoreTelemetry.js` (+ its test), `ScorePlayer.jsx`; `config/logging.yml` (create/append).

**Changes:**
- `useScoreTelemetry` child logger context gains `app: 'piano-sheetmusic'`. Add methods: `startSession(id)` → emits `session-log.start` with `context: { app:'piano-sheetmusic', sessionLog:true, scoreId:id }`; and make every telemetry event include `context.sessionLog: true` (so ingestion routes them to the per-session JSONL). Add `logMeasureGrade`, `logRunSummary`, `logFocus`, `logTranspose`, `logMode` emitting `score.polish.measure`, `score.polish.summary`, `score.focus.set`, `score.transpose`, `score.mode`.
- Test (extend `useScoreTelemetry.test.js`): assert `startSession` emits `session-log.start` with `sessionLog:true`; assert `logMeasureGrade` emits `score.polish.measure` with the grade fields; assert events carry `context.sessionLog`.
- ScorePlayer: call `startSession(scoreId)` on score open and at the start of a Learn/Polish run; wire the new emitters into the mode flows (measure grades, run summary, focus set, transpose, mode change).
- `config/logging.yml`: register a sensible level, e.g.:
  ```yaml
  loggers:
    piano-sheetmusic: info
  ```
  (streams stay `debug`+`sampled`; flip to `debug` here to capture `follow.timing`/`polish.measure` fully.)

**Commit** `feat(piano): per-session practice JSONL + full sheet-music event catalog`.

---

## Phase 8 — Verify & document

### Task 17: Live verification on the kiosk

**REQUIRED SUB-SKILL:** `verify`. Drive the real player (OSMD-dependent — not local). Confirm:
1. Four tabs Listen/Learn/Polish/Perform; metronome is a toggle, not a tab.
2. **Listen:** kiosk performs; tempo changes speed without re-engrave/jank; **key ±** re-engraves and notation+playback+play-along all move to the new key; play-along lights green.
3. **Learn:** waits for correct notes; section chips (on a score with rehearsal marks) and custom tap-range both loop-wrap; click is reference-only.
4. **Polish:** at-tempo, silent for your parts; measures paint R/Y/G; N silent measures → summary; focus range loops at tempo; scoring toggle hides colors.
5. **Perform:** static, no light-up; the config pedals turn pages forward/back; page indicator updates.
6. **Logging:** a practice run produces one `media/logs/piano-sheetmusic/{ts}.jsonl` containing `session-log.start`, load phases, `follow.timing`/`polish.measure` with ms drift, stalls, and the summary — ordered and wall-clock-stamped. Confirm level knobs in `config/logging.yml` work.

Record what was observed; don't claim done until each bullet is seen.

### Task 18: Docs

**Files:** Update `docs/reference/piano/sheet-music-player.md` (four modes, focus range/sections, scoring, transpose, config keys, the session JSONL); update `docs/docs-last-updated.txt` (`git rev-parse HEAD > ...`).

**Commit** `docs(piano): four-mode sheet-music reference (Listen/Learn/Polish/Perform, scoring, logging)`.

---

## Notes for the executor
- Reuse ruthlessly: transport, tracker, light-up, telemetry, paint-first render, resize path all exist. New = measure/section/focus/scoring pure modules + mode wiring + transpose + pedal config + session logging.
- Pure modules are TDD'd; OSMD/tempo behavior is live-verified (jsdom can't run OSMD).
- Keep `silence()`/`sendPanic()` discipline from the overhaul intact across the new modes.
- Design: `docs/plans/2026-07-03-sheet-music-modes-design.md`.
