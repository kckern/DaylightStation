# Health Log Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved compact Health log, configurable density placement, and consistent numeric drag feedback.

**Architecture:** Shared pure density and adjustment functions provide identical arithmetic to browser previews and atomic API commands. Display preferences live independently of nutrition data. Extend the existing single-draft, versioned, idempotent portion workflow; do not create a parallel write path.

**Tech Stack:** React 18, Mantine 7, SCSS, ESM, Vitest, Playwright; existing dependencies only.

**Spec:** [Approved design](2026-09-06-health-log-controls-design.md).

## Global Constraints

- Two-column desktop meals; 28px minimum fine-pointer food rows; 44px coarse/mobile targets.
- All seven daily metrics use 24px desktop values, equal weight, fixed slots, and approximately 100px or less for date plus summary. No day density card.
- Child rows use 75% visual opacity; smaller circular macro visuals retain the meal's column centers.
- Placement B is default: artwork, density, name. Settings can switch to A: artwork, name, density.
- Food kcal uses a light card with dark text; budget neutral, exercise orange, under green, over red. Macro colors remain rose/sage/gold.
- Preserve unknown nutrition, partial coverage, non-additive group headers, user scoping, atomic commands, and confirmation semantics.
- Never treat ml as grams. Density endpoints are reference points, not validity limits.
- No production-data mutations during verification. Artwork ingestion and backfill remain a separate workstream.
- No automatic ratification. Use existing structured logging and dependency boundaries.

**Scope assumption, not a user-approved restriction:** implement direct adjustment on foods and grouped dishes. Meal/day totals stay calculated; Budget and Exercise retain their existing editors. The user's “all numbers” request may include aggregate editing. Resolve that meaning before expanding aggregate write behavior; layout and food controls can proceed independently.

## Execution context and file responsibilities

Read `CLAUDE.md`, machine-local instructions, and the spec before implementation. The planning branch is `feat/health-log-controls`, isolated at `.worktrees/health-log-controls`; inspect status before editing. Do not stage unrelated main-workspace files. Commands below run from this worktree. Baseline: 47 passing tests in EntryRow, EquationStrip, portionPreview, and CleanupQuestions; this is a pre-change baseline only.

| Unit | Responsibility |
|---|---|
| `shared/contracts/health/densityLevels.mjs` | Existing default ladder, unchanged names, values, macros, emoji, hints |
| `shared/contracts/health/foodDensity.mjs` | Coverage-aware density, physical bracketing, configuration revision |
| `shared/contracts/health/foodAdjustment.mjs` | Pure numeric patches and edit eligibility; no UI colors or persistence |
| `frontend/src/modules/Health/display/HealthDisplayPreferences.jsx` | User-scoped preference and current server density context |
| `frontend/src/modules/Health/display/HealthDisplaySettings.jsx` | Accessible placement control |
| `frontend/src/modules/Health/today/densityPresentation.js` | Color interpolation and human-readable density descriptions |
| `frontend/src/modules/Health/today/DensityBadge.jsx` | Secondary identity marker; later delegates editing to NumericControl |
| `frontend/src/modules/Health/today/NumericControl.jsx` | Pointer, keyboard, click editor integration |
| `frontend/src/modules/Health/today/NumericFeedback.jsx` | Popover content and scale, without write logic |
| Existing `usePortionDraft.js`, `portionPreview.js` | Single active draft, projection, retry, exact Undo |
| Existing `HealthOperations.mjs`, router, composition | Atomic commands, validation, normalized configuration wiring |

Each numbered task has its own red/green cycle and commit. Within a task, implement the listed small slices separately; do not combine all backend and frontend work into one change. New tests use Vitest, including backend tests. Existing unrelated node:test suites retain their runner.

## Task 1: Shared density read contract and server configuration

**Files:**
- Create `shared/contracts/health/densityLevels.mjs`, `foodDensity.mjs`, `foodDensity.test.mjs`.
- Modify `backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs` (extract/re-export defaults).
- Modify `backend/src/3_applications/health/HealthOperations.mjs` (constructor and context).
- Modify `backend/src/5_composition/modules/healthApi.mjs` (one normalized configuration thunk).
- Modify `backend/src/4_api/v1/routers/health.mjs` (`GET /context`).
- Create `backend/src/3_applications/health/HealthOperations.density.test.mjs`.

