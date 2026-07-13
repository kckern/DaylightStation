# Scale → Nutribot Density Logging — Design

**Date:** 2026-07-13
**Status:** Approved design, pending implementation plan
**Related:** `_extensions/food-scale-relay/`, `backend/src/3_applications/hardware/foodScaleRelay.mjs`, `backend/src/1_adapters/nutribot/NutribotInputRouter.mjs`

## Thesis

A BLE kitchen scale (`food-scale-relay`) already streams settled gram weights onto the
event bus. This feature turns each settled reading into a nutribot food-log entry whose
**quantity is exact** and whose only estimated variable is **caloric density (kcal/g)**.

This is the core value: it **shifts the guess from portion to density**.

- Portion-guessing error is *unbounded and multiplicative* — "was that 1 cup or 2?" is
  a 2× error, and humans are systematically bad at it. The current text logger even
  carries a `portionBoost` calibration hack (`LogFoodFromText` lines ~178–189) precisely
  because AI/human gram estimates run low.
- Density error is *bounded* — every food on earth sits between ~0.2 and ~9 kcal/g, and
  everyday meals cluster around 1–2.6. Even a rough density pick lands close.

Exact grams × a decent density beats a guessed portion × a looked-up density.

## Flow

```
scale settles ──food-scale topic──▶ ScaleNutribotBridge ──▶ LogFoodFromScale
   (gross g)       (event bus)         (resolve head→chat)      (pending NutriLog, gross g)
                                                                      │
                            gross > container threshold?  ────────────┤
                                   │yes                               │no
                                   ▼                                  │
                          "⚖️ 480 g — in a container?"                │
                          [🚫 None] [🍽 Plate −340] …                 │
                          callback 'st' → SelectScaleContainer        │
                          net = gross − container g                   │
                                   └──────────────┬───────────────────┘
                                                  ▼
                                    "⚖️ {net} g — what is it?"   (activeFlow: scale_describe)
                                          ┌───────┴───────────┐
                                          ▼                   ▼
                                  tap density level     type a description
                                  callback 'sd'         LogScaleFoodFromText
                                  SelectScaleDensity    AI estimates blended kcal/g
                                  cal = net × kcal/g[l] cal = net × AI kcal/g
                                          └───────┬───────────┘
                                                  ▼
                                    calories = netGrams × (kcal/g)
                                    ✅ Accept / ✏️ Revise / 🗑️ Discard (existing buttons)
```

Both resolution paths produce `calories = netGrams × (kcal/g)` — one density tapped from a
button, one estimated by AI from free text. Same model, two input methods. The container
(tare) step runs first when present, because net grams must be settled before calories.

## Components

### 1. `ScaleNutribotBridge` (application layer)

New module, sibling of `foodScaleRelay.mjs`. Subscribes the `food-scale` event-bus topic
(same pattern the persistence path already uses).

- **Trigger:** any `settled` payload. The relay already latches one settled event per
  settle cycle (re-arms on change/return-to-zero), so this is "once per thing you weigh,"
  not per frame. Button events are **ignored for now** (no-op in firmware payloads).
- **Target resolution:** the household **head** (`household.yml` → `head: kckern`) →
  `UserIdentityService.resolvePlatformId('telegram', head)` → platform chat id →
  conversationId. This reverse lookup already exists
  (`backend/src/2_domains/messaging/services/UserIdentityService.mjs:41`).
- On a settled reading, calls `LogFoodFromScale` with `{ userId: head, conversationId,
  grams, unit }`.

**No settle de-dup (v1).** Building a plate incrementally (rice settles at 200 g → add
chicken → settles at 350 g) produces two pending entries. Each is a cheap pending
`NutriLog` with a 🗑️ Discard button; the user discards intermediates. Collapsing rapid
successive settles is explicitly out of scope for v1.

### 2. `LogFoodFromScale` use case

