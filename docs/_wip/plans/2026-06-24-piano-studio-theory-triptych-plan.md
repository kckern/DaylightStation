# Piano Studio Theory Triptych Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional, per-user-configurable "triptych" to the Studio top pane — a Circle-of-Fifths panel (left) that lights up the active pitch classes, the existing current-chord grand staff (middle), and a live chord name (right, e.g. "D minor diminished") — while keeping the default a single centered staff.

**Architecture:** Two pure, framework-free modules do the music theory (chord identification → display name; circle-of-fifths geometry/highlighting), each unit-tested in isolation. A presentational `CircleOfFifths` SVG component and a `ChordNamePanel` consume them. The modular `StudioTopPane` (built in the sibling top-pane plan) gains a `layout="staff" | "triptych"` prop and arranges the three panels. A per-user preference (`topPaneLayout`) is read/written through the existing `/api/v1/piano/users/:userId/preferences` opaque blob via a small `usePianoPreferences` hook, falling back to a `piano.yml` default.

**Tech Stack:** React (`.jsx`), vitest (`import { describe, it, expect } from 'vitest'`), SCSS in `frontend/src/Apps/PianoApp.scss`, existing MusicNotation model (`frontend/src/modules/MusicNotation/model/keySignature.js`), existing per-user piano preferences API (Express, YAML blob).

---

## Dependency & Sequencing Notes

**Hard dependency — sequence AFTER the modular top pane.** This plan assumes a modular,
fixed-height top-pane component exists, extracted from `StudioPlay.jsx` per
`docs/_wip/audits/2026-06-24-piano-studio-top-pane-modular-fixed-height.md`. As of this
writing only the *audit* exists; the sibling *plan* has not been written yet, and there is
**no** `StudioTopPane` component on disk (`frontend/src/modules/Piano/PianoKiosk/modes/Studio/`
contains only `Studio.jsx`, `StudioPlay.jsx`, `StudioPlayback.jsx`, `StudioRecordings.jsx`,
plus hooks/tests). 

**Contract this plan expects from that prior work:** a component
`frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioTopPane.jsx` that:
- renders the current-chord staff as its default content,
- is fixed-height with generous top/bottom margins (so tall stems/ledger notes never clip),
- centers a single staff,
- accepts the staff content via props/children so alternate content can drop in.

If that component does not yet exist when this plan is executed, **Task 5 includes a fallback**
that introduces a minimal `StudioTopPane` so the triptych still has a host. Prefer integrating
with the real component if present.

**Verified facts grounding this plan (do not re-derive):**
- `activeNotes` is a `Map<midiNumber, noteData>`; only the keys (MIDI numbers) matter for theory. (`StudioPlay.jsx:26`, `CurrentChordStaff.jsx:21`, `AbcRenderer.jsx:46`.)
- Pitch class = `midi % 12`. (`CurrentChordStaff.jsx:48`.)
- Key detection already exists: `detectKey(pitchClasses, currentKey)` in `frontend/src/modules/MusicNotation/model/keySignature.js`, plus `KEY_SIGNATURES`, `NATURAL_NOTES`, `PITCH_TO_NATURAL`.
- Per-user prefs API is an **opaque merged blob**: `GET /api/v1/piano/users/:userId/preferences` returns `{}` if empty; `PUT` shallow-merges the body. (`backend/src/4_api/v1/routers/piano.mjs:150-168`.)
- Current player id comes from `usePianoUser().currentUser` (`PianoUserContext.jsx`).
- Frontend HTTP helper is `DaylightAPI` from `frontend/src/lib/api.mjs` (used in `PianoUserContext.jsx`).
- Tests run under **vitest** via `npm run test:isolated`; co-located `*.test.js` next to source is the established pattern (`spamDetection.test.js`).
- SCSS for the pane lives at `frontend/src/Apps/PianoApp.scss` under `.piano-studio-play` (block starts line 620; `&__staff` ~line 685).

---

## File Structure

**New files:**
- `frontend/src/modules/Piano/theory/chordNaming.js` — pure chord identification (root + quality + inversion → display name).
- `frontend/src/modules/Piano/theory/chordNaming.test.js` — unit tests for chord naming.
- `frontend/src/modules/Piano/theory/circleOfFifths.js` — pure circle-of-fifths geometry + active-pitch-class highlighting model.
- `frontend/src/modules/Piano/theory/circleOfFifths.test.js` — unit tests for the circle model.
- `frontend/src/modules/Piano/components/CircleOfFifths.jsx` — presentational SVG wheel.
- `frontend/src/modules/Piano/components/CircleOfFifths.scss` — styles for the wheel.
- `frontend/src/modules/Piano/components/ChordNamePanel.jsx` — presentational chord-name read-out.
- `frontend/src/modules/Piano/components/ChordNamePanel.scss` — styles for the name panel.
- `frontend/src/modules/Piano/PianoKiosk/usePianoPreferences.js` — hook: load/save per-user prefs blob with a config default.

**Modified files:**
- `frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioTopPane.jsx` — accept `layout` + render triptych (or create minimal host per Task 5 fallback).
- `frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioPlay.jsx` — pass `layout` from preference into `StudioTopPane`; add a layout toggle control.
- `frontend/src/Apps/PianoApp.scss` — triptych layout rules under `.piano-studio-play`.

**Possibly modified (config default only):**
- `data/household/config/piano.yml` — optional `studio.topPaneLayout` default (read in the container; written via `sudo docker exec`, not in this repo).

---

## Task 1: Pure chord-identification module (no tests yet to wire — TDD inside this task)

Identify a chord from a set of active MIDI notes. Produces `{ root, quality, inversion, displayName, bassPitchClass, notePitchClasses }`. Pure function, deterministic, no React, no DOM.

