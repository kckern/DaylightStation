# Korean vocab word ladder — design

Date: 2026-09-22
Status: design validated, not yet implemented
Learner: one enrolled child (new enrollment, separate from their Sentence Ladder `glossika-korean` work)

## Problem

The learner needs a Korean vocabulary program built from short weekly word lists
(first list: 6 classroom phrases + 13 classroom words). Each week has a fixed
set they work through every day for credit. Cards show picture, Korean, and
native audio, and ask them to say the word. The "know / still learning" status
of each word persists across days and weeks; a word they claim to know must
prove it on a later check and is demoted on a miss. A printed quiz closes the
week and feeds its results back into the same status.

Images and TTS audio are generated separately by the household. This work
defines where they live and seeds empty placeholders.

## Decisions

| Topic | Decision |
|---|---|
| Scheduling | Weekly set, daily practice. Not FSRS: a readable per-word ladder instead. |
| Media location | `media/school/language/korean-vocab/`, one folder per word |
| Card format | Same every day: front = picture + Korean + `ko.mp3`; back = English (+ pronunciation for phrases) |
| Speaking | Record, then hear own take followed by native audio. Not auto-scored. Takes saved for review. |
| Status | NEW → LEARNING → CLAIMED → KNOWN, persisted per word |
| Claim check | Next day, not same session |
| Known re-checks | Widening gaps 3 / 7 / 14 / 30 days; a miss resets to LEARNING |
| Nothing due | Mandatory review quiz over the current deck — never a free day |
| Mic unavailable | Recording step is dropped; nothing else is excused |
| Phrases | Same deck, `kind: phrase`; phrase decoys only from phrases |
| Quiz decoys | Authored per word in the lexicon |
| Rollover | Manual: grown-up bumps the enrollment `deckId` |

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
(안녕하세요 vs 안녕히계세요). Each list needs at least 3 entries.

### Weekly deck

`data/content/school/learning-catalog/flashcard-decks/language/korean/week-01-classroom.yml`:

```yaml
schema: school.flashcard-deck/v1
id: language/korean/week-01-classroom
title: Korean — Classroom
revision: 1
lexicon: media:language/korean-vocab/lexicon.yml
words: [annyeong, annyeong-haseyo, …, hakgyo]
assessment:
  bankId: language/korean/week-01-classroom-quiz
```

`LexiconDeckLoader` expands `words` into ordinary card blocks, so the rest of
the flashcard stack (including `school:certify`) sees a normal deck:

- front: `image` (alt = English), `text` Korean, `audio` `ko.mp3` (transcript = Korean)
- back: `text` English, plus `text` pronunciation for phrases

### Word status store

`users/{id}/apps/school/korean-vocab/status.yml`:

```yaml
gawi:
  state: known          # new | learning | claimed | known
  step: 1               # index into [3, 7, 14, 30]
  nextCheck: 2026-09-30
  history:              # append-only
    - { at: 2026-09-22, event: claim }
    - { at: 2026-09-23, event: check-pass, direction: picture_to_korean }
```

History events: `study`, `claim`, `still-learning`, `check-pass`,
`check-pass-early`, `check-miss`, `quiz-pass`, `quiz-miss`, and
`recording: unavailable` (with reason) on study events. Keyed by word, so
status carries across weekly decks. The history also lets the term grid grade
past days, which plain flashcard decks cannot do today (`no_history`).

### Enrollment

Added to the learner's `programs:` in `household/school/plans/learners/{learnerId}.yml`:

```yaml
- programId: flashcards
  deckId: language/korean/week-01-classroom
  mode: word-ladder
  schedule: { daysOfWeek: [1, 2, 3, 4, 5] }
```

`mode: word-ladder` switches this deck from FSRS to the ladder. Other decks are
unaffected. Rollover = the grown-up changes `deckId`.

## State machine

```
 NEW ──seen──► LEARNING ──"I know it"──► CLAIMED ──check (next day)──┐
                  ▲                                                  │
                  │◄──────────────── miss ───────────────────────────┤ pass
                  │                                                  ▼
                  └───────────── miss / quiz-miss ◄───────────── KNOWN (step 0..3)
```

- CLAIMED → KNOWN at step 0 on a pass (next check +3 days).
- KNOWN pass on or after `nextCheck`: step + 1 (capped at 3, i.e. every 30 days).
- Any pass before `nextCheck` (review quiz, printed quiz): logged, no step change.
- Any miss: → LEARNING, step reset.

## Daily session

The backend builds the plan from the status store.

1. **Checks** — every CLAIMED word, plus every KNOWN word with `nextCheck ≤ today`.
   Four choices (answer + 3 lexicon decoys of the same `kind`). Direction
   rotates through picture→Korean, audio→Korean, Korean→English, chosen
   deterministically from word + date so a reload shows the same check.
   Graded server-side. Immediate feedback: a tick, or the right card with its
   audio. A miss adds the word to today's study pass.
