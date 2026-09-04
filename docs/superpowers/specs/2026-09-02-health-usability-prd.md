# Health App — Usability, Capture & Data-Richness PRD

**Date:** 2026-09-02 (rev 2, post adversarial review)
**Status:** **Delivered** (2026-09-04, branch `feat/health-usability`). Every theme is built; the
build-order table below records what landed where. Deviations and the reasoning behind them
are in `docs/_wip/plans/2026-09-03-health-usability-decisions.md`.
**Builds on:** `2026-09-02-health-loseit-revamp-design.md` (shipped). This PRD defines the
next program of work for `/health`, focused on accessibility, input friction, a richer
entry taxonomy, and data surfacing.

**Prime directive:** minimum taps/clicks/pokes from intent to logged food. Every story
below is judged against that.

**Invariants this PRD consciously reverses** (adversarial review R2 — all confirmed by
the product owner):

- *"Pending doesn't count until accepted"* → retired. Unsettled entries **count** in the
  calorie equation immediately; the unsettled cue + easy edit is the safety valve.
- *"Coach never auto-accepts"* → retired. Coach `log_food` entries land unsettled and
  counting, like every other capture; editability replaces the gate.
- The pending Accept/Revise/Discard queue → retired **across all transports** (web,
  Telegram nutribot, scale bridge). One lifecycle everywhere; `rejected` becomes
  unreachable; discard = delete.

---

## Theme 1 — Frictionless Capture

### User stories

- **U1.1** As a user adding food to a meal, I can tap a microphone icon right on that
  meal's add row and speak ("smoothie with blueberries and a scoop of whey"), and the
  voice-memo → transcription → parse pipeline logs it to *that* meal — no scrolling, no
  mode hunting. (Today the pipeline derives the meal from the clock; targeting the
  launch row is new behavior.)
- **U1.2** As a mobile user, "take a picture" and "scan a barcode" are one tap from
  anywhere on Today — I never scroll to the bottom of the page to reach a capture mode.
- **U1.3** As a user, capture launched from a meal row defaults to that bucket; capture
  launched globally defaults by time of day. If I *say* a meal ("…for lunch") that
  explicit intent wins over the launch row, with a brief "moved to Lunch" cue.

### Functional requirements

- **F1.1** Each meal section's add row carries mic, camera, and barcode icon buttons
  beside the text input, opening the existing `VoiceCapture` / `PhotoCapture` /
  `BarcodeCapture` components. **Bucket pre-binding is new plumbing end to end**:
  `POST /nutrition/input` gains a bucket parameter threaded through
  `NutribotInputRouter` and the `LogFoodFrom*` use cases (which currently clock-derive
  `meal.time`). No follow-up-PUT patching — the entry is born in the right bucket.
- **F1.2** A persistent global quick-capture affordance on mobile (floating button or
  fixed header row) exposing text / mic / camera / barcode, bucket defaulted by local
  time. It **replaces** the current footer capture icons — one capture surface, not
  two.
- **F1.3** Bucket conflict rule: explicit meal in the utterance / caption overrides the
  launch-row binding; launch row overrides the clock default. A moved entry shows a
  transient "moved to <bucket>" cue.
- **F1.4** Captures resolve into entries via the Theme-3 lifecycle (immediate log as
  *unsettled*), not a blocking modal review queue.
- **F1.5** Tap-count budget (mobile, from Today, **counting taps in our UI with warm
  permissions** — OS camera chrome and first-run permission prompts excluded): voice
  ≤ 2 taps to speaking; photo ≤ 2 taps to the OS capture handoff; barcode ≤ 2 taps to
  scanning.

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
  itemized, each referencing the photo.

### Functional requirements

- **F2.1** **Group is a first-class log entry**: own id, name, optional photo
  reference, optional icon, and children. Groups collapse/expand in `LogTable`; a
  collapsed group row shows name, icon, thumbnail, and rolled-up calories/macros.
- **F2.2** **Storage:** groups are represented in the flat per-item store as an entry
  kind with a `parentId` reference (children point at their group; depth is unbounded
  in the model). The `NutriLog` capture record remains provenance, not the group
  entity. **This is a schema change, not a no-op:** the NutriLog validator, NutriList
  dehydrator, and `FoodItem` schema are field whitelists that silently drop unknown
  keys, so `parentId`, `settled`, `photoRef`, and `icon` must be threaded through every
  whitelist (hot + archive stores included). No data backfill is required — absent
  fields default at read time (see F3.6) — but the whitelists must land before anything
  else in this program.
- **F2.3** **Rollups are computed on read, never stored.** Editing a child can never
  leave a stale stored total.
