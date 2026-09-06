# Health day-log: row rhythm, macro axis, caloric density, and food artwork

**Date:** 2026-09-06
**Surface:** `/health` → Today (`frontend/src/modules/Health/today/`)
**Baseline:** deployed `main` (the homeserver tree; this laptop's `main` was 19 commits
behind and was merged before this audit — the newest health commit in scope is
`feat(health): streamline food rows and enrich exercise entries`).
**Status:** audit only. No code changed.

---

## 1. Scope

Eleven problem statements, restated from a review of the Today view. Then what the
code actually does today, with the file and line evidence for each, then the design
decisions that have to be made before any of it can be built — chiefly the one about
caloric density, which is the only item here that is not a layout or a pipeline fix.

Verified against: the merged source tree, the installed icon manifest (534 offered
slugs), and one real logged day's stored rows (9 rows across two meals, one of them
a 5-child group).

---

## 2. Problem statements

Restated in my own words. Grouped by what they actually are, not by the order raised.

### Layout and rhythm

**P1 — Rows are still too far apart.**
Collapsing each entry from two lines to one was the right move and it landed. The
remaining complaint is the vertical pitch between adjacent rows: at desktop the log
reads as a sparse list when it should read as a dense table. Tighten the gap without
losing the phone/tablet tap targets.

**P2 — The group affordance is undersized and under-indented.**
For a dish with components (a burrito with tortilla/eggs/ham/veg/cheese), three things
are too small: the expand/collapse triangle, the horizontal indentation of the child
rows, and the visual weight of the tree. The tree's vertical trunk should run *through
the parent dish's own artwork*, with each child hanging off it — right now the trunk is
drawn in a narrow gutter to the left of everything and the children are not indented at
all relative to the parent.

**P3 — Child rows should read as subordinate, not just as tagged.**
One font step smaller than a top-level row, tighter grouping of their macro chips, and
circles rather than rounded squares for the chips — so a glance separates the roll-up
from its parts without reading the tree.

**P4 — The P/C/F chips must share one vertical axis, everywhere.**
Protein, carbs and fat should stack in the same three columns whether the row is a
top-level item, a group header, an indented child, a meal roll-up, or the day total.
Today the item rows agree with each other and nothing else agrees with them.

**P5 — The day-level summary should use the same design system as the rows.**
The macro/grams/calories grammar that the log rows use should also express the day.
The current macro line sits under the calorie equation in a third visual vocabulary
(coloured legend dots), and it is in the wrong place. The whole day header — budget
equation plus macros, plus a legend if the colours need one — wants a redesign, not a
patch.

**P6 — The day header must hold still.**
Dragging a row's grams recomputes the day's budget live, and the header's numbers
change width as they change value, so the equation slides and the page rug-pulls
mid-gesture. Every term needs a reserved slot — including padding around the
`−`, `+` and `=` operators — so the block's width is invariant across the whole
plausible range of values.

### Direct manipulation

**P7 — Extend hover-and-drag to macros and calories.**
The drag-a-number-left-or-right gesture on grams works well. The same gesture should
work on each macro chip and on the calorie figure.

**P8 — Introduce caloric density as a first-class, draggable value.**
kcal per gram (or per 100 g — whichever reads better) should be a value you can grab
and push. The use case: a photo capture of a burrito estimates a calorie figure that
is wrong in a way *grams cannot express* — same mass, more oil. Today the only handle
is portion, and portion cannot say "this one was richer."

**P9 — When density moves, the macros must move with it, at different rates.**
Turning density down usually means less oil, so fat should fall faster than carbs and
protein. Turning it up, the reverse. This is the hard one and it is called out as
possibly beyond the current data layer.

### Food artwork

**P10 — Icons are defaulting to the generic glyph.**
Rows that should have artwork are showing the neutral bowl. There was supposed to be
a workflow that picks an icon; it is not producing one for common foods.

**P11 — A real picture should outrank an icon.**
Precedence should be: (1) an actual photograph — the user's capture *or* the product
image a barcode scan retrieves; (2) an AI-chosen icon from our manifest; (3) the
neutral SVG fallback. Barcode scans currently do not contribute a picture at all.

---

## 3. What the code does today

### 3.1 Row rhythm is floored in five places (P1)

`frontend/src/modules/Health/health.scss`:

| Selector | Floor |
|---|---|
| `.health-row-line` | `min-height: 48px` |
| `.health-row__identity` | `min-height: 44px` |
| `.health-portion` | `min-height: 44px` |
| `.health-row__confirm` | `min-height: 44px` |
| `.health-row__expand` | `min-height: 44px` |