Mirrors the structure of `LogFoodFromUPC` (the closest existing analog: known quantity,
inline keyboard to resolve an unknown).

- Creates a **pending `NutriLog`** with one placeholder item:
  `{ grams: grossGrams, label: 'Unknown', calories: 0, source: 'scale', unit: 'g' }`.
  The weight **appears as an entry immediately**, before resolution. `metadata` carries
  `source: 'scale'`, `scaleId`, and `grossGrams`.
- **Container gate:** if `grossGrams > containers.threshold_g` **and** containers are
  configured, posts the **container keyboard** first (see §3, tare). Otherwise posts the
  density keyboard directly (net = gross).
- Density-stage post: `⚖️ {net} g — what is it?` with the density inline keyboard (§5) and
  a caption nudge: *"Not sure? Just describe it and I'll estimate."* At this stage it sets
  conversation state `activeFlow: 'scale_describe'` + `flowState.pendingLogUuid` so a
  free-text reply routes back to this entry (path B).
- Persists `metadata.messageId` after posting (same as UPC flow) so buttons can be updated
  in place.

### 3. Tare / container subtraction (`SelectScaleContainer` use case)

A physical tare-zero only helps when you pour food in *after* zeroing; food already plated
needs software subtraction. So when the gross reading exceeds a configured threshold, the
user picks the container it sits in and its known weight is subtracted.

- **Config-driven container list** in `scales.yml` (§6): each `{ id, label, emoji, grams }`.
- Container keyboard: `🚫 None` (own row) + one button per container (rows of 3), labelled
  `{emoji} {label} −{grams}`. Callback action `'st'`, payload `{ id: logUuid, c: containerId }`
  (`c: 'none'` for the None button).
- `case 'st'` in the router → `SelectScaleContainer`:
  `net = max(1, grossGrams − containerGrams)` (guard: if the container weighs ≥ the gross
  reading, keep gross and log a warning); updates the pending item's `grams` to `net` and
  `metadata.containerId`/`metadata.containerGrams`; then **posts the density keyboard** for
  the net weight (transitioning into the density stage described in §2).
- `c: 'none'` → net = gross, straight to the density keyboard.

### 4. Path A — tap a density level (`SelectScaleDensity` use case)

- New callback action `'sd'` decoded as `{ id: logUuid, l: level }`.
- Router `handleCallback` adds `case 'sd'` → `container.getSelectScaleDensity()`.
- Use case: reads the pending log's (net) `grams`, `calories = round(grams × kcalPerGram[level])`,
  sets `label` from the level's label, clears `activeFlow`, then renders the standard
  ✅ Accept / ✏️ Revise / 🗑️ Discard row (reuse the existing accept/revise/discard callbacks
  unchanged).

### 5. Path B — describe it (`LogScaleFoodFromText` use case)

The description path must **not** reuse `LogFoodFromText`, whose prompt instructs the AI to
*"Estimate portion sizes in grams"* — the exact error source the scale eliminates — and
which carries unrelated complexity (revision mode, status indicators, date-pinning,
portionBoost). Instead a **dedicated `LogScaleFoodFromText` use case** does the narrow job:

- Reads the pending scale log's net `grams`.
- Calls `aiGateway.chat` with a **density-estimation prompt**: the grams are stated as
  *exact (from a scale)*; the AI returns only the **blended caloric density (kcal/g)** and
  macro-per-gram for the described dish, treated as a **single item** of that exact weight.
- `calories = round(grams × density)`; macros = `grams × macroPerGram`.
- No portion guessing, no portionBoost. The AI outputs a continuous kcal/g, so the text
  path is **not** bucketed to the 9 levels — the levels only shape the *tap* option.
- Updates the pending item, clears `activeFlow`, renders ✅ Accept / ✏️ Revise / 🗑️ Discard.