- **F2.4** UI and AI itemization target one composite layer (meal → dish →
  ingredients); deeper trees render as indented rows without specialized editing.
- **F2.5** **Photo infrastructure (new — none exists today; photos are currently parsed
  and discarded):** captured photos persist as files under the user's app data (never
  data-URLs in YAML), served via a new authenticated endpoint with a thumbnail
  variant; entries store a photo reference. Photos are household-private. A photo
  referenced by multiple entries (U2.4) survives until its last referencing entry is
  deleted. Retention: kept indefinitely with the log (revisit if storage becomes an
  issue).
- **F2.6** Group-level operations: rename, move bucket, scale all children by a factor
  (input = preset multiplier chips ×½ / ×1½ / ×2 plus a stepper — **no sliders**,
  per repo touch-UI convention), delete (with children), add/remove a child, save as
  template (Theme 6).
- **F2.7** AI parse output (NL, voice, photo) is group-aware: the parser decides
  item-vs-group per capture and names groups sensibly ("Smoothie", "Dinner plate").

---

## Theme 3 — Entry Lifecycle & Settlement

Every entry is either **unsettled** (machine-estimated, unreviewed) or **settled**
(human-ratified). This replaces the pending Accept/Revise/Discard queue **for all
transports**.

### User stories

- **U3.1** As a user, AI captures (voice, photo, NL, coach, Telegram, scale) log
  *immediately* as unsettled entries in the meal — visible in place with a subtle cue,
  counting in the equation — instead of a queue demanding review before anything lands.
- **U3.2** As a user, I can edit anything on any entry inline — serving size the barcode
  got wrong, name, bucket, icon, group membership — and editing settles it.
- **U3.3** As a user, entries I never touch stop nagging: after N days they read as
  settled.
- **U3.4** As a user of the kitchen relay, when loose signals arrive — a UPC scan, a
  container tare (`ct:`), a caloric density (`dl:`), a food-scale weight — the app
  auto-matches them into a proposed entry ("82 g → Fage yogurt — matched") and I can
  ratify or re-pair, rather than the signals silently composing or getting lost.

### Functional requirements

- **F3.1** Entry fields `settled: boolean` + `settledBy: user | auto` + timestamp.
  Unsettled entries render in place with a cue that is **not color-alone** (see
  Accessibility). Unsettled entries **count** in `BudgetService`'s food sum — the
  shipped pending-exclusion rule is deliberately retired.
- **F3.2** **One lifecycle across transports.** The `LogFoodFrom*` use cases stop
  minting `pending`; Telegram's Accept/Discard keyboard becomes edit/undo affordances;
  the scale path commits unsettled entries. `rejected` is retired; discard = delete.
- **F3.3** **Off-surface entries must reach the day view.** Entries created by any
  transport (Telegram, scale bridge, coach) are written to the same per-day store
  `GET /nutrilist/:date` reads — a sync requirement, so the 2026-09-02 "invisible
  pending logs" incident cannot recur once `NeedsReviewSection` dissolves.
- **F3.4** Settling actions: any manual edit; an explicit one-tap confirm on the row or
  edit sheet. Settling a group settles its children; editing a child settles that child
  only; a group reads as settled when all children are settled.
- **F3.5** **Auto-settle is read-time, not a job**: an unsettled entry older than
  **3 days** (server-side constant) is *treated* as settled everywhere it renders or
  aggregates — no scheduled mutation of day files or archives. `settledBy: auto` is
  therefore only materialized if some later write touches the entry.
- **F3.6** **Migration by defaulting:** rows without a `settled` field read as
  **settled**. Day one shows no wall of dashed rows; no backfill of hot or archive
  files.
- **F3.7** **Loose-signal observations — the matcher replaces `ScaleNutribotBridge`**
  as the single arbiter of relay events, and must absorb the bridge's shipped behaviors
  as requirements: quiet-commit after 25 s of scale rest, `rs:done` immediate commit,
  `rs:clear`/`rs:undo` semantics, slot consumption at placement end, re-prompt dedup,
  refusal of non-gram units. Observations persist in a **new durable store** (the
  in-memory `CompositionStore` doesn't survive restarts and can't back re-pairing).
  Matching rules: 900 s composition window (parity with today); plausibility =
  kcal-per-gram sanity against the candidate entry; tie-break = nearest-in-time
  unsettled entry; a weight arriving before its barcode/entry waits within the window,
  then attaches to the next entry created in it. The proposed pairing is visible on the
  row; settling ratifies it; the edit sheet can detach and re-pair. Unmatched
  observations render as a compact row on the day and become dismissible after day end
  — never silently dropped. Attribution: head of household (see Non-goals).
