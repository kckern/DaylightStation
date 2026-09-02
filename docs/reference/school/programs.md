# School programs

A program unit delegates evidence and progress to a registered
`IProgramLauncher`; School still owns assignment, agenda obligation, launch
authority, and rewards. Program status is keyed structurally by program id and
instance, so one corpus cannot answer for another.

Assignment writes validate every program record before persistence, reject
unknown/duplicate policies, and normalize known legacy ids. A launcher failure
faults only that program entry and makes completion indeterminate when the
program was required.

Program status may expose `obligationProgress: { completed, total }` for a
single daily obligation. This is structured UI state, separate from the human
`progressLabel`, longitudinal course `progress`, and optional `score`. The agenda
copies it only onto that program's selected `next` item; clients must not parse
the label or reuse course progress to guess whether today's obligation has begun.

Sentence Ladder is the first code-registered program. Its canonical id is
`sentence-ladder`; `language` is a deprecated read/write compatibility alias.

## Piano course — a program backed by another app's evidence

`piano-course` is the program for "one Hoffman Academy lesson a day at the
piano". It is a `PianoCourseProgramLauncher`
(`3_applications/school/PianoCourseProgramLauncher.mjs`), deliberately NOT a
config-driven `SurfaceProgramLauncher`, because the piano REPORTS BACK: the
kiosk already stamps `completedAt` when a lesson crosses the household
completion threshold and the child actually played along. Settling the day on
dispatch would throw that evidence away and credit a kiosk opened and walked
away from, so `doneToday` reads the evidence instead.

It reaches that evidence through Piano's own `GetPlayableUnits` use case,
injected (Decision D1). Enrollment lives in `assignment.programs[]` as
`{ programId: 'piano-course', courseId: 'plex:<ratingKey>' }`.

`status()` settles a day in this order, and the order is the contract:

| Order | Condition | Result |
|---|---|---|
| 1 | A crediting lesson completed inside today's study day | `doneToday`, ceremony fires |
| 2 | An active parent day-bypass (below) | `doneToday, excused, bypassed` — no ceremony |
| 3 | Co-progress lock blocks the next lesson, unexempted | `doneToday, excused` — no ceremony |
| 4 | Otherwise | owed, with `nextLesson` naming the playable lesson |

Evidence always outranks a bypass, so a child who does the lesson anyway gets
a real completion and the chime. Reference/practice units give no credit here
for the same reason they give none in the kiosk: the two must agree, or a
child "finishes" school by replaying a warm-up.

### The kiosk menu gate

`GetPianoLessonGate` (`3_applications/school/usecases/GetPianoLessonGate.mjs`)
turns `status()` into the piano kiosk's menu answer, served at
**`GET /api/v1/school/lifecycle/learners/:learnerId/piano-lesson-gate`** —
the second read seam for the kiosk beside `/completion` (which gates Games).
School serves it because School owns the rule; the kiosk only renders it.

While `gated` is true the kiosk replaces its whole tile grid with that one
lesson. So the read **fails open**: no assignment file, an unreachable Plex, a
launcher error, or an unwired lifecycle all return `gated: false`. A wrong
`true` would lock a child out of every mode over a transient fault; a wrong
`false` merely fails to nag. (`GetPlayableUnits`'s co-progress exemption fails
CLOSED — opposite stakes, deliberately opposite posture.)

Fails open is not the same as *open while we wait*. On the client
(`usePianoLessonGate`) an unanswered read is **pending**, not permission: the
menu greys out — every tile and the recent-courses strip — with one caption,
and only opens once a verdict lands or the 20s loading ceiling gives up on the
read. A read that *fails* is equally unanswered, so a network error or a 5xx
also holds the learner pending and lets the next poll retry; only a definite
refusal opens the menu at once, which is what the 404 of a School-less install
is. The hook exposes one `pending` flag for this so that no screen re-derives
the rule — the menu and the Videos course grid both read it. On 2026-09-01 a learner picked his name and left through the
recent-courses strip 3.5s later, because the cold read took 11.1s and `gated`
was false for all of it. A learner whose verdict has already landed never
returns to pending, so a slow poll can never reopen a gate that read as owed.

