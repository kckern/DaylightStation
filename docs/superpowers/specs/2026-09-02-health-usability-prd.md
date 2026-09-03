# Health App — Usability, Capture & Data-Richness PRD

**Date:** 2026-09-02
**Status:** Draft for review
**Builds on:** `2026-09-02-health-loseit-revamp-design.md` (shipped). This PRD defines the
next program of work for `/health`, focused on accessibility, input friction, a richer
entry taxonomy, and data surfacing.

**Prime directive:** minimum taps/clicks/pokes from intent to logged food. Every story
below is judged against that.

---

## Theme 1 — Frictionless Capture

### User stories

- **U1.1** As a user adding food to a meal, I can tap a microphone icon right on that
  meal's add row and speak ("smoothie with blueberries and a scoop of whey"), and the
  existing voice-memo → transcription → parse pipeline logs it to *that* meal — no
  scrolling, no mode hunting.
- **U1.2** As a mobile user, "take a picture" and "scan a barcode" are one tap from
  anywhere on Today — I never scroll to the bottom of the page to reach a capture mode.
- **U1.3** As a user, capture launched from a meal row pre-targets that meal bucket;
  capture launched globally defaults the bucket by time of day, and I can correct the
  bucket on the resulting entry.

### Functional requirements

- **F1.1** Each meal section's add row (`AddCombobox` area) carries mic, camera, and
  barcode icon buttons beside the text input. They open the existing
  `VoiceCapture` / `PhotoCapture` / `BarcodeCapture` components with the meal bucket
  pre-bound. No new capture plumbing — this re-services `useNutritionInput` and the
  nutribot transcription wiring.
- **F1.2** A persistent global quick-capture affordance exists on mobile (floating
  button or fixed header row) exposing text / mic / camera / barcode. Bucket defaults by
  local time (breakfast / lunch / dinner / snacks windows).
- **F1.3** Captures resolve into entries via the Theme-3 lifecycle (immediate log as
  *unsettled*), not a blocking modal review queue.
- **F1.4** Tap-count budget (mobile, from Today): voice log ≤ 2 taps to start speaking;
  photo ≤ 2 taps to shutter; barcode ≤ 2 taps to scanning.

---

## Theme 2 — Groups & Entry Taxonomy

The log's entry model grows from a flat list-per-meal into composites.

### User stories

- **U2.1** As a user, I can log "Thanksgiving dinner" by voice or photo and get a
  *group* containing itemized foods, so I see one meaningful line that expands into its
  parts.
- **U2.2** As a user, a group represents a dish or course *within* a meal — a casserole
  with its ingredients, spaghetti (noodles, sauce, cheese, spices), or
  appetizer / main / dessert as sibling groups in one dinner. The meal buckets
  themselves are unchanged.
- **U2.3** As a user photographing food, the photo is associated with the group (or
  single item) it produced; I see a thumbnail on the log row and can tap to view the
  photo alongside its itemization.
- **U2.4** As a user, a photo containing two plates produces two sibling groups, each
  itemized, each carrying the photo.

### Functional requirements

- **F2.1** **Group is a first-class log entry**: own id, name, optional photo, optional
  icon, and children. Nutrition totals roll up from children. Groups collapse/expand in
  `LogTable`; a collapsed group row shows name, icon, thumbnail, and rolled-up
  calories/macros.
- **F2.2** **Data model allows unbounded nesting** (child entries carry a parent
  reference); nothing needs migrating if depth grows. **UI and AI itemization target one
  composite layer** in practice (meal → dish → ingredients). Deeper trees render as
  indented rows without specialized editing.
- **F2.3** Photos attach to *any* entry — group or single item. Photo capture creates a
  group when the AI finds multiple foods, a plain item when it finds one.
- **F2.4** Group-level operations: rename, move bucket, scale all children by a factor,
  delete (with children), add/remove a child, save as template (Theme 6).
- **F2.5** AI parse output (NL, voice, photo) is group-aware: the parser decides
  item-vs-group per capture and names groups sensibly ("Smoothie", "Dinner plate").

---

## Theme 3 — Entry Lifecycle & Settlement

Every entry is either **unsettled** (machine-estimated, unreviewed) or **settled**
(human-ratified). This replaces the blocking pending Accept/Revise/Discard queue.

### User stories

- **U3.1** As a user, AI captures (voice, photo, NL) log *immediately* as unsettled
  entries in the meal — I see them in place with a subtle cue, instead of a modal
  demanding review before anything lands.