- **F3.8** Net-weight math reuses the existing domain functions (`net = max(0, gross −
  tare)`, clamp semantics, macros as percent-of-calories). **Note:**
  `computeNutrition` currently has no production caller; wiring it forces the
  documented open decision on macro storage — resolved here: scan-derived macros land
  on the item's existing `protein/carbs/fat` fields.

---

## Theme 4 — Macro & Micro Surfacing

### User stories

- **U4.1** As a user with a protein goal, I see protein progress on Today without
  opening a report.
- **U4.2** As a user watching sodium (or fiber, etc.), I can flag micros to watch and
  see them alongside macros — with an honest signal when the underlying entries lack
  micro data.
- **U4.3** As a user, each meal section shows its macro subtotal at a glance.

### Functional requirements

- **F4.1** A compact horizontal-bar row sits directly under the equation strip:
  protein / carbs / fat vs. goal, plus user-flagged watch micros. Over-goal is visually
  distinct (watch micros are typically ceilings, macros typically floors — render
  accordingly).
- **F4.2** **Micro honesty:** most existing entries store structural zeros for micros.
  The AI parse and catalog paths start emitting micros for new entries, AND watch-micro
  bars carry a coverage indicator ("based on 6 of 9 items") so a sodium bar over
  missing data never reads as reassurance.
- **F4.3** Per-meal sections show tiny macro subtotals (extends `MacroFooter`
  language).
- **F4.4** Goal configuration lives in Progress/settings; the budget payload's existing
  `goals` object gains macro-goal and watch-micro fields.
- **F4.5** Macro/micro math uses the same data report generation computes — one source
  of truth, surfaced in two places.

---

## Theme 5 — Food Icons

### User stories

- **U5.1** As a user, every log row carries a recognizable food icon from the hi-res
  set, making the log scannable at a glance.
- **U5.2** As a user, repeat foods keep their icon (it sticks to the catalog food, not
  just the entry).
- **U5.3** As a user, I can change a wrongly-assigned icon in the edit sheet — choosing
  whether the fix applies to just this entry or always for this food.

### Functional requirements

- **F5.1** **One icon vocabulary.** Today there are two universes: nutribot's
  `FilesystemFoodIconCatalog` (flat ~310-PNG folder, slugs already stored on
  `FoodItem.icon`) and the new hi-res set at `media/img/nutrition/icons` (~626 files in
  29 subdirectories, with Dropbox case-conflict duplicates). A **one-time curation
  pass** produces a hand-authored manifest config (icon-id → relative path) — the
  single vocabulary both the agent and the UI use. Existing `FoodItem.icon` slugs map
  in via manifest aliases where a counterpart exists. Renames happen in the manifest,
  never by trusting folder state; unmapped ids render a neutral fallback silently
  (**no hardcoded asset paths in code** — the manifest owns filenames).
- **F5.2** The capture/parse agent assigns an icon id per item at parse time, choosing
  from the manifest list (never inventing names); stored on the entry *and* on the
  catalog food. `FoodCatalogEntry` gains an icon field (it has none today).
- **F5.3** Icons render on item rows, group rows (dish icon, else dominant child's
  icon), the quick-add and template pickers, and the edit sheet.
- **F5.4** Icon override in the edit sheet offers **"just this entry" / "always for
  this food"** — the former touches only the entry; the latter pins the catalog
  **and** corrects the row on screen. *(Corrected during implementation: this line
  originally said "past rows follow on next render". They do not. A row's `icon` is
  a copy taken at log time and nothing rewrites history, so "always" governs this
  row and everything logged afterwards, while earlier rows keep the picture they
  were logged with. Pinning the catalog alone would leave the row the user is
  looking at unchanged, which is why the override writes both.)*

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
  scalable via F2.6).
- **F6.2** Curation agent parameters: mines a rolling **90-day** window; co-occurrence
  = items in the same bucket on the same day (or the same group); **core** = present in
  ≥ 70 % of the combo's occurrences, **variant** = 20–70 %; below that, omitted.
  Proposals persist in a store, dedup against existing templates *and previously
  dismissed proposals* (a dismissed proposal must not reappear), and surface in the
  template picker for approve/name/dismiss. Nothing is auto-created without approval.
- **F6.3** **Existing saved meals migrate** (one-time conversion to all-core
  templates); `SavedMealsSheet` retires and the template picker is the single surface.
  The saved-meals *endpoints* remain — they are load-bearing transport for
  copy-day-to-today.
