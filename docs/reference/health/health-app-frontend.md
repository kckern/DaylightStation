# Health App Frontend

## Purpose

The health app is the visual surface a household member uses to take stock of their day and explore their history. It answers two questions in one place: *where do I stand right now?* and *how is the longer story going?* The first answer lives on a single screen of summary cards a user reads in seconds. The second lives one tap away — a chart-and-history detail view per dimension. A meal can be logged from the same screen that shows today's calorie standing, and the longest interaction — review and accept an AI-parsed meal — takes a single tap from any card.

For shared concepts referenced throughout this document — daily summary, longitudinal aggregate, identity model, household, food catalog, source freshness, status block — see `health-system-architecture.md`. For how those numbers are produced, see `data-pipeline.md`. For how coaching messages are composed and delivered, see `coaching-system.md`. This document describes what the user sees and does.

---

## Layout

The app has two views and one transition between them.

The default view is a **hub** — a grid of summary cards covering today's weight, nutrition, sessions, source freshness, and goal progress. Each card shows a number, a trend, a badge, and a one-line summary (see *Hub cards* below for the shared shape). The cards stack into a single column on a narrow viewport and break into a multi-column grid on a wider one.

Tapping a card opens a **detail view** for that dimension. The detail view replaces the hub in place — there is no modal, no overlay. A back affordance at the top of the detail returns the user to the hub.

The hub fetches a single composed dashboard document on open and passes the relevant slices into each card. The detail views read the same document, so a single open-the-app load covers both the at-a-glance numbers and any drill-down a user explores from there.

---

## Hub cards

Each hub card has a consistent shape: a small header (icon + title), a primary value, supporting context, and an affordance that signals tap-to-drill. Cards that are read-only do not show a tap affordance.

### Weight

The weight card answers "what did I weigh today?" with a single large number in pounds, plus a trend arrow showing the smoothed multi-day direction (down, up, flat) and the recent rate of change per day. A short recency line — "Today," "1d ago," "2d ago" — tells the user how fresh the reading is. If a user has never weighed in, the card reports the absence rather than rendering a zero.

### Nutrition

The nutrition card carries the day's calorie total as the headline number, with macro badges underneath for protein, carbs, and fat in whole grams. The card is also the entry point for inline food logging: a text field and a row of quick-add chips sit below the summary, ready to capture a new meal without leaving the hub. The summary area is tappable for the drill-down; the input area swallows taps so typing into the field does not navigate away.

### Sessions

The sessions card reports today's count of completed fitness sessions, the total coins earned (a household incentive metric carried by each session), and a one-line label for the most recent session — typically a show or workout title. A user with no sessions today sees a zero rather than an absence; the day is still in progress, and the user reads a true zero instead of an empty state.

### Recency

The recency card answers a single question: which sources are still reporting on schedule, and which have gone quiet. It lists each tracked source — weight, food, fitness, activity tracker, sleep where supported — with a colored dot (green / yellow / red) indicating freshness, the source's display name, and a relative timestamp ("Today," "2d," "5d"). The card is read-only and does not drill in: a user spotting a red dot for the smart scale knows to step on it, not to navigate further.

### Goals

The goals card surfaces the user's active life-plan goals filtered to those with a health-relevant metric — a target weight, a weekly session count, a calorie band, a protein floor. Each goal renders as a name, a current-vs-target readout, and a horizontal progress bar that fills toward the target. The bar turns green when the goal is met for the current period. Tapping the card opens the goals detail.

---

## Detail views

Every detail view shares the same shell: a back affordance at the top, an optional history chart, and dimension-specific content below. An error in any sub-section is caught in place so a single broken slice does not blank the entire view.

### Weight detail

The weight detail opens with the multi-axis chart. Below the chart, a list of recent readings shows date, pounds, and the per-day trend delta. Negative deltas render in green, positive in red, flat in dimmed text. The list is tuned for the last two weeks of weigh-ins; older readings are explored by changing the chart's time range.

### Nutrition detail

The nutrition detail opens with the chart and adds two sections. The first is a search box over the food catalog: typing a partial name returns matching catalog entries, ordered by frequency, each showing the entry's calorie count and lifetime use count. The second is a list of recent days with their daily calorie totals, providing day-by-day context that complements the chart.

### Sessions detail

The sessions detail opens with the chart and lists today's completed sessions — title, optional show context, duration in minutes, and coins earned — followed by a recent-activity list summarizing how many workouts each recent day held.

