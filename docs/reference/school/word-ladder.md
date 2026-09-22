# Word ladder (vocabulary word packages)

A flashcard enrollment in `policy.mode: word-ladder`: weekly word lists, a
readable per-word ladder instead of FSRS, recorded speaking, a review run
after the day is done, and a printed OMR quiz that can only demote.

The word ladder is **language-neutral**. Everything that names a language —
which one is being learned, which one the meanings are written in, the tile
title, the printed quiz's instructions and topics — lives in a **word
package**'s lexicon YAML. Adding a language is new YAML + media, never a code
change. Korean (`korean-vocab`) is the worked example throughout.

Design (Korean-era, superseded in its language-specific parts):
`docs/_wip/plans/2026-09-22-korean-vocab-word-ladder-design.md`.

## Where things live

| What | Where |
|---|---|
| Lexicon | `media/school/language/<package>/lexicon.yml` (e.g. `language/korean-vocab/lexicon.yml`) |
| Word media | `media/school/language/<package>/words/<group>/<id>/{image.jpg,term.mp3,gloss.mp3}` |
| Weekly deck | `data/content/school/learning-catalog/flashcard-decks/<deck id>.yml` (`lexicon:` + `words:`), e.g. `language/korean/week-01-classroom` |
| Enrollment | learner plan `programs:` → `{programId: flashcards, deckId, title, policy: {mode: word-ladder}, schedule}` |
| Status | `data/users/{learnerId}/apps/school/word-ladder/<package>/status.yml` |
| Takes | `media/school/recordings/word-ladder/<package>/{learnerId}/{studyDay}/{wordId}-{n}.webm` |
| Quiz source | `data/content/school/learning-catalog/documents/<deckId>-quiz.yml` |
| Seed | `content/seeds/school/<package>/` installed by `scripts/school/seed-word-package.sh <seed-dir>` |
| Code | `backend/src/2_domains/school/wordLadder/`, `3_applications/school/WordLadderStudyService.mjs`, `4_api/v1/routers/school.wordLadder.mjs`, `cli/school/wordLadder.mjs`, `frontend/src/modules/School/Programs/Flashcards/WordLadder/` |

Everything per learner is keyed by the lexicon's `package`: status, sessions,
frozen day plans, the paper-fold bookkeeping and the recordings. Word ids need
only be unique **within** a package.

## The lexicon (`school.word-lexicon/v2`)

