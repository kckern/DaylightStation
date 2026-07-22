# Fridge Scan Three-Way Routing + QR Sheet Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the fridge barcode scanner handle three input kinds — food UPC, caloric-density level, and tare preset — discriminated by a namespace prefix in the scanned code, and print the QR sheet that carries the latter two.

**Architecture:** The scanner stays `route: nutribot`. Inside that branch, `parseScan` runs first: a `dl:`/`ct:`/`rs:` hit goes to a new `ApplyScanToComposition` use case that writes the shipped `CompositionStore`; a miss falls through to the existing `LogFoodFromUPC` path unchanged. A successful scan then refreshes the live Telegram prompt so the user sees the tare acknowledged on the message itself. A new `QRSheetRenderer` prints the density and container codes from the same config the parser reads, via `ScanVocabularyService` encoders.

**Tech Stack:** Node ESM (`.mjs`), Express, vitest, pdfkit + svg-to-pdfkit (vector, never rasterized), `qrcode`, js-yaml.

---

## Context: what already exists

Shipped and tested — **do not rewrite**:

| Module | What it gives you |
|--------|-------------------|
| `backend/src/2_domains/nutrition/services/ScanVocabularyService.mjs` | `parseScan`, `encodeDensity`, `encodeContainer`, `RESET_CODE`, `MAX_DENSITY_LEVEL` (24 tests) |
| `backend/src/2_domains/nutrition/services/ScanNutritionService.mjs` | `computeNet(grossG, container)`, `computeNutrition(netG, level)` (58 tests) |
| `backend/src/2_domains/nutrition/value-objects/Composition.mjs` | immutable slots (62 tests) |
| `backend/src/3_applications/nutribot/CompositionStore.mjs` | `setWeight/setDensity/setContainer/endPlacement/clear/read`, per-scale, rolling window, injected clock (70 tests) |

All of it is unreachable from the running system. Nothing calls it.

**The live scanner is `route: nutribot`, not `route: content`.** `docs/reference/nutrition/README.md:54` and the design doc both reason from `route: content` and a fall-through to content dispatch. That is wrong about the deployed hardware — `data/household/config/scales.yml:52-56` sets `route: nutribot`, and `backend/src/app.mjs:2354` branches on it into `LogFoodFromUPC` and `return`s before content dispatch. Task 8 corrects the docs. Do not "fix" the config to match the docs; the docs are what's stale.

---

## Where the config lives

**Two files, two different jobs.** Both are private household data under `$DAYLIGHT_BASE_PATH/data` — never committed.

### 1. `data/household/config/scales.yml` → the `nutribot:` block

The scan **vocabulary**: which density levels exist and what each is worth, which containers exist and what each weighs. Both the parser-side math and the printed sheet read this one block, which is why the sheet cannot drift from the reader.

The live file currently has **no `nutribot:` block at all** (68 lines, ends at `scales.kitchen-food-scale.barcode`). Everything under `nutribot:` in `_extensions/food-scale-relay/config.example.yml` is example-only, and the example is itself behind the spec:

- 4 containers, where the sheet wants ~25
- `density_levels` rows carry only `kcal_per_g` — no `macros`, no `per_100g`, both of which `computeNutrition` requires

Defaults live in `backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs` (`DEFAULT_CONTAINERS`, `DEFAULT_DENSITY_LEVELS`) and are what the system falls back to today.

### 2. `data/household/config/barcode-relay.yml` → `relays.nutribot-upc.scale_id`

The **binding**. `CompositionStore` is keyed per scale id, but a scan arrives carrying only the *barcode* device id (`nutribot-upc`). Nothing in the current config connects the two — `barcodeRelayInstances[relay.device]` (`app.mjs:2351`) has `label`, `route`, `nutribot`, `scanner`, and no scale.

In `scales.yml` the `barcode:` block is nested inside `scales.kitchen-food-scale`, so the linkage exists structurally there but is not exposed on the relay record the handler actually reads. Adding one explicit key is cheaper and clearer than reverse-mapping the nesting:

```yaml
relays:
  nutribot-upc:
    scale_id: kitchen-food-scale   # ← NEW: binds scans to a CompositionStore key
```

**Config is cached at startup.** Both files need a backend restart before edits take effect.

---

## Design decisions

