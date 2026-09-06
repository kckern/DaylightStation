# Health Log Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Ship the approved compact Health log, configurable density placement, and consistent numeric drag feedback.
**Architecture:** Shared pure density/correction contracts feed the API and client preview. Small display/interaction components reuse the existing versioned nutrition write path and single-draft lifecycle.
**Tech Stack:** React 18, Mantine 7, SCSS, ESM backend, Vitest, Playwright.
**Spec:** docs/_wip/plans/2026-09-06-health-log-controls-design.md

## Global Constraints
- Two-column desktop meals; 28px fine-pointer food rows; 44px coarse/mobile targets.
- Daily metrics all 24px desktop, fixed slots, no day density; B placement default with A available in Settings.
- Child rows 75% opacity and circular smaller macro visuals; align nutrient tracks locally per meal.
- Preserve unknown nutrition, partial coverage, non-additive group headers, user scoping, atomic commands, and existing confirmation semantics.
- Structured logging only. No new dependencies. Docs live under docs/.
- No production-data mutations during verification. Artwork/backfill is a separate design track.

### Task 1: Approved layout, density read model, and placement preference
**Files:**
- Create shared/contracts/health/foodDensity.mjs and focused tests.
- Extract default ladder from backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs, re-exporting DEFAULT_DENSITY_LEVELS for existing callers.
- Create frontend/src/modules/Health/display/HealthDisplayPreferences.jsx, HealthDisplaySettings.jsx, and preference behavior tests.
- Create frontend/src/modules/Health/today/DensityBadge.jsx and density presentation helper/tests.
- Modify HealthApp.jsx, cleanup/HealthSettings.jsx, today/EntryRow.jsx, LogTable.jsx, EquationStrip.jsx, MacroBarRow.jsx, TodayView.jsx, health.scss, related existing tests.
- Update docs/reference/health/README.md.
**Interfaces:**
- foodDensity(row): number|null; group children summed only with full mass/calorie coverage; zero calories valid.
- DEFAULT_DENSITY_LEVELS: existing exact ladder values and macro splits.
- densityPosition(value, levels = DEFAULT_DENSITY_LEVELS): { color: string, label: string, lowerLevel: number, upperLevel: number, fraction: number, outside: 'below'|'above'|null } or null for unknown. Color is hex interpolation; fraction is the local position between the bracketing physical kcal/g values. Exact rungs set both level numbers equal. Outside values retain the nearest color and a truthful outside label.
- useHealthDisplayPreferences(): { densityPlacement: 'before'|'after', setDensityPlacement(value) }; provider accepts userId and children; bare component tests receive before default.
- DensityBadge({ row, levels = DEFAULT_DENSITY_LEVELS, className = '' }): initially read-only density marker, separate sibling of identity edit button; Task 3 attaches shared numeric control. The title/accessible label includes exact kcal/g and the density-level description.
- EquationStrip accepts macroCoverage and optional macros/goals to show the daily metrics; Today supplies nutrientSummary(preview.items).
**Steps:**
- [ ] Write behavior tests that catch incorrect group density or treating ml as g:
```js
expect(foodDensity({grams:100,calories:250})).toBe(2.5);
expect(foodDensity({grams:null,amount:100,unit:'ml',calories:250})).toBeNull();
expect(foodDensity({kind:'group',children:[{grams:100,calories:250},{grams:50,calories:50}]})).toBe(2);
```
- [ ] Test the real preference provider and Settings controls: change after, remount same user, verify after; different user before; cleanup error does not hide display settings.
- [ ] Run failing tests with `npx vitest run <new-test-paths> --maxWorkers=2`.
- [ ] Implement shared density read contract and extract existing ladder without changing the exported default array contents or the kitchen-scale normalization behavior. Implement preference provider and UI with storage failures handled in memory. The storage key is `health:display:<userId>` and JSON shape is `{ "densityPlacement": "before" }` or `{ "densityPlacement": "after" }`:
```jsx
<HealthDisplayPreferencesProvider userId={userId}>
  {/* Existing shell, Today, and Settings */}
</HealthDisplayPreferencesProvider>
```
- [ ] Apply the approved row/header/tree geometry and before/after sibling structure. Reuse existing macro coverage fold; allow MacroBarRow to suppress its fallback legend when header owns daily intake while retaining configured bars.
- [ ] Run `npx vitest run frontend/src/modules/Health shared/contracts/health/foodDensity.test.mjs --maxWorkers=2`. Update intentional legacy layout assertions, but preserve meaningful coverage and behavior checks.
- [ ] Update Health reference, review diff, commit only this task's files.

