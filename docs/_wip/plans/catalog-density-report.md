# Catalog density fix — report

Branch `feat/catalog-density` off `c21ba38b0`. Two commits:

| SHA | What |
|-----|------|
| `dff385f79` | The fix: observation ring + derived nutrition, capture guard, UPC provenance, quick-add scaling, drift audit + weekly task, prompt rule |
| `b76c35ea5` | Two findings from running it against a copy of production data, plus one vacuous test closed by mutation |

## Per item

**1. Catalog stores observations; nutrition is derived — DONE.**
`FoodCatalogEntry` keeps a 20-deep ring of `{date, kcal, protein, carbs, fat, grams, logId, source}`.
`nutrients` is now a getter over `deriveCanonical` (`2_domains/health/services/catalogDensity.mjs`):
the observation nearest the weighted-median **density**, scaled to the weighted-median **mass**.
Same shape as before, so presenter / suggest / quick-add are unchanged — each verified, not assumed.
`YamlFoodCatalogDatastore` round-trips the ring and materializes the derived serving under
`nutrients`. The "latest wins" mutation is deleted. Micros still donate per key, via a new explicit
`donateMicros`, and layer *under* the derived macros so a donation is never lost. An entry with no
usable observation returns its stored record unchanged — absence never becomes a written zero.

**2. Density guard at capture — DONE.** `FoodCatalogService.assessDensity` compares each parsed
item's kcal/g against the catalog's median for that name; beyond 2.2× it produces a finding, and
`formatDensityWarnings` appends a line to the Telegram confirmation / photo caption. It runs
**before** the catalog donation (a row must not move the median it is judged against) and changes
no number. Rows already land `settled: false` via `NutribotInputRouter.stampUnsettled`, so a flagged
item reaches the existing pending-review surface with no new plumbing.

**3. UPC provenance — DONE.** `LogFoodFromUPC` now passes `source: 'upc'`, `barcodeUpc: upc` and the
serving mass. `recordUsage` FILLS provenance on an entry that has none and never renames one that
already carries a code. Nothing is gated on source; UPC observations get weight 3 in the derivation.

**4. Quick-add from density × portion — DONE.** `quickAdd` uses `entry.nutrientsForGrams(grams)`,
falling back to the canonical serving when the entry cannot be scaled.

**5. Drift report — DONE, with a deliberate deviation (below).** `CatalogAuditService.report` is a
pure function of (catalog, history, ledger). `GET /nutrition/catalog/audit`,
`POST .../audit/approve`, `POST .../audit/dismiss`. Weekly `health:catalog-audit` at `10 4 * * 0`,
registered beside `health:template-curation` in `app.mjs` under the same non-fatal guard.

**6. Prompt fix — DONE.** Both parse prompts carry rule 7b: the name is the food, the portion goes in
grams, and the same food in a different amount comes back with the same name. Existing variants are
not merged.

## Deviation from the brief, stated plainly

The brief said drift proposals should go through `TemplateService.saveProposals`. They do not, and
the reason is in the code: that method mints a **meal template** — a row with `components`, surfaced
by `GET /nutrition/templates?includeProposed=1` in the meal picker and instantiable into a day's log
by `TemplateService.instantiate`. Filing "this shake's serving looks wrong" as a one-ingredient meal
template would put a food correction into the meal picker, and Approve would create a meal rather
than fix anything.

What IS reused is the half that matters: the household's **dismissal ledger**, via a new
`TemplateService.dismissKey`. Drift keys are namespaced `catalog-density:<normalizedName>` so they
cannot collide with meal-template proposal keys. Proposals themselves are not stored, because the
report is deterministic and recomputing it is cheaper than keeping a second thing that can go stale.

## Proof the reconcile is idempotent

Run against a **copy** of the live catalog (683 entries) and the full history (hot `nutrilist.yml` +
15 archive months), staged in the scratchpad. Nothing was written to the data volume.

