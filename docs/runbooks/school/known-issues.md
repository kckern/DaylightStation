# School — known issues and incident case studies

## Currently-open recurring issues

**As of 2026-08-26**, mined from the last retained week of production logs.
Re-verify with the queries in [`logs-and-tracing.md`](./logs-and-tracing.md)
before trusting this list long — these are live-system facts, not code facts,
and they age out.

| Issue | Evidence | Likely fix |
|---|---|---|
| `school.generated-banks.recipes-missing` fires every single day of the retained window | Missing `data/content/school/generated-banks/recipes.yml` | Author/regenerate the recipes file, or accept the empty generated-bank shelf as intentional and stop treating the warning as a signal |
| `come-follow-me-ot-2026` curriculum work is broken for at least one learner | `school.curriculum.invalid-works` (`progression.mode must be sequential\|module_blocks`, 2026-08-24) and `school.agenda.plan-errors` ("assigned but no published units belong to it", recurring 08-25/26 for `learnerId: user_3`) | These are almost certainly one root cause in the work's own definition. Note: a *related but distinct* draft-review-state version of this same course was fixed 2026-08-25 (see the incident below) — verify whether user_3's remaining error is the same `progression.mode` schema defect or a fresh recurrence before re-diagnosing from scratch |
| `school.materials.source-failed` — Plex "Kids Courses"/"Art Lessons" timing out after 25000ms | Recurs across 3+ of the last 4 days, same two sources every time | Check Plex responsiveness for those two libraries directly; this is upstream of School |
| `laser-printer.validate-job-rejected` (IPP status 1285) | Recurring most days against the kitchen printer | Check the printer's current IPP job-validation/media settings; cross-reference with `hardware-troubleshooting.md` §1 |
| One-off `school.companion.unreadable` burst, ~110 retries in 9 minutes on 2026-08-26 | A single companion YAML record (`ral_h1IAmJ6QEiJi`) had a duplicated `lastUpdatedAt:` key — a concurrent-write race corrupted it | Verify the file is now clean; if this recurs, the underlying race in the companion-record writer needs a real fix, not just a manual repair |
| `school.language-reels.daily-none-approved` fires daily for one learner | Recurring 08-25/26 — this learner routinely has zero approved language reels for the day | Confirm whether daily reels are expected for this learner; if so, this is a content-pipeline gap, not a transient blip |

## Incident case studies

Full postmortems live in `docs/_wip/bugs/` — these are condensed for the
failure *patterns* they reveal, which recur in other subsystems too.

### 2026-09-06 — one reading code, thirty-six opens, and a finish dated into a closed week

Reported as "abuse of the reading code by an unauthorized learner". The logs
could not confirm who was typing it — and that turned out to be the finding, not
a limit of the investigation.

**What the store showed.** One `book-log` code, minted 07:55, was typed 13 times
between 07:56 and 13:01 and opened the shelf 15 times. The day before, another
was typed 11 times in five minutes. 36 backend resolutions across two days, all
naming the same learner. No other code in the retained window behaves this way —
every other one resolves once or twice and stops.

**Four separate gaps, and only the first was suspected.**

1. *A code had two clocks and no counter.* Both bounded how LONG it stays
   typable; neither bounded how many times it opens something. Live until the
   4am rollover, so up to ~21 hours of unlimited use. Documented at the time as
   deliberate — "there is no throttle and no lockout anywhere in this path" —
   and it WAS the right call when a code opened one lesson. It stopped being
   right the day one opened a free-form shelf.
2. *Typing a code silently claims the learner.* Every `code.resolved` was
   followed immediately by `school.profile.claimed`. Whoever typed it became
   that child for attribution, which is why the logs cannot answer the question
   that was asked. Identity at the panel is a soft self-declared tap by design;
   the gap was that a code claimed *before* anyone was asked.
3. *Wrong codes were not throttled.* 126 rejections in 14 days, in bursts — 8 in
   3 minutes, 7 in 65 seconds, 6 in 8 seconds — none of it above `info`.
4. *The shelf accepted data no reading session produces.* Page **250** on a
   **192**-page book, then page 5 fifteen seconds later; and a book opened
   09-06T15:07Z whose `finished` event was stamped **2026-08-19**, eighteen days
   before it was opened.

**Two silent downstream effects of that fourth one, worth knowing because
neither surfaces as an error.** A shelf item takes its FURTHEST page, so the
page-5 correction did nothing and the item permanently reads 250 — there is no
retraction path for a progress event, only for a finish. And the shelf sorts on
the finish's own timestamp, so a book finished today sank below books touched
three weeks earlier, while the obligation window counted it in mid-August and
missed the day it was actually read.

**A fifth thing, found while fixing the others and unrelated to the abuse.**
Reachability of the reading shelf was derived entirely from a `book-log`
enrollment, although the shelf itself needs none. One child of four was
enrolled; the other three had no route to a reading log at all, silently.

**What changed.** Lesson codes are spent after three opens, counted when a button
opens something rather than on a lookup. Wrong codes are throttled per device —
not per IP, because every screen here reaches the backend through one reverse
proxy. A re-entered code asks "Is this you?" before it claims anyone. Backdating
is bounded to a fortnight on both write doors, and an implausible page is
refused while a merely-past-the-end one is still kept. The reading log is open to
every learner with its own daily code, and is deliberately uncapped — its own
learner chip, not a frequency limit, is what answers "whose log is this?".