**Design decisions (locked):**
- Input: an array of MIDI note numbers (caller passes `[...activeNotes.keys()]`). Empty / single / two notes return a partial result with `quality: null` and a sensible `displayName` (empty string for 0 notes, the note name for 1).
- Pitch classes are de-duplicated for *quality* detection, but the **lowest sounding MIDI note** determines the bass (for inversion). Octave-collapsed.
- Quality detection works on the set of pitch-class intervals above the root. We try each present pitch class as a candidate root and pick the match whose interval set is a known chord template and whose root yields the simplest inversion (prefer root position, then lowest inversion number).
- Spelling (sharp vs flat) of the root name uses the same flat-vs-sharp table as `noteUtils.getNoteName`; default to sharp spelling. (Key-aware spelling is an open question — see Open Design Questions. For v1 use sharp spelling.)
- Supported qualities (v1 templates), by semitone intervals from root:
  - `major`: [0,4,7] → "C major"
  - `minor`: [0,3,7] → "C minor"
  - `diminished`: [0,3,6] → "C diminished"
  - `augmented`: [0,4,8] → "C augmented"
  - `sus2`: [0,2,7] → "C sus2"
  - `sus4`: [0,5,7] → "C sus4"
  - `major7`: [0,4,7,11] → "C major 7"
  - `dominant7`: [0,4,7,10] → "C 7"
  - `minor7`: [0,3,7,10] → "C minor 7"
  - `minor7b5` (half-diminished): [0,3,6,10] → "C minor 7 ♭5"
  - `diminished7`: [0,3,6,9] → "C diminished 7"
  - `power` (no third): [0,7] → "C5"
- Inversion: `0` root position; `1` first inversion (third in bass); `2` second; `3` third (for 7ths). Display name appends `/<bassNoteName>` when `inversion > 0` (slash chord), e.g. "C major / E".
- If no template matches, `quality: null`, `displayName: ''` for ≥3 notes too (caller shows "—").

**Files:**
- Create: `frontend/src/modules/Piano/theory/chordNaming.js`
- Test: `frontend/src/modules/Piano/theory/chordNaming.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// frontend/src/modules/Piano/theory/chordNaming.test.js
import { describe, it, expect } from 'vitest';
import { identifyChord, PITCH_CLASS_NAMES } from './chordNaming.js';

// MIDI helpers: C4 = 60. pitch class = midi % 12.
const C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69, B4 = 71;
const Eb4 = 63, Gb4 = 66, Bb4 = 70, Ab4 = 68;

describe('identifyChord — empty / sparse', () => {
  it('returns empty name for no notes', () => {
    const r = identifyChord([]);
    expect(r.quality).toBe(null);
    expect(r.displayName).toBe('');
  });

  it('names a single note', () => {
    const r = identifyChord([C4]);
    expect(r.root).toBe(0);
    expect(r.quality).toBe(null);
    expect(r.displayName).toBe('C');
  });

  it('names a bare fifth as a power chord', () => {
    const r = identifyChord([C4, G4]);
    expect(r.quality).toBe('power');
    expect(r.displayName).toBe('C5');
  });
});

describe('identifyChord — triads (root position)', () => {
  it('C major', () => {
    const r = identifyChord([C4, E4, G4]);
    expect(r.root).toBe(0);
    expect(r.quality).toBe('major');
    expect(r.inversion).toBe(0);
    expect(r.displayName).toBe('C major');
  });

  it('D minor', () => {
    const r = identifyChord([D4, F4, A4]);
    expect(r.quality).toBe('minor');
    expect(r.displayName).toBe('D minor');
  });

  it('B diminished', () => {
    const r = identifyChord([B4, D4 + 12, F4 + 12]);
    expect(r.quality).toBe('diminished');
    expect(r.displayName).toBe('B diminished');
  });

  it('C augmented', () => {
    const r = identifyChord([C4, E4, Ab4]);
    expect(r.quality).toBe('augmented');
    expect(r.displayName).toBe('C augmented');
  });
});

describe('identifyChord — inversions / slash chords', () => {
  it('C major first inversion (E in bass) → C major / E', () => {
    const r = identifyChord([E4, G4, C4 + 12]);
    expect(r.root).toBe(0);
    expect(r.quality).toBe('major');
    expect(r.inversion).toBe(1);
    expect(r.displayName).toBe('C major / E');
  });

  it('C major second inversion (G in bass) → C major / G', () => {
    const r = identifyChord([G4, C4 + 12, E4 + 12]);
    expect(r.inversion).toBe(2);
    expect(r.displayName).toBe('C major / G');
  });
});

describe('identifyChord — sevenths & sus', () => {
  it('G dominant 7', () => {
    const r = identifyChord([G4, B4, D4 + 12, F4 + 12]);
    expect(r.quality).toBe('dominant7');
    expect(r.displayName).toBe('G 7');
  });

  it('C major 7', () => {
    const r = identifyChord([C4, E4, G4, B4]);
    expect(r.quality).toBe('major7');
    expect(r.displayName).toBe('C major 7');
  });

  it('D minor 7', () => {
    const r = identifyChord([D4, F4, A4, C4 + 12]);
    expect(r.quality).toBe('minor7');
    expect(r.displayName).toBe('D minor 7');
  });

  it('B half-diminished (minor 7 ♭5)', () => {
    const r = identifyChord([B4, D4 + 12, F4 + 12, A4 + 12]);
    expect(r.quality).toBe('minor7b5');
    expect(r.displayName).toBe('B minor 7 ♭5');
  });

  it('C sus4', () => {
    const r = identifyChord([C4, F4, G4]);
    expect(r.quality).toBe('sus4');
    expect(r.displayName).toBe('C sus4');
  });
});

describe('identifyChord — duplicate octaves collapse', () => {
  it('C major across two octaves is still C major', () => {
    const r = identifyChord([C4, E4, G4, C4 + 12, E4 + 12]);
    expect(r.quality).toBe('major');
    expect(r.displayName).toBe('C major');
  });
});

describe('identifyChord — unknown set', () => {
  it('returns null quality / empty name for a non-chord cluster', () => {
    const r = identifyChord([C4, C4 + 1, C4 + 2]); // chromatic cluster
    expect(r.quality).toBe(null);
    expect(r.displayName).toBe('');
  });
});

describe('PITCH_CLASS_NAMES', () => {
  it('maps 0 → C and 6 → F# (sharp default)', () => {
    expect(PITCH_CLASS_NAMES[0]).toBe('C');
    expect(PITCH_CLASS_NAMES[6]).toBe('F#');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/theory/chordNaming.test.js`
