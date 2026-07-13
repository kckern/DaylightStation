# Scale→Nutribot: spam guardrails + slim keyboard controls

**Date:** 2026-07-13
**Status:** Draft for review
**Builds on:** `2026-07-13-scale-nutribot-density-logging-design.md`

## Problem

Two problems surfaced in live use of the food-scale → nutribot Telegram flow:

1. **Message spam.** One weighing session produces a stack of orphaned prompts, each
   with its own pending `NutriLog`. Root cause is in `ScaleNutribotBridge.mjs`: it fires
   one `LogFoodFromScale` per "settle cycle" and re-arms its latch on **any** non-settled
   frame:

   ```js
   const settled = payload.stable === true && Number.isFinite(grams) && grams >= minGrams;
   if (!settled) { latched.set(id, false); return; } // re-arm on change / near-zero
   ```

   "Not settled" includes a transient wobble while food is still on the scale (a bump, a
   lean on the counter, adding a spoonful). Each wobble→re-settle fires a brand-new
   message + pending log. The relay streams ~4 Hz continuously, so there is ample wobble.

2. **No user controls on the prompt.** There is no way to cancel/dismiss a prompt, and no
   inline help explaining the nine density levels. The keyboard is also rows-of-5, not the
   desired compact grid.

## Goals

- Kill the spam: one live prompt per item on the scale, regardless of bumps/wobble.
- Slim, glanceable prompt: just the grams and a 3×3 numbered density grid.
- Add Cancel (silent dismiss) and Help (expand the legend) controls.
- Container becomes a button, not a leading question.

Non-goals: reworking the density model, container subtraction math, or the describe
(free-text) path — all keep working as-is.

## Design decisions (chosen; open to revision on review)

| Fork | Choice | Why |
|------|--------|-----|
| Anti-spam model | **Edit-in-place** | One prompt per item; weight changes edit the same message. "Freeze grams" would strand gradual (spoon-by-spoon) plating at the first settle. |
| Density labels | **Number + emoji** (`1 🥬` … `9 🫒`) | Slim, fits 3-across, keeps a visual hint. Words + kcal/g move to Help. |
| Container | **Always density-first** | Container is one of the 3 bottom-row buttons; drops the "gross > threshold → ask container first" branch. Matches "keep logging slim". |
| Help | **Toggle** (Help ⇄ Back), grid stays | Same keyboard remains tappable while the legend is shown. |
| Cancel | **Silent** delete + discard | Message disappears, pending log deleted, no confirmation chatter. |

## Keyboard layout (4 rows × 3)

```
⚖️ 340 g
[1 🥬][2 🥗][3 🍲]
[4 🍛][5 🍝][6 🍕]
[7 🧀][8 🥜][9 🫒]
[📦 Container][❓ Help][❌ Cancel]
```

