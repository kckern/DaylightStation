# Makeup work

A learner who misses required work on a school day can make it up later in the
**same week**, up to a configured deadline (Saturday by default). Once made up,
the missed day reads as served on the term grid and in the coins, as if the
work had been done that day. The credit is marked as makeup so a grown-up can
tell the difference.

This implements the economy taxonomy's D14 ("a grace window per obligation, a
way to serve a past day, and a `timeliness` stamp on the verdict").

## Configuration

`school.yml → makeup`, top level:

```yaml
makeup:
  enabled: true
  deadline: saturday        # last study day of the week that makeup counts on
  subjects: [math, english] # optional; omitted = every subject
```

| Key | Meaning |
|---|---|
| `enabled` | `true` turns makeup on. Absent or `false` keeps the old rule: a past day is settled when its window closes. A lesson a makeup sheet already claimed still counts for the day it was done (see Restitution). |
| `deadline` | A weekday name (`monday` … `sunday`) or ISO number 1–7. Makeup for a day counts only on days from the next day through this weekday of the same Monday→Sunday week. |
| `subjects` | Limits makeup to these subject ids. |

A malformed block turns makeup **off** and logs `school.makeup-policy.invalid`
with the errors. Makeup credit is never handed out by a typo. The block is
read at boot, so restart the backend after you edit it.

## What counts as making it up

Makeup credit is derived on every read. The one stored fact is a session's
`makeup_claimed` annotation, saying which missed day a makeup-sheet lesson is
for. Each day's term-grid row keeps a per-section `ledger` of the required work done
that day, split by track:

- `lessons`: required curriculum lessons passed that day;
- `programsDone`: required programs that reported done (a grown-up's bypass or
  a teacher excusal does not count as work);
- `needsLesson` / `needsPrograms`: what the section requires on a day that asks
  for it;
- `asked`: whether the calendar asked for the section that day at all. A
  Saturday section that was worked reads `served`, so its state alone cannot
  say whether the work was owed.
- `makeupClaims`: required lessons passed that day that a makeup-sheet code
  claimed for an earlier day, one entry each, naming that day. A claimed pass
  is not in `lessons`. The agenda reads it against the subject's whole
  curriculum, so a date-bound swap or a day-off keep-list cannot drop it.

`TermVerdictService` reads the week and moves **spare** work from a later day
onto an earlier missed section (`domain/makeup.mjs` `foldMakeup`):

- **Claims.** A lesson opened or reprinted from a makeup-sheet code is claimed
  for the oldest owed day the ticket names (`ClaimMakeupLesson`, event
  `makeup_claimed`). The claim holds while the pass falls after that day, no
  later than the claim's deadline, and in the same week
  (`honouredMakeupClaim`). A held claim never serves the day it was done on,
  and it does not stop that day's own lesson from being offered. It credits
  the day it names before any ordinary spare. If that day no longer needs it,
  it becomes ordinary spare for any other missed day.
- **Restitution.** A claim nothing could spend is paid back to the day it was
  done on, so a real lesson always counts for some day. This covers makeup
  turned off, a subject the policy leaves out, a policy deadline moved earlier
  than the claim's own, and a missed day that still lacks a program. The
  pass day's section must lack only that lesson. It reads `served` with
  `makeup: {servedOn: <that day>, restituted: true}`; the row is not stamped
  `timeliness: makeup`, is not listed in the row's `makeup`, and the economy
  counts the section on time. A day holding its own unspent claim takes it
  back before it may borrow anyone else's spare. Restitution runs even with
  makeup off.
- **Lessons.** A day's passes beyond the one the day itself asked for are
  spare. On a day that did not ask for the section (a Saturday, a holiday),
  every pass is spare. Two math lessons on Thursday make up one missed math
  day. One math lesson on Saturday also makes up one missed math day.
- **Programs.** A program reports done at most once a day, so it has no spare
  on a day that owes it. A sitting on a day that does not owe it (a Saturday
  flashcard sitting) makes up one missed day.
- Electives never count.
- A section is credited only when **every** track it lacked is covered (for
  example, English lacking both its lesson and its reading log needs both).
  The oldest missed day is credited first, and each piece of spare work is
  spent once.

The cache keeps the raw replay. The credit is laid over the rows on every read
(`read`, `dayRow`), so a missed Tuesday turns green as soon as Thursday's row
is recomputed. No past row needs invalidating. While a week's makeup window is
open, a cached row is refreshed in the background when it was computed before
its own day closed, when a served or obligated section lacks a ledger, or when
a ledger has no `makeupClaims` key (a row cached before claims existed, or
before a repair claimed one of its sessions). Rows older than yesterday come
from the cache, so this rule is what lets a claim reach them.

## What a reader sees

Each term-grid day carries:

| Field | Meaning |
|---|---|
| `timeliness` | `makeup` when later work turned at least one section served, otherwise `on-time` |
| `makeup` | `[{subject, servedOn}]`, each section credited and the day the work was actually done |
| `makeupOpen` | An unfinished (`partial`/`none`) day that can still be made up |

