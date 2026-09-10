# Sentence-ladder card metadata

**Status:** shipped 2026-09-09 (`22a4a6c08`). The behaviour now lives in
[`reference/school/sentence-ladder.md`](../../reference/school/sentence-ladder.md#what-the-card-says);
this page is kept for the reasoning behind it.
**Surfaces:** printed agenda card, self-service launch card.

## The defect

A Glossika agenda card printed `Language › Independent study`, `■ Korean`, and
the title `Korean` — one word, three times, over an empty poster panel with no
progress bar and no description. The launch card was the same word with a grey
rectangle beside it.

None of that is a rendering bug. `projectProgramEntry` (`assignedProgramPlan.mjs`)
already reads two fields off a launcher's `status()` and feeds them to
everything a card shows:

| `status()` field | What it becomes |
|---|---|
| `context.course` | breadcrumb after the subject |
| `context.unit` | the `■` line above the title |
| `context.lesson` | the card title, and `courseId` for the poster |
| `progress` | the bars |

`PianoCourseProgramLauncher` returns both. `LanguageProgramLauncher` returns
neither, so `BuildAgenda:660` falls to its generic branch: `'Independent study'`
is the literal fallback for work with no course, the `■` line gets the corpus id
and the title gets `enrollment.title` — the same string twice.

Everything the card wants already exists inside `LanguageStudyService`
(`#summarizeCourse` computes the day, the outstanding count, a new/review
breakdown, and a `Today` metric) and dies there: `todayStatus()` returns only
`{doneToday, progressLabel, score}`.

## What the card says

```
┌────────────────────────────────────┐
│ A文 Language › Glossika Korean     │
│ ┌─────┐                            │
│ │ QR  │  ■ Fluency 1 · Day 12      │
│ │     │                            │
│ └─────┘  18 sentences today        │
│ 000000   6 new, 12 to review       │
│ TODAY                     4 of 18  │
│ ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│ ──────────────────────────────────  │
│        [ ] ON THE PORTAL           │
└────────────────────────────────────┘
```

Three slots, three different facts. The title is **the work**, not the day: the
card is an offer, and "Day 12" is an odometer reading rather than a thing to do.
This breaks symmetry with cards titled by a lesson name, accepted deliberately.

The launch card carries the same facts in the same order, plus the course
poster in the panel that is empty today. One set of facts, two renderings — a
child who read the paper recognises the screen, and the two cannot disagree.

**One bar, not two.** `Today` is the number a child can actually move. The
lifetime figure stays off, for the reason `LanguageStudyService` already gives
about its own `sentences started` metric: a bar at 15% that will not visibly
move for a year says "you are nowhere".

## Units are declared in the enrollment

The corpus is 4143 sentences with no internal structure — `id`, `label`,
`languages`, `audio_base`, `sentences`. The three Glossika PDFs do have
structure, and it maps onto `seq` exactly (verified against the books: Fluency
2's first body sentence is numbered 1001, Fluency 3's is 2001, and the corpus
has no gaps in 1–4143):

```
seq    1–1000   Fluency 1     origin: glossika
seq 1001–2000   Fluency 2
seq 2001–3000   Fluency 3
seq 3001–4143   1143 sentences, origin: naver-tts — provenance unknown
```

That mapping could be derived, but the boundaries are a decision about how this
course is shaped for this learner, not a property of the material — so they are
declared in the enrollment, beside `lessonSize` and `rungs`, which partition the
same corpus already:

```yaml
- programId: sentence-ladder
  corpusId: glossika-korean
  subject: language
  title: Korean
  lessonSize: 60
  units:
    - { from: 1,    label: Fluency 1 }
    - { from: 1001, label: Fluency 2 }
    - { from: 2001, label: Fluency 3 }
    - { from: 3001, label: More practice }
  rungs: [repetition, dictation, recording, interpretation]
```

**Boundaries only, no ranges.** Each unit runs until the next one starts; the
last runs to the end of the corpus. A gap or an overlap is unrepresentable —
with `from`/`to` pairs a typo of `to: 999` silently loses a sentence. Omitting
`units:` leaves the course one unbroken run, which is what every other corpus
gets until somebody partitions it.

The last label is provisional: those 1143 sentences are not from the three
books and their provenance is not established. Renaming them is one line here,
rather than an edit to 1143 corpus rows — which is most of the argument for
putting units in the enrollment in the first place.

## Changes

**`2_domains/school/language/`** — a pure `unitFor({ units, seq })` returning
the declared label for a sentence, and `unitProgress({ units, seq })` for the
bar if it is ever wanted. No clock, no I/O. `taxonomy.mjs`'s existing
`taxonomyFor()` is dead code that nothing calls and synthesises `Unit N` from a
day count; it is replaced by this, not extended.

**`LanguageStudyService.todayStatus()`** — return `context` and `progress`
alongside today's triple:

```js
context: {
  course: { id: corpus.id, title: corpus.label },   // "Glossika Korean"
  unit:   { id, title },                            // "Fluency 1", or null when undeclared
  lesson: { id: `day-${day}`, title: `${outstanding} sentences today` },
},
progress: [{ scope: 'unit', label: 'Today', completed: done, total: queue.length }],
description: this.#describeOutstanding(outstanding),   // "6 new, 12 to review"
```

`doneToday`, `progressLabel` and `score` keep their current meaning; this is
additive, and `IProgramLauncher`'s documented shape already carries optional
fields. `todayStatus` must remain read-only (agenda preview depends on it) and
must not throw — both already true and both covered by existing tests.

**`description`** has no route to the card yet: `projectProgramEntry` does not
carry it and `BuildAgenda` reads `next.description`. One line in each.

**As shipped, one delta from the sketch above:** `description` counts the
outstanding queue **by rung** ("6 repetition, 12 dictation") rather than by
new-versus-review. The rung breakdown is what a child is about to do next;
new-versus-review describes the queue's construction, which is our concern
rather than theirs.

**Poster.** The image is ingested at
`media/school/language/glossika-korean/poster.jpg`, matching the
`<media>/school/{subject}/{work}/poster.jpg` convention. Nothing served that
path for a program: `curriculumPosterRef` resolved either to a curriculum work
(needs a course v2 record, which the ladder has none) or to
`<media>/school/programs/{programId}/poster.jpg` via the `program:` scheme.

Two options were weighed — reuse the one-face `program:<id>` form, or extend
the scheme to carry an instance — and **option 2 was built**. The `program:`
course-id scheme now takes a second form, `program:<programId>:<instanceId>`,
served from `<media>/school/programs/<programId>/<instanceId>/poster.jpg`, so
the ladder's artwork keys to the CORPUS: `program:sentence-ladder:<corpusId>`.
The first option was rejected for the reason it was listed with — one program,
one picture puts a Korean cover on a Spanish card the day a second language is
enrolled. Both id segments are validated by the same curriculum-id rule; a
program with one face (the reading shelf) keeps the short form. See
"Where artwork comes from" in [the School README](../../reference/school/README.md).

## Testing

Domain: `unitFor` at each boundary and either side of it, an undeclared corpus,
an out-of-range seq, unsorted `units`, an empty list. Service: `todayStatus`
returns a context whose three parts are three distinct strings; a corpus with no
`units` yields `unit: null` rather than a placeholder; the read-only and
never-throw contracts still hold. Card: a golden agenda card asserting the
breadcrumb, the `■` line, the title and one bar — the duplication that started
this is exactly a "these three strings are not all the same" assertion.
