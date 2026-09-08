# Health UI audit — density, direct manipulation, and trustworthy feedback

Date: 2026-09-05. Status: audit and recommendations only; no runtime changes.
Live build audited: `fe62028c3`. Scope: the production `/health` page, food
editing/review, and a secondary visual pass through Progress, Medical, Coach,
and cleanup settings.

## Summary

The food grouping is a useful foundation, but the page allocates its best space
to navigation, history, and repeated secondary controls. It is not primarily a
font-size problem: the main food text is already about 14px and status text about
11px. The best improvement is to move context sideways, reduce repeated rows,
and make the portion itself directly editable.

Several issues are functional or semantic, not cosmetic: confirmation has no
pending feedback or duplicate-click guard; a group confirmation only ratifies
its header; incidental edits also ratify nutrition; unknown macros appear as
zeroes; the Coach send button has neither visible content nor an accessible
name. These should be addressed alongside the density work.

## Evidence and method

- Headless Chromium loaded the actual production URL, using the household's
  local timezone and six viewport sizes: 1920×1080, 1440×900, 1366×768,
  1024×768, 768×1024, and 390×844.
- Screenshots cover top, middle, and bottom of the real nested scroll region,
  not just a full-page capture that misses content inside that region.
- Inspected screenshots, DOM geometry, accessible labels, current read-only
  health API responses, implementation, and existing structured logs.
- All non-GET/HEAD/OPTIONS API requests from the audit browsers were intercepted.
  No food, settings, Telegram, or agent execution command was sent to production.
  Portion drafts were canceled. The confirmation probe used a browser-local
  copy of the day plus simulated write responses and delayed reads.
- The simulated confirmation generated two intercepted requests; the real chia
  entry afterward remained provisional, version 1, 14g, 70 kcal. Day food remained
  1,539 kcal. Existing successful confirmation logs came from the user's browser,
  not this audit.
- No browser exceptions or failed Health GET responses were observed in the
  baseline captures. This is not an exhaustive accessibility, backend, camera,
  microphone, or assistive-technology test.
- Independent panels load asynchronously. The measurements below use the saved
  initial screenshots with the pending-review banner present. Do not confuse
  intermediate captures before that banner loads with a compact final layout.

### Screenshots

| Evidence | Screenshot |
|---|---|
| Desktop first screen | [1440×900](./2026-09-05-health-ui/desktop-top.png) |
| Short laptop first screen | [1366×768](./2026-09-05-health-ui/laptop-top.png) |
| Wide-screen unused space | [1920×1080](./2026-09-05-health-ui/wide-top.png) |
| Mobile first screen | [390×844](./2026-09-05-health-ui/mobile-top.png) |
| Mobile meals and tree | [Scrolled meal log](./2026-09-05-health-ui/mobile-middle.png) |
| Expanded dish, loaded artwork | [Group detail](./2026-09-05-health-ui/group-expanded-loaded.png) |
| Chia portion draft, not saved | [28g preview](./2026-09-05-health-ui/portion-draft-28g.png) |
| Unknown macros rendered as zero | [Scale-food editor](./2026-09-05-health-ui/unknown-macros-editor.png) |
| Pending food review | [Review form](./2026-09-05-health-ui/pending-review.png) |
| Other tabs | [Progress desktop](./2026-09-05-health-ui/progress-desktop.png), [Progress mobile](./2026-09-05-health-ui/progress-mobile.png), [Medical](./2026-09-05-health-ui/medical-desktop.png), [Settings](./2026-09-05-health-ui/settings-desktop.png), [Coach with unsent draft](./2026-09-05-health-ui/coach-draft-no-send.png) |

Full geometric and interaction evidence: [measurements.json](./2026-09-05-health-ui/measurements.json).
The adjacent evidence directory also contains the other viewport/scroll captures.

### Measured fold cost

Coordinates are CSS pixels from the top of the viewport, before scrolling.

