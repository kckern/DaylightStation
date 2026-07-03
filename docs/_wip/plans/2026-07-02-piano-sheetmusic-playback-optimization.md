# Piano Sheet Music Playback Optimization — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the defects found in `docs/_wip/audits/2026-07-02-piano-sheetmusic-metronome-playback-audit.md` (wrong/drifting metronome tempo, false wrong-note flashes, engraving overlap, stuttering auto-scroll, expensive zoom) and add a **Play** mode where the kiosk performs selected parts through the piano while the user plays the rest (the requested playback/hybrid mode).

**Architecture:** A pure "musical timeline" module converts quarter-note onsets → wall-clock ms through a tempo map extracted from OSMD's cursor walk (single source of truth for events AND tempo). One rAF wall-clock transport (mirroring the proven `useLoopTransport` / Studio transport idiom) drives both the metronome cursor and MIDI-out playback. MIDI out already exists (`usePianoMidi().sendNote/sendNoteOff/sendPanic/pressNote/releaseNote`) and sounds on the physical piano via the Jamcorder (`bleToDin: true`) — no browser audio needed.

**Tech Stack:** React 18, OSMD 2.0 (`opensheetmusicdisplay`), Web MIDI (BLE via Jamcorder), Vitest 4 + @testing-library/react (jsdom), SCSS.

**Key files (read before starting):**
- `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx` — the component being fixed
- `frontend/src/modules/MusicNotation/renderers/osmdRender.js` — the ONLY file touching OSMD
- `frontend/src/modules/MusicNotation/renderers/MusicXmlRenderer.jsx` — React wrapper
- `frontend/src/modules/Piano/PianoKiosk/useLoopTransport.js` — the transport idiom to mirror
- `frontend/src/modules/Piano/PianoKiosk/useWebMidiBLE.js:303-338` — `sendNote`/`sendNoteOff`/`sendPanic`/`scheduleNotes` (all already exposed through `usePianoMidi()`)
- The audit doc above — finding IDs (A1, B2, …) referenced throughout this plan

**Conventions that override defaults:**
- Tests run from repo root: `npx vitest run <path>` (config: `vitest.config.mjs` at root).
- Logging MUST use the structured framework (`getLogger().child(...)`), never raw console (CLAUDE.md).
- Commits per task are fine on this feature branch (repo memory: per-task auto-commits OK on isolated feature branches); do NOT merge to main or deploy without the user.
- Dev-server verify traps (repo memory): port 3111 may belong to another worktree's Vite; Vite 404s dot-in-path SPA routes when visited directly; click "Continue without piano" on the kiosk connect gate first.

---

## Task 0: Worktree + branch

**Step 1:** Create an isolated worktree (repo rule: prefer worktrees for feature work):

```bash
git -C /Users/kckern/Documents/GitHub/DaylightStation worktree add ../DaylightStation-sheetmusic -b piano/sheetmusic-playback main
cd /Users/kckern/Documents/GitHub/DaylightStation-sheetmusic
```

**Step 2:** Baseline — run the existing suite for the touched areas; all must pass before you change anything:

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic frontend/src/modules/MusicNotation
```
Expected: PASS (ScorePlayer, SheetMusic, osmdRender, parseMusicXml, SvgStaffRenderer, abc, chordStaff tests).

---

## Phase 1 — Quick independent fixes

### Task 1: Hoist conditional hook (audit G1)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/SheetMusic.jsx:78-83`

**Step 1: Edit.** Replace `ScoreViewerRoute`:

```jsx
function ScoreViewerRoute() {
  const params = useParams();
  const contentId = params['*'] || '';
  const imageScore = useMemo(() => ({ id: contentId }), [contentId]);
  if (NOTATION_RE.test(contentId)) return <NotationScore contentId={contentId} />;
  return <ScoreViewer score={imageScore} />;
}
```

(The bug: `useMemo` was inline in the JSX *after* the conditional return — hook order changes if `contentId` flips between notation/non-notation without a remount.)

**Step 2: Run existing tests.**
```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/SheetMusic.test.jsx
```
Expected: PASS.

**Step 3: Commit.**
```bash
git add -A && git commit -m "fix(piano): hoist useMemo above conditional return in ScoreViewerRoute (rules of hooks)"
```

### Task 2: Engraving declutter — metronome marks + measure numbers (audit E1)

**Files:**
- Modify: `frontend/src/modules/MusicNotation/renderers/osmdRender.js:97-111`

This fixes the user-screenshot overlap (♩=120 colliding with an arpeggiated chord and measure number 39). Both knobs verified against installed OSMD 2.0 typings (`OSMDOptions.d.ts:98`, `EngravingRules.d.ts:506`).

**Step 1: Edit `osmdRender`.** Add one option and one rule:

```js
  const osmd = new OpenSheetMusicDisplay(host, {
    backend: 'svg',
    autoResize: false, // the React wrapper owns resize handling
    drawTitle: false, // ScorePlayer renders its own title/metadata block
    drawSubtitle: false,
    drawComposer: false,
    drawLyricist: false,
    drawPartNames: false,
    // Tempo lives in ScorePlayer's metadata header, and OSMD's in-score
    // metronome marks collide with chords/measure numbers (2026-07-02 audit E1).
    drawMetronomeMarks: false,
    followCursor: false,
    renderSingleHorizontalStaffline: flow === 'horizontal',
  });
  // Mid-system measure numbers pile onto tight chords; system-start only.
  osmd.EngravingRules.RenderMeasureNumbersOnlyAtSystemStart = true;
  await osmd.load(xml);
```

**Step 2: Verify visually** (no unit test can cover OSMD layout). Start the dev server if not running (`lsof -i :3111` first; this tree may need an alternate port — see conventions above), open a MusicXML score under `/piano/…/sheetmusic`, click "Continue without piano", and screenshot the measure that previously overlapped. Use a vision check (read the screenshot) — do not ask the user to look (repo feedback memory). Confirm: no ♩=120 mark, measure numbers only at system starts.

**Step 3: Commit.**
```bash
git add -A && git commit -m "fix(notation): stop engraving metronome marks + mid-system measure numbers (overlap)"
```

### Task 3: Sostenuto page-turn edge detection (audit B3)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx:126-136`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx`

**Step 1: Write the failing test.** In `ScorePlayer.test.jsx`, first extend the harness: capture the raw subscriber and polyfill `scrollBy` (jsdom lacks it).

Add to the hoisted holder: `rawCb: null`, and change the mock:

```js
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({
    activeNotes: new Map(),
    subscribe: (fn) => { h.noteCb = fn; return () => { h.noteCb = null; }; },
    subscribeRaw: (fn) => { h.rawCb = fn; return () => { h.rawCb = null; }; },
  }),
}));
```

New test block:

```js
describe('ScorePlayer — Manual mode pedal page-turn', () => {
  beforeEach(() => { h.rawCb = null; });

  it('turns one page per pedal press (rising edge), not per CC message', async () => {
    const scrollBy = vi.fn();
    Element.prototype.scrollBy = scrollBy;
    renderPlayer();
    screen.getByText('Manual').click();
    await act(async () => {});
    const cc66 = (v) => act(() => { h.rawCb?.({ data: [0xb0, 66, v] }); });

    cc66(127); // press
    cc66(127); // continuous pedal streams repeats while held
    cc66(96);  // still held
    cc66(0);   // release
    cc66(127); // second press
    expect(scrollBy).toHaveBeenCalledTimes(2);
  });
});
```

**Step 2: Run to verify it fails.**
```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx
```
Expected: FAIL — `scrollBy` called 3 times (every value ≥ 64 fires).

**Step 3: Implement.** Replace the manual-mode effect body in `ScorePlayer.jsx`:

```js
  // Manual mode: sostenuto (middle) pedal turns the page — rising edge only,
  // since continuous/half pedals stream many CC66 values per physical press.
  useEffect(() => {
    if (mode !== 'manual') return undefined;
    let prev = 0;
    return subscribeRaw(({ data }) => {
      if (!data || data.length < 3) return;
      if ((data[0] & 0xf0) !== 0xb0 || data[1] !== SOSTENUTO_CC) return;
      const rising = prev < 64 && data[2] >= 64;
      prev = data[2];
      if (!rising) return;
      const el = scrollRef.current;
      if (el) el.scrollBy({ [flow === 'horizontal' ? 'left' : 'top']: (flow === 'horizontal' ? el.clientWidth : el.clientHeight) * 0.85, behavior: 'smooth' });
      logger.info('score.manual.pageturn', {});
    });
  }, [mode, subscribeRaw, flow, logger]);
```

**Step 4: Run tests → PASS. Step 5: Commit.**
```bash
git add -A && git commit -m "fix(piano): sostenuto page-turn fires on rising edge only"
```

### Task 4: parseMusicXml — first tempo wins for header metadata (audit A1, display half)

Playback tempo will come from the OSMD tempo map (Phase 2); the parser's single `tempo` remains as the *header display* + fallback, and must be the piece's opening tempo, not its last marking.

**Files:**
- Modify: `frontend/src/modules/MusicNotation/parseMusicXml.js:71-75`
- Test: `frontend/src/modules/MusicNotation/parseMusicXml.test.js`

**Step 1: Write the failing test** (append to the existing describe or add a new one):

```js
describe('tempo extraction', () => {
  const xmlWithTempoChange = `<?xml version="1.0"?>
<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">
  <measure number="1">
    <attributes><divisions>1</divisions></attributes>
    <sound tempo="72"/>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
  </measure>
  <measure number="2">
    <sound tempo="120"/>
    <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
  </measure>
</part></score-partwise>`;

  it('keeps the FIRST tempo marking (opening tempo), not the last', () => {
    expect(parseMusicXml(xmlWithTempoChange).tempo).toBe(72);
  });
});
```

**Step 2: Run → FAIL** (returns 120: last marking overwrites).
```bash
npx vitest run frontend/src/modules/MusicNotation/parseMusicXml.test.js
```

**Step 3: Implement.** In `parseMusicXml.js`, add a flag and guard the two assignments:

Before the parts loop (after `score` is created):
```js
  let tempoFound = false; // header shows the OPENING tempo; later markings belong to the tempo map
```

Replace the tempo block inside the measure loop:
```js
      // Tempo (sound tempo or metronome per-minute) — first marking wins.
      if (!tempoFound) {
        const sound = measureEl.querySelector('sound[tempo]');
        const perMin = measureEl.querySelector('metronome per-minute');
        if (sound) { score.tempo = Math.round(Number(sound.getAttribute('tempo'))); tempoFound = true; }
        else if (perMin) { score.tempo = Number(perMin.textContent) || score.tempo; tempoFound = true; }
      }
```

**Step 4: Run → PASS** (whole file, to catch regressions). **Step 5: Commit.**
```bash
git add -A && git commit -m "fix(notation): header tempo = opening tempo marking, not the document's last"
```

---

## Phase 2 — Musical timeline (pure functions)

### Task 5: `scoreTimeline.js` — tempo map + ms conversion + timelines

**Files:**
- Create: `frontend/src/modules/MusicNotation/scoreTimeline.js`
- Test: `frontend/src/modules/MusicNotation/scoreTimeline.test.js`

**Step 1: Write the failing tests:**

```js
import { describe, it, expect } from 'vitest';
import { buildTempoMap, msAtQuarter, buildStepTimeline, buildNoteTimeline } from './scoreTimeline.js';

describe('buildTempoMap', () => {
  it('falls back to a single segment at the fallback bpm', () => {
    expect(buildTempoMap([], 90)).toEqual([{ onsetQuarter: 0, bpm: 90 }]);
    expect(buildTempoMap(null, 90)).toEqual([{ onsetQuarter: 0, bpm: 90 }]);
  });
  it('sorts, dedupes same-onset (last wins) and same-bpm runs, anchors at 0', () => {
    const map = buildTempoMap([
      { onsetQuarter: 16, bpm: 120 },
      { onsetQuarter: 0, bpm: 72 },
      { onsetQuarter: 16, bpm: 126 }, // same onset — later entry wins
      { onsetQuarter: 24, bpm: 126 }, // no change — dropped
    ], 90);
    expect(map).toEqual([{ onsetQuarter: 0, bpm: 72 }, { onsetQuarter: 16, bpm: 126 }]);
  });
  it('extends the first tempo back to quarter 0 when the score starts late', () => {
    expect(buildTempoMap([{ onsetQuarter: 4, bpm: 100 }], 90)[0]).toEqual({ onsetQuarter: 0, bpm: 100 });
  });
  it('ignores junk entries', () => {
    expect(buildTempoMap([{ onsetQuarter: 0, bpm: 0 }, { onsetQuarter: NaN, bpm: 100 }], 90))
      .toEqual([{ onsetQuarter: 0, bpm: 90 }]);
  });
});

describe('msAtQuarter', () => {
  const map = [{ onsetQuarter: 0, bpm: 60 }, { onsetQuarter: 4, bpm: 120 }]; // 1000ms/q then 500ms/q
  it('converts within the first segment', () => {
    expect(msAtQuarter(map, 0)).toBe(0);
    expect(msAtQuarter(map, 2)).toBe(2000);
  });
  it('accumulates across tempo changes', () => {
    expect(msAtQuarter(map, 4)).toBe(4000);
    expect(msAtQuarter(map, 6)).toBe(5000); // 4×1000 + 2×500
  });
});

describe('buildStepTimeline', () => {
  it('emits one {t, index} per event under the map', () => {
    const map = [{ onsetQuarter: 0, bpm: 120 }]; // 500ms/q
    const tl = buildStepTimeline([{ onsetQuarter: 0 }, { onsetQuarter: 1 }, { onsetQuarter: 2.5 }], map);
    expect(tl).toEqual([{ t: 0, index: 0 }, { t: 500, index: 1 }, { t: 1250, index: 2 }]);
  });
});

describe('buildNoteTimeline', () => {
  const map = [{ onsetQuarter: 0, bpm: 60 }]; // 1000ms/q
  const notes = [
    { midi: 60, staff: 1, onsetQuarter: 0, durationQuarters: 1 },
    { midi: 48, staff: 2, onsetQuarter: 0, durationQuarters: 2 },
    { midi: 60, staff: 1, onsetQuarter: 1, durationQuarters: 1 }, // repeated pitch
  ];
  it('emits on/off pairs in time order, off slightly early to re-articulate repeats', () => {
    const tl = buildNoteTimeline(notes, map);
    expect(tl.map((e) => [e.type, e.note, e.t])).toEqual([
      ['note_on', 60, 0], ['note_on', 48, 0],
      ['note_off', 60, 990],      // 10ms gap before the next C
      ['note_on', 60, 1000],
      ['note_off', 48, 1990], ['note_off', 60, 1990],
    ]);
  });
  it('filters through isAudible (part mute)', () => {
    const tl = buildNoteTimeline(notes, map, { isAudible: (n) => n.staff === 2 });
    expect(tl.every((e) => e.note === 48)).toBe(true);
  });
});
```

**Step 2: Run → FAIL** (module missing).
```bash
npx vitest run frontend/src/modules/MusicNotation/scoreTimeline.test.js
```

**Step 3: Implement `scoreTimeline.js`:**