Router `handleText` gains a branch alongside the existing `revision` branch: when
`activeFlow === 'scale_describe'` and `flowState.pendingLogUuid` is set, route to
`container.getLogScaleFoodFromText()` against that pending log.

Examples:
- "lasagna" (350 g) → ~1.7 kcal/g → ~595 kcal.
- "beans and chickpeas with some seasoning and shredded cheese" (300 g) → AI blends the
  components → ~1.4 kcal/g → ~420 kcal.

### 6. Router touchpoints (`NutribotInputRouter.mjs`)

The router stays doing only what it does today (callbacks + text). The initial post is
bridge→use-case (like a job), **not** a synthetic input event.

- `handleCallback`: add `case 'st'` → `getSelectScaleContainer()` and `case 'sd'` →
  `getSelectScaleDensity()`.
- `handleText`: add the `scale_describe` branch alongside the existing `revision` branch,
  routing to `getLogScaleFoodFromText()`.

## Density model (non-linear, config-driven)

`level` is an ordinal; each maps to a calibrated **kcal/g**. Spacing is **non-linear** —
fine steps through the crowded 1.0–2.6 band where everyday meals live; coarse jumps in the
sparse fatty tail (nothing lives between ~6 and ~9 except concentrated fats).

| Lvl | Label | kcal/g | Step | Anchor foods |
|----|-------|--------|------|--------------|
| 1 🥬 | Watery    | ~0.2 | —    | greens, broth, celery, cucumber, watermelon |
| 2 🥗 | Light     | ~0.6 | +0.4 | veg, fruit, brothy soup, undressed salad, nonfat yogurt |
| 3 🍲 | Lean      | ~1.0 | +0.4 | stew, beans, potato, plain rice/pasta, eggs |
| 4 🍛 | Everyday  | ~1.4 | +0.4 | chili, chicken & rice, most mixed leftovers (mode) |
| 5 🍝 | Hearty    | ~1.9 | +0.5 | lasagna, fried rice, casserole, dressed salad w/ cheese |
| 6 🍕 | Filling   | ~2.6 | +0.7 | pizza, creamy pasta, sandwiches, burrito |
| 7 🧀 | Rich      | ~3.8 | +1.2 | cheese, cake, pastries, fatty meat |
| 8 🥜 | Very rich | ~6.0 | +2.2 | nuts, nut butter, bacon, chips, cookies |
| 9 🫒 | Pure fat  | ~8.5 | +2.5 | oil, butter, dressings |

- **Keyboard layout:** 9 buttons — a row of 5 (levels 1–5) + a row of 4 (levels 6–9).
  Button text: `{emoji} {label}` (e.g. `🍛 Everyday`). Anchor foods live in the message
  caption/help, not on the button.
- **Config location:** the level table (label + kcal/g + anchor list + emoji) lives in
  `scales.yml`, so labels, densities, and anchors are all tunable without code.

## Config schema (`data/household/config/scales.yml`)

A new `nutribot` block alongside the existing `scales`/`persistence` keys. All values are
optional; the loader (`scaleNutribotConfig.mjs`) supplies the defaults below so the feature
works before the real file is edited.

```yaml
nutribot:
  min_grams: 5              # ignore settled readings below this (noise / near-zero)
  containers:
    threshold_g: 150        # only offer container subtraction above this gross weight
    items:
      - { id: dinner-plate, label: "Dinner plate", emoji: "🍽", grams: 340 }
      - { id: dinner-bowl,  label: "Dinner bowl",  emoji: "🥣", grams: 250 }
      - { id: small-bowl,   label: "Small bowl",   emoji: "🍚", grams: 180 }
      - { id: mug,          label: "Mug",          emoji: "☕", grams: 350 }
  density_levels:           # ordinal, non-linear; kcal_per_g is the source of truth
    - { level: 1, label: "Watery",    emoji: "🥬", kcal_per_g: 0.2 }
    - { level: 2, label: "Light",     emoji: "🥗", kcal_per_g: 0.6 }
    - { level: 3, label: "Lean",      emoji: "🍲", kcal_per_g: 1.0 }
    - { level: 4, label: "Everyday",  emoji: "🍛", kcal_per_g: 1.4 }
    - { level: 5, label: "Hearty",    emoji: "🍝", kcal_per_g: 1.9 }
    - { level: 6, label: "Filling",   emoji: "🍕", kcal_per_g: 2.6 }
    - { level: 7, label: "Rich",      emoji: "🧀", kcal_per_g: 3.8 }
    - { level: 8, label: "Very rich", emoji: "🥜", kcal_per_g: 6.0 }
    - { level: 9, label: "Pure fat",  emoji: "🫒", kcal_per_g: 8.5 }
```