```yaml
schema: school.word-lexicon/v2
package: korean-vocab            # stable id — status, recordings and the capability key use it
language: { code: ko, name: Korean }    # the language being learned (BCP-47 code → lang= attributes)
gloss:    { code: en, name: English }   # the learner's language the meanings are in
program:
  title: Korean words            # default tile title for an enrollment of a deck using this lexicon
quiz:                            # optional
  topics: [korean, vocabulary]   # default: [<language.name lowercased>, vocabulary]
  instructions: Not sure of a word? Open Korean words on the Portal and review the cards, then come back.
                                 # default: "Not sure of a word? Open <program.title> on the Portal and review the cards, then come back."
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
An in-set decoy must be the same kind (phrase decoys only from phrases). A v1
lexicon (`korean:`/`english:` fields) is refused with a migration error.

**Groups.** A package's word folders are grouped by course unit so the media
tree stays browsable: a new week is a new `group` folder. `group` records where
a word was **first** introduced — a later deck may reuse words from any group.
Status is keyed by word id alone, so moving a word to another group (move its
folder AND change its `group`) loses no progress.

## Adding a language

1. Write `content/seeds/school/<package>/lexicon.yml` (above) and one deck per
   unit (`id: language/<lang>/<unit>`, `lexicon: media:language/<package>/lexicon.yml`,
   `words:`). Optionally a `media-readme-section.md`.
2. `DRY_RUN=1 scripts/school/seed-word-package.sh content/seeds/school/<package>`
   prints the resolved package, deck paths and placeholders; without
   `DRY_RUN` it installs (controller-only, idempotent, never overwrites).
3. Generate the media into the placeholders (`image.jpg`, `term.mp3`,
   `gloss.mp3`).
4. `node cli/school.mjs word-ladder enroll-plan --learner <id> --deck <slug> --out plan.yml`
   (title defaults to the lexicon's `program.title`), then `school ops assign`.
5. If the language uses a script the print fonts lack, add a row to
   `SCRIPT_FALLBACKS` (`backend/src/1_rendering/school/documents/measure.mjs`)
   and a font under the same key in both document themes — see
   `print-documents.md`. Latin-script languages need nothing.

## The ladder

NEW → (studied) LEARNING → ("I know it") CLAIMED → (scheduled check passed on
a later study day) KNOWN at step 0 → re-checks after 3 / 7 / 14 / 30 study
days. Only a scheduled check promotes. Review-quiz passes (`check-pass-early`)
and paper passes (`quiz-pass`) are logged only. Any miss, from any source,
drops the word to LEARNING, step 0. Days are School study days (4am→4am,
household timezone).

## A study day

The first open of a study day **freezes** the plan in the package's
`status.days[day][deckId]`:

1. **Checks** — CLAIMED words from an earlier day and KNOWN words due today.
   Four choices (answer + 3 authored decoys). Direction (`picture_to_term`,
   `audio_to_term`, `term_to_gloss`) is deterministic from word + day and falls
   back to `term_to_gloss` when the needed media is missing. Graded
   server-side; a miss adds the word to today's study pass.
2. **Study** — NEW/LEARNING words of the current deck plus LEARNING words
   carried from older decks of the same package. Record (when a mic is
   available; the Sentence Ladder speech floor applies), hear the take then the
   native `term.mp3`, flip to the gloss, mark **I know it** or **Still learning**.
3. **Review quiz** — when the current deck had nothing to check or study at
   freeze time, a required quiz over every current-deck word.

The plan the API returns carries `package`, `title`, `language: {code, name}`
and `gloss: {code, name}`; cards carry `term`/`gloss`. The Portal sets `lang=`
from those codes and keys its device capabilities `word-ladder:<package>`.
Session ids carry their package (`<package>.<id>`).

Credit (`doneToday`) = every planned check answered and every study card
studied and marked (after its latest miss). With no mic the card logs
`recording: unavailable` with the reason; nothing else is excused. The
launcher is `replayable`: a past day is judged from its frozen plan.

## After the day is done (review run)

The launcher reports `reopenable: true`, so the tile keeps its button after
`doneToday`. Opening a finished day lands on the **review run**: every
current-deck card in deck order, flip only, no marks, no recording, no state
change. Each card viewed logs `{event: review}`; credit is unaffected. The
Done screen offers **Review the cards** for the same run.

## Printed quiz and the fold

    node cli/school.mjs word-ladder quiz --deck week-01-classroom
    node cli/school.mjs docs publish language/korean/week-01-classroom-quiz.yml

A bare `--deck` slug resolves only when exactly one deck id ends with
`/<slug>`; otherwise the CLI lists the matches — pass the full id. Questions
alternate `What does **<term>** mean?` / `Which is **<gloss>** in <language.name>?`;
topics and the instruction line come from the lexicon. Render per learner with
`variety=omr`. A scan appends one paper attempt per graded row
(`bankId: <deckId>-quiz@<rev>`, `itemId: <wordId>`); every plan build folds new
ones (idempotent by attempt id): a miss demotes, a pass is logged. Only quizzes
printed from decks of the **same lexicon** fold into a package. Blank or
double-marked rows fold nothing until a grown-up resolves the card. To fold
without waiting for the child (every word-ladder package the learner is
enrolled in):

    curl -s -X POST {app}/api/v1/school/word-ladder/fold \
      -H 'Content-Type: application/json' -d '{"learnerId":"{learnerId}","actorId":"{teacherId}"}'

## Rollover and media

A new week is a new deck file (its new words get a new lexicon `group`); a
grown-up changes the enrollment `deckId` (status carries over — it is keyed by
word within the package). Placeholders (0-byte files) are allowed: the player
renders around them and `school certify` warns (`--strict-media` fails).
Replace a placeholder by overwriting it in place.

## Logs

Backend: `school.word-ladder.{opened,folded,check,mark,recording-saved,review-viewed,status-corrupt}`
(`opened`, `folded` and `status-corrupt` carry `package`).
Frontend (`context.component: school-word-ladder`): `plan.loaded` (with
`package`, `language`), `check.answered`, `card.marked`,
`recording.{uploaded,failed,refused}`, `mic.unavailable`,
`review.{started,viewed}`, `day.done`, `api.{rejected,failed}`.