- **F6.4** Add-combobox ranking with templates present: **favorites → templates →
  frequency-recency → other matches** (the shipped favorites-first contract holds;
  templates slot in behind it).

---

## Theme 7 — Data Visualization & Layout

### User stories

- **U7.1** As a user, the week rail shows something meaningful per day at a glance,
  and tapping a day opens it.
- **U7.2** As a user, I see my current weight, trend direction, and a mini trend chart
  on the main page without opening Progress.
- **U7.3** As a user, I can see exercise offset — intake vs. burn — for the day and
  over time.
- **U7.4** As a desktop user, the app doesn't stretch absurdly wide: the log column is
  capped, and on wide viewports a right sidebar appears with drill-down content.

### Functional requirements

- **F7.1** `WeekStrip` is replaced by per-day mini bars. **Honest encoding at ~44 px:**
  bar height = calories vs. budget with a single over/under hue; the three-segment
  macro breakdown appears in the tapped-day detail and wider layouts, not crammed into
  the strip cell. Today highlighted; days remain tap-to-navigate.
- **F7.2** **Batched range endpoint:** `GET /api/v1/health/budget/range?from=&to=`
  returning per-day kcal + macro sums — replacing the current 7 (WeekStrip) and 14
  (ProgressView) parallel per-day budget calls.
- **F7.3** Weight widget: current weight, trend delta (7/30-day slope), sparkline of
  raw weigh-ins with a smoothed trend line — sourced from the same weight store the
  Progress tab charts (one source; no lifelog/health divergence). Desktop: top of
  sidebar. Mobile: compact chip/row near the equation strip.
- **F7.4** Exercise offset: the day's burn credit is already in the equation strip;
  add an over-time intake-vs-burn chart (sidebar on desktop, Progress tab on mobile).
  Exercise credit stays single-sourced per BudgetService (activity-else-fitness — no
  double counting).
- **F7.5** Layout: main column max-width ≈ 720 px, centered. At ≥ ~1100 px a right
  sidebar mounts: weight + trend, macro detail, week/month charts, exercise offset.
  Below the breakpoint that content collapses into the main column / Progress tab.

---

## Theme 8 — Quick Add

### User stories

- **U8.1** As a user, tapping "add food" immediately shows a dropdown of my likely
  foods — no typing — ranked by a balance of frequency and recency.
- **U8.2** As a user, the suggestions are bucket-aware: the Breakfast row surfaces my
  breakfast regulars, Snacks my snack regulars.
- **U8.3** As a user, suggestions include both single items and whole meals/groups
  (templates, past groups), so "morning smoothie" is one tap, not five.

### Functional requirements

- **F8.1** On add-row focus (before any keystroke), the combobox shows a suggestion
  list ranked by a blended frequency + recency score computed **per meal bucket**, with
  a global ranking backfilling when bucket history is thin. Extends the existing
  catalog-suggest ranking rather than replacing it; typing filters as today; total
  order per F6.4.
- **F8.2** The list mixes item-level and meal-level suggestions: catalog foods and
  templates (Theme 6), visually distinguished (icon + item count for groups).
  Selecting a template suggestion instantiates it per F6.1.
- **F8.3** One tap from suggestion to logged entry (settled, since it's a deliberate
  pick of a known food; quantity defaults to the most recent quantity for that food in
  that bucket, editable after).

---

## Theme 9 — Loading Discipline & Local Caching

### User stories

- **U9.1** As a user, the fixed skeleton of Today — meal headings (Breakfast, Lunch,
  Dinner, Snacks), the Exercise section, the equation strip frame — never disappears
  into shimmer and reappears. Structure is permanent; only data fills in.
- **U9.2** As a user, revisiting or mutating the day doesn't flicker: I see the cached
  day instantly, and if the server returns something different it updates quietly in
  place.
- **U9.3** As a user, spinners/shimmer appear only for things genuinely in flight —
  an AI parse of a photo/voice capture, template curation, or other slow backend work —
  not for routine refetches.

### Functional requirements

- **F9.1** Static chrome (bucket headings, section frames, add rows) renders
  unconditionally; loading states apply only to data regions within them.
- **F9.2** Day data uses a stale-while-revalidate local cache (per user + date):
  render cached immediately, refetch in background, reconcile silently. Mutations apply
  optimistically; server response reconciles quietly (no full-view shimmer on
  mutation).
- **F9.3** Long-running operations (AI captures, agent work) get explicit in-place
  pending affordances (e.g. an unsettled placeholder row with progress cue) — the wait
  is shown where the result will land, not as a page-level loading state.

---

## Accessibility requirements (cross-cutting)

The program's stated theme is accessibility; these are requirements, not polish:

- **A1** The unsettled state is never signaled by color alone — pair the accent with a
  shape/badge and an `aria` state; contrast for muted styles comes from theme tokens.
- **A2** All new tap targets (per-row capture icons, quick-add rows, confirm buttons)
  are ≥ 44 px on touch.
- **A3** When a capture lands as an unsettled entry, the result is announced to screen
  readers (live region), not just painted.
- **A4** No sliders anywhere (repo convention); scaling and quantity edits use chips
  and steppers.

---

## Priorities & build order

All themes are approved as one program (single wave). Recommended build order, driven
by dependency, not preference — **all four steps delivered**:

| # | Themes | Phases | Status |
|---|---|---|---|
| 1 | **Foundation** — Theme 3 (lifecycle) + Theme 2 (groups) + Theme 9 (loading), starting with the schema whitelist threading (F2.2) everything else depends on | 0–3 | **delivered** |
| 2 | **Theme 1** — capture affordances: bucket plumbing + capture components on the new lifecycle | 4–5 | **delivered** |
| 3 | **Themes 4, 5, 7, 8** — macros/micros, icons, viz & layout, quick add | 6–9 | **delivered** |
| 4 | **Theme 6** — templates: mining, picker, saved-meal migration | 10 | **delivered** |

Step 3's caveat ("quick add's meal-level suggestions ship reduced until Theme 6 templates
exist") is closed: the suggest endpoint now merges templates per F6.4, and saved meals are
migrated rather than surfaced.

**Requirement coverage:** F1.1–F9.3 are all built. Where the shipped behaviour differs from
what this document assumed, the difference is recorded and reasoned in the decision log —
notably `rejected` remaining reachable as a scale-only status (§3), `NeedsReviewSection`
being kept for scale-origin rows rather than deleted (§2.1), and the macro bars shipping
without a goal tick (§2.13).

## Non-goals

- No change to meal buckets themselves (breakfast/lunch/dinner/snacks stand).
- No recursive group *editing* UI (model supports depth; UI stays one composite layer).
- No auto-created templates without user approval.
- No new AI/transcription pipelines — voice/photo/barcode parse wiring is reused
  (bucket parameter and photo persistence are additions to it, per F1.1/F2.5).
- **Single-user, explicitly.** Everything resolves to the default user; groups,
  photos, templates, goals, and relay attribution carry no user attribution this wave.
- Photo sharing/export; photos are household-private log artifacts.

## Decisions resolved (interview + adversarial review)

| Decision | Resolution |
|---|---|
| Group model | First-class entry; children via `parentId` in the flat store; NutriLog stays provenance |
| Group ≠ meal | Group is a dish/course composite inside a meal bucket |
| Nesting | Model unbounded via parent refs; UI/AI target one layer |
| Rollups | Computed on read, never stored |
| Photos | Attach to any entry; persisted files + serving endpoint (new infra); thumbnail on row; multi-food photo → group |
| Capture placement | Per-meal row icons **and** global one-tap (replaces footer icons) |
| Bucket conflict | Spoken/explicit meal > launch row > clock default, with "moved" cue |
| Review flow | Pending queue retired on **all transports**; immediate log as *unsettled* |
| Unsettled & budget | Unsettled **counts** in the equation; "pending doesn't count" and "coach never auto-accepts" consciously retired |
| Auto-settle | Read-time (3 days), no archive-mutating job; absent field = settled |
| Relay signals | Matcher **replaces** ScaleNutribotBridge, absorbing its behaviors; durable observation store; ratified at settlement, re-pairable |
| Macro storage | Scan-derived macros land on items' existing protein/carbs/fat fields |
| Macro surfacing | Bar row under equation strip + per-meal subtotals + watch micros with coverage indicator |
| Micros | Parse/catalog emit micros for new entries; coverage-gated display |
| Icons | Curated manifest unifies the two icon sets; AI-assigned; catalog gains icon field; override asks entry-vs-always |
| Templates | Agent-curated proposals (90 d, core ≥ 70 %) + manual save; saved meals **migrate** |
| Suggest order | Favorites → templates → frequency-recency → matches |
| Week rail | Per-day bars: height = kcal vs. budget, over/under hue; macro detail on tap |
| Budget fetches | New batched `GET /budget/range` endpoint |
| Desktop | ~720 px max column; ≥ ~1100 px right sidebar with drill-downs |
| Quick add | Zero-typing dropdown on focus; bucket-aware frequency+recency, global backfill; items + meals |
| Loading | Fixed chrome never shimmers; stale-while-revalidate day cache; pending cues only for genuinely slow work |
| Scope | Single-user this wave, written down |
