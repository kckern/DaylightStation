# Game Time Budget and the Match Gate

Games on the piano kiosk are bounded two ways. A **budget** caps how many minutes a
child plays in a day. A **gate** asks for a short played challenge before every match.
Both are off unless the household turns them on, and both are designed around one
asymmetry: the kiosk is used by children who cannot debug it, so every failure that is
not the child's fault opens the door rather than closing it.

Related: [piano-games.md](./piano-games.md) for the engines, [exercise-bank.md](./exercise-bank.md)
for the material the gate draws from, [performance-assessment.md](./performance-assessment.md)
for how an attempt is graded.

Completed Chess, Checkers, and Connect Four matches also write an idempotent
study-day counter at `household/history/piano-board-game-days/{date}.yml`.
Win, loss, and draw count equally; abandoned games do not. A rematch waits for
the completion receipt, preventing the next PianoChallenge from reading a stale
count. The current value is exposed at
`GET /api/v1/piano/users/:userId/board-game-day`.

---

## The gate stack

Three gates stand between the Games tile and a running match, in this order. The first
that blocks wins, and each carries its own copy.

| # | Gate | Opens on | Fails |
|---|---|---|---|
| 1 | School completion | today's schoolwork is `complete` or `no_work_today`, **or the player is not a learner School tracks** | closed |
| 2 | Match gate | a played challenge scores at or above the bar | open on infrastructure; the ladder floor cannot fail on verdict |
| 3 | Budget | minutes remain in the learner's allowance *and* the device's | open |

Gate 3 is two balances checked in series with distinct copy — "you've used your piano
game time for today" for a learner, "this piano has reached its shared game time" for
the device.

**The challenge sits above the budget lock, and that ordering has a visible
consequence.** A child whose budget is already spent still meets the challenge first,
plays it, and only then meets the lock. Because the gate commits the ladder move before
it grants, they bank a climb for a match they never get. This is current behaviour, not
an accident of layering: the challenge is what a match is bought with, so it is asked
before the day's balance is read. It is worth knowing when reading a log where
`gate.passed` is followed by no game.

The curfew window and the Games tile's own school lock are documented in
[README.md](./README.md); neither is part of this feature.

### Gate 1 covers learners, and only learners

`GET /api/v1/piano/users` marks each roster member `schoolLearner`, sourced from
School's learner directory. A member it does not list is **not gated** — the
kiosk reports `not_gated` and never queries the entitlement at all.

This distinction is not cosmetic. State Gates enumerates gate instances from
published evidence, so a household member School has no plan for produces no
`piano.games` decision. An absent decision reads `indeterminate`, and
`indeterminate` fails closed — which is right for a learner whose day cannot be
judged and a category error for someone who was never assigned a day. Until
2026-09-02 both grown-ups were therefore permanently locked out of Games, under
copy telling them to finish schoolwork they had never had.

`schoolLearner` is decided on the server because who is a learner is a School
fact; a browser deciding it would be deciding its own entitlement. It fails
closed as `true` (gated): the expensive mistake is answering `false` for a
child, since that is a games unlock handed out by a School outage. An absent,
broken, or throwing directory gates everybody.

### A denial needs an identity confirmed today

The office screen (`PianoVisualizer`) has no roster context, so it remembers the
last player picked. The pick now carries the study day it was made on, and
`useLauncherUser` reports `identityStale` when that day is not today's.

A **settled denial against a stale identity shows the roster instead of the
lock.** The asymmetry is deliberate: an unlocked verdict against a stale pick
costs a misfiled game record, while a denial costs someone their access, and
only the second is worth interrupting for. A `loading` or `error` status is not
a verdict about the person in front of the screen, so neither re-asks.

On 2026-09-02 that screen still held a profile picked five days earlier, read
that child's school day, and told the adult standing at the keyboard to finish
schoolwork that was not his. The lock copy now names whose day it is reading.

Switching profiles after a denial stays one key press away — the games keep
per-player history and levels, so there is a real pull toward your own lane.
The switch is recorded as `launcher.user-switched-after-deny`, which an ordinary
`launcher.user-selected` line cannot be told apart from.

---

## The budget

The **server is the source of truth**. This kiosk reloads many times a day — render
watchdog, page-failure reload, connectivity reload, manual restarts — and a counter held
only in the browser never survives a day. The client ticks; the day file decides.

### Metering

```
open(learnerId, deviceId)   → one session per learner, returning the seconds already spent
tick (1s)                    → drain while a match is mounted and someone is present
settle(cumulativeSeconds)    → every 60s, the running total since open
close(cumulativeSeconds)     → on exit, depletion, or unmount
```

Settle carries the **cumulative total, never a delta**, and the server charges only
newly-crossed whole seconds. Retries are therefore idempotent and a crash costs at most
the unsettled tail.

Two properties keep the meter honest, and both exist because the natural failure here is
**under**-charging:

- **Open returns the server-held cumulative and the client seeds from it.** A client that
  restarted its counter at zero would send settles the server treats as no-ops until it
  climbed back past the pre-reload total, making play after a mid-match reload free.
- **A settle is raced against a 15s timeout.** A hung fetch that never resolves would
  wedge the settle loop shut for the rest of the session, arriving at the same free-time
  outcome through a different door. The timeout does not cancel the request; it stops
  waiting on it.

A session left behind by a crash is **adopted** by the next open within 15 minutes, at
the cumulative it already held; past that it is sealed and a fresh one starts.

### What is metered

Only time inside a mounted match. The gate is unmetered and so is the practice route it
offers — a child struggling at a scale must not lose game minutes to the scale. The
picker, every other mode, and the gate itself never open a session.

### Idle

The meter pauses after a configured idle gap and resumes on the next activity. Activity
is one shared kiosk signal covering MIDI note-ons, `pointerdown`, `keydown`, and the
keep-alive — the same sources the inactivity return watches, published at seconds
granularity so the meter can see both edges. A paused meter charges nothing and counts
nothing down.

Expect measured game time to read lower than "minutes containing at least one event":
idle gaps inside a minute count toward the latter.

### Warning

Below the configured threshold the meter reports `warning` and the host shows a
non-blocking countdown over the game. It never intercepts input — a countdown, not a
wall.

### The day files

```
data/household/history/piano-games/{YYYY-MM-DD}.yml
```

One file per **household study day**, which begins at **4am local**, not midnight — the
same boundary School uses. A UTC day would reset allowances mid-afternoon.

```yaml
schema: piano.game-budget-day/v1
studyDate: 2026-08-27
device:
  totalSeconds: 4200
learners:
  kid_a: { totalSeconds: 2700 }
sessions:
  gbs_abc123:
    learnerId: kid_a
    deviceId: yellow-room-tablet
    openedAt: 2026-08-27T20:00:00.000Z
    lastSettleAt: 2026-08-27T20:41:00.000Z
    cumulativeSeconds: 2460
    closed: false
```

