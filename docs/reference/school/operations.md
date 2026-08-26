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
node cli/school.mjs ops launch-preview milo --subject arts
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

## Preview a launch card

A launch card is what the school-room panel puts on screen after a child types
a six-digit code: whose work, where it sits in the course, how far along it is,
and the one next action. Checking one — a poster that will not resolve, a
breadcrumb that reads wrong, a button offering the wrong thing — needs no code
and no paper.

```bash
node cli/school.mjs ops launch-preview milo --subject arts
node cli/school.mjs ops launch-preview milo --subject scripture --continue
node cli/school.mjs ops launch-preview milo --subject arts --resolve
```

The command prints a link and mints nothing:

```json
{
  "schema": "school.launch-preview-link/v1",
  "learnerId": "milo",
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

**The route.** `GET {app}/launch-preview/<payload>` in the browser;
`GET /api/v1/school/self-service/preview/<payload>` for the card as JSON. The
payload is base64url of `{"learnerId": "...", "subject": "..."}`, optionally
with `"continueToday": true`. Learner plus subject is the whole payload because
that is exactly what a live panel token carries — the unit comes from the
learner's plan, so a payload naming one would describe a card the plan does not
actually offer.

Generating a link by hand is a one-liner when the CLI is out of reach:

```bash
node -e 'process.stdout.write(Buffer.from(JSON.stringify({learnerId:"milo",subject:"arts"})).toString("base64url"))'
```

**It resolves through the panel's own path.** The payload replaces one step and
one step only: the registry lookup that turns six digits into a learner and a
subject. Everything after that — the plan projection, the read-only session
reduction, the card builder — is the code a typed panel code runs. A preview
that assembled a card any other way would answer questions about a surface the
house does not run.

**It mints nothing and it grants nothing.** No token is looked up or created,
no session opens, no cooldown arms, no artifact is issued, nothing prints. The
link is not a credential: it carries less than the paper a child is already
holding, expires never because there is nothing in it to expire, and restores
no learner identity on the panel.

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