**Interfaces:**
- `DEFAULT_DENSITY_LEVELS`: exact existing nine objects from scaleNutribotConfig, without presentation colors.
- `foodDensity(row): number|null`; for group rows use attached children, never the non-additive header.
- `foodDensityOfRows(rows): number|null`; exclude group headers and non-counted statuses, require complete calorie and mass coverage, return null for no counted foods.
- `densityBracket(value, levels = DEFAULT_DENSITY_LEVELS): {lower, upper, fraction, outside}|null`; lower/upper are ladder objects; outside is `'below'|'above'|null`; exact rungs use the same lower/upper, fraction 0. Null for unknown value.
- `densityRevision(levels): string`: deterministic serialization of ordered level, kcal/g, and macro-share inputs. Serialize tuples `[level, kcal_per_g, macros.protein_pct, macros.carb_pct, macros.fat_pct]`; labels, emoji, and hints remain in the public ladder shape unchanged.
- `HealthOperations` accepts `densityLevels: () => Array`, defaulting to shared defaults. `context(): {userId, densityLevels, densityRevision}` reads this thunk once. The string is an equality token, not a security credential.

- [ ] **Write failing density examples** in `foodDensity.test.mjs`:
```js
import {describe, it, expect} from 'vitest';
import {foodDensity, foodDensityOfRows, densityRevision} from './foodDensity.mjs';
import {DEFAULT_DENSITY_LEVELS} from './densityLevels.mjs';
describe('food density', () => {
  it('requires actual mass and counts children once', () => {
    expect(foodDensity({grams:100, calories:250})).toBe(2.5);
    expect(foodDensity({grams:null, amount:100, unit:'ml', calories:250})).toBeNull();
    expect(foodDensity({grams:100, calories:0})).toBe(0);
    expect(foodDensityOfRows([
      {kind:'group', calories:0},
      {grams:100, calories:250}, {grams:50, calories:50},
    ])).toBe(2);
    expect(foodDensityOfRows([{grams:100, calories:null}])).toBeNull();
  });
  it('has a stable revision across serialization', () => {
    expect(densityRevision(JSON.parse(JSON.stringify(DEFAULT_DENSITY_LEVELS))))
      .toBe(densityRevision(DEFAULT_DENSITY_LEVELS));
  });
});
```
- [ ] **Run red:** `npx vitest run shared/contracts/health/foodDensity.test.mjs --maxWorkers=2`. Expect missing-module failure before implementation.
- [ ] **Extract defaults** without changing any object fields. Re-export from the old module to keep kitchen-scale callers compatible:
```js
import {DEFAULT_DENSITY_LEVELS} from '#shared-contracts/health/densityLevels.mjs';
export {DEFAULT_DENSITY_LEVELS};
```
The backend already maps `#shared-contracts/*` to its shared-contracts link; retain that mapping.
- [ ] **Implement coverage first:** use existing `foodGrams` and `isCountedRow`; require known finite nonnegative calories, positive mass. Compute `sumCalories / sumGrams`, not a mean of individual densities. Bracket by physical kcal/g positions; reject malformed configuration through the existing normalizer, not by silently sorting client data.
- [ ] **Add boundary tests** for exact level 1 and 9, between levels, zero below level 1, above 8.5, pending/deleted rows, and incomplete groups. For interpolation assert the fraction at the numeric midpoint is 0.5.
- [ ] **Wire one source of configuration:** hoist the existing thunk before constructing HealthOperations, reuse it for ObservationPairing, and return the operation's context from the router:
```js
const scaleConfig = () => normalizeScaleNutribotConfig(
  configService?.getHouseholdAppConfig?.(null, 'scales') || {},
);
// Options in the existing HealthOperations construction:
// densityLevels: () => scaleConfig().densityLevels
// Options in the existing ObservationPairing construction:
// scaleConfig
// Existing GET /context handler body:
res.json(healthOperations.context());
```
Add a real HealthOperations test with two successive thunk values: context reflects the new ladder and revision. Existing router test doubles must expose context; preserve default-user assertions.
- [ ] **Run green:** `npx vitest run shared/contracts/health/foodDensity.test.mjs backend/src/3_applications/health/HealthOperations.density.test.mjs --maxWorkers=2`.
- [ ] **Commit:** stage only the eight named files; `git commit -m "feat(health): share density ladder and context contract"`.

## Task 2: Density placement preference and compact meal rows

**Files:**
- Create `frontend/src/modules/Health/display/HealthDisplayPreferences.jsx`, `HealthDisplaySettings.jsx`, `HealthDisplayPreferences.test.jsx`.
- Create `frontend/src/modules/Health/today/densityPresentation.js`, `DensityBadge.jsx`, `DensityBadge.test.jsx`.
- Modify `frontend/src/Apps/HealthApp.jsx`, `frontend/src/modules/Health/cleanup/HealthSettings.jsx`.
- Modify `frontend/src/modules/Health/today/EntryRow.jsx`, `LogTable.jsx`, `MacroBadges.jsx`, `EntryRow.test.jsx`, `layout.contract.test.js`.
- Modify `frontend/src/modules/Health/health.scss`.