2. **Study pass** — every NEW/LEARNING word in the current deck, plus
   LEARNING words carried from older decks, shuffled. Front plays `ko.mp3`.
   The learner records; VoiceBand requires real speech; the card plays the take then
   the native audio. They flip to English and mark **I know it** (→ CLAIMED)
   or **Still learning**.
3. **Review quiz** — when steps 1 and 2 are both empty, the day is a required
   check over every word in the current deck. Misses demote and are studied
   in the same session; passes are early (no step change).

Consequence: claiming the whole set on Monday cannot produce a free week. The
earliest all-KNOWN day is Wednesday, and from then on each day is a full-set
test.

**Credit:** every check answered and every study card marked, each with a
recorded take when the mic is available. `FlashcardProgramLauncher.status()`
returns `doneToday` and `servedWork: flashcards:<deckId>`. Progress label e.g.
"3 checks · 12 to study".

**Mic unavailable** (permission denied, no device, capture failed): the record
step is removed from study cards. Audio, flip, and marking remain; checks and
the review quiz are unaffected. Each affected card logs
`recording: unavailable` with the reason. The day's credit is the same list
minus the recordings.

**Missing media:** an empty (0-byte) or missing image or audio renders the card
without it (no broken image, no play button), so study can start before media
is generated.

## Printed Friday quiz

- `node cli/school.mjs korean-vocab quiz --deck week-01-classroom` builds a v2
  question bank from the lexicon: one item per word, alternating
  Korean→English / English→Korean, answer + 3 authored decoys, 4 choices.
  Text only. Each item carries `meta.wordId`.
- Published and issued through the existing print path (per-student seeded
  shuffle, Chatsworth OMR row allocation). Verify the PDF renderer embeds a
  Hangul-capable font.
- A listener on the graded-attempt event maps items back to words:
  wrong → `quiz-miss` and demote to LEARNING; right → `quiz-pass`, no step
  change; double mark or blank → existing held-for-review path, no demotion
  until resolved.
- The printed quiz is not required for Friday's daily credit.

## Components

**Backend**

- `2_domains/school/wordLadder/` — pure, date-injected:
  `wordLadder.mjs` (transitions, gaps), `planDay.mjs` (checks → study → review
  quiz), `checkItem.mjs` (direction + choices).
- `1_adapters/school/` — `YamlWordLadderStore`, `LexiconDeckLoader`;
  `SchoolFlashcardAssetRepository` gains a named `media:` root → `media/school`
  alongside the existing `data/content/assets` root.
- `3_applications/school/` — `WordLadderStudyService` (open, plan,
  answer-check, mark-card, record-take), `word-ladder` branch in
  `FlashcardProgramLauncher.status()`, graded-quiz → word-status listener.
- `4_api` — `/school/word-ladder/:sessionId/…`, verifying the learner's
  actual assignment server-side.
- Certify treats a 0-byte asset as missing.

**Frontend**

- `Programs/Flashcards/WordLadder/` — `WordLadderProgram.jsx`,
  `CheckCard.jsx`, `StudyCard.jsx`.
- Reuses from SentenceLadder: `useVoiceCapture`, `VoiceBand`,
  `useCapabilities`, and the recording upload in `languageApi`
  (filed under `korean-vocab/<wordId>`).
- `wordLadderLog.js` facade: plan counts, each check result, each mark,
  recording upload ok/fail, mic-unavailable reason, session start/end.

## Seeding (part of this work)

- `lexicon.yml` with the 19 entries and authored decoys.
- `week-01-classroom` deck.
- 57 zero-byte placeholders (`image.jpg`, `ko.mp3`, `en.mp3` per word).
- The learner's enrollment entry.

## Testing

- Domain: transition table, gap arithmetic, early-pass rule, review-quiz
  trigger, choice construction (answer present, no duplicates, same-`kind`
  decoys only), deterministic direction.
- Adapter: status store round-trip, lexicon expansion, two-root asset lookup.
- Launcher: credit rule, including mic-unavailable.
- Component: `WordLadderProgram` check → study → done; mic-denied run;
  empty-media rendering.
- Live: Playwright run of a full day against the single dev server.

## Docs

- New `docs/reference/school/word-ladder.md`.
- Update `docs/reference/school/flashcards.md` (the `word-ladder` mode, the
  `media:` asset root).
- Update `media/school/README.md` (generated-media placeholders for word
  ladder packages).
- Add a row to the CLAUDE.md navigation table.

## Out of scope

- Image generation and TTS rendering (filled externally into the placeholders).
- Speech scoring.
- Automatic weekly rollover.
