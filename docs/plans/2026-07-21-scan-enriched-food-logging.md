# Scan-Enriched Food Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a fridge-mounted QR sheet turn a raw scale weight into a net-weighted, density-classified, auto-accepted nutrition entry — scanned in any order, before or after the weighing.

**Architecture:** A scan-grammar domain service owns the `dl:` / `ct:` / `rs:` vocabulary and is imported by both the scan parser and the PDF sheet generator, so the printed page and the parser can never drift. An immutable `Composition` value object holds `grams` / `density` / `container` slots filled in any order; a `CompositionStore` in the application layer keys those by `scaleId` and owns the rolling window, consuming slots at placement end. Weights reach it through the existing `ScaleNutribotBridge`; scans reach it through `barcodeRelay` under a new `nutriscan` route. When weight **and** density are both present the entry auto-accepts; a bare weight stays pending on today's keyboard.

> **⚠️ Tasks 1-3 are SHIPPED, and their specs below are stale on file paths.** A later DDD
> compliance pass ([`2026-07-21-nutrition-ddd-compliance.md`](./2026-07-21-nutrition-ddd-compliance.md))
> moved the modules and split the buffer. Executing Tasks 1-3 from this document would recreate
> the violations. Where the code actually lives:
>
> | Was specified as | Actually shipped at |
> |---|---|
> | `2_domains/nutrition/ScanVocabulary.mjs` | `2_domains/nutrition/services/ScanVocabularyService.mjs` |
> | `2_domains/nutrition/scanNutrition.mjs` | `2_domains/nutrition/services/ScanNutritionService.mjs` |
> | `2_domains/nutrition/CompositionBuffer.mjs` | `2_domains/nutrition/value-objects/Composition.mjs` **+** `3_applications/nutribot/CompositionStore.mjs` |
>
> Exported function names are unchanged. **Tasks 4-12 are still current** — start there.

**Tech Stack:** Node ESM (`.mjs`), vitest, js-yaml, pdfkit + svg-to-pdfkit, existing `QRCodeRenderer`, Telegram via the nutribot container.

**Design doc:** `docs/plans/2026-07-21-scan-enriched-food-logging-design.md` (rev 2). Read it first — every decision below is justified there.

---

## Before You Start

**Verified facts you must not re-derive (they were checked against the tree at `e877a7ba8`):**

- `BarcodeScanService` is **retired**. `app.mjs` `onScan` dispatches to `triggerDispatchService.handleEvent`.
- `route === 'nutribot'` in `app.mjs` (~line 2353) **already means "this code is a food UPC"** → `LogFoodFromUPC`. Do not reuse it. The new value is `nutriscan`.
- `LogFoodFromScale.mjs:29` and `RetractScaleLog.mjs:18` both gate on `#isUntouched(log)` = `status === 'pending' && metadata.source === 'scale' && metadata.containerId == null && metadata.densityLevel == null`.
- `SelectScaleDensity.mjs` requires `status === 'pending'`, so scan-driven density must run **before** accept.
- Voice transcription is fully wired (`TelegramVoiceTranscriptionService` → `LogFoodFromVoice`). The only gap is `NutribotInputRouter.handleVoice` (line 119) ignoring conversation state.
- `ScaleNutribotBridge.mjs:50` hardcodes `unit: 'g'`, discarding the scale's real unit.
- Test runner is **vitest**. Run a single file with `npx vitest run <path>`.

**Repo state note:** local `main` is 10 commits ahead of `origin/main` and is the most current tree for every file this plan touches. The homeserver's `feat/school-slice-1` is stale relative to `origin/main` for `app.mjs` and the food-scale firmware — do not pull from it. See the sync report in the session that produced this plan.

---

## Task 1: ScanVocabulary — the grammar

