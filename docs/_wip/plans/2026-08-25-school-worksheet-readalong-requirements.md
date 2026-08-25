# School worksheet readalong — requirements

**Date:** 2026-08-25
**Status:** requirements agreed; implementation in progress.
**Related:** `docs/reference/school/README.md`, `docs/reference/school/print-documents.md`, `frontend/src/modules/School/SchoolApp.jsx`, `frontend/src/modules/Player/renderers/ReadalongScroller.jsx`

## Purpose

Give a learner an optional way to hear and follow the scripture assigned for a
printed Come, Follow Me worksheet while they work from their physical Bible.

The feature supports the worksheet; it does not replace the physical-book
activity. Questions remain page- and verse-directed, and the learner finds the
answers in the book.

## Learner experience

1. A worksheet prints with its existing worksheet/print affordance and a
   second, visually distinct **PANEL CODE** labelled for the optional
   readalong.
2. The learner enters that code at the School Portal.
3. The Portal presents a prominent lesson card, for example, “Listen and read:
   Psalms 70–72; 77,” with one action to open the readalong.
4. The readalong opens inside the School experience and shows the matching NIrV
   scripture text with audio for the day’s reading.
5. The learner may listen while completing the paper worksheet, or may ignore
   the option entirely.

The readalong code must be a different code from the code that starts or prints
the worksheet. Its printed label and placement must make the two purposes
unambiguous.

## Generic readalong UX

The player experience is generic. Scripture is its first caller, but the same
readalong shell and adapter must also be usable by future audiobooks and other
readable/listenable material. Do not build a scripture-only player or a
worksheet-specific copy of `ReadalongScroller`.

The generic shell provides:

- a persistent **Back** action to the launch card that opened the readalong;
- the work title, current part title, and playlist position (for example,
  `2 of 4`);
- a labeled, segmented playlist-progress indicator. Each segment represents a
  part, shows the current part plainly, and fills to show overall progress;
  segments may also be selected to jump to that part. This is more informative
  than unlabeled dots for a multi-part reading;
- visible play/pause, rewind, forward, and timeline seek controls;
- previous/next-part controls and a picker that permits jumping to any part;
- an ordered playlist that advances automatically at the end of a part; and
- text appropriate to the item type, including verse-numbered scripture when
  that is the content.

Learners may exit, pause, seek, fast-forward, rewind, skip, or choose another
part at any time. None of those controls changes grading or turns listening
into a gate.

The controls should be visible and recoverable on the room panel: a compact
context bar above the text and transport controls below it. Preserve reading
width rather than using a permanent side rail. The existing scroller's
audio-paced text movement is approximate until timing data exists; the UI must
not imply precise verse or word synchronisation.

## Reading scope

### The daily reading is authoritative

Each course lesson's `provenance.reading` is the source of truth for the
readalong scope. Worksheet questions select a small number of passages from
that reading; they do not reduce the reading to just those passages.

For example, Wednesday 2026-08-26 is `Psalms 70–72; 77`. Its readalong is an
ordered sequence of Psalm 70, Psalm 71, Psalm 72, and Psalm 77. The worksheet
may cite only selected verses from those chapters.

Daily readings commonly contain several complete chapters. A one-chapter player
is therefore a useful atomic unit, not a complete lesson experience. A lesson
readalong is an ordered playlist of its chapter units.

### First-pass chapter policy

- Audio and playback remain atomic at the **chapter** level.
- The text corpus already holds individual verse IDs and verse text, so it can
  render verses normally without a new scripture-data breakdown.
- The first release does not require per-verse audio timestamps, automatic
  scrolling, or spoken-word highlighting.
- When the curriculum assigns only part of a chapter, the first release may
  play the complete chapter. In particular, both Malachi 3:1–10 and Malachi
  3:11–18 may use the same complete Malachi 3 recording.

This preserves simple, existing audio assets while giving every worksheet a
useful listening companion.

## Content and audio contract

The readalong must use the NIrV text and matching NIrV audio. NIrV chapter
files already exist for the course readings; their filename prefix is the
chapter's first verse ID and aligns with the text corpus.

The current audio files have chapter-level duration/metadata but no per-verse
start and end times. Therefore the initial feature must not claim word- or
verse-synchronised playback.

A later enhancement may add a verse timing map:

```yaml
verse_id: '14699'
startSeconds: 42.1
endSeconds: 48.6
```

That future map may enable verse highlighting, seeking to a worksheet-cited
verse, and a stricter definition of listening completion. It is explicitly not
a prerequisite for this feature.

## Completion and assessment

Listening policy is configurable by offering. Come, Follow Me initially treats
it as optional and not as a grading event.

- It does not change the worksheet's question selection or OMR scoring.
- For Come, Follow Me's initial policy, it also does not change the 80% pass
  threshold, retry path, lesson completion, or exit criteria.
- Opening the readalong must not count as listening.
- Record a learner-scoped readalong outcome associated with the issued
  worksheet/session, distinguishing at least `opened` from `listened`.
- The UI must not award points or extra credit. Its required/optional wording
  must match the offering's configured participation policy.

The recorded `listened` outcome is retained for a possible future policy that
requires listening as part of an exit criterion. Such a policy is out of scope
for this release and must be introduced deliberately, without changing
historical worksheet grades.

## Panel-code and launch constraints

Existing panel codes are aliases for `subject_next` agenda tokens and resolve
to the next subject action. A worksheet readalong needs a separate,
narrowly-scoped action/token that is bound to the learner and the specific
issued worksheet or lesson reading.

The implementation must provide:

- a unique, random six-digit code;
- study-day expiry, independent of the longer-lived print/agenda token;
- a resolver that does not create, issue, grade, or otherwise mutate worksheet
  state merely because a code was entered;
- a Portal launch card with only the optional readalong action;
- a route from the School experience to the generic readalong player with the
  ordered part IDs for that lesson;
- no broad, browsable content route or ability for the code to open another
  learner's lesson.

The existing `ReadalongScroller` renders a single readalong item. The generic
readalong adapter/player therefore needs a playlist/sequence layer above it;
the School feature supplies the lesson's ordered chapter IDs. It must not
manufacture a merged audio file for every worksheet.

## Acceptance criteria

1. An issued Come, Follow Me worksheet can optionally display one labelled
   readalong panel code in addition to its existing worksheet code.
2. Entering a valid code opens only the matching learner's readalong lesson
   card during its validity window.
3. The card launches the NIrV text and audio for every chapter in the daily
   `provenance.reading`, in order.
4. A multi-chapter daily reading plays as a sequence; it is not reduced to the
   worksheet question verses, and it advances automatically from one part to
   the next.
5. A partial-chapter daily reading is allowed to play the full chapter in this
   release.
6. Opening the readalong does not alter worksheet issuance, question order,
   grade, pass/fail state, or completion state.
7. The system records opening and listening separately, associated with the
   learner and worksheet/session.
8. The UI presents listening as optional and grants no score or extra credit.
9. No automatic verse highlighting or timing-based completion claim is made
   unless verse timing data has been added.
10. The playback shell is generic: it supports ordered readalong parts without
    assuming that those parts are scripture chapters.
11. A visible, labeled playlist-progress indicator shows the current part and
    progress across the complete playlist.

## Out of scope

- Per-verse or word-level audio alignment.
- Automatic scrolling/highlighting tied to narration.
- Seeking audio directly to a worksheet question's verse.
- Replacing the physical Bible as the answer source.
- Making listening required for passing or exiting a lesson.
- Adding points, badges, or extra credit for listening.