### Goals detail

The goals detail does not show the chart. It expands every goal into a full card showing the goal name, its lifecycle state (declared, committed, archived), the metric name, the current-vs-target readout, the progress bar, and the deadline if one is set. Goal editing routes through the life plan rather than living locally on the health detail.

---

## Inline interactions

The hub is read-write for new entries, read-only for history. Quick edits happen where the user already is.

**Food logging from the nutrition card.** A user types a meal in plain language ("two scrambled eggs and a slice of toast") and presses enter. The input transitions to a parsing state — the calorie summary is replaced by a skeleton and an "Analyzing…" label — while the LLM food parser turns the text into structured items. The card then enters a review state: the parsed items are listed and the user accepts or discards. Accept finalizes the entries and returns the card to the idle state with the day's totals refreshed. Discard rolls back without keeping any item. The full sequence happens in place; the card never collapses, never opens a modal, never redirects the user away from the hub.

**Quick-add chips.** Below the input field, a row of chips presents the user's most-frequent and most-recent food catalog entries. Tapping a chip logs the entry directly without an LLM parse, increments the catalog's use count for that entry, and refreshes the day's totals. This is the fastest path for items the user logs over and over: yogurt, oatmeal, the household's standing dinner.

**Weight entry.** Manual weight entry — used when an integration is unavailable or a user wants to record a number the scale missed — is offered from the weight detail. The entry is a number, a date (defaulting to today), and an optional note. On save the day's summary is recomputed and the hub re-reads.

**Goal edits.** Goals are owned by the life plan; the health hub is a read-only consumer. The goals detail provides a link out to the life plan editor for changes. Progress is reflected back automatically as goal metrics update.

**Inline interactions write back through the same input layer the rest of the system uses** — a meal logged from the hub lands in the same food log a meal logged from the messaging surface lands in, and the data pipeline folds it into the day's summary identically.

---

## States

Every card and every detail view defines its behavior in five states. Treating them explicitly is what keeps the app legible when data is sparse, late, or missing.

**Empty.** A user with no data ever for a dimension sees a short, dimmed line ("No weight data," "No active goals") in place of the value. The card stays the same shape so the grid does not reflow when data appears. Empty is informational, not an error.

**Loading.** On first open, the app shows skeleton blocks the size of the content that is being loaded — not a full-screen spinner. The user sees the layout taking shape rather than a blank wait. Subsequent refreshes (after a food log, after a back navigation) update in place without skeletons; the previous values stay on screen until the new ones arrive.

**Error.** A failed API call does not blank the affected card or view. The card falls back to its empty state and the error is logged through the structured logger. A detail view's error is caught at the boundary and rendered as a small inline message inside the otherwise-functional shell, so the back affordance remains usable.

**Fresh.** A daily summary read within the user's active day is fresh: the numbers are today's, the recency dots are green, the trend is computed from a recent series. The hub presents fresh data without qualification.

**Stale.** A daily summary that is more than a day old, or one whose underlying sources have not reported recently, is stale. Stale state surfaces in two places: the recency card carries yellow or red dots for sources past their expected cadence, and the trend value on the weight card is suppressed when the most recent reading is too far back to anchor a trend. The hub does not refuse to render stale data — it shows what it has and lets the recency card speak to the gaps.

---

## Charts

The detail views share one chart component. Its job is to put weight, calories, and workout volume on a single shared time axis so a user can read the three dimensions against each other in one glance.

The chart binds three series to a single x-axis (time):

- **Weight** as a smooth line on the left axis, in pounds.
- **Calories** as a dashed line on the right axis, in whole calories per day.
- **Workout minutes** as columns on a second right axis, in minutes per day.

A user can switch between 90 days, 6 months, and 2 years of history. The time-range controls sit above the chart; tapping a range adjusts the visible window without a network round-trip — the dashboard already carries the tiered history series (90 days at daily grain, 6 months at daily-plus-weekly grain, 2 years at full daily-weekly-monthly grain), so switching only rebuilds the chart's series from the cached data. Bar widths scale with range so a two-year view does not blur into a solid block.

Sparklines do not appear on the hub cards as a separate element; the cards trade chart space for headline legibility, and the user is one tap from the full chart in the detail view.

The chart's color palette and tooltip styling sit on the dark theme the rest of the app uses. Hovering or tapping a point shows a shared tooltip with the date and each series' value for that point.

---

