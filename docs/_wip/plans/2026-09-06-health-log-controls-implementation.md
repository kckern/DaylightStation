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
- densityPosition(value, levels = DEFAULT_DENSITY_LEVELS): presentation metadata (color, label, position); define exported return fields at implementation and report for Task 3.
- useHealthDisplayPreferences(): { densityPlacement: 'before'|'after', setDensityPlacement(value) }; provider accepts userId and children; bare component tests receive before default.
- DensityBadge({ row, ...presentationProps }): initially read-only density marker, separate sibling of identity edit button; Task 3 attaches shared numeric control.
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
- [ ] Implement shared density read contract and extract existing ladder. Implement preference provider and UI with storage failures handled in memory:
```jsx
<HealthDisplayPreferencesProvider userId={userId}>
  {/* Existing shell, Today, and Settings */}
</HealthDisplayPreferencesProvider>
```
- [ ] Apply the approved row/header/tree geometry and before/after sibling structure. Reuse existing macro coverage fold; allow MacroBarRow to suppress its fallback legend when header owns daily intake while retaining configured bars.
- [ ] Run `npx vitest run frontend/src/modules/Health shared/contracts/health/foodDensity.test.mjs --maxWorkers=2`. Update intentional legacy layout assertions, but preserve meaningful coverage and behavior checks.
- [ ] Update Health reference, review diff, commit only this task's files.

### Task 2: Shared nutrient adjustments and atomic server commands
**Files:** shared/contracts/health/foodAdjustment.mjs and tests; HealthOperations.mjs and correction tests; backend/src/4_api/v1/routers/health.mjs; backend/src/5_composition/modules/healthApi.mjs as needed for normalized configured ladder.
**Interfaces:** projectFoodAdjustment(row, {field,value}, levels) returns [{id,changes}], with field portion/protein/carbs/fat/calories/density. Group parent remains non-additive. Backend accepts changes.adjustment through existing updateNutritionItem and uses shared projection; client uses the same function. Expose normalized densityLevels on health/context.
**Steps:**
- [ ] Inspect router and composition injection and trace where normalized nutribot scale config is already available.
- [ ] Add failing real arithmetic and operation tests:
```js
// Baseline kcal residual is 10: 100 - (4*10 + 4*8 + 9*2).
const row={uuid:'x',grams:100,calories:100,protein:10,carbs:8,fat:2};
const [change]=projectFoodAdjustment(row,{field:'protein',value:15});
expect(change.changes).toMatchObject({protein:15,calories:120});
expect(change.changes.grams).toBeUndefined();
```
Include no-op exact identity, unknown macros, zero calorie starts, density residual, fixed group masses, atomic version conflict.
- [ ] Run targeted failing tests. Implement transforms from the spec, shared rounding, request validation, and precise correctedNutrients provenance. Existing portion requests remain backward compatible.
- [ ] Serve densityLevels through the existing context response using normalized scales configuration and default shared ladder.
- [ ] Run correction, portion, settlement, and health router tests; commit task files.

### Task 3: Unified controls, feedback, and Undo
**Files:** today/NumericControl.jsx, NumericFeedback.jsx and tests; usePortionDraft.js, portionPreview.js, PortionControl.jsx, DensityBadge.jsx, MacroBadges.jsx, EntryRow.jsx, TodayView.jsx, health.scss and reference docs.
**Interfaces:** preserve usePortionDraft's public compatibility for portion tests while adding begin(row, field = 'portion'), draft.adjustment, preview(value), reset(), undo(). NumericControl({row,field,value,unit,className,children}) delegates drafts and renders a sibling popover. Summary controls remain read-only unless separately clarified.
**Steps:**
- [ ] Write failing tests for real control with draft hook: preview updates no API write, Escape no write, one release command, baseline stays fixed through polling, Reset zero net command, failed save retains draft, Undo version-checks the resulting row/group.
```js
act(()=>{control.begin(row,'protein');control.preview(15)});
expect(projected.budget.food).toBe(originalFood+20);
expect(api).not.toHaveBeenCalled();
```
- [ ] Generalize projection to shared patches while preserving old portion request shape. Preserve conflict rebase membership checks.
- [ ] Extract common pointer/keyboard/editor behavior; implement feedback with immutable origin and delta, gradient density markers, neutral gram range, true zero handling and contextual range edges. Do not add arbitrary hard maxima.
- [ ] Attach controls to density, kcal, and P/C/F on foods/groups; keep action buttons siblings of identity. Add Undo as a versioned inverse, preserving changed fields/unknowns without auto-confirmation.
- [ ] Run focused frontend and backend Health suites; update reference docs; commit.

### Task 4: Review, browser verification, and integration
**Files:** docs/reference/health/README.md; necessary targeted fixes; design/plan completion records.
**Steps:**
- [ ] Run the complete affected Health suites with `npx vitest run frontend/src/modules/Health backend/src/3_applications/health backend/src/4_api/v1/routers/health.*.test.mjs shared/contracts/health --maxWorkers=2`, excluding unrelated runners only where their imports require node:test.
- [ ] Run frontend build using existing Vite config. Verify browser against a read-only or API-stubbed fixture with actual app components.
- [ ] Measure numeric-axis alignment, desktop/touch row and hit geometry, settings persistence, long-name truncation, all new drag targets, fixed header widths, popover boundaries, and cancel/undo.
- [ ] Request whole-branch code review and resolve material findings.
- [ ] Merge tested branch to main per repository policy, preserving unrelated workspace changes. Deploy only after the machine's existing deploy gate clears; verify shipped build.

