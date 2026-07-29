# Printable sheet framework — design

**Date:** 2026-07-29
**Status:** designed, not built
**Supersedes the "PDF sheet" section of** [`docs/plans/2026-07-21-scan-enriched-food-logging-design.md`](../../plans/2026-07-21-scan-enriched-food-logging-design.md)
**Related:** [`docs/reference/nutrition/README.md`](../../reference/nutrition/README.md), [`docs/plans/2026-07-28-universal-scan-vocabulary-design.md`](../../plans/2026-07-28-universal-scan-vocabulary-design.md)

## What this is

A config-driven framework for generating **printable interaction surfaces** — pages of
scannable marks that act as input devices for the house. The nutrition fridge sheet is the
first consumer; the content catalog is the second (it already exists as a prototype and gets
folded in).

The mark is *not* assumed to be a QR code. A cell can be a QR, a Code 128 bar code, a plain
label, or a blank spacer, and new kinds are registered without touching the layout engine.

## The constraint that shapes everything

**A printed code must not be able to drift from the grammar that parses it.**

`ScanVocabularyService` already exports `encodeDensity()`, `encodeContainer()` and
`RESET_CODE` for exactly this reason. Therefore a block's **items come from a provider
function in code**, never from literal payloads in YAML. YAML decides *shape*; the domain
decides *what the codes are*. A sheet that listed `dl:4` literally would make the printed
code and the parsed code two independent facts, which is the failure this design exists to
prevent.

## Layers

```
2_domains/nutrition/services/ScanVocabularyService.mjs   exists   encoders + parseScan
1_rendering/qrcode/QRCodeRenderer.mjs                    exists   SVG QR, supports coverData
1_rendering/pdf/SheetLayout.mjs                          NEW      pure geometry, golden-tested
1_rendering/pdf/QRSheetRenderer.mjs                      NEW      thin pdfkit emitter
3_applications/sheets/SheetService.mjs                   NEW      config + providers -> model
5_composition/modules/sheetProviders.mjs                 NEW      provider + cell-renderer registries
4_api/v1/routers/sheets.mjs                              NEW      GET /api/v1/sheets/:id.pdf
4_api/v1/routers/catalog.mjs                             REWRITE  thin delegate, same URL
```

`SheetLayout` is the only component with non-trivial logic and the only one meaningfully
tested. It is pure: page geometry + block specs + item **counts** in, placements out
(`{ page, block, index, x, y, w, h }` plus title placements). It never sees an item's
contents, so it stays pure no matter what cell kinds exist later.

`QRSheetRenderer` is deliberately dumb — walk placements, call a cell renderer, `SVGtoPDF`
into the rect. It makes no decisions, so there is nothing worth testing beyond "it emitted
a PDF."

### Why the layout maths is extracted rather than characterization-tested in place

pdfkit stamps `CreationDate: new Date()`, derives the trailer `/ID` from an md5 over the
info dict, and embeds `CreateDate` in XMP. **Output is not byte-stable**, so a golden test
on the PDF pins nothing. Extracting the geometry into a pure function moves the testable
part somewhere a test can actually hold it.

## Config

`data/household/config/sheets.yml` (household app config, read via
`ConfigService.getHouseholdAppConfig(hid, 'sheets')`).

```yaml
defaults:
  page: { size: letter, margin_pt: 36 }
  cell: { kind: qr, gap_pt: 8 }

sheets:
  fridge:
    title: "Kitchen scale"
    blocks:
      - title: "Caloric density"
        source: nutrition.density
        grid:  { cols: 3, rows: 3 }
        cell:  { kind: qr, size_pt: 108, icon: true, sublabel: kcal_per_g }
      - title: "Containers"
        source: nutrition.containers
        grid:  { cols: 5, rows: 5 }
        cell:  { kind: qr, size_pt: 64 }
      - title: "Controls"
        source: nutrition.controls
        grid:  { cols: 2, rows: 1 }
        cell:  { kind: qr, size_pt: 96 }

  content-catalog:
    title: "{{ params.title }}"
    params: [source, id, screen, options]
    blocks:
      - source: content.catalog
        grid: { cols: 3, rows: 5 }
        cell: { kind: qr, cover: true }
```

### Two extension points, both string-keyed

