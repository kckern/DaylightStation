# Health app data-quality audit — 2026-09-08 → 2026-09-22

Scope: the Today log in `/health`. Sources: the log store (7-day retention, so
logs cover 09-15 onward), the hot NutriList (93 food rows since 09-08), the food
catalog (747 entries), the icon manifest (534 icons, 21 aliases), Open Food
Facts responses for the affected UPCs, and screenshots from 09-18/19/21.

## Findings

### 1. Every barcode scan throws away its icon (38/38 in 7 days)

`UPCGateway` stamps every product `icon: '🍽️'`. `LogFoodFromUPC` then prefers
`product.icon` over the classifier's answer whenever it is not `'default'`:

```js
const proposedIcon = product.icon && product.icon !== 'default' ? product.icon : classification.icon;
```

The emoji wins, `confineIcon` refuses it, and the row lands on `default`.
Every one of the 38 `upc.icon.unresolved` events in the store carries
`proposedIcon: "🍽️"`, including catalog hits. The classifier runs and its answer
is discarded. Two hot rows even store the literal emoji as `icon`.

### 2. The catalog still speaks the retired icon vocabulary (186 entries, 83 slugs)

Catalog entries carry pre-manifest slugs: `cheese` (14), `salad` (15),
`chicken` (11), `sauce`, `fish`, `egg`, `milk_shake`, `ranch_dressing`,
`pitasandwich`, `broccoli`, `watermelon`, … None exist in the manifest or its
aliases, and `/api/v1/health/nutrition/icons/cheese` returns 404.
`FoodCatalogService.resolveIdentity` copies `entry.icon` onto new rows after
`confineIcon` has run, so these slugs bypass the vocabulary check. 32 of the 167
hot rows hold such a slug. This is why **Pita Bread** (`pitasandwich`, manifest
has `pita-bread`), **Feta Cheese** (`cheese`), **Galbani String Cheese**, and
the ranch/coleslaw dressings show the bowl glyph.

### 3. "Magazine" ×6 — scanner re-fire plus a junk OFF record

21:50:11–21:50:26 on 09-21: the `nutribot-upc` relay emitted `037000338369`
nine times in 15 s, three of them glued into the 24-digit
`037000338369037000338369` (two reads without a terminator). Open Food Facts
names that UPC "Magazine" and has no nutrition. Six rows were written, each
with unknown calories/macros, which is what put the `+` on the day's P/C/F
totals. Nothing in `barcodeRelay.mjs` or `LogFoodFromUPC` debounces repeats or
rejects an over-length code. The same shared reader also scans ISBNs for
School, so book codes (978/979 prefixes) must never reach nutribot.

Smaller repeats: Strawberry Milkshake twice within 0.4 s on 09-19 03:19:06
and again on 09-18.

### 4. Placeholder art stored as a real product photo

All six Magazine rows (and Mexican Style 4 Cheese Blend) saved a 4,944-byte
"image coming soon" picture. The source is `BARCODE_IMAGE_FALLBACK`
(barcodespider), used whenever OFF has no image. `fetchImage` checks magic
bytes, and a placeholder is a valid JPEG, so it gets past that check. The
row renders `photoRef` ahead of its icon, so the placeholder hides any icon
the row does have.

### 5. Density "—" on 30 rows: serving unit mislabelled `ml`

OFF's `serving_quantity_unit` says `ml` for solids whose label reads
grams: OIKOS yogurt `"0.75 cup (170 g)"`, cheese blend `"1/4 cup (28 g)"`,
kidney beans `"1/2 cup (130 g)"`. `normalizeProductNutrition` trusts the unit
field and ignores the gram figure in `serving_size`, so `grams` stays null and
density cannot be computed. 19 rows are `ml`. The screenshots show the result:
"28.3 ml" of shredded cheese. For true liquids (milkshakes, protein shakes)
there is still no grams, so their density badge is always blank.

### 6. Known nutrition recorded as unknown

- **Diet Coca Cola**: OFF has `energy-kcal_100g: 0` but no serving size, so the
  row stores `calories: null` ("— kcal") instead of 0.
- **Peanut Butter Spread** (×2): `656 kcal/100g`, serving "2 tbsp" with no grams.
  The per-100g basis is discarded instead of being used as a 100 g, or
  AI-estimated, serving.
- **Winco Foods** / **Winco Foods Mexican Style Blend Cheese**: store-brand
  name only, no nutrition.

### 7. All-caps product names

OFF names pass through verbatim: `OIKOS PRO PLAIN`, `PEANUT BUTTER SPREAD`,
`BABY SPINACH`, `Galbani STRING CHEESE`, `Sharp Cheddar Cheddar Cheese`
(duplicated word). Names should be normalized once at ingest (smart title case
that keeps short acronyms and brand casing) before they reach the catalog.

### 8. `%s` prefix from the scanner shortcut

Four `direct.upc.rejected` on 09-19 with `upcParam: "%s0049000000450"`. A
URL template's placeholder is being sent literally. `direct.upc.prefixStripped`
later handles it; the sender's template should still be fixed.

### 9. Catalog density flags

Weekly audit flagged `Garden Salad`; capture flagged `Tzatziki Sauce`
(30 kcal logged for 60 g vs ~72 expected).

### 10. Frontend observability (fixed in this pass)

Only 3 health frontend events reached the store in 7 days. Failed icons,
broken photos and data gaps fell back to the bowl glyph or "—" and left no
trace. Added:

- `artwork.icon-failed` / `artwork.photo-failed` (warn, once per key per page
  session) from `FoodIcon` / `EntryRow`, via `today/artworkLog.js`.
- `day.quality` (info, once per date + ledger revision, only when non-clean)
  from `useHealthDay`, counting `noArtwork`, `unknownCalories`, `noGrams`,
  `allCaps`, `duplicates` with sample names (`today/dayQuality.js`).

Query: `curl -s {env.log_store_url}/select/logsql/query -d 'query=context.app:health AND (_msg:"day.quality" OR _msg:~"artwork") AND _time:24h'`

### Housekeeping observed

`food_catalog.yml.tmp-77-…` (655 KB, 09-11) is an abandoned atomic-write temp
file beside the live catalog. Three 2026-03/06 Dropbox conflicted copies
remain in the nutrition folder.

## Pre-existing test failures (not from this pass)

`today/viewedDate.test.jsx` — 6 tests time out at HEAD as well.
