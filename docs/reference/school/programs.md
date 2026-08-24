# School programs

A program unit delegates evidence and progress to a registered
`IProgramLauncher`; School still owns assignment, agenda obligation, launch
authority, and rewards. Program status is keyed structurally by program id and
instance, so one corpus cannot answer for another.

Assignment writes validate every program record before persistence, reject
unknown/duplicate policies, and normalize known legacy ids. A launcher failure
faults only that program entry and makes completion indeterminate when the
program was required.

Sentence Ladder is the first code-registered program. Its canonical id is
`sentence-ladder`; `language` is a deprecated read/write compatibility alias.

## Operations CLI

The complete operational contract is in [School operations](./operations.md).
The examples below are the program-facing subset.

`node cli/school.mjs ops` supports testing and household operations:

```bash
# Read only
node cli/school.mjs ops status milo
node cli/school.mjs ops monitor milo felix --watch

# Prints a redacted request; does not write
SCHOOL_PIN=... node cli/school.mjs ops enroll milo \
  --syllabus come-follow-me-ot-2026-lower --teacher kckern \
  --pin-env SCHOOL_PIN

# Explicit mutation
SCHOOL_PIN=... node cli/school.mjs ops rematerialize milo \
  --syllabus come-follow-me-ot-2026-lower --teacher kckern \
  --pin-env SCHOOL_PIN --apply
```

Mutations are dry-run by default, fetch current assignment revision for the
stale-write guard, never print the PIN, and require `--apply`. Available writes
are `assign`, `enroll`, `rematerialize`, and `abandon`. Existing `school sim`
commands remain the deterministic simulation surface; `ops status/monitor`
cover live diagnosis. There is deliberately no generic “force complete” or
reward bypass.