```js
// scoreTimeline — musical time (quarter-note beats) → wall-clock ms.
//
// A tempo map is a sorted [{onsetQuarter, bpm}] with the first entry at
// quarter 0. Every playback surface (metronome cursor, Play-mode MIDI out)
// converts through the same map, so mid-piece tempo changes stay in sync
// between what the user sees and what the piano plays.

/** Normalize raw tempo entries into a clean map. Never returns empty. */
export function buildTempoMap(entries, fallbackBpm = 90) {
  const clean = (entries || [])
    .filter((e) => e && Number.isFinite(e.onsetQuarter) && Number.isFinite(e.bpm) && e.bpm > 0)
    .sort((a, b) => a.onsetQuarter - b.onsetQuarter);
  const map = [];
  for (const e of clean) {
    const last = map[map.length - 1];
    if (last && e.onsetQuarter === last.onsetQuarter) { last.bpm = e.bpm; continue; }
    if (last && e.bpm === last.bpm) continue;
    map.push({ onsetQuarter: e.onsetQuarter, bpm: e.bpm });
  }
  if (!map.length) return [{ onsetQuarter: 0, bpm: fallbackBpm }];
  map[0] = { onsetQuarter: 0, bpm: map[0].bpm }; // opening tempo governs from beat one
  return map;
}

/** Wall-clock ms elapsed from quarter 0 to `quarter`. */
export function msAtQuarter(tempoMap, quarter) {
  let ms = 0;
  for (let i = 0; i < tempoMap.length; i++) {
    const seg = tempoMap[i];
    if (quarter <= seg.onsetQuarter) break;
    const end = tempoMap[i + 1]?.onsetQuarter ?? Infinity;
    ms += (Math.min(quarter, end) - seg.onsetQuarter) * (60000 / seg.bpm);
    if (quarter <= end) break;
  }
  return ms;
}

/** Cursor steps: one {t, index} per melody event. */
export function buildStepTimeline(events, tempoMap) {
  return (events || []).map((e, index) => ({ t: msAtQuarter(tempoMap, e.onsetQuarter), index }));
}

const MIN_SOUND_MS = 20; // never emit a zero/negative-length note
const REARTICULATE_MS = 10; // lift early so a repeated pitch re-strikes

/**
 * Flat, time-sorted note_on/note_off stream for MIDI-out playback.
 * @param {Array<{midi,staff,onsetQuarter,durationQuarters}>} notes
 * @param {Array} tempoMap
 * @param {{isAudible?: (note) => boolean}} [opts] - part mute filter
 */
export function buildNoteTimeline(notes, tempoMap, { isAudible = () => true } = {}) {
  const out = [];
  for (const n of notes || []) {
    if (!isAudible(n)) continue;
    const on = msAtQuarter(tempoMap, n.onsetQuarter);
    const off = msAtQuarter(tempoMap, n.onsetQuarter + (n.durationQuarters || 0));
    out.push({ t: on, type: 'note_on', note: n.midi, velocity: n.velocity ?? 80, staff: n.staff });
    out.push({ t: Math.max(on + MIN_SOUND_MS, off - REARTICULATE_MS), type: 'note_off', note: n.midi, staff: n.staff });
  }
  // Stable order at equal t: offs before ons so repeated pitches re-articulate.
  return out.sort((a, b) => a.t - b.t || (a.type === b.type ? 0 : a.type === 'note_off' ? -1 : 1));
}
```

**Step 4: Run → PASS. Step 5: Commit.**
```bash
git add -A && git commit -m "feat(notation): scoreTimeline — tempo map + quarter→ms + step/note timelines"
```

### Task 6: Extract tempo entries, chord sets, and playback notes from the OSMD walk (audit A1/B2/D4)

**Files:**
- Modify: `frontend/src/modules/MusicNotation/renderers/osmdRender.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx:62` (layout state shape)
- Test: `frontend/src/modules/MusicNotation/renderers/osmdRender.test.js`

Verified against installed OSMD 2.0 typings: `cursor.Iterator.CurrentBpm` exists (`MusicPartManagerIterator.d.ts:46`); `note.Length.RealValue` is the whole-note fraction (`Note.d.ts:105`), so quarters = `RealValue * 4`.

**Step 1: Write failing tests** for the new pure helper (same fake-note style as the existing tests):

```js
import { midiOfHalfTone, pickMelodyNote, collectOnsetNotes } from './osmdRender.js';

describe('collectOnsetNotes', () => {
  it('keeps every real onset on BOTH staves (chord set for follow/play modes)', () => {
    const rh = note({ halfTone: 52, staff: 0 });
    const lh = note({ halfTone: 28, staff: 1 });
    expect(collectOnsetNotes([rh, lh])).toEqual([rh, lh]);
  });
  it('drops rests, grace notes, and tie continuations', () => {
    expect(collectOnsetNotes([
      note({ halfTone: 60, rest: true }),
      note({ halfTone: 60, grace: true }),
      note({ halfTone: 60, tieCont: true }),
    ])).toEqual([]);
  });
  it('survives malformed entries', () => {
    expect(collectOnsetNotes([null, {}, note({ halfTone: 45 })]).length).toBe(1);
  });
});
```

**Step 2: Run → FAIL** (no export).

**Step 3: Implement in `osmdRender.js`.**

Add `collectOnsetNotes` and rebase `pickMelodyNote` on it (behavior unchanged — existing tests must still pass):

```js
/** Real new onsets under the cursor: no rests, no grace notes, no tie continuations. */
export function collectOnsetNotes(notes) {
  const out = [];
  for (const n of notes || []) {
    try {
      if (!n || n.isRest() || n.IsGraceNote) continue;
      const tie = n.NoteTie;
      if (tie && tie.StartNote !== n) continue;
      out.push(n);
    } catch { /* malformed entry — skip it rather than break the whole score */ }
  }
  return out;
}

export function pickMelodyNote(notes) {
  let best = null;
  for (const n of collectOnsetNotes(notes)) {
    const staffId = n.ParentStaffEntry?.ParentStaff?.idInMusicSheet ?? 0;
    if (staffId !== 0) continue;
    if (!best || n.halfTone > best.halfTone) best = n;
  }
  return best;
}
```

Rewrite `extractEvents` to also harvest tempo entries and playback notes (one walk, one source of truth — repeats and tempo stay aligned with the visual cursor):

```js
/**
 * Walk OSMD's cursor start→end. Emits:
 *  events       — one per melody onset (cursor steps), now with `midis`
 *                 (every pitch sounding at that onset, both staves)
 *  notes        — every onset on every staff with duration, for playback
 *  tempoEntries — [{onsetQuarter, bpm}] wherever the iterator's bpm changes
 */
export function extractEvents(osmd) {
  const events = [], notes = [], tempoEntries = [];
  const cursor = osmd.cursor;
  if (!cursor) return { events, notes, tempoEntries };
  let lastBpm = null;
  try {
    cursor.show(); // geometry only updates while the cursor is visible
    cursor.reset();
    let guard = 0;
    while (!cursor.Iterator.EndReached && guard++ < 50000) {
      const onsetQuarter = cursor.Iterator.currentTimeStamp.RealValue * 4;
      const bpm = cursor.Iterator.CurrentBpm;
      if (Number.isFinite(bpm) && bpm > 0 && bpm !== lastBpm) {
        tempoEntries.push({ onsetQuarter, bpm });
        lastBpm = bpm;
      }
      const onset = collectOnsetNotes(cursor.NotesUnderCursor());
      for (const n of onset) {
        notes.push({
          midi: midiOfHalfTone(n.halfTone),
          staff: n.ParentStaffEntry?.ParentStaff?.idInMusicSheet ?? 0,
          onsetQuarter,
          durationQuarters: (n.Length?.RealValue ?? 0) * 4,
        });
      }
      const melody = pickMelodyNote(onset);
      if (melody) {
        const el = cursor.cursorElement;
        events.push({
          midi: midiOfHalfTone(melody.halfTone),
          midis: onset.map((n) => midiOfHalfTone(n.halfTone)),
          onsetQuarter,
          x: el.offsetLeft + el.offsetWidth / 2,
          top: el.offsetTop,
          bottom: el.offsetTop + el.offsetHeight,
        });
      }
      cursor.next();
    }
  } finally {
    try { cursor.reset(); cursor.hide(); } catch { /* already hidden */ }
  }
  events.sort((a, b) => a.onsetQuarter - b.onsetQuarter);
  return { events, notes, tempoEntries };
}
```