| Seam | Contract | Ships with |
|---|---|---|
| `source:` | `(params, ctx) => Item[]` where `Item = { code, label, sublabel?, icon?, cover? }` | `nutrition.density`, `nutrition.containers`, `nutrition.controls`, `content.catalog` |
| `cell.kind:` | `(item, rect, opts) => svgString` | `qr`, `code128`, `label`, `blank` |

`params:` declares what the route accepts and forwards to providers. That is what lets
`content-catalog` — whose items depend on `:source/:id` — be configuration rather than a
bespoke router.

`code128` is included from the start because the DS2278 quick-reference sheet
(`_extensions/kitchen-relay/ds2278-quick-reference.pdf`) is exactly this class of artifact,
currently hand-rolled. Migrating it is explicitly **not** in scope: its bar codes are vector
artwork clipped out of a source PDF, which is a different item kind.

## Grid semantics

`grid: { cols, rows }` means **cols is fixed; rows is the per-page maximum**. Config declares
the shape, the provider decides how many.

| Items | 5x5 block |
|---|---|
| 4 | one short row, block ends, `sheet.block.underfull` logged |
| 25 | fills the page exactly |
| 30 | 25 here, then `Containers (cont.)` overleaf |

An exact `cols x rows == count` contract was rejected: container lists will grow, and a
4-item list must still be printable in a 5x5 block without a config edit.

## Failure policy

Split on whether the defect would be **visible on paper**.

**Structural — return an error, emit no PDF.** Unknown sheet id, unknown `source`, unknown
`cell.kind`, or a provider that throws. A partially rendered sheet is the worst outcome: a
laminated page with a silently missing bank is discovered at the fridge, not at the printer.
Config is also validated at startup so a typo'd `source` surfaces on boot.

**Cosmetic — degrade and log once.** A missing icon file falls back to a label-only cell; an
item without a sublabel just omits it. Never blocks the page.

## Staleness

A laminated sheet outlives config edits. Rename a container id and the printed code orphans.

1. **The footer prints a config fingerprint** — `fridge · a3f91c · 2026-07-29` — so you can
   tell at a glance whether the page on the door still matches what the backend believes.
2. **Known bug, filed separately, NOT fixed here:** an unknown `ct:` id currently produces a
   *silent zero tare* (`computeNet` treats an absent container as "no tare"), so an orphaned
   code under-reports instead of refusing. That is a parser fix and does not belong in this
   change.

## Testing

**The anti-drift property test is the important one.** For every item each nutrition provider
emits, `parseScan(item.code)` must resolve back to the same level or container. It runs
against the live config, so a malformed density level fails before anything is printed.

**`SheetLayout` gets golden tests** on placements: exact fill, underfull last row, overflow
pagination with a continued block title, multi-block pages, and title height consumed on
page one only.

**Everything downstream gets a smoke test only** — 200, `application/pdf`, non-trivial
length. A byte comparison on pdfkit output would assert nothing (see above).

## Migration

`catalog.mjs` keeps its URL and becomes a thin delegate. Its cover-art path must retain the
existing Resvg rasterization step — `svg-to-pdfkit` cannot handle SVG-in-SVG, so cover images
are rasterized *inside* the QR SVG. The fridge sheet has no covers and stays fully vector.

## Prerequisites (data, not code)

- **`scales.yml` has no `nutribot:` block.** Density levels and containers currently come from
  `DEFAULT_DENSITY_LEVELS` / `DEFAULT_CONTAINERS` in `scaleNutribotConfig.mjs` — 4 containers,
  and macro splits the source itself labels *"hand-estimated to be plausible… not measured."*
  The sheet will faithfully print those fallbacks. Real tare weights need a kitchen scale.
- **~14 food icons** to source as SVG (svgrepo skill), resolved against a configured icon dir.

## Deliberately out of scope

- Absolute or freeform cell positioning — grid only.
- A web preview UI.
- Migrating the DS2278 reference sheet.
- Fixing the silent zero-tare bug (filed, not smuggled in).

## Open question

Household app config is cached at startup, so editing `sheets.yml` requires a backend restart
before the route reflects it. Acceptable for a page that gets printed and laminated; worth
revisiting only if sheet iteration becomes frequent.