The verdict is also **memoised per learner** for `MEMO_TTL_MS` (60s), so a
child tapping their own name three times pays for one read rather than three.
Freshness comes from invalidation, not the TTL: the use case subscribes to
`onCompletionInputChanged` — completions, passed challenges, assignment edits
and bypass grants all arrive there — and drops that learner's entry. The TTL
is only the backstop for what no event announces (a dropped bus message, a
plan file edited on disk, an episode added to the Plex course, the 4am
study-day rollover), and it bounds every one of those to a minute. Two things
the memo deliberately does not do: it never caches the `unavailable` verdict,
because that is the fail-open answer for a broken read and holding it would
extend a one-second Plex blip into a minute of open gate; and it does nothing
for the **cold** read. Sixty seconds is also deliberately shorter than the
5-minute structure cache one layer down, so this memo can never extend
structure staleness — the worst it can do is re-serve an answer that cache was
going to give anyway.

On the cold read: the 11.1s is best explained as a cold miss in
`FitnessPlayableService`'s structure cache (5-minute TTL, watch-state
enrichment deliberately excluded), since the 0.35s warm figure includes that
live enrichment and so cannot be where the ten seconds went. That is an
**inference from the two timings, not a measurement** — nobody instrumented
which layer spent the time. Either way the memo cannot help here: the first
caller after a restart pays in full. That is what the client's pending state
is for.

The piano itself is never gated: auto-enter-Studio arms on the menu ROUTE, and
the gate is a render branch of that same route.

#### What the gate actually gates

Two surfaces read it, and the coverage is deliberately partial:

- **The kiosk menu** — `gated` replaces the whole tile grid with `TodaysLessonGate`,
  the one launcher a gated learner has.
- **The Videos course grid** (`CourseGridRoute`) — a gated named learner is sent
  back to the menu with `<Navigate replace>` and the redirect is logged as
  `piano.videos.grid-redirected`. `replace` so the grid leaves no history entry to
  bounce off; the menu never sends a gated learner to `/videos`, so it cannot loop.
  This exists because the mode crumb in PianoChrome points straight at
  `${basePath}/videos`: without it, "you may only do Reading Music" hands the child
  a door into a room where Reading Music is one tile among ten.

### The daily video cap

An enrollment may carry an optional **`videosLockedAfter: <n>`**. Once the
learner has finished `n` lessons for that program in the current study day, the
piano kiosk's **Videos mode** is locked until the 4am rollover. It exists to
stop a video course being farmed all day under the banner of schoolwork.

It rides on the same payload as `gated` but is a **separate field**, `videos:
{ locked, reason, completedToday, cap }`, and that separation is forced rather
than tidy. `gated` means *you still owe today's lesson* and funnels the kiosk
INTO a lesson video; the cap means *you have had enough*. Collapsing them would
have the menu launching a lesson at the learner it is trying to stop. A capped
learner is by definition **not** gated — they have done today's work.

**The counter is `completedLessonsToday`**, which is the same array the launcher
maps into `servedWork` and the agenda status board draws as one disc per
finished lesson. So the number a parent counts on the wall panel and the number
the cap enforces are the same by construction. Counting watch events, sessions
or launches instead would let the board and the cap disagree about one day, and
the board is what the rule was described in terms of.

Optional and off by default: only a positive whole `videosLockedAfter` caps
anything. A zero, a negative, a fraction or a string is ignored rather than
guessed at — a mistyped cap silently becoming `0` would lock a child out of
video permanently, the worst reading of an ambiguous config. It **fails open**
at every unknown, like everything else in this gate: an unavailable launcher
read, a payload with no `videos` block, and a guest all leave video open.

Unlike `gated`, the cap is enforced at **all three Videos routes** — grid,
course, and lecture. For `gated` the deep-link routes below are residual escapes
whose cost is starting the wrong lesson; for the cap they are the main road,
because the exercise checkpoint's Continue replays a stored
`/videos/<course>/<lecture>` link as an ordinary daily path. A cap enforced only
at the grid would never fire for the child it exists for. The menu tile is
disabled alongside, captioned with the count — `2 of 2 lessons today` — because
a live tile that bounced a child back to the menu reads as a broken kiosk.

