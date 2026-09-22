# Korean vocab word ladder — design

> **Superseded by the language-neutral refactor (2026-09-22).** The word ladder no longer names Korean anywhere in code: lexicon `school.word-lexicon/v2` (`term`/`gloss`, per-entry `group`, `package`/`language`/`gloss`/`program` headers), directions `picture_to_term`/`audio_to_term`/`term_to_gloss`, media `words/<group>/<id>/{image.jpg,term.mp3,gloss.mp3}`, status/recordings keyed by package, CLI `school word-ladder`, seed script `scripts/school/seed-word-package.sh`. Current reference: `docs/reference/school/word-ladder.md`. This document is kept as written.

Date: 2026-09-22 (rev 2, after adversarial review)
Status: design validated, not yet implemented
Learner: one enrolled child (new enrollment, separate from their Sentence Ladder `glossika-korean` work)

## Problem

The learner needs a Korean vocabulary program built from short weekly word lists
(first list: 6 classroom phrases + 13 classroom words). Each week has a fixed
set they work through every day for credit. Cards show picture, Korean, and
native audio, and ask them to say the word. The "know / still learning" status
of each word persists across days and weeks; a word they claim to know must
prove it on a later check and is demoted on a miss. A printed, OMR-graded quiz
closes the week and feeds its results back into the same status.

Images and TTS audio are generated separately by the household. This work
defines where they live and seeds empty placeholders.

Note: no flashcard deck, flashcard enrollment, or flashcard progress exists in
the household data today. Every "reuse" below is reuse of code that has not yet
run against real data, so each reused seam gets its own test.

## Decisions

| Topic | Decision |
|---|---|
| Scheduling | Weekly set, daily practice. Not FSRS: a readable per-word ladder instead. |
| Media location | `media/school/language/korean-vocab/`, one folder per word |
| Card format | Same every day: front = picture + Korean + `ko.mp3`; back = English (+ pronunciation for phrases) |
| Speaking | Record, then hear own take followed by native audio. Not auto-scored. Takes saved for review. |
| Status | NEW → LEARNING → CLAIMED → KNOWN, persisted per word |
| Claim check | Next study day, never the same study day |
| Known re-checks | Widening gaps 3 / 7 / 14 / 30 days; a miss resets to LEARNING |
| Nothing due | Mandatory review quiz over the current deck — never a free day |
| Mic unavailable | Recording step is dropped; nothing else is excused |
| Phrases | Same deck, `kind: phrase`; phrase decoys only from phrases |
| Quiz decoys | Authored per word in the lexicon |
| Printed quiz | Full OMR loop: scanned misses demote words |
| Rollover | Manual: grown-up bumps the enrollment `deckId` |
| Day boundary | The School study day (`studyDay.mjs`: 4am→4am, household timezone) |

## Data model

### Media tree

```
media/school/language/korean-vocab/
  lexicon.yml
  words/<id>/
    image.jpg
    ko.mp3
    en.mp3
```

`<id>` is a Revised-Romanization slug and is permanent once studied (status is
keyed by it). Media is found by convention, not listed in the lexicon.

This package deliberately contains placeholders, which `media/school/README.md`
currently forbids outside `_inbox`. The README gains an explicit exception for
generated-media word packages: placeholders are allowed, certify reports them
as missing, and the player renders around them. No `poster.jpg` requirement
applies (it is not a course).

Seeded ids for week 1:

| id | korean | kind |
|---|---|---|
| annyeong | 안녕 | phrase |
| annyeong-haseyo | 안녕하세요 | phrase |
| annyeonghi-gyeseyo | 안녕히계세요 | phrase |
| seonsaengnim | 선생님 | phrase |
| chingu-deul | 친구들 | phrase |
| ireumi-mwoyeyo | 이름이 뭐예요? | phrase |
| ireum | 이름 | word |
| gawi | 가위 | word |
| pul | 풀 | word |
| chaek | 책 | word |
| jiugae | 지우개 | word |
| baindeo | 바인더 | word |
| jongi | 종이 | word |
| saek-jongi | 색종이 | word |
| yeonpil | 연필 | word |
| saek-yeonpil | 색연필 | word |
| gansik | 간식 | word |
| hanguk | 한국 | word |
| hakgyo | 학교 | word |

(`kind` follows the source list: the six items given with pronunciations are
phrases.)

