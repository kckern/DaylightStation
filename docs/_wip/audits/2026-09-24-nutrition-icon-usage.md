# Nutrition icon manifest — usage audit (2026-09-24)

**Question:** which icons in the hand-reviewed manifest (`household/apps/health/icon-manifest.yml`)
earn their place? Unused icons are not free: every one is a candidate the nearest-icon
pick (LLM or Jev) can land on, and several of today's odd picks are props or novelty art.

**Method:** counted every `icon` / `iconOverride` value in the head of household's
`nutrilist.yml`, all 15 monthly `nutrilist` archives (2025-06 onward) and
`food_catalog.yml`. 4,945 rows carry an icon; the only value outside the manifest is
`default` (210 rows), so historical rows were migrated to current slugs and the counts
are comparable.

## Headline

| | Icons |
|---|---|
| In manifest | 534 |
| Used at least once | 274 |
| **Never used** (rows or catalog) | **260 (49%)** |
| Used exactly once | 46 |
| Used 10+ times | 119 |

Unused by pack (unused / pack size): halloween-food 26/29, tea 23/26, alcohol 22/25,
coffee 21/23, christmas-food 21/31, juice-and-smoothies 20/31, bubble-tea 20/28,
kawaii-food 20/26, breakfest 14/35, watercolor-sweets 11/16, charcuterie-board 10/35,
vegan-food 9/28, bbq-grill 9/25, mexican 8/22, bakery 6/27, italian 5/22,
healthy-food 5/27, asian-food 5/20, fast-food 4/24, watercolor-fruits 1/14,
vegetables 0/20.

## Proposed tiers

### A. Props — not food (cut)

No one eats these; as a "nearest" pick they are always wrong.

analog-kitchen-scale, digital-kitchen-scale, cheese-knife, chopsticks,
wooden-serving-board, grilling-tongs, kettle-grill, grill-flames, campfire, blender,
pinata, cactus, wheat-stalks, hop-cones, coffee-plant, coffee-bag, coffee-bean-jar,
roasted-coffee-beans, moka-pot, french-press, paper-food-tray, paper-takeout-bag,
pizza-box, ceramic-teapot, floral-teapot, floral-teacup, floral-milk-pitcher,
chinese-tea-set, flowering-tea-pot, rose-pattern-teapot, lidded-teacup,
loose-leaf-tea-tin, teaspoon, wooden-beer-barrel — **34, all unused.**

Used once, and almost certainly a mis-pick: **basting-brush, citrus-juicer.** Cutting
them sends those rows back through the artwork queue for a real icon.

### B. Novelty duplicates (cut)

Cartoon or seasonal-costume versions of foods that already have a plain icon.

- kawaii-food `smiling-*` — 20 unused (the pack's 6 used ones stay until re-picked)
- halloween-food — 26 unused (spiderweb-*, ghost-*, mummy-hot-dogs, purple-potion, …)

### C. Drink families never logged (household call)

Never logged in 16 months. Keep them if guests' or future entries matter; otherwise cut.

- alcohol — 22 unused (+ red-wine, sparkling-wine-bottle used once each)
- coffee — 21 unused (+ black-coffee used once)
- tea — 23 unused (herbal ones such as chamomile, mint and lemon-tea included)
- bubble-tea — 20 unused of 28 flavour variants

### D. Keep — plausible foods not logged yet

Real foods a nearest pick should be able to reach: croissant-with-jam-and-butter,
blueberry-pancakes, avocado-toast, churros, quesadillas, caprese-salad, onigiri,
pumpkin-pie, pecan-pie, glazed-ham, gingerbread-man, hummus-with-chickpeas, the
charcuterie meats, the juice and smoothie glasses, and the rest of the unused
real-food icons.

## Effect

| Cut | Manifest size |
|---|---|
| A + B | ~452 |
| A + B + C | ~366 |

Neither gets under Jev's 255-option cap, and neither needs to: the Jev adapter narrows
a larger choice in two rounds. The gain from curation is **pick quality**: fewer
props and cartoons for a nearest match to land on.

## Mechanics

Removing an unused slug from the manifest breaks nothing: no row or catalog entry
references it. Removing a used-once slug makes that row's art fail to resolve, which
queues it in the artwork remediation queue for a fresh nearest pick. The manifest
lives in the shared data tree, so an edit takes effect on the next icon reload,
not on deploy.

## Applied 2026-09-24

Tiers A, B and C were cut: **150 icons removed, 534 → 384.** In B and C only the
unused icons were removed. The pack icons already on logged food stay. The two
used-once props (basting-brush, citrus-juicer) were cut, and their rows go back
through the artwork queue. `aliases` (resolvable, never offered) and `foodNames`
are unchanged. No `foodNames` entry pointed at a cut slug. The pre-curation copy is
`household/apps/health/_backups/icon-manifest.pre-curation-2026-09-24.yml`.

The cleanup/artwork manifest instance reloads before each audit request. The UPC
capture's icon list (`foodIconsString`) loads once at startup and takes the cut on
the next deploy. Any stale pick made before then fails to resolve and is re-picked by
the artwork queue.