This file **is** the balance, not a copy of one held elsewhere, and it is written by the
domain service rather than a logging transport. A ledger transport swallows write
failures by design; for a balance a swallowed write is a lost debit, and a lost debit is
free game time. So writes are atomic and throw on failure, and a corrupt or wrong-schema
file throws on read rather than quietly loading as a zero balance. A genuinely absent
file is a fresh day — "never written" and "written and unreadable" are different answers.

A session opened before 4am and settled after it is **carried forward** at its existing
high-water mark, so only the post-boundary seconds are charged to the new day, and the
two days land in two files.

### Routes

| Route | Answers |
|---|---|
| `GET /api/v1/piano/users/:userId/game-budget` | the live balance, or `{enabled:false}` |
| `POST /api/v1/piano/users/:userId/game-budget/session` | open or adopt a session |
| `POST …/session/:sessionId/settle` | charge up to `cumulativeSeconds` |
| `POST …/session/:sessionId/close` | seal the session |

Settle and close bodies must be a numeric JSON `{ cumulativeSeconds }`; anything else is
a 400. A settle whose session belongs to a different learner is a 409, and the client
treats that as permanent — it stops the meter and falls open rather than retrying
forever.

---

## The match gate

The gate fires at **every match boundary**, entering a game and playing again alike.
Replays outnumber game entries by roughly 3:2, so a per-entry gate would miss most play.

Gate eligibility is declared by the game registry, not by the kiosk route. A host that
mounts a gate-enabled game must wait for the household gate configuration, put the gate
in front of the first match when it applies to the selected learner and game id, and
provide the same rematch boundary. This includes `PianoVisualizer` on the office display;
the display is a different surface for Chess, not a way around Chess's gate. Hosts may
adapt their own note stream into the shared piano-MIDI contract, but must not open a second
physical MIDI input to do so.

### It swaps, it does not overlay

The gate renders **in place of the game, at the same route**. The URL does not change;
the game unmounts, the gate mounts, and passing swaps back to a fresh match.

This is not a styling preference. The MIDI note stream is one shared store with no focus
or ownership concept, so every mounted consumer receives every note — a modal over a live
game would let the gate's scale drive the game underneath. Swapping guarantees exactly
one MIDI consumer at a time without adding input routing that every game would inherit.
Because the gate only fires at a boundary, the previous match is already over and there
is no in-progress state to lose.

The rematch is a genuine remount, keyed on a match id, so "play again" cannot keep its
board across a gate that was paid for.

**The CEREMONY is the one thing that overlays rather than swaps.** It closes over the run
and opens onto the game, which is why it holds still for 400ms before the panels move:
that frame is where a child sees the key they just played land. Rendered in place of the
run — as it once was — the ask vanished in the same commit the final note completed it,
and the note that won the game never got a frame.

The run therefore stays mounted, and live to MIDI, underneath the curtain. Its piano exit
gesture is withdrawn for that moment: a pass cannot be abandoned, and without this a hand
resting across the outer keys during the hand-over would fire `gate.abandoned` on an
attempt that had already passed.

### Difficulty is a presentation tier, not a grading knob

Every level names a **tier**, and the tier decides what the screen *is*. This is the
whole of the ladder's honesty: a step down has to change something a child can see or
feel, or it is not a step.

| Tier | Screen | Ask shape | Timing | Grading |
|---|---|---|---|---|
| 0 | No staff. A large keyboard with lit keys | one key | free | completeness only — unfailable |
| 1 | Keyboard primary, a small single staff above it | dyad, or a short run | free | completeness only |
| 2 | A single staff, on the correct clef, is the screen; a keyboard strip confirms | one-hand scale, one octave | free | completeness only |
| 3 | Tier 2 plus a one-measure metronome count-in | the same, at tempo | cued | completeness **and** cleanliness |

**Tier 3 is the only place a wrong note costs anything.** Below it the child contract is
one sentence — *play all the notes, in order; wrong ones don't count against you* — and
that is enforced by the rubric, not by good intentions: the requirement carries
`{ completeness: 1 }` and nothing else, and the engine can only fail a criterion that is
present in the requirement's own rubric.

Precisely: a level is cued-and-clean-graded when its tier is 3 **or** it carries a
`grading` block, whichever comes first. Writing `grading:` on a tier-2 level therefore
makes it a tier-3 ask in everything but the number, which is why the shipped repertoire
writes it only where the tier already says so.

A tier-1 staff is reinforcement, and it **degrades before the task does**. It is drawn
only when the ask spans no more than an octave and one clef holds all of it; an ask that
fails either test is still a complete ask on lit keys, with no staff above it.

`ordering: any` material — a chord, a held interval, anything whose own contract is "in
any order" — is a lit-keys ask at *every* tier, including one a host named explicitly.
There is no ordered notation for an unordered ask, and drawing one on a grand staff is
the bug this design replaced.

**One engraver per job, and the rendered output is the authority.** Free asks draw
through the sequence staff (ordered noteheads on one staff, ghosts native), cued asks
through the ABC path where rhythm engraving matters, score passages through the
sheet-music renderer. The live-keyboard grand-staff renderer — which always draws two
clefs, and drew an empty bass staff under a treble dyad for as long as nothing looked —
serves nothing on this surface. Staff count, clef glyph, and where a notehead actually
landed are asserted on real engraved geometry in a headless browser, because a green ABC
string proves nothing about what a child sees; that lesson is why this section exists.

### The repertoire

The ladder is a **list of levels, easiest first**, authored in the household config. A
level is `{ id, tier, grading, material }`: `material` is a non-empty list of specs, and
`grading` is absent for everything below tier 3.

- **Ordering is enforced, not trusted.** The resolved list is sorted by tier, stably — so
  the order written within a tier survives, and only a cross-tier authoring mistake is
  corrected. An index-based walk over an unsorted list could climb off the floor and land
  on tier 3.
- **A degrade moves one level down; a climb moves one level up.** Both after a configured
  count of consecutive outcomes, both stored per child.
- **Walking away is not failing** (see below), so only judged attempts move anything.
- **A level id nothing can resolve** — a stale save, a renamed level — resolves to index 0,
  which is always the unfailable floor. An unresolvable position fails toward "cannot fail
  the child", never toward whatever level happens to sit at some other index.

The position is stored per child, not per device, as
`{ levelId, failuresAtLevel, cleanPasses, lastMaterialId, pickIndex }`. A stored value
that is corrupt, truncated, or from an older shape lands the child at their configured
**start level**. The old five-axis rung is exactly that case and it is not hypothetical —
every kiosk that ran the previous ladder has one on disk. It carries no `levelId`, so it
fails validation and resets. No migration code exists and none should be written: five
axes cannot be mapped onto a household's own level list without inventing a
correspondence that is not there.

