# School — day-to-day operations runbook

This is the **operator's** runbook: what to do when something in the running
household School goes wrong — a scan that produces nothing, a printer that
jams, a chime that doesn't fire, a kid who can't unlock Piano Games. It is
not about authoring curriculum, and it is not the architecture reference.

| If you want... | Go to |
|---|---|
| How School's subsystems work (identity, quizzes, printing, timing, catalog...) | [`docs/reference/school/README.md`](../../reference/school/README.md) |
| To stand up School from an empty data volume | [`school-cold-start.md`](../school-cold-start.md) |
| To turn on the physical console (cards, OMR, thermal printer) for the first time | [`school-physical-console-deploy.md`](../school-physical-console-deploy.md) |
| To author worksheets/quizzes/print documents | [`docs/reference/school/authoring/`](../../reference/school/authoring/) |
| The CLI toolkit for inspecting/repairing live state | [`docs/reference/school/operations.md`](../../reference/school/operations.md) |
| **Something is broken right now** | Keep reading |

## In this runbook

- **[logs-and-tracing.md](./logs-and-tracing.md)** — how to query the log store
  for School, the correlation keys, and the event sequence each physical
  pipeline produces when healthy, so you can diff a broken run against it.
- **[hardware-troubleshooting.md](./hardware-troubleshooting.md)** — the
  kitchen laser printer, the thermal receipt printer(s), the OMR bubble-sheet
  reader, the barcode/NFC card scanner, and the Portal kiosk: symptom →
  diagnosis → fix.
- **[home-assistant-grading-hook.md](./home-assistant-grading-hook.md)** — the
  integration that fires a Home Assistant script (sound/scene) when a paper
  scan grades. This is the piece people most often forget exists, because half
  of it lives outside this repository.
- **[known-issues.md](./known-issues.md)** — currently-open recurring
  production issues, and two real 2026-08-25/26 incidents with root causes and
  fixes, kept as case studies for the failure patterns they reveal.

## The three physical loops

Almost everything an operator troubleshoots is one of three loops. Each is
documented end-to-end in `logs-and-tracing.md` with its healthy event
sequence:

1. **Self-service card/keypad → agenda or worksheet on the laser printer.** A
   personal NFC card or a typed panel code resolves to a learner and prints
   what they should do next.
2. **OMR bubble-sheet scan → grade → thermal receipt → Home Assistant sound
   cue.** A filled-in answer sheet goes into the reader; the system grades it,
   prints a result receipt, and (if configured) makes a sound in the room.
3. **Living-room reading session.** A preschooler taps a personal card, then a
   book sticker, on the living-room NFC reader; the TV plays the book and the
   read counts toward that day's assignment. **This loop is brand new
   (2026-08-26) and not yet verified on real hardware** — see
   [`docs/reference/school/reading-sessions.md`](../../reference/school/reading-sessions.md)
   §11 for exactly what to watch the first time it runs for real.

## Quick health check

```bash
# Is the lifecycle wired at all? (school.yml lifecycle.enabled must be exactly `true`)
curl -s localhost:3111/api/v1/school/teachers
curl -s localhost:3111/api/v1/school/roster
curl -s localhost:3111/api/v1/school/teacher/today     # one row per learner, today

# Per-learner state
node cli/school.mjs ops status learner3
node cli/school.mjs ops completion learner3
node cli/school.mjs ops gates learner3

# Live, continuous
node cli/school.mjs ops monitor learner3 learner4 --watch --interval 15

# Print-document / OMR allocation integrity (read-only, exit 1 on any real defect)
node cli/school.mjs docs audit
```

See [`operations.md`](../../reference/school/operations.md) for the full CLI
surface, including the guarded-write repair lanes (`ops abandon`,
`ops rematerialize`, `ops grade-adjust`, `ops reassign`).

## Opening a program without an access code

For testing and admin. A child at the Portal still needs a code — the panel is a
kiosk with no address bar, so this door is reachable only from a grown-up's
browser.

```
/school/go/<learner>/<program>[/<instance>]
```

| Example | Opens |
| --- | --- |
| `/school/go/<learner>/sentence-ladder/<corpusId>` | that day's sentence queue |
| `/school/go/<learner>/book-log` | the reading shelf |
| `/school/go/<learner>/flashcards/<deck/with/slashes>` | a deck (the tail is kept whole) |

`GET /api/v1/school/lifecycle/direct-launch/programs` lists what can be opened
and which programs need an instance.

**What it does and does not weaken.** It drops the access code, not the
household: everything under `/api/v1` has already passed `permissionGate`, so
the code was a second, narrower factor. What is genuinely given up is that an
authenticated browser can open any learner's queue as that learner — which is
what an admin door is, and why every use logs `school.direct-launch.issued` at
**warn** with the learner named.

It mints the same launch target a code produces and hands it to the same
mounting path, so the runner, its session and its grant are indistinguishable
from the ordinary route. It does NOT dispatch to the Portal: the work opens in
the browser that asked, not on the tablet.

## The single most common "it's broken" false alarm

`school.yml` (`data/household/school/school.yml`) is **boot-cached**. Editing
it — enabling the console, changing a printer, fixing a teacher PIN — does
nothing until the container restarts. If a config change "didn't take,"
restart before you debug anything else.
