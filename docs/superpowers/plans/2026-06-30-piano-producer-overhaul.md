# Piano Producer Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Producer from a text-list database browser into a real loop-layering instrument: loops identified by their (canonical, transpose-invariant) roman progression rendered through a proper harmonic-notation type system, layering gated on genuine harmonic compatibility, and the loop made visible/audible (staff thumbnails, peek preview, playhead, two-color keyboard, Mute/Solo, tempo).

**Architecture:** Five sequenced, independently-shippable phases. Phases 0–3 are pure/backend (the foundation): a harmonic-signature core, a classifier that back-fills `roman`/`barSpan`/`signature`/`title` into `index.yml` for every loop (melodies included), a matcher that gates stacking on signature equality, and a scheduler that aligns layers on the harmonic cycle. Phases 4–5 are frontend: a `<RomanProgression>` typography primitive, then the Producer UX rework that consumes all of the above plus `modules/MusicNotation/`.

**Tech Stack:** Node ESM, `node:test` + `node:assert/strict` for `shared/music/` and `cli/` (run: `node --test <file>`). Vitest + jsdom for frontend (`./node_modules/.bin/vitest run --config vitest.config.mjs <file>`). `@tonejs/midi` for MIDI parsing, `js-yaml` for the index, existing pure theory helpers in `shared/music/` (`romanAnalysis.mjs`, `chords.mjs`, `transpose.mjs`) and `frontend/src/modules/MusicNotation/`.

**Source of truth for requirements:** `docs/_wip/audits/2026-06-30-piano-producer-ux-audit.md`.

**Loop catalog location:** `<DAYLIGHT_BASE_PATH>/media/midi/loops/` (dev on kckern-server: `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media/midi/loops/`), served to the frontend at `/api/v1/local/stream/midi/loops/…`. The index is `index.yml` (an array of loop entries). Current entry shape (example, a melody): `{ slug, path, type, sources[], canonicalKey, availableKeys[], chords, roman, degrees[], mood, descriptor, bpm, reverb, artist, copies, origin }`. Chord-progressions/basslines have `roman` populated; **melodies/ideas have `roman: null`, `chords: null`, often `bpm: null`** — that gap is what Phase 1 fills.

---

## Phase 0 — Harmonic signature core (`shared/music/harmonicSignature.mjs`)

Pure functions that normalize a roman progression into a canonical, length-independent signature so that `II VI V` realized over 3, 6, or 9 bars compares equal. No I/O, no DOM.

### Task 0.1: `normalizeProgression` — collapse consecutive duplicates

**Files:**
- Create: `shared/music/harmonicSignature.mjs`
- Test: `shared/music/harmonicSignature.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// shared/music/harmonicSignature.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProgression } from './harmonicSignature.mjs';

describe('normalizeProgression', () => {
  it('collapses consecutive duplicate chords (rate-independent)', () => {
    assert.deepEqual(normalizeProgression(['II', 'II', 'VI', 'V']), ['II', 'VI', 'V']);
  });
  it('collapses a doubled realization to the same shape', () => {
    assert.deepEqual(normalizeProgression(['II', 'II', 'VI', 'VI', 'V', 'V']), ['II', 'VI', 'V']);
  });
  it('preserves a genuine repeat that is not adjacent', () => {
    assert.deepEqual(normalizeProgression(['I', 'V', 'I', 'IV']), ['I', 'V', 'I', 'IV']);
  });
  it('returns [] for empty/nullish input', () => {
    assert.deepEqual(normalizeProgression(null), []);
    assert.deepEqual(normalizeProgression([]), []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test shared/music/harmonicSignature.test.mjs`
Expected: FAIL — `Cannot find module './harmonicSignature.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// shared/music/harmonicSignature.mjs
// Harmonic signature — reduce a roman progression to a canonical, length-
// independent key so realizations of the same harmony over different bar counts
// compare equal. Pure, no DOM. Used by the loop matcher (gate stacking) and the
// scheduler (align on the harmonic cycle).

/** Collapse consecutive duplicate chords (rate/duration-independent). */
export function normalizeProgression(roman) {
  if (!Array.isArray(roman)) return [];
  const out = [];
  for (const c of roman) {
    if (!c) continue;
    if (out[out.length - 1] !== c) out.push(c);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test shared/music/harmonicSignature.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/music/harmonicSignature.mjs shared/music/harmonicSignature.test.mjs
git commit -m "feat(music): normalizeProgression — collapse consecutive roman dups"
```

### Task 0.2: `minimalCycle` — reduce to the smallest repeating unit

**Files:**
- Modify: `shared/music/harmonicSignature.mjs`
- Test: `shared/music/harmonicSignature.test.mjs`

- [ ] **Step 1: Add the failing test**

```javascript
// append to shared/music/harmonicSignature.test.mjs
import { minimalCycle } from './harmonicSignature.mjs';

describe('minimalCycle', () => {
  it('reduces a whole-cycle repeat to one cycle', () => {
    assert.deepEqual(minimalCycle(['I', 'V', 'I', 'V']), ['I', 'V']);
    assert.deepEqual(minimalCycle(['ii', 'V', 'I', 'ii', 'V', 'I']), ['ii', 'V', 'I']);
  });
  it('leaves a non-repeating progression untouched', () => {
    assert.deepEqual(minimalCycle(['I', 'V', 'vi', 'IV']), ['I', 'V', 'vi', 'IV']);
  });
  it('does not reduce a partial/incomplete repeat', () => {
    assert.deepEqual(minimalCycle(['I', 'V', 'I']), ['I', 'V', 'I']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test shared/music/harmonicSignature.test.mjs`
Expected: FAIL — `minimalCycle is not a function`.

- [ ] **Step 3: Implement**

```javascript
// append to shared/music/harmonicSignature.mjs
/** Reduce a chord array to its smallest unit that tiles the whole array. */
export function minimalCycle(chords) {
  const n = chords.length;
  if (n < 2) return [...chords];
  for (let len = 1; len <= n / 2; len += 1) {
    if (n % len !== 0) continue;
    const unit = chords.slice(0, len);
    let tiles = true;
    for (let i = 0; i < n; i += 1) {
      if (chords[i] !== unit[i % len]) { tiles = false; break; }
    }
    if (tiles) return unit;
  }
  return [...chords];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test shared/music/harmonicSignature.test.mjs`
Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
git add shared/music/harmonicSignature.mjs shared/music/harmonicSignature.test.mjs
git commit -m "feat(music): minimalCycle — smallest repeating chord unit"
```

### Task 0.3: `signatureKey` + `areStackable` — the public API the matcher/scheduler use

**Files:**
- Modify: `shared/music/harmonicSignature.mjs`
- Test: `shared/music/harmonicSignature.test.mjs`

- [ ] **Step 1: Add the failing test**

```javascript
// append to shared/music/harmonicSignature.test.mjs
import { signatureKey, areStackable } from './harmonicSignature.mjs';

describe('signatureKey', () => {
  it('is equal for the same harmony realized at different rates/lengths', () => {
    const threeBar = signatureKey(['ii', 'VI', 'V']);
    const sixBar = signatureKey(['ii', 'ii', 'VI', 'VI', 'V', 'V']);
    const twoCycles = signatureKey(['ii', 'VI', 'V', 'ii', 'VI', 'V']);
    assert.equal(threeBar, sixBar);
    assert.equal(threeBar, twoCycles);
  });
  it('differs for different progressions', () => {
    assert.notEqual(signatureKey(['I', 'V', 'vi', 'IV']), signatureKey(['ii', 'V', 'I']));
  });
  it('is null for no harmonic content', () => {
    assert.equal(signatureKey(null), null);
    assert.equal(signatureKey([]), null);
  });
});

