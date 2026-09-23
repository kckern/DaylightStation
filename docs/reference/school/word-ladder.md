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
This page describes what **Plan 1 (core loop)** actually ships; see
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
| Code (domain) | `backend/src/2_domains/school/wordLadder/` — pure engine, states, choices, rounds, jamo scoring, settings, scenarios |
| Code (application) | `backend/src/3_applications/school/{WordLadderSittingService,WordLadderTypedJudge,WordLadderDoorLauncher}.mjs` |
| Code (adapters) | `backend/src/1_adapters/school/wordLadder/{YamlWordLadderStore,ShadowWordLadderStores,YamlJudgementCache}.mjs` |
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

`missStreak ≥ drill.afterMisses` sets `tricky` (flags the word — Plan 1 does
not yet drill it; see below). Code: `backend/src/2_domains/school/wordLadder/mastery.mjs`.

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
`word_ladder.judge.model` is `null`, so the model step never runs** — every
verdict today is `exact`, `no-hangul`, `guard`, `distance` or `cache`.

Pass = score ≥ `typing.passScore` (default 6). Verdicts are cached by
(package, word id, normalised answer) in
`data/household/school/runtime/word-ladder/<package>/judgements.yml`
(`YamlJudgementCache`) — a reload or repeated typo gets the same verdict with
no second call.

## Goal, cap, and a study day

Goal and cap are **per study day, across all of that day's sittings** — idle
close makes several sittings a day routine.

- **Goal (Plan 1)** = every recheck in the day's first sitting's at-open
  snapshot answered, and every round started today finished (stream + quiz).
  The spec's full goal also includes the day's drill run; Plan 1 has no drill,
  so the engine's done-rule omits that clause until Plan 2 lands.
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
| `drill.perSitting` | tricky words drilled per sitting | 1 (not yet acted on — Plan 2) |
| `session.capMinutes` | day cap | 15 |
| `typing.passScore` | judge pass threshold | 6 |

## API

Mounted by `mountWordLadderRoutes` (`backend/src/4_api/v1/routers/school.wordLadder.mjs`)
at `/api/v1/school/word-ladder` (live) and `/api/v1/school/word-ladder/test`
(test mode, same shape). Every response is `Cache-Control: private, no-store`.

- `POST /word-ladder/open {userId, deckId}` → `{sittingId, day, package, title, language, gloss, item, progress}`
- `POST /word-ladder/sittings/:sittingId/items/:itemId {userId, response}` → `{result, item, progress}`;
  `response` shape depends on the current item: `{seen:true}` (flashcard intro),
  `{sort}` (flashcard stream), `{typed}` (copy / typed), `{choice}` / `{dontKnow:true}` (choice)
- `GET /word-ladder/sittings/:sittingId?userId=` → current item + progress (reload)
- `POST /word-ladder/sittings/:sittingId/close {userId, reason}` — `reason` ∈ `goal|cap|leave|idle|unmount`
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

Items live today: flashcard front/back (`items/FlashcardItem.jsx`), choice
(`items/ChoiceItem.jsx`), typed/copy (`items/TypedItem.jsx`), summary
(`items/SummaryItem.jsx`). Keys: `useWordLadderKeys.js` (1/2/3 sort, Space/Enter
continue, 1–4/0 choices, U undo, Q quiz me, H hear). Keys match the
**physical** key (`event.code` — `KeyH`, `Digit1`, `Space`, `NumpadEnter`…)
first and `event.key` second, because on a Korean keyboard layout `key` for H
is `ㅗ`. Keys typed into an input are never taken as commands.

The typed field declares the lexicon's BCP-47 code (`lang` / `data-ime-lang`,
e.g. `ko`); `ime/languages.js` normalises it (`ko`, `ko-KR` → `KR`) so the
in-page Hangul IME switches to Korean on focus. A copy mismatch clears the
field for the retry.

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

This page describes **Plan 1 (core loop)** only:
`docs/_wip/plans/2026-09-22-word-ladder-plan-1-core-loop.md`. The rest of the
spec is written but not implemented:

- **Drill, practice menu, keypad, say-tasks** — `docs/_wip/plans/2026-09-22-word-ladder-plan-2-drill-practice.md`.
  `tricky` is flagged (§ States above) but never drilled yet; there is no
  practice menu, no on-screen jamo keypad, and no recorded speaking task.
- **Per-learner printed quiz** — `docs/_wip/plans/2026-09-22-word-ladder-plan-3-printed-quiz.md`.
  Only the whole-deck `school word-ladder quiz` CLI exists today (below); the
  spec's per-learner introduced-words-only quiz and its fold-by-document-prefix
  rule are not built.
- **Trace CLI and grown-up word controls** — `docs/_wip/plans/2026-09-22-word-ladder-plan-4-observability-controls.md`.
  `school word-ladder trace` and the teacher console's per-word reset/exclude/
  re-grade controls do not exist; a word's state is visible only in
  `status.yml` today.
- **Tuning agent** — `docs/_wip/plans/2026-09-22-word-ladder-plan-5-tuning-agent.md`.
  `word_ladder.settings` / `word_ladder.bounds` are static config; nothing
  adjusts them automatically yet.

## Printed quiz and the fold (whole-deck, pre-Plan-3)

    node cli/school.mjs word-ladder quiz --deck week-01-classroom
    node cli/school.mjs docs publish language/korean/week-01-classroom-quiz.yml

A bare `--deck` slug resolves only when exactly one deck id ends with
`/<slug>`; otherwise the CLI lists the matches — pass the full id. Render per
learner with `variety=omr`. A scan appends one paper attempt per graded row; a
miss demotes per the transitions table above (rule: a paper row miss only ever
demotes to `familiar`, and only from `familiar`/`claimed`/`mastered` — never a
promotion). Only quizzes printed from decks of the **same lexicon** fold into a
package.

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
