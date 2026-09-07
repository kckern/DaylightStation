# Group fitness session audit

Status: fixes prepared; deployment and physical verification pending. Raw session
logs and account diagnostics remain outside the repository. Fixtures use synthetic
identities.

## Confirmed failures

| Area | Evidence and cause | Remediation |
| --- | --- | --- |
| Voice transcription | Earlier upload and retry returned HTTP 429. A subsequent synthetic provider probe returned `insufficient_quota` / `credit_balance_exhausted`; key validation succeeded. Historical logs omitted the provider subtype. | Restore account credits externally; log allowlisted provider status, code, type, request ID, and session correlation. |
| Later voice capture | A new recording inherited the cancellation flag from a previously dismissed failed upload. Its stop callback discarded the audio without sending a request. | Reset cancellation and invalidate old recorder callbacks at the beginning of each capture. |
| Guest governance | A configured visitor was the sole missing participant in a minimum-active warning. Direct Friend/Family sources were not classified as guests. Challenge denominators also counted non-subjects. | Correct classification and subject-only failure thresholds while retaining guest success contributions. Exclude guests from blocking cadence/cycle obligations; cancel guest-only blocking work neutrally. |
| Pressure-mat challenges | Persisted mat totals and engagement prove tracking worked. Active policy contains zone/cycle rules, but no step/stomp selections. | Activation is a policy/configuration decision, not a sensor repair. Preserve existing configuration and selectively enable approved selections. |
| Unexpected music | Playback continued from standalone chart navigation into an untagged video, then advanced normally to the next song. Reproduced code paths promote automatic playlist selection into a persistent manual override and retain automatic enablement across videos. Historical logs cannot distinguish which enablement branch first fired. | Scope chart automatic playback to its lifetime; derive video music from current labels; preserve genuine manual choices; log each decision and its source. |
| Fullscreen layout | Six avatars enter an unconstrained wrapping row, and separate RPM/mat groups are stacked vertically. | Bound the overlay using actual player dimensions, stack avatars into columns, and place equipment in one shared grid. |

Full-player CSS verification also found duplicated vitals rules and a memo-button
style nested under the footer, outside the button's actual location. Keep vitals
styling in its component stylesheet, restore the button's intended base styling,
and reserve a separate upper corner for it in fullscreen mode.

Neither failed memo has a saved transcript or recoverable raw-audio backup in the
fitness flow. The application only persists the transcript after transcription;
dismissing the failure clears the browser retry payload. Do not represent these
recordings as recoverable or fabricate transcripts.

## Other observed anomalies

- Three challenge-start cue promises were aborted as completion cues superseded
  them. At least one start-to-completion transition took roughly 17 ms; the
  completion cue ended normally. These are not evidence of provider failure.
- One music end-of-duration warning recovered through normal playlist advance.
- DASH audio/video fragment aborts and stalls clustered around initial playback
  replacement, rather than throughout the workout.
- Missing-zone warnings clustered around anonymous-device identity transitions
  and a brief named-participant gap. They warrant identity-transition tracing;
  the warning alone does not prove a false governance penalty.
- The chart logged sustained render rates around 14–15 per second, while the
  provider recorded roughly 11 updates per second. This is a separate performance
  concern; these counters do not identify expensive renders or prove dropped
  video frames.
- Ingest throttling summarized hundreds of pressure-mat messages and some
  governance evaluations. Sampled mat totals preserve activity evidence, but
  exact frontend event replay is incomplete. Decision logs should carry the
  relevant state rather than require reconstructing every sensor message.

## Remaining operational checks

Restore transcription credits and verify a new memo end to end. Decide whether
to activate the existing occasional step/stomp challenge proposal: 40 steps in
60 seconds (weight 3), 70 steps in 60 seconds (weight 2), or eight stomps in
30 seconds (weight 1), with ten seconds of sensor grace. Append those selections
to the existing policy, preserving its interval, minimum participants, and other
challenges. Totals count from challenge start, not from session start. Continuous
minimum-speed enforcement is a separate choice. After deployment, verify a
mixed household/guest workout and the compact layout on the physical display.
No active workout should be interrupted for deployment.

## Validation

The governance/roster Vitest regression suite passes 181 tests. Recorder,
provider diagnostics, and music-policy checks pass 18 tests together. Browser
geometry covers the real overlay styles, synthetic rosters, parent resizing,
and both anchor positions.

The older Jest governance integration suite is not clean: the unchanged code
has 25 failures and 169 passes; these changes have 24 failures and 170 passes,
with no newly failing test names. Its remaining cycle/ghost expectations need
separate reconciliation; do not describe the entire integration suite as passing.
