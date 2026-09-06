# Health UI remediation verification

Implements the September 5 audit and its 16-item remediation plan. Code is
committed and fast-forwarded to main as `f81b295ae`. Deployment and the two
previewed artwork corrections are pending at this checkpoint: the live deployment
gate detected Portal activity, then both video rendering and Portal activity.
No Docker build or restart was attempted through a blocked gate.

## Changes

- Today uses a contextual desktop rail and two populated meal columns. Compact
  week/weight history moves below the log in a closed disclosure on smaller screens.
- One capture bar, inline estimates/macros, aligned portions and calories, compact
  empty-meal actions, and a closed uncounted-capture disclosure reduce vertical cost.
- Group expansion persists; the final child's tree line terminates correctly;
  entries show one photo/icon rather than duplicate artwork.
- Portions support primary-button horizontal dragging, precise Shift adjustments,
  direct entry and keyboard controls. One shared preview updates row, meal and day;
  release sends one versioned command, while Escape/cancellation sends none.
- Conflicts require an explicit fresh-snapshot rebase. Group membership and all
  member versions are checked atomically; response-loss retries are idempotent.
- Only explicit Confirm ends review early. Corrections protect changed fields,
  preserve the review deadline and leave the remaining estimate reviewable.
- Unknown nutrients remain unknown, known zero remains zero, partial totals carry
  a `+`, and macro intake remains visible without configured targets. Volume and
  servings are not mislabeled as grams.
- Progress has a goal summary/editor sheet, responsive stats and dated weight;
  Coach has visible Send and draft-only starter prompts; Medical has one empty
  Add action; cleanup shows summaries with expandable history and preserved undo.
- Catalog artwork pins persist and outrank generated suggestions. UPC artwork is
  confined to the available vocabulary. Known mismatches resolve to a neutral bowl
  when no appropriate asset exists.

## Verification

1,012 unit/integration tests and 26 fixture-owned browser journeys pass. Browser
journeys intercept household writes, including captures; no live AI calls or
demonstration nutrition edits were used. Tests cover confirmation, retry/dedup,
exact group scope, partial macros, date navigation during in-flight edits,
barcode creation/rescan, camera release, voice retry, editor focus, cleanup undo,
shared AppChrome and Coach behavior.

The incident fixture verifies chia 14→28g previews 140 kcal, meal 941 kcal, day
1,609 kcal and 526 kcal remaining. Drag motion and cancellation make no requests;
release commits once. Volume entry remains volume and does not confirm nutrition.

Parse, stylesheet, layer, filesystem and UI-baseline gates pass. The production
frontend build passes; existing Sass deprecations and chunk-size warnings remain.
An earlier browser run reported a resource-loading error; the complete rerun and
three repeats of all three context journeys (nine additional executions) passed
without weakening the unexpected-request assertion. Commit-time composition
contract checks also passed all nine tests.

## Screenshots

Built frontend with read-only production September 5 data. All six viewports
have no horizontal overflow or page errors. Controls preserve 44px targets.

| Viewport | First food y | Evidence |
|---|---:|---|
| 390×844 | 317 | [Mobile](2026-09-06-health-ui/mobile.png) |
| 768×1024 | 293 | [Narrow](2026-09-06-health-ui/narrow.png) |
| 1024×768 | 261 | [Tablet](2026-09-06-health-ui/tablet.png) |
| 1366×768 | 261 | [Laptop](2026-09-06-health-ui/laptop.png) |
| 1440×900 | 261 | [Desktop](2026-09-06-health-ui/desktop.png) |
| 1920×1080 | 261 | [Wide](2026-09-06-health-ui/wide.png) |

Laptop lunch and dinner headers share y=216, both visible without scrolling.
Secondary mobile screens: [Progress](2026-09-06-health-ui/mobile-progress.png),
[Coach](2026-09-06-health-ui/mobile-coach.png),
[Medical](2026-09-06-health-ui/mobile-medical.png),
[Settings](2026-09-06-health-ui/mobile-settings.png).

## Exact artwork repair preview

No suitable plain-yogurt, chia-seed, scrambled-egg or diced-ham asset exists in the
live manifest. Do not substitute parfait, chia pudding, fried eggs or a burger.
Yogurt/chia already use the neutral fallback. The group already has a real photo.
Only these two incorrect entry icons will change through the live versioned API:

| Entry UUID | Name | Before | After | Preview version |
|---|---|---|---|---:|
| efde8616-aac3-4aab-9273-bb01733f3da5 | Scrambled Eggs | fried-eggs | default | 11 |
| a69a61db-603a-47fe-a7e3-cdef2d723608 | Diced Ham | bacon-cheeseburger | default | 5 |

Both have only `parentId` in manualFields; associated catalog entries have no
icon or iconOverride pin. Preserve all nutrition, quantities, dates, group
membership and review state. API journaling preserves reversibility; undo would
be a fresh versioned icon-only command using the before value, not a file restore.

The pre-repair day has food 1,539 kcal, base budget 1,788 kcal, exercise 347 kcal,
remaining 596 kcal. Yogurt/chia deadlines are September 8 at 19:48:18Z and
19:48:21Z. Recheck these and the original mutable Telegram bindings after repair.

The read-only receipt preview and durable checkpoint agree on original message
IDs: yogurt `11659`, chia `11658`, scale `11660`, burrito `11663` (caption).
All four rendered fingerprints already match their delivery acknowledgements.
The preview used food-log IDs, not entry IDs, and did not edit Telegram.