Expected: FAIL — "Cannot find module './chordNaming.js'" / `identifyChord is not a function`.

- [ ] **Step 3: Write the implementation**

```javascript
// frontend/src/modules/Piano/theory/chordNaming.js
//
// Pure chord identification: a set of MIDI notes → root, quality, inversion, and a
// human display name (e.g. "D minor", "C major / E", "G 7"). No React, no DOM.
//
// Pitch class = midi % 12. Quality detection collapses to pitch classes; the lowest
// sounding MIDI note sets the bass for inversion. v1 uses sharp spelling for roots.

/** Sharp-spelled pitch-class names (index 0..11 = C..B). */
export const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Chord templates: intervals (semitones above root) → quality + label suffix.
// Order matters only for display; matching is by exact interval-set equality.
const TEMPLATES = [
  { quality: 'major',        intervals: [0, 4, 7],        label: 'major' },
  { quality: 'minor',        intervals: [0, 3, 7],        label: 'minor' },
  { quality: 'diminished',   intervals: [0, 3, 6],        label: 'diminished' },
  { quality: 'augmented',    intervals: [0, 4, 8],        label: 'augmented' },
  { quality: 'sus2',         intervals: [0, 2, 7],        label: 'sus2' },
  { quality: 'sus4',         intervals: [0, 5, 7],        label: 'sus4' },
  { quality: 'major7',       intervals: [0, 4, 7, 11],    label: 'major 7' },
  { quality: 'dominant7',    intervals: [0, 4, 7, 10],    label: '7' },
  { quality: 'minor7',       intervals: [0, 3, 7, 10],    label: 'minor 7' },
  { quality: 'minor7b5',     intervals: [0, 3, 6, 10],    label: 'minor 7 ♭5' },
  { quality: 'diminished7',  intervals: [0, 3, 6, 9],     label: 'diminished 7' },
  { quality: 'power',        intervals: [0, 7],           label: '5' },
];

const key = (arr) => arr.slice().sort((a, b) => a - b).join(',');

// Map each template's sorted-interval signature → template, for O(1) lookup.
const TEMPLATE_BY_SIGNATURE = new Map(TEMPLATES.map((t) => [key(t.intervals), t]));

/** Intervals of `pitchClasses` measured above `root`, de-duped + sorted. */
function intervalsAbove(root, pitchClasses) {
  const set = new Set(pitchClasses.map((pc) => ((pc - root) % 12 + 12) % 12));
  return [...set].sort((a, b) => a - b);
}

/**
 * Position of `bassPc` within the chord's stacked tones, used as the inversion index.
 * Root position = 0; the next chord tone up = 1; etc.
 */
function inversionOf(root, template, bassPc) {
  const tones = template.intervals.map((iv) => (root + iv) % 12);
  const idx = tones.indexOf(((bassPc % 12) + 12) % 12);
  return idx < 0 ? 0 : idx;
}

/**
 * Identify a chord from a list of MIDI note numbers.
 * @param {number[]} midiNotes
 * @returns {{
 *   root: number|null, quality: string|null, inversion: number,
 *   displayName: string, bassPitchClass: number|null, notePitchClasses: number[]
 * }}
 */
export function identifyChord(midiNotes) {
  const notes = Array.isArray(midiNotes) ? midiNotes.filter((n) => Number.isFinite(n)) : [];
  const empty = {
    root: null, quality: null, inversion: 0,
    displayName: '', bassPitchClass: null, notePitchClasses: [],
  };
  if (notes.length === 0) return empty;

  const bassMidi = Math.min(...notes);
  const bassPc = ((bassMidi % 12) + 12) % 12;
  const pitchClasses = [...new Set(notes.map((n) => ((n % 12) + 12) % 12))].sort((a, b) => a - b);

  // Single note → just the note name.
  if (pitchClasses.length === 1) {
    return { ...empty, root: pitchClasses[0], displayName: PITCH_CLASS_NAMES[pitchClasses[0]],
             bassPitchClass: bassPc, notePitchClasses: pitchClasses };
  }

  // Try each present pitch class as the candidate root; collect template matches.
  const matches = [];
  for (const root of pitchClasses) {
    const sig = key(intervalsAbove(root, pitchClasses));
    const template = TEMPLATE_BY_SIGNATURE.get(sig);
    if (template) {
      matches.push({ root, template, inversion: inversionOf(root, template, bassPc) });
    }
  }

  if (matches.length === 0) {
    return { ...empty, bassPitchClass: bassPc, notePitchClasses: pitchClasses };
  }

  // Prefer the lowest inversion (root position first); tie-break on more chord tones.
  matches.sort((a, b) =>
    a.inversion - b.inversion ||
    b.template.intervals.length - a.template.intervals.length);
  const best = matches[0];

  const rootName = PITCH_CLASS_NAMES[best.root];
  let displayName = best.template.quality === 'power'
    ? `${rootName}5`
    : `${rootName} ${best.template.label}`;
  if (best.inversion > 0) {
    displayName += ` / ${PITCH_CLASS_NAMES[bassPc]}`;
  }

  return {
    root: best.root,
    quality: best.template.quality,
    inversion: best.inversion,
    displayName,
    bassPitchClass: bassPc,
    notePitchClasses: pitchClasses,
  };
}

export default identifyChord;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/theory/chordNaming.test.js`
Expected: PASS (all cases). If "C major / E" or inversion cases fail, check `inversionOf` against the `power` label special-case in `displayName`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/theory/chordNaming.js frontend/src/modules/Piano/theory/chordNaming.test.js
git commit -m "feat(piano): pure chord-identification module (root/quality/inversion → name)"
```

---

## Task 2: Pure circle-of-fifths model

A pure module describing the 12 circle-of-fifths positions and, given active pitch classes, which positions to highlight (and optionally the detected key region). No SVG here — just data + geometry so it's unit-testable.

**Design decisions (locked):**
- The major-key circle order (clockwise from top) is: C, G, D, A, E, B, F# / Gb, Db, Ab, Eb, Bb, F. Each entry has a `pitchClass` (the root pitch class of that key) and an `angle` (degrees, 0 at top, clockwise).
- `circlePositions()` returns the 12 entries with `{ label, pitchClass, angle, x, y }` where `x,y` are unit-circle coordinates (radius 1, center 0,0, top = angle 0) — the component scales them.
- `activeSlots(pitchClasses)` returns the set of slot indices whose `pitchClass` is currently sounding. (A sounding pitch class lights its own slot — e.g. playing a D lights the D slot.)
- `keyArc(keyName)` returns the slot indices of the I, IV, V neighbours of a detected major key (the key's "home" three adjacent fifths), for an optional soft highlight ring. Returns `[]` for an unknown key.

**Files:**
- Create: `frontend/src/modules/Piano/theory/circleOfFifths.js`
- Test: `frontend/src/modules/Piano/theory/circleOfFifths.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// frontend/src/modules/Piano/theory/circleOfFifths.test.js
import { describe, it, expect } from 'vitest';
import { CIRCLE_ORDER, circlePositions, activeSlots, keyArc } from './circleOfFifths.js';

