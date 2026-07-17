# Composer Mode — Implementation Plan (P0 + P1)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the hardware-independent foundation of the Composer notation editor — a pure-JS document model, a MusicXML serializer, a full-fidelity parser extension, editing commands with undo, and the data-loss round-trip test that is the whole design's spine — plus the P0 kiosk-reality spike that gates the later UI architecture.

**Architecture:** Composer owns a plain-JS `Score` document model. Edits go through pure `EditorCommand` functions (immutable, snapshot-undo). The model serializes to MusicXML (which is both the save format and OSMD's render input) and parses back losslessly. This plan builds *only* that pure core (no React, no OSMD, no backend) plus a measurement spike; the rendering/UI/persistence phases (P2–P6) get a follow-up plan once P0's tablet numbers are in.

**Tech Stack:** JavaScript (ES modules), Vitest (colocated `*.test.js`, run with `npx vitest run <path>`), the existing `frontend/src/modules/MusicNotation/` framework (parser + OSMD renderer), DOMParser (browser/jsdom, provided by the vitest frontend environment).

**Spec:** `docs/reference/piano/composer.md` — the authority. Read §3 (model), §4 (round-trip), §7 (record/quantize) before starting. This plan implements the pure-logic subset of §3/§4 and the P0 spike from §14.

**Provenance:** `docs/_wip/plans/2026-07-17-composer-requirements.md` (requirements + research + adversarial-review findings folded into the spec).

---

## Conventions for the executor

- **You know this repo poorly. Trust exact paths and commands here; when unsure, read the file named.**
- **Test runner:** `npx vitest run <path-to-test>` runs one colocated test file. `npx vitest run frontend/src/modules/MusicNotation/` runs the whole MusicNotation suite. Never `npm test` (that's a different, backend harness).
- **Test pattern:** copy `frontend/src/modules/MusicNotation/parseMusicXml.test.js` — `import { describe, it, expect } from 'vitest';`, fixtures via `import xml from './__fixtures__/foo.musicxml?raw';`.
- **All new pure-logic files live in `frontend/src/modules/MusicNotation/`** (the serializer beside its inverse parser) **or `frontend/src/modules/Piano/PianoKiosk/modes/Composer/model/`** (the editor state/commands). Exact path is given per task.
- **Internal time resolution is fixed: `DIVISIONS = 24` per quarter note.** 24 is divisible by 2/3/4/6/8, so 16ths (6), eighths (12), quarters (24), 8th-triplets (8), and dots (×1.5 → integers) are all exact. This is the `<divisions>` value the serializer always emits.
- **Commit after every green task.** Message style: `feat(composer): <what>` / `test(composer): <what>`. End every commit message with:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```
- **DRY / YAGNI / TDD.** Write the failing test first, watch it fail, implement minimally, watch it pass, commit. Do not build fields or branches no test demands.
- **Additive-only to shared code:** `parseMusicXml.js` is consumed by SheetMusic mode. Every change to it must keep the existing `parseMusicXml.test.js` green. Run that file after every parser edit.

---

## Pre-flight: worktree + branch

**Step 1: Create an isolated worktree** (per CLAUDE.md — feature work uses worktrees; keep `main` clean).

Run:
```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
git worktree add .claude/worktrees/composer -b feature/composer-core main
cd .claude/worktrees/composer
ln -s ../../../node_modules node_modules 2>/dev/null || true
ln -s ../../../frontend/node_modules frontend/node_modules 2>/dev/null || true
```
Expected: a new worktree at `.claude/worktrees/composer` on branch `feature/composer-core`. (The vitest config already excludes `.claude/worktrees/**` from the canonical glob and falls back to the main repo's `frontend/node_modules`, so tests run correctly from inside the worktree.)

**Step 2: Verify the toolchain runs**

Run: `npx vitest run frontend/src/modules/MusicNotation/parseMusicXml.test.js`
Expected: `Test Files 1 passed`, `Tests 8 passed`. If this fails, stop and fix the environment before any task.

---

# PART A — P0: Kiosk reality spike (measurement, not TDD)

> **This is a spike, not a TDD task.** Its deliverable is *numbers and a recorded decision*, not code that ships. It gates the P2 render architecture (§2.1 of the spec), NOT P1 — so **P1 (Part B) can proceed in parallel and does not wait on this.** Do P0 on real hardware when the tablet is reachable; do not block P1 on it.

### Task A1: Measure aged-page OSMD engrave latency on the kiosk tablet

**Why:** The spec's §2.1 render design (wet-ink PendingLayer + engrave-on-idle) hinges on how slow a full OSMD re-engrave actually is on the aged, throttled SM-T590 WebView. `performance.md` warns that a *fresh* page reads fine while the *aged* page the kid lives on decays to ~10fps and the OS clamps to 4–8fps, and that **BLE-MIDI is not "user activity"** so playing the piano does not lift the throttle. A fresh-page benchmark is therefore not evidence.

**Deliverable (no production code):**
1. A throwaway harness page/route that calls the existing `osmdEngrave` (see `frontend/src/modules/MusicNotation/renderers/osmdRender.js`) on 4-, 8-, and 16-measure single-staff MusicXML strings, in a loop, logging `performance.now()` deltas per engrave via the logging framework (`getLogger().child({ component: 'composer-p0' })`).
2. Run it on the tablet **after the page has aged > 30 minutes** and while MIDI (not touch) is the only recent input, using the `pbctl kiosk` beat probe (see `CLAUDE.local.md` / `reference_piano_kiosk_watchdog`) to confirm the throttled state.
3. Record in `docs/reference/piano/composer.md` §2.1 (replace the "P0 gate" bullet's TBD) the measured p50/p95 engrave-ms for each size.

**Decision gate (write the outcome into the spec):**
- If a full engrave settles < ~1s at continuous-entry cadence on the aged page → confirm §2.1's default cadence (engrave on measure-exit / ~600ms idle).
- If engrave is catastrophic (> ~2s) → record the fallback: coarser cadence (engrave on line-exit or explicit pause), PendingLayer carries more of the session. Architecture is unchanged either way.

**No commit of harness code to the feature branch** — capture the numbers in the spec and delete the harness (or leave it under a `_deleteme/` folder per CLAUDE.md).

### Task A2: Verify numpad keycodes + soft keyboard in the FKB WebView

**Why:** §5 bets the entire keymap on `event.code` values arriving intact in the FKB WebView with NumLock ON, and §9.3 bets title/tag entry on the Android soft keyboard presenting inside that WebView. Both are integration unknowns and cheap to check.

**Deliverable:**
1. On the piano tablet, load a trivial page that logs `event.code` + `event.key` for every `keydown`. Press every numpad key (NumLock ON and OFF) and the three iconed keys. **Record the actual `code` for each of the three iconed keys** in §5.1 (they're an open item — stickers can't be printed until known).
2. Confirm NumLock-OFF flips `Numpad7`→`Home` etc. (validates the §5 NumLock-detection design).
3. Tap a text input on that page; confirm the Android soft keyboard presents and commits characters in the WebView (validates §9.3).

**Deliverable is facts recorded in the spec**, not shippable code.

---

# PART B — P1: The pure core (TDD)

> Everything below is pure JS: no React, no OSMD, no network. Fully unit-testable. This is the foundation and the adversarial review's #1 priority ("spec the read side before anything else"). The **canonical acceptance gate** for all of P1 is Task B18 (the data-loss round-trip test).

## Section B-i: Duration math

### Task B1: `decomposeDuration` — split an arbitrary duration into notatable, tied pieces

**Why:** Auto-barring (§3) splits a note across a barline; the leftover fractions must become valid note values joined by ties (the spec explicitly forbids the old "clamp to remainder" because it produced un-notatable durations like a double-dotted half). This is the pure helper both auto-bar and the record quantizer reuse.

**Scope:** Operates on the plain (non-triplet) palette only — triplet groups are entered as a unit within one bar and never auto-split in v1. Input is always a multiple of 6 (the 16th-note grid at DIVISIONS=24).

**Files:**
- Create: `frontend/src/modules/MusicNotation/duration.js`
- Test: `frontend/src/modules/MusicNotation/duration.test.js`

**Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { DIVISIONS, decomposeDuration } from './duration.js';

describe('DIVISIONS', () => {
  it('is 24 per quarter (divisible by 2/3/4/6/8)', () => {
    expect(DIVISIONS).toBe(24);
  });
});

describe('decomposeDuration', () => {
  it('returns a single palette value unchanged (quarter = 24)', () => {
    expect(decomposeDuration(24)).toEqual([{ type: 'quarter', divs: 24 }]);
  });
  it('decomposes a whole note (96)', () => {
    expect(decomposeDuration(96)).toEqual([{ type: 'whole', divs: 96 }]);
  });
  it('greedily ties 3.5 beats (84) into half+quarter+eighth', () => {
    expect(decomposeDuration(84)).toEqual([
      { type: 'half', divs: 48 },
      { type: 'quarter', divs: 24 },
      { type: 'eighth', divs: 12 },
    ]);
  });
  it('decomposes a dotted-quarter span (36) into quarter+eighth', () => {
    expect(decomposeDuration(36)).toEqual([
      { type: 'quarter', divs: 24 },
      { type: 'eighth', divs: 12 },
    ]);
  });
  it('decomposes one 16th (6)', () => {
    expect(decomposeDuration(6)).toEqual([{ type: '16th', divs: 6 }]);
  });
  it('throws on a non-grid (non-multiple-of-6) duration', () => {
    expect(() => decomposeDuration(5)).toThrow();
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/MusicNotation/duration.test.js`
Expected: FAIL — `decomposeDuration is not a function`.

**Step 3: Implement minimally**

```js
// duration.js — pure duration arithmetic for the composer core.
// Internal resolution: DIVISIONS per quarter. 24 makes 16ths/triplets/dots exact.
export const DIVISIONS = 24;

// Plain (non-triplet) note palette, largest first, in divisions.
const PALETTE = [
  { type: 'whole', divs: 96 },
  { type: 'half', divs: 48 },
  { type: 'quarter', divs: 24 },
  { type: 'eighth', divs: 12 },
  { type: '16th', divs: 6 },
];

/**
 * Split a duration (in divisions) into the fewest notatable palette pieces,
 * largest-first. Caller ties consecutive pieces. Non-triplet only; input must
 * be a multiple of the 16th grid (6).
 * @param {number} divs
 * @returns {Array<{type:string, divs:number}>}
 */
export function decomposeDuration(divs) {
  if (!Number.isInteger(divs) || divs <= 0 || divs % 6 !== 0) {
    throw new Error(`decomposeDuration: ${divs} is not on the 16th grid`);
  }
  const pieces = [];
  let rest = divs;
  for (const value of PALETTE) {
    while (rest >= value.divs) {
      pieces.push({ type: value.type, divs: value.divs });
      rest -= value.divs;
    }
  }
  return pieces;
}
```

**Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/MusicNotation/duration.test.js`
Expected: PASS (6 tests).

**Step 5: Commit**

```bash
git add frontend/src/modules/MusicNotation/duration.js frontend/src/modules/MusicNotation/duration.test.js
git commit -m "$(cat <<'EOF'
feat(composer): decomposeDuration + DIVISIONS grid

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

### Task B2: `durationToType` — map a palette duration to `{type, dots}`

**Why:** The serializer needs `<type>` + `<dot>` for a note whose duration IS a palette or dotted-palette value (the common case: a single entered note). Distinct from `decomposeDuration` (which handles arbitrary spans via ties).

**Files:**
- Modify: `frontend/src/modules/MusicNotation/duration.js`
- Test: `frontend/src/modules/MusicNotation/duration.test.js` (add a describe block)

**Step 1: Add the failing test**

```js
import { durationToType } from './duration.js';

describe('durationToType', () => {
  it('maps a plain quarter (24)', () => {
    expect(durationToType(24)).toEqual({ type: 'quarter', dots: 0 });
  });
  it('maps a dotted quarter (36)', () => {
    expect(durationToType(36)).toEqual({ type: 'quarter', dots: 1 });
  });
  it('maps a dotted half (72)', () => {
    expect(durationToType(72)).toEqual({ type: 'half', dots: 1 });
  });
  it('maps an 8th triplet (8)', () => {
    expect(durationToType(8)).toEqual({ type: 'eighth', dots: 0, triplet: true });
  });
  it('returns null for a non-expressible single value (84)', () => {
    expect(durationToType(84)).toBeNull();
  });
});
```

**Step 2: Run — expect FAIL** (`durationToType is not a function`).

**Step 3: Implement**

```js
// Base note values (no dots) largest→smallest, plus the two triplet values.
const BASE = [
  { type: 'whole', divs: 96 }, { type: 'half', divs: 48 },
  { type: 'quarter', divs: 24 }, { type: 'eighth', divs: 12 }, { type: '16th', divs: 6 },
];
const TRIPLET = [
  { type: 'quarter', divs: 16 }, { type: 'eighth', divs: 8 }, { type: '16th', divs: 4 },
];

/**
 * Express a single note's duration (divisions) as {type, dots, triplet?} if it
 * is exactly a palette value, a single-dotted palette value, or a triplet value.
 * Returns null when the duration needs a tie (use decomposeDuration instead).
 */
export function durationToType(divs) {
  for (const b of BASE) {
    if (divs === b.divs) return { type: b.type, dots: 0 };
    if (divs === b.divs * 1.5) return { type: b.type, dots: 1 };
  }
  for (const t of TRIPLET) {
    if (divs === t.divs) return { type: t.type, dots: 0, triplet: true };
  }
  return null;
}
```

**Step 4: Run — expect PASS.**

**Step 5: Commit** (`feat(composer): durationToType palette/dot/triplet mapping`).

## Section B-ii: The Note factory + model helpers

### Task B3: Note factory + `noteDivisions`

**Why:** One place that builds a well-formed `Note` (§3 shape) and computes its duration in divisions, so serializer/parser/commands never hand-roll note objects.

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/model/note.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/model/note.test.js`

**Step 1: Failing test**

```js
import { describe, it, expect } from 'vitest';
import { makeNote, makeRest, noteDivisions } from './note.js';

describe('makeNote', () => {
  it('builds a pitched note with cached midi (C4=60) and defaults', () => {
    const n = makeNote({ step: 'C', octave: 4 }, { type: 'quarter' });
    expect(n).toMatchObject({
      rest: false, pitch: { step: 'C', octave: 4, alter: 0 }, midi: 60,
      type: 'quarter', dots: 0, tie: null, triplet: false, chord: false, staff: 1, voice: 1,
    });
  });
  it('honors dots and alter (F#4 = 66, dotted)', () => {
    const n = makeNote({ step: 'F', octave: 4, alter: 1 }, { type: 'quarter', dots: 1 });
    expect(n.midi).toBe(66);
    expect(n.dots).toBe(1);
  });
});

describe('makeRest', () => {
  it('builds a rest (no pitch, no midi)', () => {
    const r = makeRest({ type: 'half' });
    expect(r.rest).toBe(true);
    expect(r.pitch).toBeUndefined();
    expect(r.type).toBe('half');
  });
});

describe('noteDivisions', () => {
  it('quarter = 24', () => { expect(noteDivisions(makeNote({ step: 'C', octave: 4 }, { type: 'quarter' }))).toBe(24); });
  it('dotted half = 72', () => { expect(noteDivisions(makeRest({ type: 'half', dots: 1 }))).toBe(72); });
  it('8th triplet = 8', () => { expect(noteDivisions(makeRest({ type: 'eighth', triplet: true }))).toBe(8); });
});
```

**Step 2: Run — expect FAIL.**

**Step 3: Implement**

```js
// note.js — the Composer Note factory. One well-formed shape (spec §3).
import { pitchToMidi } from '#frontend/modules/MusicNotation/parseMusicXml.js';

const BASE_DIVS = { whole: 96, half: 48, quarter: 24, eighth: 12, '16th': 6 };
const TRIPLET_FACTOR = 2 / 3;

/** Duration of a note/rest in divisions, honoring dots and triplet. */
export function noteDivisions(note) {
  let d = BASE_DIVS[note.type];
  if (note.dots) for (let i = 0; i < note.dots; i++) d *= 1.5;
  if (note.triplet) d *= TRIPLET_FACTOR;
  return Math.round(d);
}

export function makeNote(pitch, opts = {}) {
  const p = { step: pitch.step, octave: pitch.octave, alter: pitch.alter ?? 0 };
  return {
    rest: false, pitch: p, midi: pitchToMidi(p),
    type: opts.type ?? 'quarter', dots: opts.dots ?? 0, tie: opts.tie ?? null,
    triplet: opts.triplet ?? false, chord: opts.chord ?? false,
    staff: opts.staff ?? 1, voice: opts.voice ?? 1,
    lyric: opts.lyric, dynamics: opts.dynamics, articulations: opts.articulations,
  };
}

export function makeRest(opts = {}) {
  return {
    rest: true, type: opts.type ?? 'quarter', dots: opts.dots ?? 0,
    triplet: opts.triplet ?? false, staff: opts.staff ?? 1, voice: opts.voice ?? 1,
  };
}
```

> Note: the `#frontend` alias resolves to `frontend/src` (see `vitest.config.mjs`). Confirm the import path against `parseMusicXml.js`'s actual export of `pitchToMidi`.

**Step 4: Run — expect PASS.**

**Step 5: Commit** (`feat(composer): Note factory + noteDivisions`).

### Task B4: `makeEmptyScore` — the blank-song factory (§NewSongSetup defaults)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/model/score.js`
- Test: `.../model/score.test.js`

**Step 1: Failing test**

```js
import { describe, it, expect } from 'vitest';
import { makeEmptyScore } from './score.js';

describe('makeEmptyScore', () => {
  it('creates a 4/4 C-major treble score with one empty measure', () => {
    const s = makeEmptyScore();
    expect(s.timeSig).toEqual({ beats: 4, beatType: 4 });
    expect(s.key).toEqual({ fifths: 0, mode: 'major' });
    expect(s.clef).toEqual({ sign: 'G', line: 2 });
    expect(s.tempo).toBe(100);
    expect(s.divisions).toBe(24);
    expect(s.parts).toHaveLength(1);
    expect(s.parts[0].measures).toHaveLength(1);
    expect(s.parts[0].measures[0].notes).toEqual([]);
  });
  it('accepts setup overrides', () => {
    const s = makeEmptyScore({ time: { beats: 3, beatType: 4 }, key: { fifths: 1 }, tempo: 120 });
    expect(s.timeSig.beats).toBe(3);
    expect(s.key.fifths).toBe(1);
    expect(s.tempo).toBe(120);
  });
});
```

**Step 2: FAIL. Step 3: Implement**

```js
// score.js — Score document factory.
import { DIVISIONS } from '#frontend/modules/MusicNotation/duration.js';

export function makeEmptyScore(setup = {}) {
  return {
    title: setup.title ?? 'Untitled',
    composerName: setup.composerName ?? '',
    tempo: setup.tempo ?? 100,
    timeSig: setup.time ?? { beats: 4, beatType: 4 },
    key: { fifths: setup.key?.fifths ?? 0, mode: setup.key?.mode ?? 'major' },
    clef: setup.clef ?? { sign: 'G', line: 2 },
    divisions: DIVISIONS,
    parts: [{ id: 'P1', staves: 1, measures: [{ number: 1, notes: [] }] }],
  };
}
```

**Step 4: PASS. Step 5: Commit** (`feat(composer): makeEmptyScore factory`).

## Section B-iii: `serializeMusicXml` — built up element by element

> Each task adds one MusicXML feature with a failing test first. The serializer is pure string-building (it's on the engrave hot path). After each task, the growing test suite must stay green. Create the file in Task B5; extend it thereafter.

### Task B5: Serializer scaffold — empty score → valid `score-partwise`

**Files:**
- Create: `frontend/src/modules/MusicNotation/serializeMusicXml.js`
- Test: `frontend/src/modules/MusicNotation/serializeMusicXml.test.js`

**Step 1: Failing test**

```js
import { describe, it, expect } from 'vitest';
import { makeEmptyScore } from '#frontend/modules/Piano/PianoKiosk/modes/Composer/model/score.js';
import { serializeMusicXml } from './serializeMusicXml.js';
import { parseMusicXml } from './parseMusicXml.js';

describe('serializeMusicXml — scaffold', () => {
  const xml = serializeMusicXml(makeEmptyScore());
  it('emits a score-partwise document with a part and one measure', () => {
    expect(xml).toContain('<score-partwise');
    expect(xml).toContain('<part id="P1">');
    expect(xml).toContain('<measure number="1">');
  });
  it('is parseable by DOMParser (no parsererror)', () => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
  });
  it('round-trips the header through parseMusicXml (4/4, C, tempo 100)', () => {
    const back = parseMusicXml(xml);
    expect(back.timeSig).toEqual({ beats: 4, beatType: 4 });
    expect(back.key.fifths).toBe(0);
    expect(back.tempo).toBe(100);
  });
});
```

**Step 2: Run — expect FAIL** (`serializeMusicXml is not a function`).

**Step 3: Implement the scaffold**

```js
// serializeMusicXml.js — Score model → MusicXML string. Inverse of parseMusicXml.
// Pure string-building (on the engrave hot path). Emits <divisions>=score.divisions.

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

function attributesXml(score) {
  return `<attributes>`
    + `<divisions>${score.divisions}</divisions>`
    + `<key><fifths>${score.key.fifths}</fifths><mode>${score.key.mode ?? 'major'}</mode></key>`
    + `<time><beats>${score.timeSig.beats}</beats><beat-type>${score.timeSig.beatType}</beat-type></time>`
    + `<clef><sign>${score.clef.sign}</sign><line>${score.clef.line}</line></clef>`
    + `</attributes>`;
}

function measureXml(score, measure, isFirst) {
  const attrs = isFirst ? attributesXml(score) : '';
  const tempo = isFirst
    ? `<direction placement="above"><sound tempo="${score.tempo}"/></direction>` : '';
  const notes = ''; // filled in by later tasks
  return `<measure number="${measure.number}">${attrs}${tempo}${notes}</measure>`;
}

export function serializeMusicXml(score) {
  const part = score.parts[0];
  const measures = part.measures.map((m, i) => measureXml(score, m, i === 0)).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<score-partwise version="3.1">`
    + `<work><work-title>${esc(score.title)}</work-title></work>`
    + `<identification><creator type="composer">${esc(score.composerName)}</creator></identification>`
    + `<part-list><score-part id="${part.id}"><part-name>Music</part-name></score-part></part-list>`
    + `<part id="${part.id}">${measures}</part>`
    + `</score-partwise>`;
}
```

**Step 4: Run — expect PASS** (3 tests).

**Step 5: Commit** (`feat(composer): serializeMusicXml scaffold (header round-trips)`).

### Task B6: Serialize a pitched note

**Files:** Modify `serializeMusicXml.js`; add tests.

**Step 1: Failing test** (append)

```js
import { makeEmptyScore } from '#frontend/modules/Piano/PianoKiosk/modes/Composer/model/score.js';
import { makeNote, makeRest } from '#frontend/modules/Piano/PianoKiosk/modes/Composer/model/note.js';

function scoreWith(notes) {
  const s = makeEmptyScore();
  s.parts[0].measures[0].notes = notes;
  return s;
}

describe('serializeMusicXml — pitched note', () => {
  it('round-trips a single C4 quarter (midi 60, quarter, staff 1)', () => {
    const xml = serializeMusicXml(scoreWith([makeNote({ step: 'C', octave: 4 }, { type: 'quarter' })]));
    const n = parseMusicXml(xml).parts[0].measures[0].notes[0];
    expect(n.midi).toBe(60);
    expect(n.type).toBe('quarter');
    expect(n.rest).toBe(false);
  });
  it('emits alter for F#4', () => {
    const xml = serializeMusicXml(scoreWith([makeNote({ step: 'F', octave: 4, alter: 1 }, { type: 'eighth' })]));
    expect(xml).toContain('<alter>1</alter>');
    expect(parseMusicXml(xml).parts[0].measures[0].notes[0].midi).toBe(66);
  });
});
```

**Step 2: FAIL** (parser sees no notes → `notes[0]` undefined).

**Step 3: Implement** — add a `noteXml` and wire it into `measureXml`:

```js
import { noteDivisions } from '#frontend/modules/Piano/PianoKiosk/modes/Composer/model/note.js';

function pitchXml(p) {
  return `<pitch><step>${p.step}</step>`
    + (p.alter ? `<alter>${p.alter}</alter>` : '')
    + `<octave>${p.octave}</octave></pitch>`;
}

function noteXml(note) {
  const dur = noteDivisions(note);
  const body = note.rest ? `<rest/>` : pitchXml(note.pitch);
  const dots = '<dot/>'.repeat(note.dots || 0);
  return `<note>${note.chord ? '<chord/>' : ''}${body}`
    + `<duration>${dur}</duration>`
    + `<type>${note.type}</type>${dots}`
    + `</note>`;
}
```
Then in `measureXml` replace `const notes = '';` with:
```js
  const notes = measure.notes.map(noteXml).join('');
```

**Step 4: PASS. Step 5: Commit** (`feat(composer): serialize pitched notes + accidentals`).

### Task B7: Serialize rests

**Step 1: Failing test**
```js
describe('serializeMusicXml — rests', () => {
  it('round-trips a half rest', () => {
    const xml = serializeMusicXml(scoreWith([makeRest({ type: 'half' })]));
    const n = parseMusicXml(xml).parts[0].measures[0].notes[0];
    expect(n.rest).toBe(true);
    expect(n.type).toBe('half');
  });
});
```
**Step 2: FAIL** (already? `<rest/>` is emitted, but verify `type` survives). If it passes already, keep the test as a regression guard and note "already satisfied by B6" — still commit the test.
**Step 3:** No code needed if B6 handles it (the `body` already emits `<rest/>`). **Step 4: PASS. Step 5: Commit** (`test(composer): rest round-trip guard`).

### Task B8: Serialize ties

**Step 1: Failing test**
```js
describe('serializeMusicXml — ties', () => {
  it('emits tie start/stop + tied notations and round-trips', () => {
    const a = makeNote({ step: 'C', octave: 4 }, { type: 'quarter', tie: 'start' });
    const b = makeNote({ step: 'C', octave: 4 }, { type: 'quarter', tie: 'stop' });
    const xml = serializeMusicXml(scoreWith([a, b]));
    expect(xml).toContain('<tie type="start"/>');
    expect(xml).toContain('<tied type="start"/>');
    const notes = parseMusicXml(xml).parts[0].measures[0].notes;
    expect(notes[0].tie).toBe('start');
    expect(notes[1].tie).toBe('stop');
  });
});
```
> This test will also FAIL because `parseMusicXml` does not read ties yet — that's fixed in Task B14. For now, split the assertion: keep only the `xml.toContain(...)` assertions here (serializer side), and add the parse-side assertions in B14. **Adjust the test to serializer-only assertions now.**

**Step 3: Implement** — extend `noteXml`. MusicXML: `<tie>` under `<note>`, `<tied>` under `<notations>`:
```js
function tieXml(tie) {
  if (tie === 'start') return { tie: '<tie type="start"/>', tied: '<tied type="start"/>' };
  if (tie === 'stop') return { tie: '<tie type="stop"/>', tied: '<tied type="stop"/>' };
  if (tie === 'both') return { tie: '<tie type="stop"/><tie type="start"/>', tied: '<tied type="stop"/><tied type="start"/>' };
  return { tie: '', tied: '' };
}
```
Fold `tie` before `<duration>` and `tied` into a `<notations>` block after dots. (Notations will accumulate tuplet/articulations in later tasks — build a `notationsXml(note)` helper now that starts with `tied`.)

**Step 4/5:** PASS serializer assertions; commit (`feat(composer): serialize ties (tie + tied notations)`).

### Task B9: Serialize triplets (`time-modification` + tuplet notation)

**Step 1: Failing test** (serializer-side assertions only; parse side lands in B15)
```js
describe('serializeMusicXml — triplets', () => {
  it('emits time-modification 3-in-2 for an 8th triplet', () => {
    const xml = serializeMusicXml(scoreWith([makeNote({ step: 'C', octave: 4 }, { type: 'eighth', triplet: true })]));
    expect(xml).toContain('<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>');
  });
});
```
**Step 3: Implement** — when `note.triplet`, add `<time-modification>` after `<type>`/dots and a `<tuplet>` in notations on the group boundaries. For v1 emit `<time-modification>` on every triplet note (OSMD renders correctly; tuplet bracket refinement is post-v1). **Step 4/5:** PASS; commit.

### Task B10: Serialize dynamics + articulations

**Step 1: Failing test** (serializer-side)
```js
describe('serializeMusicXml — expressive marks', () => {
  it('emits a dynamics direction and an articulation notation', () => {
    const n = makeNote({ step: 'C', octave: 4 }, { type: 'quarter' });
    n.dynamics = 'f'; n.articulations = ['staccato'];
    const xml = serializeMusicXml(scoreWith([n]));
    expect(xml).toContain('<dynamics><f/></dynamics>');
    expect(xml).toContain('<articulations><staccato/></articulations>');
  });
});
```
**Step 3: Implement** — dynamics as a `<direction><direction-type><dynamics><f/>...` emitted before the note; articulations inside `<notations><articulations>`. **Commit.**

### Task B11: Serialize lyrics

**Step 1: Failing test** (serializer-side)
```js
it('emits a lyric syllable', () => {
  const n = makeNote({ step: 'C', octave: 4 }, { type: 'quarter' });
  n.lyric = 'la';
  expect(serializeMusicXml(scoreWith([n]))).toContain('<lyric><text>la</text></lyric>');
});
```
**Step 3:** add `<lyric>` (escaped) after notations. **Commit.**

### Task B12: Serialize chords + multi-staff (schema floor, not v1 UI)

**Why:** §4 requires the serializer to carry chords/multi-staff from day one so richer loaded files survive an edit. Not entered by v1 UI, but tested.

**Step 1: Failing test**
```js
describe('serializeMusicXml — chords + staves', () => {
  it('emits <chord/> on stacked notes and <staff> when >1 staff', () => {
    const s = makeEmptyScore(); s.parts[0].staves = 2;
    const root = makeNote({ step: 'C', octave: 4 }, { type: 'quarter', staff: 1 });
    const third = makeNote({ step: 'E', octave: 4 }, { type: 'quarter', staff: 1, chord: true });
    const bass = makeNote({ step: 'C', octave: 3 }, { type: 'quarter', staff: 2 });
    s.parts[0].measures[0].notes = [root, third, bass];
    const xml = serializeMusicXml(s);
    expect(xml).toContain('<chord/>');
    expect(xml).toContain('<staff>2</staff>');
    expect(xml).toContain('<backup>'); // staff switch needs a backup
  });
});
```
**Step 3: Implement** — emit `<staves>` in attributes when `part.staves>1`; emit `<staff>` per note; when a note's staff < the running staff (i.e., switching back to an earlier staff at the same onset region), emit a `<backup><duration>…</duration></backup>` before it summing the prior staff's measure content. Keep the backup logic minimal and covered by this test. **Commit.**

## Section B-iv: `parseMusicXml` full-fidelity extension (additive)

> **Guardrail:** after EVERY task in this section, run `npx vitest run frontend/src/modules/MusicNotation/parseMusicXml.test.js` and confirm the original 8 tests stay green. These changes are additive — new fields on the note object, nothing removed or renamed.

### Task B13: Per-measure attributes fidelity

**Why:** the current parser folds key/time into score-level last-wins fields (spec §4 flags this). Composer needs `measure.attributes` faithfully per measure. The parser already sets `measure.attributes` when an `<attributes>` element is present (see `parseMusicXml.js:109`) — add a test pinning it, and fix if the shape is lossy.

**Files:** Modify `frontend/src/modules/MusicNotation/parseMusicXml.js`; add to `parseMusicXml.test.js`.

**Step 1: Failing/guard test**
```js
describe('parseMusicXml — per-measure attributes', () => {
  it('captures a mid-piece time change on the measure where it occurs', () => {
    const xml = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">
      <measure number="1"><attributes><divisions>24</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>96</duration><type>whole</type></note></measure>
      <measure number="2"><attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>72</duration><type>half</type><dot/></note></measure>
    </part></score-partwise>`;
    const s = parseMusicXml(xml);
    expect(s.parts[0].measures[1].attributes.time).toEqual({ beats: 3, beatType: 4 });
  });
});
```
**Step 2:** Run — if it passes, great (guard added); if not, fix `measure.attributes` to snapshot the *current* time/key at that measure. **Step 3/4/5:** green + original 8 green; commit.

### Task B14: Parse ties

**Step 1: Failing test**
```js
describe('parseMusicXml — ties', () => {
  it('reads tie start/stop', () => {
    const xml = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">
      <measure number="1"><attributes><divisions>24</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>24</duration><type>quarter</type><tie type="start"/><notations><tied type="start"/></notations></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>24</duration><type>quarter</type><tie type="stop"/><notations><tied type="stop"/></notations></note>
    </measure></part></score-partwise>`;
    const notes = parseMusicXml(xml).parts[0].measures[0].notes;
    expect(notes[0].tie).toBe('start');
    expect(notes[1].tie).toBe('stop');
  });
});
```
**Step 3: Implement** — in the note-building block of `parseMusicXml.js` (around line 133–145), read `<tie>` elements: `both` if two present, else the single `type`. Add `note.tie`. **Step 4:** green + original 8 green. **Now un-skip the parse-side assertions deferred in Task B8** (add them back to `serializeMusicXml.test.js`). **Step 5: Commit** (`feat(composer): parse ties (round-trip complete)`).

### Task B15: Parse triplets (time-modification)

**Step 1: Failing test** — assert `note.triplet === true` (or `note.tuplet`) for a note carrying `<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>`. **Step 3:** read it, set `note.triplet = actual===3 && normal===2` (and `note.tuplet={actual,normal}` for generality). **Step 4:** green + originals green; re-enable B9's parse-side assertions. **Commit.**

### Task B16: Parse dynamics + articulations + lyrics

**Step 1: Failing test** — one test each: a note with a preceding `<direction>…<dynamics><f/>` gets `note.dynamics='f'`; `<articulations><staccato/></…>` gives `note.articulations=['staccato']`; `<lyric><text>la</text>` gives `note.lyric='la'`. **Step 3:** implement the three reads (dynamics attaches to the *next* note in document order — mirror how the serializer emits it). **Step 4:** green + originals green; re-enable B10/B11 parse-side assertions. **Step 5: Commit** (`feat(composer): parse dynamics/articulations/lyrics`).

## Section B-v: Round-trip property + the data-loss spine

### Task B17: Generated-model round-trip property test

**Why:** §4's inverse property for models the serializer produces.

**Files:** Create `frontend/src/modules/MusicNotation/roundtrip.test.js`

**Step 1: Failing test**
```js
import { describe, it, expect } from 'vitest';
import { serializeMusicXml } from './serializeMusicXml.js';
import { parseMusicXml } from './parseMusicXml.js';
import { makeEmptyScore } from '#frontend/modules/Piano/PianoKiosk/modes/Composer/model/score.js';
import { makeNote, makeRest } from '#frontend/modules/Piano/PianoKiosk/modes/Composer/model/note.js';

// A model exercising every v1 element.
function everythingScore() {
  const s = makeEmptyScore();
  const a = makeNote({ step: 'E', octave: 4 }, { type: 'quarter', tie: 'start' });
  const b = makeNote({ step: 'E', octave: 4 }, { type: 'quarter', tie: 'stop' });
  const c = makeNote({ step: 'F', octave: 4, alter: 1 }, { type: 'eighth', triplet: true });
  c.dynamics = 'f'; c.articulations = ['staccato']; c.lyric = 'la';
  const r = makeRest({ type: 'eighth' });
  s.parts[0].measures[0].notes = [a, b, c, r];
  return s;
}

describe('round-trip — model → xml → model preserves every element', () => {
  const s = everythingScore();
  const back = parseMusicXml(serializeMusicXml(s));
  const notes = back.parts[0].measures[0].notes;
  it('preserves pitch/midi', () => expect(notes.map(n => n.midi ?? 'rest')).toEqual([64, 64, 66, 'rest']));
  it('preserves ties', () => expect([notes[0].tie, notes[1].tie]).toEqual(['start', 'stop']));
  it('preserves the triplet', () => expect(notes[2].triplet).toBe(true));
  it('preserves dynamics/articulation/lyric', () => {
    expect(notes[2].dynamics).toBe('f');
    expect(notes[2].articulations).toEqual(['staccato']);
    expect(notes[2].lyric).toBe('la');
  });
});
```
**Step 2:** Run — any red assertion here is a real fidelity bug in B6–B16; fix the offending serializer/parser piece until all green. **Step 5: Commit** (`test(composer): full-element round-trip property`).

### Task B18: THE canonical data-loss test (P1 acceptance gate)

**Why:** the spec's spine (§4): *load a rich song → edit one note → save → reload → nothing else changed.* This is the test the whole design exists to pass.

**Files:** Create `frontend/src/modules/Piano/PianoKiosk/modes/Composer/model/dataLoss.test.js` (depends on Task B19's `replacePitch` — reorder if executing strictly: do B19 first, then B18. Listed here because it's the gate that motivates B19.)

**Step 1: Failing test**
```js
import { describe, it, expect } from 'vitest';
import { parseMusicXml } from '#frontend/modules/MusicNotation/parseMusicXml.js';
import { serializeMusicXml } from '#frontend/modules/MusicNotation/serializeMusicXml.js';
import { initEditor, replacePitch } from './editor.js';
import { serializeFromEditor } from './editor.js'; // helper: EditorState.score → xml
import maryXml from '#frontend/modules/MusicNotation/__fixtures__/maryHadALittleLamb.musicxml?raw';

describe('data-loss invariant', () => {
  it('editing one note preserves every other element across save+reload', () => {
    const loaded = parseMusicXml(maryXml);          // load
    let ed = initEditor(loaded);                     // into editor state
    ed = replacePitch(ed, { measureIdx: 0, noteIdx: 0 }, { step: 'G', octave: 4 }); // one edit
    const saved = serializeMusicXml(ed.score);       // save
    const reloaded = parseMusicXml(saved);           // reload

    // The edited note changed...
    const edited = reloaded.parts[0].measures[0].notes.find(n => !n.rest && !n.chord);
    expect(edited.midi).toBe(67); // G4
    // ...and everything else survived: same measure count, same total note count.
    expect(reloaded.parts[0].measures).toHaveLength(loaded.parts[0].measures.length);
    const count = (sc) => sc.parts[0].measures.reduce((a, m) => a + m.notes.length, 0);
    expect(count(reloaded)).toBe(count(loaded));
  });
});
```
**Step 2:** Run — expect FAIL until B13–B16 fidelity + B19 exist. Once green, **P1 is done.** **Step 5: Commit** (`test(composer): canonical data-loss invariant (P1 gate)`).

## Section B-vi: EditorState + commands + undo

> Execute B19–B24 **before** B18 in strict order (B18 imports `replacePitch`/`initEditor`). Listed after for narrative; the executor should do B19–B24, then B18.

### Task B19: `initEditor` + `replacePitch`

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/model/editor.js`
- Test: `.../model/editor.test.js`

**Step 1: Failing test**
```js
import { describe, it, expect } from 'vitest';
import { initEditor, replacePitch } from './editor.js';
import { makeEmptyScore } from './score.js';
import { makeNote } from './note.js';

function oneNoteEditor() {
  const s = makeEmptyScore();
  s.parts[0].measures[0].notes = [makeNote({ step: 'C', octave: 4 }, { type: 'quarter' })];
  return initEditor(s);
}
describe('initEditor', () => {
  it('starts disarmed, quarter sticky, caret at 0/0, no selection', () => {
    const ed = initEditor(makeEmptyScore());
    expect(ed.armed).toBe(false);
    expect(ed.stickyDuration).toEqual({ type: 'quarter', dots: 0, triplet: false });
    expect(ed.caret).toEqual({ measureIdx: 0, noteIdx: 0 });
    expect(ed.selection).toBeNull();
  });
});
describe('replacePitch', () => {
  it('replaces a note pitch immutably (C4 → G4), leaving duration', () => {
    const ed0 = oneNoteEditor();
    const ed1 = replacePitch(ed0, { measureIdx: 0, noteIdx: 0 }, { step: 'G', octave: 4 });
    expect(ed1.score.parts[0].measures[0].notes[0].midi).toBe(67);
    expect(ed1.score.parts[0].measures[0].notes[0].type).toBe('quarter');
    expect(ed0.score.parts[0].measures[0].notes[0].midi).toBe(60); // original untouched
  });
});
```
**Step 3: Implement** `initEditor` + `replacePitch` (immutable structural update + `makeNote` to recompute midi). Add a `serializeFromEditor(ed)` re-export of `serializeMusicXml(ed.score)` for B18. **Step 4:** PASS. **Step 5: Commit.**

### Task B20: `insertNote` with auto-bar split-tie

**Step 1: Failing test**
```js
import { insertNote } from './editor.js';
describe('insertNote — auto-bar split/tie', () => {
  it('appends within a bar and advances the caret', () => {
    let ed = initEditor(makeEmptyScore());
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'quarter' });
    expect(ed.score.parts[0].measures[0].notes).toHaveLength(1);
    expect(ed.caret.noteIdx).toBe(1);
  });
  it('splits an over-long note across the barline with a tie', () => {
    let ed = initEditor(makeEmptyScore());
    // Fill 3.5 beats of a 4/4 bar, then add a whole note (4 beats) → 0.5 fits, 3.5 spill.
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'half', dots: 1 });   // 3 beats
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'eighth' });          // 0.5 → 3.5 total
    ed = insertNote(ed, { step: 'D', octave: 4 }, { type: 'half' });            // 2 beats, 0.5 fits
    const m0 = ed.score.parts[0].measures[0].notes;
    expect(m0[m0.length - 1].tie).toBe('start');
    expect(ed.score.parts[0].measures[1].notes[0].tie).toBe('stop');
    expect(ed.score.parts[0].measures[1].notes[0].midi).toBe(62); // D4 continues
  });
});
```
**Step 3: Implement** using `noteDivisions`, bar capacity `= timeSig.beats * (DIVISIONS*4/beatType)`, `decomposeDuration` for the spill, creating a new measure when needed, marking `tie:'start'`/`'stop'`. **Step 4:** PASS. **Step 5: Commit** (`feat(composer): insertNote with auto-bar split-tie`).

### Task B21: `insertRest`, `deleteNote`, `setDuration`, `toggleDot`, `toggleTriplet`, `toggleTie`

One task per command is ideal, but these are small and symmetric — group into **one task with one test file section per command** (still: failing test → impl → green → commit per command if you prefer smaller commits). Each is an immutable structural edit. Key behaviors to pin:
- `deleteNote` removes at a position and re-flows the caret.
- `setDuration`/`toggleDot`/`toggleTriplet` change the selected note's `type/dots/triplet` and **re-run the bar's fill** (may re-split following notes) — reuse the B20 fill routine (DRY: extract `reflowMeasure`).
- `toggleTie` sets `tie` on the selected note.

**Commit** after each (`feat(composer): <command>`).

### Task B22: `nudgePitch` + caret/selection moves

**Step 1: Failing test** — `nudgePitch(ed, +1)` raises the selected note one chromatic step (C4→C#4 midi 61), `-12` drops an octave; `moveCaret`/`select` update `caret`/`selection` and clamp at bounds. **Step 3:** implement. **Step 5: Commit.**

### Task B23: `setAttribute` (key/time/clef/tempo)

**Step 1: Failing test** — `setAttribute(ed, 'tempo', 120)` sets `score.tempo`; `setAttribute(ed, 'time', {beats:3,beatType:4})` updates `timeSig` and **re-flows all measures** to the new capacity. **Step 3:** implement (time changes are the tricky one — re-flow via `reflowMeasure`). **Step 5: Commit.**

### Task B24: Undo/redo snapshot ring

**Files:** Create `.../model/history.js`; test `.../model/history.test.js`. Then wire every mutating command through it.

**Step 1: Failing test**
```js
import { withHistory, undo, redo } from './history.js';
describe('history ring', () => {
  it('undoes and redoes a mutation; caret moves do not push', () => {
    let ed = initEditor(makeEmptyScore());
    ed = insertNote(ed, { step: 'C', octave: 4 }, { type: 'quarter' }); // pushes
    const afterInsert = ed;
    ed = undo(ed);
    expect(ed.score.parts[0].measures[0].notes).toHaveLength(0);
    ed = redo(ed);
    expect(ed.score.parts[0].measures[0].notes).toHaveLength(1);
  });
  it('caps the ring at 200 snapshots', () => { /* push 250, assert history length ≤ 200 */ });
});
```
**Step 3: Implement** a `history` field (`{ past: [], future: [] }`) on EditorState; `withHistory(mutatingFn)` wraps a command to push the prior score snapshot and clear `future`; `undo`/`redo` swap snapshots. Wrap the mutating commands (B19–B23) via `withHistory`. **Caret/selection moves must NOT push.** **Step 4:** PASS. **Step 5: Commit** (`feat(composer): undo/redo snapshot ring`).

### Task B25: Wire it up + run the full P1 gate

**Step 1:** Now execute **Task B18** (the data-loss test) if not yet green. Then run the whole suite:

Run: `npx vitest run frontend/src/modules/MusicNotation/ frontend/src/modules/Piano/PianoKiosk/modes/Composer/`
Expected: ALL green, including the original `parseMusicXml.test.js` 8 tests (regression guard) and the data-loss invariant.

**Step 2:** Add an `index.js` barrel for `modes/Composer/model/` exporting the public surface (`makeEmptyScore`, `initEditor`, the commands, `undo/redo`, `serializeMusicXml` re-export). No new behavior — just the public API for P2.

**Step 3: Commit** (`feat(composer): P1 core complete — model, serializer, parser, commands, undo`).

**Step 4: Update the spec's build-order table** — mark P1 done, record the P0 numbers if Task A1/A2 ran. Commit the doc (`docs(composer): P1 complete; P0 measurements recorded`).

---

## P1 Definition of Done

- [x] `duration.js` (decompose + type mapping), `note.js`, `score.js` — green.
- [x] `serializeMusicXml.js` emits every v1 element (pitch, rest, dot, accidental, tie, triplet, dynamics, articulation, lyric, chord, multi-staff) — green.
- [x] `parseMusicXml.js` reads every v1 element **and the original 8 tests still pass** — green.
- [x] Full-element round-trip property (B17) — green.
- [x] **Canonical data-loss invariant (B18)** — green. *This is the gate.*
- [x] Editor commands + undo/redo — green.
- [x] Whole MusicNotation + Composer suite green in the worktree (only the 4 known `renderers/chordStaff.test.js` VexFlow/jsdom failures remain — `Renderer.Backends` undefined under jsdom, unrelated to the pure core).

**P1 COMPLETE (2026-07-17)** — pure core landed on `feature/composer-core`: model (`note.js`/`score.js`), `serializeMusicXml` + full-fidelity `parseMusicXml` extension, editor commands + undo/redo, the generated-model round-trip property, the canonical data-loss invariant (B18), and the public API barrel (`model/index.js`). P0 (kiosk-reality spike) remains pending on-hardware; P2–P6 earn their own plan.

---

## Roadmap — P2–P6 (NOT in this plan; earns its own plan after P0)

These depend on P0's render-cadence decision and on UI/hardware not exercisable in unit tests. Do **not** start them from this plan; write a follow-up plan once P0 numbers are recorded.

- **P2 — EditorSurface + persistence.** PendingLayer (wet-ink via `SvgStaffRenderer`), OSMD engrave-on-idle with model-anchored overlay re-binding (§2.1), caret + beat grid, sticky-duration step entry, armed/disarmed. Backend `ComposerSongStore` (meta-truth `.meta.yml`, versions ring, save-validation gate) + autosave API mirroring `piano.mjs` studio CRUD. **Gate:** enter + reload a melody end-to-end; the data-loss test passes against the *live* API, not just in-memory.
- **P3 — Tier-1 editing + model-driven playback.** Select/repitch/relength/delete on the score; `buildTimelineFromModel` adapter (do NOT reuse `buildPlayTimeline` directly — it consumes OSMD geometry, §10).
- **P4 — Focus editor.** Bar → NoteCard (dynamics/articulation tap-palettes), song settings, first-run coach overlay.
- **P5 — Record-a-take.** Capture + retain raw take, quantize view, raw-take compare strip, re-snap/revert.
- **P6 — Gallery polish.** Tags (soft-keyboard), shared view-only section, kid picker + switch-flush, restore UI, seeded demo song.
- **Later.** Lyrics entry (needs input design), lead sheet (reserved keys 6/8), grand staff (split-pitch), holdable artifacts (PDF via `backend/src/1_rendering/` svg-to-pdfkit — never rasterize; audio bounce), remix-duplicate, loop-selection.