Trimming the line alone changes nothing — four children hold it open. The 44px figure
is the household touch-target rule, and one instance is pinned by a contract test:
`frontend/src/modules/Health/today/layout.contract.test.js:47` asserts
`.health-row__identity` matches `min-height: 44px`.

So this is not a one-line CSS edit. It is a decision about whether the log gets a
pointer-conditional density. Recommended shape: keep the 44px floors under
`@media (pointer: coarse)` (and the existing mobile breakpoint block) and drop the
desktop floors to ~32px via a `--health-row-min` custom property set once. The
contract test then asserts the floor inside the coarse branch instead of
unconditionally — the test stays, its scope changes.

Also worth noting for the same pass: `.health-log { gap: 0.5rem 1rem }` is the gap
*between meal sections*, and `.health-meal { margin-top: 0.4rem }` adds to it. Neither
is the row gap; both will look wrong once the rows tighten.

### 3.2 Children are not indented at all (P2)

`.health-row-line` uses one grid template for every row — parent, child, group header:

```scss
grid-template-columns: 20px minmax(0, 1fr) auto 4.5rem 3.8rem 44px;  // 12px … on mobile
```

Column 1 is the branch gutter. It is `20px` for a child exactly as it is for a
top-level row, so a child's name, artwork and chips all start at the same x as its
parent's. The only differentiator is a hairline drawn inside that gutter:

```scss
.health-row-line--child .health-row__branch {
  &::before { left: 10px; top: 0; bottom: 0; border-left: 1px solid var(--ds-border); }
  &::after  { left: 10px; right: 0; top: 24px; border-top: 1px solid var(--ds-border); }
}
```

The trunk therefore sits ~10px from the row's left edge. The parent's artwork sits in
column 2, inside `.health-row__identity` (`gap: 0.4rem`, icon `24px`) — its centre is
roughly `20px + 3.2px + 12px ≈ 35px` from the same edge. The trunk and the artwork are
~25px apart and neither knows about the other.

The triangle is `.health-row__expand`, a 44×44 button whose glyph is `font-size: 0.85rem`,
absolutely positioned at `inset: 0 auto auto -12px` — hanging outside the gutter.

What P2 asks for is a different geometry: **one shared custom property** for the tree
axis (say `--health-tree-x`), used by both the parent icon's column offset and the
child's `::before`, so the trunk cannot drift from the artwork it descends from; a wider
child first column (`--health-tree-indent`, ~36px desktop) so children genuinely step
right; and a larger glyph for the triangle. Deriving both from one property is the point
— two hand-tuned numbers is how this drifts again.

### 3.3 The macro axis agrees in exactly one place (P4)

- **Item, group and child rows** all render through `EntryRow` into `.health-row-line`'s
  fixed columns, so their chips align with each other. This part works.
- **Meal headers** do not. `LogTable.jsx`'s `Section` puts `<MacroBadges className="health-meal__macros">`
  inside a flex header, and `.health-meal__macros { margin-left: auto }` right-aligns the
  trio next to the kcal + actions cluster. Its x position is a function of how wide
  "871 kcal" happens to be. It cannot line up with the rows below it.
- **The day** uses a third vocabulary entirely — see 3.4.

Fix direction: promote the row template to a shared track list (a custom property, or
CSS subgrid where the nesting allows) and have the meal header and the day summary
adopt the same tracks. Then macros, portion and calories share one axis from the day
header down to the deepest child, which is exactly what P4 asks for.

### 3.4 The day has two macro presentations, and neither matches the rows (P5)

`MacroBarRow.jsx` renders one of two things per macro:

- a **progress bar** when `goals.macroGoals[proteinG|carbsG|fatG] > 0`;
- otherwise it falls into `withoutTargets` and renders `intake` — a `.health-macro-intake`
  line of `.health-macro-legend` coloured dots reading `Protein 65+ g`.

This household has no macro goals set, so all three fall to the legend line. That line
is what appears under the equation strip in the reviewed screenshot. So the day-level
macro display today is (a) a fallback, (b) in a visual language used nowhere else, and
(c) positioned under the equation.

One thing must survive the redesign: the `+` suffix and the "partial — some food has
unknown macros" caption. `nutrientSummary` (`shared/contracts/nutrition/countedRows.mjs`)
distinguishes a known zero from a missing value, and `MacroBarRow`'s docblock argues at
length why suppressing the coverage caption to tidy the layout would turn "we have no
idea" into "you had almost none". Keep that rule; change its clothes.

