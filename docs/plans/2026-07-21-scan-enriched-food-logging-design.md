# Scan-enriched food logging — design

**Date:** 2026-07-21
**Status:** design agreed (rev 2, post-review), not implemented
**Related:** `_extensions/food-scale-relay/`, `_extensions/content-barcode-relay/`,
`docs/plans/2026-07-10-food-scale-relay-design.md`

> Rev 2 supersedes an earlier draft that asserted a retired dispatch chain, overloaded an
> existing `route` value, redesigned an already-shipped memo path, and proposed a
> characterization test on non-deterministic PDF output. Those are corrected below.

## Problem

The BLE kitchen scale and the BLE barcode scanner share an ATOM Lite and an event bus,
but nothing else. The scale reports a **gross** weight; nutribot then guesses everything
about the food from that one number. Getting a true net weight today means tare
gymnastics at the scale or decanting food into a second container, so in practice it
doesn't happen.

The result: the one fact a scale is good at — a precise gram measurement — never
survives to the nutrition entry.

## Approach

A laminated QR sheet on the refrigerator carries three banks of codes:

- **9 density codes** — the levels already in `scales.yml` (Watery → Oil, 0.2 → 8.5 kcal/g)
- **~25 container codes** — kitchen containers with known tare weights
- **1 reset code**

Scanning a density and a container turns a gross weight into a net weight and a calorie
figure without touching a tare button. An optional memo afterwards lets the LLM fill in
composition, constrained by a measurement it may not revise.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | No container scan ⇒ gross treated as net, flagged `tared: false` | Assume pre-tared or no container; a later container scan still corrects it |
| D2 | Composition buffer, order-independent, rolling window (default 900 s) | Scans may precede or follow the weight |
| D3 | Self-describing payloads: `dl:<1-9>`, `ct:<id>`, `rs:clear` | Device `route` is per-scanner, so prefix is the only discriminator |
| D4 | **Conditional** auto-accept: accept only when weight **and** density are both present; weight-only stays `pending` on the existing Accept/Revise/Discard flow | A scan is an explicit human assertion; a bare placement is the scale noticing something. Costs no new use cases and keeps phantom placements out of history |
| D5 | Density macro baselines hand-authored from representative foods | Transparent, auditable, no circularity from density-estimated history |
| D6 | Container inventory ships as ~25 labelled placeholders with fake weights | Real weights measured later |
| D7 | Scan-driven tare ignores `containers.threshold_g` | Scanning a container code is explicit intent |
| D8 | Extract a **pure** tiling function, golden-test that; do not characterization-test `catalog.mjs` | pdfkit output is not byte-stable (see below) |
| D9 | New route value `nutriscan`, **not** `nutribot` | `route === 'nutribot'` already means "food UPC" in `app.mjs` |
| D10 | Buffer slots are **consumed** at placement end | Prevents the second food of the evening inheriting the first's density and tare |

## Architecture

### Scan fork

`backend/src/3_applications/hardware/barcodeRelay.mjs` broadcasts every scan on the
`barcode-relay` topic and hands it to `onScan`. In `app.mjs` (~line 2340) `onScan`
already branches:

- `route === 'nutribot'` → `LogFoodFromUPC` (the code is treated as a **food UPC**)
- otherwise → `TriggerEvent.create(...)` → `triggerDispatchService.handleEvent`
  (**`BarcodeScanService` is retired** — do not design against it)

A new domain module — `backend/src/2_domains/nutrition/ScanVocabulary.mjs` — parses a
code into a nutrition command or `null`. `barcodeRelay` consults it first:

- parse hit → set **`route: 'nutriscan'`** on the broadcast payload, dispatch to the
  nutrition scan handler
- parse miss → fall through unchanged

`nutriscan` is a **distinct** value. Overloading `nutribot` would mean one route with
two semantics in the broadcast payload and the persisted day-log, and a `dl:3` reaching
the existing branch would perform a UPC lookup on the literal string `dl:3`.

The vocabulary lives in a domain module because the **sheet generator imports the same
module** to emit exactly the strings the parser accepts. One module owns the grammar;
otherwise sheet and parser drift and a fridge QR resolves as a content trigger.

Note: content QR payloads are *also* a colon grammar (`screen:contentId`, `volume:5` —
see `BarcodeCommandMap.mjs`). `dl`/`ct`/`rs` collide with nothing today, but the two
grammars share one namespace with no registry. `ScanVocabulary` must document this and
reject unknown prefixes rather than claiming them.

### Composition buffer

Per-scale buffer with three slots — `grams` / `density` / `container` — filled by
whichever event arrives, in any order, within a rolling window.

**Slot lifecycle (D10).** Slots are consumed and cleared when the bridge's existing
session-end fires (`rise <= baselineTolG` in `ScaleNutribotBridge`, ~line 120), and on
post. Without this, weighing yogurt with `dl:2 ct:small-bowl`, then pasta six minutes
later without scanning, silently applies level-2 density and a 180 g tare to the pasta.
That is an ordinary evening, not an edge case, and it must be in the tests.