**Interfaces:**
- Provider props: `{userId, densityLevels = DEFAULT_DENSITY_LEVELS, densityRevision, children}`.
- `useHealthDisplayPreferences()` returns `{densityPlacement, setDensityPlacement, densityLevels, densityRevision}`. Bare component tests use B/default ladder and its computed revision.
- Storage key `health:display:<userId>`; JSON `{densityPlacement:'before'|'after'}`. Invalid or inaccessible storage defaults to before; writes still update in-memory state. Storage events update mounted consumers.
- `densityPresentation(value, levels)` returns `{color,label}` or null; consumes Task 1 bracketing. Palette: `#7fbddf`, `#71cfc1`, `#87ce95`, `#bbd37c`, `#edd477`, `#eda461`, `#dd795e`, `#c44859`, `#861e3f`.
- `DensityBadge({row, className = ''})` gets current levels from context. Unknown values render an explained unavailable marker. Meal headers pass a read-only rollup rather than an editable group.

- [ ] **Write failing placement behavior** with real provider and settings controls:
```jsx
import React from 'react';
import {it, expect} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import {MantineProvider} from '@mantine/core';
import {HealthDisplayPreferencesProvider, useHealthDisplayPreferences}
  from './HealthDisplayPreferences.jsx';
import HealthDisplaySettings from './HealthDisplaySettings.jsx';
function Probe() {
  const {densityPlacement} = useHealthDisplayPreferences();
  return <output data-testid="placement">{densityPlacement}</output>;
}
it('updates the mounted log and persists the chosen placement', () => {
  localStorage.removeItem('health:display:test-user');
  render(<MantineProvider><HealthDisplayPreferencesProvider userId="test-user">
    <HealthDisplaySettings/><Probe/>
  </HealthDisplayPreferencesProvider></MantineProvider>);
  expect(screen.getByTestId('placement').textContent).toBe('before');
  fireEvent.click(screen.getByLabelText('After food name'));
  expect(screen.getByTestId('placement').textContent).toBe('after');
  expect(JSON.parse(localStorage.getItem('health:display:test-user')))
    .toEqual({densityPlacement:'after'});
});
```
- [ ] **Run red:** `npx vitest run frontend/src/modules/Health/display/HealthDisplayPreferences.test.jsx --maxWorkers=2`.
- [ ] **Implement preference state and radio group.** Catch read/write failures; validate parsed shape. Subscribe/unsubscribe to storage events for the current user key. Wrap the existing resolved-user shell with this provider and pass the server ladder/revision. Export existing cleanup page logic as an internal component so its loading/error return cannot hide the display section:
```jsx
export default function HealthSettings() {
  return <><HealthDisplaySettings/><CleanupSettings/></>;
}
```
- [ ] **Extend preference tests:** remount same user retains A; another user defaults B; corrupt JSON falls back; storage event changes state; cleanup error leaves both placement options available.
- [ ] **Separate identity controls.** Density must be a sibling of the edit-name button. Keep PhotoStore/FoodIcon fallback logic and actual-child grouping intact. Use placement class to reorder siblings:
```jsx
<div className={`health-row-identity health-density-${densityPlacement}`}>
  <span className="health-row-artwork">{artwork}</span>
  <DensityBadge row={row}/>
  <UnstyledButton className="health-row-name" onClick={onEdit}>{name}</UnstyledButton>
</div>
```
Here `artwork`, `name`, and `onEdit` are the existing EntryRow render values/handler, retained rather than new data sources. With after placement, put density after the truncated name and prevent it shrinking; before placement reserves one fixed slot.
- [ ] **Implement row geometry:** share meal-local CSS grid tracks for headings, totals, groups, and items; identity alone absorbs name length. Set 28px fine-pointer minimum, 44px coarse/mobile controls, 75% child visual content opacity without dimming an open popover. Keep branch cells hit-testable; tree trunk aligns with artwork center, triangle uses text line-height and roughly `0.7em` visual height. Child macro circles stay centered in unchanged tracks. Density visual box is 24×14px inside its adequate hit area.
- [ ] **Test marker semantics:** exact/between/outside names and values remain available without color; unknown mass does not show a false blue zero. Update intentional old 48px source-layout assertions; preserve edit/confirm/collapse behavior tests.
- [ ] **Run green:** `npx vitest run frontend/src/modules/Health/display/HealthDisplayPreferences.test.jsx frontend/src/modules/Health/today/DensityBadge.test.jsx frontend/src/modules/Health/today/EntryRow.test.jsx frontend/src/modules/Health/today/layout.contract.test.js --maxWorkers=2`.
- [ ] **Commit:** stage the named files only; `git commit -m "feat(health): add compact rows and density placement setting"`.