### 3.5 The equation strip has no reserved widths (P6)

`EquationStrip.jsx` emits `Budget 1,788 − Food 1,541 + Exercise 347 = 594 kcal UNDER`
as bare flex children:

```scss
.health-equation { display: flex; justify-content: space-between; }
.health-equation__math { display: flex; gap: 0.35rem; flex-wrap: wrap; font-variant-numeric: tabular-nums; }
```

`tabular-nums` equalises digit *widths*, not digit *counts*. Three things change the
block's total width as you drag: a term crossing a thousands boundary; `Math.abs(budget.remaining)`
gaining or losing a digit; and `budget.status` switching between `under` and `over`.
Because the block is the right-hand item of a `space-between` flex row, all of that
motion is expressed as the block sliding left and right.

And it moves on *every pointer move*: `usePortionDraft` → `projectPortion`
(`today/portionPreview.js`) recomputes `budget.food`, `budget.remaining` and
`budget.status` from the draft on each `preview()` call. Live feedback is the point of
the gesture, so the fix is width reservation, not throttling: `min-width` in `ch` per
term, operators in fixed cells, and a status slot sized to the longer of `UNDER`/`OVER`.

### 3.6 Direct manipulation exists for exactly one field (P7)

`PortionControl.jsx` implements the pointer-drag (`~2px` per unit, shift for fine
control), a keyboard path, and a click-to-type popover. `usePortionDraft.js` owns the
draft, the optimistic overlay, the version-conflict rebase and the commit.

Two structural facts constrain P7/P8:

1. **One draft at a time, and it is portion-shaped.** `control.begin(row)` returns
   `false` if any draft is open, and the draft carries `{ row, portion: {value, unit} }`.
   `projectPortion` is hard-wired to `portionFactor` + `scaleFoodPortion`. Adding
   handles for calories, three macros and density means the draft has to carry a
   *patch* — a set of field changes — and `projectPortion` has to apply that patch.
   That refactor is the bulk of the frontend work, and it should land before any new
   handle does.

2. **The gesture is coupled to the day header.** Same file. Any new handle inherits the
   P6 jitter for free, so P6 should land first or alongside.

### 3.7 The write path already accepts what P7/P8/P9 need (good news)

`backend/src/3_applications/health/HealthOperations.mjs#updateNutritionItem`:

- accepts `portion` or `factor` → proportional scale through `scaleFoodPortion`;
- accepts `grams` directly → same extensive arithmetic, derived as `grams / foodGrams(existing)`;
- accepts explicit `calories`/`protein`/`carbs`/`fat`/micros, and when a factor is also
  present the **explicit values win** (`Object.assign(allowedChanges, scaleFoodPortion(...), <explicit nutrients>)`).
  So "rescale, then override these three" is already one atomic request;
- accepts `correctedNutrients: ['calories','protein','carbs','fat']` → stamps
  `nutrientProvenance[key] = { source: 'user', grams, at }` and adds the keys to
  `manualFields`, which protects them from later catalog/AI enrichment. **Caveat:** the
  loop `continue`s on any key not present in `allowedChanges`, so the explicit values
  must travel in the same PUT as the `correctedNutrients` list;
- does **not** ratify. Only `settled: true` confirms a row, so a density edit correctly
  leaves the Unconfirmed badge alone.

So no new endpoint is needed for P7. The API surface is sufficient today.

### 3.8 Density: the model already exists, in the wrong room (P8, P9)

This is the answer to "I don't know if we have that kind of data layer." We do.

`backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs` defines
`DEFAULT_DENSITY_LEVELS` — a nine-rung ladder mapping kcal/g to a macro **energy split**,
overridable per household via `nutribot.density_levels` in config:

| Level | kcal/g | fat % | carb % | protein % |
|---:|---:|---:|---:|---:|
| 1 Watery | 0.2 | 10 | 60 | 30 |
| 2 Light | 0.6 | 15 | 70 | 15 |
| 3 Lean | 1.0 | 20 | 45 | 35 |
| 4 Mixed | 1.4 | 25 | 50 | 25 |
| 5 Hearty | 1.9 | 30 | 50 | 20 |
| 6 Heavy | 2.6 | 40 | 45 | 15 |
| 7 Rich | 3.8 | 65 | 15 | 20 |
| 8 Thick | 6.0 | 75 | 15 | 10 |
| 9 Oil | 8.5 | 100 | 0 | 0 |