**Window refresh set** is `{vocabulary scans, qualifying placements}` — explicitly
**not** raw scale frames. The firmware heartbeats at 0.5 Hz continuously while the scale
rests on its shelf; if frames refreshed the window it would never expire.

**Posting.** The buffer posts once `grams` is present. Per D4:

- `grams` + `density` → compute, post, and **accept** (`AcceptFoodLog`)
- `grams` alone → post as `pending` with the existing density/container keyboard,
  exactly as today

Scans arriving before a weight sit in the buffer; nothing posts because there is nothing
to post. Scans after a weight revise in place.

**Interaction with `#isUntouched`.** Both `LogFoodFromScale` and `RetractScaleLog` gate
on `status === 'pending' && metadata.source === 'scale' && containerId == null &&
densityLevel == null`. Once a scan sets `densityLevel`, edit-in-place and retraction
both correctly refuse — which is why D4 accepts at that point rather than leaving a
touched-but-pending record the bridge will keep re-posting. Scan-driven density reuses
`SelectScaleDensity`'s math (it requires `status === 'pending'`, so it runs **before**
accept), then `AcceptFoodLog`.

**Concurrency.** Weights arrive via `eventBus.subscribe` → bridge `onPayload`, guarded by
the bridge's `inflight` Set. Scans arrive via `eventBus.onClientMessage` → `barcodeRelay`
→ `onScan` — a separate path that never touches `inflight`. The buffer needs an explicit
per-scale serialization primitive shared by both paths, or a density scan landing during
an awaited `create()` produces two concurrent read-modify-writes on the same food log and
two racing edits on the same Telegram message.

### Reset

`rs:clear` clears the buffer and retracts the entry **when it is still retractable**
(`RetractScaleLog` refuses anything not pending-and-untouched). Under D4 an accepted
entry is discarded via the existing `DiscardFoodLog` instead — no new use case needed.
Outside the window it is a no-op with a "nothing to clear" ack.

Named `rs:` rather than `ctl:` so no prefix is a near-twin of `ct:`.

### PDF sheet

Reused, not rebuilt:

- `backend/src/1_rendering/qrcode/QRCodeRenderer.mjs` — `createQRCodeRenderer().renderSvg(data, { label, sublabel })`,
  framed SVG QR, error correction `H`, themed in `qrcodeTheme.mjs`.
- `backend/src/4_api/v1/routers/catalog.mjs` — tiles QR SVGs into a paginated US Letter
  PDF via `pdfkit` + `svg-to-pdfkit`. (It *does* rasterize embedded cover art via Resvg in
  `convertEmbeddedSvgsToPng`; our sheet has no embedded images and stays fully vector.)

Two mismatches: `catalog.mjs` calls its own API over internal HTTP (call the renderer
in-process instead), and its grid is hardcoded `COLS = 3, ROWS = 5`. The fridge sheet
needs **two sections of differing geometry on one page** — nine large density codes, then
twenty-five small container codes.

**D8 — refactor safety.** pdfkit sets `CreationDate: new Date()`, derives the trailer
`/ID` from an md5 over the info dict, and embeds `CreateDate` in XMP. `catalog.mjs`
overrides none of it, and its output further depends on live internal HTTP and
network-fetched thumbnails. **Output is not byte-stable**, so a characterization test
pins nothing.

Instead: extract the tiling math into a **pure function** in
`backend/src/1_rendering/pdf/QRSheetRenderer.mjs` — `layoutSections([{ title, cols, rows, items }])`
→ an array of `{ page, x, y, width, height }` placements — and golden-test *that*. The
PDF-emitting wrapper stays thin and untested. `catalog.mjs` is then rewritten to call the
same pure function, and its correctness is verified by eyeball on one generated PDF, which
is honest about what that check is worth.

## Config

Extends the existing `nutribot:` block of `data/household/config/scales.yml`. Density
levels gain a `macros` block expressed as **percent of calories**:

```yaml
- level: 9
  label: "Oil"
  emoji: "🫒"
  kcal_per_g: 8.5
  macros:   { fat_pct: 98, carb_pct: 1, protein_pct: 1 }
  per_100g: { fiber_g: 0, sugar_g: 0, sodium_mg: 2 }
```

Percentages must sum to 100, making the hand-authored table self-validating. **The
validator must reject, not drop** — `normalizeScaleNutribotConfig` currently discards
malformed entries, which would make a typo'd level vanish from both the keyboard and the
printed sheet with no error.

New knobs: `buffer_window_sec` (default 900) and a `sheet:` block (title, sections, cell
counts).

### Math

```
net_g  = max(0, gross_g − (container ? container.grams : 0))
kcal   = net_g × level.kcal_per_g
fat_g     = kcal × fat_pct/100     ÷ 9
carb_g    = kcal × carb_pct/100    ÷ 4
protein_g = kcal × protein_pct/100 ÷ 4
```

The `max(0, …)` clamp is required, not decorative: with D6's placeholder tare weights,
`gross < tare` is guaranteed during the fill-in period. A clamped-to-zero net must also
flag the entry rather than logging a silent 0 kcal.

### Units — the ml path