```
run 1: {"scanned":683,"seeded":560,"unchanged":0,"skipped":123}   hash ee09665f…
run 2: {"scanned":683,"seeded":0,  "unchanged":560,"skipped":123} hash ee09665f…
run 3: {"scanned":683,"seeded":0,  "unchanged":560,"skipped":123} hash ee09665f…
IDEMPOTENT (runs 1..3 identical): true
```

`useCount` is untouched (42 → 42 on the shake). The first version of this run reported
`seeded: 560 / 1 / 1` — one entry whose history holds two rows under one id was re-written on every
run. That is commit `b76c35ea5`, and it is why the claim is made from a real run and not from the
unit test alone.

## "Premier Protein Shake" — what the derived value returns

Against the **pre-fix** production catalog (`food_catalog.pre-premier-fix.yml`, which still holds the
reported bug):

```
PRE-FIX catalog entry  : {"calories":610,"protein":66,"carbs":18,"fat":15}
DERIVED after reconcile: {"calories":192,"protein":36.1,"carbs":4.8,"fat":3.6}
  canonical grams      : 415        (the household's own median portion)
  density kcal/g       : 0.4638     (~160 kcal per 345 g bottle)
  observations         : 20
quick-add @ 385 g      : {"calories":178,"protein":33.5,...}   (was 610)
quick-add @ 330 g      : {"calories":153,"protein":28.7,...}
guard on a fresh 610 kcal / 385 g parse:
  ratio 3.42×, expectedCalories 179, sampleCount 20
```

## What the audit reports on the real catalog

683 scanned, 164 with enough history to judge, **16 flagged** (22 before the absolute floor):

```
7.14x  Mixed Greens: catalog 100 vs history 14 @ 75 g (22 rows)
6.00x  Avocado: 480 vs 80 @ 50 g (21 rows)
5.95x  Frozen Mangoes: 440 vs 74 @ 115 g (7 rows)
5.86x  PEANUT BUTTER SPREAD: 656 vs 112 @ 17 g (3 rows)
4.30x  Tortilla Chips: 1080 vs 251 @ 50 g (4 rows)
3.84x  Cheddar Cheese: 430 vs 112 @ 28 g (9 rows)
3.27x  Greek Yogurt: 392 vs 120 @ 200 g (31 rows)
2.96x  Premier Protein Drink: 480 vs 162 @ 330 g (32 rows)
2.60x  Korean Mandu · 2.50x Noodles · 2.42x Salmon · 2.38x Bacon Bits
2.38x  Protein Shake · 2.24x Mayonnaise · 2.22x Vinaigrette Dressing
```
Two runs produce byte-identical reports.

## Tests

Each command's own exit code, captured with `cmd > log 2>&1; echo "EXIT=$?" >> log`.

| Command | Result |
|---|---|
| `npx vitest run` over `2_domains/health`, `2_domains/nutrition`, `3_applications/health`, `3_applications/nutribot`, the two catalog datastore specs, `4_api/v1/presenters`, `tests/unit/domains/health`, `tests/unit/applications/health` | **70 files, 761 tests, all pass — EXIT=0** |
| `node scripts/gate-vitest.mjs` (run before the last two commits) | 32,855 tests — 32,760 pass, 39 fail, 13 failing files. **1 new failing file vs baseline: `IconManifestStore.media.test.mjs`**, confirmed to fail identically on a stashed pristine tree — it reads the real media mount and the installed icon manifest does not cover the legacy slugs on this host. Not mine. The gate itself then crashed on a pre-existing `ReferenceError: outFile is not defined` at `gate-vitest.mjs:377`, so its process exit code is not a verdict; the summary line is. |
| pre-commit chain (fs-import audit, `audit:layers`, `audit:ui`, `audit:links`, `check:parse`, `check:scss`, `test:composition-contracts`) | passes; both commits made **with hooks, never `--no-verify`** |

Three pre-existing assertions were updated because the behaviour they pinned is the bug being
removed (`micros.test` calories 150→140, `quickAdd.test` calories 310→300, presenter record 10→13
fields, stored-shape char test gains `observations: []`). Each change carries the reason inline.