Update the call site at the bottom of `osmdRender`:

```js
  const { events, notes, tempoEntries } = extractEvents(osmd);
  const svg = host.querySelector('svg');
  const width = Math.ceil(Number(svg?.getAttribute('width')) || svg?.clientWidth || host.clientWidth || 0);
  const height = Math.ceil(Number(svg?.getAttribute('height')) || svg?.clientHeight || host.clientHeight || 0);
  return { width, height, flow, events, notes, tempoEntries };
```

Update ScorePlayer's initial layout state (`ScorePlayer.jsx:62`):
```js
  const [layout, setLayout] = useState({ events: [], notes: [], tempoEntries: [], width: 0, height: 0, flow: null });
```

Note: `osmdRender` doesn't currently include `flow` in the object literal name-for-name — it does (`return { width, height, flow, events … }`); keep it, ScorePlayer will use it in Task 10.

**Step 4: Run** both suites:
```bash
npx vitest run frontend/src/modules/MusicNotation frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic
```
Expected: PASS (existing `pickMelodyNote` tests unchanged; ScorePlayer test's stubbed renderer is unaffected).

**Step 5: Commit.**
```bash
git add -A && git commit -m "feat(notation): OSMD walk yields tempo entries, chord sets, and playback notes"
```

---

## Phase 3 — Transport

### Task 7: `useScoreTransport` — rAF wall-clock scheduler with pause/seek (audit A2/A5)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTransport.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTransport.test.js`

Mirrors `useLoopTransport` (rAF + `performance.now()` anchor — no cumulative drift), adds non-looping end, pause/resume at exact position, and seek.

**Step 1: Write the failing tests:**

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScoreTransport } from './useScoreTransport.js';

// Drive rAF off the fake-timer clock so vi.advanceTimersByTime moves playback.
beforeEach(() => {
  vi.useFakeTimers();
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => { now = Date.now(); cb(now); }, 16));
  vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
  vi.setSystemTime(0);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const TL = [
  { t: 0, index: 0 }, { t: 500, index: 1 }, { t: 1000, index: 2 }, { t: 1500, index: 3 },
];

describe('useScoreTransport', () => {
  it('fires events at their absolute times (no per-step drift)', () => {
    const fired = [];
    const { result } = renderHook(() => useScoreTransport({ timeline: TL, onEvent: (e) => fired.push(e.index) }));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(520));
    expect(fired).toEqual([0, 1]);
    act(() => vi.advanceTimersByTime(1100));
    expect(fired).toEqual([0, 1, 2, 3]);
  });

  it('finishes: stops playing and calls onDone after the last event', () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useScoreTransport({ timeline: TL, onEvent: () => {}, onDone }));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(2000));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(result.current.playing).toBe(false);
  });

  it('pause holds position; resume does not replay or skip', () => {
    const fired = [];
    const { result } = renderHook(() => useScoreTransport({ timeline: TL, onEvent: (e) => fired.push(e.index) }));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(700)); // fired 0, 1
    act(() => result.current.pause());
    act(() => vi.advanceTimersByTime(5000)); // paused — nothing fires
    expect(fired).toEqual([0, 1]);
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(320)); // 700 + 320 > 1000
    expect(fired).toEqual([0, 1, 2]);
  });

  it('seek repositions; the event AT the seek time fires on resume', () => {
    const fired = [];
    const { result } = renderHook(() => useScoreTransport({ timeline: TL, onEvent: (e) => fired.push(e.index) }));
    act(() => result.current.seek(1000));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(40));
    expect(fired).toEqual([2]);
  });

  it('stop resets to the top', () => {
    const fired = [];
    const { result } = renderHook(() => useScoreTransport({ timeline: TL, onEvent: (e) => fired.push(e.index) }));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(700));
    act(() => result.current.stop());
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(40));
    expect(fired).toEqual([0, 1, 0]);
  });
});
```

**Step 2: Run → FAIL** (module missing).
```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTransport.test.js
```

**Step 3: Implement:**

```js
import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * useScoreTransport — non-looping playback over a flat, time-sorted event list
 * [{t, ...}] (ms from piece start). rAF + performance.now() anchor, mirroring
 * the proven loop/Studio transports: every tick fires all events whose t has
 * passed, so lateness never accumulates (audit A2). Pause stores the exact
 * position; play resumes from it; seek(ms) repositions (audit A5).
 *
 * Consumers do the real work in onEvent (cursor step, MIDI out) — the
 * transport itself is domain-blind.
 */
export function useScoreTransport({ timeline, onEvent, onDone }) {
  const [playing, setPlaying] = useState(false);
  const timelineRef = useRef(timeline); timelineRef.current = timeline || [];
  const onEventRef = useRef(onEvent); onEventRef.current = onEvent;
  const onDoneRef = useRef(onDone); onDoneRef.current = onDone;
  const rafRef = useRef(null);
  const anchorRef = useRef(0); // wall time corresponding to position 0
  const posRef = useRef(0);    // position while paused (ms)
  const idxRef = useRef(0);    // next unfired event

  const tick = useCallback(() => {
    const tl = timelineRef.current;
    const pos = performance.now() - anchorRef.current;
    while (idxRef.current < tl.length && tl[idxRef.current].t <= pos) {
      onEventRef.current?.(tl[idxRef.current]);
      idxRef.current += 1;
    }
    if (idxRef.current >= tl.length) {
      posRef.current = 0; idxRef.current = 0;
      setPlaying(false);
      onDoneRef.current?.();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const play = useCallback(() => {
    if (!timelineRef.current.length) return;
    anchorRef.current = performance.now() - posRef.current;
    cancelAnimationFrame(rafRef.current);
    setPlaying(true);
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const pause = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    posRef.current = performance.now() - anchorRef.current;
    setPlaying(false);
  }, []);

  /** Reposition (works while playing or paused). Event at exactly `ms` will fire. */
  const seek = useCallback((ms) => {
    const pos = Math.max(0, ms);
    posRef.current = pos;
    const tl = timelineRef.current;
    let i = tl.findIndex((e) => e.t >= pos);
    idxRef.current = i < 0 ? tl.length : i;
    anchorRef.current = performance.now() - pos;
  }, []);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    posRef.current = 0; idxRef.current = 0;
    setPlaying(false);
  }, []);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);
  return { playing, play, pause, seek, stop };
}

export default useScoreTransport;
```

**Step 4: Run → PASS. Step 5: Commit.**
```bash
git add -A && git commit -m "feat(piano): useScoreTransport — drift-free rAF transport with pause/seek"
```

### Task 8: Wire Metronome mode to the transport (audit A1/A2/A5/A6)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx`

