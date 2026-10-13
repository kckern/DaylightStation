# Truthful Fitness Household Episodes Design

## Intent

Fitness history should describe household workout episodes, not browser lifecycles. Raw session records remain the evidence layer; the history API derives a stable household episode across reloads, crashes, short sensor outages, media changes, and rotating participants.

## Episode Semantics

- Join adjacent same-day home sessions when their gap is at most 15 minutes.
- An explicitly finalized session is a hard boundary on both sides.
- Non-cycling Strava activities always stand alone.
- Video/media changes and participant-cohort changes do not break an episode.
- Preserve existing singleton IDs and `group:<first-session-id>` identifiers.
- `durationMs` remains the compressed chart-axis duration. Add `elapsedMs` for first-start to last-end wall time.
- Aggregate every participant across every segment: rings and zone minutes sum; average heart rate is weighted by measured time; `measuredDurationMs` is the sum of valid zone/HR time.

## Deliberate End

Pressing End means the workout is finished. Every device active at that moment enters an ended-device hold and cannot seed another session until it has been absent for the configured device-removal interval. A different device can start immediately. The hold survives kiosk reloads in local storage, and expires at the next local day boundary.

## Presentation

History cards and detail headers show the episode clock range and elapsed span, plus measured time per participant. They must not imply that every participant exercised for the entire household wall-clock span.

## Historical Correction

For 2026-10-07, retain one morning Test Rider episode, one shared afternoon episode, KC's independent Strava run, and one the learner evening episode. Recoverably trash the three Test Sibling auto-restart artifacts. Split the final raw session at the learner's entity start (`2026-10-07 16:30:17.548 America/Los_Angeles`), trash the Test Sibling-only head, and retain the the learner half. No correction may proceed unless timeline, event, snapshot, ring, bucket, participant, and activity reconciliation checks pass.

