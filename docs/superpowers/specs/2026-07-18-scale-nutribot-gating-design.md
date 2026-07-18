# Scale→Nutribot gating: dedup, cleanup, and suspicion filter

**Date:** 2026-07-18
**Component:** `backend/src/3_applications/hardware/ScaleNutribotBridge.mjs`
**Status:** Design approved, ready for implementation plan

## Problem

The current bridge pushes a nutribot prompt for **every** distinct settled value and
the ESP button force-pushes **unconditionally**. In practice this is too trigger-happy
and produces three kinds of noise:

1. **Redundant force.** The button is meant as the tie-breaker for *ambiguous* cases,
   but it fires blindly — when auto already logged that weight a second ago, the button
   just makes a duplicate.
2. **Accumulated slop.** When a reading is superseded (weight changes) or abandoned
   (never answered), the earlier prompt lingers unanswered in Telegram. The bridge has
   no way to retract its own unanswered prompts.
3. **Suspicious auto-sends (shelf storage).** Putting the scale away on its side lands
   on a characteristic weight (~430 g) that auto-posts a phantom every time. Auto should
   judge whether a settle looks legitimate vs. suspicious and stay quiet on the
   suspicious ones — with the button as the deliberate override for when the user really
   does mean to log a heavy/odd item.

The unifying goal: replace "push everything" with a real decision flow — a dedup/edit
gate, a cleanup pass, and a suspicion filter — with the button as the trust-me escape
hatch that bypasses the suspicion filter.

## Approved decisions

- **Suspicion filter:** BOTH a known-weight band AND a behavioral heuristic. Button
  overrides either.
- **Cleanup:** BOTH supersede-while-loading (one live prompt follows the weight) AND a
  session-end sweep of any unanswered leftover. Answered/engaged prompts are never
  touched.
- **Smart force:** no-op if a live unanswered prompt already covers ~the current weight;
  otherwise post (override). The button only ever *adds* a prompt auto didn't.

## Per-scale state

```
{
  baseline:      number | null,   // learned idle/resting load
  lastGrams:     number | null,   // most recent frame (stable or not) for force-capture
  live:          { logUuid, messageId, grams } | null,  // the ONE current unanswered prompt
  legitPushes:   number,          // legit auto-posts in the CURRENT session
  lastSession:   { endedAt: number, pushCount: number } | null, // snapshot for the heuristic
}
```

