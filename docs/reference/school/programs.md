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

## Story time — a program with no course at all

`story-time` is the first program whose obligation is a plain daily COUNT:
"finish N stories today". There is no curriculum behind it — no units, no
sequence, no gate, no grade — so it is the clearest example of what the program
lane is for. An entry in `assignment.programs[]` with `courseId: null` is
projected by `appendAssignedProgramEntries` into a `cadence: 'daily'` agenda
entry, and `StoryTimeProgramLauncher` owns the evidence. Nothing in
`agenda.mjs`, `completion.mjs` or `AgendaStatusBoard` knows it exists; they read
`doneToday` as they already did.

```yaml
programs:
  - programId: story-time
    corpusId: null
    target: 2          # per learner — a four-year-old's count is not a sibling's
    subject: english
    title: Story time
```

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

A caller mints a `pickId` when playback starts and sends it back when the story
ends. `doneToday` is `rows.length >= target`, so a duplicate row is a duplicate
BOOK: a retried request or a remounted player credits the child twice.
`IReadingLogStore.append` is therefore specified as idempotent on `pickId` —
return the existing row rather than appending a second — and a `null` pickId is
not a key, so two hand-recorded reads of the same book stay two reads.

### One finish is one row — `pickId`

`append` is **idempotent on `pickId`**, scoped to the study day. The caller
mints one id per finish (the living-room screen mints it when playback starts
and sends it back on `ended`) and may send it more than once — a retried POST,
a player that remounts mid-story and fires `ended` twice. Because `doneToday`
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
node cli/school.mjs ops read learner-c --title="The Jungle Book" --content=plex:620681
node cli/school.mjs ops read learner-c --title="The Jungle Book" --content=plex:620681 --apply
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