describe('CIRCLE_ORDER', () => {
  it('has 12 entries in fifths order starting at C', () => {
    expect(CIRCLE_ORDER).toHaveLength(12);
    expect(CIRCLE_ORDER[0].label).toBe('C');
    expect(CIRCLE_ORDER[1].label).toBe('G');
    expect(CIRCLE_ORDER[11].label).toBe('F');
  });

  it('each next entry is a perfect fifth (7 semitones) up', () => {
    for (let i = 1; i < CIRCLE_ORDER.length; i++) {
      const prev = CIRCLE_ORDER[i - 1].pitchClass;
      const cur = CIRCLE_ORDER[i].pitchClass;
      expect((cur - prev + 12) % 12).toBe(7);
    }
  });
});

describe('circlePositions', () => {
  it('returns 12 positions with C at the top (angle 0, y ≈ -1)', () => {
    const p = circlePositions();
    expect(p).toHaveLength(12);
    expect(p[0].label).toBe('C');
    expect(p[0].angle).toBe(0);
    expect(p[0].y).toBeCloseTo(-1, 5);
    expect(p[0].x).toBeCloseTo(0, 5);
  });

  it('spaces slots 30° apart', () => {
    const p = circlePositions();
    expect(p[1].angle).toBe(30);
    expect(p[3].angle).toBe(90);
  });
});

describe('activeSlots', () => {
  it('lights the slots for the sounding pitch classes', () => {
    // C major triad = pitch classes 0 (C), 4 (E), 7 (G) → slots C, E, G.
    const slots = activeSlots([0, 4, 7]);
    const labels = [...slots].map((i) => CIRCLE_ORDER[i].label).sort();
    expect(labels).toEqual(['C', 'E', 'G']);
  });

  it('returns an empty set for no notes', () => {
    expect(activeSlots([]).size).toBe(0);
  });
});

