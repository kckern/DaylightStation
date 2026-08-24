# School operations

Operational tooling follows three rules: reads are safe, writes are dry-run by
default, and no command fabricates completion or rewards.

## Diagnose and monitor

```bash
node cli/school.mjs ops completion milo
node cli/school.mjs ops status milo
node cli/school.mjs ops monitor milo felix
node cli/school.mjs ops monitor milo felix --watch --interval 15
node cli/school.mjs ops timeline milo --limit 50 --teacher parent --pin-env SCHOOL_PIN
node cli/school.mjs ops session ses_123 --teacher parent --pin-env SCHOOL_PIN
node cli/school.mjs ops gates milo
node cli/school.mjs ops audit --since 2026-08-01T00:00:00Z
node cli/school.mjs ops agenda-preview milo --output /tmp/milo-agenda.png
node cli/school.mjs ops artifact art_123 --view manifest --teacher parent --pin-env SCHOOL_PIN
```

`completion` returns the four-state daily projection. `status` joins completion,
the current assignment, and today's sessions. `monitor` observes one or more
learners once or continuously.

`timeline` and `session` are the incident-investigation pair. These teacher
record reads, artifact manifest/original reads, and postview reads first unlock
with `--teacher ID --pin-env NAME`; only postview additionally requires a
one-use scoped step-up. `gates` joins the
current completion, assignment, milestone, and pass-override projections.
`agenda-preview` renders without minting sessions or tokens. Artifact manifest
and original-PDF reads identify the exact issued bytes.

Use `--base-url URL` or `SCHOOL_BASE_URL` to target another lifecycle API.

## Teacher workspace authorization

The browser's selected profile is attribution, not authority. The first
protected record read or write for that profile unlocks a process-local
capability through
`POST /api/v1/school/teacher/auth/unlock`; the server returns only expiry
metadata and keeps the random token in an HttpOnly, SameSite=Strict cookie.
The cookie idles out after 10 minutes and has a 30-minute absolute lifetime. A
server restart deliberately invalidates every browser session. The workspace
checks status at startup, exposes an explicit **Lock** action, and pauses and
replays at most one write when an expired session needs to be unlocked again.

PIN text is held only by the visible prompt while its request is in flight. It
is never put in React context, browser storage, logs, or an ordinary mutation
body. Agenda dispatch, applying or retracting a grade correction, applying a
bulk regrade, superseding a frozen period, and rendering a postview PDF require
the PIN again. That confirmation mints a two-minute, one-use grant bound to the
exact action and learner, bank, session/adjustment, period, or artifact. The
client sends the grant in `X-Teacher-Step-Up`; the server consumes any presented
grant whether it matches or not.

CLI mutation commands remain compatible with a literal `pin` body. Protected
teacher record/artifact reads perform an unlock for that invocation, forward
the returned cookie internally, and never print or persist the capability
token; postview additionally mints and consumes its scoped one-use grant.

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

# Preview, then dispatch one durable agenda print
SCHOOL_PIN=... node cli/school.mjs ops agenda-dispatch milo \
  --teacher kckern --pin-env SCHOOL_PIN
SCHOOL_PIN=... node cli/school.mjs ops agenda-dispatch milo \
  --teacher kckern --pin-env SCHOOL_PIN --idempotency-key agenda-milo-20260824 --apply

# Preview, then append a grade correction (never overwrite machine evidence)
SCHOOL_PIN=... node cli/school.mjs ops grade-adjust ses_123 \
  --percent 92 --reason "scanner read an erased bubble" \
  --teacher kckern --pin-env SCHOOL_PIN
SCHOOL_PIN=... node cli/school.mjs ops grade-adjust ses_123 \
  --percent 92 --reason "scanner read an erased bubble" \
  --teacher kckern --pin-env SCHOOL_PIN --base-revision 7 --apply

# Other dry-run-first repair lanes
SCHOOL_PIN=... node cli/school.mjs ops grade-retract ses_123 --adjustment adj_1 \
  --reason "correction applied to wrong session" --teacher kckern --pin-env SCHOOL_PIN
SCHOOL_PIN=... node cli/school.mjs ops regrade science/how-chemistry-surrounds-you/01-checkpoint \
  --from-day 2026-08-01 --to-day 2026-08-24 --reason "bank answer-key correction" \
  --teacher kckern --pin-env SCHOOL_PIN
SCHOOL_PIN=... node cli/school.mjs ops reassign assessment_123 --from milo --to felix \
  --day 2026-08-24 --teacher kckern --pin-env SCHOOL_PIN
```

Without `--apply`, commands either call a server preview endpoint or print the
exact redacted request and do not mutate School. PINs are read only from the
named environment variable and never printed. Assignment/enrollment operations
read the current assignment revision; grade correction/retraction accept the
session base revision. Agenda dispatch sends one caller-selected idempotency key
in both header and body. A retry with the same payload replays its receipt; a
conflict or crash-indeterminate reservation returns 409 rather than risking a
duplicate print.

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
