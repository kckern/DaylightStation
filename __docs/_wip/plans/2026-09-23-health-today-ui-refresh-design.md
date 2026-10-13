# Health Today — UI refresh, artwork repair queue, catalog serving fix

Date: 2026-09-23 · Branch: `feat/health-today-refresh`

## Why

A review of the Today tab (yesterday's log) turned up three kinds of problem:

- **Data gaps.** A quick-added "Strawberry Milkshake" showed no portion and no
  picture. Its catalog entry was learned from a barcode scan but kept only the
  macros: `baseGrams: null`, `icon: null`, usage quantity recorded as `0 g`. The
  scan's serving (325 ml) and product photo (`photoRef`) never reached the
  catalog, so every quick-add of it inherits the gaps. 60 of 183 rows in the
  current nutrition list carry `icon: default`.
- **Artwork failures are abandoned.** A failed icon or photo logs one
  `artwork.*-failed` warning per page session and falls back to a glyph. The
  auditor drops unsupported artwork. Nothing ever retries.
- **Chrome weight.** Seven equal cards for the summary (with food shown as a
  negative), a top "Add to Breakfast" rail that duplicates each meal's own add
  row, a mic in every meal header, and a heavy add row per meal. Moving a food
  to another meal needs a trip through the edit sheet. The row preview opens
  after 350 ms, below the row, under a native `title` tooltip.

## Design

### 1. Summary: budget bar + macro bars (`EquationStrip`)

- Date stepper left; a wide calorie bar right. Food fills against
  budget + exercise; the exercise share is a lighter end segment.
- Headline "N kcal left" (or "N kcal over" in the over tone, with the overage
  drawn past the end marker). Secondary line:
  "1,603 eaten of 2,022 · budget 1,791 · +231 exercise". No negative numbers.
- Protein / carbs / fat: one thin bar each against `macroGoals` when set, in the
  existing macro tones; plain grams without a bar when no goal. The partial "+"
  marker is kept.

### 2. Adding food

- The top `QuickCaptureBar` is removed.
- All four meals always render. An empty meal is its header plus its add row.
- The add row is a slim, borderless "+ Add food…" line; the field outline
  appears on focus. Its action icons are smaller and muted, brightening on
  row hover / focus-within.
- The per-meal header mic is removed. With foods selected in a meal, the add
  row's mic carries the selection (the "edit these by voice" route) and its
  label says so.

### 3. Drag a food to another meal

- Row hover: subtle full-row highlight, pointer cursor (click still opens the
  editor).
- Press + ~6 px movement starts a drag (cursor → grabbing, a ghost follows).
  Touch: long-press ~300 ms. Meal sections highlight as drop targets.
- Dead zones — never start a drag: portion slider, kcal slider, macro badges,
  confirm ✓, delete ✕, group expand triangle.
- Drop sets `mealTime`; a dish moves with its ingredients (backend cascade).
  The moved row gets the "added" highlight; an Undo toast offers the reverse
  move. Logged as `entry.move { uuid, from, to }`.

- **Whole meal** (added during the session): drag the meal header onto another
  meal, or ⋯ → "Move all to". Every top-level entry moves; one Undo moves all
  back; a part-way failure keeps what moved and says how many did not.

### 3b. Calorie bars on one scale (added during the session)

- Every kcal bar on the day shares one absolute scale — the largest figure any
  row shows (entry, dish rollup, or ingredient). Ingredients no longer rescale
  to their own dish.

### 4. Row preview card

- Drop `title={name}` from the name (the native tooltip).
- Open on hover with no delay; keep the 150 ms close grace.
- Position `top-start`, flipping below only when there is no room.

### 5. Artwork remediation queue (backend)

- Durable queue of `{ key, kind: icon-missing | icon-failed | photo-failed,
  foodId, rowIds, attempts, nextAttemptAt, lastError, createdAt }`.
- Enqueued: at capture when a row lands on `default`; from the browser via a
  new report endpoint (`artworkLog.js` posts, still logs); a one-time sweep
  over existing rows.
- Resolution: reviewed name→icon map → nearest icon from the existing
  vocabulary (AI pick, confined to the manifest) → for `EXACT_ONLY_NAMES`,
  the barcode product photo if one exists, otherwise the item stays open.
  No new art is generated.
- Resolved art is written to the catalog entry and every affected row.
- Exponential backoff, no retry cap. Health → Settings lists open items with
  their last error.

### 6. Catalog serving + photo from barcode captures

- A UPC capture that creates or updates a catalog entry carries its serving
  (e.g. 325 ml → portion), grams when known, and the product `photoRef`.
- Quick-add from the catalog uses that serving and photo; usage quantity is
  recorded as the real amount, never `0 g`.
- Backfill: existing UPC-sourced catalog entries are repaired from their
  original scan rows.

## Found along the way

- A failed voice recording's Retry lived in the meal mic, which remounts on a
  day change — so the retry was lost (true on main too, via the header mic).
  The mic now hands a failed send to a page banner ("Retry recording") that
  keeps its original meal, day and selection.

## Order of work

Data first (6, then 5), then the UI (4, 1, 2, 3). Each is independently
shippable.