### Task 2: Shared nutrient adjustments and atomic server commands
**Files:** shared/contracts/health/foodAdjustment.mjs and foodAdjustment.test.mjs; backend/src/3_applications/health/HealthOperations.mjs and HealthOperations.adjustment.test.mjs; backend/src/4_api/v1/routers/health.mjs and health.adjustment.test.mjs; backend/src/5_composition/modules/healthApi.mjs.
**Interfaces:**
- adjustmentValue(row, field): number|null, using current units for portion; known group nutrient totals require complete coverage.
- canAdjustFood(row, field): boolean. Density requires positive known grams and known calories. Individual macro/calorie zero baselines are valid; unknown values are unavailable. Group macro/calorie controls require a positive known total to allocate among children.
- projectFoodAdjustment(row, {field,value}, levels = DEFAULT_DENSITY_LEVELS) returns Array<{id:string,changes:Object}>, with field portion/protein/carbs/fat/calories/density. Fields absent from changes remain unchanged. Group parent remains non-additive. A no-op returns an empty array.
- HealthOperations constructor accepts densityLevels: () => Array, defaulting to the shared defaults; context() returns {userId, densityLevels}. Capture normalized levels once per command.
- Existing PUT accepts adjustment:{field,value} OR restoreAdjustment:Array<{id,changes}>. Both travel with operationId/expectedVersion/expectedVersions. Reject combining either with portion/factor/raw nutrient changes or settled. A restore patch permits only grams, amount, unit, and NUTRIENT_KEYS; IDs must exactly match the displayed root/group scope, with no duplicates or extra members.
**Steps:**
- [ ] Hoist the existing normalization thunk in healthApi.mjs so both HealthOperations and ObservationPairing receive the same source:
```js
const scaleConfig = () => normalizeScaleNutribotConfig(
  configService?.getHouseholdAppConfig?.(null, 'scales') || {},
);
// HealthOperations constructor option:
densityLevels: () => scaleConfig().densityLevels
// ObservationPairing constructor option:
scaleConfig
// GET /context:
res.json(healthOperations.context());
```
Tests with minimal HealthOperations doubles must supply the new context method; actual user-scoping assertions remain in place. HealthApp passes context.data.densityLevels into the display provider; that provider exposes densityLevels from the same context hook for badges and controls. Missing levels on an older response use shared defaults.
- [ ] Add failing real arithmetic and operation tests:
```js
// Baseline kcal residual is 10: 100 - (4*10 + 4*8 + 9*2).
const row={uuid:'x',grams:100,calories:100,protein:10,carbs:8,fat:2};
const [change]=projectFoodAdjustment(row,{field:'protein',value:15});
expect(change.changes).toMatchObject({protein:15,calories:120});
expect(change.changes.grams).toBeUndefined();
```
Include no-op exact identity, unknown macros, zero calorie starts, density residual, fixed group masses, atomic version conflict.
- [ ] Run targeted failing tests. Implement transforms from the spec, rounding stored nutrient values to two decimal places, request validation, and precise user provenance. Existing portion requests remain backward compatible. Derive single-macro calories by delta:
```js
const energyPerGram = {protein:4, carbs:4, fat:9};
const calories = row.calories + energyPerGram[field] * (value - row[field]);
```
Reject a result below zero; show that derived lower limit in the control. For complete density baselines, normalize baseline shares against macro energy E=4P+4C+9F, preserve r=calories-E, and compute new macro energy E' = targetCalories-r*(targetCalories/calories). Add the ladder-share delta to the normalized baseline shares; clamp/normalize and distribute E'. This avoids counting the calorie residual twice. A zero-calorie/zero-energy baseline preserves existing zero/unknown macros. An incomplete baseline scales known macros by targetCalories/calories when that ratio exists and preserves missing values. No micros change at fixed mass.
For groups, compute the requested target against the roll-up, distribute calorie or selected-macro deltas proportionally to corresponding positive child baselines, and assign rounding remainder deterministically to the final eligible child without making it negative. Density applies the same group-level ladder share delta to each child; its mass never scales.
- [ ] Implement exact restore alongside the shared adjustment branch before the legacy factor branch:
```js
// Inverse captured from fields actually changed, prior to replacing the preview:
const restoreAdjustment = patches.map(({id,changes}) => ({
  id, changes: Object.fromEntries(Object.keys(changes).map(key => [key, beforeById.get(id)[key] ?? null])),
}));
```
Keep root/group scope entries with empty changes where needed for membership checking. Unit restoration must be a nonempty existing unit string; mass may be null but not zero or negative. All numerical restores are finite nonnegative values or null for unknown. Validate every member/version before one mutateEntries call. Stamp provenance only for actual nutrient changes; never accept provenance/manualFields supplied by the browser.
- [ ] Serve densityLevels through the existing context response using normalized scales configuration and default shared ladder.
- [ ] Run correction, portion, settlement, and health router tests; commit task files.