**`CourseDetailRoute` and `LecturePlayerRoute` do NOT read the gate.** They take
`:courseId` from the URL, so a non-assigned course reached *without passing the
grid* still plays — a verdict that flips to `gated` while a course is already on
screen, history back/forward or a reload onto a stale URL, a DoNow push, and
(first-order and in-app) the exercise checkpoint's `return` param, which
`LecturePlayerRoute` persists as `returnTo` and `Exercises` navigates to on a pass.
Closing those needs an **owed-set** comparison, because the gate response names one
course while `status()` is gated on *any* owed enrollment; comparing against the
single shown course would evict a learner legitimately working a second owed one.
That is an API change, not a route guard. Vectors and reasoning:
`docs/_wip/bugs/2026-09-01-piano-lesson-gate-escapes-via-course-grid.md`.

A completion that belongs to no enrolled course is correctly ignored — a Hot Cross
Buns lesson must not discharge a Reading Music obligation — but it is no longer
ignored *silently*: `PianoLessonCeremonyBridge` emits
`school.piano-ceremony.ignored` at **info** with the plex id, the title and the
courses that could have been discharged. Info, not warn: nothing is wrong, but it
must be visible without turning debug on mid-incident. The cheaper "no piano
enrollment at all" exit above it stays silent, so a grown-up noodling never
reaches this line.

### Parent bypass — excusing one day

A grown-up can excuse one learner's obligation for one study day from the
Teacher Console (Student → Operations). `ManageProgramDayBypass` writes an
append-only ledger (`school/records/program-day-bypasses.yml`) keyed by
learner + program + `studyDate`, with a required reason and a named actor;
retraction is another append, never a delete.

Study-day keyed rather than TTL'd: tomorrow's `status()` computes a different
key and the record simply stops matching, and a grant issued at 2am correctly
files under the study day the child is still living in. Grants are idempotent
per key, so two grown-ups excusing the same day is one excusal.

It is consumed inside `status()` (step 2 above) rather than by each surface,
which is what makes the kiosk gate, the agenda card and the ceremony agree
without any of them knowing the bypass exists. Grants and retractions
broadcast `program-day-bypass-changed` on the `school` topic — the same topic
`PianoLessonCeremonyBridge` uses — so a bypass granted on a laptop clears the
kiosk within a beat instead of waiting out its 15s poll.

## Story time — a program with no course at all

`story-time` is the first program whose obligation is a plain daily COUNT:
"finish N stories today". There is no curriculum behind it — no units, no
sequence, no gate, no grade — so it is the clearest example of what the program
lane is for. An entry in `assignment.programs[]` with `courseId: null` is
projected by `appendAssignedProgramEntries` into a `cadence: 'daily'` agenda
entry, and `StoryTimeProgramLauncher` owns the evidence. The generic agenda and
board pipeline reads its `doneToday`, `obligationProgress`, and `servedWork`
without a story-time-specific branch.

```yaml
programs:
  - programId: story-time
    corpusId: null
    target: 2          # per learner — a four-year-old's count is not a sibling's
    subject: english
    title: Story time
    schedule:
      daysOfWeek: [1, 2, 3, 4, 5]
```

Every program enrollment accepts the same strict school-day `schedule` block
as a course enrollment. `SetAssignments` validates and normalizes that calendar,
and `appendAssignedProgramEntries` carries it into the agenda entry where the
ordinary obligation policy can excuse the program on non-school days. Unlike a
course enrollment, a program takes its schedule directly from the assignment;
there is no syllabus snapshot between them.

**The target lives on the enrollment, never in `school.yml`.** How many stories
a child owes is a per-learner teaching decision; a household-wide default would
force two children onto one number. `validateStoryTimeEnrollment`
(`#domains/school/storyTime.mjs`) applies a default of 2, and refuses anything
outside 1–20 — an unmeetable target is a config typo that would otherwise leave
a tile permanently red with no error anywhere.

The program is **never terminal**: tomorrow it asks again. That is what
separates it from a `cadence: 'once'` program, which leaves the agenda when its
launcher reports terminal. Reading past the target is never a penalty — a third
story reads `3 of 2 stories` and stays done.

The board's daily obligation remains one stable disc: 0/2 is gray, 1/2 is amber
and announced as "in progress," and 2/2 is green and increments the completed
assignment count. The launcher clamps structured `completed` to `target`, so
3/2 remains complete, while the human label may still say `3 of 2 stories`.
Once complete it returns `story-time:daily` in `servedWork`, keeping the green
disc visible after there is no longer a `next` offer. Errors and non-enrollment
return `obligationProgress: null` rather than inventing progress.