**The pattern worth carrying forward:** the question was "who is doing this?",
and the system could not answer it because attribution happened before anyone
was asked. Three of the four gaps were only visible by cross-reading the log
store against the data volume; none of them raised anything above `info`.

### 2026-08-25 — one tap became five, and a timed-out print became blank paper

Full report: `docs/_wip/bugs/2026-08-25-school-morning-scan-and-print-incident.md`

One physical NFC tap produced **five electrical reads in 103ms**. Two
independent bugs compounded:

- **The relay's dedup guarded the wrong path.** It protected the persisted
  day-log, but everything that *acts* on a tap — including printing —
  subscribed to the unconditional broadcast that ran first.
- **The cooldown was check-then-act across two `await`s with no lock.** All
  five concurrent taps passed the cooldown gate before any of them armed it.
  *A second, independent entry point into the same race existed* in the
  QR/barcode scan path — fixing only the relay would have looked solved while
  leaving the defect reachable another way.

Result: 4 duplicate "ghost" sessions, phantom gradebook entries, and 5 live
panel access codes where 1 was intended.

Separately, and independently: **a timed-out thermal print job wasn't
actually aborted**, just abandoned. Its connect eventually completed anyway,
seconds after the caller had already been told "refused" and the scratch
file deleted — so it printed blank paper, cut it, and logged a phantom
success, while the system's own record said the job never happened.

**The general lesson:** a dedup/cooldown guard placed on the *persistence*
path does not protect anything that reacts to the *broadcast* path if the two
aren't the same gate. And a timeout that only stops waiting — without
destroying the underlying resource — leaves a zombie that can act later,
after the caller has already moved on and cleaned up.

### 2026-08-26 — a fed sheet produced no ceremony and no sound

Full report: `docs/_wip/bugs/2026-08-26-school-scan-silent-on-unmarked-live-rows.md`

A child fed a cumulative OMR card **four times over 2.5 minutes**. Every
decode succeeded. The room stayed completely silent: no receipt, no banner,
no tone. The system carries an explicit, tested guarantee that "a scan never
ends in silence" — the guarantee's own backstop code existed and was correct,
but the diagnostic written for exactly this signature (`silentLiveRecords`,
added in an earlier fix) sat **one line below** an early `return` that made
it structurally unreachable in the one case it was written for: nothing else
graded, so nothing else spoke, and this diagnostic never got a turn.

Root physical cause: the card was cumulative — old worksheets' marks were
still on it, and the child's new worksheet's rows were genuinely blank. The
correct answer was "your new rows are blank, fill them in" — the machine had
that answer computed and simply never said it.

**The general lesson, stated in the fix itself:** a backstop guarantee that
lives *below* an early return cannot protect any code path that exits above
it. The durable fix wasn't just handling this one case — it was restructuring
so every terminal exit funnels through one place that asserts a ceremony was
emitted, so a *future* early return can't silently opt out of the guarantee
the way this one did.

### The whole-subsystem outage lesson (from `failure-policy.md`)

Not a School-specific bug, but a pattern worth carrying into every future
School change: a course-content source once did a file read **at module
import time**. When that file was absent from a build, the throw fired
before the composition root's own try/catch around app startup ever ran —
taking down fitness, finance, kiosks, and every other subsystem over one
missing school content file. The fix was structural: **no filesystem or
network I/O at module scope, anywhere under `backend/src`** — see
[`failure-policy.md`](../../reference/school/failure-policy.md) for the full
rule. If a future School change adds a module-scope read, it is not a School
bug waiting to happen — it is an every-other-app-in-the-house bug waiting to
happen.

## Patterns worth recognizing (from the fix-commit history)

These are recurring *shapes* of bug across School's history, useful for
recognizing a new instance quickly rather than diagnosing from zero:

- **Sessions getting "stuck."** A quiz/reading session left in an
  intermediate state (never reaches a terminal outcome) is a repeated failure
  family — server timeouts silently bouncing a child to the menu, a resumed
  quiz minting a *new* session id and splitting one child's answers across
  two records, an append failure leaving a gap that makes every future resume
  attempt refuse and loop until a TTL clears it. **The sanctioned repair is
  `node cli/school.mjs ops abandon <sessionId> --reason "..." --apply`** —
  never edit or delete session events directly; see
  [`operations.md`](../../reference/school/operations.md).
- **Mode/attribution confusion.** Keeping "someone else is using this" as a
  genuinely distinct state from "this session's own activity," and deciding
  attribution once (at the moment of choice) rather than re-deriving it later
  from whoever happens to be present, has repeatedly been the fix for
  mis-credited work. The living-room reading session (`reading-sessions.md`)
  is the newest and most deliberate instance of this design.
- **Scheduling edge cases fail toward "assign the work," never toward
  "silently excuse it."** An unparseable schedule, an unrecognized config
  key, or a date-parsing quirk (e.g. `Date.parse` silently rolling an invalid
  day into the next month) must all fail **open** — the child still gets
  their agenda — rather than silently excusing a whole term. See
  [`timing-and-priority.md`](../../reference/school/timing-and-priority.md)
  §7 for the current, deliberately strict validator this drove.
- **A silent per-item skip (draft content, a missing bank) is fine; a silent
  per-item skip with no count and no identifiers is not.** This is the
  literal text of [`failure-policy.md`](../../reference/school/failure-policy.md)
  and shows up as the root cause of more than one "why does this child have
  nothing to do today" investigation.
