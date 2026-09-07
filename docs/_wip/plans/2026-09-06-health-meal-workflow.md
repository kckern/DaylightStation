# Health Meal Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implement the seven requirements in the user-approved meal workflow, including contextual voice amendments, manual/voice/smart grouping, Undo, progress, and compact visual corrections.
**Architecture:** Keep the existing Health capture API and nutrition ledger. Group parents carry zero stored nutrients; children remain counted exactly once. Add meal-scoped commands with version-checked mutations and reversible snapshots; use existing AI and transcription adapters to interpret instructions against server-loaded meal context. The UI owns transient selection and progress, while the server owns durable changes.
**Tech Stack:** React, Mantine, SCSS, Node ES modules, YAML nutrition ledger, Vitest, Playwright.
**Spec:** `2026-09-06-health-meal-workflow-requirements.md` (verbatim user attachment).

## Global Constraints

- All seven requirements are required; visual fixes alone do not complete this plan.
- One meal microphone handles add, amend, and group. Selection limits context; without selection use the entire targeted meal and recent input.
- Clear voice changes apply immediately with Undo; ambiguous targets use selectable choices. Smart grouping always previews proposals.
- No saved food is deleted to retire an empty automatic meal section.
- Grouping and ungrouping preserve foods, precision, and daily totals. Parent totals are derived.
- Preserve two desktop columns, compact spacing, child indentation/opacity, display preference configuration, and existing capture retry/idempotency.
- Daily values are integers for display only. Food density remains a one-decimal kcal/g value with nine discrete colors.
- No production writes during tests. Deploy only after the mandatory gate and verification.

### Task 1: Food-row and daily-summary display

**Files:** Modify `frontend/src/modules/Health/today/{EntryRow.jsx,densityPresentation.js,EquationStrip.jsx}`, `frontend/src/modules/Health/health.scss`; update associated tests.
**Interfaces:** Preserve `densityPresentation(value, levels)` returning `{color,marker,label}` and existing component props. Before placement becomes density, artwork, name; after placement remains artwork, name, density.

- [x] Add regressions: decimal density markers including `0.0`, exactly nine palette choices, rounded macro and equation values without changing input objects. Remove obsolete Estimated-label assertions while retaining confirmation behavior coverage.
- [x] Run focused tests and verify new assertions fail against the baseline.
- [x] Display `value.toFixed(1)`; select nearest configured density anchor (midpoint boundary, ties toward denser anchor), clamp color at endpoints, retain unavailable dash. Use a tightly bounded SVG expansion triangle sized in cap units and center its clickable cell. Remove Estimated text only, retain confirm action.
- [x] Give all seven summary metrics consistent card geometry, four equation terms visible cards with approved tones, inline number/unit, equal numeric font sizes. Preserve compact responsive layout.
- [x] Run focused tests and frontend build; inspect desktop/mobile browser geometry during final verification. Commit only owned files.

```js
expect(densityPresentation(0).marker).toBe('0.0');
expect(densityPresentation(1.7).marker).toBe('1.7');
// Daily formatting uses Math.round(value).toLocaleString(); data is not mutated.
```

### Task 2: Versioned meal grouping and reversible changes

**Files:** Add `backend/src/3_applications/health/MealFoodCommands.mjs` and tests; extend `HealthOperations.mjs`, `backend/src/4_api/v1/routers/health.mjs`, and `YamlNutriListDatastore.mjs` only at existing mutation seams.
**Interfaces:** Meal commands accept `{date,bucket,selectedIds,operationId,expectedVersions}` plus action-specific group name/membership. Return changed entry IDs and a durable Undo token. Commands: group, change membership, ungroup, undo. Selection IDs must resolve within the user's requested meal/date.

- [x] Read existing ledger operation/transaction APIs and reuse their locking, idempotency, journal and version semantics.
- [x] Write group→membership change→ungroup and Undo integration regressions using a temporary datastore. Compare counted totals before/after, exact food payloads, repeat operations, stale versions, cross-meal selections, and failure recovery.
- [x] Implement group parents with `kind:'group'`, zero nutrition, stable IDs; assign children's `parentId`. Clear membership without deleting children, remove empty parent only. Undo restores changed rows only and rejects intervening edits.
- [x] Expose commands through Health routes with explicit validation and structured lifecycle logs. Run focused datastore/application/API tests and commit.

```js
expect(sumCounted(after, 'calories')).toBe(sumCounted(before, 'calories'));
expect(after.filter(row => row.kind !== 'group').map(row => row.calories))
  .toEqual(before.filter(row => row.kind !== 'group').map(row => row.calories));
```

### Task 3: Contextual voice and smart interpretation

**Files:** Existing Health capture route, nutrition input adapter/use cases, new meal instruction interpreter adjacent to `MealFoodCommands.mjs`, focused tests.
**Interfaces:** Capture adds optional selected IDs and clarification choice to its existing operation fingerprint. Server fetches canonical meal rows. Interpreter returns add, amend, group, or clarification with candidate IDs; smart grouping returns proposed names/member IDs without writing.

- [x] Reproduce the actual sequence: roast vegetables plus beef broth, then “the beef broth had some potatoes in it, so add potatoes to the list.” Verify existing broth is amended, not duplicated.
- [x] Feed server-loaded scope, IDs, quantities, and recent capture to existing AI adapter with structured output validation. Selection restricts all edits/group members. Keep ordinary new-food capture working.
- [x] Apply unambiguous changes through reversible meal commands. Return selectable clarification candidates for ambiguous targets. Validate proposed IDs before mutation; never trust client or AI nutrition totals for group parents.
- [x] Make smart grouping read-only until explicit apply; selected scope wins over whole-meal scope. Test context, ambiguity, invalid responses, retries and exact Undo; commit.