### Lexicon entry

```yaml
- id: gawi
  kind: word            # word | phrase
  korean: 가위
  english: Scissors
  pronunciation: null   # required for phrases
  decoys:
    korean: [가지, 바위, 가방]
    english: [Knife, Tape, Ruler]
```

Decoys are deliberately confusable: look-alike or sound-alike Hangul
(연필 / 색연필 / 연기, 종이 / 색종이 / 종), same-category English meanings.
A decoy may be another in-set word when telling them apart is the point
(안녕하세요 vs 안녕히계세요). Each list needs at least 3 entries, and no decoy
may equal the entry's own answer.

### Weekly deck

`data/content/school/learning-catalog/flashcard-decks/language/korean/week-01-classroom.yml`
(the `learning-catalog/flashcard-decks` directory does not exist yet; seeding
creates it):

```yaml
schema: school.flashcard-deck/v1
id: language/korean/week-01-classroom
title: Korean — Classroom
revision: 1
lexicon: media:language/korean-vocab/lexicon.yml
words: [annyeong, annyeong-haseyo, …, hakgyo]
```

`validateFlashcardDeck` preserves extra keys but rejects a deck with no
`cards`. So expansion happens **before** validation, at the content-repository
seam: `LexiconDeckLoader` wraps both `getFlashcardDeck` and
`listFlashcardDecks` in `YamlLearningContentRepository`, turning `words` into
ordinary cards:

- front: `image` (alt = English), `text` Korean, `audio` `ko.mp3` (transcript = Korean)
- back: `text` English, plus `text` pronunciation for phrases
- asset ids use the `media:` prefix, e.g. `media:language/korean-vocab/words/gawi/image.jpg`

The lexicon root is `ConfigService.getMediaDir()`, injected into the loader.

`cli/school/certify.mjs` reads deck YAML directly (L349-354) and checks
assets against a single `<content-root>/assets` walk (L232-255). It is changed
to (a) run the same lexicon expansion before `validateFlashcardDeck`, (b)
resolve `media:` asset ids against the media root, and (c) treat a 0-byte file
as missing. Until (a) and (b) land, seeding the deck would fail certify for the
whole corpus — so the certify change ships before or with the seed.

The deck carries no `assessment.bankId`: the printed quiz is a print document,
not a question bank (see below).

A weekly deck never changes its `words` after it is in use; a new week is a new
deck file. `revision` stays 1 unless a card's text is corrected.

### Word status store

`users/{id}/apps/school/korean-vocab/status.yml`:

```yaml
words:
  gawi:
    state: known          # new | learning | claimed | known
    step: 1               # index into [3, 7, 14, 30]
    claimedDay: null      # study day of the last claim; set while state = claimed
    nextCheckDay: 2026-09-30
    history:              # append-only, ISO instants with offset
      - { at: 2026-09-22T16:05:12-07:00, day: 2026-09-22, event: claim }
      - { at: 2026-09-23T15:48:40-07:00, day: 2026-09-23, event: check-pass, direction: picture_to_korean }
paperAttemptsFolded: [att_…]   # attempt ids already applied from scanned quizzes
```

- `day` is always `studyDayForInstant(at, {timezone})` from
  `2_domains/school/studyDay.mjs`, never a bare calendar date.
- History events: `study`, `claim`, `still-learning`, `check-pass`,
  `check-pass-early`, `check-miss`, `quiz-pass`, `quiz-miss`. Study events carry
  `recording: taken | unavailable` (with reason when unavailable).
- Keyed by word, so status carries across weekly decks.

### Enrollment

Added to the learner's `programs:` in `household/school/plans/learners/{learnerId}.yml`:

```yaml
- programId: flashcards
  deckId: language/korean/week-01-classroom
  policy:
    mode: word-ladder
  schedule: { daysOfWeek: [1, 2, 3, 4, 5] }
```

`validateFlashcardEnrollment` returns only `{programId, corpusId, deckId,
policy}`, and `SetAssignments` persists that result, so a top-level `mode`
would be deleted the first time a grown-up saves assignments. `mode` therefore
lives **inside `policy`**, which survives the round trip and already travels on
the launch target (`FlashcardProgramLauncher.issueLaunchTarget` → `policy`) to
`SchoolApp.jsx`. The validator is extended to accept `policy.mode ∈ {fsrs,
word-ladder}` (default `fsrs`) and to reject the FSRS-only keys
(`newCardLimit`, `masteryPercent`, `minimumReviews`) when the mode is
`word-ladder`. `SchoolApp.jsx` mounts `WordLadderProgram` when
`target.policy.mode === 'word-ladder'`.