`pickIndex` is the exception. It is a rotation hint, not a position, so a damaged one is
zeroed while the level the child earned is kept.

### Rotation

A level with more than one material spec **serves a different one each time**, and the
rotation is committed at the moment material is served — before the child plays a note.
Writing it on the outcome instead would make "a different scale next time" depend on
finishing this one, so the child who walks away would meet the same ask forever.

Roots rotate the same way: a level naming `roots: [G, D, F]` is three different scales,
not one scale with two spares.

**The rung drill rotates too, and did not until 2026-09-16.** A scale rung that names
`sets`/`reps` builds its own program (below), and that builder dealt `roots[0..n]` from
index 0 on *every* launch — it never saw `pickIndex`. So while a plain `roots` level
served a different scale each gate, the drill form of the same level served the same keys
in the same order forever: a child on `roots: ['A','E']` met A, E, A at every gate they
ever played, and said so. The rung program now takes the same rotation counter, so set one
starts on a different root each gate and the sets walk on from there.

**"Try again" holds the material.** It is a second go at the same thing, so a retry
reuses the attempt already on screen rather than re-picking — otherwise a child who
missed G major and pressed the button promising another go would be handed D major. The
one case where the ask must change is the one where the ladder moved, and an eased level
is a different ask by definition, so the held material is reused only while the level is
still the one it was served for.

### The ask, from arriving to done

**Arrive.** One screen, three lines of hierarchy: the **bargain** ("Play this to start
Chess"), the **ask in plain words** ("C major scale, right hand" / "Play these notes
together" / "Press the lit key"), and the material itself, visible in full before anything
starts. Together-versus-in-order is answered before a child can wonder about it, not in a
status line they reach after deciding.

Both the bargain and the plain-words ask come from the host, through `AskSession`, so the
run never has to guess why it is on screen. **Every host that asks a child to pass
something supplies a bargain**, and each names its own context rather than writing the
sentence — the copy lives in `framingFor` and nowhere else:

| Host | Context it names | What a child reads |
|---|---|---|
| Match gate | `{kind: 'gate', gameLabel}` | "Play this to start Chess" |
| Program step | `{kind: 'program', stepLabel}` | "Pass this to finish Exercise 1" |
| Video checkpoint | `{kind: 'lesson', lessonLabel}` | "Pass this to finish Lesson 3" |
| Practice | `{kind: 'practice'}` | *no line* |

A program step needs no plumbing for it: the session fetches the step for its requirement
anyway and reads the title off the same answer. A video checkpoint has no step to fetch —
its requirement is authored JSON travelling in the query — so its lesson title travels
beside it (`label`). Ordinary practice supplies no line by design: a child who chose an
exercise from the browser has its detail page one tap behind them, and a program step
being *practised* is practice, not a promise to finish anything.

Where the ask is supplied, the exercise-bank title ("Intervals") is not the headline. A key chip
appears only when a staff is shown and is labelled ("Key of F"), never a bare letter; a
meter chip only when cued; a BPM chip only when a pace gate exists. Those three are
unconditional: they are the run's own, not a host's.

**Start — from the piano, never from a button.**

- *Free:* the first correct note starts the attempt. No button, no ceremony. There is no
  beat and nothing is graded on placement; the only question is whether the child gets
  through the notes.
- *Cued:* "Press any key to start." Any key begins a **one-measure metronome count-in**
  with a visible countdown, and only then does playing count. The copy says what will
  happen before it happens.

**Running.** The staff cursor advances note by note; a wrong key lights red on the
keyboard strip **and is drawn on the staff at its own true pitch**, half-transparent, so
the child can see how far off they were rather than only that they were off. At tiers 0–1
the lit keys are the cursor and the same properties apply to them.

**Done.** A pass hands control back to the player; a failure is the gate host's panel (see
below). Tiers 0–1 never show a percentage — pass or not, said in words.

### Passing

**Every level is judged on the verdict.** `requirementForLevel` writes `passScore: null`
for every level a repertoire can express, so `verdict.passed` is the answer at every level
— tiers 0–2 against a completeness-only rubric, tier 3 against completeness plus
cleanliness. There is no second `score >= passScore` test living alongside it.

That is a deliberate retirement. `passScore` used to be the single most load-bearing
value in the config and it failed silently in both directions: `0.80` written as `80`
failed every child down to the floor while logging ordinary failures, and `""`/`false`/`[]`
coerced to 0 and passed everyone at any score while logging healthy passes. A number
nobody has to write is a number nobody can write wrong. **`passScore` in a household
`gameGate` block is read by nothing.**

The score is still computed and still logged on `gate.passed`/`gate.failed`, where an
adult tuning the ladder reads it. It does not reach the child: the failure panel carries
words, never a percentage, because a percentage with no bar beside it invites comparison
against a target that does not exist.

### A match that was paid for is not charged for twice

`onPassed` is deferred to the end of the 3.4s curtain on purpose — the reveal and the
navigation are one gesture — but that leaves a window in which the child has passed and
the game has not yet been handed over. **The earned match is therefore banked to the
gate's own stored state (`earnedGame`) in the same commit as `gate.passed`**, not held in
component state until the curtain finishes.

It used to be held in component state, and a reload inside those 3.4 seconds voided nine
reps in silence: the ladder was persisted the whole time, the thing the child actually
bought was not. The signature in the log store is `gate.passed` with **no**
`gate.ceremony-done` and **no** `game.mount`, followed by a fresh `gate.drill-served` at
`banked=0` under a new `sessionId`. Comparing the day's `gate.ceremony-start` count
against `gate.ceremony-done` finds it directly.

A credit names the game it was earned for and will not open a different one, expires by
itself after ten minutes, and is spent before the hand-over so it can open exactly one
match. Redeeming it logs `gate.match-restored` with how long it waited.

### Automatic advance and piano recovery

A passing result advances through `onPassed`, carrying the assessment ID. In a
timed attempt the musical duration finishes first; matching the final note
early cannot cut the clock short. One `passTakenRef` delivers the result once
per attempt; telemetry records `piano.exercise-pass-taken` with `via: automatic`.

ExerciseRun and GameGate have no touch controls. A failed gate asks the player
to release all keys and press any key to retry; this invokes the same ladder
and retry policy as before. Holding the physical keyboard's lowest and highest
keys for two seconds leaves without granting a match. A lone outer key waits
300 ms to let its partner arrive; a held finishing chord cannot choose retry.
The no-player panel uses a fresh key to leave, never to grant access.

### The floor cannot fail

The easiest level in **any** resolved repertoire is unfailable, and that is structural
rather than conventional.