| Viewport | First food row starts | Dinner group starts | Visible main region ends |
|---|---:|---:|---:|
| 1440×900 | 609 | 887 | 900 |
| 1366×768 | 609 | 887 | 768 |
| 390×844 | 754 | 1032 | 787, above bottom navigation |

The desktop week strip is 168.5px tall. The same strip stays 168.5px on mobile,
where a 102px weight block is also above the log. The desktop left rail is 200px
wide and contains only four links. At 1920px, the Today wrapper still caps itself
at 1064px, leaving 312px margins on each side inside the main region. The right
sidebar is 320px wide and its visible content ends around y=504.

## Priority 1 — trust and interaction correctness

### 1. Confirmation looks inactive and accepts repeat clicks

**Confirmed by live logs, code, and an isolated interaction probe.** The yellow
square is a button meaning “confirm this estimate,” not a checkbox selecting a
row. `EntryRow` PUTs `{settled:true}` and calls a resource refresh. There is no
busy state, synchronous in-flight guard, optimistic acknowledgement, descriptive
visible label, or submitted snapshot version.

User-browser logs show repeated successful confirmations of Scrambled Eggs around
23:14 local time, not just failed clicks. With simulated 700ms writes and 1000ms
reads, the button remained enabled and two clicks produced two requests. After
the simulated refreshed day arrived, it disappeared correctly. Thus the handler
is not universally dead; the exact prior stale-screen sequence is not proven by
this audit, but the feedback and repeat-submission defect is reproduced.

Recommendation: a plainly named optional “Confirm estimate” action, immediate
pending feedback, one in-flight operation, expected-version protection, an inline
success transition, and a readable retry/error state. Keep a fixed action column
so removing the control does not shift grams/calories sideways. Do not add a
toast for every routine confirmation or automatic stabilization.

Source: `frontend/src/modules/Health/today/EntryRow.jsx:51` and `:136`.

### 2. Group confirmation and ordinary editing have surprising scope

**Code-confirmed semantic findings, not production mutation tests.** A group
button sends the same single-row confirmation as an ingredient. The backend only
cascades meal/date changes and portion scaling to children, so confirming the
zero-nutrition header does not confirm the ingredients. Conversely, any ordinary
row edit defaults to ratifying that row's nutrition, including a name/icon edit.
This also makes it ineligible for subsequent automatic provisional review.

Recommendation: distinguish presentation corrections, portion corrections, and
explicit nutritional confirmation. Protect fields a person actually corrected;
do not infer full nutrition approval from choosing artwork. If a dish-level
confirmation is offered, make its scope explicit and atomically confirm the
intended ingredients, or omit that action at header level. Preserve the existing
repair/verification safeguards while clarifying these commands.

Source: `backend/src/3_applications/health/HealthOperations.mjs:173`, `:218`;
`frontend/src/modules/Health/today/EntryEditor.jsx:75`.

### 3. Unknown nutrition is presented as known zero

**Live reproduction.** The 458g scale entry has `protein:null`, `carbs:null`, and
`fat:null` in the API. Its editor displays `P 0 g · C 0 g · F 0 g`. Meal and day
macro summaries show sums of known values without marking the missing scale-food
contribution. Today’s top macro bars are entirely absent because no macro targets
are configured, even though known intake totals exist.

Recommendation: render unknown as `—`; identify aggregate macros as partial when
contributors are missing; show compact intake numbers independently of configured
targets. Add per-item P/C/F columns on wide screens and an optional inline detail
on narrow screens. Never fabricate macros from calories or caloric density.

Source: `EntryEditor.jsx:102`, `LogTable.jsx:20`, `MacroBarRow.jsx:89`.

### 4. Known volume is hidden behind “Weight unknown”

**Live data and code.** Yogurt has `amount:170, unit:'ml', grams:null`, but its
older `originalQuantity.unit` is `g`. The row requires both the current and
original unit to be `ml`, so it hides the recorded volume. The gram-only editor
also offers no direct volume adjustment. This is not permission to assume
170ml equals 170g.

