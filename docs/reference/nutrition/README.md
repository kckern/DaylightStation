# Nutrition — scan-enriched food logging

How a weight on the kitchen scale becomes a net-weighted, density-classified nutrition
entry, using a laminated QR sheet on the refrigerator instead of a tare button.

**Status: partially implemented, but the scan path is wired end to end.** The domain layer,
the composition store, the control grammar and the printable sheet are built, tested and
reachable: a code scanned on the kitchen relay reaches `barcode_relay.scan`, is claimed by the
nutrition grammar, and applies to the live composition. What is still missing is the bridge
integration, the memo flow and the `fd:` food grammar — and no code has yet been scanned off
printed ink rather than rendered pixels. See [Implementation status](#implementation-status)
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
  │ ct:<id> ×9   │  9 containers   │ SENSSUN FOOD   │
  │ rs:<verb> ×3 │  3 control      └───────┬────────┘
  └──────┬───────┘                         │ BLE notify 0xFFB2
         │ scanned                         ▼
         │                          ATOM Lite relay          [_extensions/kitchen-relay]
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
| `rs:clear` | discard the in-progress composition and start fresh — parses to `{kind:'reset'}` |
| `rs:undo` | take back the most recent scan |
| `rs:done` | the sequence is complete; process it now |

The `rs:` codes are the **control layer** — the punctuation of the grammar. Density and
container scans accumulate a composition; because they arrive as separate events over a time
window with no payload boundary, these three are the only way to say "start over", "take that
back", or "that's the whole intent". `CONTROL_VERBS` is the frozen vocabulary and
`encodeControl(verb)` the encoder; `RESET_CODE` remains exported and is exactly
`encodeControl('clear')`.

**`clear` parses to kind `reset`, not `clear`.** The asymmetry is deliberate and pinned by a
test: `ApplyScanToComposition` switches on `parsed.kind === 'reset'`, and renaming the kind to
match the verb would disable the one control code already in the field with no error anywhere.

### What each control code does

| Kind | Store call | Result shape |
|------|-----------|--------------|
| `reset` | `clear(scaleId)` | `{ok: true, kind: 'reset', hadState}` |
| `undo` | `undo(scaleId)` | `{ok: true, kind: 'undo', undone}` |
| `done` | `endPlacement(scaleId)` | `{ok: true, kind: 'done', hadState}` |

All three are `ok: true` even when they found nothing to act on — `ok: false` is a refusal and
paints a ⚠️ on the prompt, whereas a control scan that had no work still worked. The boolean
(`hadState` / `undone`) is what the ack renders.

**`done` routes to `endPlacement`, not to `clear`.** The two store methods are mechanically
identical today and kept separate because they mean different things: `clear` is "forget it",
`endPlacement` is "that placement is over, consume the slots". `done` is the human saying
"process it now", which is the same event the bridge raises when the scale returns to rest —
so it belongs on the `endPlacement` side. The result still reports `kind: 'done'` so the ack
never conflates it with a reset.

**Undo is one deep.** The setters overwrite, so rescanning already fixes a *wrong* slot;
`undo` exists for the fix rescanning cannot express — taking a slot back to empty. A second
consecutive `rs:undo` is a no-op rather than a deeper rewind, and `rs:clear` covers anything
more tangled. Undo refreshes the window (a person scanned a cell), does not resurrect a
`clear`/`done`, and has nothing to take back once the window has expired.

**Every kind is matched explicitly.** `ApplyScanToComposition` has no fall-through arm. A kind
the grammar produces with no handler here is refused by name (`UNHANDLED_SCAN_KIND`), still
`handled: true` so it cannot leak into the UPC product lookup. The container branch used to be
the implicit `else`, which made `rs:undo` and `rs:done` report as `UNKNOWN_CONTAINER`.

**Case-sensitive throughout.** `DL:4`, `CT:mug`, `RS:clear` and `ct:Dinner-Bowl` all return
`null`. A case-preserved id would miss its `containers.items` key and silently skip the tare,
producing a wrong-but-plausible calorie count rather than a visible error.

**The encoders validate and throw.** `encodeDensity` / `encodeContainer` / `encodeControl` reject anything
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

**The clamp is not decoration.** `gross < tare` is reachable whenever a container is scanned
against a nearly-empty dish, and the tare ladder rounds to the nearest 20 g, so the tare can
exceed the gross by a few grams legitimately. A negative net clamps to zero and sets
`clamped: true`; without it a silent 0 kcal entry would auto-accept into history.

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
window inherits the first food's density and tare. Weigh yogurt with `dl:2` + `ct:bowl`,
eat it, weigh pasta six minutes later without scanning, and the pasta logs as level-2 minus a
250 g bowl that isn't there — and auto-accepts. That is an ordinary evening, not an edge case.

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
[`_extensions/kitchen-relay/config.example.yml`](../../../_extensions/kitchen-relay/config.example.yml).

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
| `ApplyScanToComposition` use case | **shipped**, handles density/container/reset/undo/done |
| `nutriscan` route wiring (`5_composition/modules/scanDispatch.mjs`) | **shipped** |
| Control grammar `rs:clear|undo|done` + one-deep undo | **shipped** |
| `SheetLayout` / `QRSheetRenderer` / `SheetService` + `GET /api/v1/sheets/:id.pdf` | **shipped** |
| `npm run sheet` local generator | **shipped** |
| Config: real container table | **shipped** — weighed 2026-07-29, 13 vessels → 9 cards |
| Bridge integration: unit passthrough, session end, mutex | not started |
| Memo (voice flow-state branch, Memo button) | not started |
| Food grammar (`fd:` prefix) | not started — sheet prints foods as inert labels, if at all |

The scan path IS reachable end to end now: a code scanned on the kitchen relay reaches
`barcode_relay.scan`, is claimed by the nutrition grammar, and applies to the live
composition. What has NOT happened is a physical test — every verification so far has
decoded rendered pixels rather than ink under kitchen light.

**The tare weights are measured, and the table is a LADDER rather than an inventory.** Every
vessel went on the scale on 2026-07-29; the numbers were rounded to the nearest 20 g and
consolidated. Thirteen vessels produced only eight distinct tares, because eight of them fell
inside a single 55 g span (205–260 g). The size distinctions the first table carried — large
vs small glass, large vs small measuring cup, coloured vs white bowl — were fiction, since no
scan could tell those vessels apart, and the measuring cups turned out to be a second name for
the bowls' tare. Each such group is one card now.

The nine cards are ordered lightest-first, so the printed grid runs small tupperware at
top-left to dinner plate at bottom-right: **40, 60, 120, 200, 220, 250, 320, 440, 620 g**. Only
`mug` (120 g) is unweighed — it was added to fill the 60→200 g hole so the ladder has a rung
for light-but-not-tiny things, and it should go on the scale.

Rounding costs at most 10 g against the measurement, under 7% of the 150 g minimum gross
weight and well inside the spread between two nominally identical bowls. The ladder itself is
the guard: no rung is close enough to its neighbour for picking the wrong card to matter much.

**A tare the system does not recognise still fails silently**, which is why the ids matter more
than the grams — see the caveat below.

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
- [`_extensions/kitchen-relay/README.md`](../../../_extensions/kitchen-relay/README.md)
  — firmware, flashing, and the existing nutribot bridge.
