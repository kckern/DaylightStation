# Nutribot Input Fusion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a weight, a `ct:`/`dl:` scan and a control code fuse into one correct food-log entry that commits on its own and always tells the user what happened.

**Architecture:** No new subsystem. `CompositionStore` already converges on any arrival order (70 tests) and `ScaleNutribotBridge` already posts one prompt per placement and ends it on the return-to-rest crossing. This plan (a) makes the scan config incapable of silently disabling the feature, (b) adds a quiet-commit timer to the bridge, (c) makes a refused scan visible, and (d) stops a millilitre reading being recorded as grams.

**Tech Stack:** Node ESM (`.mjs`), Vitest, YAML config in the Docker data volume.

**Design:** [`2026-08-18-nutribot-input-fusion-design.md`](./2026-08-18-nutribot-input-fusion-design.md)
**Reference:** [`docs/reference/nutrition/README.md`](../../reference/nutrition/README.md)

## Scope

This plan covers design items 1, 2, 3, 5 and 6. **Item 4 (the memo flow) is deliberately excluded** — it is a separate surface (Telegram conversation state plus an AI macro re-split) with its own failure modes, and it needs its own spec-level decisions about prompt shape and rejection logging. It gets its own plan once this lands. Everything here is independently useful without it.

## Global Constraints

- Files are ES modules (`.mjs`), imported via the `#domains/…`, `#composition/…` subpath aliases. Barrel imports need the explicit `/index.mjs` — a bare directory import throws `ERR_UNSUPPORTED_DIR_IMPORT` under plain Node even though Vitest resolves it.
- Tests live under `tests/unit/**`. **Do not add tests under `tests/unit/suite/`** — that tree is excluded by `vitest.config` as stale duplicates.
- Run tests with `npx vitest run <path>`. From a git worktree the binary lives in the main checkout: `/opt/Code/DaylightStation/node_modules/.bin/vitest run <path>`.
- Never use raw `console.*` for diagnostics; use the injected `logger`.
- **Never `rm` inside the data tree.** Move unwanted files to `data/_deleteme/`.
- Density macros must sum to 100 (`validateScanConfig`), and no two density rows may round to the same `dl:` code.
- The quiet interval default is **25 seconds**, configurable as `nutribot.commitQuietSec`.

---

### Task 1: Config can no longer disable itself by omission

The live `scales.yml` overrides `density_levels` to attach `icon:` and drops `macros`, so `validateScanConfig` throws `MALFORMED_DENSITY_LEVEL` on every boot and the whole scan feature is `null`. Editing the YAML fixes today; backfilling from the code defaults fixes the class.

**Files:**
- Modify: `backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs`
- Test: `tests/unit/applications/nutribot/scaleNutribotConfig.test.mjs`

**Interfaces:**
- Consumes: `DEFAULT_DENSITY_LEVELS` (already exported from the same file).
- Produces: `normalizeScaleNutribotConfig(raw)` returns density rows that always carry `macros`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/applications/nutribot/scaleNutribotConfig.test.mjs
import { describe, it, expect } from 'vitest';
import { normalizeScaleNutribotConfig, DEFAULT_DENSITY_LEVELS }
  from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