## Falsification — every new test broken, then restored

23 mutations, driven by a script that applies the edit, runs only the owning test file, restores the
file, and checks that the *named* test is the one that failed.

| # | Mutation | Result |
|---|---|---|
| M1 | `usableGrams` drops the count-vs-mass guard | failed as expected |
| M2 | UPC weight 3 → 1 | failed as expected |
| M3 | derivation stops scaling to the median mass | failed as expected |
| M4 | `nutrients` returns the stored record even when derivable | failed as expected |
| M5 | `addObservation` appends instead of replacing by id | failed as expected |
| M6 | `#dehydrate` drops `observations` | failed as expected |
| M7 | reconcile appends and bumps `useCount` (the `backfill` sin) | failed as expected |
| M8 | audit ignores the dismissal ledger | failed as expected |
| M9 | "latest wins" restored | failed as expected |
| M10 | quick-add copies the stored total | failed as expected |
| M11 | `assessDensity` always returns `[]` | failed as expected |
| M12 | text guard handed `[]` instead of the parsed items | **STILL GREEN — a real vacuity.** The stub answered from a fixture and never inspected its arguments. Closed by a test that asserts the parsed items and userId reach the guard; M12 then failed as expected. |
| M13 | text confirmation drops the warning block | failed as expected |
| M14 | image caption drops the warning block | failed as expected |
| M15 | UPC provenance reverted to `'nutritionix'` | failed as expected |
| M16 | `formatDensityWarnings` always returns `''` | failed as expected |
| M17 | text prompt rule 7b removed | failed as expected |
| M18 | image prompt rule 7b removed | failed as expected |
| M19 | `nutrientsForGrams` stops scaling | failed as expected |
| M20 | audit `approve` writes nothing | failed as expected |
| M21 | image guard handed `[]` (added after M12) | failed as expected |
| M22 | reconcile compares against raw history, not the normalized ring | failed as expected |
| M23 | audit drops the 50 kcal absolute floor | failed as expected |

## Live data

**Nothing was written to the data volume.** Production files were copied OUT
(`sudo docker exec … cat > scratchpad/realdata/…`) and every run above operated on that copy in
`…/scratchpad/work/` and `…/scratchpad/work2/`. The reconcile has **not** been run against live data.

Note found while reading: `food_catalog.pre-premier-fix.yml` and `nutrilist.pre-premier-fix.yml`
already exist in the data volume (2026-09-04 09:37), and the live catalog's "Premier Protein Shake"
already reads 160 kcal — someone hand-corrected that one entry before this work started. The other
15 drifted entries are untouched.

## Concerns

- **The reconcile has no route and no scheduled task.** It is composed
  (`createCatalogAuditService` builds one) and reachable only through
  `POST /nutrition/catalog/audit/approve`, one entry at a time. A whole-catalog seed needs a
  deliberate operator step. That is intentional — it rewrites 560 rings — but it means the fix does
  not take effect for existing entries until someone runs it.
- **`useCount` on live entries is already inflated** by past `backfill` runs (decision 2.29). This
  work does not touch it and does not fix it; the suggest ranking still reads those counts.
- **A stored nutrilist row does not record which capture path produced it.** `carrySource` re-attaches
  a UPC label across a rebuild by id and then by value, which is deterministic but is a patch over a
  missing field. If UPC weighting matters more later, `source` belongs on the row.
- **`MIN_MASS_G = 5` and `DRIFT_RATIO = 2.2` are thresholds, not laws.** The 2.2 comes from the
  investigation's own measurement; the 50 kcal floor is my judgement from the real report.
- **The derived serving is the household's median portion, not a label serving.** For the shake that
  is 415 g / 192 kcal, not one 330 ml bottle. That is honest — it is what "one of these, for you"
  actually means — but it will read as surprising next to a nutrition label.
- **`gate-vitest.mjs:377` crashes on an undefined `outFile`** after printing its summary. Unrelated
  to this work, but it makes the gate's exit code useless.
