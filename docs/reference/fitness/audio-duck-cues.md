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
- `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js` — executes the duck
- `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` — wires the hook in (~line 621)
- `frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js` — engine-side unit coverage
- `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx` — hook-side unit coverage

> History: shipped 2026-06-05 on the (since-merged-and-deleted) branch
> `feature/governance-audio-duck-cues`. Design spec:
> `docs/_wip/plans/2026-06-05-governance-audio-duck-cues-design.md`.

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
FitnessPlayer  →  useGovernanceAudioDuck({ mediaElement, videoVolume, audioDuck })
      ↓
  • duck:    mediaElement.volume = clamp(baseLevel * duckTo)
  • play:    new Audio('/media/' + sound)
  • restore: on SFX 'ended' (or unmount / autoplay-reject)
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
useGovernanceAudioDuck({ mediaElement, videoVolume, audioDuck });
```

- **`mediaElement`** — the `<video>` (anything with a numeric `.volume`).
- **`videoVolume`** — `{ volumeRef: { current } }`, the live persistent volume.
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

The descriptor's other fields (`mediaElement`, `videoVolume`, `sound`, `duckTo`)
are read at fire-time from a `latestRef` that a separate every-commit effect keeps
current — so a re-render never re-runs the duck, it only refreshes the values the
*next* token will use. The effect returns **no cleanup**: when the cue clears
(`token → null`) the in-flight SFX is left to finish and restore itself. This is
why a cue now plays through its whole window instead of being cut on the next tick.

> **The bug this replaced:** the original effect depended on the whole `audioDuck`
> object and used a `firedTokenRef` guard. The guard stopped *replays* but not
> *teardown* — React still ran the effect's cleanup every tick, which
> `audio.pause()`d the SFX and `restore()`d the volume in the same callback. Result:
> SFX cut almost immediately, and the video volume snapping back up at the exact
> instant the SFX was cut (they were the same callback). Fixed 2026-06-06.

### Session model

A "session" (`{ token, audio, onEnded, restore }`) owns one cue's lifecycle:

- **`startSession`** — captures the viewer level, ducks (see below), plays the
  SFX on its own `Audio` element, restores on the SFX `ended` event.
- **`stopSession`** — detaches the listener, `pause()`s + clears the `Audio`
  (no orphaned decode), and restores volume if not already restored. Idempotent.

### Duck level — monotonic

```js
viewerLevel = videoVolume.volumeRef.current ?? mediaElement.volume;
duckLevel   = clamp01(viewerLevel * audioDuck.duckTo);
if (duckLevel < mediaElement.volume) mediaElement.volume = duckLevel;  // only ever LOWER
```

`duck_to` is **multiplicative** against the viewer's current level (`0.1` = duck
to 10%). The guard makes the duck **monotonic** — it can only lower the video
volume, never raise it. The base is read from the persistent `volumeRef` so a
duck already in flight can't become the new base and compound into silence.

### Restore — never louder than asked

`restore()` (idempotent via a `restored` flag) sets volume back to the viewer's
**current** intended level (`volumeRef.current`, clamped to `[0,1]`), so a volume
change made mid-duck is honored. A duck can only ever *give volume back* — it can
never push the video louder than the viewer set it.

---

## Edge cases (each has an explicit guard)

- **Per-tick object churn** — the engine emits a new `audioDuck` object every
  tick; keying the effect on `token` (not the object) is what stops the SFX from
  being cut and the volume from bouncing. *(the core fix)*
- **Autoplay rejection** — `audio.play()` returns a promise that can reject
  silently; without handling, the `ended` event never fires and the video stays
  ducked forever. `p.catch(() => restore())` guarantees recovery.
  *(commit `5c953881a`)*
- **Synchronous Audio construction/play failure** — wrapped in `try/catch`;
  restores immediately so the video is never left ducked with no SFX to end it.
- **Orphaned SFX on re-token** — a new token calls `stopSession()` on the
  previous session first, `pause()`ing + clearing the old `Audio` so it doesn't
  keep decoding in the background.
- **Unmount mid-duck** — a dedicated unmount-only effect calls `stopSession()`,
  restoring volume exactly once.

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
element: first-tick duck+play, **no cut/jump when the descriptor object changes
but the token is unchanged** (the regression), restore on natural `ended`,
monotonic duck (never raises), autoplay-rejection restore, retoken orphan-stop,
and unmount restore.
