# Saved workout playback timeline

Saved fitness session detail places a video playback strip between rings and heart rate. All three share the same elapsed-workout axis. The rings line measures accumulated effort; it can rise while video is blocked. Selecting an episode is distinct from actual playback, so its media-selection timestamp is not used as the video-start marker.

The strip labels waiting for the initial unlock, actual playing, playing under a governance warning, paused for exercise, other pauses, buffering, and unrecorded coverage. A warning permits playback until the grace period expires; it is not itself a pause. A governance unlock permits playback but cannot prove the player actually resumed.

Tap or keyboard-focus a strip section to see elapsed time, episode and reason. The first playing transition after an observed initial wait is marked “Video started”; a partial observation run is only marked “Playing”. When captured at the decision, historical zone, heart rate and threshold explain the initial unlock. Present-day thresholds are never substituted for missing historical evidence. Short intervals keep their true drawn width and have an expanded touch target. The “All transitions” list provides separate touch controls for clustered intervals. Later pauses show the recorded participant, observed zone/BPM and required zone/threshold when available.

## Recording contract

`FitnessPlayer` attaches `usePlaybackTimelineRecorder` to the existing media element. It listens to actual `playing`, `pause`, `waiting` and `ended` events, plus attributable forward media-time observations for late attachments and combines them with effective governance, user/voice-memo/emergency holds and resilience state. This observer never controls playback or changes governance. State/reason/context changes are recorded; ordinary progress ticks are not.

The canonical saved location is `timeline.events`:

```js
{
  type: 'playback_state',
  timestamp: 1800000000000, // epoch milliseconds
  data: {
    version: 1,
    contentId: 'video:example',
    playbackRunId: 'observer-attachment-identity',
    observation: 'begin', // begin | change | end
    state: 'waiting', // waiting | playing | warning | governance_paused | paused | buffering | unknown | none
    reason: 'startup_gate',
    mediaTimeSeconds: 0,
    governancePhase: 'pending',
    evidence: null // or immutable participantId, participantName, zone, hrBpm, thresholdBpm, requiredZone, requiredThresholdBpm, challengeId, reason
  }
}
```

A run identifies one observer attachment, not an episode. Content changes, media-element replacement and unmount close the run. Replay after `ended` opens a new run. A changed content identity cannot use the old element until a new load or replacement establishes attribution. `FitnessSession.onSessionEnding` closes observers before collecting the final save, so cleanup cannot queue stale events after reset. A new session starts a new run even when the player instance is reused.

The existing persistence pipeline passes these additive events through unchanged, independently of debounced `media_start` and consolidated `media.pauses`. This preserves initial waiting and cause information without changing historical media-selection semantics.

## Coverage and compatibility

Only consecutive valid observations in the same run establish a known interval. Bracketing observations beyond the final chart tick are retained before clipping geometry; authoritative media ends also bound coverage. An unfinished run's tail is unknown after its last transition; a later run never fills the missing period as playing. Invalid timestamps and unsupported versions do not prove playback. Old sessions with video-selection history but no playback observations display “Playback not recorded”. No video history means there is no strip. There is no automatic backfill from logs or heart rate.

Merged session detail includes `sourceStartMs` on each segment beside `offsetMs` and `durationMs`. Absolute event time maps to the compressed chart axis as `offsetMs + timestamp - sourceStartMs`. Strip intervals stop at segment boundaries. An older group payload missing source origins yields unknown playback coverage.

This feature changes saved session detail only. The live workout chart and governance requirements remain unchanged.