Rollover = the grown-up changes `deckId`.

## State machine

```
 NEW ──seen──► LEARNING ──"I know it"──► CLAIMED ──check on a LATER study day──┐
                  ▲                                                            │
                  │◄─────────────────── miss ──────────────────────────────────┤ pass
                  │                                                            ▼
                  └──────────── miss / quiz-miss ◄──────────────────── KNOWN (step 0..3)
```

- CLAIMED is checkable only when `claimedDay < today`. A reload the same day
  rebuilds the same plan and does not include it.
- CLAIMED → KNOWN at step 0 on a pass; `nextCheckDay = today + 3`.
- A **scheduled** check is a check on a KNOWN word with `nextCheckDay ≤ today`,
  or on a CLAIMED word from an earlier day. A scheduled pass advances
  `step` (capped at 3) and sets `nextCheckDay = today + gap[step]`.
- Every **other** pass — review-quiz checks and all printed-quiz answers —
  is logged (`check-pass-early` / `quiz-pass`) and never changes state or step.
  Paper never promotes; it can only demote. This resolves the rev-1 conflict
  between the step rule and the quiz rule.
- Any miss, from any source: → LEARNING, `step` reset to 0, `nextCheckDay`
  cleared.

## Daily session

The backend builds the plan from the status store for today's study day.

1. **Checks** — every CLAIMED word with `claimedDay < today`, plus every KNOWN
   word with `nextCheckDay ≤ today`. Four choices (answer + 3 lexicon decoys
   of the same `kind`). Direction rotates through picture→Korean,
   audio→Korean, Korean→English, chosen deterministically from word + study
   day so a reload shows the same check. Graded server-side. Immediate
   feedback: a tick, or the right card with its audio. A miss adds the word to
   today's study pass.
2. **Study pass** — every NEW/LEARNING word in the current deck, plus
   LEARNING words carried from older decks, shuffled. Front plays `ko.mp3`.
   The learner records; the take must clear the speech floor (the same
   `heard` / 1200 ms rule `RecordingRung.jsx` applies, extracted into a shared
   helper); the card plays the take then the native audio. They flip to English
   and mark **I know it** (→ CLAIMED, `claimedDay = today`) or
   **Still learning**.
3. **Review quiz** — fires when the **current deck** has no word in steps 1–2
   (every current-deck word is CLAIMED-today or KNOWN-not-due). It is a
   required check of every current-deck word, run after any carried-over study
   cards, so one stuck word from an older deck cannot suppress it. Misses
   demote and are studied in the same session; passes are early (no step
   change).

Consequence: claiming the whole set on Monday does not produce a free week.
Monday: all claimed. Tuesday: all checked; passes become KNOWN (next check
Friday). Wednesday and Thursday: review quiz over the full set. Friday:
scheduled checks of the full set.

**Credit:** every check answered and every study card marked, each with a
recorded take when the mic is available. `FlashcardProgramLauncher.status()`
branches on `policy.mode` and returns `doneToday` and `servedWork:
flashcards:<deckId>`. Progress label e.g. "3 checks · 12 to study".

