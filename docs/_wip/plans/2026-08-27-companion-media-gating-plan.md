# Companion Media Gating Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make a required companion media impossible to skip — finishing it releases a
finish code that is the answer to a gate row on the OMR worksheet, and a sheet whose gate
row is blank or wrong does not pass however well it scored.

**Architecture:** Three new pure domain modules (code minting, coverage arithmetic, gate-row
decoding) sit under `2_domains/school/`; a new per-code YAML store under `1_adapters/`
holds the household-shared code and its satisfaction; `IssueDocument` mints-or-reuses at
print time and `ResolveCardScan` vetoes at scan time. The frontend gains coverage
reporting, a rate/seek clamp, and the completion card that shows the code. The gate row is
its own item type and never enters the generic OMR path — no leniency exemption, no
question-bank validation.

**Tech Stack:** Node ESM (`.mjs`) backend, React frontend, vitest, YAML persistence via
`#system/utils/FileIO.mjs`.

**Requirements doc:** `docs/_wip/plans/2026-08-27-companion-media-gating-requirements.md` —
read §0 (the 13 decisions) before starting. Decision ids `D1`–`D13` are referenced below.

**Worktree:** this plan is executed in `scratchpad/wt-companion` on branch
`school/companion-media-gating`, branched from `b60422030`.

---

## Orientation for someone new to this codebase

Read these before Task 1. They are short and each one prevents a specific mistake.

| Read | Why |
|---|---|
| `backend/src/2_domains/school/documents/omrForm.mjs` header | Explains that a decoded value is the printed LABEL, not the bubble letter, and that grading policy is deliberately not in that module. |
| `backend/src/1_adapters/persistence/yaml/YamlLessonCompanionStore.mjs` header | Explains why persistence uses `saveYamlToPathAtomic` and why the read-modify-write must be synchronous. Copy this pattern exactly in Task 6. |
| `backend/src/2_domains/school/documents/ambiguityLeniency.mjs` | The rules the gate row must never touch. |
| `backend/src/2_domains/school/mediaCheckpoints.mjs` header | The precedent for a pure gate module with a hand-copied frontend twin. |

### ⚠ The name `companionCode` is ALREADY TAKEN — use `finishCode`

Verified 2026-08-27. `companionCode` is an existing field meaning the **six-digit numeric
access code** printed on the lesson card's Read Along panel. It is live in:

- `backend/src/2_domains/school/questionBankV2.mjs:233,286`
- `backend/src/3_applications/school/usecases/IssueDocument.mjs:570` —
  `companionCode: companion?.accessCode ?? null`
- `backend/src/1_rendering/school/documents/measure.mjs:1006,1018`
- `lessonCardCompanion.render.test.mjs`

**Tasks 7, 8 and 14 touch every one of those files.** Overloading the name would silently
put an A–E letter set where a six-digit number is expected, and the renderer would print
whichever arrived last. Call the A–E value **`finishCode`** everywhere — it matches the
child-facing term in the requirements doc and cannot be confused with the access code.

The two are different things that travel together: the access code OPENS the companion,
the finish code is what finishing it RELEASES.

Note also that `backend/src/2_domains/school/continuationCode.mjs` is a third, unrelated
code concept (6-digit learner-slot packing). Three "codes" now live in this domain; keep
them apart.

### Running tests

Pure domain tests live under `tests/isolated/domain/school/` and use **vitest**:

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs <path/to/test.mjs>
```

Two traps:

1. **Do not use `npm run test:isolated --only=domain`.** It routes vitest files to Jest and
   they fail to load. Run vitest directly, as above.
2. **If you create a NEW directory under `tests/isolated/`, you must register it** in
   `tests/_infrastructure/harnesses/isolated.harness.mjs` in the same commit, or nothing in
   it ever runs. Every task below puts tests in directories that already exist, so this
   should not come up — but check if you deviate.

### Commit style

Conventional prefix, lower case, describing the behaviour rather than the file. Look at
`git log --oneline -20` for the house voice. Commit after every green test.

---

## Phase 1 — Pure domain

### Task 1: Mint and compare finish codes

The code is a set of letters from A–E. All 31 non-empty combinations are mintable (D1),
including single letters and all five.

**Files:**
- Create: `backend/src/2_domains/school/companionCode.mjs`
- Test: `tests/isolated/domain/school/companionCode.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import {
  CODE_LETTERS, ALL_CODES, mintCode, codesMatch, formatCode, parseCode,
} from '#domains/school/companionCode.mjs';

