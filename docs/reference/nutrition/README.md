# Nutrition — scan-enriched food logging

How a weight on the kitchen scale becomes a net-weighted, density-classified nutrition
entry, using a laminated QR sheet on the refrigerator instead of a tare button.

**Status: partially implemented.** The nutrition domain layer and the application-layer
composition store are built and tested; nothing is wired to the relay or nutribot yet, so
none of it is reachable from the running system. See [Implementation status](#implementation-status)
before relying on anything here. Design rationale:
[`docs/plans/2026-07-21-scan-enriched-food-logging-design.md`](../../plans/2026-07-21-scan-enriched-food-logging-design.md).
Task plan: [`docs/plans/2026-07-21-scan-enriched-food-logging.md`](../../plans/2026-07-21-scan-enriched-food-logging.md).

---

## The problem

The BLE kitchen scale and the BLE barcode scanner share an ATOM Lite and an event bus but
nothing else. The scale reports a **gross** weight; nutribot then estimates everything else
from that one number. Getting a true net weight means tare gymnastics or decanting food into
a second container, so in practice it doesn't happen — and the one fact a scale is good at,
a precise gram measurement, never survives to the entry.

## The flow

```
    fridge sheet                      kitchen scale
  ┌──────────────┐                 ┌────────────────┐
  │ dl:1 … dl:9  │  9 density      │ KitchenIQ 50797│
  │ ct:<id> ×25  │  25 containers  │ SENSSUN FOOD   │
  │ rs:clear     │  1 reset        └───────┬────────┘
  └──────┬───────┘                         │ BLE notify 0xFFB2
         │ scanned                         ▼
         │                          ATOM Lite relay          [_extensions/food-scale-relay]
         │                                 │ WS { source:'food-scale', grams, unit, stable }
         ▼                                 ▼
   ATOM Lite relay ──WS──▶  WebSocketEventBus (/ws)
         │                                 │
         ▼                                 ▼
   createBarcodeRelay()             createFoodScaleRelay()   [3_applications/hardware/]
         │ parseScan(code)                 │
         │  hit → route:'nutriscan'        └─▶ ScaleNutribotBridge
         │  miss → content dispatch                    │
         ▼                                             ▼
   ApplyScanToComposition  ────────▶  CompositionStore   ◀──── setWeight()
         setDensity() / setContainer() / clear()   │  (holds immutable Composition values)
                                                   │ complete = grams && density
                                                   ▼
                                        computeNet → computeNutrition   [2_domains/nutrition]
                                                   │
                                                   ▼
                                   nutribot entry (auto-accepts when complete)
```

**A parse miss is not a no-op.** The fridge scanner is configured `route: content`, so a code
that `parseScan` declines is *handed onward* to content dispatch, not dropped —
`BarcodePayload.#parseCommand` returns null and `ContentExpression.fromString` turns it into
`{ type: 'content', contentId: '<the code>' }`. That is why the `nutriscan` branch must come
first, and why the encoders throw rather than emit an unparseable code.

---

## The scan grammar

`backend/src/2_domains/nutrition/services/ScanVocabularyService.mjs` is the **single owner**
of the grammar.
Both the parser and the PDF sheet generator import it, so the printed page cannot drift from
the parser.

| Code | Meaning |
|------|---------|
| `dl:<1-9>` | caloric density level |
| `ct:<id>` | container tare, `id` matching `/^[a-z0-9][a-z0-9-]*$/` |
| `rs:clear` | reset the in-progress composition |

**Case-sensitive throughout.** `DL:4`, `CT:mug`, `RS:clear` and `ct:Dinner-Bowl` all return
`null`. A case-preserved id would miss its `containers.items` key and silently skip the tare,
producing a wrong-but-plausible calorie count rather than a visible error.

**The encoders validate and throw.** `encodeDensity` / `encodeContainer` reject anything
`parseScan` would decline. An id that encodes but does not parse produces a laminated QR that
can never be read, and the remedy is a reprint rather than a code fix — so failing at
PDF-generation time is the cheap option. `MAX_DENSITY_LEVEL` is exported and drives both the
range check and the error message; raising it to 10 makes `dl:10` parse with no other edit,
but the `density_levels` table must move in the same commit.

**Namespace.** Content barcodes use a colon grammar too (`<command>:<arg>` and
`<screen>:<command>` — parsed in `2_domains/barcode/BarcodePayload.mjs`, not
`BarcodeCommandMap.mjs`, which is only the command map). There is no shared registry. No live
collision exists: configured screen ids are `livingroom-tv`, `office-tv`, `piano`, `garage-tv`,
`portal`, `speaker-*`, none named `dl`/`ct`/`rs`. Keep it that way.

---

## The math

`backend/src/2_domains/nutrition/services/ScanNutritionService.mjs`.

```
net_g  = max(0, gross_g − (container ? container.grams : 0))
kcal   = round(net_g × level.kcal_per_g)
fat_g     = kcal × fat_pct/100     ÷ 9
carb_g    = kcal × carb_pct/100    ÷ 4
protein_g = kcal × protein_pct/100 ÷ 4
```

**Macros are stored as percent of calories, not grams.** They must sum to 100, which makes the
hand-authored density table self-validating — a typo fails a schema check instead of producing
a level whose macros don't reconcile with its own calorie count.

**Macro grams derive from the *rounded* calorie figure**, so stored macros reconcile against
the stored total rather than an intermediate nobody can see. `fat_g × 9 + carb_g × 4 +
protein_g × 4 === calories` is a pinned invariant. Rounding inside this module breaks it —
round at the storage boundary instead.

**The clamp is load-bearing.** While container weights are placeholders, `gross < tare` is
guaranteed. A negative net clamps to zero and sets `clamped: true`; a silent 0 kcal entry
would auto-accept into history.

**Strict finite numbers, no coercion.** Every numeric input must be a finite `number` or
`ValidationError` is thrown — numeric strings included. Both upstream layers already coerce
(`ScaleNutribotBridge` guards with `Number.isFinite`, `scaleNutribotConfig` coerces at config
load), so a string arriving in the domain genuinely is a defect. The rejected alternative,
`Number(x) || 0`, let `computeNet(NaN, …)` return `netG: NaN` — which JSON-serializes to
`null` with `clamped: false`, asserting the entry is fine.

A throw **fails safe**: `barcodeRelay.mjs` and `ScaleNutribotBridge.mjs` both catch, log, drop
the entry and release the mutex. A dropped scan, not a crash.

### Error codes

| Code | Means | Remediation |
|------|-------|-------------|
| `INVALID_DENSITY_LEVEL` | a scanned level is out of range (`ScanVocabularyService`) | rescan |
| `MALFORMED_DENSITY_LEVEL` | the config table row is malformed (`ScanNutritionService`) | fix the YAML |
| `INVALID_GROSS_WEIGHT` / `INVALID_NET_WEIGHT` | non-finite weight | upstream defect |
| `INVALID_CONTAINER_TARE` | container is not an object, or `grams` unusable | fix the container row |
| `INVALID_MACROS` / `INVALID_KCAL_PER_G` / `INVALID_PER_100G` | density row fields | fix the YAML |

The first two are deliberately distinct: one means "rescan," the other "fix config," and a
caller branching on `err.code` must be able to tell them apart.

`macros` and `per_100g` are treated asymmetrically on purpose. A blank `per_100g` field
(`fiber_g:` with no value, which YAML parses as `null`) is tolerated as absent — a missing
secondary nutrient cannot fabricate calories. A blank `macros` field throws, because a zeroed
macro split *can* produce a plausible-looking wrong entry.

---

## The composition

`2_domains/nutrition/value-objects/Composition.mjs` (immutable value object) plus
`3_applications/nutribot/CompositionStore.mjs` (the per-scale map and the window). Three slots —
`grams` / `density` / `container` — filled by whichever event arrives, **in any order**,
within a rolling window (default 900 s).

`complete` = grams present AND density present. A complete buffer auto-accepts; a bare weight
stays `pending` on nutribot's existing density/container keyboard.

**Slots are consumed at placement end.** Without this, the second food weighed inside one
window inherits the first food's density and tare. Weigh yogurt with `dl:2` + `ct:small-bowl`,
eat it, weigh pasta six minutes later without scanning, and the pasta logs as level-2 minus a
180 g bowl that isn't there — and auto-accepts. That is an ordinary evening, not an edge case.

**The window refresh set excludes raw scale frames.** The firmware heartbeats at 0.5 Hz
(`emit.heartbeat_hz`) while the scale rests on its shelf, so frame-driven refresh would mean
the buffer never expires. Only scans and qualifying placements refresh it.

`now` is injected; the module never reads the wall clock, so window math is deterministic
under test.

---

## Config

Everything lives in the `nutribot:` block of `data/household/config/scales.yml` — no new file,
since containers and density levels already live there and the printed sheet is generated from
the same source the parser reads. Schema:
[`_extensions/food-scale-relay/config.example.yml`](../../../_extensions/food-scale-relay/config.example.yml).

```yaml
- level: 9
  label: "Oil"
  emoji: "🫒"
  kcal_per_g: 8.5
  macros:   { fat_pct: 98, carb_pct: 1, protein_pct: 1 }
  per_100g: { fiber_g: 0, sugar_g: 0, sodium_mg: 2 }
```

**Config is cached at startup.** Editing container weights or density rows requires a backend
restart before it takes effect.

---

## Implementation status

| Component | State |
|-----------|-------|
| `services/ScanVocabularyService.mjs` — grammar, encoders | **shipped**, reviewed, 24 tests |
| `services/ScanNutritionService.mjs` — net weight, calories, macros | **shipped**, reviewed, 58 tests |
| `value-objects/Composition.mjs` — immutable slots | **shipped**, 62 tests |
| `3_applications/nutribot/CompositionStore.mjs` — per-scale state, window | **shipped**, 70 tests |
| Config: macros, 25 containers, validator | not started |
| `ApplyScanToComposition` use case | not started |
| Bridge integration: unit passthrough, session end, mutex | not started |
| `nutriscan` route wiring | not started |
| Memo (voice flow-state branch, Memo button) | not started |
| `QRSheetRenderer` + sheet endpoint | not started |

Nothing above is reachable from the running system yet — the domain layer is built but no
relay, bridge, or API path calls it.

---

## Known gaps — deliberate, do not silently "fix"

- **Backend restart loses the buffer** with no signal, and the bridge relearns the current load
  as baseline, so food already on the scale never posts.
- **Single-user attribution** — the bridge is wired to the head of household; every
  scan-enriched entry attributes to them regardless of who is cooking.
- **A product's own UPC does not work at the fridge.** `LogFoodFromUPC` exists and works, but
  the scanner is `route: content`, so a real barcode falls through to content dispatch. Wiring
  it is a separate feature.
- **An unknown container id currently produces a silent zero tare** — `computeNet` treats an
  absent container as "no tare." The lookup layer that would reject an orphaned id is not built
  yet, so a renamed container id orphans a laminated code without a visible error.
- **`unit` does not gate `complete`.** The buffer carries `ml` faithfully but nothing rejects
  it yet; that refusal belongs to `ApplyScanToComposition`.
- **Print legibility is untested.** Nothing verifies a QR printed 25-to-a-page scans off a
  fridge door in kitchen lighting. Print one and try it before laminating.

---

## Related

- [`docs/reference/barcode-scanning/README.md`](../barcode-scanning/README.md) — the scan
  ingest path. **Note:** that doc still describes `BarcodeScanService.handle`, which is retired;
  dispatch now goes through `triggerDispatchService.handleEvent`.
- [`docs/plans/2026-07-10-food-scale-relay-design.md`](../../plans/2026-07-10-food-scale-relay-design.md)
  — scale protocol and frame decoding.
- [`_extensions/food-scale-relay/README.md`](../../../_extensions/food-scale-relay/README.md)
  — firmware, flashing, and the existing nutribot bridge.
