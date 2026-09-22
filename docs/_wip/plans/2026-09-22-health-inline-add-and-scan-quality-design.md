# Health Today — inline add row, two-meal layout, and scan data quality

Status: design, 2026-09-22. Source findings:
[`_wip/audits/2026-09-22-health-app-data-quality-audit.md`](../audits/2026-09-22-health-app-data-quality-audit.md).

Two parts. **A** changes how the Today log is laid out and how a food is added.
**B** stops bad barcode data from reaching the log, and repairs what already
got in. They share no code and can ship in either order.

---

## Part A — Add where you are looking

### Problem

Adding a typed food to a meal takes four steps: header `+` → a strip of buttons
(Type food / photo / Scan barcode / Meals & templates) → **Type food** → type
and Enter. The input exists (`AddCombobox`: shortlist of this meal's regulars,
type-ahead over the catalog, Enter on free text parses it with the AI). It is
just hidden behind two clicks.

The layout works against a two-meal day. `.health-log` is a two-column grid
that places *visible* sections in order, and a section is visible only when it
has rows (or is the clock's current meal, or is being added to). A day with
only lunch shows Lunch alone in the left column. Dinner is not on screen at
all; it lives in the `+ Breakfast  + Dinner  + Snacks` link strip under the
grid, which is also the wrong affordance: it adds a *meal*, not an item.

### Goals

1. Every meal on screen ends in an input. Clicking into it and typing is the
   whole interaction. Enter logs to *that* meal, on the day being viewed.
2. Lunch is always the left column and Dinner always the right, whether or not
   they have food yet.
3. Breakfast and Snacks appear only when they have something in them, and in
   the column where they fall in the day.

### Layout

Wide viewport (`$health-aside-breakpoint` and up): two column stacks instead
of one auto-placed grid.

```
┌ left ─────────────────────┐ ┌ right ────────────────────┐
│ BREAKFAST  (only if rows) │ │ DINNER    (always)        │
│   rows…                   │ │   rows…                   │
│   [ Add to Breakfast… ]   │ │   [ Add to Dinner…    ]   │
│ LUNCH      (always)       │ │ SNACKS    (only if rows)  │
│   rows…                   │ │   rows…                   │
│   [ Add to Lunch…     ]   │ │   [ Add to Snacks…    ]   │
└───────────────────────────┘ └───────────────────────────┘
EXERCISE (full width, unchanged)   UNGROUPED (unchanged)
```

Narrow viewport: one column, which reads Breakfast → Lunch → Dinner → Snacks
because the left stack comes first.

The "primary" meals are a named constant beside the bucket contract
(`PRIMARY_BUCKETS = ['afternoon', 'evening']` in
`shared/contracts/health/mealBuckets.mjs`). No settings UI; the constant can
become a display preference later if a second household member eats
differently.

Visibility rule, replacing `LogTable`'s `visible()`:

| Section | Shown when |
|---|---|
| Lunch, Dinner | always (every day, past and today) |
| Breakfast, Snacks | has rows, **or** a capture/clarification/voice hold is in flight for it, **or** it was explicitly chosen in the top bar |

The clock-based "anticipated" meal no longer forces a section open. The
two primaries are always there, and early or late food goes into Breakfast or
Snacks through the top bar (below) or the capture pipeline's own
clock rule. Once it has rows, its section shows up where it belongs.

The `health-log__empty-meals` link strip is deleted.

### The inline add row

`AddCombobox` gains an `inline` mode and is rendered as the last child of every
visible `Section`, replacing the header `+` and the button strip.

- **At rest:** a single-line input, placeholder `Add to Lunch…`, with three
  trailing icon buttons: camera (`PhotoCapture`, same bucket), barcode
  (`openBarcode(bucket)`), and meals/templates (`setTemplatesFor(bucket)`).
  No suggestion list, and no suggestion fetch at mount; two meals × 8
  shortlist icons on every page load is the request burst the shortlist limit
  exists to avoid.
- **On focus:** fetch this bucket's zero-keystroke shortlist and show it
  under the input (existing `OPEN_SUGGEST_LIMIT = 8` path).
- **Typing:** existing debounced catalog suggest; templates still hand off to
  the picker.
- **Enter:** highlighted suggestion → quick-add; no highlight → parse the
  sentence (existing `nutrition/input` path with `bucket` and `date`).
- **After a successful add:** clear the text, **keep focus**, reload the day.
  The next food can be typed immediately; logging a meal of four items is four
  lines of typing.
- **Escape:** first press clears the text; second press blurs.
- **Error:** text is preserved, message shown under the input (unchanged).
- **Busy:** input disabled with the spinner while parsing (unchanged). The
  in-section `CaptureProgress` row still marks where the AI result will land.

The header keeps the meal name, macros, kcal and the mic. The header `+` goes;
the add row is its replacement and sits where the new row will appear.

### The top quick bar

`QuickCaptureBar` stays: it is the only path to a meal that is not on screen
(Breakfast or Snacks on a day that has none). Its `+` becomes "reveal and focus
that meal's add row" instead of opening the button strip. Its photo, voice and
barcode buttons are unchanged.

### Removed

- `addingTo` / `typingIn` state and the `addSlot` button strip in `TodayView`.
- The header `+` (`health-meal__add`) and `onAdd` on `Section`.
- `.health-log__empty-meals` markup and CSS.

### Logging

Existing `add-combobox` events stay. New: `add-row.focus` (debug, `{bucket}`),
and `quickadd.done` / `sentence.committed` gain `{bucket, surface: 'inline'}` so
the log store shows whether the inline row is replacing the top bar in
practice.

### Tests

- `LogTable`: Lunch and Dinner render on an empty day; Breakfast/Snacks do not;
  a Breakfast row puts Breakfast in the left stack above Lunch, a Snacks row
  puts Snacks in the right stack below Dinner; no `+ Meal` strip.
- `AddCombobox` inline: no fetch before focus; focus fetches the shortlist;
  Enter with text posts `nutrition/input` with the section's bucket and viewed
  date; success clears text and keeps focus; Escape clears then blurs.
- `QuickCaptureBar` `+` on a hidden bucket shows that section and focuses its
  row.
- Existing `viewedDate.test.jsx` covers date routing but its 6 tests time out at
  HEAD today; fix that harness first so it can guard this change.

---

## Part B — Scan data quality

Numbers refer to the audit's findings.

### B1. Barcode intake guard (Magazine ×6, findings 3 and 8)

A single gate in the nutribot barcode path, before lookup, in the application
layer (`BarcodeScanService` / the nutribot route), not the relay:

1. **Shape.** Digits only after prefix stripping. Accept GTIN-8/12/13/14 with
   a valid check digit. A code that is an exact repetition of a valid code
   (`XX`, two reads without a terminator) collapses to one read. Anything else
   is rejected: `barcode.nutribot.rejected {code, reason: 'shape'}`.
2. **Books are not food.** 13-digit codes with a `978`/`979` prefix are ISBNs
   from the shared reader and are never looked up as food:
   `reason: 'isbn'`. (School's book scan keeps its own route; this only
   stops nutribot from consuming them.)
3. **Repeat suppression.** The same code from the same device within 30 s of
   an accepted scan is dropped: `barcode.nutribot.repeat {code, sinceMs}`.
   The Magazine burst spanned 15 s. A deliberate second item is a portion
   edit, not a second scan.

### B2. Quarantine instead of logging an empty food (findings 3, 6)

When a lookup returns a product with **no calories and no per-100 basis**
(Magazine, Winco Foods), the capture is written as a **pending** NutriLog
(`status: 'pending'`, `reason: 'no-nutrition'`), not a committed row. Budget
and macro sums already exclude `pending`, so the day's totals stay clean. It
appears in the existing Needs Review section as *"Scanned 037000338369 —
'Magazine', no nutrition found"* with **Describe** (opens that meal's add row
prefilled with the name) and **Discard**.

