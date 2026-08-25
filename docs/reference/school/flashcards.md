# School flashcards

Rich flashcard decks are course-integrated School content. They are private to
the household: there are no public sets, sharing, classes, OAuth, or games.

## Deck file

Place YAML deck files under the configured
`catalog.content.flashcard_deck_directories` (by default,
`content/school/learning-catalog/flashcard-decks`). Each file has this shape:

```yaml
schema: school.flashcard-deck/v1
id: science/cells/organelles
title: Cell organelles
revision: 1
assessment: # optional graded Test; not a card-to-question mapping
  bankId: science/cells/check
cards:
  - cardId: mitochondrion # stable forever once learners have studied it
    front:
      blocks:
        - type: text
          text: Mitochondrion
        - type: image
          assetId: school/cells/mitochondrion.png
          alt: A mitochondrion highlighted in a cell diagram.
    back:
      blocks:
        - type: text
          text: Turns food energy into ATP
        - type: audio
          assetId: school/cells/mitochondrion.mp3
          transcript: Mitochondrion.
        - type: tts
          text: Mitochondrion
          lang: en-US
    learn:
      front_to_back:
        acceptedAnswers: [Turns food energy into ATP, Makes ATP]
    directions: [front_to_back, back_to_front]
```

Allowed block types are `text`, `image`, `audio`, `video`, and `tts`. Images
need `alt`; audio/video need a `transcript`; videos also need `posterAssetId`.
Cards must have non-empty front and back block lists. A card can be a question
and answer, or simply an association such as `Washington ↔ Olympia`. Learn
derives typed recall from the opposite face and can accept author-supplied
aliases in `learn`. A media-only target becomes a reveal-and-rate Learn step.
The optional `assessment.bankId` is a separate graded quiz relationship: its
items need not share card IDs or wording with the deck.

The shipped exemplar is
`data/content/school/learning-catalog/flashcard-decks/geography/us-state-capitals.yml`.
It uses the existing `geo:us-state-capitals` generated assessment bank and
demonstrates bidirectional text cards plus browser text-to-speech.

Run `npm run school:certify` before publishing content. Its gate validates
every mounted flashcard-deck schema, rejects duplicate deck IDs, and verifies
all image, audio, video, and video-poster assets alongside normal catalog
content. Use `--flashcard-deck-directories <a,b>` with `school.mjs certify`
when validating a nonstandard deck mount.

## Assets

`assetId` is a path relative to `content/assets` by default (or the configured
`school.flashcards.assets.dir`). The player requests it through
`/api/v1/school/flashcards/assets/<assetId>`; the server refuses traversal,
missing files, and unknown MIME types. Use approved image (`png`, `jpg`,
`webp`, `svg`, `gif`, `avif`), audio (`mp3`, `m4a`, `ogg`, `wav`), and video
(`mp4`, `webm`) files only.

## Module and assignment policy

A course module points to a rich deck with `deckId` and may declare its study
policy. The deck, not the module or assignment, owns any Test relationship:

```yaml
type: flashcards
deckId: science/cells/organelles
policy:
  modes: [review, learn, cards, test]
  newCardLimit: 10
  activeMinutes: 20
  minimumReviews: 30
  masteryPercent: 80
```

Standalone assignments use `programId: flashcards` and the same policy:

```yaml
programId: flashcards
deckId: science/cells/organelles
policy:
  activeMinutes: 20
  minimumReviews: 30
  masteryPercent: 80
  quizRequired: true
  quizPassingPercent: 80 # optional; defaults to 80
```

`quizRequired: true` requires the referenced deck to define
`assessment.bankId`; an assignment cannot override it. Flashcard ratings are
formative. A standalone assigned deck's Test path first verifies the learner's
actual assignment, resolves the deck's assessment bank, and tags
the resulting server-graded attempt stream with its deck and expected question
count. Completion accepts only a complete tagged run meeting
`quizPassingPercent` (80 by default); ordinary practice of the same bank never
counts by accident. Before opening a Test, the learner may choose a count and
available question forms. The browser sends only those constraints; the server
selects the immutable snapshot and never accepts learner-supplied item ids.

To study the inverse relationship as a separately scheduled body of knowledge,
author a second deck with its faces reversed (for example, `Olympia ↔
Washington`). Progress is keyed by `deckId/cardId`, so the two decks have
independent FSRS schedules. The in-player Reverse control is still useful for
ad-hoc browsing, but it does not replace a separately authored inverse deck.

`activeMinutes` and `minimumReviews` are daily targets: only capped,
server-recorded flashcard activity inside the household study-day window counts
for the current assignment day. `masteryPercent` remains deck-level, since it
describes current FSRS state rather than a single session.

## Revision rule

Keep each `cardId` stable when editing a card. FSRS progress is keyed by
`deckId/cardId`, so a retained card id preserves its schedule; deleted ids are
retired and never reassigned to different knowledge. Raise `revision` whenever
meaningful card content changes. On the learner's next open, School records the
revision transition, added IDs, and retired IDs in durable flashcard history;
retired cards are excluded from future queues but their old review evidence is
never silently deleted.