**Files:**
- Create: `backend/src/2_domains/nutrition/ScanVocabulary.mjs`
- Test: `tests/unit/domains/nutrition/scanVocabulary.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { parseScan } from '#domains/nutrition/ScanVocabulary.mjs';

describe('parseScan', () => {
  it('parses a density code', () => {
    expect(parseScan('dl:4')).toEqual({ kind: 'density', level: 4 });
  });

  it('parses a container code', () => {
    expect(parseScan('ct:dinner-bowl')).toEqual({ kind: 'container', id: 'dinner-bowl' });
  });

  it('parses the reset code', () => {
    expect(parseScan('rs:clear')).toEqual({ kind: 'reset' });
  });

  it('rejects density levels outside 1-9', () => {
    expect(parseScan('dl:0')).toBeNull();
    expect(parseScan('dl:10')).toBeNull();
    expect(parseScan('dl:x')).toBeNull();
  });

  // THE case that matters: a real product barcode must fall through untouched.
  it('returns null for a UPC', () => {
    expect(parseScan('012000161155')).toBeNull();
    expect(parseScan('4006381333931')).toBeNull();
  });

  // Content QR payloads share the colon namespace (BarcodeCommandMap). Never claim them.
  it('returns null for content grammar', () => {
    expect(parseScan('screen:living-room')).toBeNull();
    expect(parseScan('volume:5')).toBeNull();
  });

  it('returns null for junk and empty input', () => {
    expect(parseScan('')).toBeNull();
    expect(parseScan(null)).toBeNull();
    expect(parseScan('ct:')).toBeNull();
    expect(parseScan('rs:something-else')).toBeNull();
  });

  it('is whitespace tolerant', () => {
    expect(parseScan('  dl:4 ')).toEqual({ kind: 'density', level: 4 });
  });
});

describe('encode helpers', () => {
  it('round-trips through parseScan', () => {
    const { encodeDensity, encodeContainer, RESET_CODE } = require('#domains/nutrition/ScanVocabulary.mjs');
    expect(parseScan(encodeDensity(7))).toEqual({ kind: 'density', level: 7 });
    expect(parseScan(encodeContainer('mug'))).toEqual({ kind: 'container', id: 'mug' });
    expect(parseScan(RESET_CODE)).toEqual({ kind: 'reset' });
  });
});
```

Replace the `require` with a top-level `import { encodeDensity, encodeContainer, RESET_CODE }` — it's written inline above only to show what's needed.

**Step 2: Run it, confirm it fails**

`npx vitest run tests/unit/domains/nutrition/scanVocabulary.test.mjs`
Expected: FAIL — cannot resolve `#domains/nutrition/ScanVocabulary.mjs`.

**Step 3: Implement**

```javascript
// Scan grammar for fridge-sheet QR codes. Imported by BOTH the scan parser and
// the PDF sheet generator so the printed page can never drift from the parser.
//
// Namespace note: content barcodes use a colon grammar too (screen:<id>,
// volume:<n> — see 2_domains/barcode/BarcodeCommandMap.mjs). There is no shared
// registry, so this module claims ONLY the three prefixes below and returns null
// for everything else, letting content dispatch proceed untouched.

const DENSITY_PREFIX = 'dl';
const CONTAINER_PREFIX = 'ct';   // 'rs' not 'ctl' so no prefix is a near-twin of 'ct'
const RESET_PREFIX = 'rs';

export const RESET_CODE = `${RESET_PREFIX}:clear`;
export const MAX_DENSITY_LEVEL = 9;   // must match density_levels in config.example.yml
const CONTAINER_ID_RE = /^[a-z0-9][a-z0-9-]*$/;   // case-SENSITIVE; shared by parse and encode

// The encoders MUST validate. This module exists so the printed page cannot drift
// from the parser, and an id that encodes but does not parse produces a laminated
// QR that can never be read — remedied by a reprint, not a code fix. Throw a
// ValidationError instead. Failing at PDF-generation time is cheap.
export const encodeDensity = (level) => { /* validate 1..MAX_DENSITY_LEVEL, else throw */ };
export const encodeContainer = (id) => { /* validate CONTAINER_ID_RE, else throw */ };

export function parseScan(code) {
  if (typeof code !== 'string') return null;
  const trimmed = code.trim();
  const idx = trimmed.indexOf(':');
  if (idx <= 0) return null;

  const prefix = trimmed.slice(0, idx);
  const rest = trimmed.slice(idx + 1);
  if (prefix === DENSITY_PREFIX) {
    // Shape and range are checked separately so MAX_DENSITY_LEVEL is the single
    // lever: raising it to 10 makes `dl:10` parse with no other edit. The regex
    // admits no leading zero, so `dl:04` stays null.
    if (!DENSITY_LEVEL_RE.test(rest)) return null;
    const level = Number(rest);
    return isDensityLevel(level) ? { kind: 'density', level } : null;
  }
  if (prefix === CONTAINER_PREFIX) {
    if (!CONTAINER_ID_RE.test(rest)) return null;   // no `i` flag — see below
    return { kind: 'container', id: rest };
  }
  if (prefix === RESET_PREFIX) {
    return rest === 'clear' ? { kind: 'reset' } : null;
  }
  return null;
}

```