### B3. Nutrition that is known must stay known (finding 6)

In `normalizeProductNutrition`:

- If per-100 values exist and the serving is missing, fall back to the
  per-100 basis rather than nulls. Diet Coke becomes 0 kcal / 100 ml, which is
  known.
- If the serving *text* exists without grams ("2 tbsp"), ask the classifier
  that already runs for a gram estimate of that serving, stamp provenance
  `ai`, and scale from per-100 g. The row stays unconfirmed, so the review
  deadline still applies.

### B4. Grams from the label, not OFF's unit guess (finding 5)

`serving_quantity_unit` says `ml` for "1/4 cup (28 g)". Parse
`serving_size` for an explicit gram figure (`/\((\d+(?:\.\d+)?)\s*g\)/`, also
bare `28g`) and prefer it. Only when no gram figure exists does `ml` stand.
True liquids keep `grams: null` and a blank density badge; guessing 1 g/ml
would break the ledger's "volumes are never grams" rule.

### B5. Icons (findings 1, 2)

- `UPCGateway` stops stamping `icon: '🍽️'` (and `NutritionixAdapter` its
  emoji fallback). `LogFoodFromUPC` takes `product.icon` only if it is a
  manifest slug; otherwise the classifier's answer wins.
- `FoodCatalogService.resolveIdentity` runs the catalog's icon through
  `confineIcon` like every other path, so a legacy slug cannot ride onto a new
  row.
