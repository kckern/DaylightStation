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
   (grams)         (event bus)         (resolve head→chat)      (pending NutriLog)
                                                                      │
                                          ┌───────────────────────────┤ posts "⚖️ 240 g — what is it?"
                                          ▼                           ▼
                                  tap density level            type a description
                                  callback 'sd'                (activeFlow: scale_describe)
                                  SelectScaleDensity           LogFoodFromText (knownGrams mode)
                                  cal = grams × kcal/g[lvl]    AI estimates blended kcal/g
                                          └───────────┬───────────────┘
                                                      ▼
                                          calories = grams × (kcal/g)
                                          ✅ Accept / ✏️ Revise / 🗑️ Discard (existing buttons)
```

Both resolution paths produce `calories = grams × (kcal/g)` — one density tapped from a
button, one estimated by AI from free text. Same model, two input methods.

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
  `{ grams, label: 'Unknown', calories: 0, source: 'scale', unit: 'g' }`.
  The weight **appears as an entry immediately**, before resolution.
- Posts `⚖️ {grams} g — what is it?` with the density inline keyboard (below) and a
  caption nudge: *"Not sure? Just describe it and I'll estimate."*
- Sets conversation state `activeFlow: 'scale_describe'` + `pendingLogUuid` so a
  free-text reply routes back to this pending entry (see path B).
- Persists `metadata.messageId` after posting (same as UPC flow) so buttons can be
  updated in place.

### 3. Path A — tap a density level (`SelectScaleDensity` use case)

- New callback action `'sd'` decoded as `{ id: logUuid, l: level }`.
- Router `handleCallback` adds `case 'sd'` → `container.getSelectScaleDensity()`.
- Use case: `calories = round(grams × kcalPerGram[level])`, sets `label` from the level's
  anchor/label, then renders the standard ✅ Accept / ✏️ Revise / 🗑️ Discard row (reuse
  the existing accept/revise/discard callbacks unchanged).

### 4. Path B — describe it (known-grams density mode)

The description path must **not** reuse `LogFoodFromText`'s default prompt verbatim,
because that prompt instructs the AI to *"Estimate portion sizes in grams"* — the exact
error source the scale eliminates.

Parameterize `LogFoodFromText` with a **`knownGrams` mode**:

- When `knownGrams` is set, the detection prompt is switched to **density estimation**:
  the grams are stated as *exact (from a scale)*; the AI estimates only the **blended
  caloric density (kcal/g)** and macro-per-gram of the described dish, and treats the
  whole described dish as a **single item** weighing exactly `knownGrams`.
- `calories = knownGrams × estimatedDensity`; macros = `knownGrams × macroPerGram`.
- The `portionBoost` calibration block is **skipped** in this mode (irrelevant when grams
  are known).
- The AI outputs a continuous kcal/g, so the text path is **not** bucketed to the 9
  levels — the non-linear levels only shape the *tap* option.

Router `handleText` gains a branch alongside the existing `revision` branch: when
`activeFlow === 'scale_describe'` and `pendingLogUuid` is set, route to
`LogFoodFromText` in `knownGrams` mode against that pending log.

Examples:
- "lasagna" (350 g) → ~1.7 kcal/g → ~595 kcal.
- "beans and chickpeas with some seasoning and shredded cheese" (300 g) → AI blends the
  components → ~1.4 kcal/g → ~420 kcal.

### 5. Router touchpoints (`NutribotInputRouter.mjs`)

The router stays doing only what it does today (callbacks + text). The initial post is
bridge→use-case (like a job), **not** a synthetic input event.

- `handleCallback`: add `case 'sd'` → `getSelectScaleDensity()`.
- `handleText`: add the `scale_describe` branch alongside the existing `revision` branch.

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

## Data model

The pending `NutriLog` carries `metadata.source: 'scale'` and `metadata.scaleId`. On
resolution:

- **Path A:** item gets `calories` (from `grams × kcal/g`), `label` from the level, and a
  `metadata.densityLevel`. Macros left `null` / `estimated` in v1.
- **Path B:** item gets `calories` + macros from the AI's per-gram estimates × grams.

Accept/Revise/Discard, daily report, and adjustment flows all operate on this `NutriLog`
unchanged.

## Scope decisions (v1)

- **Trigger:** any settled reading. Button events ignored.
- **Target:** household head only (`household.yml.head`). Multi-user picker deferred.
- **Macros:** Path A stores calories only (macros null/estimated); Path B stores AI macros.
  A level-based macro split (fatty levels → more fat) is a future enhancement.
- **No settle de-dup:** intermediate weigh-ins create discardable pending entries.
- **Density levels** shape only the tap option; the AI text path outputs continuous kcal/g.

## Out of scope (future)

- Multi-user target resolution ("Who's this?" avatar picker before the density step).
- Scale button semantics (tare / cancel / confirm).
- Collapsing rapid successive settles into one entry.
- Level-based macro estimation for Path A.

## New/changed surfaces (summary)

| Layer | File | Change |
|-------|------|--------|
| Application | `ScaleNutribotBridge.mjs` (new) | Subscribe `food-scale`, resolve head, invoke `LogFoodFromScale` |
| Application | `usecases/LogFoodFromScale.mjs` (new) | Pending entry + density keyboard + `scale_describe` state |
| Application | `usecases/SelectScaleDensity.mjs` (new) | `grams × kcal/g[level]` → resolve entry |
| Application | `usecases/LogFoodFromText.mjs` (edit) | `knownGrams` mode: density-estimation prompt, single item, skip portionBoost |
| Application | `NutribotContainer.mjs` (edit) | Register new use cases + bridge wiring |
| Adapter | `NutribotInputRouter.mjs` (edit) | `case 'sd'` in `handleCallback`; `scale_describe` branch in `handleText` |
| Config | `data/household/config/scales.yml` (edit) | Density level table + `nutribot` target (head) |