**Past days on the term grid:** the grid asks a launcher about a past day only
when it declares `replayable === true` (`programStatusCollection.mjs`). The
word-ladder branch of `status()` accepts `day` and answers from `history`
(credit = the day's events satisfy the same rule), and the launcher sets
`replayable` true for word-ladder enrollments. FSRS decks keep today's
`no_history` behaviour.

**Mic unavailable** (permission denied, no device, capture failed): the record
step is removed from study cards. Audio, flip, and marking remain; checks and
the review quiz are unaffected. Each affected card logs
`recording: unavailable` with the reason. The day's credit is the same list
minus the recordings.

**Missing media:** an empty (0-byte) or missing image or audio renders the card
without it (no broken image, no play button), so study can start before media
is generated. Checks whose direction needs missing media (picture→Korean with
no image, audio→Korean with no audio) fall back to Korean→English.

## Recording

The Sentence Ladder recording route cannot be reused: its study grant is
refused unless `programId === 'sentence-ladder'` and the corpus matches
(`HmacSchoolStudyGrantIssuer.mjs:62-64`), and `LanguageStudyService.saveRecording`
requires a corpus sentence and writes a sentence-ladder attempt. Word ladder
gets its own:

- `POST /api/v1/school/word-ladder/:sessionId/cards/:wordId/recording` — raw
  audio body, authorized by the open word-ladder session (session belongs to
  the learner and the word is in today's study plan).
- Stored under `media/school/recordings/korean-vocab/{learnerId}/{studyDay}/{wordId}-{n}.webm`
  via the existing FileIO seam.
- `GET …/cards/:wordId/recording/latest` plays the take back.

Reused unchanged from Sentence Ladder: `useVoiceCapture`, `VoiceBand` (level
display only), `useCapabilities`. Extracted to a shared module:
the speech-floor check from `RecordingRung.jsx:40-70`.

## Printed Friday quiz (OMR loop)

The worksheet question-bank path does not fit (its profiles are fixed at
3/5/6/10 items, `upper` demands multi-select items, and issuing drops item
metadata). The print-document path does: a `school.document-source/v1` quiz
rendered per learner with an allocated OMR card, no session required, and a
scanned row's `itemId` is the question block's own `itemId`
(`documents/allocation.mjs:203`).

**Generate.** `node cli/school.mjs korean-vocab quiz --deck week-01-classroom`
writes a document source,
`catalog/documents/language/korean/week-01-classroom-quiz.yml`:

- `archetype: quiz`, `variety` omr, `fit.typeScale: young`.
- One `question` block per word with **`itemId: <wordId>`**, inline choices
  (answer + 3 authored decoys → 4 of the card's 5 columns), alternating
  Korean→English / English→Korean by word index. Text only.
- 19 rows fits one 50-row card with room to share.

It is then published and rendered through the existing flow
(`learnerId=` required for quiz renders; per-learner variant shuffle).

**Hangul font.** `backend/assets/fonts/` has no CJK font, and the document
renderer uses Atkinson / Helvetica. Add Noto Sans KR (OFL) and register it as
a per-run fallback in the print renderer: any text run containing Hangul
(U+1100–11FF, U+3130–318F, U+AC00–D7AF) is set in Noto Sans KR; Latin text
keeps the house font. A render gate test asserts a Hangul glyph is embedded,
not replaced by `.notdef`.

**Feedback into word status (pull, not event).** A scan appends one attempt
per graded row: `{bankId: '<documentId>@<rev>', itemId, correct, transport:
'paper', attributedTo: learnerId}` (`RecordCardScanOutcome.mjs:401-438`). No
event fires for a session-less sheet, and `3_applications` may not subscribe to
a generic event bus. So `WordLadderStudyService.fold()` runs at the start of
every plan build (and on the teacher's "apply scanned quiz" action):

- read the learner's attempts with the school datastore's existing
  `readAttemptsInRange(learnerId, fromDay, throughDay)` (as
  `RegradeBankAttempts` does), from the last folded day through today, filtered
  to `transport: 'paper'` and `bankId` starting with a known quiz document id
  (the deck → quiz document id is derived by convention: `<deckId>-quiz`);
- skip ids in `paperAttemptsFolded`;
- `correct: false` → `quiz-miss`, demote to LEARNING; `correct: true` →
  `quiz-pass`, no state change;
- record the attempt id in `paperAttemptsFolded`.

Rows the scan could not grade honestly (double marks → review queue; any blank
row makes the card a `partial-scan`) produce no attempt, so they fold nothing
until a grown-up resolves the card — which then appends the attempts and the
next fold applies them.

The printed quiz is not required for Friday's daily credit.

### Stuck on the paper quiz → back to the cards (rev 3)

A child sitting with the printed sheet who does not know a word must be able
to go back to the flashcards, at any time, without a grown-up. No code is
needed: the learner already opens his own agenda at the Portal, and the word
ladder is on it every scheduled day.

- **The agenda tile never closes.** After today's plan is complete
  (`doneToday: true`), the word-ladder tile stays openable and lands on a
  **review run**: every current-deck word as a study card (picture, Korean,
  `ko.mp3`, flip to English), in deck order, no checks, no "I know it / Still
  learning" marks, no recording required, no state or step change. Each card
  viewed logs a `review` history event (`{ event: review, at, day }`). The day's
  credit is unaffected either way — a review run can neither earn nor lose it.
  A child can run it as many times as he wants.
- **The sheet says so.** The quiz document's instruction line (rendered under
  the title, above the first block) reads:
  `Not sure of a word? Open Korean words on the Portal and review the cards, then come back.`
  Nothing on the sheet is a code or a gate; the line only tells him where to go.
- Reaching the review run is one tap from the agenda tile. If the tile is
  already open on a finished day, the "Done" screen offers **Review the cards**
  which starts the same run.

## Components

**Backend**

- `2_domains/school/wordLadder/` — pure, study-day-injected:
  `wordLadder.mjs` (transitions, gaps, scheduled vs early), `planDay.mjs`
  (checks → study → review quiz, current-deck scoped), `checkItem.mjs`
  (direction + choices + media fallback), `foldPaperAttempts.mjs`.
- `2_domains/school/flashcards/flashcardEnrollment.mjs` — accept
  `policy.mode`.
- `1_adapters/school/` — `YamlWordLadderStore`, `LexiconDeckLoader` (wrapping
  the content repository's get/list); `SchoolFlashcardAssetRepository` gains
  a named `media:` root → media dir.
- `3_applications/school/` — `WordLadderStudyService` (open, plan, fold,
  answer-check, mark-card, save-recording, replay-day), word-ladder branch and
  `replayable` in `FlashcardProgramLauncher`.
- `4_api` — `/school/word-ladder/:sessionId/…` (plan, check, mark, recording),
  verifying the learner's actual assignment server-side.
- `cli/school/certify.mjs` — lexicon expansion, `media:` root, 0-byte = missing.
- `cli/school.mjs korean-vocab quiz` — document-source generator.
- Print renderer — Noto Sans KR Hangul fallback.

**Frontend**

- `Programs/Flashcards/WordLadder/` — `WordLadderProgram.jsx`,
  `CheckCard.jsx`, `StudyCard.jsx`, `wordLadderApi.js`.
- `SchoolApp.jsx` — route `policy.mode === 'word-ladder'` to
  `WordLadderProgram`.
- Shared speech-floor helper extracted from `RecordingRung.jsx`.
- `wordLadderLog.js` facade: plan counts, fold results, each check result, each
  mark, recording upload ok/fail, mic-unavailable reason, session start/end.

## Seeding (part of this work, after the certify change)

- `lexicon.yml` with the 19 entries and authored decoys.
- `week-01-classroom` deck (creates `learning-catalog/flashcard-decks/`).
- 57 zero-byte placeholders (`image.jpg`, `ko.mp3`, `en.mp3` per word).
- The learner's enrollment entry.
- The week-01 quiz document source (generated, published).

## Testing

- Domain: transition table; scheduled vs early passes; `claimedDay < today`
  gate (claim then rebuild same day → not checked); gap arithmetic across
  study days; review-quiz trigger with a stuck carried-over word; choice
  construction (answer present, no duplicates, same-`kind` decoys only);
  deterministic direction; media fallback; fold idempotence (same attempt
  folded twice → one event).
- Adapter: status store round-trip; lexicon expansion through both get and
  list; two-root asset lookup and traversal refusal on `media:`.
- Enrollment: `policy.mode` survives validate → `SetAssignments` → reload.
- Certify: lexicon deck passes with real files, fails on 0-byte placeholders.
- Launcher: credit rule, mic-unavailable, replay of a past day.
- Print: Hangul glyph embedded; a generated quiz scanned in a fixture appends
  attempts whose `itemId` is the word id.
- Component: `WordLadderProgram` check → study → done; mic-denied run;
  empty-media rendering.
- Live: Playwright run of a full day against the single dev server.

## Docs

- New `docs/reference/school/word-ladder.md`.
- Update `docs/reference/school/flashcards.md` (`policy.mode`, lexicon decks,
  the `media:` asset root, certify behaviour).
- Update `docs/reference/school/print-documents.md` (Hangul font fallback).
- Update `media/school/README.md` (word-package placeholder exception).
- Add a row to the CLAUDE.md navigation table.

## Out of scope

- Image generation and TTS rendering (filled externally into the placeholders).
- Speech scoring.
- Automatic weekly rollover.