Read down the fat column: 10 → 100 across the range, monotonic, while carbs go 60 → 0
non-monotonically and protein 30 → 0. **Fat is already the elastic macro in this table.**
P9's "the fat macro should probably go down with it, at a different rate than the other
macros" is not a new model to invent — it is this table, differentiated.

`backend/src/2_domains/nutrition/services/ScanNutritionService.mjs#computeNutrition`
turns a level plus a mass into nutrients:

```js
calories   = round(netGrams * kcal_per_g)
fat_g      = calories * fat_pct     / 100 / 9
carb_g     = calories * carb_pct    / 100 / 4
protein_g  = calories * protein_pct / 100 / 4
```

And `backend/src/2_domains/health/services/catalogDensity.mjs` independently argues that
density is the right invariant to reason about: measured over ~4,650 logged rows in this
household, the within-name coefficient of variation is **0.36 for calories and 0.07 for
density**. Calories move because portions move; kcal/g is what a food *is*.

**Two things stand between that and a draggable density control:**

1. **It is only reachable from the kitchen-scale path.** The ladder is normalized inside
   the nutribot container and consumed by `SelectScaleDensity`, `ApplyScanToComposition`
   and `ObservationPairingService`. There is no `/api/v1/health/...` route that serves it,
   and nothing in `frontend/src/modules/Health/` knows the word density.

2. **The frontend's quantity model is purely extensive.**
   `shared/contracts/health/foodQuantity.mjs` gives us `foodPortion` → `{value, unit}` and
   `scaleFoodPortion(row, factor)` → every nutrient × factor. Density is invariant under
   every operation that file can express. It has no intensive vocabulary at all.

---

## 4. The coupling problem, and a proposal

A row carries mass `m` and nutrients `{kcal, P, C, F, …}`. Two derived quantities matter:

- density `d = kcal / m`
- macro energy shares `f = 9F/kcal`, `c = 4C/kcal`, `p = 4P/kcal`

The user wants four handles: grams, calories, each macro, and density. Those four are
**not independent** — you cannot move one without declaring what stays fixed. Every
handle therefore needs a stated invariant. Proposal:

| Handle | Held fixed | Effect |
|---|---|---|
| **Grams** (today) | `d`, all shares | Everything × (m′/m). Unchanged behaviour — keep it. |
| **Density** | `m` | `kcal = m·d′`; shares shift along the ladder; macro grams re-derived by Atwater. |
| **Calories** | `m` | The same command as density with a different unit on the handle. |
| **One macro** | `m`, the other two macros' grams | `kcal` recomputed by Atwater; `d` follows. |

Making the calorie handle and the density handle the *same command* is worth insisting
on — one code path, no possibility of the two disagreeing, and it answers "calories per
gram or per milligram" by making the unit a display choice rather than a model choice.
Recommendation: show **kcal/g** with one decimal (the ladder's own unit; 0.2–8.5 is a
comfortable drag range).

### 4.1 How the shares should move (the P9 core)

Do **not** snap a row's shares to the ladder's shares at the new density. A grilled
chicken breast at 1.6 kcal/g is not level-5 pasta, and replacing its 35%-protein split
with the ladder's 20% would destroy real information the capture got right.

Instead, move **along** the ladder by the delta:

```
shares′ = normalize( clamp( shares + ( ladder(d′) − ladder(d) ) ) )
```

where `ladder(d)` linearly interpolates `fat_pct/carb_pct/protein_pct` between the two
rungs bracketing `d`. The row keeps its own character; the *change* is the ladder's
shape. Push density up and fat takes most of the increase because that is what the
household's own table says happens between rungs. That is P9, implemented, from data
already in the repo.

Then `F′ = kcal′·f′/9`, `C′ = kcal′·c′/4`, `P′ = kcal′·p′/4`.

### 4.2 The Atwater residual

Stored `kcal` is not equal to `4P + 4C + 9F` for real rows — label rounding, fiber,
sugar alcohols. On the reviewed day one child row is 3.5% off, another 0.4%. If a macro
drag recomputes calories as raw Atwater, the calorie figure will jump by several kcal on
the very first pixel of the gesture, before the user has meaningfully moved anything.

Carry the residual explicitly: `r = kcal − (4P + 4C + 9F)`, hold it constant under a
macro drag, scale it with `kcal` under a density drag. First pixel then moves the number
by the amount the user asked for and nothing else.

### 4.3 Where the math must live

