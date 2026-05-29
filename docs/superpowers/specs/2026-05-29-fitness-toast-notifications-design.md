# FitnessToast — Ephemeral Centered Notifications — Design

**Date:** 2026-05-29
**Status:** Approved (design); ready for implementation plan
**Author:** KC Kern + Claude

## Problem

The fitness video view has rich, state-driven overlays (challenge deck, governance
state, voice memo) but no way to surface a brief, transient notification — a message
that appears, is read at a glance, and disappears on its own. The first need is
**rider assignment**: when someone claims a bike via the Garage Cycling Selector
(`rider_select`), the screen should briefly announce who is now riding. Today the claim
updates state silently (avatar swap + governance) with no momentary callout.

## Goals

- A reusable `FitnessToast` component for short-duration, centered, self-dismissing
  notifications in the video view.
- A generic push API the toast doesn't couple to any specific feature; rider assignment
  is just the first caller.
- First use case wired: a `rider_select` event shows a toast naming the rider and bike.

## Non-goals (v1)

- FIFO queueing / stacking multiple toasts (we use latest-wins, single slot).
- Manual dismiss interaction (kiosk auto-hides; no tap-to-close).
- Sound or haptics.
- Any non-rider producers (the API supports them; none wired in v1).

## Decisions (locked during brainstorming)

1. **Latest-wins, single slot.** At most one toast shows at a time. A new toast
   immediately replaces the current one and resets the countdown. No real queue.
2. **Content model:** `{ id, avatarUrl?, icon?, title, subtitle?, durationMs, variant }`.
   A countdown progress bar is always shown.
3. **Default duration ≈ 4000 ms**, overridable per toast via `durationMs`.
4. **Exit animation:** fade + collapse (as the toast auto-hides).
5. **Owned by `FitnessContext`**, rendered in `FitnessPlayerOverlay`, triggered from the
   existing WS topic-dispatch — mirroring the established `voiceMemoOverlayState` pattern
   and the existing `data.topic` branching (`'vibration'`, `'force_break'`).
6. **Non-blocking:** the toast does not pause the video and does not gate governance; it
   renders above the other overlays.

## Architecture

### State & API — `FitnessContext`

Add a single-slot toast to the context (mirrors `voiceMemoOverlayState`):