**Step 1: Write the failing test** (uses the same fake-clock harness as Task 7 — hoist the rAF/performance mocking into a shared `beforeEach` in this file's new describe):

```js
describe('ScorePlayer — Metronome mode (transport-driven)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => { now = Date.now(); cb(now); }, 16));
    vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
    vi.setSystemTime(0);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  // h.events onsets are 0,1,2,3 quarters; stub layout has no tempoEntries →
  // fallback tempo comes from parsed XML; the test XML has none → 90bpm default
  // is awkward, so report a tempo map via the layout stub instead:
  it('advances the cursor on the tempo map, including a mid-piece change', async () => {
    h.layoutExtras = { tempoEntries: [{ onsetQuarter: 0, bpm: 60 }, { onsetQuarter: 2, bpm: 120 }] };
    renderPlayer();
    screen.getByText('Metronome').click();
    await act(async () => {});
    screen.getByText('▶').click();
    await act(async () => {});

    act(() => vi.advanceTimersByTime(1050)); // 1q @60 = 1000ms
    expect(screen.getByText('2 / 4')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1050)); // 2nd quarter @60
    expect(screen.getByText('3 / 4')).toBeTruthy();
    act(() => vi.advanceTimersByTime(550)); // 3rd quarter @120 = 500ms
    expect(screen.getByText('4 / 4')).toBeTruthy();
  });
});
```

Support in the renderer stub: merge extras into the reported layout —

```js
    MusicXmlRenderer: ({ onLayout, children }) => {
      useEffect(() => {
        onLayout?.({ width: 800, height: 400, events: h.events, notes: [], tempoEntries: [], ...h.layoutExtras });
      }, [onLayout]);
      return <div data-testid="renderer">{children}</div>;
    },
```
(and add `layoutExtras: {}` to the hoisted holder, reset in a global `beforeEach`).

**Step 2: Run → FAIL** (old setTimeout metronome uses flat 90bpm and drifts differently; the mid-piece change assertion fails).

**Step 3: Implement in `ScorePlayer.jsx`.**

Imports:
```js
import { buildTempoMap, buildStepTimeline, msAtQuarter } from '../../../../MusicNotation/scoreTimeline.js';
import { useScoreTransport } from './useScoreTransport.js';
```

Replace the `running` state + metronome effect with transport wiring:

```js
  const tempoMap = useMemo(
    () => buildTempoMap(layout.tempoEntries, parsed?.tempo || 90),
    [layout.tempoEntries, parsed],
  );
  const stepTimeline = useMemo(() => buildStepTimeline(events, tempoMap), [events, tempoMap]);

  const transport = useScoreTransport({
    timeline: mode === 'metronome' ? stepTimeline : [],
    onEvent: (e) => setStep(e.index),
    onDone: () => logger.info('score.metronome.done', { steps: events.length }),
  });
  const running = transport.playing;
```

- Header meta tempo becomes the map's opening tempo: `tempo: tempoMap[0].bpm` (keep `parsed?.tempo` as the pre-layout fallback — `tempoMap` already folds it in).
- ▶ button handler: `onClick={() => { if (running) { transport.pause(); logger.info('score.transport.pause', { step }); } else { transport.seek(stepTimeline[stepRef.current]?.t ?? 0); transport.play(); logger.info('score.transport.play', { step, bpm: tempoMap[0].bpm }); } }}` and disable it when `!events.length` (audit A6): `disabled={!events.length}`.
- `reset` becomes: `const reset = () => { transport.stop(); setStep(0); scrollRef.current?.scrollTo({ top: 0, left: 0 }); };`
- Mode switch: `onClick={() => { setMode(m.id); transport.stop(); logger.info('score.mode', { mode: m.id }); }}`.
- Tap-to-seek (in `onScoreClick`, after `setStep(i)`): `transport.seek(stepTimeline[i]?.t ?? 0);` — works while running (transport retargets mid-flight).
- `useReloadGuard(running)` and the `setGlobalPlaying` effect keep working off the new `running`.
- DELETE the old `const [running, setRunning] = useState(false)` and the whole `// Metronome mode: advance at tempo while running` setTimeout effect, and all other `setRunning` call sites.

**Step 4: Run the whole SheetMusic suite → PASS.**
```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic
```

**Step 5: Commit.**
```bash
git add -A && git commit -m "feat(piano): metronome mode rides the tempo-mapped transport (fixes tempo + drift)"
```

---

## Phase 4 — MIDI feedback correctness

### Task 9: Expected-set follow logic + metronome target highlight (audit B2/B1)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx`

**Step 1: Write the failing tests.** Give the stub events chord sets: update `h.events` so event 0 carries `midis: [64, 52, 40]` (melody E4 + accompaniment E3/E2), others `midis: [<their midi>]`. Then:

```js
describe('ScorePlayer — Follow mode chord tolerance (audit B2)', () => {
  it('does not flash wrong for accompaniment notes that belong to the current onset', () => {
    renderPlayer();
    play(52); // LH note of the current onset — correct playing, no advance, NO flash
    expect(document.querySelector('.piano-score-cursor.is-wrong')).toBeNull();
    expect(screen.getByText('1 / 4')).toBeTruthy();
    play(63); // a real wrong note near the melody → flash
    expect(document.querySelector('.piano-score-cursor.is-wrong')).not.toBeNull();
  });
});
```

**Step 2: Run → FAIL** (52 is within 24 of 64 → current code flashes).

**Step 3: Implement.** In the follow-mode subscriber:

```js
      const ev = events[stepRef.current];
      if (!ev) return;
      const expected = ev.midis || [ev.midi];
      if (evt.note === ev.midi) setStep((s) => Math.min(events.length - 1, s + 1));
      else if (!expected.includes(evt.note) && Math.abs(evt.note - ev.midi) <= 24) flashWrong();
```

And the keyboard target set (horizontal-flow strip) highlights the full onset in BOTH follow and metronome modes:

```js
            targetNotes={mode !== 'manual' && current ? new Set(current.midis || [current.midi]) : null}
```

**Step 4: Run → PASS (whole SheetMusic dir). Step 5: Commit.**
```bash
git add -A && git commit -m "fix(piano): follow mode tolerates the onset's own chord/bass notes; metronome shows targets"
```

---

## Phase 5 — Scroll smoothness & cursor integrity

### Task 10: Retargetable scroll tween + stale-layout gate + cursor polish (audit C1/C2/D2/F3)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/scrollTween.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/scrollTween.test.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx` (auto-scroll effect, cursor style)
- Modify: `frontend/src/Apps/PianoApp.scss:2036-2047` (cursor transition)

**Step 1: Write the failing tests:**

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tweenScrollTo, cancelScrollTween } from './scrollTween.js';

beforeEach(() => {
  vi.useFakeTimers();
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => { now = Date.now(); cb(now); }, 16));
  vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
  vi.setSystemTime(0);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const el = () => ({ scrollLeft: 0, scrollTop: 0 });

describe('tweenScrollTo', () => {
  it('reaches the target and stops', () => {
    const e = el();
    tweenScrollTo(e, { left: 300 }, { duration: 160 });
    vi.advanceTimersByTime(400);
    expect(Math.round(e.scrollLeft)).toBe(300);
  });
  it('RETARGETS an in-flight tween instead of restarting from a stale origin', () => {
    const e = el();
    tweenScrollTo(e, { left: 300 }, { duration: 160 });
    vi.advanceTimersByTime(64); // mid-flight
    const mid = e.scrollLeft;
    expect(mid).toBeGreaterThan(0);
    tweenScrollTo(e, { left: 600 }, { duration: 160 }); // new target, no jump back
    vi.advanceTimersByTime(16);
    expect(e.scrollLeft).toBeGreaterThanOrEqual(mid);
    vi.advanceTimersByTime(400);
    expect(Math.round(e.scrollLeft)).toBe(600);
  });
  it('cancelScrollTween halts motion', () => {
    const e = el();
    tweenScrollTo(e, { left: 300 }, { duration: 160 });
    vi.advanceTimersByTime(48);
    const at = e.scrollLeft;
    cancelScrollTween(e);
    vi.advanceTimersByTime(200);
    expect(e.scrollLeft).toBe(at);
  });
});
```

**Step 2: Run → FAIL. Step 3: Implement `scrollTween.js`:**

```js
// scrollTween — retargetable rAF scroll animation.
//
// Native smooth scrollIntoView CANCELS the in-flight animation whenever a new
// call lands, so per-note cursor following stutters above ~2 steps/sec
// (audit C1). This tween instead RETARGETS: a new call updates the
// destination and the running frame loop glides on from wherever it is.

