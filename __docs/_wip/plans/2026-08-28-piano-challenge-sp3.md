# PianoChallenge SP3 — Host Adapters

**Goal:** Turn the four already-adjacent surfaces into thin `AskSession` hosts:
placement, kiosk-home lesson gate, school piano lesson, and earned game time.

## Current assets (do not duplicate)

- `PianoMenu` and `TodaysLessonGate` already own kiosk-home gating and launch
  navigation; they currently launch a course lesson directly.
- `GetPianoLessonGate` and `PianoLessonCeremonyBridge` already decide and record
  School completion; the frontend hook only reads that decision.
- `PianoGameBudgetService` and `useGameBudgetMeter` own durable game-time
  accounting. Earned minutes must enter through a service method, never a
  client-side balance adjustment.

## Required adapters

1. **Placement:** a short descending `AskSession` probe; its host owns only the
   sampled levels and writes the resulting `startLevel` through a dedicated
   profile/config API. It cannot mutate the repertoire or assessment engine.
2. **Kiosk-home lesson gate:** replace the direct course launch only when the
   server gate response includes a PianoChallenge descriptor. The existing
   course card remains the fallback for ordinary lessons and failures.
3. **School lesson:** add a PianoChallenge descriptor to the existing school
   lesson contract and post a passed result to the same School completion path
   used by the ceremony bridge. The School application layer remains the sole
   completion judge.
4. **Earned time:** add an idempotent server-side budget credit operation. A
   host’s `onPassed(result)` sends the assessment identity and score; server
   config determines minutes and caps. Never credit aborted/timeout attempts.

## Proof obligations

- Each adapter mounts `AskSession`; none resolves material, builds a matcher,
  or renders a second presentation.
- Every mutation is learner-scoped, authenticated, idempotent, and covered by
  an application/service test plus its HTTP/React boundary test.
- Existing menu gate, School ceremony, and budget meter tests stay green.
- No household YAML content changes until SP4.

## Implementation checkpoint — 2026-08-28

- Placement is now an on-demand kiosk route. It is a descending probe that
  mounts `AskSession` for each authored repertoire rung; on the first pass it
  persists only that rung id through the dedicated, authenticated
  learner-scoped PianoChallenge profile API.
- The profile service preserves unrelated piano preferences and rejects unknown
  learners/blank level ids. Games reads the saved start level before mounting a
  gate and falls back to the household setting if that read fails.
- The profile service, HTTP boundary, placement host, and existing Games host
  focused tests are green.
- Earned game time now has an idempotent server-side credit operation for an
  `earned` budget source. It accepts only a completed passed assessment,
  deduplicates by assessment identity, scales the configured award by score,
  and caps the learner's available earned minutes. The Games host posts that
  identity/result only after a gate pass; a credit transport failure never
  reverses the earned match.
- The kiosk home gate now carries an optional, server-authored PianoChallenge
  descriptor from `GetPianoLessonGate`; `TodaysLessonGate` mounts `AskSession`
  only when it is present, preserving the ordinary course-card fallback. A
  passed result is posted to a narrow, authenticated completion endpoint, then
  the School launcher re-derives that the current assignment is settled before
  the ceremony bridge records evidence or announces completion. Completion is
  idempotent by assessment id and rejects descriptor ids no longer present in
  household configuration. Focused service, HTTP, launcher, kiosk, and
  ceremony tests pass (66 assertions).
