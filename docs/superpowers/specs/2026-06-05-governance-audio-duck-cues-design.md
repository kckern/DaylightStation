# Governance Audio-Duck Cues — Design

**Date:** 2026-06-05
**Status:** Approved (design); pending implementation plan
**Area:** Fitness player / GovernanceEngine

## Problem

The governance engine can pause the video and show an overlay (e.g. the lock
screen). We want a *lighter* audio capability: at a configured time before a
challenge would lock, play a sound effect (`challenge-hurry.mp3`) **while the
video keeps playing**, ducking the video's audio so the cue is audible. This is
distinct from the existing pause path — the video is never paused, only its
volume is briefly lowered.

First instance: a zone-challenge whose ring countdown is about to expire
unsatisfied (→ lock screen). ~10–15s before, play the hurry SFX and duck the
video to a quiet-but-audible level for the duration of the SFX.

## Decisions (locked during brainstorming)

1. **Reusable primitive**, not a one-off. Build a config-driven governance
   "audio-duck cue" capability; wire the challenge-hurry case as its first
   instance.
2. **Duck to a low volume** (default ~10%), not full mute. Configurable.
3. **Duck while the SFX plays** — restore the moment the sound finishes, even if
   the timer is still counting down.
4. **Multiplicative duck**: video volume × `duck_to`, so it respects the user's
   master volume (read live, not a captured snapshot).
5. **Fire only when the challenge is still unsatisfied/pending** — a satisfied
   challenge won't lock, so there's nothing to hurry for.

## Approach

Engine emits a config-driven cue; a small React hook plays the SFX and applies
the duck. Rejected alternative: pure-React in `FitnessPlayerOverlay` watching
`overlay.timeLeftSeconds` — that would duplicate countdown logic in the view
layer and couple the feature to one overlay. Engine-driven keeps timing as SSOT
(testable via the injectable clock) and mirrors the existing `cycleAudioCue`
pattern.

## Components

### 1. Config

New optional block under `governance:` in `fitness.yml`:

```yaml
governance:
  audio_cues:
    - id: challenge_hurry
      trigger: challenge_remaining   # fires off the challenge ring countdown
      threshold_seconds: 12          # fire when remaining <= 12s
      sound: apps/fitness/ux/challenge-hurry.mp3
      duck_to: 0.1                   # video volume * 0.1 while the SFX plays
```

- `audio_cues` is a list; multiple cues allowed.
- `trigger` is an enum. First supported value: `challenge_remaining`. Others
  (e.g. `grace_remaining`) can be added later without touching consumers.
- `sound` is a media-relative path resolved with `DaylightMediaPath('/media/' + sound)`.
- `duck_to` clamped to [0, 1]. The `challenge-hurry.mp3` file already exists on
  the media volume at `apps/fitness/ux/challenge-hurry.mp3`.

### 2. Engine (`frontend/src/hooks/fitness/GovernanceEngine.js`)

- `configure()` parses `config.audio_cues` into `this._audioCues`, validating:
  finite `threshold_seconds`, non-empty `sound`, `duck_to` clamped to [0,1],
  recognized `trigger`. Invalid entries are dropped with a `warn` log.
- New method `_evaluateAudioCues(now, challengeSnapshot)`:
  - For each cue with `trigger: challenge_remaining`, fires when
    `challengeSnapshot.remainingSeconds <= threshold_seconds` **and** the
    challenge is still unsatisfied (`status === 'pending'` and not satisfied).
  - **Edge-triggered once per challenge**: tracked via a fired-set keyed
    `challengeId:cueId` (mirrors the existing `_lastAudioCue*` tracking). Cannot
    retrigger every tick; a new challenge id resets eligibility.
- `_composeState()` gains a top-level field:

  ```js
  audioDuck: { cueId, sound, duckTo, token } | null
  ```

  `token = `${challengeId}:${cueId}`` — a **stable per-firing token** (not a
  one-frame flag), so the consumer detects the edge reliably even if React
  coalesces snapshot updates.

### 3. Consumer hook (new: `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js`)

Inputs: `{ mediaElement, videoVolume, audioDuck }`. On a **new `token`**:

1. Play the SFX through an owned `Audio(DaylightMediaPath('/media/' + sound))`
   instance (same mechanism as `playSound.js`, but retained so the hook can
   listen for `ended`).
2. Duck: `mediaElement.volume = videoVolume.volumeRef.current * duckTo`
   (multiplicative; reads the live persistent volume ref).
3. Restore on the SFX `ended` event (and on hook unmount) to the **live**
   `videoVolume.volumeRef.current`.

The video is never paused — only its volume changes.

### 4. Wiring (`frontend/src/modules/Fitness/player/FitnessPlayer.jsx`)

One call alongside the existing volume wiring (`mediaElement` and `videoVolume`
are already in scope):

```js
useGovernanceAudioDuck({
  mediaElement,
  videoVolume,
  audioDuck: effectiveGovernanceState?.audioDuck
});
```

## Data flow

```
fitness.yml governance.audio_cues
  -> GovernanceEngine.configure() -> this._audioCues
  -> evaluate() tick -> _composeState() -> _evaluateAudioCues()
       -> audioDuck { cueId, sound, duckTo, token } | null
  -> onStateChange -> React (FitnessContext) -> governanceState.audioDuck
  -> FitnessPlayer -> useGovernanceAudioDuck()
       -> new token? play SFX + duck media.volume
       -> SFX 'ended' -> restore media.volume
```

## Error handling / edge cases

- **SFX playback rejected** (autoplay policy): swallow, like `playSound.js`.
  Still attempt the duck/restore so audio isn't left ducked.
- **No media element / no volume ref**: no-op (guard).
- **Challenge satisfied before threshold**: cue never fires (unsatisfied guard).
- **Duck-clobber (known v1 limitation, deliberate):** the hook sets
  `media.volume` directly (same precedent as the lock path setting `media.muted`
  directly at `FitnessPlayer.jsx:399`). If a `useVolumeSync` re-apply or a manual
  volume change lands during the ~3s duck window, it could reset to full early.
  Accepted for v1 given the short window; harden later (transient-override layer
  in `VolumeProvider`) only if it proves a problem.

## Testing (TDD)

- **Engine `_evaluateAudioCues`** (injectable clock):
  - fires when remaining crosses `threshold_seconds` while unsatisfied;
  - the satisfied-guard suppresses it;
  - fires once per challenge (no retrigger across ticks);
  - a new challenge id re-arms the cue.
- **Hook `useGovernanceAudioDuck`** (fake media element + stubbed `Audio`):
  - duck applied to `media.volume` on a new token (multiplicative);
  - restored on `ended`;
  - restored on unmount;
  - no-op when `audioDuck` is null or media/volume missing.

## Logging (per CLAUDE.md)

- Engine: `governance.audio_cue.fired` (cueId, challengeId, remainingSeconds, threshold).
- Hook: `fitness.audio_duck.start` (cueId, duckTo, level) / `fitness.audio_duck.end`.

## Out of scope (v1)

- Triggers other than `challenge_remaining`.
- Cycle-challenge audio ducking.
- Transient-override volume layer in `VolumeProvider`.
- Multiple simultaneous overlapping ducks (one active duck at a time).