describe('the finish-code alphabet', () => {
  it('offers every non-empty combination of five letters (D1)', () => {
    expect(CODE_LETTERS).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(ALL_CODES).toHaveLength(31);
  });

  it('includes singles and the all-five code, and excludes the empty set', () => {
    expect(ALL_CODES).toContainEqual(['A']);
    expect(ALL_CODES).toContainEqual(['A', 'B', 'C', 'D', 'E']);
    expect(ALL_CODES.every((code) => code.length > 0)).toBe(true);
  });

  it('keeps every code in alphabet order so a stored code has one spelling', () => {
    for (const code of ALL_CODES) {
      expect(code).toEqual([...code].sort());
    }
  });

  it('lists all 31 codes exactly once', () => {
    const spellings = new Set(ALL_CODES.map((code) => code.join('')));
    expect(spellings.size).toBe(31);
  });

  it('is frozen, so a caller cannot reshape the shared alphabet', () => {
    expect(() => { ALL_CODES.push(['A']); }).toThrow();
    expect(() => { ALL_CODES[0] = ['E']; }).toThrow();
    expect(() => { ALL_CODES[0].push('B'); }).toThrow();
    expect(() => { CODE_LETTERS.push('F'); }).toThrow();
    expect(ALL_CODES).toHaveLength(31);
    expect(ALL_CODES[0]).toEqual(['A']);
    expect(CODE_LETTERS).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
});

describe('mintCode', () => {
  it('draws from the full set using the injected rng', () => {
    expect(mintCode({ rng: () => 0 })).toEqual(ALL_CODES[0]);
    expect(mintCode({ rng: () => 0.999999 })).toEqual(ALL_CODES[30]);
  });

  it('can reach every one of the 31 codes (D1)', () => {
    const minted = new Set();
    for (let i = 0; i < ALL_CODES.length; i += 1) {
      minted.add(formatCode(mintCode({ rng: () => (i + 0.5) / ALL_CODES.length })));
    }
    expect(minted.size).toBe(31);
  });

  it('never returns the same array instance twice', () => {
    const a = mintCode({ rng: () => 0 });
    const b = mintCode({ rng: () => 0 });
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('refuses an rng outside [0, 1) instead of silently minting ABCDE', () => {
    expect(() => mintCode({ rng: () => 1 })).toThrow(/\[0, 1\)/);
    expect(() => mintCode({ rng: () => 17 })).toThrow(/\[0, 1\)/);
    expect(() => mintCode({ rng: () => -0.5 })).toThrow(/\[0, 1\)/);
    expect(() => mintCode({ rng: () => NaN })).toThrow(/\[0, 1\)/);
  });
});

describe('codesMatch', () => {
  it('is exact set equality, order- and duplicate-insensitive', () => {
    expect(codesMatch(['A', 'C'], ['C', 'A'])).toBe(true);
    expect(codesMatch(['A', 'C', 'A'], ['A', 'C'])).toBe(true);
  });

  it('refuses a subset, a superset, and a disjoint set', () => {
    expect(codesMatch(['A'], ['A', 'C'])).toBe(false);
    expect(codesMatch(['A', 'C', 'E'], ['A', 'C'])).toBe(false);
    expect(codesMatch(['B'], ['A'])).toBe(false);
  });

  it('refuses anything that is not a non-empty array of letters', () => {
    expect(codesMatch([], ['A'])).toBe(false);
    expect(codesMatch(null, ['A'])).toBe(false);
    expect(codesMatch(['a'], ['A'])).toBe(false);
    expect(codesMatch(['F'], ['F'])).toBe(false);
  });

  it('refuses a sparse array, whose holes `every` would otherwise skip', () => {
    expect(codesMatch(new Array(3), new Array(3))).toBe(false);
    expect(codesMatch([, 'A'], ['A'])).toBe(false); // eslint-disable-line no-sparse-arrays
  });
});

describe('formatCode / parseCode', () => {
  it('round-trips through the printed spelling', () => {
    expect(formatCode(['A', 'C', 'E'])).toBe('ACE');
    expect(parseCode('ACE')).toEqual(['A', 'C', 'E']);
  });

  it('normalises case and order on the way in', () => {
    expect(parseCode('eca')).toEqual(['A', 'C', 'E']);
  });

  it('tolerates surrounding whitespace on typed or pasted input', () => {
    expect(parseCode(' ACE ')).toEqual(['A', 'C', 'E']);
    expect(parseCode('ACE\n')).toEqual(['A', 'C', 'E']);
    expect(parseCode('   ')).toBeNull();
  });

  it('answers null for anything unusable', () => {
    expect(parseCode('')).toBeNull();
    expect(parseCode('ABF')).toBeNull();
    expect(parseCode(null)).toBeNull();
  });

  it('refuses to print a blank gate row for a code it cannot read', () => {
    expect(formatCode(['F'])).toBeNull();
    expect(formatCode(['a', 'c'])).toBeNull();
    expect(formatCode('ACE')).toBeNull();
    expect(formatCode([])).toBeNull();
    expect(formatCode(null)).toBeNull();
  });
});
```

**Step 2: Run it and watch it fail**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/domain/school/companionCode.test.mjs
```

Expected: FAIL — `Failed to resolve import "#domains/school/companionCode.mjs"`.

**Step 3: Write the implementation**

```javascript
/**
 * The finish code: a set of letters from A–E, minted when a required companion's
 * worksheet is issued and answered on the sheet's gate row.
 *
 * ALL 31 NON-EMPTY COMBINATIONS ARE MINTABLE (requirements D1) — singles, pairs,
 * triples, quads, and all five. Only the empty set is excluded, because a blank
 * row is already how the sheet says "not answered" and the gate has to tell a
 * missing code from a wrong one.
 *
 * Two exclusions were considered and rejected. Refusing single letters would have
 * matched `questionBankValidation`'s two-answer minimum for `multi_select` — but
 * the gate row is not a bank item and is not validated there (D2). Refusing the
 * all-five code would have made a fully shotgunned row always wrong — but it is
 * only one outcome in 31, the same odds as any other guess, and §8 of the
 * requirements is explicit that guessing is not the threat model.
 *
 * A code is ALWAYS stored and compared in alphabet order, so one code has exactly
 * one spelling everywhere it is written down.
 *
 * NOTHING UNUSABLE IS EVER RENDERED AS BLANK. `formatCode` answers null, not `''`,
 * for input it cannot read — `''` is the printed spelling of "no code at all", and
 * a worksheet whose gate row printed blank is a gate no child can pass. Callers
 * must treat null as a bug in the caller, not as an empty code.
 *
 * CASE-SENSITIVITY INVARIANT: `parseCode` is case-insensitive and normalises, but
 * `codesMatch` is case-SENSITIVE and compares only canonical upper-case letters —
 * `codesMatch(['a'], ['A'])` is false. Anything arriving from outside this module
 * (an OMR read, a YAML field, a typed lookup) must go through `parseCode` FIRST;
 * feeding raw letters straight to `codesMatch` fails the gate silently.
 *
 * Pure: no clock, no I/O, no randomness of its own — `mintCode` takes an rng.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';

export const CODE_LETTERS = Object.freeze(['A', 'B', 'C', 'D', 'E']);

const LETTER_INDEX = new Map(CODE_LETTERS.map((letter, index) => [letter, index]));

/** Every non-empty subset, ordered by bitmask so the list is stable across runs. */
export const ALL_CODES = Object.freeze(
  Array.from({ length: 2 ** CODE_LETTERS.length - 1 }, (_, i) => {
    const mask = i + 1;
    return Object.freeze(CODE_LETTERS.filter((_letter, bit) => (mask & (1 << bit)) !== 0));
  }),
);

/**
 * Spread first: `Array.prototype.every` SKIPS holes, so a sparse array would
 * otherwise pass this check without any of its slots being a real letter.
 */
const isCode = (value) => Array.isArray(value)
  && value.length > 0
  && [...value].every((letter) => LETTER_INDEX.has(letter));

/** Alphabet order, duplicates dropped. Returns null for anything unusable. */
const normalise = (value) => {
  if (!isCode(value)) return null;
  return [...new Set(value)].sort((a, b) => LETTER_INDEX.get(a) - LETTER_INDEX.get(b));
};

/**
 * Draws one of the 31 codes.
 *
 * The draw is validated rather than clamped. A clamp is silent exactly where it
 * must not be: `Math.random` can never return negative or >= 1, so clamping only
 * guards cases the contract already excludes — while a seeded PRNG handed in with
 * the common `0..n` integer signature would clamp to `ABCDE` on EVERY call, minting
 * the one shotgun-shaped code forever with no error. Loud on both ends instead.
 *
 * @param {{rng?: () => number}} [opts] - injected so tests are deterministic
 * @returns {string[]} a fresh array, alphabet-ordered
 * @throws {ValidationError} if rng() is not a finite number in [0, 1)
 */
export function mintCode({ rng = Math.random } = {}) {
  const draw = rng();
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) {
    throw new ValidationError('Companion finish-code rng must return a number in [0, 1)', {
      code: 'COMPANION_CODE_RNG_OUT_OF_RANGE', details: { value: draw },
    });
  }
  return [...ALL_CODES[Math.floor(draw * ALL_CODES.length)]];
}

/** Exact set equality. A subset, a superset and a disjoint set are all false. */
export function codesMatch(given, expected) {
  const a = normalise(given);
  const b = normalise(expected);
  if (!a || !b) return false;
  return a.length === b.length && a.every((letter, i) => letter === b[i]);
}

/**
 * The spelling a child reads on the completion card: `['A','C','E']` -> `'ACE'`.
 * Null — never `''` — for input this cannot read, so a bad code refuses to print
 * instead of printing a blank gate row. See the header.
 */
export function formatCode(code) {
  const normalised = normalise(code);
  return normalised ? normalised.join('') : null;
}

/**
 * The inverse. Case-insensitive and whitespace-tolerant (typed and pasted codes
 * routinely carry it); null for anything that is not a real code.
 */
export function parseCode(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  return normalise(trimmed.toUpperCase().split(''));
}

export default { CODE_LETTERS, ALL_CODES, mintCode, codesMatch, formatCode, parseCode };
```

**Step 4: Run the test and watch it pass**

Same command. Expected: PASS, 18 tests.

**Step 5: Commit**

```bash
git add backend/src/2_domains/school/companionCode.mjs tests/isolated/domain/school/companionCode.test.mjs
git commit -m "feat(school): the finish code, all 31 of it"
```

---

### Task 2: Coverage arithmetic

Satisfaction needs ≥95% of the timeline actually played, at normal speed (D8). This is the
only thing that separates a real ending from a stream that died — `clear()` is called for
both (see requirements §16.2b).

**Files:**
- Create: `backend/src/2_domains/school/companionCoverage.mjs`
- Test: `tests/isolated/domain/school/companionCoverage.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import {
  SATISFACTION_THRESHOLD, mergeRanges, coveredSeconds, coverageFraction, isSatisfied,
} from '#domains/school/companionCoverage.mjs';

describe('mergeRanges', () => {
  it('sorts, merges overlaps, and joins ranges that touch', () => {
    expect(mergeRanges([[10, 20], [0, 5], [15, 30]])).toEqual([[0, 5], [10, 30]]);
    expect(mergeRanges([[0, 10], [10, 20]])).toEqual([[0, 20]]);
  });

  it('drops empty, inverted and unusable entries instead of throwing', () => {
    expect(mergeRanges([[5, 5], [10, 4], null, [1, 2], ['a', 3]])).toEqual([[1, 2]]);
    expect(mergeRanges(null)).toEqual([]);
  });

  it('accumulates across calls so coverage can be banked incrementally', () => {
    const first = mergeRanges([[0, 100]]);
    expect(mergeRanges([...first, [90, 200]])).toEqual([[0, 200]]);
  });
});

describe('coverageFraction', () => {
  it('is covered seconds over duration', () => {
    expect(coveredSeconds([[0, 40], [60, 100]])).toBe(80);
    expect(coverageFraction({ ranges: [[0, 80]], duration: 100 })).toBeCloseTo(0.8);
  });

  it('is zero when the duration is unknown, rather than dividing by nothing', () => {
    expect(coverageFraction({ ranges: [[0, 80]], duration: 0 })).toBe(0);
    expect(coverageFraction({ ranges: [[0, 80]], duration: null })).toBe(0);
  });

  it('never exceeds 1 even if a range runs past the reported duration', () => {
    expect(coverageFraction({ ranges: [[0, 120]], duration: 100 })).toBe(1);
  });
});

describe('isSatisfied', () => {
  const duration = 495;

  it('accepts a play that covered the timeline bar its trailing silence', () => {
    expect(SATISFACTION_THRESHOLD).toBe(0.95);
    expect(isSatisfied({ ranges: [[0, 483]], duration, maxRate: 1 })).toBe(true);
  });

  it('refuses a stream that died five seconds in (requirements 16.2b)', () => {
    expect(isSatisfied({ ranges: [[0, 5]], duration, maxRate: 1 })).toBe(false);
  });

  it('refuses full coverage that was played fast', () => {
    expect(isSatisfied({ ranges: [[0, 495]], duration, maxRate: 1.5 })).toBe(false);
  });

  it('treats a missing rate as normal speed, and a slow rate as fine', () => {
    expect(isSatisfied({ ranges: [[0, 495]], duration })).toBe(true);
    expect(isSatisfied({ ranges: [[0, 495]], duration, maxRate: 0.75 })).toBe(true);
  });

  it('refuses an unknown duration rather than passing on no evidence', () => {
    expect(isSatisfied({ ranges: [[0, 495]], duration: 0 })).toBe(false);
  });
});
```

**Step 2: Run it and watch it fail.** Expected: unresolved import.

**Step 3: Write the implementation**

```javascript
/**
 * Did the household actually play this, or did the player just stop?
 *
 * `Player.handleResilienceExhausted` calls the SAME `clear()` callback as a real
 * ending (requirements §16.2b), so "the media element said it ended" proves
 * nothing. The evidence that does prove something is coverage: the union of the
 * ranges the browser reports it actually rendered, banked across reloads.
 *
 * WHY 95% AND NOT 100. Recordings carry trailing silence, and a final progress
 * sample is lost whenever the tab is closed on the last second. A strict 100%
 * strands a child who genuinely listened and leaves them no way to say so. 5% of
 * a forty-minute lecture is two minutes, which is not enough to skip anything a
 * gate cares about.
 *
 * WHY RATE IS HERE. Coverage alone is satisfied by playing at 2x. The rate is
 * the child's, not the file's, so it travels with the coverage report and is
 * checked in the same place.
 *
 * Pure: no clock, no I/O.
 */
export const SATISFACTION_THRESHOLD = 0.95;

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Normalise a bag of `[start, end]` pairs into sorted, non-overlapping ranges.
 * Unusable entries are DROPPED rather than thrown on: this input arrives from a
 * browser across a network, and one malformed pair must not cost a child the
 * coverage they earned.
 *
 * Ranges that merely touch (`[0,10]`, `[10,20]`) are joined — they describe one
 * continuous listen split by a progress report landing between them.
 */
export function mergeRanges(ranges) {
  const usable = (Array.isArray(ranges) ? ranges : [])
    .filter((r) => Array.isArray(r) && isFiniteNumber(r[0]) && isFiniteNumber(r[1]) && r[1] > r[0])
    .map(([start, end]) => [Math.max(0, start), end])
    .sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const [start, end] of usable) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Total seconds covered by the union of the ranges. */
export function coveredSeconds(ranges) {
  return mergeRanges(ranges).reduce((total, [start, end]) => total + (end - start), 0);
}

/** 0..1. Zero when the duration is unknown — never a division by nothing. */
export function coverageFraction({ ranges, duration } = {}) {
  if (!isFiniteNumber(duration) || duration <= 0) return 0;
  return Math.min(1, coveredSeconds(ranges) / duration);
}

/**
 * @param {{ranges: Array<[number, number]>, duration: number, maxRate?: number}} args
 *   `maxRate` is the fastest playback rate observed during the play; absent means
 *   normal speed, because a client that never changed it has nothing to report.
 */
export function isSatisfied({ ranges, duration, maxRate = 1 } = {}) {
  if (isFiniteNumber(maxRate) && maxRate > 1) return false;
  return coverageFraction({ ranges, duration }) >= SATISFACTION_THRESHOLD;
}

export default {
  SATISFACTION_THRESHOLD, mergeRanges, coveredSeconds, coverageFraction, isSatisfied,
};
```

**Step 4: Run and confirm PASS (13 tests).**

**Step 5: Commit**

```bash
git add backend/src/2_domains/school/companionCoverage.mjs tests/isolated/domain/school/companionCoverage.test.mjs
git commit -m "feat(school): coverage is what tells a finished play from a dead stream"
```

---

### Task 3: Let the virtual reader mark a whole set

`VirtualOmrReader` is how every OMR test builds a scanned sheet, and today
`chosen[itemId]` is one choice. The gate row needs several bubbles in one row. Its header
says it encodes the same projection as `omrForm.mjs` in the other direction, so the two
change together.

**Files:**
- Modify: `backend/src/1_adapters/hardware/omr/VirtualOmrReader.mjs` (`scanSheet`, and the
  `chosenBits` helper it calls)
- Test: `tests/isolated/domain/school/documents/omrForm.test.mjs` (add a describe block)

**Step 1: Write the failing test** — append to the existing file:

```javascript
describe('a set-valued row', () => {
  const gateFormMap = {
    formVersion: 'v1',
    marks: ['A', 'B', 'C', 'D', 'E'].map((choice, col) => ({
      itemId: 'gate', choice, label: choice, selection: 'set',
      xPt: 100 + col * 20, yPt: 100, rPt: 5, page: 1,
    })),
  };

  it('encodes every letter of a code into one column', () => {
    const reader = new VirtualOmrReader({ readerId: 'test' });
    const sheet = reader.scanSheet({ formMap: gateFormMap, chosen: { gate: ['A', 'C', 'E'] } });
    // bits 0, 2, 4 -> 0b10101 = 21
    expect(sheet.marks[0]).toBe(21);
  });

  it('still accepts a single string choice', () => {
    const reader = new VirtualOmrReader({ readerId: 'test' });
    const sheet = reader.scanSheet({ formMap: gateFormMap, chosen: { gate: 'B' } });
    expect(sheet.marks[0]).toBe(2);
  });
});
```

**Step 2: Run it.** Expected: FAIL — the array is not recognised as a choice and
`scanSheet` either throws `unknown OMR item` or produces `0`.

**Step 3: Implement.** In `VirtualOmrReader.mjs`, make the bit selection accept an array.
Find `chosenBits(row, itemId, chosen[itemId])` and change the helper so a `string[]` maps
to every matching bit while a bare string keeps today's behaviour. Keep the existing
"unknown choice" error for a letter the row does not print.

**Step 4: Run and confirm PASS.**

**Step 5: Commit**

```bash
git add backend/src/1_adapters/hardware/omr/VirtualOmrReader.mjs tests/isolated/domain/school/documents/omrForm.test.mjs
git commit -m "test(omr): the virtual reader can fill a whole row"
```

---

### Task 4: Decode the gate row as a set

**This is the core change (D2).** `decodeOmrSheet` currently classifies *any* row with two
or more hits as `ambiguous`, with no branch for item type. A mark carrying
`selection: 'set'` reports the full set instead, and never lands in `ambiguous`.

**Files:**
- Modify: `backend/src/2_domains/school/documents/omrForm.mjs` (the `rows.forEach` in
  `decodeOmrSheet`, around line 116; and its module header)
- Test: `tests/isolated/domain/school/documents/omrForm.test.mjs`

**Step 1: Write the failing test** — append:

```javascript
describe('decodeOmrSheet on a set-valued row', () => {
  const gateFormMap = {
    formVersion: 'v1',
    marks: ['A', 'B', 'C', 'D', 'E'].map((choice, col) => ({
      itemId: 'gate', choice, label: choice, selection: 'set',
      xPt: 100 + col * 20, yPt: 100, rPt: 5, page: 1,
    })),
  };
  const decode = (chosen) => decodeOmrSheet({
    formMap: gateFormMap,
    sheet: new VirtualOmrReader({ readerId: 't' }).scanSheet({ formMap: gateFormMap, chosen }),
  });

  it('reports every filled bubble as an array, in printed order', () => {
    const { entries, ambiguous } = decode({ gate: ['E', 'A', 'C'] });
    expect(entries.gate).toEqual(['A', 'C', 'E']);
    expect(ambiguous).toEqual([]);
  });

  it('reports a single filled bubble as a one-entry array, not a bare string', () => {
    expect(decode({ gate: ['B'] }).entries.gate).toEqual(['B']);
  });

  it('reports all five without calling it ambiguous', () => {
    const { entries, ambiguous } = decode({ gate: ['A', 'B', 'C', 'D', 'E'] });
    expect(entries.gate).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(ambiguous).toEqual([]);
  });

  it('still reports an untouched row as blank', () => {
    const { entries, blank } = decodeOmrSheet({
      formMap: gateFormMap,
      sheet: { marks: [0] },
    });
    expect(entries.gate).toBeUndefined();
    expect(blank).toEqual(['gate']);
  });

  it('leaves ordinary single-choice rows exactly as they were', () => {
    const ordinary = {
      formVersion: 'v1',
      marks: ['A', 'B'].map((choice, col) => ({
        itemId: 'q1', choice, label: choice, xPt: 100 + col * 20, yPt: 100, page: 1,
      })),
    };
    expect(decodeOmrSheet({ formMap: ordinary, sheet: { marks: [0b11] } }).ambiguous).toEqual(['q1']);
    expect(decodeOmrSheet({ formMap: ordinary, sheet: { marks: [0b01] } }).entries.q1).toBe('A');
  });
});
```

That last assertion is the guard that matters: the change must not alter behaviour for any
row that is not a gate row.

**Step 2: Run it.** Expected: FAIL — `entries.gate` is `undefined` and `ambiguous` is
`['gate']`.

**Step 3: Implement.** In the `items.forEach` body:

```javascript
      const hits = row.choices.filter((c) => c.itemId === itemId && (mask & (1 << c.bit)) !== 0);
      // A SET-VALUED row reports every hit (requirements D2). It is the finish-code
      // gate: several bubbles in one row is its correct answer, not an eraser and
      // not a guess, so `ambiguous` — which means "the paper cannot say" — would be
      // a lie about a row that says exactly what it means. Set-valued rows are also
      // the reason `ambiguityLeniency` never has to know about this item: it grades
      // from `entries`, and this branch never reaches it as a two-mark row.
      const isSet = row.choices.some((c) => c.itemId === itemId && c.selection === 'set');
      if (hits.length === 0) blank.push(itemId);
      else if (isSet) entries[itemId] = hits.map((c) => c.label ?? c.choice);
      else if (hits.length > 1) ambiguous.push(itemId);
      else entries[itemId] = hits[0].label ?? hits[0].choice;
```

`projectFormMap` must also carry `selection` through onto each projected choice, next to
`label`. Add it there.

Update the module header: `entries` values are a string, **or an array of strings for a
set-valued row**.

**Step 4: Run the whole file and confirm every earlier test still passes.**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/domain/school/documents/omrForm.test.mjs
```

**Step 5: Commit**

```bash
git add backend/src/2_domains/school/documents/omrForm.mjs tests/isolated/domain/school/documents/omrForm.test.mjs
git commit -m "feat(omr): a set-valued row says what it means instead of ambiguous"
```

---

### Task 5: Grade the gate row

**Files:**
- Modify: `backend/src/2_domains/school/grading.mjs` (`givenShapeError`, `gradeAnswer`)
- Test: `tests/isolated/domain/school/grading.test.mjs`

Add item type `companion_code`. It grades by `codesMatch` from Task 1 and takes its
expected value from `item.code`, not from a question bank.

**Step 1: Write the failing test**

```javascript
describe('companion_code', () => {
  const item = { type: 'companion_code', code: ['A', 'C', 'E'] };

  it('is correct only on an exact set match', () => {
    expect(gradeAnswer(item, ['E', 'C', 'A']).correct).toBe(true);
    expect(gradeAnswer(item, ['A', 'C']).correct).toBe(false);
    expect(gradeAnswer(item, ['A', 'C', 'E', 'D']).correct).toBe(false);
  });

  it('is correct for a single-letter code — no two-answer minimum applies (D1)', () => {
    expect(gradeAnswer({ type: 'companion_code', code: ['B'] }, ['B']).correct).toBe(true);
  });

  it('reports the expected code so a receipt can name it', () => {
    expect(gradeAnswer(item, ['A']).expected).toEqual(['A', 'C', 'E']);
  });

  it('requires a non-empty array of letters', () => {
    expect(givenShapeError(item, [])).toMatch(/non-empty/);
    expect(givenShapeError(item, 'ACE')).toMatch(/array/);
    expect(givenShapeError(item, ['A'])).toBeNull();
  });
});
```

**Step 2: Run it and watch it fail** — `gradeAnswer: unrecognised item.type`.

**Step 3: Implement.** Add a branch to each function, importing `codesMatch` from
`./companionCode.mjs`. Comment it with why it is not `multi_select`: the answer comes off
the companion code record, the item is never bank-validated, and it must not inherit
`multi_select`'s two-answer minimum.

**Step 4: Run and confirm PASS.**

**Step 5: Commit**

```bash
git add backend/src/2_domains/school/grading.mjs tests/isolated/domain/school/grading.test.mjs
git commit -m "feat(school): companion_code grades by exact set, off its own key"
```

---

## Phase 2 — Persistence

### Task 6: The companion code store

One file per code (D5), keyed `(household, lesson, day)` (D3). Copy
`YamlLessonCompanionStore`'s persistence discipline exactly — its header documents the
2026-08-26 corruption that a bare async read-modify-write caused.

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlCompanionCodeStore.mjs`
- Test: `backend/src/1_adapters/persistence/yaml/YamlCompanionCodeStore.test.mjs`
  (co-located, matching `YamlLessonCompanionStore.test.mjs` — read that file first and
  mirror its fixture and temp-directory setup)

**Required API:**

| Method | Contract |
|---|---|
| `keyFor({ householdId, lessonId, lessonDay })` | Deterministic id, `cmc_<hash>`. Same inputs → same id, always. |
| `get(id)` | Record or null. Unreadable logs `school.companion-code.unreadable` at **error** and answers null — copy the reasoning in `YamlLessonCompanionStore.#read`. |
| `findOrCreate({ key, create })` | Returns the existing record, or writes `create()` and returns that. This is D3's "whoever prints first mints it" and it must be safe when two issues race. |
| `update(id, mutate)` | Synchronous read-modify-write via `saveYamlToPathAtomic`. Not async. |

**Tests to write (one per behaviour, red then green):**

1. `keyFor` is stable across calls and differs when any of the three parts differ.
2. `findOrCreate` writes when absent and returns the created record.
3. `findOrCreate` called twice returns the FIRST record — the second `create()` is never
   used. This is the sibling-race test and it is the point of the whole store.
4. `update` applies the mutation and survives a read-back.
5. An unreadable file answers null and logs at error.
6. An id that does not match the safe pattern throws rather than touching the filesystem.

**Commit:** `feat(school): one record per companion code, and the first print wins`

---

## Phase 3 — Application wiring

### Task 7: Mint or reuse at issue time

**Files:**
- Modify: `backend/src/3_applications/school/usecases/IssueDocument.mjs` — `#prepareCompanion`
  (line ~693), which already mints the six-digit access code before rendering so the
  retained PDF owns it. The finish code must be resolved in the same place and for the same
  reason: the renderer needs it to print the gate row.
- Test: `backend/src/3_applications/school/usecases/IssueDocument.companion.test.mjs` (new;
  mirror the setup in `IssueDocument.replacement.test.mjs`)

**Behaviour:**

1. `participation: optional` — unchanged, no code, no gate row. Assert this explicitly; it
   is the regression that would break every existing worksheet.
2. `participation: required` — resolve the code via
   `companionCodes.findOrCreate({ key: keyFor({ householdId, lessonId, lessonDay }), create })`,
   store `codeRef` on the companion record, and pass the code to the renderer.
3. Two issues for the same `(household, lesson, day)` produce the **same** code (D3/D4).
4. Two issues for different lessons produce different codes.
5. `required` with no document → throws / refuses (D12).
6. D13: for a required companion, the access code's expiry is the record's 7-day window,
   not the study-day boundary. Assert the two dates are equal for `required` and still
   differ for `optional`.

**Commit:** `feat(school): a required companion binds its code before the paper prints`

---

### Task 8: The gate row on the rendered document

**Files:**
- Modify: the document renderer's OMR row emission and its form-map writer, so the gate row
  emits five bubbles with `label: 'A'…'E'` and `selection: 'set'`. Start from
  `backend/src/2_domains/school/documents/documentV2.mjs:356` and
  `backend/src/2_domains/school/documents/allocation.mjs:19` (`ROW_MAPPABLE_TYPES`) — add
  `companion_code` there.
- Test: extend the golden/form-map tests under `tests/isolated/rendering/school/`

**Watch for:** the decoder reports `mark.label`, so the labels must be the letters
themselves (requirements §14.1). A gate row whose labels are the choice *text* will score
zero on a perfectly filled sheet.

**Commit:** `feat(school): the gate row prints its five letters`

---

### Task 9: Coverage in, verdict out

**Files:**
- Modify: `backend/src/3_applications/school/companions/LessonCompanionHandlers.mjs` —
  `recordProgress` accepts `playedRanges` and `maxRate`, banks them via `mergeRanges`,
  and evaluates `isSatisfied`.
- Modify: `backend/src/3_applications/school/usecases/RecordLessonCompanionProgress.mjs` —
  return the verdict instead of `{ok, tracked}`.
- Test: `tests/isolated/domain/school/` — new test file for the handler, driven through
  a fake companion store.

**The response shape the card needs:**

```javascript
{ ok: true, tracked: true, satisfied: false, code: null, remainingParts: 3 }
{ ok: true, tracked: true, satisfied: true,  code: ['A','C','E'], remainingParts: 0 }
```

**Behaviour:**

1. Coverage banks across calls — two half-plays of the same part add up (this is the
   reload case, requirements §17.1).
2. `completed: true` with 1% coverage does **not** satisfy. This is the dead-stream test
   and it is the most important assertion in the task.
3. `maxRate > 1` does not satisfy.
4. `require_parts: 1` — the first part to reach the threshold satisfies the whole
   companion and records `satisfiedVia` as that part's contentId (D7).
5. `require_parts: all` — every part must clear it.
6. A companion already satisfied by a sibling returns `satisfied: true` and the code on the
   very first call, with no playback at all (D4).
7. `optional` participation never returns a code.

**Commit:** `feat(school): the companion answers with a verdict, not an acknowledgement`

---

### Task 10: The scan-time veto

> **Read this whole block before touching anything.** Two agents investigated this and
> reached opposite conclusions; the file below is the verified answer. There are TWO scan
> paths and they are easy to confuse.
>
> **`ResolveCardScan.mjs` is the grading path, and it IS this task's file.** It calls
> `gradeAnswer` at lines 361, 384 and 391. It does not call `decodeOmrSheet` — it receives
> `{testId, answers}` from the card-scan path, where `answers` is documented at line 6 as
> `{row: 'A'|['A','E']}`, already contemplating an array per row. A grep for "does it
> consume `decoded.entries`" comes back empty and looks conclusive. It is not.
>
> **`SubmitPaperWork.fromOmrSheet` (`SubmitPaperWork.mjs:216`) is the OTHER path** — the
> only `decodeOmrSheet` caller in the codebase. It hands `decoded.entries/ambiguous/blank`
> into its own `execute`, which routes to a review queue. It contains **no** `gradeAnswer`
> call and **no** item-type switch. It does not grade, so the veto does not live there.
>
> ### The trap, at `ResolveCardScan.mjs:375`
>
> `gradeRow` has an **unconditional** guard immediately after the `multi_select` branch:
>
> ```javascript
> if (Array.isArray(given)) {
>   return { status: 'ambiguous', given, points, earned: 0 };
> }
> ```
>
> A decoded gate row arrives as an array. Without a `companion_code` branch placed
> **before** this guard, every gate row grades `ambiguous` and never reaches the
> `gradeAnswer` added in Task 5 — the gate would fail silently, on every sheet, and look
> like a scanning fault. Put the branch above line 375.
>
> ### Second hazard, for Task 8 rather than this task
>
> `SubmitPaperWork.execute` iterates `expectedItems` — `questionItemIds(document)`, falling
> back to `roster ?? bank.items` — and reads `entries?.[itemId]`. A gate entry not in
> `expectedItems` is never visited, which is why the gate row is inert on that path today.
> If the gate row ever lands inside `questionItemIds` it WOULD be visited, miss
> `bankItemIds`, and be enqueued to the review queue as `free_response` with `given` set to
> an array — a shape that path has never seen. Task 8 must keep the gate row out of
> `questionItemIds`.
>
> Also established: `entries[gate]` is never an empty array. Zero hits route to `blank`
> before the set branch, so a consumer may treat "present" as "at least one letter".

**Files:**
- Modify: `backend/src/3_applications/school/documents/ResolveCardScan.mjs` — the
  `companion_code` branch goes in `gradeRow`, ABOVE the `Array.isArray(given)` guard at :375
- Test: `tests/unit/applications/school/` — new file beside `resolveCardScanLeniency.test.mjs`

**Behaviour:**

1. Gate row correct + score above threshold → passed.
2. Gate row correct + score below threshold → ordinary remediation, companion irrelevant.
3. Gate row **blank** + perfect score → **not passed**, with a reason naming the companion.
4. Gate row **wrong** + perfect score → **not passed**.
5. The gate row is **not** in the denominator (D9): a 10-question sheet with a gate row
   still reports `totalPoints` for 10.
6. `applyLeniency` never sees the gate row. Assert the leniency budget is unchanged by its
   presence — a sheet of 10 questions plus a gate row has the same cap as one of 10.

**Commit:** `feat(school): a blank finish code fails a perfect sheet`

---

### Task 11: Repair by re-scan

D10 — re-scanning re-reads only the gate row; the score does not move.

**Files:**
- Modify: `ResolveCardScan.mjs` / the scan recorder, wherever a second submission for a
  known card is resolved.
- Test: alongside Task 10's.

**Behaviour:**

1. A second scan of a card whose gate failed updates the gate verdict only.
2. The recorded score from the first scan is untouched even when the second sheet's
   question rows decode differently. (This is the exploit guard: the receipt tells the
   child which questions were wrong, and eraser leniency would credit a two-mark row.)
3. Once the gate row holds all five letters and is still wrong, the sheet is exhausted —
   surface that as its own reason so the receipt can say "ask for a new sheet".

**Commit:** `fix(school): a re-scan repairs the gate, never the score`

---

## Phase 4 — Frontend

### Task 12: Report coverage from the player

**Files:**
- Modify: `frontend/src/modules/Player/ReadalongPlaylistPlayer.jsx` — `receiveProgress`
  and `write`
- Test: `frontend/src/modules/Player/ReadalongPlaylistPlayer.test.jsx`

Read the media element's `played` TimeRanges and send them with every progress write.
**Bank incrementally** — the Player remounts on resilience and `played` resets with the
element, so the ranges from before a remount are gone unless they were already sent.

**Commit:** `feat(player): progress carries what was actually played`

---

### Task 13: Clamp rate and seeking on a required companion

**Files:**
- Modify: `frontend/src/lib/Player/gate/gateIds.js` — add `COMPANION: 'companion'`. Note
  its test asserts against the shipped wire values; read `gateIds.test.js` first.
- Modify: `ReadalongPlaylistPlayer.jsx` — hide the speed control, clamp seek to the
  high-water mark, keep rewind free.

The seek ceiling already exists for checkpoints (`useMediaGate`, `seekCeilingFor`). Reuse
that path rather than writing a second clamp.

**Commit:** `feat(player): a required companion cannot be skipped past`

---

### Task 14: The completion card

**Files:**
- Modify: `ReadalongPlaylistPlayer.jsx` — the empty last-part branch in `ended`
- Test: `ReadalongPlaylistPlayer.test.jsx`

**Behaviour:**

1. `ended` **awaits** the progress write and renders from the response (requirements
   §16.2c) — never from the client's own belief that it finished.
2. `satisfied: true` → the card shows the code, large.
3. `satisfied: false` after a resilience-exhausted `clear` → "keep listening", no code.
4. Opening a companion the household already satisfied shows the code immediately, with no
   playback (D4).

**Commit:** `feat(school): finishing the companion shows the code`

---

### Task 15: Teacher code lookup

D11 — reveals the code, never satisfies. Satisfaction stays false and the lookup is
recorded as a teacher action.

**Files:**
- Modify: the teacher panel under `frontend/src/modules/School/teacher/`
- Modify: a read-only use case beside `GetTeacherSession.mjs`

**Commit:** `feat(school): a grown-up can read the code out when the media is broken`

---

## ⚠ Task 12's wire contract — DELTAS, not cumulative `played`

Established 2026-08-28, when Task 9 dropped the persisted `maxRate` in favour of dropping
the ranges of any sample reported at rate > 1. That fix is correct and it removed a
whole-household permanent lockout — but it **moves the anti-fast-forward guarantee from
the server onto a client contract that nothing can enforce**, because a delta and a
cumulative range are indistinguishable on the wire.

**The contract:** each progress report carries the interval played **since the previous
report**, paired with **that window's** playback rate.

**The trap, spelled out because the wrong answer is the obvious one.** The DOM hands you
`mediaEl.played` as *cumulative* TimeRanges, and an earlier draft of this plan said to send
exactly that. Do not. A child plays 0→100s at 2x, then drops to 1x for one second: the
next sample reports `[[0, 101]]` at `rate: 1`, the server sees a normal-speed sample, and
**the entire fast play is banked**. The gate is defeated by one second of honest playback.

**Therefore:** track the previous sample's position, emit only the newly-covered interval,
and carry the maximum rate observed *during that interval*. A seek must break the interval
rather than bridging it — a jump from 10s to 90s is not 80 seconds of listening.

Task 12 must carry an explicit test for this: a fast window followed by a slow window must
bank only the slow window's seconds. It is the single most defeat-able point in the
feature.

## Carry-over fixes — from Task 7's review, apply AFTER Task 8

All of these touch `IssueDocument.mjs`, which Task 8 edits, so they were deferred rather
than dispatched concurrently. None is severe; all were verified by the reviewer.

1. **A blank-but-not-empty `householdId` escapes the refusal envelope.** `IssueDocument.mjs:830`
   guards with `!this.#householdId`, which `'   '` passes. `keyFor` then throws
   ("companion code key requires householdId, lessonId and lessonDay"), which propagates
   uncaught through `asyncHandler` (`4_api/v1/routers/schoolLifecycle.mjs:373`) to a **500**,
   bypassing the `#unavailable` slip the `no-household` branch exists to produce. Unreachable
   in this deployment (`app.mjs:575` can only yield a real string), but the store itself
   trims precisely because of this codebase's standing YAML leading-space gotcha, and the
   use-case guard does not share that defence. Fix: `!this.#householdId?.trim?.()`.

2. **Doubled prefix in one refusal reason.** `:828` sets `missing = 'companion-store-not-configured'`
   and `:837` emits `` `companion-${missing}` `` → `companion-companion-store-not-configured`,
   which becomes the notice id at `:1298`. The other three branches read correctly.

3. **`companionLessonDay(unit, instance.lessonId)` is evaluated twice** — `:855` for the key
   and `:869` for the record body. Pure, so they cannot disagree today, but they must stay
   identical; hoist to one `const lessonDay` so that is structural rather than conventional.
   The `fallback` parameter is also unreachable: `instance.lessonId` IS `unit.unitId`, which
   the third link of the chain already covers.

### Known and accepted, not defects

- **`lessonDay` adds no discriminating power.** Since `lessonId` is a globally unique
  `unitId`, `(householdId, lessonId)` alone already pins one record per lesson per
  household — proven by the reviewer, who built two units in one course with no `module`
  and got two distinct records. What the third component DOES add is sensitivity to
  `unit.module` being re-authored: renaming `w35-aug24` → `w35` mints a fresh code, so a
  sibling printing afterwards replays audio the household already finished. The three-part
  scope is what the design specifies, so this is compliant. Worth knowing if codes ever
  appear to "reset" after a curriculum edit.
- **`requireParts` is pinned at first print** from `companion.payload?.playlist?.parts?.length ?? 1`
  (`:874`). Re-authoring a unit's `reading` later does not update it, so coverage grades
  against the original part count.
- **`required` is honoured only on the bank-instance path.** `#prepareCompanion` is called
  only from `#issueWorksheetInstance` (`:630`); a unit routed through `#issuePrintDocument`
  or `#issueLegacyDocument` gets no companion, no gate, and no refusal. No child is
  stranded (no gate row prints there either), but "never skip a gate an author required" is
  not covered the way "never print a gate a child cannot clear" is.
- **No live content authors `participation:` today**, so the entire required branch is inert
  in production until a unit opts in. The round-trip test in Task 8 is the only thing
  exercising it end to end.

## Definition of done

- [ ] `frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/domain/school/` green.
      **True pre-feature baseline: 46 files / 1610 tests** (at branch point `111716fdc`).
      An earlier note circulated 47 / 1621 as the baseline; that figure already included
      Task 1's own `companionCode.test.mjs` — subtract that one file and its 11 tests and
      you land exactly on 46 / 1610, which is the arithmetic confirming which figure is
      the branch-point one. Count from 46 / 1610 when judging whether a task added or lost
      coverage. Do NOT hard-code a current total here: several tasks land in this one
      directory, so the running count moves as work merges (it was 48 / 1652 partway
      through Phase 1). Only the 46 / 1610 anchor is stable.
- [ ] `npm run test:unit` green
- [ ] `npm run lint --prefix frontend` no worse than the branch-point baseline of
      **9 problems (3 errors, 6 warnings)**. Frontend only — gates Phase 4.
      Notes, all verified 2026-08-27, because two of them cost an agent time already:
      there is **no root `lint` script**; the config is the legacy
      `frontend/.eslintrc.cjs`, NOT a flat `eslint.config.*`, so `npx eslint` from the
      repo root reports "couldn't find an eslint config" and searching for
      `eslint.config.*` finds nothing; and although `33eac3fdf` ("get npm run lint to 0
      problems") IS an ancestor of this branch, the tree has since drifted back to 9.
      Do not claim a clean lint — match or beat 9.
- [ ] `npm run audit:layers` green. This is a **ratchet with a per-rule baseline**, not a
      pass/fail: every rule prints `N (baseline N) ok`. A new domain module must not raise
      any count. Baseline at branch point: `api-no-config 1`, `api-handrolled-500 86`,
      `apps-success-false 47`, `no-userdataservice 93`, `domains-tojson 67`, and
      `no-applications-alias`, `no-deep-relative-layer-cross`, `no-storage-paths` all 0.
- [ ] A worksheet with `participation: optional` behaves exactly as it does today
- [ ] Requirements doc §14 gap list updated to match what was actually built

## Not in this plan

Deferred from requirements §15 and §12: `bonus` participation, per-verse timing, coin
economy, and required companions on renderers other than read-along (`SlideShow` is a stub
with no timeline — under D12 it is refused at publish rather than implemented here).
