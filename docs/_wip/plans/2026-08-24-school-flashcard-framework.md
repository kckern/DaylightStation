# School Flashcard Framework plan

## Decision

Build a course-integrated, rich-media study framework inside
`frontend/src/modules/School/Programs/Flashcards/`.  It replaces the current
single-pass self-graded card runner as the learner surface while preserving the
existing question-bank and quiz contracts.  It is **not** a standalone Quizlet
clone: there are no public sets, sharing, classes, accounts, imports from
Quizlet, or games.

The framework must be usable both as a `flashcards` Learning Catalog module
and from the existing bank shelf.  A module supplies the course/lesson context;
the system supplies per-learner scheduling and records; a deck supplies the
content.  The first implementation must remain touch-first and work without a
keyboard, while preserving keyboard access on browser surfaces.

## Evidence and product scope

Quizlet's current Flashcards offers flip, forward/back navigation, shuffle,
autoplay, answer-direction choice, a Still learning/Know sort, and speaker
audio.  Its Learn experience chooses a goal, direction, question types,
shuffling, audio, and a grading level; it explicitly describes itself as a
personalized path.  Test lets a learner choose count and question types, then
submit and review a score.

Useful implementation lessons from open source:

- [fkozlicki/quizlet-clone](https://github.com/fkozlicki/quizlet-clone) is a
  good reference for the four distinct learner surfaces—flashcards, learn,
  memory game, and configurable mixed test—but its social/account/folder
  architecture should not be adopted.
- [Quenti](https://github.com/quenti-io/quenti) is mature and broad, but is an
  AGPL full-stack application with OAuth, MySQL, and a separate product model;
  use it for interaction inventory, not code or architecture.
- [Quizlet-Learn-Clone](https://github.com/elitheowl/Quizlet-Learn-Clone)
  demonstrates the important ingredients to retain: four confidence grades,
  durable per-card due dates, session resume, browser TTS, and a local audio
  cache.  Its SM-2 implementation is a reasonable prototype, but not the
  target scheduler.
- [Ta7ar/Quizlet-Clone](https://github.com/Ta7ar/Quizlet-Clone) is a basic
  create/use-card app rather than an adaptive study engine; it is out of scope
  beyond confirming that we do not need its account and CRUD product surface.

Use a versioned implementation of the open Free Spaced Repetition Scheduler
(FSRS), with frozen default parameters first and later per-learner optimization.
FSRS models difficulty, stability, and retrievability and is intended to use
review history for scheduling.  Do not write an ad-hoc interval formula or use
SM-2 as the durable data contract.

Sources: [Quizlet Flashcards](https://help.quizlet.com/hc/en-us/articles/360030988091-Studying-with-Flashcards),
[Quizlet Learn](https://help.quizlet.com/hc/en-us/articles/360030986971),
[Quizlet Test](https://help.quizlet.com/hc/en-us/articles/360030642972-Studying-with-Test),
and [FSRS](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm).

## Existing seams to retain

- `school.question-bank/v2` is the canonical source for objectively graded
  questions and printable assessments.  Do not duplicate quiz items into a
  flashcard-only bank.
- Catalog modules already permit `type: flashcards` with a `bankId`; module
  launch carries catalog, course, unit, lesson, module, and concept context.
- `FlashcardRunner` already has the correct identity pinning and offline/error
  behavior.  Carry those lifecycle protections forward, rather than merely
  rebuilding its UI.
- School attempts are append-only, dated, attributable events.  Quiz evidence
  and self-report must remain separate.  Scheduler history is additionally a
  durable learner-state projection, not a replacement for evidence.
- Course/module launch certification must continue to gate flashcards via the
  existing `flashcards@1` capability.

## Target learner experience

1. **Deck hub.** Shows course/lesson title, due/new/learning counts, an
   optional authored goal, recent progress, and four non-game modes:
   Review, Learn, Flashcards, and Test.  A catalog module can hide modes the
   author did not enable.  The bank shelf exposes the same hub with a sensible
   unrestricted default.
2. **Review (the daily default).** Draw due cards first, then learning cards,
   then new cards up to an authored/session limit.  Reveal the answer and
   grade `Again`, `Hard`, `Good`, or `Easy`; show the next scheduled interval
   only after a grade.  Relearn misses in the same session before completing.
3. **Learn (progressive mastery).** Start with recognition (multiple choice or
   matching) when useful, move to recall (typed/spoken where enabled), and
   re-present misses with the answer and a short authored explanation.  The
   target is a mastery goal for the current set, not an assessment score.
4. **Flashcards (browse/self-check).** Flip, previous/next, shuffle, answer
   direction, autoplay, `Still learning`/`Know`, and `Show me again`.  This is
   low-stakes self-report.  `Know` maps to a visible confidence choice and
   never fabricates graded course evidence.
5. **Test (assessment).** A preflight chooses count, question forms, direction,
   and optionally a starred/filtered subset.  It then delegates to the
   existing one-pass, server-graded quiz runner, preserving immutable snapshots,
   resume behavior, feedback, pass bars, and remediation handoff.
6. **Completion.** Every mode ends with counts, not a misleading single
   percentage: reviewed, relearning, newly learned, due remaining, and what is
   next.  Learners can stop safely at any time and resume the same state.

Excluded: Match/Blocks/memory games, type-race games, public discovery,
sharing, classrooms, OAuth, social statistics, and gamified leaderboards.

## Content and data model

### 1. Rich reusable card presentation

Introduce `school.flashcard-deck/v1`, stored next to a course's question bank
or as a typed compact-course artifact.  It may reference a question bank for
assessment/learn prompts but owns presentational card faces.  This avoids
overloading a quiz item's `prompt`/`answer` with media and layout semantics.

```yaml
schema: school.flashcard-deck/v1
id: science/cells/cell-organelles
title: Cell organelles
bankId: science/cells/cell-organelles-check # optional, for Learn/Test
cards:
  - cardId: mitochondrion
    concepts: [cell-energy]
    front:
      blocks:
        - type: text
          text: Which organelle releases usable energy from food?
        - type: image
          assetId: cell-diagram-mitochondrion
          alt: Mitochondrion highlighted in a cell diagram
    back:
      blocks:
        - type: text
          text: The mitochondrion.
        - type: audio
          assetId: mitochondrion-pronunciation
        - type: tts
          text: mitochondrion
          lang: en-US
        - type: video
          assetId: cellular-respiration-clip
          posterAssetId: cell-energy-poster
    explanation: It turns energy from food into ATP for the cell.
    directions: [front_to_back, back_to_front]
```

Define a shared, validated `CardBlock` vocabulary: `text`, `image`, `audio`,
`video`, `tts`, and (only when supported by the certified surface) `diagram`.
Assets use stable School asset references and required accessible alt text,
captions/transcripts for audio/video, language for TTS, aspect-ratio metadata,
and a poster/fallback.  Video is inline and deliberately short; it never turns
the flashcard surface into a general media player.

### 2. Learning policy versus content

A `flashcards` module evolves from `{ bankId }` to `{ deckId, bankId?, policy }`.
`policy` declares enabled modes, new-card/day and session limits, default
direction, optional mastery target, and course-owned completion semantics.
The author never writes a learner's due date or mastery state.

For migration, a flashcards module with only `bankId` projects each current
question-bank item into a text-only card (`prompt` front, canonical answer
back).  This keeps every existing card link working and makes rich decks an
opt-in authoring upgrade.

### 3. Durable learner records

Add a per-learner `flashcards.yml` projection keyed by stable `deckId/cardId`:

```yaml
schema: school.flashcard-progress/v1
cards:
  science/cells/cell-organelles/mitochondrion:
    state: learning # new | learning | review | suspended
    dueAt: 2026-08-25T16:00:00.000Z
    scheduler: { algorithm: fsrs-6, parametersVersion: default-1, stability: 2.3, difficulty: 5.1 }
    reviews: 7
    lapses: 2
    lastReviewedAt: 2026-08-24T16:00:00.000Z
```

Append every rating as a `flashcard_review` event (with deck/card, rating,
mode, direction, timestamp, session and course context) in the existing
attempt/event system.  The projection is atomically rebuilt/updated from those
events, is revision-aware, and is repairable.  Content revisions retain card
progress only when card IDs are stable; deleted cards are retired, never
silently reassigned.

## Delivery sequence

1. **Foundation and migration.** Specify schemas, validators, repositories,
   revision rules, asset resolver, and FSRS scheduler adapter with deterministic
   clock tests.  Add the `flashcards@2` capability while retaining `@1` for
   legacy text cards.  Create a text-only bank-to-deck adapter and migration
   fixtures.
2. **Program shell and rich card renderer.** Add
   `Programs/Flashcards/FlashcardProgram.jsx`, a deck hub, touch-sized controls,
   focus/keyboard behavior, and a safe `CardFace` renderer.  Reuse School
   profile/session guards, logging, surface certification, and School SCSS
   conventions.  Add Web Speech TTS with explicit play controls, cancellation,
   and unavailable-voice fallback; native audio is preferred whenever authored.
3. **Browse and Review.** Ship current cards as the Flashcards browse mode,
   then add the scheduler-backed daily Review session.  Persist every response
   before advancing, resume interrupted sessions, and make an unavailable
   backend visible without trapping the learner.
4. **Progressive Learn.** Introduce a pure mode state machine and deterministic
   item-selection policy.  Bind to question-bank forms where a bank is present;
   otherwise use confidence/reveal loops.  Preserve the line between learner
   self-report and server-graded answers.
5. **Configurable Test.** Add preflight configuration and build a scoped,
   immutable quiz session from the existing bank.  Do not fork `QuizRunner`;
   extend its session-opening contract to accept a server-validated item plan.
6. **Course progress and teacher visibility.** Add due/review summaries to the
   learner home and program report, course/module completion policy, and a
   teacher read-only view of aggregate due/mastery/remediation signals.  Do not
   expose competitive rankings or turn review ratings into grades.
7. **Authoring and rollout.** Document deck YAML, create one image/audio/video
   exemplar and one text-only migrated deck, validate in certification, then
   migrate selected courses progressively.  Audit accessible media behavior on
   Portal and browser certified surfaces.

## Acceptance checks

- A learner can open a rich deck from a course module; identity, course
  context, certification, and progress all survive the launch.
- A card can render text plus image/audio/video/TTS with accessible fallbacks;
  missing media does not discard the rest of the card.
- Four confidence grades produce deterministic next intervals and a complete,
  attributable review log; a restart resumes without duplicate ratings.
- Misses reappear in-session; due cards reappear on the next eligible review;
  prior content revision histories do not corrupt a changed deck.
- Learn escalates from recognition to recall and records its evidence correctly.
- Test uses the existing server-grade/snapshot/pass/remediation path and never
  derives a course grade from a flashcard self-rating.
- Existing `bankId` flashcard modules, generic bank browsing, guest behavior,
  printed quizzes, and current `FlashcardRunner` tests remain green during the
  transition.
- Portal touch controls meet the current 64px target; browser shortcuts are
  additive; audio/video have captions/transcripts and TTS respects reduced
  motion/autoplay expectations.

## Implementation decisions still requiring explicit approval

- Whether Review completion may satisfy a course module, or remains formative
  and only a quiz can provide mastery evidence.  Recommended: formative by
  default; an author may require a configured review target only when the
  course declares it.
- Whether to commit a maintained FSRS library or port/freeze a small audited
  scheduler implementation.  Recommended: use a version-pinned maintained
  library behind a pure adapter, with its exact version recorded in progress.
- Whether speech-recognition answers belong in the first release.  Recommended:
  no—support authored audio and TTS first, then add speech input only after a
  device/privacy/accessibility design is approved.