## Task 3: Compact, stable daily rollup

**Files:** modify `frontend/src/modules/Health/today/EquationStrip.jsx`, `EquationStrip.test.jsx`, `MacroBarRow.jsx`, `TodayView.jsx`; modify `frontend/src/modules/Health/health.scss`.

**Interfaces:** `EquationStrip` adds `macroCoverage` (the existing `nutrientSummary(items)` object). `MacroBarRow` adds `showIntake = true`; Today passes false while retaining goals, watched micros, and coverage captions. Existing budget/date/goal editor props remain supported.

- [ ] **Add a failing header case** to the existing Mantine-wrapped EquationStrip tests: render budget 2100, food 1280, exercise 320, under 1140 plus P/C/F coverage values 60/100/30. Assert seven labeled metrics, Food value 1280, no density, and an unknown macro remains unavailable rather than zero. Reuse the existing render helper and budget fixture; these expectations intentionally replace the old concatenated visual label:
```jsx
expect(screen.getByLabelText('Food calories')).toHaveTextContent('1,280');
expect(screen.getByLabelText('Protein')).toHaveTextContent('60');
expect(screen.queryByLabelText(/daily density/i)).not.toBeInTheDocument();
```
- [ ] **Run red:** `npx vitest run frontend/src/modules/Health/today/EquationStrip.test.jsx --maxWorkers=2`.
- [ ] **Render the seven metrics** with semantic labels and stable value/unit/operator spans. Use the existing formatter and under/over equation. Food's color belongs to its card, not a green value. Scope `aria-label="Protein"` to the daily metric so it does not collide with food controls labeled with food names.
- [ ] **Implement shared numeric sizing** and fixed tracks:
```scss
.health-daily-metric-value {
  font-size: 24px;
  font-weight: 600;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.health-daily-metric-number { display: inline-block; min-width: 5ch; }
```
Use responsive grid sizing for narrow widths, reducing all seven values together. Reserve operator and Under/Over label width; do not let changing content redefine adjacent card tracks.
- [ ] **Connect coverage:** Today passes `nutrientSummary(preview.items)`, preserves partial `+` and unknown captions, and sets `showIntake={false}` on MacroBarRow. Keep the 409 “Set up goals” path and goal/micro bars.
- [ ] **Run green:** `npx vitest run frontend/src/modules/Health/today/EquationStrip.test.jsx frontend/src/modules/Health/today/EntryRow.test.jsx --maxWorkers=2`.
- [ ] **Commit:** stage the five named files; `git commit -m "feat(health): compact and stabilize the daily rollup"`.

## Task 4: Pure adjustment arithmetic

**Files:** create `shared/contracts/health/foodAdjustment.mjs`, `foodAdjustment.test.mjs`. Reuse `foodQuantity.mjs`, `foodDensity.mjs`, and `nutrition/countedRows.mjs` without duplicating their coverage rules.

**Interfaces:**
- Field union: `'portion'|'protein'|'carbs'|'fat'|'calories'|'density'`.
- `adjustmentValue(row, field): number|null`; portion uses current portion unit, not assumed grams; complete group sums only.
- `canAdjustFood(row, field): boolean`; unknown fields unavailable; density requires actual positive grams. Individual known zero is editable. Group macro/calorie/density requires positive, complete allocation baseline.
- `adjustmentMinimum(row, field): number`; portion uses current minimum (1g or 0.1 non-gram units); macro minimum is `max(0, originalMacro-originalCalories/energyPerGram)` when calories are known; other fields zero. Macro edits require known calories to preserve the residual.
- `projectFoodAdjustment(row, {field,value}, levels = DEFAULT_DENSITY_LEVELS): Array<{id,changes}>`; only changed portion/nutrient keys, no metadata. Empty array for exact no-op. Throws RangeError for unavailable/invalid requests. Group parent nutrients remain non-additive.

