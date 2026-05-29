# Fitness Challenge Toasts — Design

**Date:** 2026-05-29
**Status:** Approved (design)

## Goal

Surface ephemeral toast notifications (via the existing `FitnessToast` system) when a
governance challenge **starts** and when it **succeeds**, so participants get clear,
view-agnostic feedback during a fitness session.

## Scope & Decisions

- **Start toast:** shown when a challenge becomes active (`pending`).
- **End toast:** shown **only on success**. Failures/expirations get no end toast —
  the start toast simply fades on its own.
- **Instant success:** if a challenge is satisfied on the same tick it is created
  (never observed in `pending`), show **only** the success toast — a single toast.
- **Copy includes rider/count detail**, e.g. "3 of 3 riders reached Active".
- Out of scope: failure toasts, cycle-challenge-specific phrasing (the generic
  challenge snapshot path covers both types; copy is written for the common zone case
  and degrades gracefully when count/zone fields are absent).

## Source of Truth

Challenge state is driven synchronously by the `GovernanceEngine.evaluate()` loop and
exposed to React as `governanceState.challenge` (the engine's rendered snapshot).

Lifecycle:

```
null → { status: 'pending', ... } → { status: 'success' | 'failed', ... } → null
```

Fields available on the snapshot: `id`, `status`, `zone` / `zoneLabel`,
`requiredCount`, `selectionLabel`, and on completion `summary.actualCount` /
`summary.metUsers`.

## Architecture

The trigger lives in `frontend/src/context/FitnessContext.jsx`, mirroring the existing
`rider_select` toast pattern (`riderToastRef`). FitnessContext is view-agnostic and owns
`pushFitnessToast` — matching the fact that `FitnessToast` is mounted at the FitnessApp
root. (The alternative, `FitnessPlayerOverlay.jsx`, already detects challenge
transitions but is only mounted while the video player is up, so it would miss toasts in
other views.)

### New pure helpers (testable in isolation)

Placed alongside the existing toast helpers in
`frontend/src/modules/Fitness/player/overlays/`:

1. **`challengeToastTracker.js`** — `nextChallengeToast(tracker, challenge)` →
   `{ event: 'start' | 'end' | null, tracker }`
   - Emits `start` the first time it observes a given challenge `id` with status
     `pending`.
   - Emits `end` the first time it observes that `id` with status `success`.
   - **Instant case:** a brand-new `id` first seen as `success` (no prior `pending`)
     emits only `end`.
   - `failed` and `null` snapshots emit nothing.
   - Per-`id` guards (`startedIds`, `endedIds`) prevent duplicate emits across the many
     governance ticks.
   - Pure: takes prior tracker state, returns event + next tracker state. No refs, no
     side effects.

2. **`buildChallengeToast.js`** — `buildChallengeToast(event, challenge)` → toast object
   - **start:** `{ icon: '🏆', title: 'Challenge started',
     subtitle: 'Get {requiredCount} riders to {zoneLabel}', variant: 'info' }`
   - **end:** `{ icon: '🏆', title: 'Challenge complete!',
     subtitle: '{actualCount} of {requiredCount} riders reached {zoneLabel}',
     variant: 'success' }`
   - Graceful fallbacks: missing `requiredCount`/`actualCount`/`zoneLabel` collapse to a
     simpler subtitle (e.g. "Challenge started" / "Challenge complete!") rather than
     emitting "undefined".

### Component change

`FitnessToast.jsx` gains an optional `icon` prop: when a toast carries `icon` and no
`avatarUrl`, render the icon glyph in the avatar slot. Today the icon only appears as a
fallback when an avatar image fails to load; this makes it a first-class, explicit
option for avatar-less (group) toasts.

### Wiring

In `FitnessContext.jsx`:

- `challengeTrackerRef = useRef(initialTracker)` holds the tracker state across renders.
- An effect keyed on `(challenge?.id, challenge?.status)` calls
  `nextChallengeToast(challengeTrackerRef.current, challenge)`, stores the returned
  tracker, and on a non-null `event` calls
  `pushFitnessToast(buildChallengeToast(event, challenge))`.

## Logging

At each emit: `logger.info('fitness.challenge.toast', { event, challengeId, status })`,
using the FitnessContext child logger (per project logging rule — no raw console).

## Testing (TDD)

- `challengeToastTracker.test.js`
  - `null → pending` emits `start`.
  - `pending → success` emits `end`.
  - new `id` first seen as `success` emits only `end` (instant case).
  - `pending → failed` and `… → null` emit nothing.
  - repeated identical snapshots emit each event at most once per `id`.
- `buildChallengeToast.test.js`
  - start/end copy with full fields.
  - count/zone fallbacks when fields missing.
- `FitnessToast.test.jsx` — renders the `icon` glyph when `icon` is set and no
  `avatarUrl`.

## Files Touched

- `frontend/src/modules/Fitness/player/overlays/challengeToastTracker.js` (new)
- `frontend/src/modules/Fitness/player/overlays/buildChallengeToast.js` (new)
- `frontend/src/modules/Fitness/player/overlays/challengeToastTracker.test.js` (new)
- `frontend/src/modules/Fitness/player/overlays/buildChallengeToast.test.js` (new)
- `frontend/src/modules/Fitness/player/overlays/FitnessToast.jsx` (add `icon` prop)
- `frontend/src/modules/Fitness/player/overlays/FitnessToast.test.jsx` (icon test)
- `frontend/src/context/FitnessContext.jsx` (tracker ref + effect + wiring)