## Navigation

The health app has two entry points: a direct route (`/health`) and a tile in the broader life view that lands the user on the same hub. The hub is the only top-level view; detail views are accessible from the hub by tapping a card and from the back affordance by stepping out.

The Telegram nutrition surface (Nutribot) is where richer logging happens — photo-based meal capture, multi-turn parse confirmation, search through the user's full food log, longer chat with the on-demand health coach. Nutribot is also where the daily, morning, and weekly coaching messages described in [`coaching-system.md`](coaching-system.md) land. The hub and the bot operate on the same data: both surfaces write into the same food log and read from the same daily summary, and the bot's coaching deliveries are surfaced back on the hub through the in-app coach panel. The bot is the surface for richer logging and for proactive coaching delivery; the hub is the surface for at-a-glance review and fast inline entry.

Return paths from a detail view are simple: the back affordance returns to the hub, and the back navigation does not refetch. A user can open a detail, scroll through history, return to the hub, and the hub still shows the values it loaded on first open. Refreshing the data — after a food log, on user request — is an explicit action.

---

## Accessibility and input modes

The household runs on multiple input devices: touchscreens on tablets and kitchen panels, keyboards on dev workstations, and a gamepad in the family room. The health app is operable from all three.

**Touch.** Every tappable region — card surface, chip, button — is sized so a thumb-press anywhere on its visible bounds activates it. Cards have no internal touch targets smaller than the card itself, so a partial-area miss does not exist: tapping any pixel of a hub card opens its detail. The nutrition card is the one exception, by design — its input field and quick-add chips are nested tap targets that swallow taps so typing does not navigate away. Long-press and gesture-based interactions are not used.

**Keyboard.** Every interactive element is reachable by tab. Arrow keys move within grids of cards and chips; enter activates the focused element; the back affordance on a detail view responds to enter. The food input takes typed text directly and submits on enter. Focus visibility is preserved on every interactive element so a keyboard user can always tell where they are.

**Gamepad.** A connected gamepad is read through the standard browser API, with the D-pad mapped to focus movement (left/right/up/down across cards, chips, and detail elements), a primary button mapped to activation (open the focused card, log the focused chip, accept the parsed review), a secondary button mapped to dismiss/back (return from a detail view, discard a parse review), and a tertiary button mapped to refresh. The mapping is consistent with the app's broader gamepad conventions so a user moving between health, fitness, and media does not relearn the controls.

The app does not require a pointing device for any operation. A user with a keyboard or a gamepad alone can browse the hub, drill into any detail, log a meal, and return to the hub.

---

## Where it lives

### Frontend

- `frontend/src/Apps/` — top-level health app entry, route binding, page-level styles.
- `frontend/src/modules/Health/` — hub view and detail view shells.
- `frontend/src/modules/Health/cards/` — hub summary cards (weight, nutrition, sessions, recency, goals).
- `frontend/src/modules/Health/detail/` — detail views (weight, nutrition, sessions, goals) and the shared multi-axis history chart.
- `frontend/src/modules/Fitness/widgets/_shared/` — shared dashboard card chrome originally written for the fitness app and reused here, so the two apps render visually consistent cards.
- `frontend/src/modules/Health/HealthCoach/` — coach panel rendering on-demand commentary inside the health surface (see `coaching-system.md`).
- `frontend/src/hooks/` — supporting hooks for document title, viewport probing, and gamepad/keyboard navigation.
- `frontend/src/lib/api.mjs` — shared API client used by every health surface call.
- `frontend/src/lib/logging/` — structured logger used by every interactive element on the hub and detail views.

### API consumed

- `/api/v1/health/dashboard` — single composed document the hub and detail views read on open.
- `/api/v1/health/nutrition/input` — text-to-structured food parse for inline logging.
- `/api/v1/health/nutrition/callback` — accept-parse confirmation for the review state.
- `/api/v1/health/nutrition/catalog` and `/api/v1/health/nutrition/catalog/recent` — catalog search and quick-add chip source.
- `/api/v1/health/nutrition/catalog/quickadd` — one-tap log from a catalog entry.
- `/api/v1/health/coaching/*` — coaching history for the in-app coach panel.

### Assets and styles

- `frontend/src/Apps/HealthApp.scss` — page-level layout, hub grid, detail shell.
- `frontend/src/modules/Health/Nutrition.scss` and `Weight.scss` — nutrition and weight surface styling shared with related modules.