- [ ] **Write literal arithmetic tests**, independent of the implementation's own expected-value calculations:
```js
import {it, expect} from 'vitest';
import {projectFoodAdjustment} from './foodAdjustment.mjs';
it('preserves a calorie residual during a protein correction', () => {
  const row = {uuid:'x', grams:100, calories:100, protein:10, carbs:8, fat:2};
  expect(projectFoodAdjustment(row, {field:'protein', value:15}))
    .toEqual([{id:'x', changes:{protein:15, calories:120}}]);
  expect(projectFoodAdjustment(row, {field:'protein', value:10})).toEqual([]);
});
it('does not infer unknown macros or change micros at fixed mass', () => {
  const row = {uuid:'x', grams:100, calories:100, protein:null, carbs:10, fat:2, sodium:50};
  expect(projectFoodAdjustment(row, {field:'calories', value:200}))
    .toEqual([{id:'x', changes:{calories:200, carbs:20, fat:4}}]);
});
```
- [ ] **Run red:** `npx vitest run shared/contracts/health/foodAdjustment.test.mjs --maxWorkers=2`.
- [ ] **Implement portion and macro slices:** portion delegates to existing scaleFoodPortion; diff only approved numeric/unit keys. Macro calories are `oldCalories + coefficient * (newMacro-oldMacro)`, with coefficients `{protein:4,carbs:4,fat:9}`. Validate finite numbers and minimum before rounding. Compare exact original value before rounding so a no-op cannot quantize stored data.
- [ ] **Implement fixed-mass calorie/density slice:** target calories are entered kcal or grams×density. Compute baseline energy `E=4P+4C+9F`, residual `r=K-E`, new energy `E2=K2-r*(K2/K)`. With complete positive baseline, add interpolated endpoint ladder share delta to measured normalized baseline shares, clamp to zero, normalize, and distribute E2. If clamping yields zero sum, retain original normalized shares. Incomplete macros scale only known values by K2/K. For K=0 or E=0 preserve existing zero/unknown macros. Preserve micros and mass. Round changed stored nutrients to two decimals, not intermediate shares.
- [ ] **Add independent residual fixtures:** a custom constant-share ladder with row K100/P10/C8/F2 and target K200 yields P20/C16/F4; a custom ladder moving P40/C24/F36 to P30/C14/F56 with row K100/P10/C6/F4 and target K200 yields P15/C7/F12.44. Use these literal custom ladder fixtures:
```js
const constant = [
  {level:1, kcal_per_g:1, macros:{protein_pct:40, carb_pct:40, fat_pct:20}},
  {level:2, kcal_per_g:2, macros:{protein_pct:40, carb_pct:40, fat_pct:20}},
];
const shifting = [
  {level:1, kcal_per_g:1, macros:{protein_pct:40, carb_pct:24, fat_pct:36}},
  {level:2, kcal_per_g:2, macros:{protein_pct:30, carb_pct:14, fat_pct:56}},
];
``` Test out-of-ladder values without artificial maxima and zero-calorie beginnings.
- [ ] **Implement atomic group patch calculation:** allocate target calories or target selected macro proportionally to positive child baselines. For density/calories use the same group ladder-share delta for every child; child mass stays fixed. Allocate nonnegative totals in integer cents: floor exact allocations, then distribute remaining cents by descending fractional remainder, breaking ties by entry ID. Do not apply a potentially negative “last child remainder.” Parents remain nutrient-zero headers; portion continues scaling all known extensive values.
- [ ] **Test group cases:** two children K100/K200 targeted K450 become K150/K300; selected P10/P20 targeted P45 becomes P15/P30; unknown and zero aggregate selected fields are unavailable. Include rounding ties, unsorted IDs, immutability, unknown micros, and no-op exact identity.
- [ ] **Run green:** `npx vitest run shared/contracts/health/foodAdjustment.test.mjs shared/contracts/health/foodDensity.test.mjs --maxWorkers=2`.
- [ ] **Commit:** `git add shared/contracts/health/foodAdjustment.mjs shared/contracts/health/foodAdjustment.test.mjs` then `git commit -m "feat(health): define shared food adjustment arithmetic"`.

## Task 5: Atomic adjustment and exact restore API

**Files:** modify `backend/src/3_applications/health/HealthOperations.mjs`; create `HealthOperations.adjustment.test.mjs` beside it. Modify `backend/src/4_api/v1/routers/health.mjs`; create `health.adjustment.test.mjs` beside it.

**Interfaces:** existing PUT `/api/v1/health/nutrilist/:uuid` accepts exactly one of legacy updates, `adjustment:{field,value}`, or `restoreAdjustment:Array<{id,changes}>`. New commands retain `operationId`, `expectedVersion`, and exact-scope `expectedVersions`. Calorie/density adjustment also requires `expectedDensityRevision`. Response preserves `{data,versions,cascadedIds,affectedIds,affectedDates}`. Restore does not use ladder math or require its revision.

