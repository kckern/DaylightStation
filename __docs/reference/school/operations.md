# School operations

Operational tooling follows three rules: reads are safe, writes are dry-run by
default, and no command fabricates completion or rewards.

## Diagnose and monitor

```bash
node cli/school.mjs ops completion learner3
node cli/school.mjs ops status learner3
node cli/school.mjs ops monitor learner3 learner4
node cli/school.mjs ops monitor learner3 learner4 --watch --interval 15
node cli/school.mjs ops timeline learner3 --limit 50
node cli/school.mjs ops session ses_123
node cli/school.mjs ops gates learner3
node cli/school.mjs ops review            # every question waiting on a mark
node cli/school.mjs ops review ses_123    # one session's queue
node cli/school.mjs ops audit --since 2026-08-01T00:00:00Z
node cli/school.mjs ops agenda-preview learner3 --output /tmp/learner3-agenda.png
node cli/school.mjs ops artifact art_123 --view manifest
node cli/school.mjs ops launch-preview learner3 --subject arts
```

`completion` returns the four-state daily projection. `status` joins completion,
the current assignment, and today's sessions. `monitor` observes one or more
learners once or continuously.

`timeline` and `session` are the incident-investigation pair. They, and the
`artifact` manifest/original/postview reads, take no `--teacher`: they read,
and only writes name a teacher. `gates` joins the
current completion, assignment, milestone, and pass-override projections.
`agenda-preview` renders without minting sessions or tokens. Artifact manifest
reads identify the durable worksheet recipe; PDF reads project that recipe
through the current rendering engine.

Use `--base-url URL` or `SCHOOL_BASE_URL` to target another lifecycle API.

Every write names its grown-up with `--teacher ID`, which must be an adult on
the roster listed in `teachers:` (any adult when the key is absent). That id is
the whole of a write's authority.

### A subject that will not turn green

`review` is the first thing to check when a child says they did the work. A
paper sheet with an unmarked question (two bubbles filled after the eraser
leniency budget is spent, an ungradeable free answer) stays `submitted`. That
holds the subject's lane shut: the kiosk offers only "exit" and will not print
the next page, and rescanning the card changes nothing (`scan-already-recorded`).
Rule each item; ruling the last one grades and settles the session:

```bash
node cli/school.mjs ops review
node cli/school.mjs ops review-resolve ses_123 --item north-dakota-statehood \
  --verdict correct --note "two marks, one right" --teacher kckern --apply
```

`--verdict` is `correct`, `incorrect`, or `void`; `void` requires `--note`,
because the child sees that question missing from their score. The hourly
`school.teacher-nudge` push is meant to surface this queue; it failed on every
run until 2026-09-25 (`Invalid notification category: "school"`).

## Answer-sheet identity rollout and incident recovery

Audit the production allocation directory before enabling holds:

```bash
node cli/school/answer-sheet-audit.mjs audit \
  --directory /path/to/household/school/artifacts/print/cards
```

`readyForEnforcement` must be true before changing `scan_protection.mode` to
`enforce`. The report names missing lineage, stale pending deliveries,
multiple-live-card learners, missing sessions, failed/unconfirmed prints, and
ambiguous successors. Failed-print history is informative; lineage,
multi-card, stale-live, and ambiguity findings block enforcement.

Legacy lineage can be planned without writing:

```bash
node cli/school/answer-sheet-audit.mjs backfill \
  --directory /path/to/household/school/artifacts/print/cards
```

Review the `manual` list. Only a one-learner, strictly ordered chronology is
eligible. Apply that exact plan with `--apply`; delivery state is never inferred
by this migration. Re-run `audit` afterward.

Ancient or ambiguous records require an explicit, attributed reconciliation;
the CLI never guesses delivery:

```bash
node cli/school/answer-sheet-audit.mjs reconcile \
  --directory /path/to/cards \
  --card 8684155 --record 'document@rev:v0:22-27' \
  --delivery-state delivered --generation 3 --predecessor 4071314 \
  --reviewer parent --reason 'verified against issued worksheet history'
```