The reason it has to be is the rubric, not the matcher. Wait-for-correct matchers still
record a stray key as a wrong note, and a default generated rubric requires cleanliness of
1.0 — so one stray key on a completed floor run would fail the verdict and strand a child
at the bottom of the ladder with nowhere lower to go, locked out of a game they had
already earned. The floor's requirement therefore omits `cleanliness` entirely (not "sets
it to zero"), and completeness is structurally 1 when a wait-for-correct run completes, so
the floor passes through the ordinary verdict machinery with no special case inside the
engine. Wrong notes are still written to the attempt evidence — they simply stop being
disqualifying.

A config is free to author its own floor, and a **tier-0 level with no `grading` block
already satisfies the contract** — the resolver recognizes one and keeps it at index 0.
If the config authors none, or the config is empty or malformed, a built-in one-lit-key
floor is prepended beneath whatever was authored. There is no path through the resolver
that produces a repertoire whose index 0 can fail a child, which is why the sample config
below authors no floor of its own: `keys-1` is one.

**The whole repertoire has a fallback too.** A config carrying no usable level list —
absent, empty, every entry malformed — resolves to a built-in C major, right hand, free,
completeness-only level, with the built-in floor beneath it. Two levels, both playable,
neither of them silence. A malformed repertoire is a *config* mistake, not
infrastructure, so it must not fail open; handing out free matches for as long as a typo
survived is the worse failure.

### Failure

**A free level fails by stalling.** Below tier 3 the matcher waits for the right note, so
it records no misses and completeness only rises: `verdict.passed` becomes true the
instant the last note lands and is false at no moment before it. Nothing else can end
such an attempt, so a child who cannot play the ask would sit on a running attempt with
no result, no ways forward and no way down — Exit their only move, and it costs them the
match they earned. Twenty seconds with no note-on therefore ends a started free attempt
where it stands, and it is judged as a failure. The clock resets on every note, so
thinking between notes is free; a cued level needs none of this, because its timed
matcher misses notes that never arrive.

**A stall is not an abandonment.** The clock only runs once the child has actually played
something. An attempt with no musical input in it is never a failure, however long it
sits on screen — that is what keeps Exit from being a route to the floor, and it is why
the stall does not reintroduce the exploit it would otherwise create.

**Wrong notes still cost nothing below tier 3.** The stall is a clock, not a bar: a wrong
key is a note like any other, it resets the clock, and it is recorded without being
disqualifying. Nothing here adds cleanliness or a numeric threshold to a free level.

A judged attempt that missed its bar — completed below the bar, or stalled — offers three
ways on, and none of them reaches a match:

| Button | What it does |
|---|---|
| Try again | Re-runs the **same material** at the current level. After the configured number of failures the level eases, and the panel says "We made it a little easier" |
| Practice this | Leaves for the ordinary practice route — ungraded, unmetered, ungated |
| Leave | Returns to the game menu |

**Walking away is not failing.** Exiting the run mid-attempt moves nothing. If it did, a
child could press Exit their way down to the unfailable floor without touching a key, and
the gate would become a formality that still logged like a gate.

### Failing open, and the one case that does not

Infrastructure fails **open**. A catalog or instance fetch that 502s during a backend
restart, or an attempt that will not build — these start the match the child earned and
log `gate.unavailable`. Failing closed there would block earned games on an unrelated
backend blip, about which the child can do nothing.

**A configuration mistake is not infrastructure, and does not buy a match.** A level
whose every material entry fails for a config-class reason (a score naming no document,
an exercise naming no collection or instance, an unknown kind) substitutes the built-in
C major scale instead, and logs `gate.material-config-invalid` with the level id and the
reasons — the child still meets a real, always-resolvable ask while the YAML is wrong.
Only if even that fallback cannot be fetched does the failure count as infrastructure
and open the gate.

**"No player chosen" does not fail open.** It is permanent, known, and fixed by one tap,
so opening on it would make selecting the Guest profile a reliable one-tap bypass of the
whole gate. It renders a non-granting "choose a player first" panel with a way out, and
logs `gate.blocked`.

There is also always a Leave button beside the run itself, so a state neither the run nor
the gate anticipated cannot strand a child on a kiosk with no browser chrome.

### Material

The gate asks for material through a provider seam that names four kinds:

- **`keys`** — a lit-keyboard ask, synthesized on the spot: one white key, or two to
  three a third to a fifth apart. The floor of the ladder is made of these, and they
  reach a child without a network round trip, because a 502 between a four-year-old and
  the easiest thing the gate can ask is the one outage that must not exist.

  **A lit-key ask always fits a staff.** The rungs a pre-reader climbs draw the keyboard AND a
  staff above it, because the staff is the half of the mapping that teaches reading. The spread
  is between ADJACENT notes, so three of them a fifth apart span a ninth — and it is chosen now
  from the intervals that keep the whole shape inside the window one staff can draw
  (`MAX_ASK_SPAN`), rather than chosen first and found illegible afterwards. A third of every
  three-key ask used to arrive as a bare keyboard filling the screen, with nothing about the ask
  to explain why this launch had notation and the last one did not.

  **`reps` and `sets` are two different repeats.** `reps` alone repeats each note back to back —
  the sight-reading deck's three pitches, three cards each. `sets` deals that many distinct shapes
  and `reps` then repeats each whole shape, so `{ notes: 3, arrangement: sequence, sets: 3, reps: 3 }`
  is three arpeggios played three times through, and a `together` rung with `sets` becomes ordered
  chord events rather than one held chord.
- **`exercise`** — an instance from the exercise bank. A level naming `roots` addresses
  the scales bank by id directly (`scales/modes@root=G,…`), because that bank expands over
  a root axis and needs no catalog walk to be found. A level naming only a `collection`
  gets the walk, trying up to three seeds that support the level's mode before giving up —
  a seed can sit in the right collection and still have nothing this level can run.

  **Roots must be written the way the bank spells them.** Its root axis is `values: all`,
  which expands to the twelve sharp-named pitch classes `C C# D D# E F F# G G# A A# B`.
  `roots: [Bb]` reads correctly to a person and addresses an instance id that does not
  exist; the level is skipped and the gate falls through to whatever else it has.

  **A root the bank can only spell wrongly is not authored at all.** There is no
  enharmonic axis, so `A#` addresses B♭ major and `D#` addresses E♭ major — and the staff
  then spells them with sharps, which for A♯ major means B♯, C♯♯, E♯ and F♯♯: the same
  staff letter twice in a row, on the one surface a child is reading letters from. Those
  two are left out of the repertoire rather than shown wrong. The path back is an
  enharmonic axis on the bank, not a spelling table in the gate.

  **A `roots` level names `mode`, `direction`, `span_octaves` — and, since 2026-09-16,
  `hands`.** `scaleInstanceId` composes the whole id, so anything else written beside
  `roots` (`octaves`, `cued`) still reaches nothing and is dropped in silence.

  `hands: [R, L, RL]` on a rung that is a drill makes the HAND advance with the set, the
  way `scale-drill-3x3` always has: right, left, both, so three sets are never three takes
  of one ask. The bank publishes the axis on every instance (`hand=R|L|RL`, and `L` reads
  bass an octave down — a left-hand scale is not the right-hand notes in another clef).
  **The axis is omitted entirely unless a level asks for it**, deliberately: every scale
  id in the ladder predates it and the attempt ledger is keyed by those ids, so appending
  a hand silently would re-identify every rung at once and orphan the evidence behind it.
  (`hands` is also read on a `collection`-only level, where the catalog walk uses it as a
  preference rather than a filter.)