- [ ] **Add a failing real-datastore operation test** using the temporary YamlNutriListDatastore setup already in `HealthOperations.portion.test.mjs`: create root/children K100/K200, then issue density or calorie adjustment to K450 and assert persisted child K150/K300, original grams, parent K0, and all returned versions. Use this command shape with the actual created IDs/versions:
```js
const changes = {
  adjustment: {field:'calories', value:450},
  expectedVersion: root.version,
  expectedVersions: Object.fromEntries([root, ...children].map(r => [r.uuid, r.version])),
  expectedDensityRevision: operations.context().densityRevision,
};
const result = await operations.updateNutritionItem(userId, root.uuid, changes);
expect(result.item.calories).toBe(0);
```
The test setup defines `operations`, `userId`, `root`, and `children` through the existing real-store fixture pattern; do not replace persistence with a mocked reducer.
- [ ] **Run red:** `npx vitest run backend/src/3_applications/health/HealthOperations.adjustment.test.mjs --maxWorkers=2`.
- [ ] **Validate command shape before mutation:** reject mixed commands, extra fields, settled/provenance payloads, duplicate/foreign restore IDs, incomplete versions, and malformed values with existing 400 error conventions. Restore permits only grams/amount/unit and NUTRIENT_KEYS. Numeric restores accept finite nonnegative values or null; grams requires positive or null, unit nonempty string or null to restore an original unknown. Exact absent fields use null, preserving semantic unknowns.
- [ ] **Capture ladder once per command** and compare its revision for calorie/density writes. Return 409 with an explicit density-configuration-changed code/message before computing patches if it differs. This prevents a preview using one ladder and save using another.
- [ ] **Apply shared patches inside the existing atomic path:** read complete current scope, verify all versions and group membership inside mutateEntries, calculate actual changed keys, and preserve metadata from current rows. Stamp manualFields/provenance only for corrected nutrients. No automatic settled/ratified transition. Keep legacy portion/factor behavior and idempotency wrapper.
- [ ] **Implement restore through the same path:** require one scope entry per root/child, allowing empty changes for untouched parent. Reject fields outside the whitelist. Restore exact numeric values without re-running density transforms; no restoring supplied metadata or provenance. Return all new scope versions for subsequent Undo/conflict checks.
- [ ] **Add failure tests:** stale child and changed membership leave every row untouched; configuration revision mismatch writes nothing; restore recovers exact pre-edit numbers including null; concurrent metadata/confirmation survives restore; forged IDs/provenance are rejected; response-loss retry with the same operationId does not apply twice. Router test asserts both command bodies traverse the existing idempotent update route.
- [ ] **Run green:** `npx vitest run backend/src/3_applications/health/HealthOperations.adjustment.test.mjs backend/src/3_applications/health/HealthOperations.portion.test.mjs backend/src/4_api/v1/routers/health.adjustment.test.mjs --maxWorkers=2`.
- [ ] **Commit:** stage the four named files; `git commit -m "feat(health): save atomic adjustments and exact numeric undo"`.

## Task 6: Shared draft preview, retry, and Undo lifecycle

**Files:** modify `frontend/src/modules/Health/today/usePortionDraft.js`, `portionPreview.js`, `entryCommands.js`, `portionPreview.test.jsx`, `TodayView.jsx`; create `adjustmentDraft.test.jsx` beside them.

**Interfaces:** preserve current hook and portion control compatibility. Extend controls with `begin(row, field = 'portion')`, `preview(value)`, `reset()`, `undo()`. A draft captures the original row/scope, field, adjustment value, ladder copy, revision, and operationId. Portion retains legacy `draft.portion` and request shape. New fields send Task 5 command shapes. Latest Undo record contains root ID, date, returned scope versions, and exact prior changed-key values.

- [ ] **Add failing hook cases** using the existing `renderHook` setup and DaylightAPI mock from portionPreview.test.jsx. For K100/P10/C8/F2, preview P15 must show K120 and a day-food delta20, with zero API calls before commit. Polling with renamed metadata must preserve the new name while leaving numeric preview based on the original start.
- [ ] **Run red:** `npx vitest run frontend/src/modules/Health/today/adjustmentDraft.test.jsx frontend/src/modules/Health/today/portionPreview.test.jsx --maxWorkers=2`.
- [ ] **Generalize projection without overwriting current metadata:** freeze original portion/nutrient fields, then overlay patches, using current row metadata:
```js
const patchById = new Map(patches.map(({id, changes}) => [id, changes]));
const projectedItems = items.map(row => {
  const id = entryId(row);
  if (!originalNumericById.has(id)) return row;
  return {...row, ...originalNumericById.get(id), ...patchById.get(id)};
});
```
`originalNumericById` is captured at begin from the approved numeric/unit key whitelist; `patches` is Task 4's result from the immutable original row. Never place a full original row in this map. Reuse existing counted-total deltas for budget and macro preview.
- [ ] **Keep save lifecycle compatible:** preview/reset/cancel never write; reset restores exact starting value and makes a no-op commit clear locally. One release performs one command. Keep saving overlay until matching versions arrive. Network retry reuses operationId; explicit conflict rebase refetches full scope, checks units/eligibility/membership, captures new baseline, and creates a new ID. Configuration conflict refreshes context before explicit rebase; never silently recalculate and save under a different ladder.
- [ ] **Capture exact Undo before save:** generate one restore scope entry for every root/child; changed keys capture original values (unknown as null), untouched members use `{}`. On success replace prior Undo with this record and returned versions. Undo sends restoreAdjustment with a fresh operationId. A conflict is visible and offers reload, never force-overwrite. Date changes clear draft/Undo; late old-date responses cannot recreate either.
- [ ] **Extend tests:** cancel, reset after rounded display, duplicate commit, failed-save draft retention, response-loss retry ID, explicit rebase ID, ladder conflict, group membership change, Undo exact residual restoration, Undo conflict, unchanged confirmation, and navigation during save. Preserve all existing portion tests unchanged except necessary interface setup.
- [ ] **Run green:** `npx vitest run frontend/src/modules/Health/today/adjustmentDraft.test.jsx frontend/src/modules/Health/today/portionPreview.test.jsx --maxWorkers=2`.
- [ ] **Commit:** stage the six named files; `git commit -m "feat(health): generalize previews and add versioned undo"`.