`corpusId: null` makes `SetAssignments`' dedupe key `story-time\0`, so a second
story-time enrollment for the same learner is refused.

**A target the launcher cannot read is an error, never a guessed default.**
`YamlAssignmentStore.get()` never throws — a missing plan file and unparseable
YAML both answer `null` — so falling back to the default on "no enrollment
found" would set every learner's target to 2 off one corrupt file. That asks
the child whose target is 1 for a second book, and calls the child whose target
is 5 DONE at two. A false done is worse than a false zero and fails silently, so
the launcher answers `error: true` with `target: null` and logs
`school.story-time.target-unknown`. Only an ABSENT target takes the default; a
target that is present but not a positive integer (`target: '5'` in a
hand-edited plan) is refused for the same reason.

Both error branches answer the same shape as the success branch —
`count`/`target`/`reads` are always present, `count: null` when unknown — so a
caller reading `status().count` gets "unknown" rather than `undefined`.

### The evidence log shards by STUDY DAY, not by UTC date

`YamlReadingLogStore` writes
`household/school/records/reading/{learnerId}/{studyDay}.yml`, where `studyDay`
is the household's own 4am→4am key — stamped by `RecordStoryRead` at the moment
the story finishes, not derived at read time.

**One place computes that key.** `RecordStoryRead` takes a `studyDay()`
function, not a timezone, and callers pass the story-time launcher's own. Two
independently-injected timezones is a silent failure: a caller that omitted the
timezone would default to UTC while the launcher stayed local, so a 10pm PT
finish files under tomorrow, the launcher reads today, the count never rises and
nothing errors. The parameter is required rather than defaulted so the mistake
cannot be made quietly.

This is a deliberate departure from `SurfaceProgramLauncher`, which reads
DoNow's dispatch log — a log it does not own, sharded by UTC date — and
therefore has to read TWO shards and filter them with `isSameStudyDay`: a
5:01pm PDT event is already tomorrow in UTC and lands in tomorrow's shard.
Owning this store means the shard key IS the key the agenda asks about, so
`doneToday` is a single file read with no timezone reconciliation. Never
compute the key with `toISOString().slice(0,10)`.

It lives under `records/`, not `runtime/`: a finished story is durable evidence
a report card is reconstructed from, and is never pruned by a cooldown or a
session close.

`listForDay` fails open — a missing OR corrupt file both answer `[]`. An
unreadable log is a different thing: the launcher returns `error: true` rather
than a false zero, so the agenda reports the program unavailable and the day
indeterminate. Showing a child who read three books as owing three books would
be worse than admitting the log could not be read.

#### A corrupt shard is preserved, never overwritten — `*.yml.corrupt-*`

Failing open is right for a READER and wrong for a WRITER, because `append` is
a read-modify-write. A corrupt shard reading as `[]` used to mean the next
finished book overwrote every read that day held, silently. So the two paths
now diverge:

- **`listForDay`** still answers `[]` and logs at `warn`. It has **no side
  effects** — it leaves the bad file exactly where it is.
- **`append`** copies the original bytes to
  `{studyDay}.yml.corrupt-{ISO-instant}` (e.g.
  `2026-08-26.yml.corrupt-2026-08-26T18-04-00-000Z`) **before** writing
  anything, logs at `error` with `learnerId`, `studyDay` and `preservedAt`,
  then starts a fresh shard and carries on.
- If the file exists but cannot be read at all (permissions, a directory in
  its place, bad device), the bytes cannot be rescued, so `append` **throws**
  rather than replace it.
- A zero-byte shard has nothing to preserve, so it is replaced rather than
  side-filed — but it logs `school.reading-log.empty`, because a file that is
  zero-byte *because* it was truncated has already lost its rows.

Side-filing rather than throwing on corruption is deliberate: throwing would
mean a child could log no reads at all for the rest of the day over one stray
byte, trading silent data loss for loud data loss. The evidence stays
recoverable by hand and the day still works.

