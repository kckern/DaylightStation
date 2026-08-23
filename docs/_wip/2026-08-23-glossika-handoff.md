# Glossika × School integration handoff

Status: implementation continued 2026-08-23.

The repository had the design plan but not this handoff file. The integration
now includes:

- `program_dispatched` session events, replay/apply support, and a Portal-safe
  next action;
- `programInstance` on program units;
- validated language enrollment policy (`lessonSize`, enrollment-owned rungs,
  corpus scope, and non-signoff rewards);
- corpus banks and scoped queue admissions;
- taxonomy mapping for language course/unit/lesson labels;
- per-enrollment queue sizing and credit-chain filtering;
- deterministic language-day completion events and the lazy,
  idempotent `CloseLanguageDay` bridge;
- reward overrides and receipt suppression for program sessions;
- program session visibility in the planner;
- corpus-instance routing through keypad launches;
- lock-mode Glossika completion/device messaging and repetition-save retry;
- assignment persistence of `programs:` policy records.

## Household data to publish

Household plans are intentionally outside the tracked repository. For each
learner, add a program policy and assign the program unit:

```yaml
units:
  - language-daily
programs:
  - programId: language
    corpusId: glossika-korean
    lessonSize: 10
    rungs: [repetition, dictation, recording, interpretation]
    unitSize: 10
    reward: {amount: 2}
    scope: [fluency-1]
```

The unit should carry `programInstance: glossika-korean`, and the corpus may
declare validated `banks:` ranges. Existing `daily_limit` remains a fallback
for learners without a `programs:` policy.

## Verification

Focused Glossika/School tests pass, including session replay, queue scope,
taxonomy, planner behavior, launch routing, frontend completion behavior, and
the language-day bridge. A repository-wide Vitest run is not a useful gate in
this sandbox because unrelated live/integration suites require unavailable
local services and listening sockets; those failures are environmental rather
than Glossika failures.