## Task 7: Numeric gesture feedback and editors

**Files:** create `frontend/src/modules/Health/today/NumericControl.jsx`, `NumericFeedback.jsx`, `NumericControl.test.jsx`; modify `PortionControl.jsx`, `DensityBadge.jsx`, `MacroBadges.jsx`, `EntryRow.jsx`, `TodayView.jsx`, and `frontend/src/modules/Health/health.scss`.

**Interfaces:**
- `NumericControl({row, field, value, unit, className, children})` consumes the existing PortionContext and Task 4 eligibility/minimum helpers. Accessible name includes food name and field.
- `NumericFeedback({field,value,origin,unit,levels,onReset,onCancel,onApply,editing})` is presentation only.
- MacroBadges accepts optional row; present means eligible P/C/F controls, absent means read-only rollup. Meal and daily density/metrics do not acquire food-write commands.

- [ ] **Write failing pointer behavior** in a real hook/control harness with mocked API only: pointerdown, move +20px on grams, expect +10g preview and visible original marker; pointerup sends one request. Move less than 5px opens editor and does not save. Escape, pointercancel, and lost capture cancel without writing. Include Shift fine sensitivity.
- [ ] **Run red:** `npx vitest run frontend/src/modules/Health/today/NumericControl.test.jsx --maxWorkers=2`.
- [ ] **Extract existing PortionControl behavior into NumericControl**, leaving PortionControl as its compatibility wrapper. Preserve 5px activation and 1g/2px, use .1g macro/.1kcal-g density/1kcal steps, Shift 0.1 multiplier. Determine value from immutable origin and accumulated deltas; changing Shift mid-drag must not jump the value. Enforce physical lower limits only, no arbitrary hard maximum. Ignore non-primary pointer buttons.
- [ ] **Render feedback above with viewport fallback:** show value/unit, immutable origin, absolute change, percent when origin nonzero, boundary text, and message at absolute 50% change. Density scale uses physical positions and nine labels/colors from Tasks 1–2; neutral scale for grams. Keep popup outside child-opacity wrappers. Zero origin shows absolute delta without NaN/Infinity. Announce committed/editor values rather than every pointer pixel.
- [ ] **Implement click/keyboard editor:** numeric entry with Reset, Cancel, Apply; arrows preview, Enter applies, Escape cancels and restores focus. Retain original unrounded reset value. Reset at origin generates no write. Ensure touch scrolling works until horizontal drag activation and touch targets remain 44px. Make popover buttons independent of drag capture.
- [ ] **Attach eligible controls:** density between icon/name by default, kcal and macros in existing numeric tracks. Unknown fields retain an explained unavailable value. Wire latest Undo action near the existing save/error feedback in Today. Do not nest interactive elements or make meal summaries look draggable.
- [ ] **Run green:** `npx vitest run frontend/src/modules/Health/today/NumericControl.test.jsx frontend/src/modules/Health/today/adjustmentDraft.test.jsx frontend/src/modules/Health/today/portionPreview.test.jsx frontend/src/modules/Health/today/EntryRow.test.jsx --maxWorkers=2`.
- [ ] **Commit:** stage the nine named files; `git commit -m "feat(health): add consistent numeric drag feedback"`.

## Task 8: Browser evidence, regression checks, and reference documentation

**Files:** modify `tests/live/flow/health/healthFixtures.mjs`, `health-review.runtime.test.mjs`; create `tests/live/flow/health/health-log-controls.runtime.test.mjs`, `playwright.health-controls.config.mjs`; update `docs/reference/health/README.md` and this plan's completion checkboxes.

