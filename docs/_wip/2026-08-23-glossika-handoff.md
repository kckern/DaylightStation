# Sentence Ladder × School integration handoff

Status: merged to `main`. The production public corpus endpoint was verified
on 2026-08-24; the authenticated real-device lifecycle still requires an
independent acceptance pass before this handoff calls the rollout fully
verified.

`Sentence Ladder` is the domain name because it identifies the actual method:
each sentence advances through repetition, dictation, recording, and
interpretation on successive study days. Glossika is retained only where it
describes vendor provenance, the recovered importer, or a corpus id.

The integration now includes validated per-corpus program assignments,
instance-scoped status, server-derived queue admission at every evidence write,
recording-only recording credit, capability-consistent writes, and a
short-lived HMAC study grant bound to learner and corpus. The browser keeps
that grant in memory. Direct URLs and refreshes cannot manufacture launch
authority. Canonical ids and routes use `sentence-ladder`; `language` remains a
deprecated compatibility alias for stored assignments and old clients.

The frontend requires an explicit corpus and launch grant. It handles
out-of-order loads, renders the required “finish on another device” state, and
never exposes Sentence Ladder as a general Language shelf.

The code-level lifecycle is covered from self-service keypad mount through all
four offered modes, canonical/legacy completion settlement, configured reward
handoff, and completion-state emission. The locked runner distinguishes
`Leave for now` from the final `Done`, acknowledges saved School progress on
completion, and emits structured progress diagnostics without duplicating an
unchanged state. Empty and capability-blocked queues now render distinct,
escapable states; rejected audio returns to a usable start control; history
loads can be retried; and microphone streams are released on capture setup
failures.

Assignment writes validate and normalize program policy before persistence.
Invalid stored legacy policy faults loudly rather than silently unenrolling the
learner.

Operations use `node cli/school.mjs ops`: `status` and `monitor` are read-only;
`assign`, `enroll`, `rematerialize`, and `abandon` are dry-run unless `--apply`
is supplied, and teacher PINs are read only from `--pin-env NAME`.

See [Sentence Ladder reference](../reference/school/sentence-ladder.md) and
[program operations](../reference/school/programs.md).