No `export default` — the nutrition domain has a barrel (`2_domains/nutrition/index.mjs`)
and `coding-standards.md:91-104` calls reaching into domain internals the bad pattern.
Add the four named exports there and import via `#domains/nutrition`.

**Case sensitivity is uniform and deliberate.** `DL:4`, `CT:mug`, `RS:clear` all return
null, so container ids must too — a case-preserved `Dinner-Bowl` would miss the
`dinner-bowl` key in `containers.items` and silently skip the tare, producing a
wrong-but-plausible calorie number instead of a visible error.

**Step 4: Run, confirm pass**

`npx vitest run tests/unit/domains/nutrition/scanVocabulary.test.mjs` → PASS.

**Step 5: Commit**

```bash
git add backend/src/2_domains/nutrition/ScanVocabulary.mjs tests/unit/domains/nutrition/scanVocabulary.test.mjs
git commit -m "feat(nutrition): scan grammar for fridge-sheet QR codes"
```

---

## Task 2: Nutrition math — net weight, calories, macro split

**Files:**
- Create: `backend/src/2_domains/nutrition/scanNutrition.mjs`
- Test: `tests/unit/domains/nutrition/scanNutrition.test.mjs`

The clamp and the `tared` flag are the load-bearing parts — placeholder container weights guarantee `gross < tare` during the fill-in period, and a silent 0 kcal entry is worse than a flagged one.

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { computeNet, computeNutrition } from '#domains/nutrition/scanNutrition.mjs';

const LEVEL_4 = { level: 4, label: 'Mixed', kcal_per_g: 1.4,
  macros: { fat_pct: 30, carb_pct: 45, protein_pct: 25 },
  per_100g: { fiber_g: 2, sugar_g: 5, sodium_mg: 300 } };

describe('computeNet', () => {
  it('subtracts the container tare', () => {
    expect(computeNet(500, { grams: 180 })).toEqual({ netG: 320, tared: true, clamped: false });
  });

  it('passes gross through untared when no container', () => {
    expect(computeNet(500, null)).toEqual({ netG: 500, tared: false, clamped: false });
  });

  // Guaranteed during the placeholder-weight period. Must clamp AND flag.
  it('clamps a negative net to zero and flags it', () => {
    expect(computeNet(100, { grams: 180 })).toEqual({ netG: 0, tared: true, clamped: true });
  });
});

