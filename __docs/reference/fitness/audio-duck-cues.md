# Governance Audio-Duck Cues

How the fitness player plays a short sound effect and momentarily lowers the
workout video's volume (without pausing it) when the governance engine signals a
key challenge/lock moment, then restores the volume the instant the sound ends.

This document covers the **mechanism** — the descriptor pipeline, the dedupe
model, the duck/restore lifecycle, and the edge cases. For the **config** (the
`governance.audio_cues` YAML block, triggers, and `duck_to` semantics) see
[`governance-engine.md` → Audio Cues](./governance-engine.md#audio-cues).

## Related code

- `frontend/src/hooks/fitness/GovernanceEngine.js` — parses cues, computes the descriptor
- `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js` — plays the SFX, drives the duck
- `frontend/src/modules/Fitness/nav/usePersistentVolume.js` — owns the duck multiplier (`setDuck`); single volume authority
- `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` — wires the hook in (~line 624)
- `frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js` — engine-side unit coverage
- `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx` — hook-side unit coverage
- `frontend/src/modules/Fitness/nav/usePersistentVolume.test.jsx` — duck-multiplier unit coverage

> History: shipped 2026-06-05 on the (since-merged-and-deleted) branch
> `feature/governance-audio-duck-cues`. Design spec:
> `ops:docs/_wip/plans/2026-06-05-governance-audio-duck-cues-design.md`. Reworked
> 2026-06-06 (`ops:docs/_wip/plans/2026-06-06-audio-duck-volume-authority.md`): the duck
> became a multiplier owned by the volume system (see *Single volume authority*).

---

## Architecture

The engine is the **decider** and the hook is the **executor**. The two
communicate through a cue-event descriptor on the composed governance
state — the engine never touches a media element, and the hook never inspects
challenge logic.

```
GovernanceEngine.evaluate()
      ↓
_computeAudioDuck(challengeSnapshot)        ← decides WHICH cue (if any)
      ↓  returns { cueId, trigger, sound, duckTo, volume, token } | null
composedState.audioDuck                      ← cue event; null = no new event
      ↓
FitnessPlayer  →  useGovernanceAudioDuck({ videoVolume, audioDuck, suppress, suppressCycle, itemKey })
      ↓
  • duck:    videoVolume.setDuck(duckTo)      ← volume system folds the multiplier
  • play:    shared cue Audio element        ← independent of the video
  • lift:    videoVolume.setDuck(1)  on SFX 'ended' (or explicit suppression / unmount / error / retoken)
      ↓
usePersistentVolume  →  every apply path multiplies the stored level by the duck
                        multiplier, so no volume event can override an active duck
```

---

## The descriptor (`_computeAudioDuck`)

`GovernanceEngine._computeAudioDuck(challengeSnapshot)` returns either `null` or:

```js
{ cueId, trigger, sound, duckTo, volume, token }
```

The descriptor is computed from the current phase and challenge snapshot and
exposed as `composedState.audioDuck`. Zone/HR cues use stable stage tokens;
cycle start/end/fail are snapshot edges, and cycle hurry is an event gated by an
8-second cooldown. Those cycle descriptors can be followed by `null` on the next
tick even while their sound is playing. **Null means no new cue this tick**, not
cancellation. The hook owns playback through completion and dedupes by `token`.
The `trigger` identifies the cue's channel so recovery can cancel only cycle
cues even after their event descriptor has disappeared.

### Priority order

1. **`governance_warning`** — if `phase === 'warning'` (grace period before a
   lock), the warning cue wins over any challenge cue. An impending lock is the
   most important thing to signal.
2. **Base HR hard lock** — `phase === 'locked'` emits no cues; the lock overlay
   owns its audio. The player explicitly suppresses an ongoing governance cue.
3. **Cycle challenges** — map lifecycle edges to `cycle_start`, `cycle_end`, and
   `cycle_fail`; below-red RPM with depleted health can emit `cycle_hurry`.
   While `sensorUnavailable`, skip cycle cue resolution without consuming hurry
   cooldown. Base HR warning keeps precedence during that same recovery.
4. **`challenge_complete`** — status `success`, or `actualCount >= requiredCount`
   (falls back to nonempty `metUsers` and empty `missingUsers`).
5. **`challenge_remaining`** ("hurry") — status `pending` and
   `remainingSeconds <= thresholdSeconds`. Only fires while the challenge is
   still **unsatisfied** (a met challenge won't lock, so it stays silent).
6. **`challenge_start`** — pending and not yet in the hurry window.

Zone challenge **failure** has no cue: the lock screen (which pauses the video)
already covers it.

### The `token` — the dedupe key

`token` makes "fire exactly once per occurrence" possible even though the
descriptor is recomputed on every tick and persists across the whole threshold
window. Token shapes:

| Trigger | Token | Re-fires when |
|---|---|---|
| `governance_warning` | `${cueId}:${warningStartTime}` | a new warning episode starts |
| `challenge_start` / `challenge_remaining` / `challenge_complete` | `${challengeId}:${cueId}` | a new challenge id appears |
| `cycle_start` / `cycle_end` / `cycle_fail` | `${challengeId}:${cueId}` | a new challenge id appears |
| `cycle_hurry` | `${challengeId}:cycle_hurry:${timestamp}` | below-red depleted health after cooldown |

The engine also emits a `governance.audio_cue.fired` log (sampled, 12/min,
aggregated) each time it produces a descriptor.

---

## The hook (`useGovernanceAudioDuck`)

```js
useGovernanceAudioDuck({
  videoVolume,
  audioDuck,
  suppress: false,
  suppressCycle: false,
  itemKey: null
});
```

- **`videoVolume`** — persistent-volume handle; `setDuck(multiplier)` lowers/lifts
  the video's volume through its single authority.
- **`audioDuck`** — engine event descriptor or `null`. Ordinary null ticks leave
  a playing cue alone until `ended`, a real media error, autoplay rejection,
  explicit cancellation, or unmount.
- **`suppress`** — stops the active governance cue and prevents new cues. The
  player sets it when no current item exists, current-video governance is
  bypassed, or base HR is hard-locked.
- **`suppressCycle`** — stops/prevents only descriptors whose `trigger` starts
  with `cycle_`. The player sets it during cadence sensor recovery. Base HR
  warning cues keep playing and may still start in that recovery window.
- **`itemKey`** — current item identity; a change stops the prior item's cue.

### Event and cancellation lifecycles

The effect depends on primitive token/lifecycle inputs, never the descriptor
object. The engine can rebuild an object every tick without cutting or replaying
the cue. Descriptor fields and the volume handle are read from a current ref when
an unseen token fires. A bounded set of fired tokens preserves stage deduplication
through null ticks, warning collisions, locks, and recovery.

Explicit suppression, cycle-only recovery, or item change detaches the retained
session's listeners and lifts its duck once. That cancellation works even when
the latest engine descriptor is already null. An active base HR warning is not
cancelled by cycle-only recovery. A genuinely new token supersedes the previous
session; an already-fired token does not restart it.

### Session model

A session retains the cue's token, trigger, normalized audio source, listeners,
and an idempotent lift function:

- **`startSession`** — calls `videoVolume.setDuck(duckTo)`, then plays the SFX on
  the shared cue `Audio` element, lifting on the SFX `ended` event.
- **`stopSession`** — detaches its listeners and lifts (`setDuck(1)`) once. It
  pauses the shared element only while its duck is active and its source still
  matches. A superseding fingerprint success cue or later independent cue is
  left playing. The shared source is never cleared.

---

## Single volume authority

The duck is **not** a second writer of the video element's volume. It is a
multiplier owned by `usePersistentVolume`:

```js
// usePersistentVolume.js — every apply path funnels through this:
applyDucked(resolved) => applyToPlayer(playerRef,
  { ...resolved, level: clamp01(resolved.level * duckRef.current) })

setDuck(multiplier) => { duckRef.current = clamp01(multiplier); applyDucked({ level: volumeRef.current }); }
```

Consequences:

- **Single authority.** All five apply paths — hydration, `setVolume` (user
  change), `toggleMute`, `applyToPlayer`, and `setDuck` — multiply the stored
  level by `duckRef`. Nothing writes the element volume outside this funnel.
- **No override.** `useVolumeSync` re-applies the level on `canplay`, resilience
  recovery, and mount. Because those go through the same funnel, they re-apply the
  **ducked** level instead of clobbering the duck.
- **Monotonic by construction.** `duckRef` is clamped to `[0,1]`, so a duck can
  only ever lower the video — never raise it. "Never accidentally raise" is
  structural, not a guard.
- **User change mid-duck stays proportional.** A `setVolume` during a duck applies
  `newLevel × duckRef`; lifting (`setDuck(1)`) then restores to the new level.
- **`duckRef`/`setDuck` are stable refs** on the hook instance, so even though the
  `videoVolume` wrapper object is re-memoized on volume/mute changes, an in-flight
  session's `lift()` always hits the same multiplier and player.
- The cue **SFX plays on its own independent `Audio` element** — a separate track
  from the `<video>`; the duck only scales the video's `level`, never `muted`.

---

## Edge cases (each has an explicit guard)

- **Per-tick object churn** — the engine emits a new `audioDuck` object every
  tick; keying the effect on `token` (not the object) is what stops the SFX from
  being cut and the volume from bouncing. *(the core fix)*
- **Volume event mid-duck** — `canplay` / resilience-recovery / mount re-applies
  go through the same multiplier funnel, so they re-apply the *ducked* level
  instead of overriding the duck. *(structural — see Single volume authority)*
- **Autoplay rejection** — `audio.play()` returns a promise that can reject
  silently; without handling, the `ended` event never fires and the duck stays on
  forever. `p.catch(() => lift())` guarantees recovery. *(originally `5c953881a`)*
- **Synchronous Audio construction/play failure** — wrapped in `try/catch`;
  lifts immediately so the video is never left ducked with no SFX to end it.
- **Orphaned SFX on re-token** — a new token calls `stopSession()` on the
  previous session first, stopping its still-owned source and lifting before the
  new duck.
- **Bypass/item exit** — explicit all-cue suppression releases the retained
  session once, even after a null event tick.
- **Sensor recovery** — the producer emits no cycle event and the consumer
  releases only a retained cycle cue; base HR warning/lock audio remains active.
- **Shared success cue** — cancellation checks source ownership before pausing,
  preserving a newer success sound and its completion callback.
- **Unmount mid-duck** — a dedicated unmount-only effect calls `stopSession()`,
  lifting exactly once.

---

## Configuration ignore rules

Cues are parsed by `GovernanceEngine._normalizeAudioCues(config.audio_cues)`,
which **silently drops** entries that are:

- an unknown `trigger` (not one of the eight supported),
- missing `sound`,
- a `challenge_remaining` entry with no numeric `threshold_seconds`.

`duck_to` / `duckTo` is coerced to a number and clamped to `[0, 1]` (default
`0.1`). Both snake_case (`duck_to`, `threshold_seconds`) and camelCase
(`duckTo`, `thresholdSeconds`) keys are accepted.

---

## Tests

`GovernanceEngine.audioDuck.test.js` covers:

- cue parsing — clamp `duck_to` into `[0,1]`, snake/camel alias acceptance,
  negative-clamp-to-zero;
- `_computeAudioDuck` — descriptor shape, null when no unsatisfied challenge in
  threshold, null without configured cues;
- priority — `governance_warning` over challenge cues, complete/hurry/start
  selection, token shapes;
- composed-state exposure of `audioDuck`, including its trigger;
- full evaluate/state recovery with partial health and decayed zero RPM,
  unavailable manual initialization, and preserved base HR warning precedence.

The suite silences the logger during teardown to avoid a teardown-race
(`8692210e3`).

`useGovernanceAudioDuck.test.jsx` covers the hook lifecycle with a fake `Audio`
element and a `setDuck` spy: `setDuck(duckTo)`+play on a new token, **no re-duck /
no SFX cut when the descriptor object changes but the token is unchanged** (the
regression), `setDuck(1)` on natural `ended`, lift on autoplay rejection, stop
previous + re-duck on a new token, and lift on unmount. Real-engine start/fail/end/
hurry events survive later null ticks until ended. Real-engine recovery cancels
only its active cycle cue once, preserves base HR warning audio, and leaves a
superseding success cue playing. Real-player tests cover explicit bypass, denial,
cancel, stale-item results, first-item initialization, next-item reset, recovery,
and base HR hard-lock authority.

`usePersistentVolume.test.jsx` covers the multiplier: default (no change), folding
the multiplier into the applied level, the duck surviving a user `setVolume`,
restore on release, and clamping (`>1`→1, `<0`→0, non-finite→1).