In `shared/contracts/health/foodQuantity.mjs`, next to `portionFactor` and
`scaleFoodPortion`. That file is imported by both the client preview
(`today/portionPreview.js`) and the server (`HealthOperations`), which is the reason the
optimistic overlay and the committed row agree to the digit today. A density transform
that lives on only one side reintroduces exactly the drift that file exists to prevent.

The ladder itself is config, so it needs a read path the health API can serve. Smallest
version: expose the normalized `densityLevels` on the existing health context/config
response rather than inventing a route.

### 4.4 Edge cases that must be decided, not discovered

- **Rows with no mass.** One row on the reviewed day is `unit: 'ml'`, `grams: null`,
  `amount: 170`. `foodPortion` falls back to `{170, 'ml'}`. kcal/ml is a coherent
  density but it is not the ladder's unit. Recommendation: offer the ladder-driven
  redistribution only when `foodPortion().unit === 'g'`; for ml rows offer the calorie
  handle with macro *shares held constant* (a pure calorie scale) and say so in the
  control's title text.
- **Groups.** `foodPortion` on a group returns `sum(children.grams)`, so mass is
  well-defined. A density change on a group should scale each child's calories by
  `d′/d` and apply the same share delta to each child, leaving every child's mass alone.
  It must not fall through to `portionFactor`, which would change the masses.
- **The single-draft rule.** `begin()` refuses a second draft. With five handles per
  row this needs to become "one draft, any fields" rather than "one draft, portion".
- **Provenance.** Every density/macro/calorie commit should carry
  `correctedNutrients: ['calories','protein','carbs','fat']` so the catalog reconcile
  and the AI review do not later overwrite a deliberate human call.
- **Discoverability.** Five drag targets on a 32px row, none of which look draggable,
  is a real risk. `.health-portion` gets `cursor: ew-resize` and a title; the same has
  to extend to the chips and the kcal figure, and the chips are currently 2rem wide.

---

## 5. Artwork: two independent breaks (P10, P11)

The client-side precedence the user described **is already correct**. `EntryRow.jsx`
renders `row.photoRef` as an `<img>` when present and unbroken, else `<FoodIcon>`;
`FoodIcon.jsx` resolves a slug to `/api/v1/health/nutrition/icons/:slug` and falls
through to the neutral SVG on a missing slug, the `'default'` sentinel, or a load
failure. Both breaks are upstream.

### 5.1 A hardcoded denylist forces common foods to the neutral glyph (P10)

`backend/src/2_domains/nutrition/services/icons.mjs#confineIcon` contains:

```js
if (['white fish', 'fish taco', 'ranch', 'ranch dressing', 'cream sauce', 'white sauce',
  'diced ham', 'scrambled eggs', 'plain yogurt', 'oikos pro plain',
  'chia seeds', 'organic chia seed', 'organic chia seeds'].includes(name)) {
  const exact = name.replaceAll(' ', '-');
  return vocabulary.has(exact) ? exact : NEUTRAL_ICON;
}
```

A name in that list can only receive the exactly-hyphenated slug. The installed manifest
offers 534 slugs; `scrambled-eggs`, `diced-ham`, `chia-seeds` and `plain-yogurt` are not
among them. (It does offer `fried-eggs`, `hard-boiled-egg`, `poached-egg-on-toast`,
`cured-ham-slices`, `glazed-ham`.) So those foods resolve to the neutral sentinel every
time, permanently.

**Evidence.** On the reviewed day, 5 of 9 rows render the fallback glyph, and 4 of those
5 are named in that array. Their stored `icon` values are `'default'` or `null`. The
fifth is a scale-density row whose label is a density level, not a food.

The rule was written for a good reason — the comment says a tortilla is not the dish it
contains and plain ingredients are not prepared desserts, and a wrong picture is worse
than no picture. The problem is the remedy: a household-specific denylist of food names,
compiled into a domain service, with no data-side escape hatch in place.

### 5.2 The escape hatch is present in code and empty in data

`confineIcon` checks `vocabulary.foodNames` **before** the denylist — a reviewed
name→slug map that `IconManifestStore.foodNames()` reads from a `foodNames:` block in
`apps/health/icon-manifest.yml`. The installed manifest has only `icons:` and `aliases:`.
There is no `foodNames:` block, so the map is empty and the denylist always wins.

Two ways out, and they compose:

1. Add a `foodNames:` block to the manifest mapping these names to the closest offered
   slug that is defensible (`scrambled eggs → fried-eggs` is a judgement call; `diced ham
   → cured-ham-slices` is closer). This needs a human, which is the design.