Slim prompt text: `⚖️ {grams} g`. (Drops the current verbose "what is it? Tap a density
level, or just describe it…".) The describe/free-text path stays armed silently, so the
user can still type a description instead of tapping.

Help expands the text in place (keyboard unchanged) to the legend, and swaps the Help
button to `⬅️ Back`:

```
⚖️ 340 g — tap a level or describe it

1 🥬 Watery · ~0.2 kcal/g   (broth, greens)
2 🥗 Light · 0.6            (salad, fruit)
3 🍲 Lean · 1.0             (soup, lean meat)
4 🍛 Everyday · 1.4         (rice + veg + protein)
5 🍝 Hearty · 1.9           (pasta, casserole)
6 🍕 Filling · 2.6          (pizza, fried)
7 🧀 Rich · 3.8             (cheese, creamy)
8 🥜 Very rich · 6.0        (nuts, nut butter)
9 🫒 Pure fat · 8.5         (oil, butter)
```

`⬅️ Back` returns to the slim text. Example-food hints are a new optional `hint` field on
each density level with the defaults above.

## Component changes

### 1. `ScaleNutribotBridge.mjs` — the core anti-spam fix

Replace the boolean latch with a small per-scale state machine. Ignore wobble; re-arm only
when the scale returns to empty; dedup same-weight re-settles; edit on meaningful change.

Per-scale state: `{ activeLogUuid, activeMessageId, lastActedGrams }` (absent = empty/armed).

Per-frame logic (grams = round(payload.grams), stable = payload.stable === true):

- **Near-empty** (`grams < minGrams`): item removed → clear state (re-arm). Return.
  *(This is the key: a bump keeps grams well above minGrams, so it never re-arms.)*
- **Not stable** (wobble while loaded): return, no-op. *(Kills bump spam.)*
- **Stable & loaded:**
  - No active prompt (first settle of a new item) → dispatch `LogFoodFromScale.execute`
    (create). Store `{activeLogUuid, activeMessageId, lastActedGrams=grams}`.
  - Active prompt AND `|grams − lastActedGrams| ≥ editDeltaG` (default 3 g) → dispatch
    `LogFoodFromScale.execute` in **edit mode** (pass `activeLogUuid` + `activeMessageId`).
    Update `lastActedGrams`.
  - Otherwise (same-weight re-settle) → no-op. *(Kills duplicate prompts.)*

New config knobs (with defaults, in the `nutribot` block of the household `scales` config):
`edit_delta_g` (3), reuse existing `min_grams` (5) as the near-empty threshold.

### 2. `LogFoodFromScale.mjs` — create-or-edit (idempotent)

Accept optional `existingLogUuid` + `messageId`. Behavior:

- **Edit mode** given and the log is still `status === 'pending'`: `updateMessage` the
  prompt text to the new `⚖️ {grams} g` and update the log's `grossGrams`/item grams.
  Do **not** create a new log. Return the same `{logUuid, messageId, stage:'density'}`.
- **Edit mode but the log is gone or no longer `pending`** (user already tapped a level, or
  cancelled): fall through to create a fresh prompt (returns new ids; bridge adopts them).
  This prevents clobbering an already-answered/confirmed message.
- **No edit mode** (normal): create as today, but always density-first (remove the
  `useContainer` threshold branch) and always arm `scale_describe`.

The `status === 'pending'` check (already used by `SelectScaleDensity`) is the safe
"un-actioned" signal — no new state store needed, and no cross-layer signaling from the
button handlers back to the bridge.

### 3. `scaleNutribotConfig.mjs` — keyboard builders + text

- `buildDensityKeyboard`: `chunk(buttons, 3)`; button text `${l.level} ${l.emoji}`;
  append the 3-button control row `[📦 Container | ❓ Help | ❌ Cancel]`.
  - Container: existing `st` show-mode (`encodeCallback('st', { id })`).
  - Help: new `encodeCallback('sh', { id, h: 1 })`; Back is `sh` with `h: 0`.
  - Cancel: new `encodeCallback('sx', { id })`.
- `densityPromptText(grams)` → slim `⚖️ {grams} g`.
- New `densityHelpText(cfg, grams)` → the legend block above.
- Add optional `hint` to `DEFAULT_DENSITY_LEVELS` + `normalizeScaleNutribotConfig`.

### 4. New use cases

- **`ShowScaleDensityHelp`** (`sh`): `updateMessage` the prompt text between slim and
  legend based on `h`, rebuilding the keyboard with the toggled Help/Back button. Pure
  presentation; touches no log data. Log must still be `pending`.
- **`CancelScaleLog`** (`sx`): `deleteMessage(messageId)`, delete the pending `NutriLog`,
  clear any `scale_describe` conversation state. No confirmation message. If the log is
  already non-pending, just delete the message.

### 5. `NutribotInputRouter.mjs` — routing

Add `case 'sh'` → `getShowScaleDensityHelp()` and `case 'sx'` → `getCancelScaleLog()`,
alongside existing `sd`/`st`. Both read `decoded.id` (+ `decoded.h` for help). Register the
two new use cases in `NutribotContainer`.

## Flow after the change

```
Plate food on scale
  → settles at 210 g  → ⚖️ 210 g prompt (3×3 grid + controls)
  → add more, settles at 340 g (Δ ≥ 3 g) → SAME message edits to ⚖️ 340 g
  → bump the scale (wobble, ~340 g) → ignored, no new message
  → tap "5 🍝"        → log resolves to Hearty · 646 kcal, Accept/Revise/Discard
  → remove plate      → bridge re-arms for the next item
Alternatively:
  → tap "❌ Cancel"   → message vanishes, pending log deleted
  → tap "❓ Help"      → text expands to the legend; "⬅️ Back" collapses it
```

## Known edges (accepted)

- **Adding food to an already-answered plate** (tapped a level, then piled more on without
  removing): the bridge sees a pending→resolved log, so the edit falls through to a *new*
  prompt for the new total. The old resolved log remains (user can Discard it). Rare; the
  normal order is weigh → answer → remove.
- **Cancel while the plate stays on the scale:** state is cleared; a same-weight re-settle
  is Δ≈0 so no immediate re-prompt. Changing the weight (or removing + re-adding) starts a
  fresh prompt. Acceptable.
- **Telegram edit rate:** edits only fire on Δ ≥ `edit_delta_g` at a fresh stable reading,
  so at most a handful per plating — well under rate limits.

## Testing

Unit tests mirror the existing suite:

- `ScaleNutribotBridge.test.mjs`: wobble-while-loaded → no dispatch; same-weight re-settle
  → no dispatch; Δ ≥ threshold → edit dispatch (carries `existingLogUuid`); near-empty →
  re-arm → next settle creates.
- `LogFoodFromScale.test.mjs`: edit mode on `pending` log edits (no new log); edit mode on
  non-pending/missing log creates fresh; create path is always density-first + arms
  describe.
- `scaleNutribotConfig.test.mjs`: 3×3 chunking; control row present with `sh`/`sx`/`st`
  callbacks; slim vs help text; `hint` normalization + defaults.
- New `ShowScaleDensityHelp` / `CancelScaleLog` tests: toggle text/keyboard; delete
  message + delete log + clear state.
- `NutribotInputRouterScale.test.mjs`: `sh`/`sx` route to the right use cases.

## Rollout

Standard: build → confirm no active fitness session / video playing → `sudo
deploy-daylight`. No garage kiosk reload needed (Telegram-only, no frontend bundle).