describe('keyArc', () => {
  it('returns I/IV/V neighbours for C major (F, C, G)', () => {
    const slots = keyArc('C');
    const labels = [...slots].map((i) => CIRCLE_ORDER[i].label).sort();
    expect(labels).toEqual(['C', 'F', 'G']);
  });

  it('returns empty for an unknown key', () => {
    expect(keyArc('H').size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/theory/circleOfFifths.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```javascript
// frontend/src/modules/Piano/theory/circleOfFifths.js
//
// Pure circle-of-fifths model: 12 major-key slots in fifths order, their geometry
// (unit-circle x/y, top = 12 o'clock), and which slots to highlight given the
// active pitch classes (and optionally a detected key region). No SVG / React.

// Fifths order clockwise from the top. Each label's pitchClass is its key root.
// C(0) G(7) D(2) A(9) E(4) B(11) F#(6) Db(1) Ab(8) Eb(3) Bb(10) F(5).
const ORDER_LABELS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const LABEL_TO_PC = { C: 0, G: 7, D: 2, A: 9, E: 4, B: 11, 'F#': 6, Db: 1, Ab: 8, Eb: 3, Bb: 10, F: 5 };

/** The 12 slots in fifths order: { label, pitchClass }. */
export const CIRCLE_ORDER = ORDER_LABELS.map((label) => ({ label, pitchClass: LABEL_TO_PC[label] }));

/**
 * Geometry for each slot: angle (deg, 0 at top, clockwise) + unit x/y
 * (center 0,0, radius 1, top y = -1).
 * @returns {{ label:string, pitchClass:number, angle:number, x:number, y:number }[]}
 */
export function circlePositions() {
  return CIRCLE_ORDER.map((slot, i) => {
    const angle = i * 30; // 360 / 12
    const rad = (angle - 90) * (Math.PI / 180); // -90 so angle 0 sits at the top
    return { ...slot, angle, x: Math.cos(rad), y: Math.sin(rad) };
  });
}

/**
 * Slot indices whose pitch class is currently sounding.
 * @param {number[]} pitchClasses
 * @returns {Set<number>}
 */
export function activeSlots(pitchClasses) {
  const active = new Set((pitchClasses || []).map((pc) => ((pc % 12) + 12) % 12));
  const out = new Set();
  CIRCLE_ORDER.forEach((slot, i) => { if (active.has(slot.pitchClass)) out.add(i); });
  return out;
}

/**
 * The I / IV / V neighbourhood (three adjacent fifths) of a major key, as slot indices.
 * @param {string} keyName e.g. 'C', 'G', 'Bb'
 * @returns {Set<number>}
 */
export function keyArc(keyName) {
  const idx = ORDER_LABELS.indexOf(keyName);
  if (idx < 0) return new Set();
  const left = (idx + ORDER_LABELS.length - 1) % ORDER_LABELS.length; // IV (down a fifth)
  const right = (idx + 1) % ORDER_LABELS.length;                       // V (up a fifth)
  return new Set([left, idx, right]);
}

export default { CIRCLE_ORDER, circlePositions, activeSlots, keyArc };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/theory/circleOfFifths.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/theory/circleOfFifths.js frontend/src/modules/Piano/theory/circleOfFifths.test.js
git commit -m "feat(piano): pure circle-of-fifths model (geometry + active-slot highlighting)"
```

---

## Task 3: `CircleOfFifths` presentational SVG component

Renders the wheel from the pure model, lighting active slots. Presentational — given pitch classes (+ optional detected key), draws an SVG. Logs mount via the framework.

**Files:**
- Create: `frontend/src/modules/Piano/components/CircleOfFifths.jsx`
- Create: `frontend/src/modules/Piano/components/CircleOfFifths.scss`

- [ ] **Step 1: Write the component**

```jsx
// frontend/src/modules/Piano/components/CircleOfFifths.jsx
import { useMemo } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { circlePositions, activeSlots, keyArc } from '../theory/circleOfFifths.js';
import './CircleOfFifths.scss';

/**
 * Circle-of-fifths wheel. Highlights the slots for the pitch classes currently
 * sounding; softly rings the detected key's I/IV/V neighbourhood.
 *
 * @param {number[]} pitchClasses - active pitch classes (0-11)
 * @param {string} [detectedKey] - major key name for the soft key-region ring
 * @param {number} [size] - px square viewport (default 220)
 */
export function CircleOfFifths({ pitchClasses = [], detectedKey, size = 220 }) {
  const logger = useMemo(() => getLogger().child({ component: 'circle-of-fifths' }), []);
  const positions = useMemo(() => circlePositions(), []);
  const active = useMemo(() => activeSlots(pitchClasses), [pitchClasses]);
  const region = useMemo(() => keyArc(detectedKey), [detectedKey]);

  // Debug-level: high frequency (every chord change). Use sampled to bound volume.
  logger.sampled('circle.render', { active: active.size, key: detectedKey },
    { maxPerMinute: 30, aggregate: true });

  const cx = size / 2;
  const cy = size / 2;
  const ringR = size * 0.42;   // where slot bubbles sit
  const bubbleR = size * 0.07; // slot bubble radius

  return (
    <svg
      className="piano-circle-of-fifths"
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label="Circle of fifths"
    >
      <circle className="cof-ring" cx={cx} cy={cy} r={ringR} />
      {positions.map((p, i) => {
        const x = cx + p.x * ringR;
        const y = cy + p.y * ringR;
        const isActive = active.has(i);
        const inKey = region.has(i);
        const cls = `cof-slot${isActive ? ' is-active' : ''}${inKey ? ' in-key' : ''}`;
        return (
          <g key={p.label} className={cls}>
            <circle className="cof-bubble" cx={x} cy={y} r={bubbleR} />
            <text className="cof-label" x={x} y={y} dominantBaseline="central" textAnchor="middle">
              {p.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default CircleOfFifths;
```

- [ ] **Step 2: Write the styles**

```scss
// frontend/src/modules/Piano/components/CircleOfFifths.scss
.piano-circle-of-fifths {
  display: block;
  max-width: 100%;
  max-height: 100%;

  .cof-ring {
    fill: none;
    stroke: var(--piano-border, #d9d4c8);
    stroke-width: 2;
  }

  .cof-slot {
    .cof-bubble {
      fill: #fff;
      stroke: var(--piano-border, #d9d4c8);
      stroke-width: 1.5;
      transition: fill 120ms ease, stroke 120ms ease;
    }
    .cof-label {
      fill: var(--piano-fg, #2b2b2b);
      font-size: 0.85rem;
      font-weight: 700;
      pointer-events: none;
    }

    &.in-key .cof-bubble { stroke: var(--piano-accent, #c08a3e); }

    &.is-active .cof-bubble {
      fill: var(--piano-accent, #c08a3e);
      stroke: var(--piano-accent, #c08a3e);
    }
    &.is-active .cof-label { fill: #fff; }
  }
}
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `npx eslint frontend/src/modules/Piano/components/CircleOfFifths.jsx`
Expected: no errors. (No unit test — purely presentational; logic is covered by Task 2.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Piano/components/CircleOfFifths.jsx frontend/src/modules/Piano/components/CircleOfFifths.scss
git commit -m "feat(piano): CircleOfFifths SVG component (lights active pitch classes)"
```

---

## Task 4: `ChordNamePanel` presentational component

Renders the live chord name from the active notes using `identifyChord`. Shows a placeholder ("—") when nothing identifiable is sounding.

**Files:**
- Create: `frontend/src/modules/Piano/components/ChordNamePanel.jsx`
- Create: `frontend/src/modules/Piano/components/ChordNamePanel.scss`

- [ ] **Step 1: Write the component**

```jsx
// frontend/src/modules/Piano/components/ChordNamePanel.jsx
import { useMemo } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { identifyChord } from '../theory/chordNaming.js';
import './ChordNamePanel.scss';

/**
 * Live chord-name read-out. Identifies the chord from the currently sounding MIDI
 * notes and shows its display name (e.g. "D minor", "C major / E", "G 7").
 *
 * @param {number[]} midiNotes - active MIDI note numbers
 */
export function ChordNamePanel({ midiNotes = [] }) {
  const logger = useMemo(() => getLogger().child({ component: 'chord-name-panel' }), []);
  const chord = useMemo(() => identifyChord(midiNotes), [midiNotes]);

  logger.sampled('chord.identify', { quality: chord.quality, name: chord.displayName },
    { maxPerMinute: 30, aggregate: true });

  const hasName = !!chord.displayName;
  return (
    <div className="piano-chord-name" aria-live="polite">
      <div className={`piano-chord-name__value${hasName ? '' : ' is-empty'}`}>
        {hasName ? chord.displayName : '—'}
      </div>
    </div>
  );
}

export default ChordNamePanel;
```

- [ ] **Step 2: Write the styles**

```scss
// frontend/src/modules/Piano/components/ChordNamePanel.scss
.piano-chord-name {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;
  text-align: center;

  &__value {
    font-size: clamp(1.1rem, 2.4vw, 1.9rem);
    font-weight: 800;
    line-height: 1.15;
    color: var(--piano-fg, #2b2b2b);

    &.is-empty {
      color: var(--piano-fg-muted, #9b958a);
      font-weight: 600;
    }
  }
}
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `npx eslint frontend/src/modules/Piano/components/ChordNamePanel.jsx`
Expected: no errors. (Naming logic is covered by Task 1's tests.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Piano/components/ChordNamePanel.jsx frontend/src/modules/Piano/components/ChordNamePanel.scss
git commit -m "feat(piano): ChordNamePanel — live chord-name read-out"
```

---

## Task 5: Triptych layout in the modular top pane

Add a `layout` prop to `StudioTopPane` so it renders either the centered staff (default) or the three-panel triptych. The staff content stays the **same** (`CurrentChordStaff`); the triptych wraps it with the two new panels on either side.

**Files:**
- Modify (preferred): `frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioTopPane.jsx`
- Create (fallback only — if the modular component does not exist yet): same path.
- Modify: `frontend/src/Apps/PianoApp.scss` (triptych rules).

> **Before editing:** check whether `StudioTopPane.jsx` exists.
> `ls frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioTopPane.jsx`.
> If it exists, integrate the `layout`/triptych code into it, preserving its existing
> staff-rendering + fixed-height behavior. If it does NOT exist, create the minimal
> host below (which also satisfies the modular-pane contract until the sibling plan lands).

- [ ] **Step 1: Add the triptych to `StudioTopPane`**

Integration target (or fallback minimal component) — the key parts are the `layout` branch and the triptych markup:

```jsx
// frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioTopPane.jsx
import { useMemo } from 'react';
import { CurrentChordStaff } from '../../../components/CurrentChordStaff.jsx';
import { CircleOfFifths } from '../../../components/CircleOfFifths.jsx';
import { ChordNamePanel } from '../../../components/ChordNamePanel.jsx';
import { detectKey } from '../../../../MusicNotation/model/keySignature.js';

/**
 * Modular, fixed-height Studio top pane. Default layout shows a single centered
 * staff; "triptych" adds a circle-of-fifths (left) and a live chord name (right).
 *
 * @param {Map} activeNotes - live MIDI surface (Map<midi, data>)
 * @param {'staff'|'triptych'} [layout]
 */
export function StudioTopPane({ activeNotes, layout = 'staff' }) {
  const midiNotes = useMemo(() => [...activeNotes.keys()], [activeNotes]);
  const pitchClasses = useMemo(() => midiNotes.map((n) => n % 12), [midiNotes]);
  // Light, momentary key read for the circle's key-region ring (the staff keeps its
  // own rolling detection; this one is intentionally simpler / stateless).
  const detectedKey = useMemo(() => detectKey(pitchClasses, 'C'), [pitchClasses]);

  if (layout !== 'triptych') {
    return (
      <div className="piano-studio-play__staff piano-top-pane piano-top-pane--staff">
        <CurrentChordStaff activeNotes={activeNotes} />
      </div>
    );
  }

  return (
    <div className="piano-studio-play__staff piano-top-pane piano-top-pane--triptych">
      <div className="piano-top-pane__side piano-top-pane__circle">
        <CircleOfFifths pitchClasses={pitchClasses} detectedKey={detectedKey} />
      </div>
      <div className="piano-top-pane__center">
        <CurrentChordStaff activeNotes={activeNotes} />
      </div>
      <div className="piano-top-pane__side piano-top-pane__chord">
        <ChordNamePanel midiNotes={midiNotes} />
      </div>
    </div>
  );
}

export default StudioTopPane;
```

> If `StudioTopPane` already exists with different prop names, keep its names and only
> add the `layout` branch + triptych markup. Do NOT rename its existing props.

- [ ] **Step 2: Add triptych SCSS**

Append under `.piano-studio-play` in `frontend/src/Apps/PianoApp.scss` (the `&__staff` rule from the modular-pane work supplies the fixed height + margins; these rules only handle the three-column split):

```scss
  // Triptych: circle-of-fifths | staff | chord name. The fixed-height/margins come
  // from &__staff (modular top-pane work); this only splits it into three columns.
  &__staff.piano-top-pane--triptych {
    display: grid;
    grid-template-columns: 1fr 2fr 1fr;
    align-items: center;
    gap: 1rem;
    padding: 0 1rem;

    .piano-top-pane__side {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      min-width: 0;
      overflow: hidden;
    }
    .piano-top-pane__center {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 0;
      height: 100%;
      .current-chord-staff-wrapper { width: 100%; }
    }
  }
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `npx eslint frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioTopPane.jsx`
Expected: no errors.

- [ ] **Step 4: Visual smoke test in the dev app**

Temporarily render the triptych by hardcoding `layout="triptych"` where `StudioTopPane` is used (you'll wire the real preference in Task 7), then load `/piano/studio` in the dev browser and play a C-E-G chord.
Run (start dev if needed): `ss -tlnp | grep 3112 || node backend/index.js &`
Expected: left shows the wheel with C, E, G lit; middle shows the staff chord; right shows "C major". Revert the hardcode after verifying.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioTopPane.jsx frontend/src/Apps/PianoApp.scss
git commit -m "feat(piano): Studio top-pane triptych layout (circle | staff | chord name)"
```

---

## Task 6: `usePianoPreferences` hook (load/save the opaque per-user blob)

A small hook over the existing `/users/:userId/preferences` API: loads the blob for the current user, exposes a getter with a default, and a setter that PUTs a shallow-merge patch (the backend already merges). Used by the layout toggle.

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/usePianoPreferences.js`

- [ ] **Step 1: Write the hook**

```javascript
// frontend/src/modules/Piano/PianoKiosk/usePianoPreferences.js
import { useState, useEffect, useCallback, useRef } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoUser } from './PianoUserContext.jsx';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-preferences' });
  return _logger;
}

/**
 * Per-user piano preferences (opaque blob behind /users/:userId/preferences).
 * GET on user change; setPref() PUTs a shallow-merge patch (server merges).
 *
 * @returns {{ prefs: object, loaded: boolean, getPref: (k,d)=>any, setPref: (k,v)=>Promise<void> }}
 */
export function usePianoPreferences() {
  const { currentUser } = usePianoUser();
  const [prefs, setPrefs] = useState({});
  const [loaded, setLoaded] = useState(false);
  const userRef = useRef(currentUser);
  userRef.current = currentUser;

  useEffect(() => {
    if (!currentUser) { setPrefs({}); setLoaded(false); return; }
    let cancelled = false;
    setLoaded(false);
    DaylightAPI(`api/v1/piano/users/${currentUser}/preferences`)
      .then((r) => { if (!cancelled) { setPrefs(r && typeof r === 'object' ? r : {}); setLoaded(true); } })
      .catch((e) => {
        if (!cancelled) { setPrefs({}); setLoaded(true); }
        logger().warn('preferences.load.fail', { user: currentUser, error: e?.message });
      });
    return () => { cancelled = true; };
  }, [currentUser]);

  const getPref = useCallback((key, fallback) => (key in prefs ? prefs[key] : fallback), [prefs]);

  const setPref = useCallback(async (key, value) => {
    const user = userRef.current;
    if (!user) return;
    setPrefs((prev) => ({ ...prev, [key]: value })); // optimistic
    try {
      await DaylightAPI(`api/v1/piano/users/${user}/preferences`, { [key]: value }, 'PUT');
      logger().info('preferences.save', { user, key });
    } catch (e) {
      logger().error('preferences.save.fail', { user, key, error: e?.message });
    }
  }, []);

  return { prefs, loaded, getPref, setPref };
}

export default usePianoPreferences;
```

> **Verify the `DaylightAPI` signature first.** Open `frontend/src/lib/api.mjs` and confirm
> how it issues a PUT with a body (e.g. `DaylightAPI(path, body, method)` vs an options
> object). `PianoUserContext.jsx` only shows the GET form (`DaylightAPI(path)`); match the
> PUT form to the helper's actual API. Adjust the `setPref` call accordingly — do NOT
> assume the 3-arg shape if the helper differs.

- [ ] **Step 2: Verify it compiles and lints**

Run: `npx eslint frontend/src/modules/Piano/PianoKiosk/usePianoPreferences.js`
Expected: no errors.

- [ ] **Step 3: Manual API round-trip check**

Run:
```bash
curl -s -X PUT http://localhost:3112/api/v1/piano/users/kckern/preferences \
  -H 'Content-Type: application/json' -d '{"topPaneLayout":"triptych"}'
curl -s http://localhost:3112/api/v1/piano/users/kckern/preferences
```
Expected: both return JSON including `"topPaneLayout":"triptych"`. (Reset to `"staff"` after.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/usePianoPreferences.js
git commit -m "feat(piano): usePianoPreferences hook over per-user prefs blob"
```

---

## Task 7: Wire the preference into Studio + add a layout toggle (default `staff`)

`StudioPlay` reads `topPaneLayout` from the hook (default `'staff'`, optionally overridable by a `piano.yml` default), passes it to `StudioTopPane`, and renders a small toggle so the user can switch live; the toggle persists via `setPref`.

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioPlay.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss` (toggle button styles)

- [ ] **Step 1: Wire preference + toggle into `StudioPlay`**

Replace the staff block in `StudioPlay.jsx` (lines 45-47, the `<div className="piano-studio-play__staff"><CurrentChordStaff .../></div>`) with the modular pane driven by the preference, and add the toggle near the Record button:

```jsx
// add to imports
import { StudioTopPane } from './StudioTopPane.jsx';
import { usePianoPreferences } from '../../usePianoPreferences.js';

// inside StudioPlay(), after the usePianoMidi()/computeKeyboardRange() lines:
const { getPref, setPref, loaded } = usePianoPreferences();
const layout = loaded ? getPref('topPaneLayout', 'staff') : 'staff';
const toggleLayout = () =>
  setPref('topPaneLayout', layout === 'triptych' ? 'staff' : 'triptych');

// ...in the JSX, replace the old __staff div with:
<StudioTopPane activeNotes={activeNotes} layout={layout} />

// ...and add a toggle button next to the Record button (inside .piano-studio-play):
<button
  type="button"
  className="piano-studio-play__layout-toggle"
  onClick={toggleLayout}
  aria-pressed={layout === 'triptych'}
  aria-label={layout === 'triptych' ? 'Show staff only' : 'Show theory triptych'}
  title={layout === 'triptych' ? 'Staff only' : 'Theory triptych'}
>
  {layout === 'triptych' ? 'Staff' : 'Theory'}
</button>
```

> Keep the existing Record button and its markup untouched; only add the new toggle and
> swap the staff div for `<StudioTopPane>`.

- [ ] **Step 2: Add toggle styles**

Append under `.piano-studio-play` in `PianoApp.scss`:

```scss
  &__layout-toggle {
    position: absolute;
    top: 0.75rem;
    left: 1.5rem;
    z-index: 5;
    padding: 0.4rem 0.9rem;
    border-radius: var(--r-pill);
    border: 1px solid var(--piano-border);
    background: var(--piano-surface-2);
    color: var(--piano-fg);
    font: inherit;
    font-weight: 700;
    cursor: pointer;

    &[aria-pressed='true'] {
      background: var(--piano-accent, #c08a3e);
      border-color: var(--piano-accent, #c08a3e);
      color: #fff;
    }
  }
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `npx eslint frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioPlay.jsx`
Expected: no errors.

- [ ] **Step 4: Full flow smoke test**

Load `/piano/studio` in the dev browser. Default = single centered staff (no circle/name). Tap "Theory" → triptych appears; play C-E-G → circle lights C/E/G, name shows "C major". Reload the page → triptych persists (preference saved). Tap "Staff" → back to centered staff; reload → staff persists.
Expected: all of the above; no console errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioPlay.jsx frontend/src/Apps/PianoApp.scss
git commit -m "feat(piano): wire per-user top-pane layout preference + Studio toggle (default staff)"
```

---

## Task 8: Optional `piano.yml` default + docs

Let `piano.yml` carry a household-wide default (`studio.topPaneLayout: staff`) so a fresh user without saved prefs gets the configured default. Update the multi-user reference note.

**Files:**
- Modify (in container, via `sudo docker exec`): `data/household/config/piano.yml`
- Modify: `frontend/src/modules/Piano/PianoKiosk/usePianoPreferences.js` (accept a config default)
- Docs: this plan stays in `_wip/plans/`; update memory/reference note as noted below.

- [ ] **Step 1: Decide the default source precedence**

Precedence (highest first): saved user pref `topPaneLayout` → `piano.yml` `studio.topPaneLayout` → hardcoded `'staff'`. The `piano.yml` value is served via the existing piano config endpoint (see `reference_piano_config_two_files`: the served file is `household/config/piano.yml`). Confirm which frontend hook/context already exposes piano config (`PianoConfig.jsx`) and read `studio.topPaneLayout` from it; pass it as the fallback to `getPref('topPaneLayout', configDefault)` in `StudioPlay`.

> **Verify before coding:** grep for how `piano.yml` reaches the frontend
> (`grep -rn "plexCollection\|games\b" frontend/src/modules/Piano/PianoKiosk/PianoConfig.jsx`)
> and reuse that same config object rather than adding a new fetch.

- [ ] **Step 2: Add the config key in the container (no repo change)**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/piano.yml' # inspect first
# then write the full file back with a studio.topPaneLayout: staff block (heredoc, NOT sed)
```
Expected: `GET /api/v1/admin/apps/piano/config` (or the piano config endpoint) returns `studio.topPaneLayout`.

- [ ] **Step 3: Use the config default in `StudioPlay`**

Change the fallback in Task 7's `layout` line to use the piano-config default when present:

```jsx
const configDefault = pianoConfig?.studio?.topPaneLayout || 'staff';
const layout = loaded ? getPref('topPaneLayout', configDefault) : configDefault;
```

(Source `pianoConfig` from whatever context Step 1 identified.)

- [ ] **Step 4: Verify**

Run: `npx eslint frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioPlay.jsx`
Expected: no errors. Reload `/piano/studio` for a user with no saved pref → respects the `piano.yml` default.

- [ ] **Step 5: Update the reference note + commit code**

Append to `reference_piano_multi_user` (memory) and/or `reference_piano_config_two_files`: "`studio.topPaneLayout` (staff|triptych) is a per-user pref (preferences.yml) with a `piano.yml` `studio.topPaneLayout` household default; Studio top pane reads it via `usePianoPreferences`."

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioPlay.jsx frontend/src/modules/Piano/PianoKiosk/usePianoPreferences.js
git commit -m "feat(piano): piano.yml household default for Studio top-pane layout"
```

---

## Task 9: Full-suite regression + deploy

- [ ] **Step 1: Run the piano theory tests together**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/theory/`
Expected: all chord-naming + circle tests PASS.

- [ ] **Step 2: Run the isolated suite (catch collateral)**

Run: `npm run test:isolated`
Expected: green, or only pre-existing unrelated failures (compare against a clean baseline before this branch).

- [ ] **Step 3: Build + deploy (kckern-server policy)**

Confirm the garage/Player deploy gates are clear (CLAUDE.local.md), then build the image and `sudo deploy-daylight`. After deploy, since Studio renders on the garage display only if used there, no kiosk reload is required for office; if testing on garage, hard-reload Firefox per CLAUDE.local.md.

---

## Self-Review

**Spec coverage** (audit `2026-06-24-piano-studio-theory-triptych-circle-of-fifths-chord-naming.md`):
- "Circle of fifths that highlights active pitch classes" → Tasks 2 (model) + 3 (component) + 5 (placed left). ✔
- "Chord-identification + naming (root, quality, inversion → display name)" → Tasks 1 + 4. ✔
- "Compose triptych in the modular top pane (left/middle/right)" → Task 5. ✔
- "Config/preference toggle staff vs triptych, default staff; per-user prefs and/or piano.yml" → Tasks 6, 7, 8. ✔
- "Default stays staff-only, centered" → Tasks 5 (default branch) + 7 (default `'staff'`). ✔

**Type/name consistency:** `identifyChord` returns `{ root, quality, inversion, displayName, bassPitchClass, notePitchClasses }` — used unchanged in Tasks 1/4. `activeSlots`/`keyArc`/`circlePositions`/`CIRCLE_ORDER` consistent across Tasks 2/3. `topPaneLayout` pref key consistent across Tasks 6/7/8. `StudioTopPane({ activeNotes, layout })` consistent across Tasks 5/7.

**Placeholder scan:** every code step has full code; commands have expected output. Two explicit "verify the real API shape" guards (DaylightAPI PUT form; piano-config exposure) are deliberate — they prevent inventing a signature, not placeholders.

---

## Open Design Questions (resolve / `/brainstorm` before building the visual panels — Tasks 3 & 5)

1. **Circle-of-fifths visual semantics — pitch-class lights vs. key lights.** Should the wheel light each *sounding pitch class* on its own slot (simple, literal; what this plan implements), or infer and light the *key region* / the chord's *function within the detected key* (musically richer, but ambiguous and flicker-prone)? This drives whether the left panel is a "what notes am I playing" indicator or a "where am I harmonically" indicator — very different visuals and a different `activeSlots`/`keyArc` emphasis. **Recommend brainstorming the intended teaching/feedback goal first.**

2. **Enharmonic spelling & key-aware chord names.** v1 names everything with sharp spelling and labels inversions as slash chords (`C major / E`). Do we want key-aware spelling (a `Bb` not `A#` in F major), proper inversion figures (6 / 6-4) instead of slash names, and Roman-numeral / functional labels (ii°, V7)? This expands the chord module's contract and its test matrix substantially, and depends on a reliable detected key.

3. **Layout, sizing, and fit at fixed height.** The triptych must live inside the *fixed-height* top pane from the sibling modular-pane work without the staff (tall stems/ledger notes) or the circle clipping. What are the column proportions (1:2:1 assumed), minimum legible sizes for the wheel and chord text on the garage display, and the responsive behavior on narrower kiosks? This depends on the modular pane's final fixed dimensions, which aren't decided yet — so this triptych work should be sequenced *after* that pane lands and its height is known.
