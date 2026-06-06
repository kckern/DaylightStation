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
> `docs/_wip/plans/2026-06-05-governance-audio-duck-cues-design.md`. Reworked
> 2026-06-06 (`docs/_wip/plans/2026-06-06-audio-duck-volume-authority.md`): the duck
> became a multiplier owned by the volume system (see *Single volume authority*).

---

## Architecture

The engine is the **decider** and the hook is the **executor**. The two
communicate through a single stateless descriptor on the composed governance
state — the engine never touches a media element, and the hook never inspects
challenge logic.

```
GovernanceEngine.evaluate()
      ↓
_computeAudioDuck(challengeSnapshot)        ← decides WHICH cue (if any)
      ↓  returns { cueId, sound, duckTo, token } | null
composedState.audioDuck                      ← stateless descriptor
      ↓
FitnessPlayer  →  useGovernanceAudioDuck({ videoVolume, audioDuck })
      ↓
  • duck:    videoVolume.setDuck(duckTo)      ← volume system folds the multiplier
  • play:    new Audio('/media/' + sound)     ← independent track
  • lift:    videoVolume.setDuck(1)  on SFX 'ended' (or unmount / autoplay-reject / retoken)
      ↓
usePersistentVolume  →  every apply path multiplies the stored level by the duck
                        multiplier, so no volume event can override an active duck
```

---

## The descriptor (`_computeAudioDuck`)

`GovernanceEngine._computeAudioDuck(challengeSnapshot)` returns either `null` or:

```js
{ cueId, sound, duckTo, token }
```

It is **stateless** — it derives purely from the current phase and challenge
snapshot, computed fresh each `evaluate()` and exposed as
`composedState.audioDuck`. It does not remember what it already fired; dedupe is
the hook's job (see below), keyed off `token`.

### Priority order

1. **`governance_warning`** — if `phase === 'warning'` (grace period before a
   lock), the warning cue wins over any challenge cue. An impending lock is the
   most important thing to signal.
2. **Cycle challenges are skipped** — `snapshot.type === 'cycle'` returns `null`;
   cycle has its own audible-feedback system.
3. **`challenge_complete`** — status `success`, or `actualCount >= requiredCount`
   (falls back to `missingUsers.length === 0`).
4. **`challenge_remaining`** ("hurry") — status `pending` and
   `remainingSeconds <= thresholdSeconds`. Only fires while the challenge is
   still **unsatisfied** (a met challenge won't lock, so it stays silent).
5. **`challenge_start`** — pending and not yet in the hurry window.

Challenge **failure** has no cue: the lock screen (which pauses the video)
already covers it.

### The `token` — the dedupe key

`token` makes "fire exactly once per occurrence" possible even though the
descriptor is recomputed on every tick and persists across the whole threshold
window. Token shapes:

| Trigger | Token | Re-fires when |
|---|---|---|
| `governance_warning` | `${cueId}:${warningStartTime}` | a new warning episode starts |
| `challenge_start` / `challenge_remaining` / `challenge_complete` | `${challengeId}:${cueId}` | a new challenge id appears |

The engine also emits a `governance.audio_cue.fired` log (sampled, 12/min,
aggregated) each time it produces a descriptor.

---

## The hook (`useGovernanceAudioDuck`)

```js
useGovernanceAudioDuck({ videoVolume, audioDuck });
```

- **`videoVolume`** — the persistent-volume handle from `usePersistentVolume`; the
  hook calls its `setDuck(multiplier)` to lower/lift. The hook never touches a
  media element directly.
- **`audioDuck`** — the descriptor from the engine (or `null`).

### React to the *token*, never the descriptor object

This is the load-bearing design decision. The engine rebuilds `audioDuck` (and
the entire composed governance state) as a **fresh object on every evaluation
tick**. The effect therefore depends on the **stable primitive `token`**, not the
object:

```js
const token = audioDuck?.token || null;
useEffect(() => {
  if (!token) return;
  stopSession(sessionRef.current);             // back-to-back cue: stop the old one
  sessionRef.current = startSession(latestRef.current);
}, [token]);                                    // ← token, not audioDuck
```

The descriptor's other fields (`videoVolume`, `sound`, `duckTo`) are read at
fire-time from a `latestRef` that a separate every-commit effect keeps current —
so a re-render never re-runs the duck, it only refreshes the values the *next*
token will use. The effect returns **no cleanup**: when the cue clears
(`token → null`) the in-flight SFX is left to finish and lift itself. This is why
a cue now plays through its whole window instead of being cut on the next tick.

> **The bug this replaced:** the original effect depended on the whole `audioDuck`
> object and used a `firedTokenRef` guard. The guard stopped *replays* but not
> *teardown* — React still ran the effect's cleanup every tick, which
> `audio.pause()`d the SFX and `restore()`d the volume in the same callback. Result:
> SFX cut almost immediately, and the video volume snapping back up at the exact
> instant the SFX was cut (they were the same callback). Fixed 2026-06-06.

### Session model

A "session" (`{ token, audio, onEnded, lift }`) owns one cue's lifecycle:

- **`startSession`** — calls `videoVolume.setDuck(duckTo)`, then plays the SFX on
  its own `Audio` element, lifting on the SFX `ended` event.
- **`stopSession`** — detaches the listener, `pause()`s + clears the `Audio`
  (no orphaned decode), and lifts (`setDuck(1)`) if not already lifted. Idempotent
  via a `lifted` flag.

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
  previous session first, `pause()`ing + clearing the old `Audio` so it doesn't
  keep decoding in the background, and lifting before the new duck.
- **Unmount mid-duck** — a dedicated unmount-only effect calls `stopSession()`,
  lifting exactly once.

---

## Configuration ignore rules

Cues are parsed by `GovernanceEngine._normalizeAudioCues(config.audio_cues)`,
which **silently drops** entries that are:

- an unknown `trigger` (not one of the four supported),
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
  threshold, null for cycle/no-config;
- priority — `governance_warning` over challenge cues, complete/hurry/start
  selection, token shapes;
- composed-state exposure of `audioDuck`.

The suite silences the logger during teardown to avoid a teardown-race
(`8692210e3`).

`useGovernanceAudioDuck.test.jsx` covers the hook lifecycle with a fake `Audio`
element and a `setDuck` spy: `setDuck(duckTo)`+play on a new token, **no re-duck /
no SFX cut when the descriptor object changes but the token is unchanged** (the
regression), `setDuck(1)` on natural `ended`, lift on autoplay rejection, stop
previous + re-duck on a new token, and lift on unmount.

`usePersistentVolume.test.jsx` covers the multiplier: default (no change), folding
the multiplier into the applied level, the duck surviving a user `setVolume`,
restore on release, and clamping (`>1`→1, `<0`→0, non-finite→1).