- **U3.2** As a user, I can edit anything on any entry inline — serving size the barcode
  got wrong, name, bucket, icon, group membership — and editing settles it.
- **U3.3** As a user, entries I never touch stop nagging: after N days they
  auto-settle.
- **U3.4** As a user of the kitchen relay, when loose signals arrive — a UPC scan, a
  container tare (`ct:`), a caloric density (`dl:`), a food-scale weight — the app
  auto-matches them into a proposed entry ("82 g → Fage yogurt — matched") and I can
  ratify or re-pair, rather than the signals silently composing or getting lost.

### Functional requirements

- **F3.1** Entry field `settled: boolean` (+ `settledBy: user | auto`, timestamp).
  Unsettled entries render with a subtle visual cue (e.g. dashed accent / muted badge),
  not a separate section. `NeedsReviewSection`'s job dissolves into this.
- **F3.2** Settling actions: any manual edit; an explicit one-tap confirm on the row or
  edit sheet; group settle settles children.
- **F3.3** Auto-settle after **3 days** (constant, configurable server-side). Old days
  render clean.
- **F3.4** **Loose-signal observations.** Relay signals land as loosely-typed
  observations. A matcher pairs them by time-window adjacency and plausibility —
  mirroring nutribot's `CompositionStore` composition window and the
  `ScanVocabularyService` grammar (`dl:`, `ct:`, `rs:`) — and creates/updates an
  unsettled entry whose proposed pairing is visible on the row. Settling ratifies the
  match. The edit sheet can detach a measurement and re-pair it to a different entry.
  Unmatched observations persist (visible on the day) rather than being dropped.
- **F3.5** Net-weight math follows the existing domain rules (`net = max(0, gross −
  tare)`, clamp semantics, macros as percent-of-calories) — reuse
  `computeNet` / `computeNutrition`, do not fork them.

---

## Theme 4 — Macro & Micro Surfacing

### User stories

- **U4.1** As a user with a protein goal, I see protein progress on Today without
  opening a report.
- **U4.2** As a user watching sodium (or fiber, etc.), I can flag micros to watch and
  see them alongside macros.
- **U4.3** As a user, each meal section shows its macro subtotal at a glance.

### Functional requirements

- **F4.1** A compact horizontal-bar row sits directly under the equation strip:
  protein / carbs / fat vs. goal, plus user-flagged watch micros. Over-goal is visually
  distinct (watch micros are typically ceilings, macros typically floors — render
  accordingly).
- **F4.2** Per-meal sections show tiny macro subtotals (extends `MacroFooter` language).
- **F4.3** Goals and watch-micro selection are configured in Progress/settings and
  served with the budget payload (`GET /api/v1/health/budget` grows goal fields).
- **F4.4** Macro/micro math uses the same data the report generation already computes —
  one source of truth, surfaced in two places.

---

## Theme 5 — Food Icons

### User stories

- **U5.1** As a user, every log row carries a recognizable food icon from the hi-res
  PNG set (`media/img/nutrition/icons`), making the log scannable at a glance.
- **U5.2** As a user, repeat foods keep their icon (it sticks to the catalog food, not
  just the entry).
- **U5.3** As a user, I can change a wrongly-assigned icon in the edit sheet.

### Functional requirements

- **F5.1** The capture/parse agent assigns an icon id per item at parse time (same
  pattern Nutribot already uses for icon matching); stored on the entry *and* on the
  catalog food so suggestions and repeats inherit it.
- **F5.2** Icons render on item rows, group rows (dish icon, else dominant child's
  icon), saved-meal/template pickers, and the edit sheet. Served from the icons folder
  with an icon-id → filename manifest; **no hardcoded asset paths in code** — the
  manifest/config owns filenames, unmapped ids render a neutral fallback silently.
- **F5.3** Icon vocabulary = the files present in the folder; the agent picks from the
  manifest list, never invents a name.

---

## Theme 6 — Smart Meal Templates

### User stories

- **U6.1** As a user who gets a smoothie most days with a stable core (chia, protein
  drink, greens powder) and rotating variants (blueberries / mango / banana), I can log
  "smoothie" and get my baseline dropped in as a group, then swap variants and scale —
  instead of re-itemizing every time.
- **U6.2** As a user, a background agent notices my recurring combos and proposes
  templates ("You log this stack ~3×/week — save as 'Morning smoothie'?") with core
  ingredients vs. common variants marked. I approve and name them.
