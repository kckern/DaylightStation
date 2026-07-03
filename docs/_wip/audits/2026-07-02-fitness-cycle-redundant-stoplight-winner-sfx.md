# Remove redundant sound effects on the stoplight and winner reveal

- **Source:** voice feedback `fitness/20260702215307_J0bvRU` · route `/fitness/menu/app_menu1` · reported `2026-07-02T21:53:07.949Z`
- **Audio:** `media/audio/feedback/fitness/20260702215307_J0bvRU.webm`
- **Type:** improvement
- **Area:** Cycle Game — audio (`CountdownStoplight`, results/winner reveal, `CycleGameContainer.jsx` sound cues)

## What the user said
> Let's remove the sound effects on the stoplight and on the winner because we already have sounds that are playing for that.

## Problem / opportunity
The stoplight countdown and the winner/results reveal each layer an extra one-shot sound effect on top of audio that's already playing for that moment (likely the countdown/go SFX shipped in a recent Phase-0 fix, and/or the racing/end music track), producing an unwanted double-audio effect.

## Desired outcome
Only one audio cue plays for the countdown-to-green moment, and only one plays for the winner/results reveal — whichever is the better-sounding or more informative of the currently-overlapping pair, per the user's judgment once shown the options.

## Actionable tasks
- [ ] Inventory every sound cue that fires during the countdown→go transition and the results/winner reveal (`sounds.go`, `sounds.countdown`, `sounds.finish`, `sounds.end`, plus any CSS/visual-only effects that aren't audio).
- [ ] Identify which specific cue(s) the user considers redundant (likely the newly-added `countdown`/`go`/`finish` WAV cues from the Phase-0 sound fix overlapping with pre-existing `start`/`racing`/`end` music-layer cues — confirm by listening, don't assume).
- [ ] Remove or silence the redundant cue(s); keep the one that reads best.
- [ ] Update `docs/reference/fitness/cycle-game.md`'s sound-cue section if the set of active cues changes.

## Acceptance criteria
- A full countdown→go→race→results cycle plays each "moment" (green light, winner reveal) with exactly one audible sound effect, not two overlapping ones.

## Where to look
- `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx` — all `playSound(soundsRef.current?.X, ...)` call sites (search for `cue: 'go'`, `cue: 'countdown'`, `cue: 'finish'`, `cue: 'start'`) and the `playMusic(...)` phase-transition calls right above/below them.
- Live config `cycle_game.sounds` block (`data/household/config/fitness.yml`) — lists which audio files are wired to which cue; the Phase-0 fix (commit `9b9828322`'s predecessors) added `countdown`/`go`/`finish` files that previously had no sound at all — the redundancy may be between one of these new cues and an older `start`/`racing` cue that already covered the same moment.

## Context / evidence
None in `logs.recent` — purely an audio/UX judgment call, not diagnosable from logs. `null`.