Only ever one `live` prompt per scale at a time. Answering it (detected lazily via
`LogFoodFromScale`'s `isUntouched` check on the next settle) freezes it and clears
`live`, so the next distinct load starts a fresh prompt.

## Decision flow

For each bus payload for a scale `id`:

### Button (force)
`g = state.lastGrams`
- `g <= 0` → ignore (nothing on the scale; `scaleNutribot.force.noWeight`).
- `live` exists AND `|g - live.grams| <= force_tolerance_g` AND `live` still unanswered
  → **NO-OP** (already handled).
- else → **POST** a new prompt (bypasses the suspicion filter); set `live`.

Note: the "still unanswered" check is performed by attempting the same edit-in-place
path used during loading, or by a lightweight `isUntouched` read; if the prior live
prompt was answered, the button posts a fresh one.

### Scale reading
1. `g = round(payload.grams)`; if not finite → return. Set `state.lastGrams = g`
   (unconditionally — needed for force-capture even from unstable frames).
2. `payload.stable !== true` → return (auto acts only on settled frames).
3. `baseline === null` → learn `baseline = g`; return.
4. `rise = g - baseline`.
5. **Session end** — `rise <= baseline_tolerance_g` (removed / tare / jostle / back to rest):
   - if `live` exists and is unanswered → `RetractScaleLog(live)` (delete the message).
   - snapshot `lastSession = { endedAt: now(), pushCount: legitPushes }`.
   - `baseline = g`; `live = null`; `legitPushes = 0`.
   - return.
6. `g < min_grams` → return (floor).
7. **Loading (supersede)** — `live` exists:
   - `|g - live.grams| < dedup_delta_g` → return (same held value).
   - else **EDIT `live` in place** (`existingLogUuid = live.logUuid`):
     - edited (still unanswered) → `live.grams = g`.
     - touched (already answered) → `live = null`; fall through to New placement (8).
8. **New placement** — no `live`:
   - `rise < placement_delta_g` → return (too small a rise).
   - **SUSPICIOUS?** → SUPPRESS: log `scaleNutribot.suppressed` with the reason, do not
     post. return. (Button overrides.)
   - else → **POST** a new prompt; `live = it`; `legitPushes++`.

### Suspicious predicate
`suspicious(g, rise, now)` = either:
- **Storage band:** `storage_weight_g > 0` AND `|g - storage_weight_g| <= storage_tolerance_g`.
- **Jump-after-storm:** `lastSession != null`
  AND `now - lastSession.endedAt <= suspicion_window_sec * 1000`
  AND `lastSession.pushCount >= storm_min_pushes`
  AND `rise >= heavy_g`.

A lone placement with no recent busy session is always trusted.

## Cleanup use-case: `RetractScaleLog`

Reintroduces the operation the retired `ExpireScaleLog` performed, but **event-triggered
instead of timer-triggered**. Same body and same safety guard:

- `findByUuid(logUuid)`; if NOT `isUntouched` (i.e. the user picked a container/density,
  or it is no longer pending) → return `{ retracted: false }` — never clobber an engaged
  prompt.
- else → `updateStatus(userId, logUuid, 'rejected')`, clear conversation state if it
  points at this log, `deleteMessage(conversationId, messageId)` → `{ retracted: true }`.

Wired into `NutribotContainer` as `getRetractScaleLog()` (mirrors the other scale use
cases). The bridge calls it only in the session-end sweep. Supersede-while-loading uses
edit-in-place (no delete), so there is no delete churn during normal loading.

## Config knobs (`nutribot:` block of `scales.yml`)

All optional; defaults supplied by `normalizeScaleNutribotConfig`.

| Key | Default | Meaning |
|---|---|---|
| `storage_weight_g` | `0` (off) | known put-away weight; `0` disables the band |
| `storage_tolerance_g` | `15` | ± window around the storage weight |
| `suspicion_window_sec` | `90` | how recently the storm must have ended |
| `storm_min_pushes` | `2` | logs in the last session that constitute "a storm" |
| `heavy_g` | `300` | min rise for the jump-after-storm gate |
| `force_tolerance_g` | `10` | button no-ops within this of the live prompt |

Existing knobs unchanged: `min_grams`, `baseline_tolerance_g`, `placement_delta_g`,
`dedup_delta_g`.

## Testability

The bridge takes an injected `now()` (default `Date.now`) for the suspicion-window math,
mirroring the `setTimeoutFn`/`clearTimeoutFn` injection used previously. Unit tests drive
`now()` deterministically. No wall-clock timers are used (session end is event-driven,
not time-driven).

## Accepted trade-offs

- **False suppression is acceptable** because the button is a cheap override. E.g.
  weighing several recipe ingredients (a storm) and then placing the combined 500 g dish
  right after may be suppressed by jump-after-storm; one button press logs it.
- **Supersede uses edit-in-place**, so a loading session shows one prompt that updates in
  position (no new-message notification per intermediate settle). This refines the
  earlier "new message per distinct value" behavior now that pile-up is a known problem.
- **Session-end sweep deletes an unanswered live prompt**, so putting food on, getting a
  prompt, then removing it without answering cleans up rather than leaving slop. If you
  remove food only to return it, the prompt is re-posted on the next placement.

## Out of scope

- Orientation/motion sensing on the ESP (would make the suspicion filter unnecessary but
  is a hardware change).
- Differentiating short vs. long button press (any press = force).
- Persisting bridge state across backend restarts (state is in-memory; a restart
  re-learns the baseline from the next settle, as today).

## Affected files

- `backend/src/3_applications/hardware/ScaleNutribotBridge.mjs` — the flow.
- `backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs` — new knobs.
- `backend/src/3_applications/nutribot/usecases/RetractScaleLog.mjs` — new (mirrors old
  ExpireScaleLog body).
- `backend/src/3_applications/nutribot/NutribotContainer.mjs` — wire `getRetractScaleLog`.
- Tests: `ScaleNutribotBridge.test.mjs`, `scaleNutribotConfig.test.mjs`,
  `RetractScaleLog.test.mjs` (new).
- Docs: `_extensions/food-scale-relay/README.md`, `config.example.yml`.