const STATE = Symbol('scrollTween');

export function tweenScrollTo(el, target, { duration = 180 } = {}) {
  if (!el) return;
  const existing = el[STATE];
  const next = {
    from: { left: el.scrollLeft, top: el.scrollTop },
    to: {
      left: target.left != null ? Math.max(0, target.left) : el.scrollLeft,
      top: target.top != null ? Math.max(0, target.top) : el.scrollTop,
    },
    start: performance.now(),
    duration,
  };
  if (existing) { Object.assign(existing, next); return; } // retarget in flight
  const s = (el[STATE] = next);
  const frame = () => {
    const k = Math.min(1, (performance.now() - s.start) / s.duration);
    const e = 1 - (1 - k) ** 3; // ease-out cubic
    el.scrollLeft = s.from.left + (s.to.left - s.from.left) * e;
    el.scrollTop = s.from.top + (s.to.top - s.from.top) * e;
    if (k < 1) s.raf = requestAnimationFrame(frame);
    else el[STATE] = null;
  };
  s.raf = requestAnimationFrame(frame);
}

export function cancelScrollTween(el) {
  const s = el?.[STATE];
  if (s) { cancelAnimationFrame(s.raf); el[STATE] = null; }
}
```

**Step 4: Run → PASS.**

**Step 5: Rewire ScorePlayer's auto-scroll** (replaces the `scrollIntoView` effect — also gates on layout freshness, audit F3/D1 interplay):

```js
  // Auto-follow the cursor: retargetable tween on the scroll container only
  // (native smooth scrollIntoView self-cancels at per-note cadence and drags
  // ancestor scrollers with it). Skipped while the reported layout belongs to
  // the other flow (mid re-engrave — coordinates would be stale).
  useEffect(() => {
    if (mode === 'manual' || !current) return;
    if (layout.flow && layout.flow !== flow) return;
    const el = scrollRef.current;
    const rdr = el?.querySelector('.musicxml-renderer');
    if (!el || !rdr) return;
    const rdrLeft = rdr.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
    const rdrTop = rdr.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    if (flow === 'horizontal') {
      tweenScrollTo(el, { left: rdrLeft + current.x - el.clientWidth / 2 });
    } else {
      const mid = rdrTop + (current.top + current.bottom) / 2;
      const targetTop = mid - el.clientHeight / 2;
      // Re-center only when the cursor drifts out of the comfortable band —
      // avoids a vertical micro-scroll on every step within a system.
      if (Math.abs(targetTop - el.scrollTop) > el.clientHeight * 0.18) tweenScrollTo(el, { top: targetTop });
    }
  }, [step, flow, mode, current, layout.flow]);
```

Cancel on unmount/mode change into manual: `useEffect(() => () => cancelScrollTween(scrollRef.current), []);`

**Step 6: Cursor polish.**
- Zoom-aware geometry (audit D2) — cursor style becomes:
```jsx
              style={{
                left: current.x - 9 * scale,
                top: current.top,
                width: Math.round(18 * scale),
                height: Math.max(40 * scale, current.bottom - current.top),
                '--cursor-color': cursorColor,
              }}
```
- System-jump teleport (audit C2) — in ScorePlayer:
```js
  const prevTopRef = useRef(null);
  const jump = current != null && prevTopRef.current != null && Math.abs(current.top - prevTopRef.current) > 1;
  useEffect(() => { prevTopRef.current = current?.top ?? null; }, [current]);
```
  add `${jump ? ' is-jump' : ''}` to the cursor className, and in `PianoApp.scss` (cursor block): remove `width: 18px;` (now inline) and add
```scss
  &.is-jump { transition: none; } // system break — teleport, don't sweep diagonally
```

**Step 7: Run the whole SheetMusic suite → PASS. Step 8: Commit.**
```bash
git add -A && git commit -m "feat(piano): retargetable scroll tween, zoom-aware cursor, no diagonal system sweeps"
```

### Task 11: Hide the cursor during re-engraves (audit D1/F2)

**Files:**
- Modify: `frontend/src/modules/MusicNotation/renderers/MusicXmlRenderer.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss` (busy shimmer)

**Step 1: Implement** (state-only change; covered by the visual verify below — jsdom can't exercise the async OSMD path since osmdRender needs a real DOM/SVG):

In `MusicXmlRenderer`, add `const [rendering, setRendering] = useState(false);` and in the render effect:

```js
    setRendering(true);
    (async () => {
      try {
        const res = await osmdRender(host, musicXml, { width: w, flow, scale, shouldAbort: stale });
        if (!res || stale()) return;
        setFailed(false);
        setDims({ width: res.width, height: res.height });
        onLayout?.(res);
      } catch (err) {
        if (stale()) return;
        setFailed(true);
        logger().warn('musicxml.render-failed', { error: err?.message });
      } finally {
        if (!stale()) setRendering(false);
      }
    })();
```

And in the JSX — suppress the overlay (cursor) and show a shimmer while engraving:

```jsx
      {!showPlaceholder && rendering && dims.width > 0 && <div className="musicxml-renderer__busy">Engraving…</div>}
      {!showPlaceholder && !rendering && children}
```

SCSS (near `.musicxml-renderer` rules):
```scss
.musicxml-renderer__busy {
  position: absolute; inset: 0; z-index: 6;
  display: flex; align-items: center; justify-content: center;
  color: #6a6256; font-weight: 600; background: rgba(252, 250, 244, 0.7);
}
```

**Step 2: Run existing renderer-consumer tests** (`npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic`) — the ScorePlayer stub bypasses this component, so expect PASS.

**Step 3: Visual verify** on the dev server: click A+/A− and toggle Wrap↔Scroll; the cursor must never float over blank paper; the shimmer shows during zoom re-engraves.

**Step 4: Commit.**
```bash
git add -A && git commit -m "fix(notation): hide overlay + show busy state while OSMD re-engraves"
```

---

## Phase 6 — Zoom performance

### Task 12: Reuse the OSMD instance for zoom/resize (audit F1)

**Files:**
- Modify: `frontend/src/modules/MusicNotation/renderers/osmdRender.js`
- Modify: `frontend/src/modules/MusicNotation/renderers/MusicXmlRenderer.jsx`

`osmd.load(xml)` (full MusicXML parse) is the expensive step and only depends on the document + flow (`renderSingleHorizontalStaffline` is constructor-time). Zoom and container-width changes only need `osmd.Zoom = s; osmd.render()`.

**Step 1: Split the render path in `osmdRender.js`.** Extract the post-load half:

```js
/** Re-render an already-loaded OSMD instance (zoom/resize) and re-extract layout. */
export function osmdReRender(osmd, host, opts = {}) {
  const scale = Math.max(0.5, Math.min(2.5, opts.scale || 1));
  if (opts.width) host.style.width = `${opts.width}px`;
  osmd.Zoom = scale;
  osmd.render();
  const { events, notes, tempoEntries } = extractEvents(osmd);
  const svg = host.querySelector('svg');
  const width = Math.ceil(Number(svg?.getAttribute('width')) || svg?.clientWidth || host.clientWidth || 0);
  const height = Math.ceil(Number(svg?.getAttribute('height')) || svg?.clientHeight || host.clientHeight || 0);
  return { width, height, flow: opts.flow, events, notes, tempoEntries, osmd };
}
```

`osmdRender` ends with `return osmdReRender(osmd, host, { width: 0, flow, scale })` (width already applied at the top; pass `flow` through) and adds `osmd` to its result implicitly via `osmdReRender`.

**Step 2: Cache in `MusicXmlRenderer`.** Add refs and branch the effect:

```js
  const osmdRef = useRef(null);      // loaded OSMD instance
  const osmdKeyRef = useRef(null);   // `${flow}::${musicXml}` the instance was loaded for