That command is a dry run until `--apply`. Applied reconciliation appends its
reviewer, reason, timestamp, and exact patch to the allocation record.

Rollout order:

1. Set `answer_sheets.reuse: until_full` explicitly and leave protection `off`.
2. Run the audit and reconcile every blocking legacy record.
3. Set protection to `shadow`; watch
   `school.scan.identity-shadow-match` with candidate record IDs.
4. Investigate every unexplained shadow match, then re-run the audit.
5. Set protection to `enforce` only when both evidence sources are clean.

An enforced hold emits `school.scan.identity-held` and
`school.print.scan-answer-sheet-held`; no grade, attempt, session transition,
or remediation has happened. Open Teacher workspace → Action queue →
**Answer-sheet pairing**. Confirm only when the scanned worksheet is known;
reassign only when the displayed ordinal map is compatible; otherwise choose
redo. Reassigned or redone source rows remain quarantined. Clear a quarantine
only after visually verifying erasure, or after superseding the source and
printing it on clean rows. Review actions are append-only and require an
idempotency key, so retrying a timed-out request cannot create a second grade.

## Preview a launch card

A launch card is what the school-room panel puts on screen after a child types
a six-digit code: whose work, where it sits in the course, how far along it is,
and the one next action. Checking one — a poster that will not resolve, a
breadcrumb that reads wrong, a button offering the wrong thing — needs no code
and no paper.

```bash
node cli/school.mjs ops launch-preview learner3 --subject arts
node cli/school.mjs ops launch-preview learner3 --subject scripture --continue
node cli/school.mjs ops launch-preview learner3 --subject arts --resolve
```

The command prints a link and mints nothing:

```json
{
  "schema": "school.launch-preview-link/v1",
  "learnerId": "learner3",
  "subject": "arts",
  "continueToday": false,
  "link": "eyJsZWFybmVySWQiOiJtaWxvIiwic3ViamVjdCI6ImFydHMifQ",
  "url": "http://localhost:3111/school/launch-preview/eyJsZWFybmVySWQiOiJtaWxvIiwic3ViamVjdCI6ImFydHMifQ",
  "api": "http://localhost:3111/api/v1/school/self-service/preview/eyJsZWFybmVySWQiOiJtaWxvIiwic3ViamVjdCI6ImFydHMifQ",
  "mints": "nothing"
}
```

`--origin URL` and `--path /screens/portal` retarget the printed link at a
particular screen; without them it takes the origin from the API base and
assumes the browser's `/school` mount. `--resolve` also fetches the card into
the output, which answers most artwork and breadcrumb questions without opening
a browser at all. `--continue` previews the "one more?" card the result receipt
offers, which is otherwise unreachable when the subject is already served.

**The routes.** The operations CLI continues to emit the backwards-compatible
`GET {app}/launch-preview/<payload>` browser link and
`GET /api/v1/school/self-service/preview/<payload>` JSON read. Its payload is
base64url of `{"learnerId": "...", "subject": "..."}`, optionally with
`"continueToday": true`.

The teacher workspace does not emit that durable payload. Its **Preview**
control opens
`GET /api/v1/school/teacher/learners/:learnerId/launch-preview?subject=...`
synchronously in a named popup. The route signs a purpose-bound learner and
subject scope, redirects to `/school?preview=<token>`, and sets `no-store`.
That token can be reloaded for five minutes, then fails with an expired-preview
sentence and a way back. A malformed signed token never falls through to the
legacy unsigned decoder.

Generating a link by hand is a one-liner when the CLI is out of reach:

```bash
node -e 'process.stdout.write(Buffer.from(JSON.stringify({learnerId:"learner3",subject:"arts"})).toString("base64url"))'
```

**It resolves through the panel's own path.** The payload replaces one step and
one step only: the registry lookup that turns six digits into a learner and a
subject. Everything after that — the plan projection, the read-only session
reduction, the card builder — is the code a typed panel code runs. A preview
that assembled a card any other way would answer questions about a surface the
house does not run.