describe('computeNutrition', () => {
  it('derives calories and macro grams from percent-of-calories', () => {
    const r = computeNutrition(200, LEVEL_4);
    expect(r.calories).toBe(280);                 // 200 * 1.4
    expect(r.fat_g).toBeCloseTo(9.33, 2);         // 280 * .30 / 9
    expect(r.carb_g).toBeCloseTo(31.5, 2);        // 280 * .45 / 4
    expect(r.protein_g).toBeCloseTo(17.5, 2);     // 280 * .25 / 4
  });

  it('scales per-100g nutrients by net weight', () => {
    const r = computeNutrition(200, LEVEL_4);
    expect(r.fiber_g).toBeCloseTo(4, 2);
    expect(r.sodium_mg).toBeCloseTo(600, 2);
  });

  it('returns zeros for a zero net weight', () => {
    expect(computeNutrition(0, LEVEL_4).calories).toBe(0);
  });
});
```

**Step 2: Run, confirm fail.** `npx vitest run tests/unit/domains/nutrition/scanNutrition.test.mjs`

**Step 3: Implement**

```javascript
// Net weight and nutrient derivation for scan-enriched scale entries.
// Macros are stored as PERCENT OF CALORIES (must sum to 100) so the
// hand-authored density table is self-validating; grams are derived here.

const KCAL_PER_G_FAT = 9;
const KCAL_PER_G_CARB = 4;
const KCAL_PER_G_PROTEIN = 4;

export function computeNet(grossG, container) {
  const tare = Number(container?.grams) || 0;
  const raw = Number(grossG) - tare;
  return {
    netG: Math.max(0, raw),
    tared: tare > 0,
    clamped: raw < 0,
  };
}

export function computeNutrition(netG, level) {
  const g = Math.max(0, Number(netG) || 0);
  const calories = Math.round(g * Number(level.kcal_per_g));
  const m = level.macros || {};
  const per100 = level.per_100g || {};
  const scale = g / 100;
  return {
    calories,
    fat_g:     (calories * (Number(m.fat_pct)     || 0) / 100) / KCAL_PER_G_FAT,
    carb_g:    (calories * (Number(m.carb_pct)    || 0) / 100) / KCAL_PER_G_CARB,
    protein_g: (calories * (Number(m.protein_pct) || 0) / 100) / KCAL_PER_G_PROTEIN,
    fiber_g:   (Number(per100.fiber_g)  || 0) * scale,
    sugar_g:   (Number(per100.sugar_g)  || 0) * scale,
    sodium_mg: (Number(per100.sodium_mg)|| 0) * scale,
  };
}
```

**Step 4: Run, confirm pass. Step 5: Commit**

```bash
git add backend/src/2_domains/nutrition/scanNutrition.mjs tests/unit/domains/nutrition/scanNutrition.test.mjs
git commit -m "feat(nutrition): net-weight clamp and percent-of-calories macro split"
```

---

## Task 3: Composition + CompositionStore — SHIPPED, and SUPERSEDED

**Do not implement this task from this document.** The original spec here created
`2_domains/nutrition/CompositionBuffer.mjs`, a factory holding a mutable `Map` in the domain
layer. That violates `docs/reference/core/layers-of-abstraction/ddd-reference.md`, which
restricts `2_domains` to entities, value objects, domain services and rules — with domain
services required to be **stateless**. The module has been deleted.

What shipped instead, per
[`docs/plans/2026-07-21-nutrition-ddd-compliance.md`](./2026-07-21-nutrition-ddd-compliance.md):

| Module | Layer | Holds |
|--------|-------|-------|
| `2_domains/nutrition/value-objects/Composition.mjs` | domain | an immutable four-slot snapshot; `withWeight` / `withDensity` / `withContainer` return NEW instances; `isComplete`, `equals`, `toData` / `fromData` |
| `3_applications/nutribot/CompositionStore.mjs` | application | the `Map<scaleId, …>`, the rolling window, expiry, `endPlacement` / `clear` |

`CompositionStore`'s surface is unchanged from the old buffer — `setWeight`, `setDensity`,
`setContainer`, `endPlacement`, `clear`, `read` — and `read()` still returns
`{ grams, unit, density, container, complete, active }`, so Tasks 5-7 are unaffected apart from
the import path.

**The behaviours later tasks depend on, all still pinned by tests:** `now` is required (no
`Date.now()` default); slots are consumed **unconditionally** at `endPlacement`; the window
refresh set is the three setters only, so `read()` never refreshes; expiry is strictly
`now() - touchedAt > windowMs`; a rejected setter leaves the store untouched; scales are
independent; `endPlacement` / `clear` return booleans and return `false` when already expired;
`read()` never hands back internal state.

**Why the split also matters for the Telegram/scan convergence:** the old buffer was scan-shaped
and keyed by `scaleId`, which is precisely why the button path could not share it. An immutable
`Composition` is modality-agnostic — a Telegram density tap and a `dl:4` fridge scan both produce
`composition.withDensity(4)` — and the application layer decides where it lives.

---

## Task 4: Config — macros, containers, knobs, rejecting validator

**Files:**
- Modify: `backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs`
- Modify: `_extensions/food-scale-relay/config.example.yml`
- Test: `tests/unit/applications/nutribot/scaleNutribotConfig.test.mjs`

`normalizeScaleNutribotConfig` currently **drops** malformed entries. A typo'd density level would then vanish from both the Telegram keyboard and the printed sheet with no error. It must reject loudly instead.

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

const level = (over = {}) => ({
  level: 4, label: 'Mixed', emoji: '🍛', kcal_per_g: 1.4,
  macros: { fat_pct: 30, carb_pct: 45, protein_pct: 25 }, ...over,
});

describe('density macro validation', () => {
  it('accepts a table whose macros sum to 100', () => {
    const cfg = normalizeScaleNutribotConfig({ density_levels: [level()] });
    expect(cfg.densityLevels[0].macros.fat_pct).toBe(30);
  });

  it('THROWS when macros do not sum to 100 (must not silently drop)', () => {
    expect(() => normalizeScaleNutribotConfig({
      density_levels: [level({ macros: { fat_pct: 30, carb_pct: 45, protein_pct: 30 } })],
    })).toThrow(/sum to 100/i);
  });

  it('throws when a level is missing its macros block', () => {
    expect(() => normalizeScaleNutribotConfig({
      density_levels: [level({ macros: undefined })],
    })).toThrow(/macros/i);
  });

  it('defaults bufferWindowSec to 900', () => {
    expect(normalizeScaleNutribotConfig({}).bufferWindowSec).toBe(900);
  });
});
```