- **U6.3** As a user, I can still manually save any group or meal as a template.

### Functional requirements

- **F6.1** Template = named set of component foods, each marked **core** or
  **variant**, with default quantities. Instantiating drops a group with core items
  included and variants offered as quick toggles; the group is then ordinary (editable,
  scalable via F2.4).
- **F6.2** A periodic curation agent mines log history for recurring co-occurring item
  sets, computes core-vs-variant by frequency, and writes *proposals*; proposals surface
  in the template picker for approve/name/dismiss. Nothing is auto-created without
  approval.
- **F6.3** Existing saved-meals (snapshots) migrate or coexist as all-core templates;
  the template picker replaces `SavedMealsSheet` as the single surface.
- **F6.4** Typing in the add combobox matches template names ahead of catalog foods
  when the name matches a template.

---

## Theme 7 — Data Visualization & Layout

### User stories

- **U7.1** As a user, the week rail shows something meaningful: each day as a mini
  stacked macro bar scaled against my calorie budget with over/under coloring — the
  report-chart language shrunk into the nav strip. Tapping a day opens it.
- **U7.2** As a user, I see my current weight, trend direction, and a mini trend chart
  on the main page without opening Progress.
- **U7.3** As a user, I can see exercise offset — intake vs. burn — for the day and
  over time.
- **U7.4** As a desktop user, the app doesn't stretch absurdly wide: the log column is
  capped, and on wide viewports a right sidebar appears with drill-down content.

### Functional requirements

- **F7.1** `WeekStrip` is replaced by per-day mini stacked macro bars (protein / carbs
  / fat) with height/scale vs. budget and over/under coloring; today highlighted; days
  remain tap-to-navigate.
- **F7.2** Weight widget: current weight, trend delta (e.g. 7/30-day slope), sparkline.
  Desktop: top of sidebar. Mobile: compact chip/row near the equation strip.
- **F7.3** Exercise offset: the day's burn credit is already in the equation strip;
  add an over-time intake-vs-burn chart (sidebar on desktop, Progress tab on mobile).
  Exercise credit stays single-sourced per BudgetService (activity-else-fitness — no
  double counting).
- **F7.4** Layout: main column max-width ≈ 720 px, centered. At ≥ ~1100 px a right
  sidebar mounts: weight + trend, macro detail, week/month charts, exercise offset.
  Below the breakpoint that content collapses into the main column / Progress tab.

---

## Priorities & build order

All themes are approved as one program (single wave). Recommended build order, driven
by dependency, not preference:

1. **Foundation — Theme 3 + Theme 2** (lifecycle + groups). Everything else writes
   entries; the entry model and settlement semantics must land first.
2. **Theme 1** (capture affordances) — re-services existing capture components onto the
   new lifecycle.
3. **Themes 4, 5, 7** (macros, icons, viz/layout) — display-layer work over the new
   model; parallelizable.
4. **Theme 6** (templates) — depends on groups (instantiates them) and benefits from
   accumulated grouped history.

## Non-goals

- No change to meal buckets themselves (breakfast/lunch/dinner/snacks stand).
- No recursive group *editing* UI (model supports depth; UI stays one composite layer).
- No auto-created templates without user approval.
- No new capture pipelines — voice/photo/barcode/transcription wiring is reused.
- Coach/chat features unchanged except where entries they create adopt the lifecycle.

## Open decisions resolved during interview

| Decision | Resolution |
|---|---|
| Group model | First-class entry with rollups, photo, children |
| Group ≠ meal | Group is a dish/course composite inside a meal bucket |
| Nesting | Model unbounded via parent refs; UI/AI target one layer |
| Photos | Attach to any entry; thumbnail on row; multi-food photo → group |
| Capture placement | Per-meal row icons **and** global one-tap (time-of-day bucket default) |
| Review flow | Pending queue replaced by immediate log as *unsettled*; auto-settle 3 days |
| Relay signals | Loosely-typed observations, auto-matched, ratified at settlement, re-pairable |
| Macro surfacing | Bar row under equation strip + per-meal subtotals + watch micros |
| Icons | AI-assigned at parse, stored on entry + catalog, user-overridable |
| Templates | Agent-curated proposals + manual save; core vs. variant components |
| Week rail | Mini stacked macro bars per day vs. budget |
| Desktop | ~720 px max column; ≥ ~1100 px right sidebar with drill-downs |