- **Legacy vocabulary.** The 83 retired slugs (186 catalog entries, 32 hot
  rows) get manifest **aliases** where a real icon exists (`pitasandwich →
  pita-bread`, `ranch_dressing → …`). The mapping is written out as a
  reviewed table in the plan rather than guessed in code. Slugs with no
  honest match (plain `cheese`, `feta`) are the manifest's real gaps. They get
  new icons, added through the same asset process the existing set used. Until
  then they stay `default` and `artwork.icon-failed` / `day.quality` name
  them.
- A one-time backfill rewrites catalog `icon` fields to canonical slugs (dry
  run first, diff reviewed). Hot rows are snapshots and pick up the fix through
  the alias at render time, so no ledger rewrite is needed for icons.

### B6. Placeholder product photos (finding 4)

`UPCGateway.fetchImage` refuses a known-placeholder image by SHA-256 (the
barcodespider "image coming soon" JPEG is one fixed file, 4,944 bytes). The
hash list lives next to `BARCODE_IMAGE_FALLBACK`, and each refusal logs
`upc.image.placeholder`. Repair: clear `photoRef` on existing rows whose photo
matches, so their icon shows.

### B7. Product names (finding 7)

`normalizeProductName` in `shared/contracts/health/` applied once at UPC
ingest (gateway output), before catalog and ledger:

- A name, or a run of words inside it, that is ALL CAPS and ≥ 4 letters
  becomes title case: `OIKOS PRO PLAIN → Oikos Pro Plain`,
  `Galbani STRING CHEESE → Galbani String Cheese`.
- Words of ≤ 3 letters in an all-caps run stay upper case only if on a short
  acronym list (`BBQ`, `BLT`, `USA`, `XL`); small words (`and`, `of`, `with`)
  lower-case except first.
- Mixed-case words are left alone (`McCormick`, `iSi`).
- Adjacent duplicate words collapse (`Sharp Cheddar Cheddar Cheese`).

Backfill: catalog names, and hot rows whose `manualFields` does not include
`name` (a hand-typed name is never rewritten).

### B8. Repairs to existing data

Run through the ledger's command path (journaled, versioned), never by
editing YAML:

- Delete the six 2026-09-21 Magazine rows and the duplicate Strawberry
  Milkshake rows on 09-18 and 09-19 (tombstoned, restorable).
- Re-normalize the ml-labelled solids from B4 (OIKOS, cheese blend, kidney
  beans, Spring Mix) to grams where the label gives them.
- Clear placeholder `photoRef`s (B6); rename all-caps rows (B7).
- Move the abandoned `food_catalog.yml.tmp-…` to `_backups/`.

Each repair script prints its change set and needs `--apply`.

### Tests for Part B

Unit tests per gate: GTIN check digit, doubled-code collapse, ISBN refusal,
30 s repeat window per device; per-100 fallback and "(28 g)" parsing against
the real OFF payloads captured in the audit; `normalizeProductName` table;
placeholder hash refusal; `resolveIdentity` confining a legacy slug. One use-case
test: a no-nutrition product lands pending and outside the budget.

---

## Out of scope

- Configurable primary meals (constant for now).
- Assumed density for liquids.
- The `%s` URL template on the scanner shortcut. `direct.upc.prefixStripped`
  already handles it, and the sender is outside this repo.