With `detail`, a credited section carries `makeup: {servedOn}`, and a
restituted one `makeup: {servedOn, restituted: true}`.

**Result receipt.** A pass that a held claim moved to an earlier day prints
`Makeup: this counts for <Weekday>'s <subject>.` under the score
(`resultDocument` `makeup`, `CloseSessionOutcome`). Its Next-up offers that
subject's own lesson for today first, since today's lesson is still owed
(`chooseForwardAction` `passedWasMakeup`). A claim that no longer holds prints
nothing extra.

**Economy.** `SchoolEarningEvidence` passes `timeliness` and `makeupOpen`
through on day and section facts. A `makeupOpen` day is not settled, so a
missed Wednesday no longer ends Green Week at once. The week stays pending
until the work is made up (earned) or the deadline passes (lost, as before). A
section-week line that is still recoverable reads `Can still make up: <days>`.
Weekly payout refs stay `on-time`, so a week can never be paid twice.
Made-up work can cost coins. Set the household `makeup` block in
`economy/earn-rules.yml` to `{percent}` or `{silver}`, and override it per
rule. Gems are never taken. See
[Earn rules](../economy/economy.md#earn-rules).

## The makeup sheet

Makeup work stays off today's agenda except for **one** small card. When
something earlier this week is still recoverable, the printed agenda carries a
single card reading, for example, `Makeup work: Mon Math, Wed English. Due
Saturday night.` above a QR labelled `Scan to print your makeup sheet`, with a
panel code when self-service is on.

- **Token.** `makeup_print`, keyed only to the learner
  (`BuildAgenda`, `domain/sessions/tokens.mjs`). It lives until the deadline
  day ends. Scanning it (`ResolveScanAction`) or typing its code
  (`ResolveAccessCode`) runs `PrintMakeupAgenda`, which recomputes what is
  still owed (`GetMakeupWork`), so an old card never prints work that has
  already been made up. Every outcome prints paper: the sheet, a "Nothing to
  make up" slip, or "The printer did not answer".
- **The sheet** (`receipts.mjs` `makeupDocument`). A header reads `MAKEUP WORK
  — Due Saturday night. Each lesson counts for the day you missed.` It has one
  card per subject (rail `Makeup · Mon, Wed`). Each card carries a
  `subject_next` code with `continueToday: true`, plus `program` when the
  subject's next entry is a program, so it opens the next lesson even when
  today's lesson in that subject is already done. A subject owed twice says so
  and asks for a second scan after the first lesson. The ticket also carries
  `makeupFor: [days]`. Acting on it (typed code or QR, any action but retry)
  claims the session it opens or reprints (`ClaimMakeupLesson`). A session
  already settled is never claimed by a scan; moving settled credit is a
  repair job. The header's "Each lesson counts for the day you missed" now
  holds whether the makeup lesson is done before or after today's own lesson
  in that subject.
- **Only work that can earn credit today is listed.** A missed lesson always
  can. A missed program is left off on a day that owes that same program,
  because today's sitting is today's own. It appears again on a day that does
  not owe it, such as Saturday.
- **Preview and dry runs.** Preview uses an inert token. A dry run for any day
  other than today shows no makeup. The agenda preview JSON carries `makeup:
  {deadline, items}`, or `null` when nothing is owed.
- **Status board.** It shows `Makeup work: print your makeup sheet (due Sat)`.
- **Logs.** `school.agenda.makeup.minted` and `school.makeup.printed` record
  the learner, the subjects and the days. `school.makeup.claimed` records a
  claim (learner, session, subject, `forDay`, deadline, unit).
  `school.makeup.claim-failed` (warn) means a claim could not be read or
  written; the sheet still prints and the lesson counts for the day it is
  done. `school.makeup.claim-invalid` means the event failed validation.

## Relation to Saturday catch-up

[Saturday catch-up](./day-off-tiers.md) still offers missed daily *programs*
inline on Saturday, once the weekend item is settled. With makeup on, a
Saturday sitting from that offer also credits the missed weekday on the grid.
Before makeup existed it only counted toward weekly gems.

## Known limits

- Course lessons are credited by count within a subject. The scheduler moves
  on when a day is missed, so a makeup lesson is the subject's next lesson,
  not the specific lesson that was skipped.
- A program that keeps no history (an FSRS deck) cannot be replayed, so it
  cannot be made up.
- `dayRow` (the parent digest's look-back) reads later days from the cache.
  The board's `read` is the exact answer.
- A term-grid row older than yesterday that was cached before claims existed
  has no `makeupClaims`. It is refreshed only while its week's makeup window is
  open (see above) or by a rebuild. With makeup off, staleness is not checked,
  so such a row keeps its old reading until it is rebuilt.
- Turning makeup off mid-week moves a claimed lesson's credit back to the day
  it was done on (restitution); the missed day it named reads missed again.