`config.example.yml` declares `units: { 0x00: g, 0x02: ml }` and `foodScaleRelay`
broadcasts `unit` faithfully, but `ScaleNutribotBridge` **drops it and hardcodes
`unit: 'g'`** (~line 50). Gram-denominated tares and `kcal_per_g` are wrong for an ml
reading of anything not water-density.

The buffer must carry `unit` through. An `ml` reading is either converted via an optional
per-density `g_per_ml` or refused with a "switch the scale to grams" prompt — refusing is
the safer v1. Silently treating ml as g, which is today's behaviour, is not acceptable
once entries auto-accept.

## Entry lifecycle and memo

Per D4, a complete buffer accepts immediately; a weight-only placement stays pending on
the existing keyboard. Either way the message carries a **Memo** button alongside the
existing density and container buttons (which remain the fallback for when the user is
not at the fridge).

**The memo path largely exists and must be extended, not rebuilt:**

- `LogScaleFoodFromText` already implements the constrained revision — exact grams held
  fixed, model estimates the rest. The memo reuses it.
- Voice transcription is **fully wired**: `TelegramVoiceTranscriptionService` (Whisper via
  the shared OpenAI gateway) → `TelegramAdapter.transcribeVoice` → `LogFoodFromVoice`.
- The gap: `NutribotInputRouter.handleVoice` ignores conversation state, so every voice
  note becomes a **new** food log. Text already routes on flow state
  (`scale_describe` → `LogScaleFoodFromText`). **Voice needs the same branch added** —
  that is the whole of the voice memo work.

The revision prompt holds the measurement fixed and treats the asserted density as a
strong prior, deviating only if the description is flatly incompatible with it. A failed
LLM call leaves the entry untouched and warns; a failed memo never costs the measurement.

## Persistence

- **Raw scale readings** — `household/history/nutrition/<scale-id>/<date>.yml`, untouched.
- **Every scan** — `household/history/barcode/<device>/<date>.yml`, *including*
  nutrition-routed ones. Excluding them would hole the audit trail exactly where you'd
  look when a meal logged wrong.
- **The food log** — nutribot's existing record, gaining `net_g`, `gross_g`,
  `container_id`, `density_level`, `tared`, `unit`, `memo`, `revised_at`, and
  `source: scale+scan` provenance so measured entries stay distinguishable from estimated.

## Operational realities

- **Backend restart** loses the in-memory buffer with no signal. Worse, existing
  behaviour: the bridge learns the *current* load as baseline on start, so food already
  on the scale never posts. Accept this; document it.
- **Config is cached at startup.** Filling in D6's real container weights does nothing
  until a restart. The measure-and-iterate loop D6 prescribes will trip on this.
- **Unknown `ct:`/`dl:` id** — a laminated sheet outlives config edits for *labels* but
  not for *ids*. Renaming a container id orphans a printed code. The handler must ack the
  scan as unrecognized rather than fail silently; this is where every stale-sheet bug lands.
- **Sheet lifecycle** — needs a generation endpoint and a version stamp printed on the
  page, so a sheet on the fridge can be matched to the config that produced it.
- **Attribution** — the bridge is wired to exactly one user (head of household). Every
  scan-enriched entry attributes to KC regardless of who is cooking. Chosen, not overlooked.
- **UPC at the fridge is *not* covered.** `LogFoodFromUPC` works, but the scanner is
  `route: content`, so a real product barcode falls through to content dispatch. A
  scan-at-the-fridge feature that can't log a yogurt tub is a day-one surprise. Out of
  scope here; worth its own follow-up.

## Testing

The buffer's correctness claim is **order independence**, tested directly: all six
orderings of (weight, density, container) converge on an identical entry. Plus:

- **two sequential placements in one window** (the D10 case) — second food must not
  inherit the first's slots
- weight alone → stays pending; weight + density → accepts
- scans that never receive a weight and expire
- `rs:clear` before posting, after posting-pending, after accept, and outside the window
- window refresh across a slow sequence; heartbeat frames must **not** refresh it
- stale scan after expiry landing nowhere
- `gross < tare` → clamped and flagged
- `unit: 'ml'` → refused, not silently logged as grams
- a scan arriving during an in-flight `create()` (the concurrency case)

`ScanVocabulary` unit tests, including the case that matters most: **a real UPC parses as
`null`** and falls through unchanged. (Verified safe on both transports — UPC/EAN are
digit-only; the content-barcode firmware's `hidToChar` does map usage `0x33`+shift to
`':'`, and the DS6878 SPP path carries raw decoded bytes with no keymap.)

Nutrition math gets a table test against hand-computed values. Config validation gets a
test that macro percentages not summing to 100 are **rejected with an error**, not dropped.
`layoutSections` gets a golden test.

## Open items

- **Print legibility gate** — nothing tests whether a QR printed 25-to-a-page scans off a
  fridge door in kitchen lighting. Print one page and try it before laminating.
- **Container weights** — the 25 shipped entries carry placeholders; real weights must be
  measured before the feature is trustworthy, and the backend restarted after each edit.
- **Container keyboard** — 25 containers renders ~9 rows at 3 per row in
  `buildContainerKeyboard`. Usability, not correctness, but it will feel bad.