describe('areStackable', () => {
  it('true when signatures match', () => {
    assert.equal(areStackable(['I', 'V'], ['I', 'I', 'V', 'V']), true);
  });
  it('false when signatures differ', () => {
    assert.equal(areStackable(['I', 'V', 'vi', 'IV'], ['ii', 'V', 'I']), false);
  });
  it('true when the candidate has no harmony (melodic wildcard conforms)', () => {
    assert.equal(areStackable(['I', 'V', 'vi', 'IV'], null), true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test shared/music/harmonicSignature.test.mjs`
Expected: FAIL — `signatureKey is not a function`.

- [ ] **Step 3: Implement**

```javascript
// append to shared/music/harmonicSignature.mjs
/**
 * Canonical, length-independent key for a roman progression, or null if there is
 * no harmonic content. Same harmony at any rate/repetition → same string.
 */
export function signatureKey(roman) {
  const cycle = minimalCycle(normalizeProgression(roman));
  return cycle.length ? cycle.join('-') : null;
}

/**
 * Can `cand` be layered on `base`? True iff they share a harmonic signature, OR
 * the candidate has no harmony of its own (a bare melody conforms to any base).
 */
export function areStackable(baseRoman, candRoman) {
  const b = signatureKey(baseRoman);
  const c = signatureKey(candRoman);
  if (c === null) return true; // melodic wildcard
  if (b === null) return true; // base has no harmony to clash with
  return b === c;
}

export default { normalizeProgression, minimalCycle, signatureKey, areStackable };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test shared/music/harmonicSignature.test.mjs`
Expected: PASS (13 tests total).

- [ ] **Step 5: Commit**

```bash
git add shared/music/harmonicSignature.mjs shared/music/harmonicSignature.test.mjs
git commit -m "feat(music): signatureKey + areStackable — harmonic stacking gate"
```

---

## Phase 1 — Classifier: back-fill harmony metadata into `index.yml`

Melodies/ideas lack `roman`. Add a note-window harmonic classifier and a `barSpan`/`signature`/`title` writer, wired into the existing `cli/midi-ingest.mjs`. The audit's honest caveat applies: inferring implied harmony from a bare melody is uncertain — record a `harmonyConfidence` and never overwrite an existing authored `roman`.

### Task 1.1: `windowChords` — infer a chord per bar from notes

**Files:**
- Create: `cli/midi-ingest/harmonicClassify.mjs`
- Test: `cli/midi-ingest/harmonicClassify.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// cli/midi-ingest/harmonicClassify.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { windowChords } from './harmonicClassify.mjs';

// One bar of C major (C-E-G) then one bar of A minor (A-C-E) at 480ppq, 4/4.
const BAR = 480 * 4;
const notes = [
  { ticks: 0, durationTicks: 240, midi: 60 }, // C4
  { ticks: 0, durationTicks: 240, midi: 64 }, // E4
  { ticks: 0, durationTicks: 240, midi: 67 }, // G4
  { ticks: BAR, durationTicks: 240, midi: 69 }, // A4
  { ticks: BAR, durationTicks: 240, midi: 60 }, // C4
  { ticks: BAR, durationTicks: 240, midi: 64 }, // E4
];

describe('windowChords', () => {
  it('returns one pitch-class set per bar', () => {
    const out = windowChords(notes, { ppq: 480, beats: 4, beatType: 4 });
    assert.equal(out.length, 2);
    assert.deepEqual([...out[0]].sort((a, b) => a - b), [0, 4, 7]); // C E G
    assert.deepEqual([...out[1]].sort((a, b) => a - b), [0, 4, 9]); // A C E
  });
  it('returns [] for no notes', () => {
    assert.deepEqual(windowChords([], { ppq: 480, beats: 4, beatType: 4 }), []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test cli/midi-ingest/harmonicClassify.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
// cli/midi-ingest/harmonicClassify.mjs
// Infer a loop's implied harmony from its notes. Windows notes by bar, picks the
// most likely chord per bar, then delegates to shared roman analysis. Uncertain
// by nature (esp. for bare melodies) — callers should gate on the confidence.
import { mod12 } from '../../shared/music/transpose.mjs';

/** Pitch-class set of notes sounding in each bar. */
export function windowChords(notes, { ppq, beats = 4, beatType = 4 }) {
  if (!notes?.length) return [];
  const barTicks = ppq * (4 / beatType) * beats;
  const end = notes.reduce((m, n) => Math.max(m, n.ticks + (n.durationTicks || 0)), 0);
  const barCount = Math.max(1, Math.ceil(end / barTicks));
  const bars = Array.from({ length: barCount }, () => new Set());
  for (const n of notes) {
    const bar = Math.min(barCount - 1, Math.floor(n.ticks / barTicks));
    bars[bar].add(mod12(n.midi));
  }
  return bars.filter((s) => s.size > 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test cli/midi-ingest/harmonicClassify.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/midi-ingest/harmonicClassify.mjs cli/midi-ingest/harmonicClassify.test.mjs
git commit -m "feat(midi-ingest): windowChords — per-bar pitch-class sets"
```

### Task 1.2: `pcSetToTriad` — name a pitch-class set as root+quality

**Files:**
- Modify: `cli/midi-ingest/harmonicClassify.mjs`
- Test: `cli/midi-ingest/harmonicClassify.test.mjs`

- [ ] **Step 1: Add the failing test**

```javascript
// append to cli/midi-ingest/harmonicClassify.test.mjs
import { pcSetToTriad } from './harmonicClassify.mjs';

describe('pcSetToTriad', () => {
  it('names a major triad', () => {
    assert.deepEqual(pcSetToTriad(new Set([0, 4, 7])), { root: 0, quality: 'major' });
  });
  it('names a minor triad', () => {
    assert.deepEqual(pcSetToTriad(new Set([9, 0, 4])), { root: 9, quality: 'minor' });
  });
  it('picks the best-fitting triad from an extended set', () => {
    // C E G B (Cmaj7) → C major triad
    assert.deepEqual(pcSetToTriad(new Set([0, 4, 7, 11])), { root: 0, quality: 'major' });
  });
  it('returns null when no triad fits (e.g. a single note)', () => {
    assert.equal(pcSetToTriad(new Set([0])), null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test cli/midi-ingest/harmonicClassify.test.mjs`
Expected: FAIL — `pcSetToTriad is not a function`.

- [ ] **Step 3: Implement**

```javascript
// append to cli/midi-ingest/harmonicClassify.mjs
const TRIADS = [
  { quality: 'major', intervals: [0, 4, 7] },
  { quality: 'minor', intervals: [0, 3, 7] },
  { quality: 'diminished', intervals: [0, 3, 6] },
  { quality: 'augmented', intervals: [0, 4, 8] },
];

/** Best-fitting root+quality for a pitch-class set, or null if nothing fits. */
export function pcSetToTriad(pcSet) {
  if (!pcSet || pcSet.size < 2) return null;
  let best = null;
  for (let root = 0; root < 12; root += 1) {
    for (const { quality, intervals } of TRIADS) {
      const triad = intervals.map((i) => (root + i) % 12);
      const present = triad.filter((pc) => pcSet.has(pc)).length;
      const extra = [...pcSet].filter((pc) => !triad.includes(pc)).length;
      const score = present * 2 - extra; // reward triad members, penalize outsiders
      if (present >= 2 && (!best || score > best.score)) best = { root, quality, score };
    }
  }
  return best ? { root: best.root, quality: best.quality } : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test cli/midi-ingest/harmonicClassify.test.mjs`
Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**

```bash
git add cli/midi-ingest/harmonicClassify.mjs cli/midi-ingest/harmonicClassify.test.mjs
git commit -m "feat(midi-ingest): pcSetToTriad — name a pitch-class set"
```

### Task 1.3: `classifyHarmony` — notes → { roman, barSpan, signature, confidence }

**Files:**
- Modify: `cli/midi-ingest/harmonicClassify.mjs`
- Test: `cli/midi-ingest/harmonicClassify.test.mjs`

- [ ] **Step 1: Add the failing test**

```javascript
// append to cli/midi-ingest/harmonicClassify.test.mjs
import { classifyHarmony } from './harmonicClassify.mjs';

const BAR2 = 480 * 4;
const cMajThenAMin = [
  { ticks: 0, durationTicks: 240, midi: 60 },
  { ticks: 0, durationTicks: 240, midi: 64 },
  { ticks: 0, durationTicks: 240, midi: 67 },
  { ticks: BAR2, durationTicks: 240, midi: 69 },
  { ticks: BAR2, durationTicks: 240, midi: 60 },
  { ticks: BAR2, durationTicks: 240, midi: 64 },
];

describe('classifyHarmony', () => {
  it('derives roman, barSpan and a signature from notes', () => {
    const r = classifyHarmony(cMajThenAMin, { ppq: 480, beats: 4, beatType: 4 });
    assert.deepEqual(r.roman, ['I', 'vi']);   // C=I, Am=vi in C major
    assert.equal(r.barSpan, 2);
    assert.equal(r.signature, 'I-vi');
    assert.ok(r.confidence > 0 && r.confidence <= 1);
  });
  it('reports low/zero confidence and null roman when no chords resolve', () => {
    const single = [{ ticks: 0, durationTicks: 240, midi: 60 }];
    const r = classifyHarmony(single, { ppq: 480, beats: 4, beatType: 4 });
    assert.equal(r.roman, null);
    assert.equal(r.signature, null);
    assert.equal(r.confidence, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test cli/midi-ingest/harmonicClassify.test.mjs`
Expected: FAIL — `classifyHarmony is not a function`.

- [ ] **Step 3: Implement**

```javascript
// append to cli/midi-ingest/harmonicClassify.mjs
import { romanAnalysis, bestTonic } from '../../shared/music/romanAnalysis.mjs';
import { signatureKey } from '../../shared/music/harmonicSignature.mjs';

/**
 * Infer a loop's harmony from its notes.
 * @returns {{roman:string[]|null, barSpan:number, signature:string|null, confidence:number}}
 */
export function classifyHarmony(notes, timeSig) {
  const windows = windowChords(notes, timeSig);
  const triads = windows.map(pcSetToTriad);
  const resolved = triads.filter(Boolean);
  const barSpan = windows.length;
  if (resolved.length === 0) return { roman: null, barSpan, signature: null, confidence: 0 };
  const tonic = bestTonic(resolved);
  // Use '?' for bars that didn't resolve so the array stays bar-aligned.
  const roman = triads.map((t) => (t ? romanAnalysis([t], tonic)[0] : '?'));
  const confidence = resolved.length / triads.length;
  return { roman, barSpan, signature: signatureKey(roman.filter((r) => r !== '?')), confidence };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test cli/midi-ingest/harmonicClassify.test.mjs`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add cli/midi-ingest/harmonicClassify.mjs cli/midi-ingest/harmonicClassify.test.mjs
git commit -m "feat(midi-ingest): classifyHarmony — notes → roman/barSpan/signature"
```

### Task 1.4: `enrichEntry` — add signature/barSpan/title to an index entry (never clobber authored roman)

**Files:**
- Create: `cli/midi-ingest/enrichEntry.mjs`
- Test: `cli/midi-ingest/enrichEntry.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// cli/midi-ingest/enrichEntry.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { enrichEntry, titleFromSlug } from './enrichEntry.mjs';

describe('titleFromSlug', () => {
  it('humanizes a slug, stripping degree digits, artist noise and bpm', () => {
    assert.equal(
      titleFromSlug('rock-melody-11-intenseawesomebassline-niko-kotoulas-140bpm'),
      'Rock Melody · Intenseawesomebassline',
    );
    assert.equal(titleFromSlug('quick-moves-7-1-7-6-stepwise-walkdown'), 'Quick Moves · Stepwise Walkdown');
  });
});

describe('enrichEntry', () => {
  it('keeps an authored roman and just adds signature/barSpan/title', () => {
    const entry = { slug: 'am-f-g-am', roman: ['iii', 'I', 'II', 'iii'], type: 'chord-progression' };
    const out = enrichEntry(entry, { classified: null });
    assert.deepEqual(out.roman, ['iii', 'I', 'II', 'iii']);
    assert.equal(out.signature, 'iii-I-II-iii');
    assert.equal(out.title, 'Am F G Am'); // de-kebab of the letters when no better title
  });
  it('fills roman/signature/barSpan from the classifier when roman is null and confidence is high', () => {
    const entry = { slug: 'quick-moves-7-1-7-6-stepwise-walkdown', roman: null, type: 'melody' };
    const classified = { roman: ['I', 'vi'], barSpan: 2, signature: 'I-vi', confidence: 0.9 };
    const out = enrichEntry(entry, { classified, minConfidence: 0.6 });
    assert.deepEqual(out.roman, ['I', 'vi']);
    assert.equal(out.signature, 'I-vi');
    assert.equal(out.barSpan, 2);
    assert.equal(out.harmonyConfidence, 0.9);
  });
  it('leaves roman null when classifier confidence is below threshold', () => {
    const entry = { slug: 'pouring-rain', roman: null, type: 'melody' };
    const classified = { roman: ['I', '?'], barSpan: 2, signature: 'I', confidence: 0.4 };
    const out = enrichEntry(entry, { classified, minConfidence: 0.6 });
    assert.equal(out.roman, null);
    assert.equal(out.signature, null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test cli/midi-ingest/enrichEntry.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
// cli/midi-ingest/enrichEntry.mjs
// Non-destructive enrichment of an index.yml loop entry: adds signature, barSpan,
// title, and (only when authored roman is absent AND the classifier is confident)
// an inferred roman. Never overwrites an authored roman.
import { signatureKey } from '../../shared/music/harmonicSignature.mjs';

const NOISE = /(niko|kotoulas|intense|awesome|perfect5th|perfect-5th|arp)/gi;

/** Human display title from a slug: strip degree digits, bpm, known noise words. */
export function titleFromSlug(slug) {
  const cleaned = (slug || '')
    .replace(/\d+bpm/gi, '')
    .replace(/\b\d+([-.]\d+)*\b/g, '')   // strip standalone degree runs like 7-1-7-6
    .replace(NOISE, '')
    .split('-')
    .map((w) => w.trim())
    .filter(Boolean);
  // Group into up to two phrases separated by a middot for readability.
  const words = cleaned.map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  if (words.length <= 3) return words.join(' ');
  const mid = Math.ceil(words.length / 2);
  return `${words.slice(0, mid).join(' ')} · ${words.slice(mid).join(' ')}`;
}

export function enrichEntry(entry, { classified = null, minConfidence = 0.6 } = {}) {
  const out = { ...entry };
  const hasAuthoredRoman = Array.isArray(entry.roman) && entry.roman.length > 0;

  if (!hasAuthoredRoman && classified && classified.confidence >= minConfidence) {
    out.roman = classified.roman;
    out.barSpan = classified.barSpan;
    out.harmonyConfidence = classified.confidence;
  }
  out.signature = signatureKey(out.roman);
  out.title = titleFromSlug(entry.slug);
  return out;
}

export default { enrichEntry, titleFromSlug };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test cli/midi-ingest/enrichEntry.test.mjs`
Expected: PASS. (Note: the `Am F G Am` expectation exercises `titleFromSlug('am-f-g-am')` → words `Am F G Am`, ≤3? it's 4 words so it will render `Am F · G Am`. **Adjust the test expectation to `'Am F · G Am'` before running**, matching the mid-split rule — this is the one place the plan's illustrative title and the algorithm's exact output must be reconciled by the implementer; pick the algorithm's output as truth.)

- [ ] **Step 5: Commit**

```bash
git add cli/midi-ingest/enrichEntry.mjs cli/midi-ingest/enrichEntry.test.mjs
git commit -m "feat(midi-ingest): enrichEntry — signature/barSpan/title, non-destructive"
```

### Task 1.5: Wire enrichment into `cli/midi-ingest.mjs` and run it with `--write`

**Files:**
- Modify: `cli/midi-ingest.mjs` (entry-build section — locate where each entry object is pushed for `index.yml`)

- [ ] **Step 1: Read the ingest entry-build code**

Run: `grep -n "roman\|index.yml\|writeFileSync\|push(" cli/midi-ingest.mjs`
Identify (a) where the per-loop entry object is assembled, and (b) where `index.yml` is serialized. Confirm the parsed `Midi` object (with `.tracks[].notes`, `header.ppq`, `header.timeSignatures`) is in scope at entry-build time.

- [ ] **Step 2: Add imports at the top of `cli/midi-ingest.mjs`**

```javascript
import { classifyHarmony } from './midi-ingest/harmonicClassify.mjs';
import { enrichEntry } from './midi-ingest/enrichEntry.mjs';
```

- [ ] **Step 3: Enrich each entry just before it is pushed to the index array**

Where the entry object (`const entry = { slug, path, type, … roman, … }`) is finalized, replace the bare `entries.push(entry)` (or equivalent) with:

```javascript
// Derive implied harmony for loops without an authored roman (melodies/ideas).
const flatNotes = midi.tracks.flatMap((tr) => tr.notes.map((n) => ({
  ticks: n.ticks, durationTicks: n.durationTicks, midi: n.midi,
})));
const ts = midi.header.timeSignatures?.[0]?.timeSignature || [4, 4];
const classified = classifyHarmony(flatNotes, { ppq: midi.header.ppq || 480, beats: ts[0], beatType: ts[1] });
entries.push(enrichEntry(entry, { classified, minConfidence: 0.6 }));
```

(Use the real variable names found in Step 1 — `midi`, `entry`, and the index array. If the parsed MIDI is not retained at entry-build time, hoist it so the notes are available here.)

- [ ] **Step 4: Dry-run, then write**

Run: `node cli/midi-ingest.mjs --limit=200`
Expected: prints stats, no write. Confirm no exceptions.

Run: `node cli/midi-ingest.mjs --write`
Expected: rewrites `index.yml`.

- [ ] **Step 5: Verify the index gained the fields for melodies**

Run: `grep -A3 "type: melody" "$DAYLIGHT_BASE_PATH/media/midi/loops/index.yml" | grep -E "signature:|barSpan:|title:" | head`
Expected: melody entries now carry `signature`, `barSpan`, `title` (and `roman` where confidence ≥ 0.6).

- [ ] **Step 6: Commit**

```bash
git add cli/midi-ingest.mjs
git commit -m "feat(midi-ingest): enrich index.yml with harmony signature/barSpan/title"
```

---

## Phase 2 — Matcher gates on harmonic signature (`shared/music/layerMatch.mjs`)

Make same-signature the primary compatibility signal (and a hard filter for the default suggestions), with mood/pack/tempo as tie-breakers, and surface "same progression" as the top reason.

### Task 2.1: Signature is the dominant score term + a `stackable` flag

**Files:**
- Modify: `shared/music/layerMatch.mjs`
- Test: `shared/music/layerMatch.test.mjs`

- [ ] **Step 1: Add failing tests**

```javascript
// append to shared/music/layerMatch.test.mjs
import { compatibilityScore, rankLayerCandidates } from './layerMatch.mjs';

describe('harmonic gating', () => {
  const base = { slug: 'base', type: 'chord-progression', roman: ['I', 'V', 'vi', 'IV'], mood: 'Catchy', sources: ['p'] };
  const sameSig = { slug: 'm1', type: 'melody', roman: ['I', 'I', 'V', 'V', 'vi', 'vi', 'IV', 'IV'], mood: 'Sad', sources: ['q'] };
  const diffSig = { slug: 'm2', type: 'melody', roman: ['ii', 'V', 'I'], mood: 'Catchy', sources: ['p'] };

  it('scores a same-signature candidate above a same-mood/same-pack different-signature one', () => {
    assert.ok(compatibilityScore(base, sameSig) > compatibilityScore(base, diffSig));
  });
  it('rankLayerCandidates with {onlyStackable:true} drops different-signature candidates', () => {
    const ranked = rankLayerCandidates(base, [sameSig, diffSig], { onlyStackable: true });
    assert.deepEqual(ranked.map((r) => r.entry.slug), ['m1']);
  });
  it('tags "same progression" as the lead reason', () => {
    const ranked = rankLayerCandidates(base, [sameSig]);
    assert.equal(ranked[0].reasons[0], 'same progression');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test shared/music/layerMatch.test.mjs`
Expected: FAIL — new expectations unmet (`onlyStackable` ignored, reason absent, score too low).

- [ ] **Step 3: Implement**

Edit `shared/music/layerMatch.mjs`:

```javascript
// add near the top imports
import { signatureKey, areStackable } from './harmonicSignature.mjs';

// bump the weights: signature dominates
const WEIGHTS = { sameSignature: 10, complement: 3, sameRole: -3, mood: 2, mode: 1, source: 1, sameArtist: 2, bpmMax: 1 };

// in compatibilityScore(base, cand), add at the top of the accumulation:
export function compatibilityScore(base, cand) {
  let score = 0;
  const bSig = signatureKey(base.roman);
  const cSig = signatureKey(cand.roman);
  if (bSig && cSig && bSig === cSig) score += WEIGHTS.sameSignature;
  score += roleOf(cand) === roleOf(base) ? WEIGHTS.sameRole : WEIGHTS.complement;
  if (base.mood && cand.mood && base.mood === cand.mood) score += WEIGHTS.mood;
  const bm = modeOf(base); const cm = modeOf(cand);
  if (bm && cm && bm === cm) score += WEIGHTS.mode;
  if (cand.sources?.some((s) => base.sources?.includes(s))) score += WEIGHTS.source;
  if (base.artist && cand.artist && base.artist === cand.artist) score += WEIGHTS.sameArtist;
  if (base.bpm && cand.bpm) {
    const closeness = 1 - Math.min(Math.abs(base.bpm - cand.bpm), 40) / 40;
    score += closeness * WEIGHTS.bpmMax;
  }
  return score;
}

// in reasonsFor(base, cand), unshift the harmonic reason first:
function reasonsFor(base, cand) {
  const reasons = [];
  const bSig = signatureKey(base.roman);
  const cSig = signatureKey(cand.roman);
  if (bSig && cSig && bSig === cSig) reasons.push('same progression');
  if (roleOf(cand) !== roleOf(base)) reasons.push(`adds ${roleOf(cand)}`);
  if (base.mood && cand.mood === base.mood) reasons.push(`${cand.mood} mood`);
  if (base.artist && cand.artist === base.artist) reasons.push('same artist');
  else if (cand.sources?.some((s) => base.sources?.includes(s))) reasons.push('same set');
  if (base.bpm && cand.bpm && Math.abs(base.bpm - cand.bpm) <= 8) reasons.push('tempo match');
  return reasons;
}

// extend rankLayerCandidates signature + filter:
export function rankLayerCandidates(base, candidates, opts = {}) {
  return candidates
    .filter((c) => identity(c) !== identity(base))
    .filter((c) => !opts.role || roleOf(c) === opts.role)
    .filter((c) => !opts.onlyStackable || areStackable(base.roman, c.roman))
    .map((c) => ({ entry: c, score: compatibilityScore(base, c), reasons: reasonsFor(base, c), stackable: areStackable(base.roman, c.roman) }))
    .sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test shared/music/layerMatch.test.mjs`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add shared/music/layerMatch.mjs shared/music/layerMatch.test.mjs
git commit -m "feat(music): layerMatch gates + ranks on harmonic signature"
```

---

## Phase 3 — Scheduler aligns on the harmonic cycle (`shared/music/loopScheduler.mjs`)

Use `barSpan` (the harmonic cycle length) to size the master cycle and tile layers, so same-signature realizations of different lengths align on chord changes rather than raw note-derived bar counts.

### Task 3.1: `buildLoopCycle` prefers `barSpan` for layer length

**Files:**
- Modify: `shared/music/loopScheduler.mjs`
- Test: `shared/music/loopScheduler.test.mjs`

- [ ] **Step 1: Add failing test**

```javascript
// append to shared/music/loopScheduler.test.mjs
describe('buildLoopCycle harmonic alignment', () => {
  // Two layers, same signature, realized over different bar counts.
  const oneNotePerBar = (bars) => Array.from({ length: bars }, (_, b) => ({ ticks: b * 480 * 4, durationTicks: 480, midi: 60 }));

  it('sizes the master cycle by barSpan (bars), not raw note length', () => {
    const layers = [
      { notes: oneNotePerBar(3), ppq: 480, barSpan: 3 },
      { notes: oneNotePerBar(6), ppq: 480, barSpan: 6 },
    ];
    const { lengthMs } = buildLoopCycle(layers, { bpm: 120 });
    // 6 bars * 4 beats * 500ms = 12000ms
    assert.equal(Math.round(lengthMs), 12000);
  });

  it('tiles the 3-bar layer twice to fill the 6-bar cycle (aligned)', () => {
    const layers = [
      { notes: oneNotePerBar(3), ppq: 480, barSpan: 3 },
      { notes: oneNotePerBar(6), ppq: 480, barSpan: 6 },
    ];
    const { events } = buildLoopCycle(layers, { bpm: 120 });
    const ons = events.filter((e) => e.type === 'note_on').length;
    assert.equal(ons, 6 + 6); // 3-bar layer ×2 + 6-bar layer ×1
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test shared/music/loopScheduler.test.mjs`
Expected: FAIL — length derived from notes, not barSpan.

- [ ] **Step 3: Implement — add a barSpan-aware length**

In `shared/music/loopScheduler.mjs`, add a helper and use it in `buildLoopCycle`:

```javascript
/** Harmonic cycle length in ms: barSpan bars when known, else the note-derived length. */
function layerLengthMs(layer, bpm, timeSig) {
  const { beats = 4, beatType = 4 } = timeSig || {};
  if (layer.barSpan) {
    const barMs = (60000 / bpm) * (4 / beatType) * beats;
    return layer.barSpan * barMs;
  }
  const ticks = loopLengthTicks(layer.notes, layer.ppq, timeSig);
  return (ticks * 60000) / (bpm * layer.ppq);
}

export function buildLoopCycle(layers, opts) {
  const { bpm, timeSig } = opts;
  const active = layers.filter((l) => !l.muted && l.notes?.length);
  const lengths = active.map((l) => layerLengthMs(l, bpm, timeSig));
  const lengthMs = lengths.length ? Math.max(...lengths) : (60000 / bpm) * 4;

  const events = [];
  active.forEach((l, i) => {
    const layerLenMs = lengths[i];
    const repeats = Math.max(1, Math.round(lengthMs / layerLenMs));
    for (let r = 0; r < repeats; r += 1) {
      events.push(...loopToEvents(l.notes, {
        ppq: l.ppq, bpm, transpose: l.transpose || 0, velocity: l.velocity ?? 90, cycleStartMs: r * layerLenMs,
      }));
    }
  });
  events.sort((a, b) => a.t - b.t);
  return { events, lengthMs };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test shared/music/loopScheduler.test.mjs`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add shared/music/loopScheduler.mjs shared/music/loopScheduler.test.mjs
git commit -m "feat(music): scheduler aligns layers on barSpan harmonic cycle"
```

---

## Phase 4 — `<RomanProgression>` typography primitive (frontend)

One reusable component + stylesheet that renders roman-numeral harmony with semantic case, superscript figures, and real ♭/♯ glyphs. Used by list rows, layer strips, the browse card, and the §G4 keyboard overlay.

### Task 4.1: `parseRoman` — split a numeral into { accidental, numeral, quality, figure }

**Files:**
- Create: `frontend/src/modules/Piano/components/roman/parseRoman.js`
- Test: `frontend/src/modules/Piano/components/roman/parseRoman.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// parseRoman.test.js
import { describe, it, expect } from 'vitest';
import { parseRoman } from './parseRoman.js';

describe('parseRoman', () => {
  it('splits accidental, numeral, quality and figure', () => {
    expect(parseRoman('bVII')).toEqual({ accidental: '♭', numeral: 'VII', quality: 'major', figure: '', isMinor: false });
    expect(parseRoman('ii')).toEqual({ accidental: '', numeral: 'ii', quality: 'minor', figure: '', isMinor: true });
    expect(parseRoman('vii°')).toEqual({ accidental: '', numeral: 'vii', quality: 'dim', figure: '', isMinor: true });
    expect(parseRoman('V7')).toEqual({ accidental: '', numeral: 'V', quality: 'major', figure: '7', isMinor: false });
    expect(parseRoman('imaj7')).toEqual({ accidental: '', numeral: 'i', quality: 'minor', figure: 'maj7', isMinor: true });
  });
  it('renders # as ♯ and returns a placeholder for junk', () => {
    expect(parseRoman('#IV').accidental).toBe('♯');
    expect(parseRoman('?')).toEqual({ accidental: '', numeral: '·', quality: 'unknown', figure: '', isMinor: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/components/roman/parseRoman.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
// frontend/src/modules/Piano/components/roman/parseRoman.js
// Split a roman-numeral chord token into typographic parts. Input uses the
// project's convention (case = quality, ° dim, + aug, b/# accidental prefix,
// trailing figure = extension/inversion). Pure.
export function parseRoman(token) {
  if (!token || token === '?') return { accidental: '', numeral: '·', quality: 'unknown', figure: '', isMinor: false };
  const m = String(token).match(/^([b#]?)([iIvV]+)(°|\+)?(.*)$/);
  if (!m) return { accidental: '', numeral: '·', quality: 'unknown', figure: '', isMinor: false };
  const [, acc, num, symbol, rest] = m;
  const isMinor = num === num.toLowerCase();
  let quality = isMinor ? 'minor' : 'major';
  if (symbol === '°') quality = 'dim';
  else if (symbol === '+') quality = 'aug';
  const accidental = acc === 'b' ? '♭' : acc === '#' ? '♯' : '';
  return { accidental, numeral: num, quality, figure: (rest || '').trim(), isMinor };
}

export default parseRoman;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/components/roman/parseRoman.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/components/roman/parseRoman.js frontend/src/modules/Piano/components/roman/parseRoman.test.js
git commit -m "feat(piano): parseRoman — split a numeral into typographic parts"
```

### Task 4.2: `<RomanChord>` + `<RomanProgression>` components + SCSS

**Files:**
- Create: `frontend/src/modules/Piano/components/roman/RomanProgression.jsx`
- Create: `frontend/src/modules/Piano/components/roman/RomanProgression.scss`
- Test: `frontend/src/modules/Piano/components/roman/RomanProgression.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// RomanProgression.test.jsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RomanProgression, RomanChord } from './RomanProgression.jsx';

describe('RomanChord', () => {
  it('renders numeral, accidental and figure', () => {
    const { container } = render(<RomanChord token="bVII7" />);
    expect(container.textContent).toContain('♭');
    expect(container.textContent).toContain('VII');
    expect(container.querySelector('sup').textContent).toBe('7');
  });
  it('tags minor quality on the element for styling', () => {
    const { container } = render(<RomanChord token="ii" />);
    expect(container.querySelector('.roman-chord').dataset.quality).toBe('minor');
  });
});

describe('RomanProgression', () => {
  it('renders one chord per token, highlighting the active index', () => {
    const { container } = render(<RomanProgression roman={['I', 'V', 'vi', 'IV']} activeIndex={2} />);
    const chips = container.querySelectorAll('.roman-chord');
    expect(chips.length).toBe(4);
    expect(chips[2].classList.contains('is-active')).toBe(true);
  });
  it('renders nothing for empty input', () => {
    const { container } = render(<RomanProgression roman={[]} />);
    expect(container.querySelector('.roman-progression')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/components/roman/RomanProgression.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the components**

```jsx
// frontend/src/modules/Piano/components/roman/RomanProgression.jsx
import { parseRoman } from './parseRoman.js';
import './RomanProgression.scss';

/** One roman-numeral chord, quality encoded by case + symbol, figure as superscript. */
export function RomanChord({ token, active = false }) {
  const { accidental, numeral, quality, figure } = parseRoman(token);
  return (
    <span className={`roman-chord${active ? ' is-active' : ''}`} data-quality={quality}>
      {accidental && <span className="roman-chord__acc">{accidental}</span>}
      <span className="roman-chord__num">{numeral}</span>
      {figure && <sup className="roman-chord__fig">{figure}</sup>}
    </span>
  );
}

/**
 * A progression rendered as chips (default) or an inline hairline-separated run.
 * @param {{roman:string[], activeIndex?:number, inline?:boolean}} props
 */
export function RomanProgression({ roman = [], activeIndex = -1, inline = false }) {
  if (!roman.length) return null;
  return (
    <span className={`roman-progression${inline ? ' roman-progression--inline' : ''}`}>
      {roman.map((token, i) => (
        <RomanChord key={`${token}-${i}`} token={token} active={i === activeIndex} />
      ))}
    </span>
  );
}

export default RomanProgression;
```

```scss
// frontend/src/modules/Piano/components/roman/RomanProgression.scss
// Harmonic-notation type system. The ONE place the kiosk spends a display face:
// roman analysis is the piano's own engraved vernacular. Set --roman-face to a
// serif/engraving stack; fall back to a system serif so tests/CI don't depend on
// a web font.
.roman-progression {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
  font-family: var(--roman-face, 'Georgia', 'Times New Roman', serif);
  font-variant-numeric: tabular-nums;
  line-height: 1;

  &--inline { gap: 0; }
  &--inline .roman-chord + .roman-chord::before {
    content: '·'; margin: 0 0.35rem; color: #667; font-family: system-ui, sans-serif;
  }
}

.roman-chord {
  display: inline-flex;
  align-items: baseline;
  padding: 0.12rem 0.4rem;
  border-radius: 6px;
  color: #e8e8f2;
  letter-spacing: 0.01em;

  // Chip presentation (default). Inline variant drops the box.
  .roman-progression:not(.roman-progression--inline) & {
    background: color-mix(in srgb, var(--piano-surface, #16161f) 100%, transparent);
    border: 1px solid var(--piano-border, #2c2c3a);
  }

  &__acc { font-size: 0.72em; opacity: 0.7; margin-right: 0.05em; }
  &__num { font-weight: 600; }
  &__fig { font-size: 0.6em; font-weight: 500; }

  // Quality via colour restraint: minor slightly cooler, dominant the one accent.
  &[data-quality='minor'] { color: #cdd0e6; }
  &[data-quality='dim']   { color: #b7c1d6; }
  &[data-quality='aug']   { color: #e6cdd0; }

  &.is-active {
    background: var(--piano-accent, #2ec46f);
    color: var(--piano-accent-ink, #06210f);
    border-color: var(--piano-accent, #2ec46f);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/components/roman/RomanProgression.test.jsx`
Expected: PASS (4 tests). If `@testing-library/react` is not present, use the same jsdom render approach as `Producer.test.jsx` (check its imports) and mirror that harness.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/components/roman/
git commit -m "feat(piano): RomanProgression typography primitive + type system"
```

---

## Phase 5 — Producer UX rework (frontend)

Consumes Phases 0–4 plus `modules/MusicNotation/`. Each task is a focused change to `Producer.jsx` / `useLoopTransport.js` / `PianoKeyboard.jsx` and their styles.

### Task 5.1: Remove the dead audio-kit CSS and give the keyboard footer an explicit height (§F1)

**Files:**
- Modify: `frontend/src/Apps/PianoApp.scss:1854-1901` (delete the stale `.piano-producer-mode` / `.piano-pad` / `@keyframes piano-producer-spin` block)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.scss`

- [ ] **Step 1: Verify the block is dead**

Run: `grep -rn "piano-pad\|piano-producer-spin\|__platter\|__spindle" frontend/src --include=*.jsx`
Expected: no `.jsx` references (the new `Producer.jsx` uses none of these). If any appear, stop and reconcile before deleting.

- [ ] **Step 2: Delete the stale global block**

Remove `frontend/src/Apps/PianoApp.scss` lines `1854-1901` (the entire second `.piano-producer-mode { … }`, `.piano-pad { … }`, and `@keyframes piano-producer-spin`).

- [ ] **Step 3: Give the new module its own footer height** (it was borrowing `9rem` from the deleted block)

In `Producer.scss`, replace the `&__keys` rule:

```scss
  &__keys {
    flex: 0 0 auto;
    width: 100%;
    background: var(--piano-surface-2, #14141b);
    .piano-keyboard { height: 9rem; }
  }
```

- [ ] **Step 4: Build to verify no SCSS breakage**

Run: `cd frontend && npx vite build 2>&1 | tail -5`
Expected: build succeeds; no `undefined variable` errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/Apps/PianoApp.scss frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.scss
git commit -m "fix(piano): remove dead audio-kit Producer CSS; own keyboard footer height"
```

### Task 5.2: Move Producer's palette onto the kiosk design tokens (§D2)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.scss`

- [ ] **Step 1: Find the token names actually defined**

Run: `grep -nE "--piano-(accent|surface|surface-2|border|fg|muted|accent-ink)" frontend/src/Apps/PianoApp.scss | head`
Confirm the real token names (e.g. `--piano-accent`, `--piano-surface`, `--piano-border`, `--piano-fg`, `--piano-muted`).

- [ ] **Step 2: Replace hardcoded hex with tokens**

In `Producer.scss`, swap the ad-hoc values for tokens: greens (`#3a7`, `#8fe`, `#5b8`, `#243`, `#cfe`) → `var(--piano-accent)` / `var(--piano-accent-ink)`; text `#e8e8ee`/`#eef` → `var(--piano-fg)`; secondary `#aab`/`#99a`/`#8ad` → `var(--piano-muted)`; surfaces `#14141b`/`#15151d`/`#16161e` → `var(--piano-surface)` / `var(--piano-surface-2)`; borders `#334`/`#2a2a36`/`#3a3a48` → `var(--piano-border)`. Keep the layout rules unchanged.

- [ ] **Step 3: Build**

Run: `cd frontend && npx vite build 2>&1 | tail -5`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.scss
git commit -m "refactor(piano): Producer palette onto kiosk design tokens"
```

### Task 5.3: Replace slug labels with title + `<RomanProgression>` and add `barSpan` to transport layers (§D3, §D3.1, §H3)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.test.jsx`

- [ ] **Step 1: Add a failing test** (asserting the slug is no longer the label and roman renders)

```jsx
// extend Producer.test.jsx — follow its existing mock/render setup.
// After the library loads with an entry { slug:'am-f-g-am', title:'Am F · G Am',
// roman:['iii','I','II','iii'], type:'chord-progression', signature:'iii-I-II-iii' },
// the browse row shows the title, not the raw slug, and renders roman chips.
it('labels a loop by title + roman, not the slug', async () => {
  // …render Producer with a mocked useLoopLibrary returning the entry above…
  expect(screen.queryByText('am-f-g-am')).toBeNull();
  expect(screen.getByText('Am F · G Am')).toBeTruthy();
  expect(document.querySelector('.roman-progression')).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.test.jsx`
Expected: FAIL (slug still shown, no `.roman-progression`).

- [ ] **Step 3: Implement**

In `Producer.jsx`:
- Import: `import { RomanProgression } from '../../../components/roman/RomanProgression.jsx';`
- Delete the `summaryOf`, `keyName`, `NOTE_NAMES` helpers (lines ~20-29) — identity now comes from `entry.title` + `entry.roman`.
- Replace the browse/candidate/layer row bodies so the primary label is `e.title || e.slug` and the musical line is `<RomanProgression roman={e.roman || []} inline />` (fall back to nothing when `roman` is empty — never echo the slug). Example browse row:

```jsx
<button type="button" className="piano-loop" onClick={() => pickBase(e)}>
  <span className="piano-loop__name">{e.title || e.slug}</span>
  {e.roman?.length ? <RomanProgression roman={e.roman} inline /> : null}
  {e.mood && <span className="piano-loop__tag">{e.mood}</span>}
</button>
```

- In `transportLayers` (lines ~54-59) pass `barSpan` through so Phase 3 aligns cycles:

```jsx
const transportLayers = useMemo(
  () => layers.filter((l) => l.notes).map((l) => ({
    notes: l.notes.notes, ppq: l.notes.ppq, barSpan: l.entry.barSpan,
    transpose: keyShift, muted: !!muted[l.id],
  })),
  [layers, keyShift, muted],
);
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Producer/
git commit -m "feat(piano): Producer labels by title + roman notation; barSpan to transport"
```

### Task 5.4: Gate candidate suggestions on stackability and show the "same progression" reason (§H1)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.jsx`

- [ ] **Step 1: Add failing test** — a different-signature candidate must not appear in suggestions.

```jsx
it('omits harmonically-incompatible candidates from suggestions', async () => {
  // base signature iii-I-II-iii; candidate m2 has signature ii-V-I → excluded.
  // …render, pick base, assert m2's title is absent from the "Add a layer" list…
  expect(screen.queryByText('Different Progression Loop')).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.test.jsx`
Expected: FAIL (candidate shown).

- [ ] **Step 3: Implement** — pass `onlyStackable` to the ranker.

In `Producer.jsx`, update the `candidates` memo:

```jsx
const candidates = useMemo(
  () => (base
    ? lib.rankFor(base, { ...(role ? { role } : {}), onlyStackable: true })
        .filter((r) => !layers.some((l) => l.id === r.entry.path)).slice(0, 30)
    : []),
  [base, lib, role, layers],
);
```

(`useLoopLibrary.rankFor` already forwards `opts` to `rankLayerCandidates`; confirm and, if it drops extra keys, widen it to pass the whole `opts` object.)

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.jsx
git commit -m "feat(piano): Producer suggests only harmonically-stackable layers"
```

### Task 5.5: Real key (detectKey) + musical transpose, and a tempo control (§C1, §C2)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.scss`

- [ ] **Step 1: Add failing test** — the deck shows the detected key and an editable BPM.

```jsx
it('shows the detected key and an editable tempo, defaulting to base bpm', async () => {
  // base bpm 100, notes in C major → deck shows "Key C major" and "100" in a tempo control
  expect(screen.getByLabelText(/tempo/i)).toBeTruthy();
  expect(screen.getByText(/Key .*C/)).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `Producer.jsx`:
- Import: `import { detectKey } from '../../../../MusicNotation/index.js';`
- Add tempo state seeded from the base: `const [bpm, setBpm] = useState(100);` and a `useEffect` that sets it when a base is picked: `useEffect(() => { if (base?.bpm) setBpm(base.bpm); }, [base]);` (remove the old `const bpm = base?.bpm || 100;`).
- Pass `bpm` (the state) to `useLoopTransport`.
- Derive a key label from the base's notes: `const detectedKey = useMemo(() => (base && layers[0]?.notes ? detectKey(layers[0].notes.notes.map((n) => n.midi % 12)) : 'C'), [base, layers]);`
- Replace the deck controls: keep the `−`/`+` key shift but label it with `detectedKey` transposed by `keyShift`; add a tempo stepper (discrete tap targets per the house no-slider rule — `feedback_touch_ui_no_sliders`):

```jsx
<span className="piano-producer-mode__tempo">
  <button type="button" aria-label="tempo down" onClick={() => setBpm((b) => Math.max(40, b - 4))}>−</button>
  <span aria-label="tempo">{bpm} BPM</span>
  <button type="button" aria-label="tempo up" onClick={() => setBpm((b) => Math.min(220, b + 4))}>+</button>
</span>
<span className="piano-producer-mode__key">
  <button type="button" aria-label="key down" onClick={() => setKeyShift((k) => k - 1)}>−</button>
  Key {detectedKey}
  <button type="button" aria-label="key up" onClick={() => setKeyShift((k) => k + 1)}>+</button>
</span>
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Producer/
git commit -m "feat(piano): Producer real detected key + editable tempo control"
```

### Task 5.6: Per-layer Mute + Solo (§C3)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.scss`

- [ ] **Step 1: Add failing test** — soloing one layer mutes the others in the transport input.

```jsx
it('solo isolates a layer (others become muted in the transport)', async () => {
  // with two layers, clicking Solo on layer B → transportLayers has A.muted=true, B.muted=false
  // assert via a spy on useLoopTransport's layers arg, or by the DOM state (A row is-muted)
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `Producer.jsx`:
- Add solo state: `const [soloed, setSoloed] = useState({}); // id -> bool`
- Compute effective mute in `transportLayers`: a layer sounds if it's not muted AND (no layer is soloed OR it is soloed):

```jsx
const anySolo = useMemo(() => Object.values(soloed).some(Boolean), [soloed]);
const transportLayers = useMemo(
  () => layers.filter((l) => l.notes).map((l) => {
    const effectiveMuted = !!muted[l.id] || (anySolo && !soloed[l.id]);
    return { notes: l.notes.notes, ppq: l.notes.ppq, barSpan: l.entry.barSpan, transpose: keyShift, muted: effectiveMuted };
  }),
  [layers, keyShift, muted, soloed, anySolo],
);
```

- Add M/S controls to each layer row (replace the single mute button), with `aria-pressed` and text labels for touch/a11y:

```jsx
<button type="button" className={`piano-layer__m${muted[l.id] ? ' is-on' : ''}`} aria-pressed={!!muted[l.id]} aria-label="mute" onClick={() => setMuted((m) => ({ ...m, [l.id]: !m[l.id] }))}>M</button>
<button type="button" className={`piano-layer__s${soloed[l.id] ? ' is-on' : ''}`} aria-pressed={!!soloed[l.id]} aria-label="solo" onClick={() => setSoloed((s) => ({ ...s, [l.id]: !s[l.id] }))}>S</button>
```

- Style `.piano-layer__m`, `.piano-layer__s` as chunky ~2.4rem tap targets (per §E2), `.is-on` uses `var(--piano-accent)`.

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Producer/
git commit -m "feat(piano): Producer per-layer Mute + Solo"
```

### Task 5.7: Base-swap without destroying the stack + persistent "add from library" (§B1, §B2)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.jsx`

- [ ] **Step 1: Add failing test** — removing the base keeps the other layers and promotes the next.

```jsx
it('removing the base promotes the next layer instead of clearing the stack', async () => {
  // with layers [base, L2, L3], remove base → stack becomes [L2, L3], L2 is the new base
});
it('a "Browse library" affordance is present while a base is set', async () => {
  expect(screen.getByRole('button', { name: /browse library|add from library/i })).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.test.jsx`
Expected: FAIL (removeLayer clears all; no browse affordance).

- [ ] **Step 3: Implement**

In `Producer.jsx`:
- Rewrite `removeLayer` so removing index 0 promotes the next layer to base rather than wiping:

```jsx
const removeLayer = useCallback((id) => {
  setLayers((ls) => {
    const next = ls.filter((l) => l.id !== id);
    setBase(next[0]?.entry ?? null);
    return next;
  });
  setMuted((m) => { const { [id]: _drop, ...rest } = m; return rest; });
  setSoloed((s) => { const { [id]: _drop, ...rest } = s; return rest; });
}, []);
```

- Add a `browsing` state and a "Browse library" button in the stack header so search is reachable with a base set. Change the browse-vs-stack render condition from `!base` to `!base || browsing`, and have `pickBase` (when a base already exists) `addLayer` instead and clear `browsing`:

```jsx
const [browsing, setBrowsing] = useState(false);
const onPickFromBrowse = useCallback(async (e) => {
  if (base) { await addLayer(e); setBrowsing(false); }
  else await pickBase(e);
}, [base, addLayer, pickBase]);
```

Wire the browse list's `onClick` to `onPickFromBrowse`, and add `<button onClick={() => setBrowsing((b) => !b)}>Browse library</button>` in the stack header.

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.jsx
git commit -m "feat(piano): Producer base-swap keeps stack; persistent library browse"
```

### Task 5.8: Per-row "peek" preview (ephemeral transport, doesn't mutate the stack) (§A3)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.jsx`

- [ ] **Step 1: Add failing test** — a preview button plays without adding to `layers`.

```jsx
it('peek previews a loop without adding it to the stack', async () => {
  // click a row's ▶ peek → layers length unchanged; a preview transport becomes active
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `Producer.jsx`:
- Add a preview layer state and a second transport instance:

```jsx
const [previewLayers, setPreviewLayers] = useState([]);
const previewTransport = useLoopTransport({ layers: previewLayers, bpm, pressNote, releaseNote });

const peek = useCallback(async (entry) => {
  const notes = await lib.loadNotes(entry);
  if (!notes) return;
  const baseNotes = layers[0]?.notes;
  const stack = [];
  if (base && baseNotes) stack.push({ notes: baseNotes.notes, ppq: baseNotes.ppq, barSpan: base.barSpan, transpose: keyShift });
  stack.push({ notes: notes.notes, ppq: notes.ppq, barSpan: entry.barSpan, transpose: keyShift });
  setPreviewLayers(stack);
  logger.info('piano.producer.peek', { slug: entry.slug });
}, [lib, layers, base, keyShift, logger]);

// start/stop the preview transport when previewLayers change
useEffect(() => {
  if (previewLayers.length) previewTransport.play();
  return () => previewTransport.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [previewLayers]);
```

- Add a `▶` peek button to each browse/candidate row (separate from the row's add/commit action):

```jsx
<button type="button" className="piano-loop__peek" aria-label={`preview ${e.title || e.slug}`}
  onClick={(ev) => { ev.stopPropagation(); peek(e); }}>▶</button>
```

Ensure the row's main click still commits (`onPickFromBrowse` / `addLayer`) and the peek button `stopPropagation`s so peeking never commits.

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.jsx
git commit -m "feat(piano): Producer per-row peek preview (ephemeral, non-committing)"
```

### Task 5.9: Playhead — expose the loop position and highlight the sounding chord (§A1)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/useLoopTransport.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.jsx`

- [ ] **Step 1: Add failing test** (transport exposes a normalized 0..1 position)

```javascript
// useLoopTransport.test — follow existing hook test style if present; else a smoke render.
// Assert the hook return includes `positionRef` (a ref updated each tick) or a `position` value.
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/useLoopTransport.test.js`
Expected: FAIL (no position exposed).

- [ ] **Step 3: Implement**

In `useLoopTransport.js`:
- Track position in the `tick` loop and expose a `positionRef` (avoid per-frame React state to protect the frame budget — the audit and memory `reference_fitness_ui_freeze_tick_storm` warn against render storms):

```javascript
const positionRef = useRef(0);
// inside tick(), after computing elapsed:
positionRef.current = cycleRef.current.lengthMs ? (elapsed % cycleRef.current.lengthMs) / cycleRef.current.lengthMs : 0;
// return { ..., positionRef };
```

In `Producer.jsx`:
- Render a slim playhead bar under the deck driven by `requestAnimationFrame` reading `transport.positionRef.current` (a local rAF that sets a CSS custom property width, not React state), and pass `activeIndex = Math.floor(position * base.roman.length)` to the base layer's `<RomanProgression>` so the sounding chord chip highlights.

```jsx
// playhead element
<div className="piano-producer-mode__playhead"><div ref={playheadRef} className="piano-producer-mode__playhead-fill" /></div>
```

```jsx
useEffect(() => {
  let raf;
  const paint = () => {
    const p = transport.positionRef?.current ?? 0;
    if (playheadRef.current) playheadRef.current.style.width = `${p * 100}%`;
    setActiveChord(base?.roman?.length ? Math.floor(p * base.roman.length) : -1);
    raf = requestAnimationFrame(paint);
  };
  if (transport.isPlaying) raf = requestAnimationFrame(paint);
  return () => cancelAnimationFrame(raf);
}, [transport.isPlaying, base]);
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/useLoopTransport.test.js frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/useLoopTransport.js frontend/src/modules/Piano/PianoKiosk/modes/Producer/
git commit -m "feat(piano): Producer playhead + sounding-chord highlight"
```

### Task 5.10: Two-color keyboard — distinguish loop-driven notes from the player's hands (§A2, §G2)

**Files:**
- Modify: `frontend/src/modules/Piano/components/PianoKeyboard.jsx`
- Modify: `frontend/src/modules/Piano/components/PianoKeyboard.scss`
- Modify: `frontend/src/modules/Piano/PianoKiosk/useLoopTransport.js` (track which notes the loop is currently sounding)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.jsx`

- [ ] **Step 1: Add failing test** — a key that is loop-driven gets a distinct class.

```jsx
// PianoKeyboard.test.jsx (create if absent, vitest+jsdom)
it('marks loop-driven notes distinctly from user-pressed notes', () => {
  const { container } = render(
    <PianoKeyboard activeNotes={new Map([[60, { velocity: 90 }]])} loopNotes={new Set([64])} startNote={60} endNote={67} />,
  );
  expect(container.querySelector('[data-note="64"]').classList.contains('loop')).toBe(true);
  expect(container.querySelector('[data-note="60"]').classList.contains('active')).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/components/PianoKeyboard.test.jsx`
Expected: FAIL — `loopNotes` prop unsupported.

- [ ] **Step 3: Implement**

- In `useLoopTransport.js`, expose the currently-sounding loop notes via a ref that mirrors `activeRef` (already maintained): `return { ..., loopNotesRef: activeRef };`
- In `PianoKeyboard.jsx`, add an optional `loopNotes` prop (a `Set<number>`), thread an `isLoop` flag into each `PianoKey`, and add `loop` to the key className when `loopNotes.has(note)`:

```jsx
export function PianoKeyboard({ activeNotes = new Map(), loopNotes = null, /* …existing props… */ }) {
  // …in the descriptors.map render:
  isLoop={loopNotes?.has(d.note) ?? false}
```
```jsx
// in PianoKey props + className:
const className = `piano-key ${isWhite ? 'white' : 'black'} ${isActive ? 'active' : ''}`
  + `${isLoop ? ' loop' : ''}` + `${isTarget ? ' target' : ''}` /* …rest unchanged… */;
```

- In `PianoKeyboard.scss`, style `.piano-key.loop` with a distinct hue (e.g. `var(--piano-accent)` for the loop) so the player's own presses (`.active`, existing color) read separately.
- In `Producer.jsx`, pass `loopNotes={loopNotesSet}` to the footer keyboard, where `loopNotesSet` is refreshed from `transport.loopNotesRef` on the same rAF as the playhead (Task 5.9) to avoid a separate timer. Because `loopNotesRef` is a live Set, snapshot it into state at rAF cadence: `setLoopNotes(new Set(transport.loopNotesRef.current))`.

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/components/PianoKeyboard.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/components/PianoKeyboard.jsx frontend/src/modules/Piano/components/PianoKeyboard.scss frontend/src/modules/Piano/PianoKiosk/useLoopTransport.js frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.jsx
git commit -m "feat(piano): two-color keyboard — loop notes vs player hands"
```

### Task 5.11: Roman-numeral chord readout on the keyboard's left hand — a toggle (§G4)

**Files:**
- Modify: `frontend/src/modules/Piano/components/PianoKeyboard.jsx` (add an optional region-label overlay)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.jsx`

- [ ] **Step 1: Add failing test** — with a `handChordLabel` prop, an overlay renders over the left-hand region.

```jsx
it('renders a hand-chord overlay label when provided', () => {
  const { container } = render(
    <PianoKeyboard activeNotes={new Map()} startNote={48} endNote={72} splitNote={60} handChordLabel="vi" />,
  );
  expect(container.querySelector('.piano-keyboard__hand-label').textContent).toContain('vi');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/components/PianoKeyboard.test.jsx`
Expected: FAIL — `handChordLabel` unsupported.

- [ ] **Step 3: Implement**

- In `PianoKeyboard.jsx`, accept `handChordLabel` (a string, already-analyzed roman) and render an absolutely-positioned `.piano-keyboard__hand-label` over the sub-`splitNote` region when present (position it left, above the keys). Render its content with the Phase 4 `<RomanChord>` for consistent typography:

```jsx
import { RomanChord } from '../PianoKiosk/../components/roman/RomanProgression.jsx'; // use the real relative path
// …after the keys map, inside the .piano-keyboard div:
{handChordLabel && (
  <div className="piano-keyboard__hand-label"><RomanChord token={handChordLabel} /></div>
)}
```

- In `Producer.jsx`, add a toggle (default off) and compute the label live from the left-hand `activeNotes` using the existing theory helper + `detectKey`:

```jsx
import { detectChords } from '../../modes/Lessons/theory/theoryEngine.js'; // confirm the real path
import { romanAnalysis, bestTonic } from '@shared-music/romanAnalysis.mjs';

const [showRoman, setShowRoman] = useState(false);
const handLabel = useMemo(() => {
  if (!showRoman || !splitNote) return null;
  const left = [...activeNotes.keys()].filter((n) => n < splitNote);
  if (left.length < 2) return null;
  const detected = detectChords(left); // → chord symbol(s)
  if (!detected?.length) return null;
  const tonic = bestTonic(detected);
  return romanAnalysis(detected, tonic)[0] || null;
}, [showRoman, activeNotes, splitNote]);
```

Add a `Roman` toggle chip near the role chips and pass `handChordLabel={handLabel}` + a `splitNote` to the footer `PianoKeyboard`. (If `detectChords` returns a shape other than chord-symbol strings, adapt the `bestTonic`/`romanAnalysis` inputs to match — verify against `theoryEngine.js` before wiring.)

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/components/PianoKeyboard.test.jsx frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/components/PianoKeyboard.jsx frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.jsx
git commit -m "feat(piano): optional roman-numeral chord readout on left-hand keys"
```

### Task 5.12: Staff-notation thumbnails for melodic loops + first-run guidance + quality floor (§G1, §D4, §E2/E3, §B3)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.scss`

- [ ] **Step 1: Add failing test** — a melodic (no-roman) loop shows a staff, and the empty base state shows guidance.

```jsx
it('shows a staff thumbnail for a melodic loop with no roman', async () => {
  // entry { type:'melody', roman:null } → row renders SvgStaffRenderer output (an svg)
  expect(document.querySelector('.action-staff, svg')).toBeTruthy();
});
it('shows a one-line on-ramp before a base is chosen', async () => {
  expect(screen.getByText(/pick a base loop/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `Producer.jsx`:
- Import: `import { SvgStaffRenderer } from '../../../../MusicNotation/index.js';`
- For rows where `!e.roman?.length` but notes are cheap to show, lazily load notes on row focus/mount and render `<SvgStaffRenderer targetPitches={notePreview} />` in place of the roman line (cap to the first ~8 pitches for a thumbnail). Keep it behind the already-cached `lib.loadNotes` so browsing stays cheap; only render the staff for the base + candidates list, not all 60 browse rows (guard with a small `useState` cache of previews).
- Add a first-run banner above the browse list when `!base`: `<p className="piano-producer-mode__hint">Pick a base loop, then stack layers that fit.</p>`.
- Add `:focus-visible` outlines in `Producer.scss` for `.piano-loop`, `.piano-chip`, `.piano-layer__m/.__s`, transport and tempo/key buttons; ensure the M/S/peek buttons meet ~2.4rem min hit size (§E2). Add `aria-label`s already specified in prior tasks.

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Producer/
git commit -m "feat(piano): staff thumbnails for melodic loops; on-ramp; a11y focus floor"
```

### Task 5.13: Pin the deck + layout (§E1) and full-mode manual verification

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.scss`

- [ ] **Step 1: Pin the transport/deck**

In `Producer.scss`, make `&__deck` (transport + tempo + key + playhead) `position: sticky; top: 0; z-index: 2; background: var(--piano-surface);` so it stays put while the browse/stack/candidates scroll beneath — the deck is the control the user returns to constantly.

- [ ] **Step 2: Build + deploy to the piano tablet**

Run: `cd frontend && npx vite build 2>&1 | tail -3`
Then deploy per `CLAUDE.local.md` (build image, `sudo deploy-daylight` — **only after confirming no active fitness session / no playing video**, per the deploy gate).

- [ ] **Step 3: Reload the piano kiosk** and verify on-device

Reload the piano tablet FKB (per memory `reference_piano_config_two_files` / FKB reload runbook), open `/piano/producer`, and manually confirm: labels show titles + roman chips (no slugs), peek previews without committing, playhead sweeps and the sounding chord highlights, Mute/Solo work, tempo/key edit live, base-swap keeps the stack, the left-hand roman toggle reads out chords, and melodic loops show a staff.

- [ ] **Step 4: Run the whole Producer + engine test set**

Run:
```bash
node --test shared/music/harmonicSignature.test.mjs shared/music/layerMatch.test.mjs shared/music/loopScheduler.test.mjs cli/midi-ingest/harmonicClassify.test.mjs cli/midi-ingest/enrichEntry.test.mjs
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano
```
Expected: all pass. Capture the pass/fail summary line (per memory `feedback_capture_real_test_exit_code`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.scss
git commit -m "feat(piano): pin Producer deck; final layout + on-device verification"
```

---

## Self-Review — spec coverage map

| Audit finding | Task(s) |
|---|---|
| §H1 matcher never compares progressions | 2.1 |
| §H2 scheduler aligns by bars not chords | 3.1 |
| §H3 variable bar coverage → normalized signature | 0.1–0.3, 3.1 |
| §H4 melodies lack roman → run classifiers | 1.1–1.5 |
| §D3 kebab/letters/bpm labels; slug printed twice | 1.4 (title), 5.3 |
| §D3.1 roman typography system | 4.1, 4.2, 5.3 |
| §C2 mislabeled "Key" → detectKey/transpose | 5.5 |
| §C1 tempo read-only | 5.5 |
| §C3 no Solo / no per-layer level | 5.6 |
| §B1 base-lock dead end | 5.7 |
| §B2 destructive base removal | 5.7 |
| §A3 no peek/preview | 5.8 |
| §A1 no visual loop / playhead | 5.9 |
| §A2/§G2 loop vs hands indistinguishable | 5.10 |
| §G1 staff thumbnails | 5.12 |
| §G3 detectKey/diatonicTranspose | 5.5 |
| §G4 roman readout on keyboard (toggle) | 5.11 |
| §F1 dead audio-kit CSS collision | 5.1 |
| §D2 palette off design tokens | 5.2 |
| §D4 first-run guidance | 5.12 |
| §E1 single scroll column / deck scrolls away | 5.13 |
| §E2/E3 sub-target buttons, focus, aria | 5.6, 5.12 |
| §B3 (prior audit) no display face | 4.2 (roman engraving face) |

**Known reconciliation points flagged inline for the implementer** (not placeholders — they require reading a real file to confirm an exact shape): Task 1.4 title-split expectation (`Am F · G Am`), Task 1.5 real variable names in `midi-ingest.mjs`, Task 4.2 render harness (match `Producer.test.jsx`), Task 5.4 `rankFor` opts pass-through, Task 5.11 `detectChords` return shape. Each names the file to check and the decision rule.

---

## Execution note on phases

Phases 0–3 (backend/engine, pure + classifier) and Phase 4 (the typography primitive) have **no runtime dependency on each other's UI** and can be built/verified in isolation (`node --test` / `vitest`) before any deploy. Phase 5 depends on all of them and is the only phase that touches the deployed kiosk — do the deploy gate check before Task 5.13. Phase 1's `--write` step mutates `index.yml` in the data volume; run it once the classifier tests pass, and keep a copy of the pre-write `index.yml` (`cp index.yml index.yml.bak`) so the enrichment is reversible.
