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

## Word ladder trace

`school word-ladder trace` prints one learner's word-ladder sittings as a
timeline: a header per sitting trace, step sections, then one line per item
(time, kind, word, task/layout, response, correct/score, ms, state
transitions, why it was served, how it was answered) with what happened on
it underneath (audio, takes, skips, verdicts, stalls, plan changes), the item
a sitting ended on marked when it did not end on the goal or the time cap,
and a summary footer. Use it when a child says a word "didn't count",
a sitting stopped early, or a screen sat idle. The events it reads are listed
in [word-ladder.md → Logs](../../reference/school/word-ladder.md#logs).

```bash
# Today's sittings, live and test
node cli/school.mjs word-ladder trace --learner <learner-id>

# One study day, live sittings only
node cli/school.mjs word-ladder trace --learner <learner-id> --day YYYY-MM-DD --mode live

# One sitting (the sittingId from a log line or the console's Words view)
node cli/school.mjs word-ladder trace --learner <learner-id> --sitting <pkg>.<token>.<n>

# A grown-up's /test run
node cli/school.mjs word-ladder trace --learner <learner-id> --mode test

# Point it at the log store explicitly (default: $DAYLIGHT_LOGSTORE)
DAYLIGHT_LOGSTORE={env.log_store_url} \
  node cli/school.mjs word-ladder trace --learner <learner-id> --day YYYY-MM-DD
```

- **Ordering is by `seq` within a trace**, never by the store's `_time`
  (it stamps local time as UTC). Backend `graded` / `transition` events are
  attached to the item they belong to by `sittingId` + `itemId`.
- **Fallback:** when the log store is unreachable or has aged out (7 days),
  the CLI reads the learner's day files under
  `<data-dir>/users/<learner-id>/apps/school/word-ladder/<pkg>/days/`
  (`--data-dir` to point at the data volume). A day file has absolute
  times but no per-item `ms` or stall detail, and the output says so.
- A warning that the query hit its row limit means the output may be cut
  short: narrow it with `--day`, `--sitting` or `--mode`.

### How to evaluate a sitting

Read the trace top to bottom; each part answers one question.

1. **The header** — `learner · package · day · live/test · trace · active
   time · ending`. An ending of `unknown` means no close event reached the
   store (a killed or slept tab). If a later sitting idle-closed it, the
   block ends with `⚠ abandoned — idle m:ss, last answer …, on screen …`.
2. **Section headers** (`── Learn · round 1 ──`, `── Review ──`,
   `── Drill d1 ──`, `── Practice p1 ──`, `── Done ──`) — the order the day
   ran in. Review comes first when rechecks are due; a round is Learn › Sort ›
   Quiz › Match.
3. **Why each item** — `· why <reason>` on the item line (from
   `item.served`; the reasons are tabled in
   [word-ladder.md → Logs](../../reference/school/word-ladder.md#logs)). A
   sequencing question ("why was this word quizzed again?") is answered by
   the reason plus the `⇢` plan lines under the answer before it: `⇢ round
   r1: stream → quiz [word:task …]` is the exact quiz queue,
   `⇢ <word> recognized 1 · matched (needs stage<1)` is a word's climb.
4. **What the child did** — `· via key:Space` / `touch` on the line;
   `↷ skipped`, `? show me`, `⟲ flipped`, `▣ verdict … shown` and `▣ next
   via … after Ns` underneath. A long `▣ next … after` means the verdict
   panel sat on screen, not the item.
5. **What they heard** — `♪ term auto → ended`. `⚠ ♪ … → blocked` means the
   browser refused autoplay; `error` means the clip failed to load. No `♪`
   line at all on an item that should speak means no clip was ever started.
6. **Recording** — `● take started / stopped / uploaded (Ns long)`. A say
   step that ends in a few seconds with no `●` line and a `↷ skipped` was
   skipped; a `⚠ ● take unavailable` means no microphone. Takes are never
   graded.
7. **Stalls** — `⚠ stalled 45s` / `120s`. `(tab hidden)` means the screen
   was off or the app switched, so nobody was stuck; `(on the verdict)` means
   the answer was in and the child had not pressed Next. `◐ tab hidden` /
   `◑ tab visible` lines bracket the gap.
8. **The footer** — counts (items, answered, wrong, skipped, show-me,
   stalls with how many hidden, audio with failures, takes), `time:` per
   step, the wrong answers, and each word that `climbed` or `slipped`.

For the raw rows behind any line:

```bash
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query=_msg:~"school.word-ladder" AND data.sittingId:"<sittingId>" AND _time:1d' -d limit=2000
```

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
| `/school/go/<learner>/word-ladder` | the learner's current word-ladder enrollment |
| `/school/go/<learner>/word-ladder/test?scenario=fresh\|due\|round-end\|tricky\|typos\|done` | a **read-only** word-ladder sitting — nothing typed, sorted, spoken or recorded is saved |

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

**Word ladder needs FKB autoplay on the Portal.** The word ladder's cue and
answer audio play without a tap-to-unlock gesture once the sitting's own
**Start** button has run, but on the Portal itself FKB's autoplay setting
still has to be **enabled** for that unlock to hold — a Portal with autoplay
off leaves every clip behind a blocked-audio icon (`audio.played outcome:
blocked` at warn; the trace shows `⚠ ♪ term auto → blocked`) instead of playing. Check it under FKB's own settings before
troubleshooting "no sound" as a code bug.

**Testing the word ladder without touching a real learner's record**: open
`/school/go/<learner>/word-ladder/test`, optionally with
`?scenario=fresh|due|round-end|tricky|typos|done` to seed a specific state
(`tricky` opens straight on the tricky-word drill; `typos` opens on
typed sign-off rechecks worth misspelling to exercise the typed judge — the
round-end quiz is recognition only and types nothing) — see
[`word-ladder.md`](../../reference/school/word-ladder.md#the-door-and-test).
The banner reads "TEST — nothing is saved", and a backend test
(`WordLadderTestMode.test.mjs`) enforces that promise — every real file on
disk is byte-identical before and after a full test sitting, including any
spoken take: test mode's recordings sink (`DiscardingRecordings`) counts a
take and drops it, never writing to
`media/school/recordings/word-ladder/<package>/<learnerId>/<studyDay>/`.

**On-screen jamo keypad**: every typing item (copy, dictation, graded typed
input, drill copy/dictation/type) offers a toggleable two-set (두벌식) jamo
keypad — there is no web API to detect a Bluetooth keyboard, so it is a
manual toggle plus a 10-second auto-open (once per item, only while the
field has had focus with no keydown) that closes itself on the first
physical keystroke. If a child on the Portal seems unable to type Korean,
check the keypad opened rather than assuming a missing IME.

## A worksheet says "We could not make that sheet"

The Portal's print button came back `render_failed`. Query the log store for
the reason before touching anything — it is on the `school.issue.failed`
event (`data.reason`) and on the session record's `failed` event:

```bash
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query="school.issue.failed" AND _time:1h' -d 'limit=10'
```

- **`Missing open brace for subscript in TeX: …___`** or any other MathJax
  message: the bank carries TeX that does not render. Since 2026-09-15 the
  publish step refuses such a document (`INVALID_DOCUMENT_TEX`) before any
  card row is claimed, and the elementary-math generator's audit refuses to
  write it, so this reaches a child only from a hand-authored bank. Fix the
  bank (an authored `\_` in a JavaScript string must be `\\_`), restart the
  container — banks are cached in memory for the life of the process — and
  have the child scan again. Nothing else to clean up: cancelled allocations
  release their rows, and the next allocation reclaims the tail.
- **A retry always fails the same way.** Deterministic content errors do not
  heal on retry; the "tell a grown-up" sentence is right. Each retry used to
  burn a fresh row range on the answer card and could roll it over; it no
  longer does.

## A child says a sheet is "done" but nothing graded it

Since 2026-09-15 every feed of an answer card prints something: a result
receipt for each sheet that graded, and a **notice slip** for each that did
not ("SOUTH DAKOTA — NOT FINISHED YET · 5 of 6 answered · Row 33 is still
empty"). If the child has a slip, do what it says. If they have nothing,
the printer did not print — check `school.print.scan-slip` in the log store
for `printed:false` and its `reason`, then the receipt printer itself.

Before this, the only messenger was the panel toast, and a re-fed unfinished
card said "No new result recorded", which children hear as "done". The
scan rows themselves are on record in
`records/assessments/omr/<reader>/<date>.yml`; a row missing there is a
bubble missing on paper, not a grading fault.

## The single most common "it's broken" false alarm

`school.yml` (`data/household/school/school.yml`) is **boot-cached**. Editing
it — enabling the console, changing a printer, fixing a teacher PIN — does
nothing until the container restarts. If a config change "didn't take,"
restart before you debug anything else.