Recommendation: use one canonical portion presentation contract with serving,
mass, volume, and provenance. Show the best supported quantity, and make any
conflicting basis inspectable. Unknown mass should not erase known volume or
produce a long placeholder that crowds out the food name.

Source: `EntryRow.jsx:41`, `EntryEditor.jsx:94`.

### 5. Mobile stats overflow; Coach has an unnamed empty send button

**Live DOM measurements.** Progress fits three roughly 103px cards side by side
at 390px. The trend unit extends about 23px beyond its card. In Coach, typing an
unsent draft enables a literal empty `<button class="coach-chat__send">` with
no text, `aria-label`, or title. The fresh conversation also has no useful
introductory content, leaving almost the entire page blank.

Recommendation: give stats a value-aware responsive layout; give Send visible
artwork/text and an accessible name. Provide a few useful optional starter
prompts/context cues, not automatically generated conversation spam.

Source: `health.scss:674`, `frontend/src/modules/Agent/AgentChatSurface.jsx:263`.

## Priority 2 — compact the daily workflow

### 6. Move context out of the primary vertical stack

Use the left rail below navigation for compact week/date navigation, weight, and
a small history summary on desktop. Eliminate the competing right history column
for Today, or make extended charts optional. The large graphs already have a
home in Progress. At narrow widths, collapse history behind a compact disclosure;
do not place a full weight card and tall week strip before the first meal.

Do this through a supported shell slot/layout contract, with one mounted owner
per widget—not duplicate components hidden at different breakpoints. TodayView
already shares one range resource for its 30-day widgets; preserve that ownership.

Source: `TodayView.jsx:318`, `:328`, `:335`; `health.scss:245`, `:277`;
`frontend/src/lib/ui/ds.scss:111`.

### 7. Give the day more usable columns

The current log remains a single 720px column even on a wide monitor. Use the
reclaimed space for aligned quantity, kcal, and macro columns and, where adequate
width remains, balanced meal columns. Keep chronological and keyboard reading
order predictable; do not introduce masonry that changes ordering or leaves
empty fixed-height meal cards. Collapse empty meals to a compact heading/add
control. One-column layout remains appropriate for a phone.

### 8. Remove repeated vertical tax, not legibility

- Estimated and scale-evidence lines make measured rows 54.4px instead of the
  regular 44px. Put the estimate cue inline, with an accessible explanation on
  focus/tap. Put scale provenance beside the quantity; do not repeat `458 g`.
- Meal macros currently consume another full line. Place them in the meal
  heading where space allows, using concise P/C/F labels with explanations.
- Every meal gets a separate 44px Add-food row. Put its add action in the heading
  instead, keeping its target easy to hit.
- The group header wraps `Total · 668 kcal` into two lines despite a 720px log.
  Reserve a consistent numeric column and use one subtotal convention.
- The global capture bar plus meal-add expansion can render two capture bars.
  Use one clear active meal target and contextual capture surface.
- On mobile the equation's `UNDER` label wraps onto its own line. Keep amount and
  status together; a compact “596 kcal remaining” with expandable equation is a
  clearer presentation of the same ledger calculation.

Keep the house touch-target floor. The page can lose substantial height without
shrinking text below its already small size. Separately, the current edit dialog
has 22px-high multiplier buttons, a 24px-wide icon button, and a 34px close button;
these need larger hit areas rather than further compression.

### 9. Separate exceptional uncounted captures from ordinary estimates

The pending Chocolate Protein Shake banner consumes about 109px above all meals.
It is a different state from yogurt/chia, which already count. The main banner
does not make that counted/not-counted distinction clear; the review dialog does.

Recommendation: a compact “1 capture not counted · Review” summary that expands
deliberately. Keep real exceptions discoverable. Do not classify ordinary
provisional rows as tasks the user must settle, and do not simply hide a genuinely
uncounted capture to improve the screenshot.

### 10. Retain grouping, finish the tree