**Interfaces:** extend installHealthFixtures to return configured density context and accurate calculated budget/macros/under-over. Parse adjustment/restore commands rather than copying protocol fields into rows. All `/api/**` traffic stays stubbed, and `state.unexpected` must remain empty. Browser fixtures may call shared transforms; Task 4/5 literal tests independently verify arithmetic.

- [ ] **Write failing browser acceptance cases** at desktop 1440px and mobile 390px: B default, switch to A in settings, return to still-mounted Today, reload persistence; two desktop meal columns; density visually secondary; child tree/triangle placement; P/C/F headings and row values center within 1px; narrow long names do not push numeric tracks. Use `locator.boundingBox()` and literal geometry thresholds, not stylesheet string checks.
- [ ] **Add a Vite-only test configuration** using the existing port helper. Do not use the root configuration's `npm run dev` server because it can start another backend writer:
```js
import {defineConfig} from '@playwright/test';
import {getAppPort} from './tests/_lib/configHelper.mjs';
const port = getAppPort();
export default defineConfig({
  testDir: './tests/live/flow/health',
  testMatch: /health-(log-controls|review)\.runtime\.test\.mjs/,
  use: {baseURL: `http://127.0.0.1:${port}`, trace:'retain-on-failure'},
  webServer: {
    command: `npm --prefix frontend run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
```
The existing helper exports synchronous `getAppPort()`. If its configured port is occupied, use the existing machine-local configuration mechanism for an isolated test port; do not kill another checkout's server or reuse it as evidence for this branch.
- [ ] **Run red:** `npx playwright test --config playwright.health-controls.config.mjs`. Expect new acceptance cases to expose missing fixture commands or geometry defects, not to contact a live nutrition API.
- [ ] **Extend fixture semantics:** context includes ladder/revision; budget uses counted leaf calories and nutrient coverage, computes Under/Over correctly. PUT validates whole scope versions and ladder revision; handles shared adjustment or whitelisted exact restore, then increments affected versions. Strip operationId, expected versions, and command objects from stored rows. Add cleanup-error fixture so display settings independence is exercised.
- [ ] **Add gesture evidence:** every supported numeric field previews then saves once; cancel/reset cause no write; density gradient labels follow current levels; limit feedback is truthful; Undo restores exact original values. Assert current/origin markers, viewport containment, and 44px touch targets. Cross 999→1000 and Under→Over during preview and assert adjacent header positions do not move. Capture A/B screenshots and desktop/mobile full-page screenshots in Playwright's test output directory.
- [ ] **Fix only failures attributable to this change**, preserving old review/edit/confirm/delete flows. Update old `Food 871` text assertion to separately verify the Food label and numeric value, not remove its numerical coverage.
- [ ] **Run browser green:** `npx playwright test --config playwright.health-controls.config.mjs`.
- [ ] **Run affected regression and build:**
```bash
npx vitest run frontend/src/modules/Health shared/contracts/health backend/src/3_applications/health/HealthOperations.density.test.mjs backend/src/3_applications/health/HealthOperations.adjustment.test.mjs backend/src/3_applications/health/HealthOperations.portion.test.mjs backend/src/4_api/v1/routers/health.adjustment.test.mjs --maxWorkers=2
npm --prefix frontend run build
git diff --check
```
Inspect every command's result. Run existing related settlement/router suites with their configured runner when HealthOperations changes affect those paths; do not interpret an excluded test as passing.
- [ ] **Update Health reference:** document B/A setting, browser/user persistence, fixed-mass correction semantics, density heuristic, unknown behavior, gesture Reset/Cancel/Undo, config conflict, and calculated-summary scope. Record screenshots/test results in implementation handoff, not as fabricated checkmarks in advance.
- [ ] **Commit:** stage the named implementation/reference files plus this plan's truthful completion updates; `git commit -m "test(health): verify compact log controls and document behavior"`.
- [ ] **Review and integration checkpoint:** use requesting-code-review and finishing-a-development-branch skills at execution time, resolve material findings, then follow repository merge/deploy instructions. This planning turn does not merge or deploy. A deployment requires the machine's standalone deploy gate before and after build and verification of the shipped revision; preserve unrelated workspace changes.

## Plan self-review

Coverage: Task 1 owns ladder/config; Task 2 rows/placement/settings; Task 3 daily summary/coverage; Task 4 arithmetic; Task 5 atomic persistence/provenance; Task 6 preview/retry/Undo; Task 7 interactions; Task 8 browser evidence and regression. Artwork remains explicitly separate. Aggregate edit scope remains an explicit assumption rather than a claimed approval.

Boundary checks: every preview and save uses the same ladder revision; projection freezes numeric fields while retaining current metadata; Undo uses exact prior fields and returned scope versions; no-op never rounds or writes; group headers never become additive; browser fixture math is not the sole arithmetic test oracle.