**Step 2: Run, confirm fail.**

**Step 3: Implement.** Add to `scaleNutribotConfig.mjs`:

**Two landmines found during Task 2 review — both WILL break every scan if missed:**

1. **`scaleNutribotConfig.mjs:44` currently drops `macros` and `per_100g`.** It builds each level
   as `{ level, label, emoji, kcal_per_g, hint }` via `.map()`. Validating the new fields is not
   enough — they must be *carried through* that map, or `computeNutrition` receives a level with
   no macros and throws on every scan.
2. **Require finite numbers, not `Number(x) || 0`.** Task 2 established a strict finite-number
   contract in the domain. If the validator coerces, a stringly-typed `fat_pct: "30"` passes
   config load and then throws per-scan at runtime — the failure lands at the fridge instead of
   at startup, which is the whole thing this validator exists to prevent.

```javascript
const MACRO_KEYS = ['fat_pct', 'carb_pct', 'protein_pct'];

function validateDensityLevel(lvl) {
  if (!lvl.macros) {
    throw new Error(`density level ${lvl.level} (${lvl.label}) is missing its macros block`);
  }
  const sum = MACRO_KEYS.reduce((t, k) => t + (Number(lvl.macros[k]) || 0), 0);
  if (Math.abs(sum - 100) > 0.01) {
    throw new Error(
      `density level ${lvl.level} (${lvl.label}) macros sum to ${sum}, must sum to 100`
    );
  }
  return lvl;
}
```

Call it for every entry as the table is normalized, and add `bufferWindowSec: config?.buffer_window_sec ?? 900` to the returned object. Keep the existing drop-behaviour for *other* malformed fields; only macros escalate to a throw.

**Step 4: Run, confirm pass.**

**Step 5: Extend `config.example.yml`.** Add a `macros` + `per_100g` block to all nine levels (hand-authored from representative foods per design D5), expand `containers.items` to ~25 placeholder entries under a loud banner, and add `buffer_window_sec: 900` plus a `sheet:` block. Placeholder banner text:

```yaml
    # ⚠️ PLACEHOLDER WEIGHTS — every `grams` below is FAKE. Weigh each container
    # on the scale and replace them before trusting any tared entry. Config is
    # cached at startup, so RESTART THE BACKEND after each edit.
```

**Step 6: Commit**

```bash
git add backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs \
        _extensions/food-scale-relay/config.example.yml \
        tests/unit/applications/nutribot/scaleNutribotConfig.test.mjs
git commit -m "feat(nutribot): density macro baselines with a rejecting validator"
```

---

## Task 5: ApplyScanToComposition use case

**Files:**
- Create: `backend/src/3_applications/nutribot/usecases/ApplyScanToComposition.mjs`
- Test: `tests/unit/applications/nutribot/applyScanToComposition.test.mjs`

Owns the decision tree: fill a slot, then post / edit / accept / reset. Per design D4, accept **only** when the buffer is complete. Density is applied via the existing `SelectScaleDensity` (which requires `status === 'pending'`), then `AcceptFoodLog`.

**Behaviour to test (stub the container's use cases and the buffer):**

1. `dl:4` with no weight buffered → slot set, **nothing posted**.
2. `dl:4` with a weight already posted-pending → `SelectScaleDensity` then `AcceptFoodLog`.
3. `ct:mug` alone with a pending entry → recomputes net, entry stays pending (no density yet).
4. `rs:clear` with a pending entry → `RetractScaleLog`; buffer cleared.
5. `rs:clear` with an already-accepted entry → `DiscardFoodLog`; buffer cleared.
6. `rs:clear` with nothing live → no use case called, returns `{ ok: true, cleared: false }`.
7. Unknown container id → returns `{ ok: false, reason: 'unknown-container' }` and does **not** touch the log. (Orphaned laminated code — this is where stale-sheet bugs land.)
8. Unknown density level → same shape, `reason: 'unknown-density'`.
9. `unit === 'ml'` in the buffer → refuses with `reason: 'unit-ml'` rather than treating ml as g.

**Step 5: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/ApplyScanToComposition.mjs \
        tests/unit/applications/nutribot/applyScanToComposition.test.mjs
git commit -m "feat(nutribot): apply scanned density/container/reset to a composition"
```

---

## Task 6: Bridge integration — unit passthrough, session end, serialization

**Files:**
- Modify: `backend/src/3_applications/hardware/ScaleNutribotBridge.mjs`
- Test: `tests/unit/applications/hardware/scaleNutribotBridge.buffer.test.mjs`

Three changes, each independently testable:

1. **Unit passthrough** — line ~50 hardcodes `unit: 'g'`. Read `payload.unit` and carry it into the buffer and the log. An `ml` reading must reach `ApplyScanToComposition`'s refusal path, not be silently logged as grams.
2. **Session end consumes slots** — in the `rise <= baselineTolG` branch (~line 120), call `buffer.endPlacement(id)` alongside the existing retract.

   **Wire this to the placed→at-rest TRANSITION, not to the condition.** `rise <= baselineTolG`
   is true on *every* settled at-rest frame, and the firmware emits those at 0.5 Hz indefinitely
   while the scale sits on its shelf. Calling `endPlacement` on the condition consumes any
   pre-scan within about two seconds, making scan-before-placing impossible — the exact flow the
   buffer exists to support. Track the edge (was-placed → now-at-rest) and fire once.

   Test this explicitly: a `dl:` scan followed by twenty at-rest frames must still have its
   density when a weight finally arrives.
3. **Shared serialization** — the bridge's `inflight` Set must be reachable by the scan path. Extract it into a small per-scale mutex passed to both the bridge and `ApplyScanToComposition`, so a density scan landing during an awaited `create()` cannot produce two concurrent read-modify-writes on the same food log.

Write the mutex test first: two concurrent operations on the same scale id must serialize; on different ids they must not.

**Two obligations inherited from Task 2's review — do not drop them:**

- **Fix the payload-discarding dispatch sites.** `barcodeRelay.mjs:77` and
  `ScaleNutribotBridge.mjs:141` both log `{ error: err.message }`, throwing away
  `ValidationError`'s `code` / `field` / `value`. Task 2's domain errors carry real
  diagnostic payload that currently evaporates before anyone can read it. Log the
  structured fields.
- **Round at the storage boundary.** `computeNutrition` deliberately returns unrounded
  macro grams (`fat_g: 9.333333333333334`) so stored macros reconcile against the stored
  calorie total. That is correct in the domain, but existing
  `history/nutrition/kitchen-food-scale/*.yml` entries are clean integers — writing 17
  significant digits beside `grams: 74` makes the day-file materially harder to eyeball.
  Round here or in Task 5, not in the domain. Rounding at `scanNutrition.mjs:222-224`
  breaks the reconciliation invariant.

```bash
git commit -m "fix(scale): carry the scale unit, consume slots at session end, serialize both paths"
```

---

## Task 7: Wire the nutriscan route

**Files:**
- Modify: `backend/src/3_applications/hardware/barcodeRelay.mjs`
- Modify: `backend/src/app.mjs` (~line 2340, the `onScan` callback)
- Test: `tests/unit/applications/hardware/barcodeRelay.nutriscan.test.mjs`

In `barcodeRelay`, consult `parseScan(code)` before building the payload. On a hit, set `route: 'nutriscan'`; on a miss, leave the payload exactly as today. Persistence is unchanged — nutrition scans still append to the barcode day-log, because excluding them would hole the audit trail exactly where you'd look when a meal logged wrong.

In `app.mjs`, add a `route === 'nutriscan'` branch **before** the existing `route === 'nutribot'` branch, dispatching to `ApplyScanToComposition`. Do not modify the `nutribot` branch.

Tests: a `dl:4` scan sets `route: 'nutriscan'` and does not reach `onScan`'s trigger path; a UPC still produces a `TriggerEvent`; both still persist.

```bash
git commit -m "feat(hardware): route fridge-sheet scans through nutriscan"
```

---

## Task 8: Memo — voice flow-state branch and the Memo button

**Files:**
- Modify: `backend/src/1_adapters/nutribot/NutribotInputRouter.mjs` (`handleVoice`, line 119)
- Modify: `backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs` (`buildConfirmButtons`)
- Test: `tests/unit/adapters/nutribot/nutribotInputRouter.voice.test.mjs`

`handleText` (lines 50–82) already branches on `state?.activeFlow === 'scale_describe' && pendingLogUuid` → `LogScaleFoodFromText`. `handleVoice` has **no** state check, so every voice note becomes a new food log. Mirror the text branch: transcribe first, then route the transcript through `LogScaleFoodFromText` when the flow state says `scale_describe`.

This is the entirety of the voice memo work — transcription is already wired end to end.

Then add a **Memo** button to `buildConfirmButtons` that sets `activeFlow = 'scale_describe'` for the log.

Tests: a voice note with `activeFlow: 'scale_describe'` reaches `LogScaleFoodFromText`, not `LogFoodFromVoice`; without that state it still reaches `LogFoodFromVoice`.

```bash
git commit -m "feat(nutribot): route voice memos through the scale-describe flow"
```

---

## Task 9: QRSheetRenderer — pure layout + golden test

**Files:**
- Create: `backend/src/1_rendering/pdf/QRSheetRenderer.mjs`
- Test: `tests/unit/rendering/qrSheetLayout.test.mjs`

pdfkit sets `CreationDate: new Date()` and derives the trailer `/ID` from an md5 over the info dict, so PDF output is **never byte-stable** — a characterization test on `catalog.mjs` would pin nothing. Instead extract the tiling math as a pure function and golden-test that.

```javascript
export function layoutSections(sections, page = { width: 612, height: 792, margin: 36, gap: 8 })
// → [{ page, section, index, x, y, width, height }]
```

Test: two sections of differing `cols`/`rows` place cells at exact expected coordinates; overflow spills to page 2; an empty section contributes nothing.

The PDF-emitting wrapper around it stays thin and untested — that is an honest boundary, not an oversight.

```bash
git commit -m "feat(rendering): pure section-grid layout for QR sheets"
```

---

## Task 10: Rewrite catalog.mjs onto the shared layout

**Files:**
- Modify: `backend/src/4_api/v1/routers/catalog.mjs:107-152`

Replace the hardcoded `COLS = 3, ROWS = 5` loop with a `layoutSections` call. Behaviour is preserved by construction, not by test — verify by generating one catalog PDF before and after and comparing them visually. Say so plainly in the commit; do not claim test coverage this refactor doesn't have.

```bash
git commit -m "refactor(catalog): tile via the shared layoutSections helper"
```

---

## Task 11: Sheet generation endpoint

**Files:**
- Create: `backend/src/4_api/v1/routers/nutritionSheet.mjs`
- Modify: `backend/src/app.mjs` (register `v1Routers['nutrition-sheet']`)

`GET /api/v1/nutrition-sheet` → PDF. Builds codes via `encodeDensity` / `encodeContainer` / `RESET_CODE` from `ScanVocabulary` — never string-concatenated locally. Those encoders **throw** on an unencodable id, so a bad container key in YAML fails this endpoint loudly instead of printing a QR that parses to null. Let it throw; do not catch and skip the entry — renders each through `createQRCodeRenderer()` **in process** (no internal HTTP; that indirection in `catalog.mjs` exists for content lookups we don't need), tiles via `layoutSections`, and stamps a config version in the page footer so a sheet on the fridge can be matched to the config that produced it.

```bash
git commit -m "feat(api): printable nutrition scan sheet endpoint"
```

---

## Task 12: Docs

**Files:**
- Modify: `_extensions/food-scale-relay/README.md`
- Modify: `docs/reference/` — whichever nutribot/nutrition reference doc exists

Document the scan grammar, the buffer window, the accept rule (D4), the restart-after-config-edit requirement, and the known gaps below.

```bash
git commit -m "docs(food-scale-relay): scan-enriched logging flow"
```

---

## A parse miss is NOT a no-op (verified, affects Tasks 7 and 11)

The design doc assumed a nutrition code that misses `parseScan` would be dropped. It is
not. `BarcodePayload.#parseCommand` returns null for `ct:dinner-bowl` (neither segment is
a known command), so it falls through to `ContentExpression.fromString` and becomes
`{ type: 'content', contentId: 'ct:dinner-bowl' }` — a content dispatch *attempt*.
`resolveCommand` never runs; nothing rejects it.

Consequences: Task 7's `nutriscan` branch must come strictly first (ordering is
load-bearing, not stylistic), and an orphaned or typo'd code fails noisily in the content
pipeline rather than quietly. That is why Task 1's encoders throw.

No live prefix collision exists today — configured screen ids are `livingroom-tv`,
`office-tv`, `piano`, `garage-tv`, `portal`, `speaker-*`, none named `dl`/`ct`/`rs`.

## Known Gaps — do not silently "fix" these

- **Backend restart** loses the in-memory buffer with no signal, and the bridge relearns the current load as baseline, so food already on the scale never posts. Accepted; documented.
- **Config is startup-cached** — every container-weight edit needs a restart.
- **Single-user attribution** — the bridge is wired to the head of household; every scan-enriched entry attributes to them regardless of who is cooking. Chosen.
- **UPC at the fridge does not work** — the scanner is `route: content`, so a product barcode falls through to content dispatch. `LogFoodFromUPC` exists and works; wiring it is a separate feature, deliberately out of scope.
- **Print legibility is untested** — print one page and try scanning it off the fridge door before laminating.
- **25 containers** renders ~9 keyboard rows in `buildContainerKeyboard`. Usability, not correctness.