Every child has a full-height left border. There is no last-child termination,
so the vertical line continues below Shredded Cheese. Use a branch segment that
ends at the last child's horizontal connector, with geometry tied to row height.
Preserve collapse state, non-additive group totals, and separate expand/edit
targets. The group currently reserves a photo AND a neutral circle; use one
appropriate artwork slot rather than spending space twice.

Source: `health.scss:501`; `LogTable.jsx:107`; `EntryRow.jsx:111`.

### 11. Implement the portion as a scrub control

**Current behavior reproduced:** clicking `14 g` opens the full editor. Changing
the draft to `28 g` changes the editor preview to 140 kcal, but the underlying
row stays 14g/70 kcal, Lunch stays 871 kcal, and the day stays 1,539 kcal until
Save. There is no direct-drag interaction.

Proposed contract:

1. Press/drag the numeric portion horizontally: left decreases, right increases.
   Show a resize cursor and a short discoverable hint. A normal click opens a
   compact numeric editor; the name/details action opens the full sheet.
2. Apply a browser-local draft overlay to the shared day read model. Preview the
   item, dish, meal, day calories, and known macros together. Do not independently
   recompute each widget or call the API for each pointer movement.
3. On release, send one version-checked portion command; reconcile with the
   authoritative response. Reuse `foodQuantity.mjs` and the counted-row contract.
   Committed data then follows the existing Health/Telegram receipt pipeline.
4. On Escape or canceled pointer gesture, discard the preview without a write.
   On failure/conflict, roll back/reconcile visibly with a retry option. A
   background poll or Mastra repair must not overwrite an active gesture.
5. Provide keyboard increments and direct entry; retain mobile vertical scrolling
   and use a drag threshold/pointer capture to prevent accidental sheet opening.
   Preserve known-zero versus unknown nutrients. Do not enable gram scrubbing
   without a valid original mass/basis; known volume needs its own unit-aware path.
6. Dish scaling updates children atomically and counts them once. A header remains
   organizational, not extra consumption. Keep draft versus saved state explicit.

This is a recommended interaction design, not an implemented feature.

## Priority 3 — artwork, consistency, and secondary screens

### 12. Food art needs completion and quality control, not just a fallback

All three lunch entries and the burrito header have `icon:'default'`. The circles
are intentional placeholders, not failed downloads. The five ingredient icons
can load successfully. However, Diced Ham is assigned `bacon-cheeseburger`, which
is a semantically wrong successful image. The UPC path already attempts AI icon
classification, and the reviewer already has a manifest-backed artwork tool;
“no effort is being made” is not an accurate code-level diagnosis.

Recommendation: track missing/wrong artwork separately; prefer catalog pins and
manifest-backed semantic matches, then guarded reviewer suggestions. Keep this
enrichment optional and independent from saving consumption. Use a neutral generic
dish/scale glyph when identity genuinely is unknown. Never substitute a specific
wrong food just to fill every slot. Existing confirmed/manual choices require
appropriate protection; no blanket historical icon rewrite.

There is also documentation drift: the reference still describes a colored
fallback and first-child group fallback, while the live row uses a neutral circle
and only `row.icon`. Align the intended contract, implementation, and regression
tests in the eventual change.

### 13. Weight trend names mask different calculations

Today shows `±0.0 / 7d`; Progress shows `+0.21 lbs/wk` under “7-day trend.” The
former compares two adjusted-average values; the latter reads the stored trend
field. This audit does not claim the underlying values are numerically wrong.
The matching wording makes different measurements look inconsistent. Choose a
canonical metric or label the distinction and time basis explicitly. The latest
weight widget also needs an as-of cue when browsing a historical food date.

### 14. Progress buries goals under full-width charts

The Goals heading only reaches the bottom of a 900px desktop viewport. Use a
clear goal summary with Edit, and organize secondary charts into a responsive
grid. Keep the logged-versus-missing-day distinctions already present. Do not
make historical logging gaps look like zero intake.

### 15. Settings reads like an execution log