### Task 4: Meal controls, selection and analysis lifecycle

**Files:** `frontend/src/modules/Health/today/{TodayView.jsx,LogTable.jsx,QuickCaptureBar.jsx,EntryRow.jsx}`, `capture/useNutritionInput.js`; add small `MealFoodControls.jsx`, `CaptureProgress.jsx` and tests; scoped SCSS.
**Interfaces:** Meal selection state keyed by date/bucket; microphone carries frozen date/bucket/selection. Commands consume task 2/3 response shapes. Progress task IDs prevent overlapping captures clearing each other.

- [x] Add current-meal timer with focus refresh. Include its empty section only on today; hide when window changes unless populated, explicitly opened, or busy.
- [x] Render one mic per meal. Plus toggles explicit Photo/Type/Barcode choices; no unsolicited catalog dropdown. Add select-food checkboxes and Group/Smart controls, name editor, proposal preview, membership and ungroup controls.
- [x] Connect voice context, immediate changes, selectable clarification and Undo. Preserve retained recordings and operation IDs across uncertain retries.
- [x] Use per-capture animated estimated progress, switch to indeterminate diagonal stripes when estimate expires, retire on actual result; errors retain retry. Ignore obsolete backend status messages on committed success.
- [x] Run fake-clock, concurrent capture, failure/retry, grouping interaction and navigation tests; commit.

### Task 5: Full verification and delivery

- [x] Run all Health/shared nutrition tests and affected backend suites. Fix regressions, preserving behavior coverage.
- [x] Run Playwright using fixtures and temporary persisted data: Dinner after 18:00, meal boundary, selected/manual/smart/voice grouping, potatoes amendment, ambiguous choices, Undo, slow analysis and failure retry.
- [x] Inspect desktop/mobile screenshots and numeric geometry; verify inline units, integer summaries, nine density colors and `0.0`, cap-height centered triangle, dimmed children, compact two columns.
- [x] Review complete diff against each of the seven requirements. Record evidence in this plan; unfinished evidence is not completion.
- [x] Update Health reference docs and merge preserving unrelated work. Feature commit `51787178a`; combined main commit `f5b2a1d7c`. Normal architecture, UI, link, parse, SCSS and composition hooks pass.
- [x] Run deploy gate separately before and after build, deploy and verify served build/API health. Mark goal complete only when all requirements are proven.


## Verification evidence

- Combined frontend/shared/affected backend verification: final fresh run passes all 97 files and 943 tests. This includes the corrected legacy capture shim and the final recording-navigation retry regressions.
- Actual Chromium summary geometry at 390, 800 and 1440px: inline units, equal number sizes, contained cards, compact height.
- Temporary YAML command regressions: exact grouping/membership/ungroup snapshots, totals/precision, intervening edit rejection, serving and gram scaling, manual-field protections, recovered operation response/Undo.
- Contextual voice pipeline regressions: saved bytes before transcription, canonical selected meal context/recent utterances, potatoes amendment without duplicate broth, selected clarification, durable replay without retranscription/reinterpretation.
- Browser journey `tests/live/flow/health/meal-workflow.verify.mjs`: manual grouping, editable smart preview before atomic application, ungroup, Undo, voice amendment/grouping, choices, slow stripes, failed recording retry with same operation ID, one Dinner mic and no unsolicited catalog. All API routes intercepted; temporary datastore only.
- UI lifecycle regressions: automatic meal transitions preserve food, active/failed recordings pin their section, date navigation uses original context, saved-audio retry retains selected foods and renders choices.
- Display-token audit passes without raising baselines. No unrelated workspace files changed.

## Requirement coverage audit

| Requirement | Direct evidence |
|---|---|
| Immediate meal logging | LogTable clock/retirement tests, recording pin tests, browser Dinner mic and plus flow |
| Contextual voice | MealInstructionService and WebNutribotAdapter tests inspect canonical selected/full-meal context and recent logs; browser potatoes amendment/choices/Undo |
| Grouping | MealFoodCommands temporary-ledger tests prove membership, ungroup, exact Undo and totals; browser manual/smart/voice flows |
| Analysis feedback | CaptureProgress fake-clock tests, concurrent task tests, browser slow completion and failure/retry |
| Food rows | DensityBadge/EntryRow/layout tests and desktop/mobile screenshots verify nine colors, decimal density, identity order, triangle and compact children |
| Daily summary | EquationStrip formatting and browser geometry tests prove integer display, inline units, equal sizes and contained cards; datastore tests preserve precision |
| Complete flows | 943 passing affected tests plus the isolated Chromium journey using real command services and a temporary YAML datastore |

Production image built successfully for `f5b2a1d7c`. Pre-build gate passed; initial post-build gate detected School Portal activity, so no restart was attempted at that point.

The post-build gate subsequently cleared and deployment completed. Served build metadata matches `f5b2a1d7c`; the container is healthy and Health context returns all nine density levels. The complete isolated browser journey passes against the deployed bundle with no page errors. No Health/Nutribot errors appeared in the post-startup log query. Test requests used temporary data and intercepted APIs. The verification record is a documentation-only follow-up to the deployed source commit.
