# Word ladder (Korean vocabulary)

A flashcard enrollment in `policy.mode: word-ladder`: weekly word lists, a
readable per-word ladder instead of FSRS, recorded speaking, a review run
after the day is done, and a printed OMR quiz that can only demote.
Design: `docs/_wip/plans/2026-09-22-korean-vocab-word-ladder-design.md`.

## Where things live

| What | Where |
|---|---|
| Lexicon + media | `media/school/language/korean-vocab/lexicon.yml`, `words/<id>/{image.jpg,ko.mp3,en.mp3}` |
| Weekly deck | `data/content/school/learning-catalog/flashcard-decks/language/korean/week-NN-*.yml` (`lexicon:` + `words:`) |
| Enrollment | learner plan `programs:` → `{programId: flashcards, deckId, title, policy: {mode: word-ladder}, schedule}` |
| Status | `data/users/{learnerId}/apps/school/korean-vocab/status.yml` |
| Takes | `media/school/recordings/korean-vocab/{learnerId}/{studyDay}/{wordId}-{n}.webm` |
| Quiz source | `data/content/school/learning-catalog/documents/<deckId>-quiz.yml` |
| Code | `backend/src/2_domains/school/wordLadder/`, `3_applications/school/WordLadderStudyService.mjs`, `4_api/v1/routers/school.wordLadder.mjs`, `frontend/src/modules/School/Programs/Flashcards/WordLadder/` |

## The ladder

NEW → (studied) LEARNING → ("I know it") CLAIMED → (scheduled check passed on
a later study day) KNOWN at step 0 → re-checks after 3 / 7 / 14 / 30 study
days. Only a scheduled check promotes. Review-quiz passes (`check-pass-early`)
and paper passes (`quiz-pass`) are logged only. Any miss, from any source,
drops the word to LEARNING, step 0. Days are School study days (4am→4am,
household timezone).

## A study day

The first open of a study day **freezes** the plan in `status.days[day]`:

1. **Checks** — CLAIMED words from an earlier day and KNOWN words due today.
   Four choices (answer + 3 authored decoys). Direction (picture→Korean,
   audio→Korean, Korean→English) is deterministic from word + day and falls
   back to Korean→English when the needed media is missing. Graded
   server-side; a miss adds the word to today's study pass.
2. **Study** — NEW/LEARNING words of the current deck plus LEARNING words
   carried from older decks. Record (when a mic is available; the Sentence
   Ladder speech floor applies), hear the take then the native audio, flip,
   mark **I know it** or **Still learning**.
3. **Review quiz** — when the current deck had nothing to check or study at
   freeze time, a required quiz over every current-deck word.

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

    node cli/school.mjs korean-vocab quiz --deck week-01-classroom
    node cli/school.mjs docs publish language/korean/week-01-classroom-quiz.yml

Render per learner with `variety=omr`. The sheet's instruction line sends a
stuck child back to the cards. A scan appends one paper attempt per graded
row (`bankId: <deckId>-quiz@<rev>`, `itemId: <wordId>`); every plan build
folds new ones (idempotent by attempt id): a miss demotes, a pass is logged.
Blank or double-marked rows fold nothing until a grown-up resolves the card.
To fold without waiting for the child:

    curl -s -X POST {app}/api/v1/school/word-ladder/fold \
      -H 'Content-Type: application/json' -d '{"learnerId":"{learnerId}","actorId":"{teacherId}"}'

## Rollover and media

A new week is a new deck file; a grown-up changes the enrollment `deckId`
(status carries over — it is keyed by word). Placeholders (0-byte files) are
allowed: the player renders around them and `school certify` warns
(`--strict-media` fails). Replace a placeholder by overwriting it in place.

## Logs

Backend: `school.word-ladder.{opened,folded,check,mark,recording-saved,review-viewed,status-corrupt}`.
Frontend (`context.component: school-word-ladder`): `plan.loaded`,
`check.answered`, `card.marked`, `recording.{uploaded,failed,refused}`,
`mic.unavailable`, `review.{started,viewed}`, `day.done`, `api.{rejected,failed}`.