- **`score`** — a passage of real sheet music: a MusicXML document off the media tree,
  plus the bars of it the child is asked for. It resolves to no bank instance at all —
  the ask is whatever the engraver finds in the document, so the run engraves the score,
  waits for the geometry, compiles the named measure range into an expectation, and
  builds the attempt from that. Free walks a cursor through the passage; cued is timed
  against the score's own tempo map. The cursor lights the engraved notehead itself and
  the bars either side of the passage stay printed but greyed back, so the ask is
  focused without losing the run-up.

- **`drill`** — a multi-set drill, named by its program id (`{ kind: drill, drill: scale-drill-3x3 }`;
  the id may be omitted for the scale drill). It is the only kind that is a SEQUENCE of asks
  rather than one: which set is on the stand is a function of the reps passed so far at this
  gate, so the gate deals them itself and hands the run one plain instance at a time plus the
  program coordinates its chrome reads.

  The scale drill is three sets of three reps — G right hand, D left hand, A both hands,
  every rep the whole gesture up to the octave and back. A set is a program step and its
  `required_passes` IS the rep counter.

  **The gate is the whole drill.** A passed scale banks one rep and puts the next rep on the
  stand — nothing opens, nothing celebrates, the pills gild a ring. The game is the prize for
  the last rep, and every rep is played at the gate the child is standing at. Reps are counted
  from what was passed at THIS gate and from nothing else: not the learner's attempt ledger,
  not this morning's reps, not yesterday's. Every launch is a new nine. (It used to bank one rep
  per passed gate and carry the row across launches over the study day, which meant one G major
  opened the game and the three-by-three the pills promised was walked through one rep at a
  time. That was reported as the gate being broken, and it was.)

  A failed rep is a failed gate like any other — the fail panel, the ladder's retries, an ease
  when they run out — and Try again is the SAME rep: the reps already banked at this gate stay
  banked. Walking away closes the gate and the nine with it.

  **Between reps the coach speaks — on a card, not on the run.** The instant a rep passes the
  next one is dealt, and while its instance resolves the stage has nothing to draw; that frame
  was a black flash, nine times a drill. `RepInterstitial` stands in it: an opaque card for
  2.2 seconds saying how that one went (`100%` — a passed rep is the one place a number is
  wanted, and `failureCoaching`'s no-number rule still holds on the fail panel), which rep
  or set just banked (`Rep 1 of 3` / `Set 1 of 3 clear`), and what comes next BY NAME
  (`G major again — rep 2 of 3` / `Next: D major, left hand`). It fades onto the next rep,
  already on the stand beneath it. The name comes from `describeDrillStep`: a program step's
  own `display.key`/`hand_label`, else the rung's root and the instance's mode. The ninth rep
  gets no card; it gets the curtain.

  A drill that cannot be reached fails open; a drill id that does not exist, or a program with
  no steps, substitutes. Same two answers as every other kind, for the same reasons.

  **A scale level writes the same drill in its own YAML.** An `exercise` spec with `roots`
  that carries `sets` and `reps` —
  `{ kind: exercise, collection: scales, roots: [G, D, F], direction: up-then-down, sets: 3, reps: 3 }`
  — is resolved exactly like `kind: drill`: `sets` sets, one key each taken from the roots in
  order from this gate's rotation offset (cycling when the level names fewer), each needing
  `reps` reps, all of them at the gate. A level naming `hands` advances the hand per set too.
  Only the counts come from the level; which set is asked, how a rep banks and the pills are the
  drill's. Because a short root list repeats a key, passes are dealt to the sets in order — the
  fourth C major is the first rep of the second set, never a second set banked at once. Every
  scale level in the household ladder is written this way, so every scale gate costs the same
  nine and shows where the child stands in them.

### What the run screen says while a child plays one

**At the game gate it says nothing.** (The coach's card between two reps is not the run —
it covers the hand-over and is gone before the next rep is played.) The gate run is the
music, the keyboard and the set/rep pills. There is no framing line ("Play this to start…"), no ask heading, no key or tempo chip,
no standing instruction ("Play the first note to begin.") and no "Waiting for the piano…" —
the pills say where the child is, the staff says what to play, and the kiosk's connection
banner says when the piano has gone. The pills carry no names either: no placard, no key, no
hand badge. A gate level with no set/rep structure (a capstone passage) draws the music
alone. Practice runs outside the gate keep their words.

**A run with set/rep structure draws pills, not paragraphs.** Any ask whose events
repeat consecutively — a `keys` rung with `reps`, as well as a `drill` — is projected into
`DrillProgress`: one cluster per set, one ring per rep, banked rings gilded. The ask sentence
over the stage and the standing instruction under it both drop wherever the pills actually
draw, because the pills say where you are and the stage says what to play. A reading deck's
clusters carry **no label**: naming the pitch under a staff a child is being asked to read
hands them the answer. A host-supplied drill projection always wins over an inferred one —
it knows a standing that spans the whole study day.

**A `keys` rung with `sets` states its shape outright.** `sets: 3, reps: 3` deals three
distinct shapes and repeats each WHOLE shape three times — three arpeggios played three times
through, or three dyads struck three times each — where `reps` alone repeats each note back to
back. Repeats of a whole arpeggio are not consecutive identical cards, so the material records
`{ sets, reps, unit }` and the pills read that instead of the events: a rep banks when its last
key lands, never partway through. The stage shows only the rep being played, so the lit keys,
the badge row and the reinforcement staff are one shape rather than all nine of them at once.

**A scale stands its key signature after the clef.** The sequence staff engraves the
instance's key (`instanceKeySignature`, the relative major for a mode) as a signature — the
sharps or flats in printed order on the printed lines — and drops the accidental beside every
note the signature covers; a natural on an altered letter gets a natural sign. Reading a
signature is the skill, so this is on by default for every household. `notation:
{ keySignature: false }` in the piano YAML (household-wide or per piano) puts every accidental
back beside its note for a child who has not met signatures yet. C major, and any key the
table cannot name, draw nothing extra.

**A cued run states the real note rate.** The count-in is a quarter-note pulse, and the
exercise bank writes its scales in eighths, so "play at that speed" was false for every cued
scale rung — it clicked four times at 60bpm and then graded eight notes 500ms apart. The
ready line now says "then play two notes on every click", derived from the **compiled
expectation** rather than the written note values: the sentence has to describe the grid the
engine measures on. An ask with no steady pulse keeps the generic line rather than inventing
a rate.

**A failed attempt is told what went wrong, in one sentence and never a number.**
`failureAdvice` names the weakest criterion — nothing arrived, notes missing, off the beat,
extra notes — and answers `null` rather than guessing, in which case the panel keeps its
standing line. The no-percentage rule is unchanged and is stated above.

A level may mix kinds; the rotation serves one per attempt. An entry that cannot be
served — a bank 502, a score naming no document — is skipped, logged as
`gate.material-skipped` with its own reason code, and the level's other material is
served. A level where nothing resolves splits by cause: all config-class reasons
substitute the built-in C major fallback (see "Failing open, and the one case that does
not"); any infrastructure reason fails open.

`measures` is written the way a person reads a printed score: `[2, 3]` is the second and
third bars. A range nothing can read is dropped and the whole score is asked for, rather
than repaired into a guess that would put a child in front of the wrong bars with nothing
on screen to say so.

The gate passage is deliberately not a score viewer: no transport, no scroll, no zoom, no
per-measure grades. It is a few bars, on one screen, over in seconds.

---

## Where the gate is not

**The office screen is ungated and unmetered by construction.** The screen-framework
`piano` widget mounts games directly, with no gate provider and no meter, so nothing
there asks for a challenge or spends a budget. It does enforce the school lock. The
budget and the gate are kiosk-surface features.

**Battle Stadium's rematch is not gated.** Eight of the nine registered games route
"play again" through the shared match-boundary context and so meet the gate on every
restart. Battle Stadium restarts through the shared gaming runtime, which has no gate
consumer: its entry is gated, its rematch is not. Its picker tile is disabled (preview
status), so it is reachable only by deep link. This is a known limit of the boundary
contract, not an outstanding defect.

**Device identity is per-tablet.** The device-wide cap and every per-device log query key
off the browser's captured kiosk identity, taken from the launch URL and persisted — not
a shared constant. A literal could not tell a wall tablet from a dev laptop: both would
stamp the same id, every per-device query would merge them, and the device cap would be
one bucket that whichever kiosk was used first spent for both. A client with no captured
identity stays null rather than guessing.

---

## Configuration

Both blocks live in the household piano config and both default to off. Household app
config is cached in memory at startup, so a change needs a reload or a dev-server restart
before it takes effect.

```yaml
gameLimit:
  enabled: false            # off by default, like curfew
  source: fixed             # fixed | earned | economy
  dailyMinutes: 45
  deviceDailyMinutes: 120
  warnAtMinutes: 5
  idleAfterSeconds: 90
  users:
    user_1: { dailyMinutes: 30 }
    user_2: { dailyMinutes: 45 }
  # Used only when source: earned. A passed PianoChallenge credits this
  # fraction of perPassMinutes according to its 0..1 assessment score.
  earned:
    perPassMinutes: 10
    maxDailyMinutes: 30

gameGate:
  enabled: false            # the household default, for every child
  retriesBeforeDegrade: 3   # completed failures at a level before it eases
  climbAfterCleanPasses: 3  # clean passes before it climbs
  startLevel: L1            # where a child with no entry of their own opens
  users:                    # optional per-child overrides, merged key-by-key
    kckern:
      enabled: true
      games: [chess]        # optional allowlist; absent means every game
      startLevel: L2
  repertoire:               # ordered easiest-first; sorted by tier on read
    - id: keys-1            # the floor: tier 0, no grading, cannot fail
      tier: 0
      material:
        - { kind: keys, notes: 1 }
    - id: keys-2            # three dyads, three times each
      tier: 1
      material:
        - { kind: keys, notes: 2, arrangement: together, sets: 3, reps: 3 }
    - id: keys-3            # three arpeggios, each played three times through
      tier: 1
      material:
        - { kind: keys, notes: 3, arrangement: sequence, sets: 3, reps: 3 }
    - id: L1                # C major, one octave
      tier: 2
      material:
        - { kind: exercise, collection: scales, roots: [C], sets: 3, reps: 3 }
    - id: L2                # one accidental — three roots, so gates differ
      tier: 2
      material:
        - { kind: exercise, collection: scales, roots: [G, D, F], sets: 3, reps: 3 }
    - id: L3                # two sharps each; see Material on enharmonics
      tier: 2
      material:
        - { kind: exercise, collection: scales, roots: ['A', 'E'], sets: 3, reps: 3 }
    - id: L4                # at tempo; the only level where wrong notes cost
      tier: 3
      grading: { cleanliness: 0.8 }
      material:
        - { kind: exercise, collection: scales, roots: [C, G], sets: 3, reps: 3 }
        # A passage of real music belongs here — four bars of the study piece,
        # engraved by the sheet-music renderer. The shape, when one is chosen:
        # - { kind: score, source: 'files:sheetmusic/minuet-in-g.musicxml', measures: [1, 4] }
```

**No `passScore`, anywhere.** Every level a repertoire can express is judged on the
verdict; see "Passing". A `passScore` written in this block is read by nothing.

**And no `cued` on a material spec.** Timing is a property of the level — tier 3, or a
`grading` block — and nothing reads a timing key off the material. Writing one is a line
that reads true beside `tier: 3` and becomes a lie the moment the level is copied to
`tier: 2`.

The top level is the default for everybody. `users.{learnerId}` overrides it
key-by-key for one child, and `games` narrows an enabled gate to named game ids.
Both are absent by default, which reads as "everyone, everywhere" — so a block
without them behaves exactly as an unscoped one. A child with no entry never
sees a gate the household has not switched on for them, which is what makes a
rollout to one child on one game possible.

`startLevel` is what makes a preschooler and a teenager share one repertoire: the same
list, entered at different points. Without one, a child opens at index 1 of the resolved
list — the level just above the floor — which is the right place to *degrade* onto and
the wrong place to begin for anyone who can already play a scale.

The scoping is decided by the host, not the gate: `Games.jsx` asks
`gateAppliesTo` before it mounts anything, so a gate that does not apply is
never constructed. The gate component itself never reads `enabled` — a
component that opened itself because a key was absent would be a gate that
quietly stops existing.

`repertoire` reaches the gate **unvalidated by the config resolver**, deliberately: the
level schema belongs to one module, and a second validator here would drift from it the
first time that schema moved. A validator that drifts is worse than none — it would
reject a legitimate level list and drop a household onto the fallback in silence.

Every key in the `gameGate` example above is read. **Keys the design named that are
deliberately absent from it, because setting them today does nothing** — plus the one
`gameLimit` key that is in the sample and is not read:

| Key | State |
|---|---|
| `gameGate.every` (`match` \| `entry` \| `interval`) | resolved and then **never consumed** — the gate always fires at every match boundary. Setting `entry` to stop gating replays changes nothing. |
| `gameGate.metered` | resolved and then **never consumed.** The gate is unmetered because nothing meters it — the budget session is closed while a gate stands (`active` is false whenever a gate is pending), not because this key says so. Setting `metered: true` does not make the gate drain the budget. |
| `gameGate.passScore` | **not resolved at all**, at the top level or on a level. Pass is the verdict everywhere; the key is dropped before the gate sees it. |
| `gameGate.material` | **not resolved at all.** The pre-repertoire shape: one flat material list for the whole gate. Material now belongs to a level. A block carrying only this has no repertoire, so it runs on the built-in fallback. |
| `gameGate.ladder.*` | **not resolved at all.** The five-axis ladder it configured no longer exists. |
| `gameGate.users.{id}.path` | **not resolved at all.** `resolveGateConfig` drops it, and `resolveLearnerPath` — which would apply it — has tests and no production caller. The climb walks the GLOBAL tier-ordered repertoire for every child; only `startLevel` is per-learner. A `path` in the config expresses intent and changes nothing. |
| `gameGate.users.{id}.dailyEscalation.steps` / `capstoneAfter` / `capstoneLevel` | **not consumed.** `dailyChallengeLevel` is likewise tested and uncalled, so a day's completed games never raise the rung. Only `dailyEscalation.enabled` is read, and only to decide whether the host waits on the board-game day before painting. |
| `gameLimit.source: economy` | Not implemented. It does not open a coin/economy path; use `fixed` or `earned`. |

Neither kind logs anything when set. `every` and `metered` are resolved and then simply
never asked for; the rest are dropped by a config resolver that returns an explicit object
literal and names no rule for them. A parent who sets one, restarts the kiosk, and sees no
change gets no explanation — so they are called out here rather than presented as working
configuration.

Both blocks reach the frontend as **whole-node passthrough**. The client resolver drops
any key it does not name, and a gate whose config never arrives is a gate that is
permanently off while the YAML says on. That is the same mechanism as the rows above: the
difference is only whether something downstream reads the key once it lands.

For `fixed`, `dailyMinutes` and `deviceDailyMinutes` must be positive finite numbers; for
`earned`, `earned.perPassMinutes`, `earned.maxDailyMinutes`, and `deviceDailyMinutes` must
be positive finite numbers. The household timezone must also be set. A missing or malformed value is logged as `budget.config-invalid`
and the feature falls open — unmetered play, never a lockout — because the alternative,
`undefined × 60 = NaN` compared against zero, granted unlimited play in silence.

`gameLimit.source` is now a switch between two server-owned balance models.
`fixed` uses `dailyMinutes` (and per-user overrides); `earned` begins each learner at
zero and accepts only idempotent credits from a completed, passed PianoChallenge
assessment. The credit is `perPassMinutes × score`, rounded to seconds, and the available
earned balance is capped by `earned.maxDailyMinutes`. A retry carrying the same assessment
identity credits zero. The browser cannot adjust a balance directly, and an aborted or
timed-out result is rejected at the HTTP boundary. `economy` remains reserved and is not
implemented.

---

## Observability

Three layers with different lifetimes: the log store answers "what is happening now" and
expires in seven days, the day files answer "what happened in October", and the existing
per-user attempt evidence holds what was actually played.

**Every event on both sides carries `learnerId`, `deviceId`, `studyDate`, and
`sessionId`** — client and server, gate and budget alike. Gate events add `material`,
`rung` (the level id), `tier`, `mode` and `attemptId` once an attempt has resolved.
`material` names an exercise by its bank instance id and a score passage by document and
bars (`minuet-in-g.musicxml#1-4`); a synthesized lit key has no identity outside the
gate's own rotation counter and stays null, where `rung` and `tier` already say
everything a query can act on. So an afternoon reconstructs
from a single query, `"budget.warning" AND data.deviceId:<tablet>` answers "which tablet
burned the shared cap" without a join, and `studyDate` keeps a late-evening session whole
across the 4am boundary that a calendar-date filter would cut in half.

`gate.presented` is emitted before anything can decline, precisely so the runs worth
reconstructing — the fail-open ones — are not the ones missing an anchor.

### `piano-game-gate`

| Event | Level | Fires when |
|---|---|---|
| `gate.presented` | info | the gate mounts, before any decision |
| `gate.attempt` | info | material resolved; the run is about to take the screen |
| `gate.passed` | info | a genuine pass, with its score |
| `gate.ceremony-start` | info | the "Cleared" curtain went up, carrying the `plannedMs` it is meant to last |
| `gate.ceremony-done` | info / warn | the curtain parted and the game was handed control, with `actualMs` and `overranMs` against that plan. **warn** above a second of overrun |
| `gate.failed` | info | a judged attempt that missed its bar: completed below it, or stalled. `score` is `null` for a stall, which carries no number |
| `gate.rung-changed` | info | the ladder moved, with `{ from, to, direction }` — both level ids and `climb` \| `degrade` |
| `gate.floor-reached` | info | the ladder arrived at the floor — once per arrival |
| `gate.abandoned` | info | the child walked away; the ladder did not move |
| `gate.unavailable` | warn | infrastructure failed and the gate opened anyway |
| `gate.blocked` | warn | no player is chosen; the gate refuses without granting |
| `gate.material-skipped` | info | a configured material entry was declined, with its reason |
| `gate.material-config-invalid` | warn | every entry in a level failed for a config-class reason; the built-in C major fallback was served instead |
| `gate.drill-served` | info | a `drill` level resolved, with the set being asked (`step`), the program (`drill`), and `banked` / `total` reps for the day |

`gate.ceremony-start` / `gate.ceremony-done` bracket the one step of this flow that has
no other witness. The curtain stands between `gate.passed` and the game's own mount, so
when it stopped parting — its hand-over timeout was being re-armed by every re-render,
and a child resting a hand on the keys held it shut indefinitely — the only trace was an
unexplained gap between those two events, and it took a reconstruction to read. A curtain
that overruns its plan now says so on its own line, at `warn`.

`gate.rung-changed` and `gate.floor-reached` are the pair that says whether the ladder is
calibrated: a child who reaches the floor every time is being asked for material above
their level. The retry-count default is tuned from these, which is why the move carries
both ends — a line with only the destination cannot say which level the child left.

### `piano-games`

| Event | Level | Fires when |
|---|---|---|
| `game.mount` | info | a game is really on screen — logged from inside the Suspense boundary, so it means the chunk resolved and the game mounted, not that the host decided to render one |
| `game.unmount` | info | the match ended, with `playedMs` |

**These are the "did it actually work" pair, and they cover every game.** `game.mount`
used to live in the addressed-board family, so Connect Four and Checkers logged a mount
and Chess, Space Invaders, Tetris and the rest logged nothing — which made the first
question anyone asks about a stuck kiosk answerable for two games out of nine. Both
carry `matchId`, so a rematch is a new mount and a bounce is a short `playedMs`.

### `piano-game-budget`

| Event | Level | Side | Fires when |
|---|---|---|---|
| `budget.opened` | info | server | a session opened or was adopted |
| `budget.settled` | debug | server / client | a settle landed |
| `budget.depleted` | info | server / client | the learner's allowance reached zero |
| `budget.device-depleted` | info | server / client | the device's shared cap reached zero |
| `budget.day-rollover` | info | server | a session was carried across the 4am boundary |
| `budget.settle-failed` | error / warn | server / client | a charge did not land |
| `budget.learner-mismatch` | error / warn | server / client | a session id arrived with the wrong learner |
| `budget.config-invalid` | error | server | timezone or a minutes value is missing or malformed |
| `budget.idle-paused` | info | client | the child stopped being present |
| `budget.idle-resumed` | info | client | they came back |
| `budget.warning` | info | client | the balance crossed the warning threshold |
| `budget.open-failed` | warn | client | opening a session threw; play continues unmetered |
| `budget.disabled` | debug | client | the feature is off — the ordinary state, not a failure |
| `budget.seed-invalid` | warn | client | open answered without a usable cumulative to seed from |

`budget.settle-failed` is the alerting signal: a settle that never lands is uncharged
play. `budget.disabled` exists so that turning the feature off does not fill warn-level
triage with a failure that never happened.

`budget.warning` is an **edge, not a state**. The meter recomputes the warning condition
every second, so a per-state line would write one identical entry per second for the
whole window — 300 lines per child per depletion with the shipped defaults — and drown
the one that carries news.

It re-arms two ways. Within a session, if the balance climbs back above the threshold — a
settle can return a larger `secondsLeft` than the local countdown held. And **at every
match boundary**, because the meter is suppressed while the gate is up: with both features
on, the meter's session tears down and reopens around each challenge, so a child playing
five short matches inside one warning window gets five lines, not one. Harmless in volume
(the window is minutes, not hours), but it is a per-match edge, not a per-window one.

`budget.day-rollover` has no durable home of its own. The boundary is recorded by *which
file* a charge lands in, which is why the day files are the thing worth asserting: two
settles across 4am produce two files.

---

## Where things live

| Concern | Path |
|---|---|
| The gate host, config resolution, ladder persistence | `frontend/src/modules/Piano/PianoKiosk/modes/Games/GameGate.jsx` |
| The repertoire: levels, ordering, floor, rotation (pure) | `frontend/src/modules/Piano/PianoKiosk/modes/Games/gateRepertoire.js` |
| A level's requirement, and the sentence a child reads (pure) | `frontend/src/modules/Piano/PianoKiosk/modes/Games/gateAsk.js` |
| Who the gate stands in front of (pure) | `frontend/src/modules/Piano/PianoKiosk/modes/Games/gateScope.js` |
| Material seam and selection (pure) | `frontend/src/modules/Piano/PianoKiosk/modes/Games/gateMaterial.js` |
| What a tier makes the run look like — stage, clef, spelling (pure) | `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/runPresentation.js` |
| The run surface itself | `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.jsx` |
| The tier 0-1 lit-keyboard ask | `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/KeysAsk.jsx` |
| The tier-2 sequence staff | `frontend/src/modules/MusicNotation/renderers/SvgSequenceStaff.jsx` |
| The score passage stage | `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ScorePassage.jsx` |
| Match-boundary seam between a game and its host | `frontend/src/modules/Piano/PianoKiosk/modes/Games/MatchGateContext.js` · `game-platform/host/useMatchRematch.js` |
| Gate stack mounting, budget locks, warning banner | `frontend/src/modules/Piano/PianoKiosk/modes/Games/Games.jsx` |
| The client meter | `frontend/src/modules/Piano/PianoKiosk/useGameBudgetMeter.js` |
| The shared activity signal | `frontend/src/modules/Piano/PianoKiosk/activitySignal.js` |
| Kiosk device identity | `frontend/src/modules/Piano/PianoKiosk/kioskDeviceIdentity.js` |
| Config defaults and projection | `frontend/src/modules/Piano/PianoKiosk/pianoConfigModel.js` |
| Client study day (the shared 4am boundary) | `frontend/src/modules/Piano/PianoKiosk/clientStudyDate.js` |
| Budget domain math | `backend/src/2_domains/piano/gameBudget.mjs` |
| Budget orchestration | `backend/src/3_applications/piano/PianoGameBudgetService.mjs` |
| Day files | `backend/src/1_adapters/persistence/yaml/YamlPianoGameBudgetStore.mjs` · `data/household/history/piano-games/` |
| Routes | `backend/src/4_api/v1/routers/piano.mjs` |
| Event coverage spec | `frontend/src/modules/Piano/PianoKiosk/modes/Games/gateEvents.test.jsx` |
| What a child actually sees, measured in a real layout engine | `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.measure.test.jsx` |

---

## Open questions

1. **Retry count before the level drops.** The default matters: too low and the ladder
   collapses to the floor on one normal bad attempt, too high and a stuck child grinds.
   `gate.rung-changed` and `gate.floor-reached` are instrumented precisely so this is
   tuned against real data rather than guessed.
2. **Whether the device cap should exempt an adult profile.** A grown-up sitting down to
   play should probably not consume the children's device allowance.
3. **Whether a passed gate should bank credit for more than one match**, so a strong run
   buys a short streak rather than exactly one game.
4. **Enharmonic spelling in the exercise bank.** Its root axis publishes twelve
   sharp-named pitch classes, so the flat keys can only be addressed by their sharp names
   and are then spelled that way on the staff a child is reading letters from. L3
   therefore carries `A` and `E` only: `A#` and `D#` would put the same staff letter
   twice in a row (B♯, C♯♯, E♯, F♯♯) in front of a child learning exactly those letters.
   Until an enharmonic axis exists on the bank, the ladder above two sharps has one
   fewer rung than it should. The fix is that axis, not a spelling table in the gate.
5. **Where a `score` level belongs in the ladder.** The material kind, the engraving, the
   measure-range compilation and the grading all ship and are tested end to end; no level
   in the household config names a document yet, because no study piece has been chosen.
