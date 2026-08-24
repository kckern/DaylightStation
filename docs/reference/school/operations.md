# School operations

Operational tooling follows three rules: reads are safe, writes are dry-run by
default, and no command fabricates completion or rewards.

## Diagnose and monitor

```bash
node cli/school.mjs ops completion milo
node cli/school.mjs ops status milo
node cli/school.mjs ops monitor milo felix
node cli/school.mjs ops monitor milo felix --watch --interval 15
```

`completion` returns the four-state daily projection. `status` joins completion,
the current assignment, and today's sessions. `monitor` observes one or more
learners once or continuously.

Use `--base-url URL` or `SCHOOL_BASE_URL` to target another lifecycle API.

## Simulate

Existing `node cli/school.mjs sim ...` commands are the deterministic test and
hardware-simulation surface. Use simulation for scenarios; use `ops status` and
`ops monitor` for live read-only observation.

## Guarded writes

```bash
# Preview an assignment write
SCHOOL_PIN=... node cli/school.mjs ops assign milo \
  --file plan.yml --teacher kckern --pin-env SCHOOL_PIN

# Apply enrollment
SCHOOL_PIN=... node cli/school.mjs ops enroll milo \
  --syllabus come-follow-me-ot-2026-lower \
  --teacher kckern --pin-env SCHOOL_PIN --apply

# Rebuild a frozen enrollment snapshot
SCHOOL_PIN=... node cli/school.mjs ops rematerialize milo \
  --syllabus come-follow-me-ot-2026-lower \
  --teacher kckern --pin-env SCHOOL_PIN --apply

# Resolve a ghost session explicitly
SCHOOL_PIN=... node cli/school.mjs ops abandon ses_123 \
  --learner milo --reason "worksheet lost" \
  --teacher kckern --pin-env SCHOOL_PIN --apply
```

Without `--apply`, commands print the exact redacted request and do not mutate
School. PINs are read only from the named environment variable and never
printed. Assignment and enrollment operations read the current assignment
revision and carry it as the stale-write guard.

## Repair posture

- Re-materialize rather than hand-editing a frozen enrollment.
- Abandon an irrecoverable open session rather than deleting its events.
- Use attribution repair to move evidence; do not copy aggregate scores.
- Use attestation only to record an explicit adult override. It unlocks
  planning but remains separate from engine grades.
- Use regrade in dry-run first and preserve the correction provenance.
- Never force daily completion or insert reward ledger rows as a shortcut.

See [program operations](./programs.md#operations-cli) for program-specific
notes and [assessment and feedback](./assessment-and-feedback.md) for evidence
repair semantics.