- State: `fitnessToast` — `null | { id, avatarUrl?, icon?, title, subtitle?, durationMs, variant }`.
- `pushFitnessToast(toast)` — assigns a fresh monotonic `id` and replaces the slot
  (latest-wins; the new `id` re-triggers the component's animation + countdown).
  Applies the default `durationMs` (4000) and default `variant` (`'info'`) when omitted.
- `dismissFitnessToast(id)` — clears the slot **only if** the current toast's `id` matches
  (id-guard: a stale exit timer cannot clear a newer toast that already replaced it).
- All three exposed through the context value, alongside the existing overlay state.

The toast is **generic** — it has no knowledge of riders. Feature-specific payloads are
built by callers.

### Component — `FitnessToast.jsx` (new, `frontend/src/modules/Fitness/player/overlays/`)

- Presentational + self-contained timer. Props: `toast` (the slot value) and
  `onDone(id)` (calls `dismissFitnessToast`).
- Renders nothing when `toast` is null.
- Centered in the video view (same positioning approach as the overlay deck), high
  z-index so it sits **above** other overlays; non-blocking (no pointer capture, no
  video pause).
- Layout: avatar (`avatarUrl`) or `icon` + `title` + optional `subtitle`, plus a
  **countdown progress bar** that depletes over `durationMs`. `variant` drives the accent
  color.
- Lifecycle keyed on `toast.id`: on a new id, (re)start the countdown from full; when it
  completes, play the **fade + collapse** exit, then call `onDone(toast.id)`. A new id
  arriving mid-flight cancels the in-flight timer/animation and restarts cleanly. Timers
  are cleared on unmount.
- Has its own `.scss` (countdown bar, fade/collapse transitions, variant colors), styled
  consistently with the existing overlays.

### Mount — `FitnessPlayerOverlay.jsx`

Render alongside the existing overlays:

```jsx
<FitnessToast toast={fitnessCtx.fitnessToast} onDone={fitnessCtx.dismissFitnessToast} />
```

It self-gates on a null toast, so no extra conditional is needed at the mount site.

### First use case — rider assignment

The `rider_select` WS event already flows into `FitnessContext`'s subscription callback
(it is in the subscribe filter and reaches `session.ingestData(data)`, which sets the
claim via the device router). We add a **parallel, additive** toast push — it does NOT
replace or short-circuit the existing `ingestData` call (the claim still must be set).

- A pure helper `buildRiderToast(data, fitnessConfiguration)` (new, small, unit-testable)
  maps `{ userId, equipmentId }` →
  `{ avatarUrl: '/api/v1/static/img/users/' + userId, title: <user display name>,
     subtitle: 'is riding the ' + <equipment name>, variant: 'success' }`.
  Display names resolve from `fitnessConfiguration` (users / equipment), falling back to
  the raw id when not found.
- In the WS dispatch, immediately before `session.ingestData(data)`, add:
  `if (data?.topic === 'rider_select') pushFitnessToast(buildRiderToast(data, fitnessConfiguration));`
  Do **not** `return` — `ingestData` must still run to set the claim. (Contrast with the
  `vibration` branch, which returns early; `rider_select` is fall-through.)

## Data flow

```
rider_select WS event (already delivered; sets the claim via ingestData)
  └─(parallel)→ FitnessContext WS dispatch: buildRiderToast(data, config)
                  → pushFitnessToast({ avatarUrl, title, subtitle, variant })
                  → fitnessToast slot (latest-wins, fresh id)
                  → FitnessToast (centered, countdown depletes over durationMs)
                  → fade + collapse → onDone(id) → dismissFitnessToast(id) (id-guarded)
```

## Edge cases

- **Rapid re-press / re-claim:** a second toast replaces the first and resets the
  countdown (latest-wins). The id-guard prevents the first toast's exit timer from
  clearing the second.
- **Unknown user/equipment id:** `buildRiderToast` falls back to the raw id for the
  title/subtitle; the avatar `onError` falls back to a generic user image (same pattern
  as elsewhere).
- **Toast during a challenge / governance lock:** still shows (above the overlays);
  purely cosmetic, never blocks or pauses.
- **Reconnect churn:** the toast push sits with the existing dispatch guards, so it is
  naturally skipped during the reconnect-backoff window — acceptable for a cosmetic
  notification.

## Logging

Per the logging-framework rules, the component emits:
- `fitness.toast.shown` on (re)start, with `{ id, variant, durationMs }`.
- `fitness.toast.dismissed` on auto-hide completion, with `{ id }`.

## Testing

- **`FitnessToast` component test:** renders title/subtitle/avatar; the countdown bar
  depletes; `onDone(id)` fires after `durationMs` (fake timers); a new `id` mid-flight
  resets the countdown and does not double-fire `onDone`; renders null when `toast` is
  null.
- **`buildRiderToast` unit test:** `{ userId, equipmentId }` → correct
  `avatarUrl` / `title` / `subtitle` / `variant`, including the unknown-id fallback.
- **`FitnessContext` reducer/API:** `pushFitnessToast` assigns a fresh id and replaces;
  `dismissFitnessToast` is id-guarded (a stale id does not clear a newer toast).

## Affected files (anticipated)

- `frontend/src/modules/Fitness/player/overlays/FitnessToast.jsx` (new) + `.scss` (new).
- `frontend/src/modules/Fitness/player/overlays/buildRiderToast.js` (new, pure helper) +
  test.
- `frontend/src/context/FitnessContext.jsx` — `fitnessToast` state, `pushFitnessToast`,
  `dismissFitnessToast`, context exposure, and the `rider_select` dispatch branch.
- `frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx` — mount `FitnessToast`.
- Tests: `FitnessToast.test.jsx`, `buildRiderToast.test.js`, and a `FitnessContext`
  toast-API test.