- **D1 — Route stays `nutribot`; the code string discriminates.** The relay does not prefix anything: firmware sends the decoded bytes verbatim (`_extensions/food-scale-relay/firmware/src/main.cpp:227-228`). The namespace exists only because the sheet *prints* `dl:4` / `ct:mug` / `rs:clear` into the QR payload. UPC/EAN are digit-only and can never match a `<prefix>:<rest>` shape, so ordering `parseScan` first is safe and keeps UPC working.
- **D2 — Unknown container id is rejected, not tared to zero.** `CompositionStore.setContainer` accepts any well-formed id and `computeNet` reads an absent container as "no tare" (documented in both). `ApplyScanToComposition` resolves against `containers.items` and refuses a miss, so a renamed id fails visibly instead of silently under-taring. This closes a gap the README currently lists as known.
- **D3 — A density level absent from config is rejected even if it parses.** `dl:7` parses whenever `7 <= MAX_DENSITY_LEVEL`, regardless of whether the config table has a row 7. Reject at the use case; `MALFORMED_DENSITY_LEVEL` from `ScanNutritionService` means "fix the YAML" and should not be how the user finds out.
- **D4 — A scan ACKs by editing the live prompt, not by posting a new message.** The bridge already maintains a single-live invariant per scale (`s.live = { logUuid, messageId, grams }`) and follows the weight by re-running `LogFoodFromScale` with `existingLogUuid + messageId`. A tare ACK is the same edit with the container line rendered in. A separate "tared ☕ Mug" message would break the single-live invariant and pile up one message per scan. When no prompt is live yet (scan before weighing) the ACK is deferred, not lost — the container sits in the buffer and appears on the prompt when the weight lands.
- **D5 — The sheet endpoint renders in-process.** `createQRCodeRenderer().renderSvg()` is called directly. `catalog.mjs` reaches its own server over internal HTTP because it needs `/list` content lookups; there is nothing to look up here.

---

## Task 1: Carry macros through config normalization

`normalizeScaleNutribotConfig` currently drops `macros` and `per_100g` when mapping density rows, so even a correct YAML table cannot reach `computeNutrition`.

**Files:**
- Modify: `backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs`
- Test: `tests/unit/applications/nutribot/scaleNutribotConfig.test.mjs` (create)

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