describe('normalizeScaleNutribotConfig — macros backfill', () => {
  // Attaching a cosmetic field must never cost a required one. The live
  // scales.yml overrode this table purely to add `icon:` and dropped `macros`,
  // which disabled every ct:/dl:/rs: scan in the house for weeks.
  it('fills macros from the code defaults when a row omits them', () => {
    const cfg = normalizeScaleNutribotConfig({
      nutribot: {
        density_levels: [
          { level: 4, label: 'Mixed', kcal_per_g: 1.4, icon: 'food/rice-bowl' },
        ],
      },
    });
    const row = cfg.densityLevels.find((r) => r.level === 4);
    expect(row.icon).toBe('food/rice-bowl');
    expect(row.macros).toEqual(
      DEFAULT_DENSITY_LEVELS.find((d) => d.level === 4).macros,
    );
  });

  it('leaves explicit macros alone', () => {
    const macros = { fat_pct: 50, carb_pct: 30, protein_pct: 20 };
    const cfg = normalizeScaleNutribotConfig({
      nutribot: { density_levels: [{ level: 4, label: 'Mixed', kcal_per_g: 1.4, macros }] },
    });
    expect(cfg.densityLevels.find((r) => r.level === 4).macros).toEqual(macros);
  });

  // A level with no default to borrow from must still fail loudly downstream
  // rather than be invented.
  it('does not invent macros for a level the defaults do not have', () => {
    const cfg = normalizeScaleNutribotConfig({
      nutribot: { density_levels: [{ level: 42, label: 'Odd', kcal_per_g: 2.0 }] },
    });
    expect(cfg.densityLevels.find((r) => r.level === 42).macros).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/applications/nutribot/scaleNutribotConfig.test.mjs -t "macros backfill"`
Expected: FAIL — the first case reports `row.macros` as `undefined`.

- [ ] **Step 3: Implement the backfill**

In `normalizeScaleNutribotConfig`, where the density rows are mapped, borrow `macros` by level:

```javascript
const DEFAULT_MACROS_BY_LEVEL = new Map(
  DEFAULT_DENSITY_LEVELS.map((d) => [d.level, d.macros]),
);

// Attaching a cosmetic field (an `icon:`) must not cost a required one. An
// override that omits `macros` borrows the default for its LEVEL rather than
// disabling nutriscan wholesale, which is what dropping them used to do.
// A level with no default keeps `undefined` so validateScanConfig still
// refuses it by name.
const withMacros = (row) => (
  row.macros ? row : { ...row, macros: DEFAULT_MACROS_BY_LEVEL.get(row.level) }
);
```

Apply `withMacros` to each row of the configured `density_levels` before they are returned. Do not apply it when falling back to `DEFAULT_DENSITY_LEVELS` wholesale — those already carry macros.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/applications/nutribot/scaleNutribotConfig.test.mjs`
Expected: PASS, and the pre-existing cases in that file still pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs \
        tests/unit/applications/nutribot/scaleNutribotConfig.test.mjs
git commit -m "fix(nutribot): an icon override can no longer drop macros and disable every scan"
```

---

### Task 2: Restore macros in the live config and confirm nutriscan boots

Task 1 makes the omission survivable; this makes the running system correct and proves it.

**Files:**
- Modify (data volume, NOT in git): `data/household/config/scales.yml`

- [ ] **Step 1: Confirm the failure is present**

```bash
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query=_time:[2026-08-18T00:00:00Z, 2026-08-19T23:59:59Z] AND "nutriscan.config.invalid"' -d 'limit=5'
```
Expected: rows with `data.code: MALFORMED_DENSITY_LEVEL`.
Note: the log store's `_time` is local time with a `Z` suffix — use absolute ranges, not `_time:1h`.

- [ ] **Step 2: Add macros to all nine density rows**

Read the file first, then write it back complete — **never `sed -i` YAML in the container.**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/scales.yml' > /tmp/scales.yml
```

Add the matching `macros` to each row under `nutribot.density_levels`, values taken verbatim from `DEFAULT_DENSITY_LEVELS`:

```yaml
    - { level: 1, label: "Watery", emoji: "🥬", kcal_per_g: 0.2, hint: "broth, greens",        icon: food/lettuce,    macros: { fat_pct: 10, carb_pct: 60, protein_pct: 30 } }
    - { level: 2, label: "Light",  emoji: "🥗", kcal_per_g: 0.6, hint: "salad, fruit",         icon: food/veg,        macros: { fat_pct: 15, carb_pct: 70, protein_pct: 15 } }
    - { level: 3, label: "Lean",   emoji: "🍲", kcal_per_g: 1.0, hint: "soup, lean meat",      icon: food/salad,      macros: { fat_pct: 20, carb_pct: 45, protein_pct: 35 } }
    - { level: 4, label: "Mixed",  emoji: "🍛", kcal_per_g: 1.4, hint: "rice + veg + protein", icon: food/rice-bowl,  macros: { fat_pct: 25, carb_pct: 50, protein_pct: 25 } }
    - { level: 5, label: "Hearty", emoji: "🍝", kcal_per_g: 1.9, hint: "pasta, casserole",     icon: food/sandwich,   macros: { fat_pct: 30, carb_pct: 50, protein_pct: 20 } }
    - { level: 6, label: "Heavy",  emoji: "🍕", kcal_per_g: 2.6, hint: "pizza, fried",         icon: food/pizza,      macros: { fat_pct: 40, carb_pct: 45, protein_pct: 15 } }
    - { level: 7, label: "Rich",   emoji: "🧀", kcal_per_g: 3.8, hint: "cheese, creamy",       icon: food/cheese,     macros: { fat_pct: 65, carb_pct: 15, protein_pct: 20 } }
    - { level: 8, label: "Thick",  emoji: "🥜", kcal_per_g: 6.0, hint: "nuts, nut butter",     icon: food/peanut,     macros: { fat_pct: 75, carb_pct: 15, protein_pct: 10 } }
    - { level: 9, label: "Oil",    emoji: "🫒", kcal_per_g: 8.5, hint: "oil, butter",          icon: food/oil-jar,    macros: { fat_pct: 100, carb_pct: 0, protein_pct: 0 } }
```

Write it back:
```bash
sudo docker exec -i daylight-station sh -c 'cat > data/household/config/scales.yml' < /tmp/scales.yml
sudo docker exec daylight-station sh -c 'chown node:node data/household/config/scales.yml'
```
(`docker exec` runs as root, so the `chown` is required or the app cannot rewrite the file.)

- [ ] **Step 3: Restart and confirm nutriscan is enabled**

Check the deploy gate first — no `playback.render_fps` in the last 75s and `sessionActive:false` / `rosterSize:0`.

```bash
sudo docker restart daylight-station
sleep 45
sudo docker logs --since 90s daylight-station 2>&1 | grep -c "nutriscan.config.invalid"
```
Expected: `0`.

- [ ] **Step 4: Prove a scan now applies**

Put a weight on the kitchen scale, then scan `dl:140` and `ct:60`. Confirm in the log store (absolute time range) that `barcode_relay.nutriscan` appears with `ok: true` and **no** `barcode_relay.nutriscan.config_disabled`.

- [ ] **Step 5: Record the change**

The data volume is not version controlled, so note the edit in `docs/_wip/plans/` alongside this plan or in the ops log. No git commit for the YAML itself.

---

### Task 3: A refused scan says so

`handleNutrition`'s `swallow` branch returns without calling `refreshPrompt`, so the one path where nothing happened is the one path that says nothing.

**Files:**
- Modify: `backend/src/5_composition/modules/scanDispatch.mjs` (the `handleNutrition` function, `swallow` branch)
- Modify: `backend/src/3_applications/nutribot/lib/routeNutribotScan.mjs` (add a notice builder for swallow reasons)
- Test: `tests/unit/composition/scanDispatchNutriscanAck.test.mjs`

**Interfaces:**
- Consumes: `getScaleNutribotBridge()?.refreshPrompt(scaleId, notice)` → `Promise<boolean>`; `routeNutribotScan({scaleId, code, apply})` → `{action:'nutriscan'|'swallow'|'upc', reason?, outcome?}`.
- Produces: `swallowNotice(reason)` → `string`, exported from `routeNutribotScan.mjs`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/composition/scanDispatchNutriscanAck.test.mjs
import { describe, it, expect } from 'vitest';
import { swallowNotice } from '#apps/nutribot/lib/routeNutribotScan.mjs';

describe('swallowNotice', () => {
  it('explains a disabled scanner in words a person at the fridge can act on', () => {
    expect(swallowNotice('nutriscan-disabled'))
      .toBe('scanning is off — the fridge sheet is not configured');
  });

  it('explains a scanner with no scale', () => {
    expect(swallowNotice('no-scale-id')).toBe('no scale for this scanner');
  });

  // An unknown reason must still produce SOMETHING. Silence is the bug.
  it('never returns empty for an unrecognised reason', () => {
    expect(swallowNotice('some-new-reason')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/composition/scanDispatchNutriscanAck.test.mjs`
Expected: FAIL — `swallowNotice is not a function`.

- [ ] **Step 3: Add the notice builder**

In `backend/src/3_applications/nutribot/lib/routeNutribotScan.mjs`, beside `nutriscanRefusalNotice`:

```javascript
const SWALLOW_NOTICES = {
  'nutriscan-disabled': 'scanning is off — the fridge sheet is not configured',
  'no-scale-id': 'no scale for this scanner',
};

/**
 * One-line reason a code the grammar CLAIMED never reached the buffer.
 *
 * `nutriscanRefusalNotice` covers a scan the use case ran and rejected; this
 * covers one it never got to run at all. Both end up on the same transient `⚠️`
 * line, because from the fridge they are the same event: a beep that changed
 * nothing.
 */
export function swallowNotice(reason) {
  return SWALLOW_NOTICES[reason] || `scan not applied (${reason || 'unavailable'})`;
}
```

- [ ] **Step 4: Fire the ACK on the swallow branch**

In `scanDispatch.mjs`, inside `handleNutrition`'s `if (decision.action === 'swallow')` block, after the existing `emit(...)` logging and before `return`:

```javascript
      // ACK a refusal too. Without this the ONE path where nothing happened is
      // the one path that says nothing: the user gets a scanner beep, no change
      // on the prompt, and no way to tell a dead feature from a bad code.
      // Fire-and-forget, exactly like the nutriscan branch — a failed edit must
      // not turn a silent refusal into a thrown one.
      getScaleNutribotBridge()?.refreshPrompt?.(scaleId, swallowNotice(decision.reason))?.catch?.(() => {});
```

Add `swallowNotice` to the existing import from `routeNutribotScan.mjs`. Note `scaleId` is already in scope at the top of `handleNutrition`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/unit/composition/ tests/unit/applications/nutribot/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/5_composition/modules/scanDispatch.mjs \
        backend/src/3_applications/nutribot/lib/routeNutribotScan.mjs \
        tests/unit/composition/scanDispatchNutriscanAck.test.mjs
git commit -m "fix(nutribot): a swallowed scan now paints a reason on the prompt"
```

---

### Task 4: Pass the scale's unit through instead of asserting grams

`ScaleNutribotBridge` never reads `payload.unit` — it passes the literal `unit: 'g'` into both `setWeight` and the log use case, so a millilitre reading is silently relabelled.

**Files:**
- Modify: `backend/src/3_applications/hardware/ScaleNutribotBridge.mjs`
- Test: `tests/unit/applications/hardware/scaleNutribotBridgeComposition.test.mjs`

**Interfaces:**
- Consumes: event-bus payload `{ id, grams, unit, stable, event? }`.
- Produces: `compositionStore.setWeight(id, { grams, unit })` where `unit` is the reported one, defaulting to `'g'` only when the payload omits it.

- [ ] **Step 1: Write the failing test**

Append to the existing composition test file:

```javascript
describe('ScaleNutribotBridge unit passthrough', () => {
  it('buffers the unit the scale actually reported', async () => {
    const { bridge, compositionStore, publish } = makeBridge();  // existing helper
    await publish({ id: 'kitchen-food-scale', grams: 240, unit: 'ml', stable: true });
    expect(compositionStore.setWeight).toHaveBeenCalledWith(
      'kitchen-food-scale', { grams: 240, unit: 'ml' },
    );
    bridge.dispose();
  });

  it('falls back to grams only when the payload omits a unit', async () => {
    const { bridge, compositionStore, publish } = makeBridge();
    await publish({ id: 'kitchen-food-scale', grams: 240, stable: true });
    expect(compositionStore.setWeight).toHaveBeenCalledWith(
      'kitchen-food-scale', { grams: 240, unit: 'g' },
    );
    bridge.dispose();
  });
});
```

If `makeBridge` does not already exist in that file, build the bridge the same way the surrounding tests do and reuse that shape — do not invent a second harness.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/applications/hardware/scaleNutribotBridgeComposition.test.mjs -t "unit passthrough"`
Expected: FAIL — called with `{ grams: 240, unit: 'g' }` for the `ml` case.

- [ ] **Step 3: Thread the unit through**

In `ScaleNutribotBridge.mjs`:

```javascript
// The relay reports the unit on every frame and the scale really can send `ml`
// (decode.units maps 0x02 to it). Asserting 'g' here relabelled a volume as a
// mass, and nothing downstream could refuse what it was never told.
const bufferWeight = (id, grams, unit = 'g') => {
  if (!compositionStore) return;
  try { compositionStore.setWeight(id, { grams, unit }); }
  catch (err) { logger.warn?.('scaleNutribot.composition.setWeight.failed', { id, grams, unit, error: err.message }); }
};
```

Capture `const unit = typeof payload.unit === 'string' && payload.unit ? payload.unit : 'g';` in `onPayload`, thread it into `post(...)`/`editInPlace(...)` state as `s.live.unit`, and pass it to every `bufferWeight` call. Pass the same value in place of the literal `unit: 'g'` in the two `nutribotContainer.getLogFoodFromScale().execute({...})` calls.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/applications/hardware/`
Expected: PASS, including the pre-existing bridge tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/hardware/ScaleNutribotBridge.mjs \
        tests/unit/applications/hardware/scaleNutribotBridgeComposition.test.mjs
git commit -m "fix(nutribot): a millilitre reading is no longer recorded as grams"
```

---

### Task 5: WITHDRAWN — the unit refusal belongs to the application layer

**Status: withdrawn during execution. Do not implement. Superseded by Task 6.**

This task originally put the rule in `Composition.isComplete`. That contradicted a layering
decision this codebase states twice, in its own words:

> `it('is unaffected by the unit', () => {`
> `  // The composition carries 'ml' faithfully; refusing a volumetric unit is`
> `  // the application layer's call, not this object's.`
> — `tests/unit/domains/nutrition/value-objects/Composition.test.mjs`

> **`unit` does not gate `complete`.** …that refusal belongs to `ApplyScanToComposition`.
> — `docs/reference/nutrition/README.md`

The design document agreed with the codebase; only this plan drifted. `isComplete` is a
STRUCTURAL claim — "the slots are filled" — and overloading it with a usability policy makes
its name lie. The safety property we actually need is narrower: *nothing may auto-commit a
volume*. That is a property of the commit path, not of the record.

An implementation attempt (`de13cdafc`) was made and reverted (`revert` commit follows it);
it had to rewrite two passing tests that asserted the documented contract, which is what
surfaced the conflict.

**The requirement now lives in Task 6, Step 3** — `commitNow` refuses to finalise unless the
snapshot's unit is grams. Same guarantee, correct layer, no rewritten tests.

---

### Task 6: Quiet-commit — finalise after 25s of no new input

**Files:**
- Modify: `backend/src/3_applications/hardware/ScaleNutribotBridge.mjs`
- Modify: `backend/src/app.mjs` (pass `commitQuietSec` from the normalized scale config)
- Test: `tests/unit/applications/hardware/scaleNutribotQuietCommit.test.mjs`

**Interfaces:**
- Consumes: `compositionStore.read(scaleId)` → `{ grams, unit, density, container, complete, active }`; `nutribotContainer.getAcceptFoodLog().execute({ userId, conversationId, logUuid, messageId })`; `s.live` = `{ logUuid, messageId, grams }`.
- Produces: `createScaleNutribotBridge({ …, commitQuietMs, scheduler })`. `scheduler` is `{ setTimeout, clearTimeout }`, defaulting to the globals — injected so tests need no fake timers.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/applications/hardware/scaleNutribotQuietCommit.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { createScaleNutribotBridge } from '#apps/hardware/ScaleNutribotBridge.mjs';

// A scheduler we drive by hand: no fake timers, no real waiting.
function manualScheduler() {
  let pending = null;
  return {
    setTimeout: (fn, ms) => { pending = { fn, ms }; return 1; },
    clearTimeout: () => { pending = null; },
    fire: () => { const p = pending; pending = null; p?.fn(); },
    get pending() { return pending; },
  };
}

const makeHarness = ({ complete = true } = {}) => {
  const accept = { execute: vi.fn().mockResolvedValue({ success: true }) };
  const logFromScale = { execute: vi.fn().mockResolvedValue({ success: true, logUuid: 'L1', messageId: '9' }) };
  const compositionStore = {
    setWeight: vi.fn(), endPlacement: vi.fn(),
    read: vi.fn(() => ({ grams: 413, unit: 'g', density: 4, container: 'tupperware', complete, active: true })),
  };
  const handlers = {};
  const eventBus = { subscribe: (t, fn) => { handlers[t] = fn; return () => {}; } };
  const scheduler = manualScheduler();
  const bridge = createScaleNutribotBridge({
    eventBus,
    nutribotContainer: {
      getLogFoodFromScale: () => logFromScale,
      getAcceptFoodLog: () => accept,
      getRetractScaleLog: () => ({ execute: vi.fn() }),
    },
    userId: 'kckern', conversationId: 'telegram:b1_c2',
    scaleConfig: { minGrams: 5 },
    compositionStore,
    commitQuietMs: 25_000,
    scheduler,
    logger: { info() {}, warn() {}, debug() {} },
  });
  return { bridge, accept, compositionStore, scheduler, publish: (p) => handlers['food-scale'](p) };
};

describe('ScaleNutribotBridge quiet-commit', () => {
  it('commits the entry once the quiet interval elapses with the composition complete', async () => {
    const { bridge, accept, scheduler, publish } = makeHarness();
    await publish({ id: 'kitchen-food-scale', grams: 639, unit: 'g', stable: true });
    expect(accept.execute).not.toHaveBeenCalled();   // not yet — it is still quiet-waiting
    scheduler.fire();
    await Promise.resolve();
    expect(accept.execute).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'kckern', conversationId: 'telegram:b1_c2', logUuid: 'L1',
    }));
    bridge.dispose();
  });

  // Task 5 was withdrawn and folded in here: a volume must never auto-commit.
  it('does not commit a millilitre reading, however complete it looks', async () => {
    const { bridge, accept, scheduler, publish, compositionStore } = makeHarness();
    compositionStore.read = () => ({ grams: 240, unit: 'ml', density: 4, container: null, complete: true, active: true });
    await publish({ id: 'kitchen-food-scale', grams: 240, unit: 'ml', stable: true });
    scheduler.fire();
    await Promise.resolve();
    expect(accept.execute).not.toHaveBeenCalled();
    bridge.dispose();
  });

  it('does not commit while the composition is incomplete', async () => {
    const { bridge, accept, scheduler, publish } = makeHarness({ complete: false });
    await publish({ id: 'kitchen-food-scale', grams: 639, unit: 'g', stable: true });
    scheduler.fire();
    await Promise.resolve();
    expect(accept.execute).not.toHaveBeenCalled();
    bridge.dispose();
  });

  // The 12:31 incident: a container scanned 4.4s after the density must land
  // before the entry closes. Any applied input restarts the clock.
  it('restarts the interval when another input arrives', async () => {
    const { bridge, accept, scheduler, publish } = makeHarness();
    await publish({ id: 'kitchen-food-scale', grams: 639, unit: 'g', stable: true });
    await publish({ id: 'kitchen-food-scale', grams: 473, unit: 'g', stable: true });
    expect(scheduler.pending).not.toBeNull();
    scheduler.fire();
    await Promise.resolve();
    expect(accept.execute).toHaveBeenCalledTimes(1);
    bridge.dispose();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/applications/hardware/scaleNutribotQuietCommit.test.mjs`
Expected: FAIL — `accept.execute` never called; the bridge accepts neither `commitQuietMs` nor `scheduler`.

- [ ] **Step 3: Implement the timer**

Add to the factory destructure: `commitQuietMs = 25_000, scheduler = { setTimeout, clearTimeout },`.

Add to `stateFor`'s initial object: `commitTimer: null`.

Add near `bufferWeight`:

```javascript
  // THE QUIET COMMIT. Weight, density and container arrive as separate events
  // with no payload boundary, so "the composition is finished" is not an event
  // anyone sends — it is an absence. Committing the instant weight+density are
  // both present closed the entry 4.4s before the container scan that belonged
  // to it (the 12:31 incident); waiting for a lull catches the whole gesture.
  //
  // Restarted by APPLIED inputs only. Raw scale frames must never restart it,
  // for exactly the reason CompositionStore keeps them out of its own window
  // refresh: the scale heartbeats while it rests on its shelf, so a
  // frame-driven timer would never fire.
  const armCommit = (id, s) => {
    if (!compositionStore || !commitQuietMs) return;
    if (s.commitTimer) scheduler.clearTimeout(s.commitTimer);
    s.commitTimer = scheduler.setTimeout(() => {
      s.commitTimer = null;
      commitNow(id, s).catch((err) =>
        logger.warn?.('scaleNutribot.commit.failed', { id, error: err.message }));
    }, commitQuietMs);
  };

  const disarmCommit = (s) => {
    if (s.commitTimer) { scheduler.clearTimeout(s.commitTimer); s.commitTimer = null; }
  };

  const commitNow = async (id, s) => {
    if (!s.live) return;
    let snapshot = null;
    try { snapshot = compositionStore.read(id); }
    catch (err) { logger.warn?.('scaleNutribot.commit.read-failed', { id, error: err.message }); return; }
    if (!snapshot?.complete) {
      logger.info?.('scaleNutribot.commit.skipped', { id, reason: 'incomplete' });
      return;
    }
    // A volume cannot be multiplied by a kcal-per-GRAM density, so a millilitre
    // reading must never finalise itself. This lives HERE and not on
    // `Composition.isComplete`, which is a structural claim about filled slots —
    // the codebase says so in its own tests and reference doc, and quiet-commit
    // is the thing that makes a mislabelled reading dangerous rather than merely
    // wrong. An absent unit is grams (the relay contract).
    const unit = snapshot.unit ?? 'g';
    if (unit !== 'g') {
      logger.warn?.('scaleNutribot.commit.skipped', { id, reason: 'non-gram-unit', unit });
      return;
    }
    const uc = nutribotContainer.getAcceptFoodLog?.();
    if (!uc) return;
    await uc.execute({ userId, conversationId, logUuid: s.live.logUuid, messageId: s.live.messageId });
    logger.info?.('scaleNutribot.commit.committed', {
      id, logUuid: s.live.logUuid, grams: snapshot.grams, density: snapshot.density,
      container: snapshot.container ?? null,
    });
    s.live = null;
  };
```

Call `armCommit(id, s)` immediately after every successful `bufferWeight(...)` in `post` and in the edit-in-place branches. Call `disarmCommit(s)` in `bufferEndPlacement`'s caller (the placed→at-rest crossing) and inside `dispose`.

Export the arming hook so a scan can restart the clock: add `armCommitFor: (scaleId) => { const s = scales.get(scaleId); if (s) armCommit(scaleId, s); }` to the returned object, and call it from `scanDispatch.mjs`'s `nutriscan` branch right after `refreshPrompt`.

- [ ] **Step 4: Wire the config**

In `backend/src/app.mjs`, where `createScaleNutribotBridge` is constructed, add:

```javascript
        commitQuietMs: (nutribotServices.scaleConfig?.commitQuietSec ?? 25) * 1000,
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/unit/applications/hardware/`
Expected: PASS, including the pre-existing bridge and composition tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/hardware/ScaleNutribotBridge.mjs \
        backend/src/5_composition/modules/scanDispatch.mjs backend/src/app.mjs \
        tests/unit/applications/hardware/scaleNutribotQuietCommit.test.mjs
git commit -m "feat(nutribot): finalise an entry after 25s of quiet, not the instant it looks done"
```

---

### Task 7: Stop deleting the record of repeated refusals

`nutriscanWarned` warns once per reason per process and routes every repeat to `debug`, which is never shipped. That is why the `ct:60` refusal in the 12:31 incident exists nowhere.

**Files:**
- Modify: `backend/src/5_composition/modules/scanDispatch.mjs` (the `nutriscanWarned` block)
- Test: `tests/unit/composition/scanDispatchNutriscanAck.test.mjs` (extend)

**Interfaces:**
- Consumes: the injected `barcodeLogger`.
- Produces: repeated swallows emit at `warn` via `logger.sampled`, never at `debug`.

- [ ] **Step 1: Write the failing test**

```javascript
describe('repeated swallows stay observable', () => {
  it('never downgrades a refusal to debug', async () => {
    const levels = [];
    const barcodeLogger = {
      warn: (e) => levels.push(['warn', e]),
      debug: (e) => levels.push(['debug', e]),
      info: () => {},
      sampled: (e) => levels.push(['sampled', e]),
    };
    const dispatch = makeDispatcher({ barcodeLogger, nutriscanEnabled: false });
    await dispatch('dl:140');
    await dispatch('ct:60');
    await dispatch('dl:190');
    expect(levels.some(([lvl]) => lvl === 'debug')).toBe(false);
    expect(levels.filter(([lvl]) => lvl !== 'debug').length).toBe(3);
  });
});
```

Build `makeDispatcher` from the existing dispatcher construction in the neighbouring composition tests — reuse that harness rather than inventing one.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/composition/scanDispatchNutriscanAck.test.mjs -t "repeated swallows"`
Expected: FAIL — the second and third calls land on `debug`.

- [ ] **Step 3: Replace warn-once-then-debug with sampling**

Delete the `nutriscanWarned` Set and its branch, and emit unconditionally:

```javascript
      // Rate-limit WITHIN a level, never by dropping to one that is not shipped.
      // `debug` never reaches the log store, so downgrading repeats was deletion
      // rather than suppression — the second refusal of an incident simply did
      // not exist anywhere. `sampled` keeps a countable record instead.
      emitSampled(barcodeLogger, event, { device, code: raw }, { maxPerMinute: 6, aggregate: true });
```

Add a small `emitSampled` helper beside the existing `emit`, falling back to `warn` when the logger has no `sampled` method (the same defensive shape `emit` already uses).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/composition/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/5_composition/modules/scanDispatch.mjs \
        tests/unit/composition/scanDispatchNutriscanAck.test.mjs
git commit -m "fix(nutribot): repeated scan refusals stay in the log store instead of vanishing"
```

---

### Task 8: The 12:31 incident as a regression test

**Files:**
- Test: `tests/unit/applications/hardware/scaleNutribotIncident.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 4–6.

- [ ] **Step 1: Write the test**

```javascript
// tests/unit/applications/hardware/scaleNutribotIncident.test.mjs
//
// 2026-08-18 12:31 PM, reconstructed from the log store:
//   12:31:45  scale settles 639 g      -> prompt posted, stage: density
//   12:31:47  dl:140  (Mixed, 1.4)     -> swallowed; nutriscan was disabled
//   12:31:51  ct:60   (Tupperware)     -> swallowed, and logged nowhere at all
//   12:31:57  scale settles 473 g      -> entry edited, then stranded
// Net stayed equal to gross throughout: no tare, no density, no calories.
// With the fusion in place this is ONE entry of 413 g at 578 kcal.
import { describe, it, expect } from 'vitest';

describe('the 12:31 incident', () => {
  it('produces one committed entry of net 413 g', async () => {
    const { publish, scan, scheduler, accept, compositionStore } = makeIncidentHarness();
    await publish({ id: 'kitchen-food-scale', grams: 639, unit: 'g', stable: true });
    await scan('dl:140');
    await scan('ct:60');
    await publish({ id: 'kitchen-food-scale', grams: 473, unit: 'g', stable: true });

    expect(accept.execute).not.toHaveBeenCalled();   // still gathering
    scheduler.fire();
    await Promise.resolve();

    expect(accept.execute).toHaveBeenCalledTimes(1);
    const snapshot = compositionStore.read('kitchen-food-scale');
    expect(snapshot.grams).toBe(473);
    expect(snapshot.container).toBe('tupperware');
    expect(snapshot.density).toBe(4);
  });
});
```

Build `makeIncidentHarness` on the **real** `CompositionStore` and `ApplyScanToComposition` (not mocks) so the arithmetic is genuinely exercised; mock only the Telegram-facing use cases. Assert the derived net (413 g) and kcal (578) through `ScanNutritionService` rather than asserting a hard-coded product.

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/unit/applications/hardware/scaleNutribotIncident.test.mjs`
Expected: PASS.

- [ ] **Step 3: Add the permutation test**

Order independence is the correctness claim the whole feature rests on, and quiet-commit is the first thing that can break it — a timer armed by only *some* inputs converges differently depending on arrival order. `CompositionStore` already has this test for its own slots; this asserts it survives the timer.

```javascript
// Same three inputs, every order, on the real store. One entry, one commit,
// identical snapshot each time.
const INPUTS = [
  { kind: 'weight', apply: (h) => h.publish({ id: 'kitchen-food-scale', grams: 473, unit: 'g', stable: true }) },
  { kind: 'density', apply: (h) => h.scan('dl:140') },
  { kind: 'container', apply: (h) => h.scan('ct:60') },
];

const permutations = (xs) => (xs.length <= 1 ? [xs]
  : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));

it.each(permutations(INPUTS).map((p) => [p.map((s) => s.kind).join(' -> '), p]))(
  'converges the same for %s', async (_label, order) => {
    const h = makeIncidentHarness();
    for (const step of order) await step.apply(h);
    h.scheduler.fire();
    await Promise.resolve();
    expect(h.accept.execute).toHaveBeenCalledTimes(1);
    const snap = h.compositionStore.read('kitchen-food-scale');
    expect(snap).toMatchObject({ grams: 473, unit: 'g', density: 4, container: 'tupperware', complete: true });
  },
);
```

Note the weight-last orders exercise the case the old code got wrong: a scan arriving before any food is on the scale must still be waiting when the weight lands.

- [ ] **Step 4: Run the whole nutrition surface**

Run: `npx vitest run tests/unit/domains/nutrition/ tests/unit/applications/nutribot/ tests/unit/applications/hardware/ tests/unit/composition/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/applications/hardware/scaleNutribotIncident.test.mjs
git commit -m "test(nutribot): the 12:31 incident now produces one correct entry"
```

---

### Task 9: Update the reference doc

**Files:**
- Modify: `docs/reference/nutrition/README.md`

- [ ] **Step 1: Rewrite the status blurb and the implementation table**

Remove the "DISABLED IN PRODUCTION" lead once Task 2 is confirmed live. Mark unit passthrough shipped. Add quiet-commit and the refusal ACK as shipped rows. Move "a millilitre reading is recorded as grams" out of Known gaps. Leave the memo flow and `fd:` grammar as not started, and leave the restart-loses-the-buffer gap in place — this plan does not close it.

Reference docs are endstate: present tense, describing how it works now.

- [ ] **Step 2: Commit**

```bash
git add docs/reference/nutrition/README.md
git commit -m "docs(nutrition): the scan path applies again, and says so when it does not"
```

---

## Deferred to its own plan

- **The memo flow** (design item 4). Needs its own decisions on prompt shape, which fields the model may write, and how a rejected field is surfaced.
- **The `fd:` food grammar.** Foods still print as inert labels.
- **Persisting the composition buffer across restarts.** A restart still loses an in-flight buffer with no signal — more visible now that a committed entry survives and an in-flight one does not.
- **Multi-user attribution.** Every scan-enriched entry still attributes to the head of household.
- **Registering nutriscan in a degraded-features registry.** Design item 6 proposes surfacing a
  soft-failed subsystem at `GET /api/v1/health` instead of in one boot log line. That registry
  does not exist yet — it belongs to the wider observability work, not to this plan, and Task 1
  removes the specific failure that motivated it. Left open deliberately rather than half-built
  here.