```

Inside the render effect, before the async full path:

```js
    const cacheKey = `${flow}::${musicXml}`;
    if (osmdRef.current && osmdKeyRef.current === cacheKey) {
      // Cheap path: same document + flow — re-render in place (zoom / resize).
      try {
        const res = osmdReRender(osmdRef.current, host, { width: w, flow, scale });
        setDims({ width: res.width, height: res.height });
        onLayout?.(res);
        setRendering(false);
        return undefined;
      } catch (err) {
        logger().warn('musicxml.rerender-failed', { error: err?.message });
        osmdRef.current = null; // fall through to a full engrave
      }
    }
```

And in the full path's success branch: `osmdRef.current = res.osmd; osmdKeyRef.current = cacheKey;`. Clear the ref on unmount (`useEffect(() => () => { osmdRef.current = null; }, [])`).

Note the cheap path is synchronous — set `setRendering(true)` only on the full path (move the call after the cache branch) so zoom doesn't flash the shimmer.

**Step 3: Run the notation + SheetMusic suites → PASS.**

**Step 4: Verify on the dev server:** A+/A− should now re-render near-instantly (no shimmer, cursor stays); Wrap↔Scroll still does a full engrave with shimmer. Confirm zoom keeps the cursor on the same note (step survives; coordinates refresh via onLayout).

**Step 5: Commit.**
```bash
git add -A && git commit -m "perf(notation): reuse loaded OSMD instance for zoom/resize — skip XML re-parse"
```

---

## Phase 7 — Play mode (playback + hybrid accompaniment)

### Task 13: Part settings + merged play timeline (pure logic)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/playParts.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/playParts.test.js`

One new mode covers both asks: **Play** performs parts set to `play` through the piano, mutes parts set to `mute`, and treats `you` parts as the user's (engraved + highlighted, not sounded). Both-`play` = pure playback; RH-`you`/LH-`play` = hybrid practice.

**Step 1: Write the failing tests:**

```js
import { describe, it, expect } from 'vitest';
import { partsOf, cyclePart, buildPlayTimeline, youMidisAt } from './playParts.js';

const NOTES = [
  { midi: 76, staff: 0, onsetQuarter: 0, durationQuarters: 1 },
  { midi: 40, staff: 1, onsetQuarter: 0, durationQuarters: 2 },
  { midi: 77, staff: 0, onsetQuarter: 1, durationQuarters: 1 },
];
const EVENTS = [{ onsetQuarter: 0, midi: 76 }, { onsetQuarter: 1, midi: 77 }];
const MAP = [{ onsetQuarter: 0, bpm: 60 }];

describe('partsOf', () => {
  it('lists distinct staves in order with default role play', () => {
    expect(partsOf(NOTES)).toEqual([{ staff: 0, role: 'play' }, { staff: 1, role: 'play' }]);
  });
});

describe('cyclePart', () => {
  it('cycles play → you → mute → play', () => {
    expect(cyclePart('play')).toBe('you');
    expect(cyclePart('you')).toBe('mute');
    expect(cyclePart('mute')).toBe('play');
  });
});

describe('buildPlayTimeline', () => {
  it('merges cursor steps with note on/offs for audible parts only, time-sorted', () => {
    const tl = buildPlayTimeline(EVENTS, NOTES, MAP, { 0: 'you', 1: 'play' });
    expect(tl.map((e) => e.kind ?? e.type)).toEqual(['step', 'note_on', 'step', 'note_off']);
    expect(tl.find((e) => e.type === 'note_on').note).toBe(40); // only the LH sounds
  });
});

describe('youMidisAt', () => {
  it('returns the you-part pitches at an onset', () => {
    expect([...youMidisAt(NOTES, { 0: 'you', 1: 'play' }, 0)]).toEqual([76]);
    expect(youMidisAt(NOTES, { 0: 'play', 1: 'play' }, 0)).toBeNull();
  });
});
```

**Step 2: Run → FAIL. Step 3: Implement `playParts.js`:**

```js
// playParts — Play-mode part model. A "part" is a staff of the engraved score;
// each part has a role: 'play' (kiosk performs it through the piano),
// 'mute' (silent), or 'you' (the user's part — engraved + highlighted, never
// sent to MIDI out). Both-play = pure playback; melody-'you' = hybrid practice.

import { buildStepTimeline, buildNoteTimeline } from '../../../../MusicNotation/scoreTimeline.js';

/** Distinct staves present in the extracted notes, default role 'play'. */
export function partsOf(notes) {
  const staves = [...new Set((notes || []).map((n) => n.staff))].sort((a, b) => a - b);
  return staves.map((staff) => ({ staff, role: 'play' }));
}

const CYCLE = { play: 'you', you: 'mute', mute: 'play' };
export function cyclePart(role) { return CYCLE[role] || 'play'; }

/**
 * Merged transport timeline: cursor steps ({kind:'step', index}) + note events
 * for audible parts. Steps sort before notes at the same instant so the cursor
 * lands before its notes sound.
 */
export function buildPlayTimeline(events, notes, tempoMap, roles) {
  const steps = buildStepTimeline(events, tempoMap).map((s) => ({ ...s, kind: 'step' }));
  const noteEvts = buildNoteTimeline(notes, tempoMap, { isAudible: (n) => (roles[n.staff] || 'play') === 'play' });
  return [...steps, ...noteEvts].sort((a, b) => a.t - b.t || (a.kind === 'step' ? -1 : b.kind === 'step' ? 1 : 0));
}

/** Pitches of 'you' parts at an exact onset, or null when no you-part is set. */
export function youMidisAt(notes, roles, onsetQuarter) {
  if (!Object.values(roles).includes('you')) return null;
  const set = new Set(
    (notes || [])
      .filter((n) => (roles[n.staff] || 'play') === 'you' && n.onsetQuarter === onsetQuarter)
      .map((n) => n.midi),
  );
  return set.size ? set : null;
}
```

**Step 4: Run → PASS. Step 5: Commit.**
```bash
git add -A && git commit -m "feat(piano): playParts — part roles + merged play timeline"
```

### Task 14: Wire Play mode into ScorePlayer

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss` (part chips)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx`

**Step 1: Write the failing test** (fake clock as before; extend the MIDI mock with spies):