A `reads:` entry that is not shaped like a read — a bare title where a map
belongs, which is exactly what a hurried hand-merge produces — is **not**
treated as corruption. It does not cost you the shard. It is carried through
every rewrite **verbatim**, `listForDay` skips it when counting, and each read
or append logs `school.reading-log.unrecognised-entries` with how many there
are. So a typo in the repair below costs you a warn and an undercount, never a
row: fix the line whenever you next look. Nothing in this store deletes an
entry it cannot parse.

**If you find a `.corrupt-*` file, it is yours to inspect — nothing will ever
touch it again.** It holds the reads that were on record when corruption was
detected; the live shard has only what was logged afterwards. Merge the salvaged
`reads:` entries back into `{studyDay}.yml` by hand (or re-record them with
`school ops read --apply`), then delete the side file. Grep the logs for
`school.reading-log.corrupt-side-filed` to see when and for whom it happened.
The shard itself is written with `saveYamlToPathAtomic`, so a torn write — one
of the ways a shard goes bad — should not be the cause.

### `pickId` — one finish, one row

A caller mints a `pickId` when playback starts and sends it back when Player
reports semantic natural completion. `doneToday` is `rows.length >= target`, so
a duplicate row is a duplicate BOOK: a retried request or a remounted player
credits the child twice.
`IReadingLogStore.append` is therefore specified as idempotent on `pickId` —
return the existing row rather than appending a second — and a `null` pickId is
not a key, so two hand-recorded reads of the same book stay two reads.

### One finish is one row — `pickId`

`append` is **idempotent on `pickId`**, scoped to the study day. The caller
mints one id per finish (the living-room screen mints it when playback starts
and sends it back from Player's natural-end callback) and may send it more than
once — a retried POST or duplicate terminal notification. Because `doneToday`
is `rows.length >= target`, a duplicate row is a duplicate **book**: the same
child credited twice for one story.

So a repeat returns the row **already on disk** — not the one handed in — and
writes nothing at all. Two consequences worth knowing:

- **A `null` pickId is not a key and never dedupes.** Two hand-recorded reads
  of the same book are two reads; `school ops read` sends no pickId, so it can
  always record a genuine second reading.
- **The scope is the shard.** The same pickId tomorrow is a new row, because
  the same story finished tomorrow is a new obligation.

The scan runs over recognised rows only, so an unrecognised entry can neither
match a key nor be disturbed by a repeat.

### Recording a read by hand

Evidence normally arrives when the audiobook FINISHES (a story abandoned two
minutes in is not a story read). `school ops read` is the manual-correction
path — a book read on a lap, a mis-scanned sticker:

```bash
node cli/school.mjs ops read user_5 --title="The Jungle Book" --content=plex:620681
node cli/school.mjs ops read user_5 --title="The Jungle Book" --content=plex:620681 --apply
```

The learner id is resolved against `school.yml` `students:` and an unknown one
is refused — a typo is a well-formed id, and appending under it would print
success while counting the read against nobody. `--pick ID` sets the `pickId`.
After an `--apply` the command reads the count back through the launcher, so
what it prints cannot disagree with the board.

Unlike every other `ops` command it writes to the reading log directly rather
than through the API, so it works with no server running — which is when a
parent is most likely to need it. Because there is no event bus, it records the
read without the on-screen ceremony a real living-room finish gets.

## Operations CLI

The complete operational contract is in [School operations](./operations.md).
The examples below are the program-facing subset.

`node cli/school.mjs ops` supports testing and household operations:

```bash
# Read only
node cli/school.mjs ops status learner3
node cli/school.mjs ops monitor learner3 learner4 --watch

# Prints a redacted request; does not write
SCHOOL_PIN=... node cli/school.mjs ops enroll learner3 \
  --syllabus come-follow-me-ot-2026-lower --teacher kckern \
  --pin-env SCHOOL_PIN

# Explicit mutation
SCHOOL_PIN=... node cli/school.mjs ops rematerialize learner3 \
  --syllabus come-follow-me-ot-2026-lower --teacher kckern \
  --pin-env SCHOOL_PIN --apply
```

Mutations are dry-run by default, fetch current assignment revision for the
stale-write guard, never print the PIN, and require `--apply`. Available writes
are `assign`, `enroll`, `rematerialize`, and `abandon`. Existing `school sim`
commands remain the deterministic simulation surface; `ops status/monitor`
cover live diagnosis. There is deliberately no generic “force complete” or
reward bypass.
