# Voice feedback recording does not mute the menu music

- **Source:** voice feedback `fitness/20260702215307_J0bvRU` · route `/fitness/menu/app_menu1` · reported `2026-07-02T21:53:07.949Z`
- **Audio:** `media/audio/feedback/fitness/20260702215307_J0bvRU.webm`
- **Type:** bug
- **Area:** Feedback module (`frontend/src/modules/Feedback/`) × fitness menu music

## What the user said
> Alright, a few pieces of feedback. One, the music should mute when I give the voice feedback. I already asked you to do that.

## Problem / opportunity
Background menu music keeps playing while the user records a spoken feedback note, which drowns out their voice in the capture. This was reportedly asked for once already and never landed (or regressed). There is direct corroborating evidence: a second feedback item recorded ~15 minutes later (`fitness/20260702220805_9633AV`, same route, same session) transcribed as a nonsensical repeated Whisper hallucination ("A short spoken software-feedback note." × 16) — the signature of an ASR model fed mostly music/ambient noise instead of clear speech. That second item is being filed as evidence here rather than as its own doc; it has no distinguishable content of its own.

## Desired outcome
When the Feedback panel starts recording, any currently-playing menu/background music ducks or pauses for the duration of the recording, and resumes (or restores volume) when recording stops or the panel closes. This should apply anywhere the Feedback panel can be opened, not just the fitness menu.

## Actionable tasks
- [ ] Confirm whether a mute/duck hook was previously requested/attempted for the Feedback recorder (check git log / prior conversations before writing a spec).
- [ ] Wire the Feedback recording start/stop lifecycle to duck or pause the active music player (fitness menu music, and any other app-level background audio) while `isRecording` is true.
- [ ] Restore prior volume/playback state on stop/cancel, not just on successful save.
- [ ] Verify against a real recording: start a feedback note while music is playing, confirm the resulting transcript is clean speech, not a hallucinated loop.

## Acceptance criteria
- Recording a feedback note while fitness menu music is playing produces a clean, accurate transcript (spot check by re-listening or reviewing transcript coherence).
- Music audibly ducks/pauses within recording start and resumes within one beat of recording stop/cancel.
- No regression to music state if recording is cancelled or the panel is dismissed without saving.

## Where to look
- `frontend/src/modules/Feedback/FeedbackOverlay.jsx` — recording start/stop lifecycle, the natural place to hook a duck/pause call.
- `frontend/src/modules/Feedback/feedbackApi.js` — capture/upload flow, confirms exact recording-start/stop event boundaries.
- Fitness menu music: `useMenuMusic` (referenced in session logs as `component:"useMenuMusic"`, events `menu-music.track-ended-continue`) — likely under `frontend/src/modules/Fitness/` or `frontend/src/hooks/fitness/`; find its play/pause/volume API to call from the Feedback lifecycle.

## Context / evidence
Corroborating log signal from the follow-up garbled item (`20260702220805_9633AV`): `voice.capture.recorded` fired with `durationMs:161873, bytes:484754` (a real, substantial recording), but the Whisper transcript is a repeated filler-phrase hallucination — consistent with speech being masked by louder background audio rather than a broken microphone (the same session's cycle-game races captured clean rider audio/telemetry in the same window). Pointer for more: `logs.appLogDir` = `media/logs/fitness`.