describe('normalizeScaleNutribotConfig — density macros', () => {
  it('carries macros and per_100g through to the normalized level', () => {
    const cfg = normalizeScaleNutribotConfig({
      nutribot: {
        density_levels: [{
          level: 1, label: 'Watery', emoji: '🥬', kcal_per_g: 0.2,
          macros: { fat_pct: 10, carb_pct: 70, protein_pct: 20 },
          per_100g: { fiber_g: 2, sugar_g: 3, sodium_mg: 40 },
        }],
      },
    });

    expect(cfg.densityLevels[0].macros).toEqual({ fat_pct: 10, carb_pct: 70, protein_pct: 20 });
    expect(cfg.densityLevels[0].per_100g).toEqual({ fiber_g: 2, sugar_g: 3, sodium_mg: 40 });
  });

  it('leaves macros absent when the row omits them, rather than fabricating a split', () => {
    const cfg = normalizeScaleNutribotConfig({
      nutribot: { density_levels: [{ level: 1, kcal_per_g: 0.2 }] },
    });
    expect(cfg.densityLevels[0].macros).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/applications/nutribot/scaleNutribotConfig.test.mjs`
Expected: FAIL — `macros` is `undefined` in the first test.

**Step 3: Write minimal implementation**

In the `densityLevels` map, preserve both fields verbatim. Do **not** default or coerce them — `ScanNutritionService` owns that validation and its asymmetric handling of `macros` (throws) vs `per_100g` (tolerates null) is deliberate. A default here would defeat it.

```javascript
        .map((l) => {
          const out = {
            level: Number(l.level),
            label: l.label || `L${l.level}`,
            emoji: l.emoji || '🍽',
            kcal_per_g: Number(l.kcal_per_g),
            hint: l.hint || '',
          };
          // Passed through untouched: ScanNutritionService validates these and
          // treats a blank macros (throws) differently from a blank per_100g
          // (tolerated). Defaulting either here would mask a bad table.
          if (l.macros !== undefined) out.macros = l.macros;
          if (l.per_100g !== undefined) out.per_100g = l.per_100g;
          return out;
        })
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/applications/nutribot/scaleNutribotConfig.test.mjs`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs \
        tests/unit/applications/nutribot/scaleNutribotConfig.test.mjs
git commit -m "fix(nutrition): carry density macros through config normalization"
```

---

## Task 2: Config validator

A bad table must fail at startup with a pointable message, not at 6pm at the fridge.

**Files:**
- Create: `backend/src/3_applications/nutribot/lib/validateScanConfig.mjs`
- Test: `tests/unit/applications/nutribot/validateScanConfig.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { validateScanConfig } from '#apps/nutribot/lib/validateScanConfig.mjs';
import { MAX_DENSITY_LEVEL } from '#domains/nutrition/index.mjs';

const level = (n, over = {}) => ({
  level: n, label: `L${n}`, emoji: '🍽', kcal_per_g: 1,
  macros: { fat_pct: 30, carb_pct: 50, protein_pct: 20 },
  ...over,
});
const full = () => Array.from({ length: MAX_DENSITY_LEVEL }, (_, i) => level(i + 1));

describe('validateScanConfig', () => {
  it('accepts a complete table', () => {
    expect(() => validateScanConfig({
      densityLevels: full(),
      containers: { items: [{ id: 'mug', label: 'Mug', emoji: '☕', grams: 350 }] },
    })).not.toThrow();
  });

  it('rejects macros that do not sum to 100', () => {
    const levels = full();
    levels[2].macros = { fat_pct: 30, carb_pct: 50, protein_pct: 30 };
    expect(() => validateScanConfig({ densityLevels: levels, containers: { items: [] } }))
      .toThrow(/level 3.*sum to 100/i);
  });

  it('rejects a container id the encoder cannot print', () => {
    expect(() => validateScanConfig({
      densityLevels: full(),
      containers: { items: [{ id: 'Dinner Bowl', grams: 250 }] },
    })).toThrow(/Dinner Bowl/);
  });

  it('rejects a duplicate container id', () => {
    expect(() => validateScanConfig({
      densityLevels: full(),
      containers: { items: [{ id: 'mug', grams: 350 }, { id: 'mug', grams: 200 }] },
    })).toThrow(/duplicate.*mug/i);
  });

  it('rejects a level outside the grammar range', () => {
    expect(() => validateScanConfig({
      densityLevels: [...full(), level(MAX_DENSITY_LEVEL + 1)],
      containers: { items: [] },
    })).toThrow(/1-9/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/applications/nutribot/validateScanConfig.test.mjs`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

```javascript
/**
 * Startup validation for the scan vocabulary in scales.yml `nutribot:`.
 *
 * Every check here is one a laminated sheet would otherwise surface weeks later.
 * Validating through the ENCODERS rather than a local regex is the point: if
 * `encodeContainer` would throw on an id, that id can never be printed, so it
 * must not be accepted into the table either.
 *
 * @module nutribot/lib/validateScanConfig
 */

import { ValidationError } from '#domains/core/errors/index.mjs';
import { encodeContainer, encodeDensity, MAX_DENSITY_LEVEL } from '#domains/nutrition/index.mjs';

const fail = (message, code, value) => {
  throw new ValidationError(message, { code, field: 'nutribot', value });
};

export function validateScanConfig({ densityLevels = [], containers = {} } = {}) {
  const seenLevels = new Set();

  for (const row of densityLevels) {
    // Throws INVALID_DENSITY_LEVEL for anything unprintable, including >MAX.
    encodeDensity(row?.level);

    if (seenLevels.has(row.level)) fail(`Duplicate density level ${row.level}`, 'DUPLICATE_DENSITY_LEVEL', row.level);
    seenLevels.add(row.level);

    const m = row.macros;
    if (!m || typeof m !== 'object') {
      fail(`Density level ${row.level} is missing macros`, 'MALFORMED_DENSITY_LEVEL', row.macros);
    }
    const sum = Number(m.fat_pct) + Number(m.carb_pct) + Number(m.protein_pct);
    if (!Number.isFinite(sum) || Math.round(sum) !== 100) {
      fail(
        `Density level ${row.level} macros must sum to 100 (got ${sum})`,
        'MALFORMED_DENSITY_LEVEL',
        m,
      );
    }
  }

  // A gap means a printed dl:N resolves to nothing. Better caught here.
  for (let n = 1; n <= MAX_DENSITY_LEVEL; n += 1) {
    if (!seenLevels.has(n)) fail(`Density table is missing level ${n}`, 'MISSING_DENSITY_LEVEL', n);
  }

  const seenIds = new Set();
  for (const item of containers.items || []) {
    encodeContainer(item?.id); // throws INVALID_CONTAINER_ID on an unprintable id
    if (seenIds.has(item.id)) fail(`Duplicate container id "${item.id}"`, 'DUPLICATE_CONTAINER_ID', item.id);
    seenIds.add(item.id);

    if (!Number.isFinite(Number(item.grams)) || Number(item.grams) <= 0) {
      fail(`Container "${item.id}" needs a positive grams`, 'INVALID_CONTAINER_TARE', item.grams);
    }
  }

  return true;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/applications/nutribot/validateScanConfig.test.mjs`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add backend/src/3_applications/nutribot/lib/validateScanConfig.mjs \
        tests/unit/applications/nutribot/validateScanConfig.test.mjs
git commit -m "feat(nutrition): validate scan vocabulary config at load"
```

---

## Task 3: `ApplyScanToComposition` use case

The nutriscan handler. Resolves a parsed scan against config, writes the store, returns a result the caller turns into user feedback.

**Files:**
- Create: `backend/src/3_applications/nutribot/usecases/ApplyScanToComposition.mjs`
- Test: `tests/unit/applications/nutribot/ApplyScanToComposition.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { CompositionStore } from '#apps/nutribot/CompositionStore.mjs';
import { ApplyScanToComposition } from '#apps/nutribot/usecases/ApplyScanToComposition.mjs';

const CONFIG = {
  densityLevels: [
    { level: 1, label: 'Watery', emoji: '🥬', kcal_per_g: 0.2, macros: { fat_pct: 10, carb_pct: 70, protein_pct: 20 } },
    { level: 4, label: 'Mixed', emoji: '🍛', kcal_per_g: 1.4, macros: { fat_pct: 30, carb_pct: 50, protein_pct: 20 } },
  ],
  containers: { items: [{ id: 'mug', label: 'Mug', emoji: '☕', grams: 350 }] },
};

describe('ApplyScanToComposition', () => {
  let store; let apply; let clock;

  beforeEach(() => {
    clock = 1_000;
    store = new CompositionStore({ now: () => clock });
    apply = new ApplyScanToComposition({ store, config: CONFIG });
  });

  it('declines a code the grammar does not claim, so UPC can fall through', () => {
    expect(apply.execute({ scaleId: 'kitchen', code: '012345678905' })).toEqual({ handled: false });
    expect(store.read('kitchen').active).toBe(false);
  });

  it('records a configured density level', () => {
    const r = apply.execute({ scaleId: 'kitchen', code: 'dl:4' });
    expect(r).toMatchObject({ handled: true, kind: 'density', label: 'Mixed' });
    expect(store.read('kitchen').density).toBe(4);
  });

  it('refuses a level that parses but has no config row', () => {
    const r = apply.execute({ scaleId: 'kitchen', code: 'dl:9' });
    expect(r).toMatchObject({ handled: true, ok: false, error: 'UNKNOWN_DENSITY_LEVEL' });
    expect(store.read('kitchen').density).toBeNull();
  });

  it('records a configured container', () => {
    const r = apply.execute({ scaleId: 'kitchen', code: 'ct:mug' });
    expect(r).toMatchObject({ handled: true, kind: 'container', label: 'Mug', grams: 350 });
    expect(store.read('kitchen').container).toBe('mug');
  });

  it('refuses an unknown container instead of taring zero', () => {
    const r = apply.execute({ scaleId: 'kitchen', code: 'ct:teapot' });
    expect(r).toMatchObject({ handled: true, ok: false, error: 'UNKNOWN_CONTAINER' });
    expect(store.read('kitchen').container).toBeNull();
  });

  it('clears on rs:clear and reports whether anything was live', () => {
    apply.execute({ scaleId: 'kitchen', code: 'dl:4' });
    expect(apply.execute({ scaleId: 'kitchen', code: 'rs:clear' })).toMatchObject({ handled: true, hadState: true });
    expect(apply.execute({ scaleId: 'kitchen', code: 'rs:clear' })).toMatchObject({ handled: true, hadState: false });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/applications/nutribot/ApplyScanToComposition.test.mjs`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

```javascript
/**
 * Apply a fridge-sheet scan to a scale's in-progress composition.
 *
 * Returns `{ handled: false }` for anything the grammar does not claim, which is
 * how the caller knows to fall through to the UPC path. That flag is the entire
 * contract for three-way routing — it must never throw for an unclaimed code.
 *
 * @module nutribot/usecases/ApplyScanToComposition
 */

import { parseScan } from '#domains/nutrition/index.mjs';

const NOT_HANDLED = { handled: false };

export class ApplyScanToComposition {
  #store; #config;

  /**
   * @param {object} deps
   * @param {import('../CompositionStore.mjs').CompositionStore} deps.store
   * @param {{densityLevels: Array, containers: {items: Array}}} deps.config
   */
  constructor({ store, config }) {
    if (!store?.setDensity) throw new Error('ApplyScanToComposition: store required');
    this.#store = store;
    this.#config = config || { densityLevels: [], containers: { items: [] } };
  }

  /**
   * @param {{scaleId: string, code: string}} input
   * @returns {{handled: boolean, ok?: boolean, kind?: string, error?: string}}
   */
  execute({ scaleId, code }) {
    const parsed = parseScan(code);
    if (!parsed) return NOT_HANDLED;

    if (parsed.kind === 'reset') {
      return { handled: true, ok: true, kind: 'reset', hadState: this.#store.clear(scaleId) };
    }

    if (parsed.kind === 'density') {
      // Parsing only proves the level is inside the grammar. A gap in the config
      // table would otherwise reach ScanNutritionService as MALFORMED_DENSITY_LEVEL,
      // which means "fix the YAML" — not something to learn at the fridge.
      const row = this.#config.densityLevels.find((l) => l.level === parsed.level);
      if (!row) return { handled: true, ok: false, kind: 'density', error: 'UNKNOWN_DENSITY_LEVEL', level: parsed.level };

      this.#store.setDensity(scaleId, parsed.level);
      return { handled: true, ok: true, kind: 'density', level: parsed.level, label: row.label, emoji: row.emoji };
    }

    // container — an unknown id must NOT reach the store: computeNet reads a
    // missing container as "no tare" and returns a silently un-tared weight that
    // then auto-accepts. A renamed id has to be visible.
    const item = (this.#config.containers.items || []).find((c) => c.id === parsed.id);
    if (!item) return { handled: true, ok: false, kind: 'container', error: 'UNKNOWN_CONTAINER', id: parsed.id };

    this.#store.setContainer(scaleId, parsed.id);
    return { handled: true, ok: true, kind: 'container', id: parsed.id, label: item.label, emoji: item.emoji, grams: item.grams };
  }
}

export default ApplyScanToComposition;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/applications/nutribot/ApplyScanToComposition.test.mjs`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/ApplyScanToComposition.mjs \
        tests/unit/applications/nutribot/ApplyScanToComposition.test.mjs
git commit -m "feat(nutrition): ApplyScanToComposition use case for fridge scans"
```

---

## Task 4: Three-way routing in the relay handler

**Files:**
- Modify: `backend/src/app.mjs:2350-2396` (the `onScan` callback)

There is no unit test for `app.mjs` — it is the composition root. Verify by the integration check in Step 3.

**Step 1: Construct the use case near the existing nutribot wiring**

Before `createBarcodeRelay({`, alongside where `nutribotServices` is already in scope:

```javascript
  // Fridge-sheet scans share the CompositionStore with the scale bridge — the
  // whole point is that a weight and a scan land in the same buffer in any order.
  const scanVocabConfig = normalizeScaleNutribotConfig(
    configService.getHouseholdAppConfig(householdId, 'scales') || {},
  );
  validateScanConfig(scanVocabConfig);
  const applyScanToComposition = new ApplyScanToComposition({
    store: compositionStore,
    config: scanVocabConfig,
  });
```

`compositionStore` must be the SAME instance the scale bridge uses. If `createScaleNutribotBridge` currently builds its own, hoist it to a shared `const` above both call sites. Two stores means a scanned density never meets its weight, and the buffer silently never completes.

**Step 2: Insert the nutriscan branch ahead of the UPC path**

Inside `if (route === 'nutribot') {`, as the first statements:

```javascript
      if (route === 'nutribot') {
        // Namespace-first: dl:/ct:/rs: belong to the fridge sheet. Real UPC/EAN
        // are digit-only and can never match <prefix>:<rest>, so ordering this
        // ahead of the UPC lookup cannot shadow a product scan.
        const scaleId = relayCfg.scale_id || null;
        if (scaleId) {
          const outcome = applyScanToComposition.execute({ scaleId, code: relay.code });
          if (outcome.handled) {
            barcodeLogger?.info?.('barcode_relay.nutriscan', {
              device: relay.device, scaleId, kind: outcome.kind, ok: outcome.ok !== false,
              error: outcome.error || null,
            });
            return;
          }
        } else {
          barcodeLogger?.warn?.('barcode_relay.nutriscan.no_scale_id', { device: relay.device });
        }

        // ... existing UPC path unchanged from here
```

A missing `scale_id` degrades to today's UPC-only behavior with a warning rather than dropping the scan.

**Step 3: Verify end to end against the running backend**

Restart the backend (config is cached at startup), then simulate a scan on the event bus and confirm the branch fires:

```bash
# Expect: barcode_relay.nutriscan with kind=density, and NO nutribot UPC lookup
grep -E 'barcode_relay\.(nutriscan|nutribot)' dev.log | tail -20
```

Scan a printed `dl:4` from Task 6's sheet, or inject a WS message with
`{ source:'barcode-relay', type:'scan', device:'nutribot-upc', route:'nutribot', code:'dl:4' }`.

Then scan a real product UPC and confirm `barcode_relay.nutriscan` does **not** appear and the UPC lookup still runs.

**Step 4: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat(nutrition): route fridge-sheet scans to nutriscan before UPC"
```

---

## Task 5: Acknowledge the tare in the live Telegram prompt

A scanned container has to be visible on the message, otherwise the only feedback that a tare landed is the calorie number changing — and if the id was wrong, nothing changes at all and the user has no way to tell.

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromScale.mjs`
- Modify: `backend/src/3_applications/hardware/ScaleNutribotBridge.mjs`
- Modify: `backend/src/app.mjs` (call the refresh after a handled scan)
- Test: `tests/unit/applications/nutribot/logFoodFromScaleComposition.test.mjs`

**Step 1: Write the failing test**

Test the rendered prompt text, which is the thing the user actually sees.

```javascript
import { describe, it, expect } from 'vitest';
import { buildScalePromptText } from '#apps/nutribot/usecases/LogFoodFromScale.mjs';

describe('buildScalePromptText', () => {
  it('shows gross only when nothing is tared', () => {
    const text = buildScalePromptText({ gross: 420, composition: { container: null } }, { items: [] });
    expect(text).toContain('420');
    expect(text).not.toMatch(/net/i);
  });

  it('names the container and shows the net once a tare is scanned', () => {
    const text = buildScalePromptText(
      { gross: 420, composition: { container: 'mug' } },
      { items: [{ id: 'mug', label: 'Mug', emoji: '☕', grams: 350 }] },
    );
    expect(text).toContain('☕ Mug');
    expect(text).toContain('350');
    expect(text).toMatch(/70\s*g/);   // 420 gross - 350 tare
  });

  it('flags a container that is no longer in config rather than dropping it', () => {
    const text = buildScalePromptText(
      { gross: 420, composition: { container: 'teapot' } },
      { items: [] },
    );
    expect(text).toMatch(/unknown container/i);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/applications/nutribot/logFoodFromScaleComposition.test.mjs`
Expected: FAIL — `buildScalePromptText` is not exported.

**Step 3: Extract and extend the prompt text builder**

Export a pure builder from `LogFoodFromScale.mjs` and have both the create and edit paths call it. Keep it pure — no store access — so it stays testable.

```javascript
/**
 * Prompt body for a scale placement. Pure: the caller supplies the composition
 * snapshot and the container table.
 *
 * The container line is the tare ACK. Without it the only signal that a `ct:`
 * scan registered is the calorie figure moving, and a mistyped/renamed id moves
 * nothing at all — indistinguishable from a scan that never registered.
 */
export function buildScalePromptText({ gross, composition = {} }, containers = { items: [] }) {
  const lines = [`⚖️ ${gross} g`];

  if (composition.container) {
    const item = (containers.items || []).find((c) => c.id === composition.container);
    if (item) {
      const net = Math.max(0, gross - item.grams);
      lines[0] = `⚖️ ${gross} g gross`;
      lines.push(`➖ ${item.emoji || ''} ${item.label || item.id} (${item.grams} g)`.trim());
      lines.push(`= ${net} g net`);
    } else {
      lines.push(`⚠️ unknown container "${composition.container}" — not tared`);
    }
  }

  return lines.join('\n');
}
```

Then thread a `composition` input through `execute()` and use it on both the create and the `existingLogUuid && messageId` edit branch, so a refresh re-renders with the current buffer.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/applications/nutribot/logFoodFromScaleComposition.test.mjs`
Expected: PASS (3 tests)

**Step 5: Expose `refreshPrompt` on the bridge**

The scan handler has no access to `s.live` — that map is bridge-internal, and it must stay that way or the single-live invariant has two owners. Add a method to the object `createScaleNutribotBridge` returns:

```javascript
  /**
   * Re-render the live prompt for a scale after its composition changed
   * (a `ct:` or `dl:` scan). No-op when nothing is live — the buffer keeps the
   * selection and the next prompt renders it.
   *
   * @param {string} scaleId
   * @returns {Promise<boolean>} whether a live prompt was refreshed
   */
  const refreshPrompt = async (scaleId) => {
    const s = scales.get(scaleId);
    if (!s?.live) return false;
    try {
      const res = await editInPlace(s.live.grams, scaleId, s.live);
      return Boolean(res?.edited);
    } catch (err) {
      logger.warn?.('scaleNutribot.refresh.failed', { scaleId, error: err.message });
      return false;
    }
  };

  return { dispose, refreshPrompt };
```

`editInPlace` must now pass the composition snapshot through, so add `composition: compositionStore.read(scaleId)` to both `create` and `editInPlace`.

**Step 6: Call it from the scan handler**

In `app.mjs`, extend the nutriscan branch from Task 4:

```javascript
          if (outcome.handled) {
            barcodeLogger?.info?.('barcode_relay.nutriscan', {
              device: relay.device, scaleId, kind: outcome.kind, ok: outcome.ok !== false,
              error: outcome.error || null,
            });
            // ACK on the message the user is already looking at. Fire-and-forget:
            // a failed edit must not swallow a scan that already landed in the buffer.
            if (outcome.ok !== false) {
              scaleNutribotBridge.refreshPrompt?.(scaleId).catch(() => {});
            }
            return;
          }
```

This requires `scaleNutribotBridge` to be in scope at the `createBarcodeRelay` call site. If the bridge is currently constructed *after* the barcode relay, hoist its construction above — or pass a late-bound getter. Do not duplicate the bridge.

**Step 7: Verify on the real device**

With a weight on the scale and a live prompt in Telegram, scan `ct:mug`. The existing message should edit in place to show the container line and the net — no new message.

```bash
grep -E 'barcode_relay\.nutriscan|logScale\.edited' dev.log | tail
```

Then scan `ct:teapot` (an id not in config) and confirm the message shows the unknown-container warning rather than changing silently.

**Step 8: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/LogFoodFromScale.mjs \
        backend/src/3_applications/hardware/ScaleNutribotBridge.mjs \
        backend/src/app.mjs \
        tests/unit/applications/nutribot/logFoodFromScaleComposition.test.mjs
git commit -m "feat(nutrition): ACK scanned tare on the live scale prompt"
```

---

## Task 6: QR sheet renderer + endpoint

**Files:**
- Create: `backend/src/1_rendering/nutribot/QRSheetRenderer.mjs`
- Create: `backend/src/4_api/v1/routers/nutritionSheet.mjs`
- Modify: `backend/src/app.mjs` (mount the router)
- Test: `tests/unit/rendering/nutribot/QRSheetRenderer.test.mjs`

**Step 1: Write the failing test**

Test the code generation, not the PDF bytes — the contract that matters is that every printed code round-trips through `parseScan`.

```javascript
import { describe, it, expect } from 'vitest';
import { buildSheetSections } from '#rendering/nutribot/QRSheetRenderer.mjs';
import { parseScan } from '#domains/nutrition/index.mjs';

const CONFIG = {
  densityLevels: [
    { level: 1, label: 'Watery', emoji: '🥬', kcal_per_g: 0.2 },
    { level: 2, label: 'Light', emoji: '🥗', kcal_per_g: 0.6 },
  ],
  containers: { items: [{ id: 'mug', label: 'Mug', emoji: '☕', grams: 350 }] },
};

describe('buildSheetSections', () => {
  it('emits a density section, a container section, and a reset code', () => {
    const s = buildSheetSections(CONFIG);
    expect(s.map((x) => x.title)).toEqual(['Caloric density', 'Containers', 'Reset']);
  });

  it('every printed code parses back to what it claims to be', () => {
    for (const section of buildSheetSections(CONFIG)) {
      for (const cell of section.cells) {
        expect(parseScan(cell.code)).not.toBeNull();
      }
    }
  });

  it('round-trips a density cell to its own level', () => {
    const [density] = buildSheetSections(CONFIG);
    expect(parseScan(density.cells[1].code)).toEqual({ kind: 'density', level: 2 });
  });

  it('throws on an unprintable container id rather than emitting a dead QR', () => {
    expect(() => buildSheetSections({
      ...CONFIG,
      containers: { items: [{ id: 'Mug', label: 'Mug', grams: 350 }] },
    })).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/rendering/nutribot/QRSheetRenderer.test.mjs`
Expected: FAIL — module not found.

**Step 3: Write the section builder + PDF renderer**

```javascript
/**
 * Printable fridge sheet: every scannable code the nutriscan grammar accepts.
 *
 * Codes come from the ScanVocabularyService encoders, never from local string
 * concatenation. The encoders throw on anything `parseScan` would decline, so a
 * bad container id in YAML fails this render instead of printing a QR that can
 * only be fixed by reprinting a laminated page.
 *
 * @module rendering/nutribot/QRSheetRenderer
 */

import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { encodeContainer, encodeDensity, RESET_CODE } from '#domains/nutrition/index.mjs';
import { createQRCodeRenderer } from '#rendering/qrcode/index.mjs';

const PAGE_WIDTH = 612;   // US Letter
const PAGE_HEIGHT = 792;
const MARGIN = 36;
const COLS = 4;           // 4-up keeps each QR large enough to scan off a fridge door
const CELL_GAP = 10;
const SECTION_HEADER = 22;

/**
 * @param {{densityLevels: Array, containers: {items: Array}}} config
 * @returns {Array<{title: string, cells: Array<{code: string, label: string, sublabel: string}>}>}
 */
export function buildSheetSections(config) {
  const densities = (config.densityLevels || []).map((l) => ({
    code: encodeDensity(l.level),
    label: `${l.emoji || ''} ${l.label || `L${l.level}`}`.trim(),
    sublabel: `${l.kcal_per_g} kcal/g`,
  }));

  const containers = (config.containers?.items || []).map((c) => ({
    code: encodeContainer(c.id),
    label: `${c.emoji || ''} ${c.label || c.id}`.trim(),
    sublabel: `${c.grams} g`,
  }));

  return [
    { title: 'Caloric density', cells: densities },
    { title: 'Containers', cells: containers },
    { title: 'Reset', cells: [{ code: RESET_CODE, label: '❌ Clear', sublabel: 'discard selection' }] },
  ];
}

/**
 * @param {object} config Normalized scan config.
 * @param {{version?: string}} [meta] Stamped in the footer so a laminated sheet
 *   can be matched to the config that produced it.
 * @returns {NodeJS.ReadableStream} A pdfkit document (already `end()`ed).
 */
export function renderSheetPdf(config, meta = {}) {
  const sections = buildSheetSections(config);
  const qr = createQRCodeRenderer();

  const doc = new PDFDocument({ size: [PAGE_WIDTH, PAGE_HEIGHT], margin: MARGIN });
  const contentWidth = PAGE_WIDTH - MARGIN * 2;
  const cellWidth = (contentWidth - (COLS - 1) * CELL_GAP) / COLS;
  const cellHeight = cellWidth + 26;

  let y = MARGIN;

  for (const section of sections) {
    if (!section.cells.length) continue;

    if (y + SECTION_HEADER + cellHeight > PAGE_HEIGHT - MARGIN) { doc.addPage(); y = MARGIN; }
    doc.fontSize(13).text(section.title, MARGIN, y);
    y += SECTION_HEADER;

    section.cells.forEach((cell, i) => {
      const col = i % COLS;
      if (col === 0 && i > 0) y += cellHeight + CELL_GAP;
      if (y + cellHeight > PAGE_HEIGHT - MARGIN) { doc.addPage(); y = MARGIN; }

      const svg = qr.renderSvg(cell.code, {
        size: Math.round(cellWidth),
        label: cell.label,
        sublabel: cell.sublabel,
      });
      SVGtoPDF(doc, svg, MARGIN + col * (cellWidth + CELL_GAP), y, { width: cellWidth });
    });

    y += cellHeight + CELL_GAP * 2;
  }

  doc.fontSize(8).text(
    `nutriscan sheet — config ${meta.version || 'unversioned'}`,
    MARGIN, PAGE_HEIGHT - MARGIN + 8,
  );

  doc.end();
  return doc;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/rendering/nutribot/QRSheetRenderer.test.mjs`
Expected: PASS (4 tests)

**Step 5: Add the router**

```javascript
/**
 * GET /api/v1/nutrition-sheet → printable PDF of every nutriscan code.
 * @module api/v1/routers/nutritionSheet
 */

import express from 'express';
import { renderSheetPdf } from '#rendering/nutribot/QRSheetRenderer.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

export function createNutritionSheetRouter({ configService, householdId, logger = console }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    try {
      const raw = configService.getHouseholdAppConfig(householdId, 'scales') || {};
      const config = normalizeScaleNutribotConfig(raw);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="nutrition-sheet.pdf"');
      // Let an encoder throw reach the client as a 500 with its message — a
      // silently skipped entry would print a sheet missing a code nobody notices.
      renderSheetPdf(config, { version: raw.version }).pipe(res);
    } catch (err) {
      logger.error?.('nutrition_sheet.render.failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
```

Mount it in `app.mjs` beside the other v1 routers:

```javascript
apiV1.use('/nutrition-sheet', createNutritionSheetRouter({ configService, householdId, logger: rootLogger }));
```

**Step 6: Verify it renders**

```bash
curl -s -o /tmp/sheet.pdf -w "%{http_code} %{content_type} %{size_download}\n" \
  http://localhost:3112/api/v1/nutrition-sheet
```

Expected: `200 application/pdf` with a non-trivial size. Open it and confirm each cell shows a QR with its label.

**Step 7: Commit**

```bash
git add backend/src/1_rendering/nutribot/QRSheetRenderer.mjs \
        backend/src/4_api/v1/routers/nutritionSheet.mjs \
        backend/src/app.mjs \
        tests/unit/rendering/nutribot/QRSheetRenderer.test.mjs
git commit -m "feat(nutrition): printable fridge QR sheet endpoint"
```

---

## Task 7: Author the real config

Data, not code — edit under `$DAYLIGHT_BASE_PATH/data`, never in the repo.

**Step 1: Add `scale_id` to the relay record**

In `data/household/config/barcode-relay.yml`, under `relays.nutribot-upc`:

```yaml
    scale_id: kitchen-food-scale
```

**Step 2: Append the `nutribot:` block to `data/household/config/scales.yml`**

Start from the `nutribot:` block in `_extensions/food-scale-relay/config.example.yml`, then for each of the 9 density levels add a `macros` split summing to 100 and an optional `per_100g`:

```yaml
  density_levels:
    - level: 1
      label: "Watery"
      emoji: "🥬"
      kcal_per_g: 0.2
      macros:   { fat_pct: 10, carb_pct: 70, protein_pct: 20 }
      per_100g: { fiber_g: 2, sugar_g: 3, sodium_mg: 40 }
    # … levels 2-9
```

Expand `containers.items` toward ~25 real vessels. Ids must be lowercase alphanumeric + hyphens (`encodeContainer` rejects anything else, and Task 2's validator will refuse the file at startup).

**Step 3: Restart and confirm the validator accepts it**

```bash
pkill -f 'node backend/index.js' && node backend/index.js 2>&1 | head -40
```

Expected: no `ValidationError` on boot. A thrown `MALFORMED_DENSITY_LEVEL` names the offending level — fix that row and restart.

**Step 4: Print and physically verify**

Print `/api/v1/nutrition-sheet` on plain paper first. Scan several codes off the printed page with the DS6878 at fridge distance in kitchen lighting, and confirm `barcode_relay.nutriscan` in the log for each. **Then** laminate. Print legibility is the one thing no test covers.

---

## Task 8: Correct the docs

**Files:**
- Modify: `docs/reference/nutrition/README.md`
- Modify: `docs/plans/2026-07-21-scan-enriched-food-logging-design.md`

Fix, at minimum:

1. **The `route: content` claim** (README:54, and the design doc's fall-through reasoning). The live scanner is `route: nutribot`; discrimination is by code-string namespace inside that branch. Replace the "handed onward to content dispatch" paragraph.
2. **"A product's own UPC does not work at the fridge"** in Known gaps — no longer true; that's the whole point of three-way routing. Remove it.
3. **"An unknown container id produces a silent zero tare"** in Known gaps — closed by D2. Remove it.
4. **The Config section** — document both files and what each owns, per the "Where the config lives" section above.
5. **Implementation status table** — flip the rows this plan delivers.

```bash
git add docs/reference/nutrition/README.md docs/plans/2026-07-21-scan-enriched-food-logging-design.md
git commit -m "docs(nutrition): correct fridge scanner route, close two known gaps"
```

---

## Still out of scope

- **`unit` does not gate `complete`.** A `ml` reading still counts toward a complete buffer. That refusal belongs in the bridge, not here.
- **Single-user attribution** — every scan-enriched entry lands on the head of household.
- **Backend restart loses the buffer** with no signal.
- **Memo / voice flow-state branch.**