“Recent scans” means cleanup-agent runs here, while “scan” elsewhere means food
capture. Ten timestamp/status rows precede repair history, with little immediate
explanation of what changed. Prefer a compact last-run summary, “Cleanup runs”
terminology, and collapsed history with outcome counts. Keep evidence, conflict
details, and undo accessible; those are important safeguards, not clutter to delete.

### 16. Small presentation and discoverability gaps

- Exercise shows “Workout” although the API also supplies the specific session
  title; the implementation prioritizes `type` over `title`.
- Medical's empty state repeats Add reading above and inside the same panel.
- The row action label is always “Confirm entry”; include the food name for
  nonvisual navigation. Add clear hover/focus affordances to row details and
  quantity actions.
- The Settings icon resembles generic sliders and has no visible tab label;
  make its destination clearer without adding another large navigation region.
- Keep capitalization, units (`lb/lbs`, `g` spacing), calories, and P/C/F
  precision consistent across row, rollup, sheet, and summaries.
- Form failures currently inherit raw HTTP/JSON error text; provide concise
  field/action-specific recovery while preserving detailed structured logs.

## Proposed desktop hierarchy

This is a structural proposal, not a screenshot of implemented changes.

```text
┌──────────────────────┬─────────────────────────────────────────────────┐
│ Today / Progress / … │ Date · day budget / food / remaining · P/C/F    │
│                      │ Compact capture bar · exceptional review count │
│ Compact week picker  ├────────────────────────┬────────────────────────┤
│ Weight + small trend │ Meal / dish / items    │ Meal / dish / items    │
│ Brief history        │ name · portion ↔ · kcal│ name · portion ↔ · kcal│
│ More in Progress     │ optional P/C/F columns │ optional P/C/F columns │
└──────────────────────┴────────────────────────┴────────────────────────┘
```

Use two meal columns only when they retain readable names and numeric columns.
On smaller screens, retain a single log, compact summary/capture access, and
disclosed history. Avoid a rigid grid that creates empty meal-sized holes.

## Suggested implementation order and acceptance criteria

1. **Trust first:** confirmation feedback/versioning/scope, unknown macro/portion
   presentation, accessible Coach send button, mobile stat overflow.
2. **Density:** one useful left rail; week/history out of the primary stack;
   compact pending summary; inline badges and meal-add actions; finished tree;
   consistent numeric columns and optional per-item macros.
3. **Direct manipulation:** shared draft projection, scrub/keyboard/direct-entry
   controls, one commit on release, cancellation/failure/conflict handling.
4. **Polish:** artwork quality, trend terminology, secondary screen hierarchy.

Acceptance targets for the same saved incident, rather than just golden images:

- At 1366×768, first food at or above y=300; lunch and dinner identifiable without
  scrolling. At 390×844, first food at or above y=350, with history collapsed.
  These are design targets, not claims about the current UI.
- Expanded dinner and lunch remain readable; empty meals do not reserve large
  card heights. Preserve practical touch targets, keyboard focus, and no overflow.
- Last tree connector terminates correctly for one/many children and changing
  row height. Collapse/expand still preserves non-additive totals and stable IDs.
- Rapid repeated confirmation sends one command; pending/success/error is
  perceivable; group scope is explicit. Presentation edits do not accidentally
  make unknown nutrition human-confirmed under the revised contract.
- Dragging chia 14g to 28g previews 140 kcal, lunch 941 kcal, day 1,609 kcal,
  and remaining 526 kcal for this snapshot, with known macros updated. No API
  writes during motion; one command on release; Escape writes nothing.
- Poll/reviewer conflicts cannot silently replace a draft or overwrite a newer
  committed edit. Failed commits reconcile honestly and do not announce false
  success. Successful commits update the original Telegram receipt normally.
- Unknown P/C/F remain unknown; partial aggregates are labeled. Known volume
  never becomes fabricated grams. No calorie double-counting from groups.
- Missing art, failed art, and semantically wrong art have separate regression
  cases. Ordinary enrichment/stabilization produces no settlement prompts.

The application, production food data, and Telegram messages were not modified
by this audit. Only this report, screenshots, and measurement artifacts were added.
