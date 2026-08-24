# Sentence Ladder × School integration handoff

Status: implemented on the School remediation branch; not described as
deployed until a production rollout is independently verified.

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

Assignment writes validate and normalize program policy before persistence.
Invalid stored legacy policy faults loudly rather than silently unenrolling the
learner.

Operations use `node cli/school.mjs ops`: `status` and `monitor` are read-only;
`assign`, `enroll`, `rematerialize`, and `abandon` are dry-run unless `--apply`
is supplied, and teacher PINs are read only from `--pin-env NAME`.

See [Sentence Ladder reference](../reference/school/sentence-ladder.md) and
[program operations](../reference/school/programs.md).