The target chat is **not** in this block — it is resolved at wiring time from
`configService.getHeadOfHousehold()`.

## Data model

The pending `NutriLog` carries `metadata.source: 'scale'` and `metadata.scaleId`. On
resolution:

- **Path A:** item gets `calories` (from `grams × kcal/g`), `label` from the level, and a
  `metadata.densityLevel`. Macros left `null` / `estimated` in v1.
- **Path B:** item gets `calories` + macros from the AI's per-gram estimates × grams.

Accept/Revise/Discard, daily report, and adjustment flows all operate on this `NutriLog`
unchanged.

## Scope decisions (v1)

- **Trigger:** any settled reading above `min_grams`. Button events ignored.
- **Target:** household head only (`configService.getHeadOfHousehold()`). Multi-user picker
  deferred.
- **Tare:** manual container selection from a configured list; offered only above
  `containers.threshold_g`. No auto-detection by weight.
- **Macros:** Path A stores calories only (macros null/estimated); Path B stores AI macros.
  A level-based macro split (fatty levels → more fat) is a future enhancement.
- **No settle de-dup:** intermediate weigh-ins create discardable pending entries.
- **Density levels** shape only the tap option; the AI text path outputs continuous kcal/g.

## Out of scope (future)

- Multi-user target resolution ("Who's this?" avatar picker before the density step).
- Scale button semantics (physical tare / cancel / confirm).
- Auto-detecting the container by matching known weights.
- Collapsing rapid successive settles into one entry.
- Level-based macro estimation for Path A.

## New/changed surfaces (summary)

| Layer | File | Change |
|-------|------|--------|
| Application | `scale/scaleNutribotConfig.mjs` (new) | Normalize `scales.yml` `nutribot` block; defaults for levels/containers/min_grams |
| Application | `usecases/LogFoodFromScale.mjs` (new) | Pending entry (gross g) + container-or-density keyboard + `scale_describe` state |
| Application | `usecases/SelectScaleContainer.mjs` (new) | `'st'` callback: subtract container g → post density keyboard |
| Application | `usecases/SelectScaleDensity.mjs` (new) | `'sd'` callback: `net × kcal/g[level]` → resolve entry |
| Application | `usecases/LogScaleFoodFromText.mjs` (new) | Describe path: AI blended kcal/g × net g → resolve entry |
| Application | `hardware/ScaleNutribotBridge.mjs` (new) | Subscribe `food-scale`, filter settled+min_grams, invoke `LogFoodFromScale` |
| Application | `NutribotContainer.mjs` (edit) | Register the four new use cases; accept `scaleConfig` |
| Composition | `bootstrap.mjs` `createNutribotServices` (edit) | Pass `scaleConfig`; expose container getters |
| Composition | `app.mjs` (edit) | Construct `ScaleNutribotBridge` with eventBus + resolved head conversationId |
| Adapter | `NutribotInputRouter.mjs` (edit) | `case 'st'` + `case 'sd'` in `handleCallback`; `scale_describe` branch in `handleText` |
| Config | `scales.yml` + `food-scale-relay/config.example.yml` | `nutribot` block (levels, containers, min_grams) |