### Task 3: Unified controls, feedback, and Undo
**Files:** today/NumericControl.jsx, NumericFeedback.jsx and tests; usePortionDraft.js, portionPreview.js, PortionControl.jsx, DensityBadge.jsx, MacroBadges.jsx, EntryRow.jsx, TodayView.jsx, health.scss and reference docs.
**Interfaces:** preserve usePortionDraft's public compatibility for portion tests while adding begin(row, field = 'portion'), draft.field, draft.adjustment, preview(value), reset(), undo(). Portion drafts retain draft.portion and the existing portion request body; all other fields use adjustment:{field,value}. NumericControl({row,field,value,unit,className,children}) delegates drafts and renders a sibling popover. NumericFeedback({field,value,origin,unit,levels,onReset,onCancel,onApply,editing}) is presentation only. The provider makes one immutable ladder snapshot part of each draft so config refreshes cannot move the gesture baseline. Summary controls remain read-only unless separately clarified.
**Steps:**
- [ ] Write failing tests for real control with draft hook: preview updates no API write, Escape no write, one release command, baseline stays fixed through polling, Reset zero net command, failed save retains draft, Undo version-checks the resulting row/group.
```js
act(()=>{control.begin(row,'protein');control.preview(15)});
expect(projected.budget.food).toBe(originalFood+20);
expect(api).not.toHaveBeenCalled();
```
- [ ] Generalize projection to shared patches while preserving old portion request shape. Preserve conflict rebase membership checks. New projections replace matching rows from immutable start snapshots, then reuse current sumCounted deltas for the meal/day overlay:
```js
const patches = projectFoodAdjustment(draft.row, draft.adjustment, draft.densityLevels);
const replacements = new Map(patches.map(({id,changes}) => [id, {...beforeById.get(id),...changes}]));
const projected = items.map(row => replacements.get(entryId(row)) || row);
```
Do not let an absent property in the patch erase an unrelated concurrent value. If field support or units change during explicit rebase, retain the error and require reload instead of applying a different kind of adjustment. A failed API call reuses operationId on retry; explicit rebase uses a new ID.
- [ ] Extract common pointer/keyboard/editor behavior; implement feedback with immutable origin and delta, gradient density markers, neutral gram range, true zero handling and contextual range edges. Do not add arbitrary hard maxima.
- [ ] Attach controls to density, kcal, and P/C/F on foods/groups; keep action buttons siblings of identity. Unknown fields remain readable unavailable markers with an explanation. MacroBadges accepts optional row; without it, it remains a read-only summary. Add Undo as exact restoreAdjustment, using returned versions for every scope member and a new operationId. Store one latest undo record in the day hook, scoped to selected date; a new successful edit replaces it. Undo conflicts show an error and never offer automatic overwrite. Restore only numeric fields changed by the original command; preserve unrelated metadata and confirmation.
- [ ] Run focused frontend and backend Health suites; update reference docs; commit.

### Task 4: Review, browser verification, and integration
**Files:** docs/reference/health/README.md; necessary targeted fixes; design/plan completion records.
**Steps:**
- [ ] Run the complete affected Health suites with `npx vitest run frontend/src/modules/Health backend/src/3_applications/health backend/src/4_api/v1/routers/health.*.test.mjs shared/contracts/health --maxWorkers=2`, excluding unrelated runners only where their imports require node:test.
- [ ] Run frontend build using `npm --prefix frontend run build`. Verify browser against API-stubbed fixtures with actual app components. Resolve server ports through the existing test config helper and check an existing dev process before starting another; run only Vite when using stubs so a second nutrition writer cannot start.
- [ ] Measure numeric-axis alignment, desktop/touch row and hit geometry, settings persistence, long-name truncation, all new drag targets, fixed header widths, popover boundaries, and cancel/undo.
- [ ] Request whole-branch code review and resolve material findings.
- [ ] Merge tested branch to main per repository policy, preserving unrelated workspace changes. Deploy only after the machine's existing deploy gate clears; verify shipped build.