**It mints no school work and grants no action authority.** No panel token is
looked up or created, no session opens, no cooldown arms, no artifact is
issued, and nothing prints. A CLI link carries no authority and does not
expire. A teacher-workspace link is an HMAC-signed, five-minute read scope used
only by the preview resolver; no learner action endpoint accepts it, and it
restores no learner identity on the panel.

**Nothing on it can be pressed.** The card shows the real buttons a child would
see — that is the point of looking at it — rendered disabled beneath a band
reading *Preview — nothing here is live*. The card body is dimmed and
dash-bordered so a grown-up glancing at the Portal cannot mistake it for a
child's live work, and the only live control on the screen, *Leave preview*,
sits in the band outside the card. Acting on a card requires a six-digit code
the preview does not have, so there is no request it could make even if a
button were somehow reached.

**A bad link says so.** An unreadable payload, a payload missing a field, or a
backend that will not answer each render a sentence and a way out — never a
blank card and never an HTTP status. The panel's never-dead-end rule applies to
grown-ups too.

## Teacher workspace authorization

The browser remembers the picked teacher in localStorage — across reloads and
tabs — until **Sign out** on the header chip forgets it. Every write carries
that id (`actorId`, or the route's own field: `by`, `decidedBy`, `issuedBy`…),
and the server holds no teacher session: `TeacherGate` checks the id on each
call — a grown-up on the live roster, listed in `school.yml` `teachers:` when
the key is present. Agenda dispatch, grade corrections and retractions, bulk
regrades, superseding a frozen period and rendering a postview PDF pass the
same check as any other write.

A write tapped with nobody picked opens the picker and is replayed once a
teacher is chosen; dismissing the picker drops it. A 403 shows the server's
sentence on the panel and is not retried. The gated reads (a child's reading
shelf and detail, debriefs, sentence-ladder and card-ladder teacher reads)
name the teacher on the query string the same way.

The CLI sends `--teacher ID` as the write's actor field and nothing else.

## Simulate

Existing `node cli/school.mjs sim ...` commands are the deterministic test and
hardware-simulation surface. Use simulation for scenarios; use `ops status` and
`ops monitor` for live read-only observation.

## Guarded writes

```bash
# Preview an assignment write
node cli/school.mjs ops assign learner3 \
  --file plan.yml --teacher kckern

# Apply enrollment
node cli/school.mjs ops enroll learner3 \
  --syllabus come-follow-me-ot-2026-lower \
  --teacher kckern --apply

# Rebuild a frozen enrollment snapshot
node cli/school.mjs ops rematerialize learner3 \
  --syllabus come-follow-me-ot-2026-lower \
  --teacher kckern --apply

# Resolve a ghost session explicitly
node cli/school.mjs ops abandon ses_123 \
  --learner learner3 --reason "worksheet lost" \
  --teacher kckern --apply

# Preview, then dispatch one durable agenda print
node cli/school.mjs ops agenda-dispatch learner3 \
  --teacher kckern
node cli/school.mjs ops agenda-dispatch learner3 \
  --teacher kckern --idempotency-key agenda-learner3-20260824 --apply

# Preview, then append a grade correction (never overwrite machine evidence)
node cli/school.mjs ops grade-adjust ses_123 \
  --percent 92 --reason "scanner read an erased bubble" \
  --teacher kckern
node cli/school.mjs ops grade-adjust ses_123 \
  --percent 92 --reason "scanner read an erased bubble" \
  --teacher kckern --base-revision 7 --apply

# Other dry-run-first repair lanes
node cli/school.mjs ops grade-retract ses_123 --adjustment adj_1 \
  --reason "correction applied to wrong session" --teacher kckern
node cli/school.mjs ops regrade science/sample-science/01-checkpoint \
  --from-day 2026-08-01 --to-day 2026-08-24 --reason "bank answer-key correction" \
  --teacher kckern
node cli/school.mjs ops reassign assessment_123 --from learner3 --to learner4 \
  --day 2026-08-24 --teacher kckern
```

Without `--apply`, commands either call a server preview endpoint or print the
exact request and do not mutate School. Assignment/enrollment operations
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