2. Add the missing art. `cli/curate-nutrition-icons.mjs` already drafts manifest entries.

Either way, the denylist should shrink to nothing and be deleted — a list of this
household's foods does not belong in `2_domains`.

### 5.3 Nothing re-icons stored history

The vocabulary is consulted at capture only. A row written with `'default'` keeps it
forever; adding a slug to the manifest tomorrow does not reach yesterday's rows.
`FoodCatalogService` carries an `iconOverride` on a catalog identity and the edit sheet
has a per-entry override, but there is no sweep. Whatever fix 5.2 takes, it needs a
companion backfill or the improvement is invisible on everything already logged.

### 5.4 Barcode product images are fetched and thrown away (P11)

`backend/src/1_adapters/nutribot/UPCGateway.mjs` returns an `imageUrl` on every hit —
`p.image_url || p.image_front_url` from OpenFoodFacts, `food.photo?.thumb` from
Nutritionix — and even logs `hasImage: !!product.imageUrl`.

`backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs` never reads it. The
only occurrence of the identifier in that file is `imageUrl: null`, on the catalog-hit
branch. Meanwhile `photoRef` is written by exactly one use case in the tree —
`LogFoodFromImage`, via `PhotoStore.save`. So a scanned product has no picture by
construction, and P11's first-class case is unreachable.

**Fix:** on a successful lookup, fetch `product.imageUrl` and hand the bytes to
`PhotoStore.save`, then stamp `photoRef` on the food item exactly as the photo path does.

**One guard.** When neither upstream supplies an image, the gateway substitutes
`BARCODE_IMAGE_FALLBACK(upc)` — a *rendered barcode*, not a photograph. Storing that as
a first-class picture would be worse than the neutral glyph: a row would show a barcode
where the food should be. The gateway currently collapses "real product photo" and
"generated barcode" into one field, so it has to report which one it returned before the
use case can persist only the former.

### 5.5 Related data gap worth confirming first

One row on the reviewed day is 458 g / 641 kcal — exactly 1.400 kcal/g, which is
rung 4 (`Mixed`) of the ladder, and its label is that rung's own label. Its
`protein`/`carbs`/`fat` are all `null`.

`SelectScaleDensity` writes all three from `computeNutrition`, so either this row
predates that write or it reached the ledger by another path. Its null macros are what
puts the `+` partial-coverage marker on the day's macro line. This is the same
arithmetic the density control would use, so it is worth tracing which path produced it
before building on top.

---

## 6. Decisions needed before implementation

1. **Density unit on the handle** — kcal/g to one decimal (recommended, matches the
   ladder) or kcal/100 g (integers, matches nutrition labels).
2. **Row density mode** — pointer-conditional (recommended: 44px floors survive under
   `pointer: coarse`, desktop drops to ~32px) or a single tighter value everywhere,
   which means retiring the touch-target rule and rewriting
   `layout.contract.test.js:47`.
3. **Macro drag invariant** — confirm that dragging protein holds mass and the other two
   macros, and lets calories follow. The alternative (hold calories, redistribute the
   other two) is defensible but surprising.
4. **Manifest remedy** — add reviewed `foodNames:` aliases to existing art, commission
   the missing art, or both. This gates whether P10 is a config change or an asset job.
5. **Backfill scope** — re-icon all stored history once the vocabulary improves, or only
   forward from the fix.

## 7. Suggested sequencing

Ordered so nothing is built twice.

1. **Equation strip width reservation** (P6). Independent, small, and every later drag
   handle inherits the benefit.
2. **Shared column track + tree geometry** (P2, P3, P4). One CSS pass: promote the row
   template to shared tracks, adopt it in the meal header, widen the child indent, put
   the trunk on the parent's artwork axis, shrink and round the child chips.
3. **Row density mode** (P1), after decision 2.
4. **Draft becomes a patch** (`usePortionDraft` + `portionPreview`). No user-visible
   change; unblocks everything after it.
5. **Density transform in `foodQuantity.mjs`** + ladder exposed to the client (P8, P9).
6. **New handles** on macros, calories and density (P7, P8).
7. **Day header redesign** (P5), last — it consumes the vocabulary the steps above
   settle, and it is the item most likely to want a second look before it lands.

Artwork is independent of all of it and can run in parallel:

- **A.** `foodNames:` aliases + missing art; delete the denylist (P10).
- **B.** Gateway reports photo-vs-generated; UPC path persists a real product photo
  through `PhotoStore` (P11).
- **C.** Backfill stored rows, per decision 5.