```js
// in the usePianoMidi mock, add:
//   pressNote: h.pressNote, releaseNote: h.releaseNote, sendPanic: h.sendPanic,
// with h.pressNote = vi.fn() etc. reset in beforeEach.

describe('ScorePlayer — Play mode', () => {
  // fake-clock beforeEach/afterEach identical to the Metronome describe
  it('sounds only parts set to play, and stops silence via panic', async () => {
    h.layoutExtras = {
      tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
      notes: [
        { midi: 64, staff: 0, onsetQuarter: 0, durationQuarters: 1 },
        { midi: 40, staff: 1, onsetQuarter: 0, durationQuarters: 4 },
      ],
    };
    renderPlayer();
    screen.getByText('Play').click();
    await act(async () => {});
    screen.getByText('RH: Play').click(); // cycle RH play → you
    await act(async () => {});
    screen.getByText('▶').click();
    await act(async () => {});
    act(() => vi.advanceTimersByTime(100));
    expect(h.pressNote).toHaveBeenCalledWith(40, expect.any(Number)); // LH sounds
    expect(h.pressNote).not.toHaveBeenCalledWith(64, expect.any(Number)); // RH is yours
    screen.getByText('❚❚').click(); // pause mid-note
    await act(async () => {});
    expect(h.sendPanic).toHaveBeenCalled(); // no droning chord
  });
});
```

**Step 2: Run → FAIL** (no Play mode).

**Step 3: Implement in `ScorePlayer.jsx`.**

- Imports: `import { partsOf, cyclePart, buildPlayTimeline, youMidisAt } from './playParts.js';`
- MODES gains `{ id: 'play', label: 'Play' }` (after Metronome).
- Pull the senders: `const { activeNotes, subscribe, subscribeRaw, pressNote, releaseNote, sendPanic } = usePianoMidi();`
- Part roles state, re-seeded when the score's staves change:

```js
  const [roles, setRoles] = useState({});
  const parts = useMemo(() => partsOf(layout.notes), [layout.notes]);
  useEffect(() => { setRoles(Object.fromEntries(parts.map((p) => [p.staff, 'play']))); }, [parts]);
```

- Timeline selection (replaces the metronome-only ternary from Task 8):

```js
  const playTimeline = useMemo(
    () => (mode === 'play' ? buildPlayTimeline(events, layout.notes, tempoMap, roles) : stepTimeline),
    [mode, events, layout.notes, tempoMap, roles, stepTimeline],
  );
  const soundingRef = useRef(new Set());
  const silence = useCallback(() => {
    soundingRef.current.forEach((n) => { try { releaseNote(n); } catch { /* port gone */ } });
    soundingRef.current.clear();
    // BLE one-turn-late bug can swallow a lone terminal note-off — panic (CC123)
    // goes through the flushed path (contract established by the Producer transport).
    sendPanic?.();
  }, [releaseNote, sendPanic]);

  const transport = useScoreTransport({
    timeline: mode === 'metronome' || mode === 'play' ? playTimeline : [],
    onEvent: (e) => {
      if (e.kind === 'step') { setStep(e.index); return; }
      if (e.type === 'note_on') { pressNote(e.note, e.velocity ?? 80); soundingRef.current.add(e.note); }
      else { releaseNote(e.note); soundingRef.current.delete(e.note); }
    },
    onDone: () => { silence(); logger.info('score.transport.done', { mode }); },
  });
```

- Pause/stop/mode-switch/reset all call `silence()` after `transport.pause()`/`transport.stop()` (only when `mode === 'play'`; it's harmless but log-noisy otherwise). Unmount cleanup: `useEffect(() => () => silence(), [silence])`.
- Transport ▶ button shows for `mode === 'metronome' || mode === 'play'`.
- Part chips (only in play mode, between flow toggle and zoom):

```jsx
          {mode === 'play' && parts.map((p) => {
            const role = roles[p.staff] || 'play';
            const label = `${p.staff === 0 ? 'RH' : p.staff === 1 ? 'LH' : `P${p.staff + 1}`}: ${role === 'play' ? 'Play' : role === 'you' ? 'You' : 'Mute'}`;
            return (
              <button key={p.staff} type="button" className={`piano-score-mode piano-score-part--${role}`}
                onClick={() => {
                  const next = cyclePart(role);
                  setRoles((r) => ({ ...r, [p.staff]: next }));
                  transport.pause(); silence(); // role change invalidates the note timeline mid-flight
                  logger.info('score.play.part', { staff: p.staff, role: next });
                }}>{label}</button>
            );
          })}
```

- Cursor color: `const cursorColor = mode === 'follow' ? '#2ec46f' : mode === 'play' ? '#e8a33d' : '#6cf';`
- Keyboard targets in play mode highlight the *you* part: extend the Task 9 expression —

```jsx
            targetNotes={
              mode === 'play' && current ? youMidisAt(layout.notes, roles, current.onsetQuarter)
              : mode !== 'manual' && current ? new Set(current.midis || [current.midi])
              : null
            }
```

- SCSS chips:

```scss
.piano-score-part--you { background: #e8a33d; border-color: #e8a33d; color: #1d1405; }
.piano-score-part--mute { opacity: 0.55; }
```

**Step 4: Run the whole SheetMusic suite → PASS. Step 5: Commit.**
```bash
git add -A && git commit -m "feat(piano): Play mode — kiosk performs selected parts, You-parts highlighted (hybrid practice)"
```

### Task 15: Live verify Play mode end-to-end

No unit test can cover BLE MIDI out. Verify against the real rig (yellow-room tablet + Jamcorder + MDG-400, all reachable over LAN — see CLAUDE.local.md).

**Step 1:** On the dev server (desktop browser first): open a two-staff MusicXML score → Play mode → ▶. Confirm in the console (`window.DAYLIGHT_LOG_LEVEL = 'debug'`) that `midi.out.*`-adjacent flows fire and the cursor tracks the tempo map; pause must log panic and leave no sounding notes.

**Step 2:** On the piano kiosk (FKB tablet, `10.0.0.245`): load the same route, confirm the MDG-400 actually sounds the accompaniment (Jamcorder `bleToDin: true` must hold — check `http://10.0.0.244/api/midi-io/settings/get` if silent), RH=You highlights keys on the strip, and pause silences instantly.

**Step 3:** Record results (what was tested, what worked, any deviations) at the bottom of the audit doc, per verification-before-completion — evidence before claims.

---

## Final tasks

### Task 16: Full suite + docs

**Step 1:** Run everything touched:
```bash
npx vitest run frontend/src/modules/Piano frontend/src/modules/MusicNotation
```
Expected: PASS, zero skips (repo test discipline: skipping is not passing).

**Step 2:** Update docs:
- Append an "Implemented 2026-07-XX" status section to `docs/_wip/audits/2026-07-02-piano-sheetmusic-metronome-playback-audit.md` mapping finding IDs → commits (note what was deliberately deferred: D3 style-read optimization, continuous time-based pan, metronome click/count-in — audit A3 remains open).
- If `docs/reference/piano/` gains a sheet-music page later, this plan + audit are the source material; do not create a new point-in-time snapshot now (repo docs rules).

**Step 3: Commit.**
```bash
git add -A && git commit -m "docs(piano): mark sheet-music audit findings implemented; note deferrals"
```

### Task 17: Finish the branch

Use superpowers:finishing-a-development-branch. Repo policy: merge directly into main (no PRs) **only when the user has reviewed/approved**; delete the branch after merge and log it in `docs/_archive/deleted-branches.md`. Do not deploy — prod builds from the homeserver tree; per CLAUDE.local.md, sync/integration with the homeserver deploy tree is a user-involved step.

---

## Deferred (explicitly out of scope — YAGNI for this pass)

- **A3 metronome click / count-in** — needs an audio-policy decision (WebAudio vs MIDI click on the piano); flagged in the audit, design with the user.
- **A4 beat-based (vs melody-onset) advancement** — the tempo map makes this easy to add later as interleaved beat events; not needed for correctness.
- **D3 extractEvents reflow-per-note optimization** — measure first (may be moot after Task 12's instance reuse).
- **C1's continuous time-based pan** — the retargeting tween already removes the stutter; continuous pan is a feel upgrade to evaluate on the tablet afterward.
- **Accuracy scoring / hit-miss tally in Play mode** — highlight-only for v1.
