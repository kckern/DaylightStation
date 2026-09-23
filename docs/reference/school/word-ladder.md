# Word ladder (vocabulary word packages)

A flashcard enrollment in `policy.mode: word-ladder`. **The child sorts; the
round-end quiz verifies; only a quiz grades.** Self-study is flashcards the
child sorts into three piles (Not yet / Familiar / Got it); every word not
sorted Not yet is quizzed at the end of its round; mastered words come back at
widening gaps.

The word ladder is **language-neutral**. Everything that names a language —
which one is being learned, which one the meanings are written in, the tile
title — lives in a **word package**'s lexicon YAML. Adding a language is new
YAML + media, never a code change. Korean (`korean-vocab`) is the worked
example throughout.

Spec: `docs/_wip/plans/2026-09-22-word-ladder-mastery-redesign.md` (rev 4).
This page describes what **Plan 1 (core loop)** and **Plan 2 (tricky-word
drill, speaking, on-screen keypad, practice menu)** actually ship; see
[What is not yet built](#what-is-not-yet-built) for the rest.

## Where things live

| What | Where |
|---|---|
| Lexicon | `media/school/language/<package>/lexicon.yml` (e.g. `language/korean-vocab/lexicon.yml`) |
| Word media | `media/school/language/<package>/words/<group>/<id>/{image.jpg,term.mp3,gloss.mp3}` |
| Weekly deck | `data/content/school/learning-catalog/flashcard-decks/<deck id>.yml` (`lexicon:` + `words:`), e.g. `language/korean/week-01-classroom` |
| Enrollment | learner plan `programs:` → `{programId: flashcards, deckId, title, policy: {mode: word-ladder}, schedule}` |
| Status (v3) | `data/users/{learnerId}/apps/school/word-ladder/<package>/status.yml` |
| Day file | `data/users/{learnerId}/apps/school/word-ladder/<package>/days/<studyDay>.yml` |
| Judgement cache | `data/household/school/runtime/word-ladder/<package>/judgements.yml` (derived, shared across learners) |
| Spoken takes | `media/school/recordings/word-ladder/<package>/<learnerId>/<studyDay>/<wordId>-<n>.<ext>` (for grown-ups; never graded) |
| Code (domain) | `backend/src/2_domains/school/wordLadder/` — pure engine, states, choices, rounds, jamo scoring, settings, scenarios |
| Code (application) | `backend/src/3_applications/school/{WordLadderSittingService,WordLadderTypedJudge,WordLadderDoorLauncher}.mjs` |
| Code (adapters) | `backend/src/1_adapters/school/wordLadder/{YamlWordLadderStore,ShadowWordLadderStores,YamlJudgementCache,FilesystemWordLadderRecordings,DiscardingRecordings}.mjs` |
| Code (API) | `backend/src/4_api/v1/routers/school.wordLadder.mjs` |
| Code (frontend) | `frontend/src/modules/School/Programs/Flashcards/WordLadder/` |

Everything per learner is keyed by the lexicon's `package`: status, day files
and the judgement cache. Word ids need only be unique **within** a package.

## The lexicon (`school.word-lexicon/v2`)

```yaml
schema: school.word-lexicon/v2
package: korean-vocab            # stable id — status and the capability key use it
language: { code: ko, name: Korean }    # the language being learned (BCP-47 code → lang= attributes)
gloss:    { code: en, name: English }   # the learner's language the meanings are in
program:
  title: Korean words            # default tile title for an enrollment of a deck using this lexicon
entries:
  - id: gawi                     # permanent once studied
    kind: word                   # word | phrase
    group: week-01-classroom     # the course unit that FIRST introduced the word; names its media folder
    term: 가위                    # in the language being learned
    gloss: Scissors              # in the learner's language
    pronunciation: null          # required for a phrase
    decoys:
      term: [가지, 바위, 가방]      # ≥3, confusable, never the answer
      gloss: [Knife, Tape, Ruler]
```

`package`, `language`, `gloss`, `program.title` and every entry's `group` are
required; `package`, `id` and `group` are strict lowercase slugs (path-safe).

**Groups.** A package's word folders are grouped by course unit so the media
tree stays browsable: a new week is a new `group` folder. `group` records where
a word was **first** introduced — a later deck may reuse words from any group.
Status is keyed by word id alone, so moving a word to another group (move its
folder AND change its `group`) loses no progress.

## States and transitions

| State | Child sees | Entered by |
|---|---|---|
| `new` | — | not introduced |
| `introduced` | New | introduction; left on the first sort |
| `notYet` | Not yet | child's sort |
| `familiar` | Familiar | child's sort, a failed verify, a failed recheck, or a paper miss on a claimed/mastered word |
| `claimed` | Got it | child's sort |
| `mastered` stage 0 | Mastered ⭐ | a passed verify; due next study day |
| `mastered` stage s ≥ 1 | Mastered ⭐… | s passed rechecks |

**Only a quiz grades** (round-end verify, rechecks, the paper quiz). Sorting a
card, drill, match, say, write and listen never change a level except: sorting
moves a word down freely and up only to `claimed` (a mastered word sorted Not
yet/Familiar drops, stage reset; Got it on a mastered word does nothing). A
graded miss lands on `familiar` — never lower, never higher than the word
already was.

| Event | From | Result |
|---|---|---|
| Verify passed | `familiar`, `claimed` | `mastered` s0, due next study day; streak 0; tricky off |
| Verify failed | `familiar`, `claimed` | `familiar`; streak +1; `verifyFailedDay` = today |
| Recheck passed | `mastered` s | stage s+1; due day + round(`GAPS[min(s+1,5)]` × `review.gapScale`) study days, `GAPS = [1, 3, 7, 14, 30, 60]` |
| Recheck failed | `mastered` s | `familiar`, stage cleared; streak +1 |
| Paper row miss (fold) | `familiar`, `claimed`, `mastered` | `familiar`, stage cleared; streak +1 |
| Paper row miss | `new`, `introduced`, `notYet` | logged only |
| Paper row pass | any | logged only |

`missStreak ≥ drill.afterMisses` sets `tricky` (flags the word — see
[The tricky-word drill](#the-tricky-word-drill-spec-3-drill-path) below).
Code: `backend/src/2_domains/school/wordLadder/mastery.mjs`.

## Rounds and the three piles

A **round** is up to `round.size` (default 5) quizzable words; a word is a
member of at most one round per study day. In the round's flashcard stream the
child sorts each card:

| Pile | Key | Returns after | At round end |
|---|---|---|---|
| **Not yet** | 1 | 2 other cards | not quizzed — unless `notYetCarry` is set (its second consecutive round end) |
| **Familiar** | 2 | 5 other cards, or last in the pass | quizzed |
| **Got it** | 3 | leaves the stream | quizzed |

The stream ends when no word's latest sort is Not yet, or after
`round.maxPasses` (default 3) passes, or the child taps **Quiz me**. **Undo**
reverses the last sort while its card is still the most recent.

**Round end (verify)**: every word whose latest sort is Familiar or Got it,
plus every `notYetCarry` word, and whose `verifyFailedDay` is not today. Per
word, two graded tasks, **hardest first**, stopping at the first miss:

1. **3.3 type-from-cue** (judged for meaning) — proves the word can be
   produced from its meaning.
2. **2.2 pick-meaning, hear channel** (read channel if no term audio) —
   proves it is known by ear.

Right → the next task; wrong → the correct answer is shown (with audio), the
word fails verify, its remaining task is dropped. Both right → passed. Every
graded choice task has a **Don't know** option (counts as a miss).

### Rechecks

One graded task per due word: below stage 2, `2.2` and `3.1` alternate and
every `review.typedEvery`-th recheck is `3.3`; stage 2 and above is always
`3.3`.

## The tricky-word drill (spec §3 drill path)

A word whose graded-miss streak reaches `drill.afterMisses` is flagged
`tricky` (see States above), but the flag alone changes nothing else. Up to
`drill.perSitting` (default 1) tricky words are drilled per **study day**,
oldest `trickySince` first, drawn from the day's at-open snapshot; a word
already drilled that day is never drawn again. The tricky drill starts at
the top of a study day (after rechecks, before rounds), but only while the
day's remaining time is at least 4 minutes (`DRILL_MS`, the drill's own time
estimate) — if it doesn't fit, the day proceeds without it and the word
stays tricky for another day. **Nothing in a drill grades or changes word
state**; it exists purely to walk one word from full support to none.

Steps, fixed at creation and always in this order
(`DRILL_STEPS` in `backend/src/2_domains/school/wordLadder/drill.mjs`):

| Step | What the child does | Skipped when |
|---|---|---|
| **look** | sees the picture, term and meaning together, and hears the term | never |
| **copy** | the term is on screen; types it | never |
| **say-after** | hears the term, records saying it after | no microphone capability, or the word has no term audio |
| **match** | 4-pair picture/text match board (the drill word plus up to 3 other introduced words) | fewer than 2 other introduced words exist to pair with |
| **read-aloud** | reads the term aloud and records; the native audio is revealed only after the take | no microphone capability |
| **dictation** | hears the term (no text shown), types what was heard | the word has no term audio |
| **tiles** | taps syllable tiles (the term's syllables plus 2 decoys) to spell the term from a cue | never |
| **say-from-cue** | given only a cue (no term shown at all), records saying the term; the term is revealed only after the take | no microphone capability |
| **type** | given only a cue, types the term | never |

A step needing a microphone or term audio is dropped from the walk when the
drill is created (`stepsFor`/`drillSteps`) — never shown and blocked on, and
never an error. **Tiles and dictation are never dead ends**: a miss retries
the same step in place — the term stays hidden through the first miss, is
**revealed** (read-only, "It's 가위 — …", the step becomes copyable) after
the **second** miss, and the step **advances regardless on the third try**.
When a tiles or dictation step advances (a match or the third miss) the
program **holds** that verdict — "Right!" or "It's 가위" — with a Next
button before the next step replaces it (`HELD_DRILL_STEPS`). An open drill
whose word has since left the lexicon is treated as done (`openDrill`), never
a 500.
Copy and type must match exactly to advance (copy's miss carries the answer
so the retry can be completed); say-after / read-aloud / say-from-cue are
speaking and never graded at all (see [Speaking](#speaking-never-graded)).

Two ways into a drill:

- **Tricky drill** (`source: 'tricky'`) — automatic, described above.
- **Round-end drill offer** (`source: 'offer'`, spec §3) — **at most one per
  round**, for the round's word whose latest sort was Not yet with the most
  Not-yet sorts this round, and only while the drill still fits the
  remaining time (≥ 4 minutes; never offered once the day's cap is spent).
  The child is asked "This one's tricky — want to practise it?"
  (`Practise` / `Not now`, keys 1/2, `items/DrillOfferItem.jsx`) — never
  forced, and answering either way finishes the round.

## Speaking (never graded)

Say-after (drill, round intro, and the practice menu's Say mode),
read-aloud and say-from-cue (spec §3 1.2 / 1.3 / 3.4) are never graded and
never a gate: Skip/Next is available from the moment the item is on
screen, and whatever button is pressed the response is always
`{done:true}` — a take is never required, only offered.

A **kept** take (one that passes the shared speech floor —
`shared/speechFloor.js`, not too quiet, not too short) is uploaded via
`POST /word-ladder/sittings/:sittingId/recordings/:itemId` and saved for a
grown-up to review at
`media/school/recordings/word-ladder/<package>/<learnerId>/<studyDay>/<wordId>-<n>.<ext>`
(`FilesystemWordLadderRecordings`). **Test mode never writes a file**: its
sink (`DiscardingRecordings`) counts the take and drops it, so the test
banner's "nothing is saved" holds for speaking too. A refused take (too
quiet / too short) is never uploaded and never disables anything.

What the child sees before a take differs by step, following exactly what
the server sent (never a local guess):

- **say-after** — the full word card and its native audio play on arrival
  ("see and hear it, then say it"); the take reveals nothing new.
- **read-aloud** — the term's text only; no audio until a take is uploaded,
  at which point the response's `reveal: {term, audio}` unlocks the native
  clip.
- **say-from-cue** — no word at all, only a cue; the term itself is learned
  for the first time from `reveal.term` after a take — reading it off the
  card can't stand in for recalling it.

Playback order after a kept take is always the child's own take, then the
native audio — never the other order. An upload failure is logged
(`recordingFailed`) and never blocks; for read-aloud/say-from-cue nothing is
revealed on a failed upload (the take was still said and heard — only the
grown-up review copy, and the reveal, are missing).

**Intro say-after**: introducing a new word (spec §2 flash → say → copy)
inserts a say-after step between the flashcard flash and the copy step,
but only when the sitting has microphone capability **and** the word has
term audio — otherwise introduction goes straight from flash to copy.

## The on-screen jamo keypad (spec §6)

There is no web API that tells a page a Bluetooth keyboard is attached, so
the keypad (`JamoKeypad.jsx`) is a **toggle**, offered on every typing item
(copy, dictation, graded typed, and a drill's copy/dictation/type steps).
Two-set (두벌식) layout: base rows plus a Shift key for ㅃ/ㅉ/ㄸ/ㄲ/ㅆ/ㅒ/ㅖ
(Shift is one-shot — it releases after the next key press whether or not
that key has a Shift form), backspace, and Enter/submit. Every key fires on
`onPointerDown` (never `onClick`) and re-focuses the field first, so a tap
never loses focus mid-run.

It **auto-opens once per item**: once the field has had focus for 10 s with
no keydown, the keypad opens itself and refocuses the field
(`KEYPAD_AUTO_OPEN_MS` in `TypedItem.jsx`) — skipped if the item has since
moved on or the field is disabled (a held verdict, a submit in flight). It
**closes on the first physical keydown** on the field — a `document`-level
capture listener, because the in-page Hangul IME's own capture listener
stops propagation before it would otherwise reach the field. When the
keypad is open, the typed item's prompt collapses to a compact height so
the stage still fits at 1280×800.

## Typed input and the judge (`WordLadderTypedJudge`)

A mastery test, not a spelling test — grading is deliberately generous.
`backend/src/3_applications/school/WordLadderTypedJudge.mjs` runs the
deterministic half (`2_domains/school/wordLadder/{jamo,typedScore}.mjs`) in
order, first decision wins:

| Step | Condition | Score |
|---|---|---|
| Exact | normalised match | 10, `judge: exact` |
| No Hangul | attempt has no Hangul syllable/jamo | 1, `judge: no-hangul` |
| Different real word | normalised match to another introduced word or an authored decoy | 2, `judge: guard` |
| Deterministic (short, L ≤ 4 jamo) | distance 1 → 6 · distance ≥ 2 → 2 | `judge: distance` |
| Deterministic (longer) | d/L ≤ 10% → 8 · ≤ 20% → 6 · ≤ 33% → 4 · beyond → 2 | `judge: distance` |

Distance is Levenshtein over **jamo as typed on a two-set keyboard** (compound
vowels/finals split into component keys; tense consonants and ㅒ/ㅖ stay
single). **Short words (≤ 2 syllables): the deterministic score is final** — no
model call. **Longer words**: if `word_ladder.judge.model` is configured, a
small low-effort model may raise an eligible floor (score ≥ 4 and d/L ≤ 33%) by
**one band** (`judge: model`), never lower it; model failure or timeout falls
back to the deterministic score (`judge: fallback`). **On this household
`word_ladder.judge.model` is `gpt-5-nano`**, so a long-word misspelling that
clears the deterministic floor can still gain the model's +1-band step;
verdicts still land on `exact`, `no-hangul`, `guard`, `distance`, `cache` or
`fallback` whenever the model doesn't apply or doesn't answer in time.

Pass = score ≥ `typing.passScore` (default 6). Verdicts are cached by
(package, word id, normalised answer) in
`data/household/school/runtime/word-ladder/<package>/judgements.yml`
(`YamlJudgementCache`) — a reload or repeated typo gets the same verdict with
no second call.

## Goal, cap, and a study day

Goal and cap are **per study day, across all of that day's sittings** — idle
close makes several sittings a day routine.

- **Goal** = every recheck in the day's first sitting's at-open snapshot
  answered, every round started today finished (stream + quiz), and the
  day's tricky-word drill — if the day started one — finished too. A day
  cannot go "done" with an open drill sitting mid-walk.
- **Cap** = cumulative `activeMs` of the day's sittings ≥ `session.capMinutes`
  (default 15; active means input within the last 45s) with no round in
  progress.
- `doneToday` = goal met, or cap reached. A later sitting on a done day opens
  straight to the summary.
- `doneAt` is stamped by whichever of `openDay` / `respond` first finds the day
  settled (no round open, and either no recheck pending with no round left to
  plan, or the cap spent). A day with nothing to do — every word mastered and
  none due — is therefore credited the moment it is opened, not left
  "In progress".

New words available to introduce today =
`max(0, min(batch.newPerDay, batch.workingSet − unsettled))`, computed when the
sitting reaches introductions (so today's misses count first). The pool is
every not-yet-introduced word of the current deck and any deck the learner was
enrolled in before (`status.decksSeen`) — a deck is a quota, not a deadline.

## Settings and bounds

Defaults live in `backend/src/2_domains/school/wordLadder/settings.mjs`;
`school.yml`'s `word_ladder.settings` / `word_ladder.bounds` override them
(`resolveSettings`). **The tuning values in force for a study day are frozen
at its first open** (`dayFile.atOpen.settings`) — a mid-day config edit never
moves the goalposts under a child already partway through.

| Setting | Decides | Default |
|---|---|---|
| `round.size` | words per round | 5 |
| `round.maxPasses` | stream passes before it ends | 3 |
| `batch.newPerDay` | new words per day | 4 |
| `batch.workingSet` | unsettled-word cap | 7 |
| `review.gapScale` | recheck gap multiplier | 1.0 |
| `review.typedEvery` | typed-recheck cadence below stage 2 | 2 |
| `drill.afterMisses` | graded-miss streak → tricky | 2 |
| `drill.perSitting` | tricky words drilled per study day | 1 |
| `session.capMinutes` | day cap | 15 |
| `typing.passScore` | judge pass threshold | 6 |

## The practice menu (spec §6, post-goal)

Once the day is done (goal or cap) the summary shows once
(`dayFile.summarySeen`), then the **practice menu**: exactly the modes the
server lists in `item.modes` (`PRACTICE_MODES` in
`backend/src/2_domains/school/wordLadder/practice.mjs`: flashcards, match,
say, write, listen, drill, quiz) — a mode whose default run (with help,
every introduced word) would come up empty is not offered at all. **Say** is
the exception: it is offered when EITHER variant has a run (Without help
needs no term audio), and the menu item's `sayHelp` (`[true,false]` subset)
lists the variants the With/Without help chooser offers. Only
**Quiz me** grades (rule 1); every other mode is study and never changes a
word's state except a sort (down freely, up only to Got it, same as the
round stream).

| Mode | How it's chosen | With help | Without help |
|---|---|---|---|
| Flashcards | front side ("Word first" / "Meaning first") | term-first | meaning-first |
| Match | starts directly | 4–6 pair picture/text boards over the practice word set | — |
| Say | With help / Without help | **1.2 say-after** — hears the term, says it after (dropped from the run if no microphone or the word has no term audio) | **3.4 say-from-cue** — cue only; there's no model to say after, so the native comparison at the end is simply skipped |
| Write | With help / Without help | **1.1 copy-type** — the term is on screen, type it | **3.3 type-from-cue** — cue only, no reference to copy; a **Show me** button submits an empty answer and reveals the word (the drill's type step has it too) |
| Listen | starts directly | one run through every practice word that has term audio (`items/ListenItem.jsx`) | — |
| Drill | word picker first (**My words**, multi-select, "Drill these") | the same drill walk as the tricky-word drill (look → … → type), over the chosen words | — |
| Quiz me | starts directly | graded — see below | — |

**Quiz me eligibility** is the same rule as a round's verify (rule 3):
`familiar` or `claimed` state, or `notYetCarry === true` — never `new`,
`introduced` or `notYet` — and never a word whose `verifyFailedDay` is
today.

**Practice flashcards are forward-only.** The spec (§6) describes a
practice flashcard run with prev/next and undo; Plan 2 shipped it
**forward-only** — a deliberate ruling recorded mid-build, not an
oversight. Sort 1/2/3 or Space advances; there is no back/undo key on this
run. Cost if wrong: a child can't back up a card in free practice.

A practice run replaces any earlier one; starting one also marks the
summary seen. `{menu:true}` (the Menu button, key **M**) ends the run early
and returns to the menu — disabled while a typing item's field has focus,
so a Korean-layout keystroke (ㅡ, physically `M`) can't end the run by
accident.

### My words

Read-only from the practice menu ("My words", `items/WordsItem.jsx`) or as
the word picker for Drill ("Pick words to drill", `pick` mode, introduced
words only): every word the learner can meet — decks seen in order, then
the current deck, plus any other introduced word — with a state chip
(New / Just met / Not yet / Familiar / Got it / Mastered, with stars for
mastery stage) and a Tricky chip when set. `GET /word-ladder/words` in test
mode **requires `sittingId`** — it reads that sitting's shadow; there is no
"current" live status for it to fall back to.

## API

Mounted by `mountWordLadderRoutes` (`backend/src/4_api/v1/routers/school.wordLadder.mjs`)
at `/api/v1/school/word-ladder` (live) and `/api/v1/school/word-ladder/test`
(test mode, same shape). Every response is `Cache-Control: private, no-store`.

- `POST /word-ladder/open {userId, deckId, capabilities?: {microphone}}` → `{sittingId, day, package, title, language, gloss, item, progress}`
  (no microphone → no speaking steps; test mode also takes `scenario`)
- `POST /word-ladder/sittings/:sittingId/items/:itemId {userId, response}` → `{result, item, progress}`;
  `response` shape depends on the current item: `{seen:true}` (flashcard intro),
  `{sort}` (flashcard stream), `{typed}` (copy / typed), `{choice}` / `{dontKnow:true}` (choice)
- `GET /word-ladder/sittings/:sittingId?userId=` → current item + progress (reload)
- `POST /word-ladder/sittings/:sittingId/close {userId, reason}` — `reason` ∈ `goal|cap|leave|idle|unmount`
- `POST /word-ladder/sittings/:sittingId/recordings/:itemId?userId=&ext=` — raw audio body
  (`audio/webm|ogg|mp4`, `application/octet-stream`, ≤10 MB) → `{take}`, plus
  `reveal: {term, audio}` for read-aloud / say-from-cue. Only for the current
  item when it is a speaking step (`say`, or a drill's say-after / read-aloud /
  say-from-cue); never touches status. Test mode's sink keeps nothing.
- `POST /word-ladder/sittings/:sittingId/practice {userId, mode, help, filter, chosen, frontSide}` → `{item, progress}`;
  400 before today's goal
- `GET /word-ladder/words?userId=&deckId=[&sittingId=]` → `{words: [{wordId, term, gloss, state, stage, tricky, dueDay}]}`
  in deck order (decks seen, then this one); test mode requires `sittingId` and reads that shadow

Items never leak an answer: dictation carries only the term audio; tiles the
syllables and a cue; type / say-from-cue only the cue; read-aloud the text with
no audio until the take; look / copy / say-after the full word card.
- `GET /word-ladder/stage` → `{screen}` (the configured stage screen id, see below)
- `POST /word-ladder/fold {learnerId, actorId, pin}` — teacher-gated: runs the paper-quiz fold for every
  word-ladder package the learner is enrolled in, on demand

Item ids make every response idempotent. A sitting belongs to its study day:
after the day boundary it 404s and the client reopens. **Server idle close:** a
sitting with no item POST for 5 minutes is closed (`reason: idle`) by the next
request that touches the learner's day, closing every *other* open sitting at
its last input — a reload or a late answer on the current one still lands.

## The door and `/test`

```
/school/go/<learner>/word-ladder              the real sitting
/school/go/<learner>/word-ladder/test         read-only test sitting
/school/go/<learner>/word-ladder/<pkg>[/test] when the learner has >1 word package
```

`WordLadderDoorLauncher` resolves the learner's **current** word-ladder
enrollment and mints the ordinary flashcards launch target — no new authority.
With several packages, a bare URL 404s listing them; name the package to pick
one. This is the household's [code-free admin door](../../runbooks/school/README.md#opening-a-program-without-an-access-code);
`/test` is a reserved final segment the frontend parses off before the program
id/instance (`SchoolApp.jsx`) — a program with no test mode refuses a `/test`
URL from the URL alone, before any grant is asked for.

**Test mode** runs the same engine over a `ShadowWordLadderStores` in-memory
deep copy of the learner's real status + today's day file, snapshotted at
open. The typed judge still runs (so verdicts can be tested) but its cache is
an in-memory `MemoryJudgementCache` — test mode **never writes**
`judgements.yml`, `status.yml` or the day file. Sitting ids are
`test.<pkg>.<token>.<n>`, refused by the live router and vice versa. Shadows
expire after a 3-hour TTL (max 20 live at once); an evicted or restarted
shadow 404s on next touch and the client reopens. The banner reads
**"TEST — nothing is saved"**.

`?scenario=` seeds the shadow before the sitting opens
(`backend/src/2_domains/school/wordLadder/scenarios.mjs`):

| Scenario | Seeds |
|---|---|
| `today` (default) | the real snapshot, untouched |
| `fresh` | empty status and day file — every word `new` |
| `due` | every deck word `mastered` stage 1, due today — rechecks |
| `round-end` | every deck word `familiar`, introduced yesterday — straight to round-end verify |
| `tricky` | every deck word `familiar` (introduced 3 days ago); the first is tricky since yesterday — the day opens on its drill |
| `typos` | every deck word `familiar`, introduced yesterday — a carry round whose quiz has typed items to misspell |
| `done` | today already closed (`doneAt` = today) — straight to the summary/menu |

A backend safety test
(`backend/src/3_applications/school/WordLadderTestMode.test.mjs`) drives a full
test sitting end to end and asserts every real file on disk is byte-identical
before and after — this is the guarantee the banner promises.

## Stage, layout, text fitting

The program renders inside a **fixed stage** sized from config, never code:
`GET /word-ladder/stage` returns the screen id named by `school.yml`'s
`word_ladder.stage.screen` (the Portal); `WordLadderStage.jsx` reads that
screen's `resolution` from `/api/v1/screens/<id>` (e.g. `screens/portal.yml`:
1280×800) and centres/scales the stage uniformly to fit whatever the actual
viewport is. If either fetch fails, the stage falls back to the raw viewport
size and logs `school-word-ladder.stage-failed` rather than rendering nothing.

Text roles (`FitText.jsx`) fit the largest size that fits their region — no
break inside a word, per-role min/max — and expose it as an `.wl-fit` element
so a Playwright spec can assert none of them overflow their box (see
`tests/live/flow/school/word-ladder-stage.runtime.test.mjs`).

The sitting does not open on mount: the program first shows its title
(`descriptor.title`, else "Words") and a **Start** button (Space/Enter). That
tap is the page's user gesture, so the clips after it may autoplay; only then
is `POST …/open` sent. The test banner shows on the Start screen too.

Items live today: flashcard front/back (`items/FlashcardItem.jsx`, intro and
practice modes), choice (`items/ChoiceItem.jsx`), typed/copy/dictation/
practice (`items/TypedItem.jsx`), the tricky-word drill
(`items/DrillItem.jsx`, delegating each step to the item that already
renders that task, plus `items/TilesItem.jsx` for pick-spelling and
`items/MatchItem.jsx` for the match board), the round-end drill offer
(`items/DrillOfferItem.jsx`), speaking (`items/SayItem.jsx` — say-after,
read-aloud, say-from-cue), the practice menu's listen run
(`items/ListenItem.jsx`), the practice menu and My words / word picker
(`items/MenuItem.jsx`, `items/WordsItem.jsx`), and summary
(`items/SummaryItem.jsx`). Keys: `useWordLadderKeys.js` (1/2/3 sort,
Space/Enter continue, 1–4/0 choices, U undo, Q quiz me, H hear, match board
digits (both columns hinted: a digit picks a word, the next picks its
meaning), M menu — only
while a practice item is on screen and no typing field has focus). Keys match the
**physical** key (`event.code` — `KeyH`, `Digit1`, `Space`, `NumpadEnter`…)
first and `event.key` second, because on a Korean keyboard layout `key` for H
is `ㅗ`. Keys typed into an input are never taken as commands.

The typed field declares the lexicon's BCP-47 code (`lang` / `data-ime-lang`,
e.g. `ko`); `ime/languages.js` normalises it (`ko`, `ko-KR` → `KR`) so the
in-page Hangul IME switches to Korean on focus. A copy mismatch clears the
field for the retry.

**One audio lane** (`wordLadderAudio.js`): every clip goes through
`startClip`, and starting one stops whichever is playing; the program stops
the lane on unmount. **A late take is dropped**: `useTakeRecorder` ignores a
MediaRecorder `onstop` that lands after its item unmounted (Stop, then Next),
so it is never uploaded or played over the next item.

An **image cue** on 3.1 / 3.3 always arrives with the gloss as `cue.text` (the
gloss is the cue there, never the answer). `items/CuePicture.jsx` renders the
picture and falls back to that text when the image has no asset or fails to
load (logging `media.failed` at warn).

### Testing on the Portal

FKB's **autoplay** setting must be enabled on the Portal for cue and answer
audio to play without a tap-to-unlock stall — see the
[School runbook](../../runbooks/school/README.md). Drive a scenario headless
with `WORD_LADDER_TEST_LEARNER=<id> npx playwright test
tests/live/flow/school/word-ladder-stage.runtime.test.mjs`, or open
`/school/go/<learner>/word-ladder/test?scenario=fresh` in a grown-up's browser
by hand.

## Logs

Backend: `school.word-ladder.{opened,graded,reopened,closed,folded,attempts-unreadable,decks-unlisted,status-corrupt}`,
all carrying `mode: live|test`. Frontend
(`context.component: school-word-ladder`, events `school.word-ladder.*`):
`started` (Start tapped), `plan.failed`, `stage-failed`, `media.failed`
(image cue fell back to text), and the item/response events the program logs
on each turn.

## What is not yet built

This page describes **Plan 1 (core loop)** and **Plan 2 (tricky-word drill,
speaking, on-screen keypad, practice menu)**:
`docs/_wip/plans/2026-09-22-word-ladder-plan-1-core-loop.md`,
`docs/_wip/plans/2026-09-22-word-ladder-plan-2-drill-practice.md`. The rest of
the spec is written but not implemented:

- **Trace CLI and grown-up word controls** — `docs/_wip/plans/2026-09-22-word-ladder-plan-4-observability-controls.md`.
  `school word-ladder trace` and the teacher console's per-word reset/exclude/
  re-grade controls do not exist; a word's state is visible only in
  `status.yml` today.
- **Practice flashcards prev/undo** — spec §6 describes a practice
  flashcard run with prev/next and undo; Plan 2 shipped it forward-only (see
  [The practice menu](#the-practice-menu-spec-6-post-goal)), by ruling.
- **Tuning agent** — `docs/_wip/plans/2026-09-22-word-ladder-plan-5-tuning-agent.md`.
  `word_ladder.settings` / `word_ladder.bounds` are static config; nothing
  adjusts them automatically yet.

## Printed quiz and the fold (spec §8)

Two quiz sources share one row shape (`buildWordQuizSource` /
`buildLearnerQuizSource`, `backend/src/2_domains/school/wordLadder/quizSource.mjs`):
one `question` block per word, `itemId: <wordId>` (so a scanned row's attempt
names the word the fold demotes), answer + three authored decoys, alternating
term→gloss (`What does **<term>** mean?`) / gloss→term (`Which is **<gloss>**
in <language.name>?`), deterministic from the seed, `fit.typeScale: young`.
The header instruction and `topics` come from the lexicon's `quiz` block.

### Whole-deck quiz (every word in one deck)

    node cli/school.mjs word-ladder quiz --deck week-01-classroom
    node cli/school.mjs docs publish language/korean/week-01-classroom-quiz.yml

Writes `<deckId>-quiz.yml`, one question per word in the deck — including
un-introduced words, whose miss is logged only, never demoted. A bare
`--deck` slug resolves only when exactly one deck id ends with `/<slug>`;
otherwise the CLI lists the matches — pass the full id.

### Per-learner weekly quiz (only what the learner has been introduced to)

    node cli/school.mjs word-ladder quiz --learner <id> --package korean-vocab [--week 2026-W39] [--rows 20] [--seed N] [--force]
    node cli/school.mjs docs publish language/korean/korean-vocab-quiz-<id>-2026-w39.yml

Writes `<deckDir>/<pkg>-quiz-<learnerId>-<isoWeek>.yml` (`quizId.mjs`
`learnerQuizDocumentId`; `deckDir` is every deck sharing the package's
lexicon, taken from the first deck's id). `isoWeek` is always lowercased in
the id (`documentValidation.mjs`'s `ID_PATTERN` is lowercase-only) even
though `isoWeekOf` and `--week` itself accept the display-cased `YYYY-Www`.
Without `--week` the current day's ISO week is used.

Row selection (`buildLearnerQuizSource`), up to `--rows` (default 20), in
this order, until the cap is hit:

1. every word `introducedDay` falls in this ISO week (deck order);
2. every other unsettled word (`isUnsettled` — not `new`, not `mastered`);
3. a seeded sample of `mastered` words filling whatever rows remain.

If nothing qualifies (e.g. a fresh week with no introductions yet), the
builder throws `no introduced words to quiz` rather than writing an empty
sheet — this is correct behaviour, not a bug to route around.

### Publishing and the reprint rule

Both forms write through the same `writeQuizSource` in
`cli/school/wordLadder.mjs`: an identical file (byte-for-byte) is left alone
(`unchanged: <file>`); a **different** file — the ordinary case for a
reprint after new introductions or a scan-side re-grade — is refused unless
`--force`. **A changed source must be republished as a new revision and a
fresh card minted, never pinned to the old one**: after `--force` overwrites
the source, run `school docs publish` to bump the revision, then
`POST /api/v1/school/print/render` to mint a fresh card — the old printed
sheet keeps its own revision and stays gradable, but the next print run must
carry the new one.

### The fold

A scan appends one paper attempt per graded row; a miss demotes per the
transitions table above (a paper row miss only ever demotes to `familiar`,
and only from `familiar`/`claimed`/`mastered` — never a promotion). The fold
(`foldPaperAttempts.mjs`) reads a scanned row's `bankId` as `<docId>@<rev>`
and accepts `docId` two ways:

- **Legacy per-deck ids still fold, forever.** Any `docId` that exactly
  matches `quizDocumentIdFor(deckId)` for a deck sharing the learner's
  lexicon package is accepted — the whole-deck quiz keeps working
  unconditionally, no learner scoping.
- **A per-learner document folds only into the learner named in its id.**
  `parseLearnerQuizId(docId, { deckDir, pkg })` parses the id from the
  **end** — it anchors on the trailing `YYYY-wWW` week token, not the first
  hyphen after the prefix — so a learner id containing hyphens is safe, and
  sibling learner ids that are prefixes of each other (`a` vs. `a-b`) are
  never confused (a raw `startsWith` prefix check would wrongly accept or
  refuse the wrong one). A **sibling's sheet** — a `docId` that parses as a
  per-learner id for this package but names a *different* `learnerId` — is
  refused, not silently dropped: it is logged
  `school.word-ladder.fold-refused` with the attempt id and bankId, and
  recorded in `status.paperAttemptsFolded` so it is **never re-evaluated**
  on a later fold.
- **Paper never promotes.** Whichever id shape matched, only a demotion or a
  logged-only pass/miss follows — folding a row can never raise a word's
  state.

    curl -s -X POST {app}/api/v1/school/word-ladder/fold \
      -H 'Content-Type: application/json' -d '{"learnerId":"{learnerId}","actorId":"{teacherId}"}'

## Rollover and media

A new week is a new deck file (its new words get a new lexicon `group`); a
grown-up changes the enrollment `deckId` — status carries over, keyed by word
within the package. Placeholders (0-byte media files) are allowed: the player
renders around them and `school certify` warns (`--strict-media` fails).

## Migration from v2

The v1 `status.word-ladder-status/v1` (or unversioned) shape is migrated on
read (`migrateStatusV2` in `2_domains/school/wordLadder/statusV3.mjs`) and
written as v3 on the next transaction: NEW → `new`, LEARNING → `familiar`,
CLAIMED → `claimed`, KNOWN step n → `mastered` stage n+1 with `dueDay` = the v2
next-check day verbatim. v2 day plans, the review run, the recording gate and
the review quiz are **gone** — the v2 review run (flip-only replay of a
finished day) has no v3 equivalent; a finished day's next sitting opens
straight to the summary instead.
