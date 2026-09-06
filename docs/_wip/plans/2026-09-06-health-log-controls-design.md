# Health log layout, density, and direct editing
Date: 2026-09-06
Status: visual design approved; implementation authorized.
Audit: ../audits/2026-09-06-health-log-row-density-and-artwork-audit.md

## Approved visual design
Keep the two-column desktop meal layout. Align P/C/F labels, meal totals, group rows, and food rows within each meal. Daily totals are independent of those columns.

The compact daily header uses seven equal metric values: protein, carbs, fat, budget, food, exercise, remaining. All seven use 24px desktop text with equal weight and line height; reduce together on narrow screens. Labels and units are smaller. Reserve number and operator slots so digit-count changes and under/over transitions never move adjacent terms during a gesture. At typical desktop widths, date plus summary should occupy about 100px or less. Macro colors retain rose/sage/gold. Budget is neutral white on the dark surface; Food uses a light card with dark text; Exercise orange; Under green; Over red. No day-level density card. Preserve unknown values, partial '+' suffixes and a coverage caption; retain goal and watched-micronutrient progress where configured without duplicate intake legends.

Food rows use 28px minimum height for fine-pointer desktop. Coarse-pointer or mobile controls retain 44px targets, including density and confirmation. Child rows use one smaller font step, circular smaller macro visuals centered on the same P/C/F tracks, and 75% visual opacity. Keep text legible. Parent artwork anchors the tree trunk; children are actually indented within the identity area without shifting nutrient columns. The expand triangle is centered on the text, approximately capital-letter height, with a separate adequate hit area.

Density is a small secondary marker near the food identity, not a dedicated right-hand numeric column. Default B: icon, density badge, food name, with density in a fixed slot per indentation level. Optional A: icon, food name, density badge. Badge appearance is muted, roughly 14px high visually and 24px wide, with small internal padding and clear separation. Do not nest its interactive button inside the name edit button. Empty/missing mass renders an unavailable marker with explanation; do not treat ml or serving counts as grams. Meal density uses total calories / total mass only when every counted food has known mass and calories, excluding the non-additive group headers.

## Settings
Add a Food log display section to /health/settings, accessible independently of cleanup API availability.
Density badge placement offers 'Before food name' (B, default) and 'After food name' (A).
Persist per resolved Health user in browser localStorage, update mounted Today immediately, synchronize browser tabs via storage events. Invalid values fall back to B; unavailable storage still allows an in-memory choice. This is a browser display preference, not a nutrition mutation.

## Density levels
Use the existing configured nine-rung ladder; extract default values from scaleNutribotConfig into a shared contract rather than duplicating them:
1 Watery .2; 2 Light .6; 3 Lean 1.0; 4 Mixed 1.4; 5 Hearty 1.9; 6 Heavy 2.6; 7 Rich 3.8; 8 Thick 6.0; 9 Oil 8.5 kcal/g.
Colors progress cool blue, teal, green, yellow-green, yellow, orange, orange-red, red, deep crimson. Retain numeric values and level names with the gradient; color is supplementary.
Interpolate at physical kcal/g positions. Show exact/between/outside-level descriptions truthfully. Ladder endpoints are reference points, not hard upper/lower validity limits. Zero density is valid with positive mass. Missing mass/calories is unknown. No inference of macro data merely to display density.

## Direct editing
Shared interaction for portion, P/C/F, kcal, and density on foods and grouped dishes. Keep meal/day summaries calculated for this delivery unless the user's pending scope clarification explicitly includes them. Budget and exercise retain existing editors; under/over remains an equation result. This choice avoids inventing a distribution rule for aggregate edits.

Dragging opens feedback above the active value (flip within viewport if needed). Show current value/unit, immutable gesture-start marker, absolute and percent change, scale ticks, lower boundary, and a large-change message at 50% displacement. Zero baseline uses an absolute delta rather than undefined percent. Density uses the nine-color gradient with level markers and names. Grams uses a neutral scale. Display range edges must not become arbitrary hard maximums.

Preserve current 5px activation threshold and portion sensitivity (1g / 2px). Shift supports fine adjustment. Density step .1 kcal/g; macros step .1g; calories step 1kcal. Pointer capture prevents accidental release loss. Escape/pointercancel cancels with no network write. Release commits once. Clicking or keyboard activation opens an editor with numeric entry, Reset, Cancel, Apply; Reset restores the gesture's starting value. Keyboard arrows preview and Enter commits.
After a successful commit offer Undo using current returned versions; never silently overwrite concurrent edits. Undo restores the exact original numeric fields, rather than applying an inverse density calculation. Its restore command includes only portion/nutrient fields and the exact displayed group membership. It does not revert confirmation or unrelated metadata. Original unknown values stay unknown; restored supplied values retain user-correction protection. Failed commands keep their draft and existing retry/rebase behavior. Cross-date saves cannot resurrect old drafts.

## Nutrient semantics
Portion holds nutrient density and scales existing extensive nutrients as today. Density and calorie edits keep mass fixed. A macro edit holds mass and the other macros fixed; calories change by 4 kcal per gram of protein/carbs, 9 per gram of fat, preserving the starting calorie residual. No-op gestures do not rewrite values.
For a complete nonzero macro-energy baseline, density changes shift normalized energy shares by the interpolated ladder-share delta, clamp nonnegative, renormalize, and scale the calorie residual proportionally. The default ladder is a heuristic, not measured composition. If macros are incomplete, preserve unknowns and scale only existing macro values proportionally; do not manufacture coverage. Zero-calorie or zero-energy baselines cannot infer a composition; preserve known zero/unknown values when adding calories unless the user supplies explicit macros. Micros remain unchanged at fixed mass.
Group corrections apply through one atomic, version-checked command, preserving non-additive group-header nutrient fields. Child masses stay fixed for density/calorie corrections; distribute calorie changes proportionally to existing child calories and apply the group ladder-share delta per child. Macro corrections distribute the requested macro proportionally across known child values, preserving unknowns; an unknown or zero group baseline is unavailable for dragging that field.
Never ratify edits automatically. Stamp user provenance and manualFields only for nutrients actually corrected. Shared client/server arithmetic must agree to stored precision.

## Implementation boundaries
This delivery implements the approved log/display and direct-editing design. The audit's artwork ingestion, manifest curation, and historical backfill are a separate workstream; no data backfill or icon policy is authorized by the placement approval.
Reuse existing PhotoStore/FoodIcon precedence unchanged in this delivery.

## Verification
Behavior tests cover user-scoped setting persistence and same-page changes, unknown/mixed mass, density interpolation, correction residuals, zero/no-op cases, atomic group updates and conflicts, preview/cancel/release/undo, and preserved macro coverage.
Browser verification checks 28px desktop and 44px touch targets, both meal columns, label/metric alignment, A/B switching, tree/triangle geometry, long names, viewport-constrained popovers, and invariant header geometry across 999→1000 and under→over.
Run focused Health tests and a production frontend build. Use API stubs or isolated test data for browser edits; never run a second nutrition writer on production data.
