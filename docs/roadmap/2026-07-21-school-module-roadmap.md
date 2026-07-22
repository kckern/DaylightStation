# School — Module Roadmap

> What else can live inside `frontend/src/modules/School/`, categorized by the
> kind of learning interaction and the kind of evidence it produces.

**Last Updated:** 2026-07-21
**Status:** Roadmap / taxonomy — no implementation implied by inclusion here
**Reference (what exists today):** [`docs/reference/school/README.md`](../reference/school/README.md)
**Programme requirements:** [`docs/superpowers/specs/2026-07-21-portal-homeschool-requirements.md`](../superpowers/specs/2026-07-21-portal-homeschool-requirements.md)

---

## 1. Why categorize at all

School today has one built section (Quizzes & Flashcards) and a section grid
built to take more. The temptation is to keep adding tiles: multiplication
tables, a typing game, an exam scanner, a writing pad. That produces five
unrelated mini-apps sharing a stylesheet.

The useful organizing question is not "what subject is this?" but **"what
evidence does it leave behind, and what does that evidence let a parent
conclude?"** Existing conventions already turn on that question:

- A quiz is one pass because resurfacing destroys the completion signal.
- A flashcard drill resurfaces because drilling and assessment are different jobs.
- Quiz and flashcard tallies are never merged: server-graded evidence vs. self-report.

Everything below inherits those rules. The document has three parts:

- **§3 — six categories.** Six distinct evidence shapes. Horizontal: kinds of
  interaction.
- **§4 — four cross-cutting layers.** Tutoring, content pipeline, print, parent
  view. They attach to the categories rather than sitting beside them.
- **§5 — verticals.** What a parent actually asks for ("AP Bio", "SAT prep", "a
  reading programme", "teach them how taxes work"). Each is a curriculum stack
  over several categories, and each is mostly *content* once its categories exist.

Cutting across all of it is a second axis, §2b: whether an item is **content**
(author a bank, curate material) or **code** (build an engine or an interactive).
That axis, more than category, determines what something costs and who does it.

---

## 2. The taxonomy at a glance

| # | Category | Interaction | Evidence produced | Gated? |
|---|---|---|---|---|
| A | **Consumption** | Take material in | Engagement + downstream comprehension | Sequential courses only |
| B | **Assessment** | One pass, graded | A score against a key | No |
| C | **Fluency drill** | Repeat to mastery | Speed × accuracy curve over time | No |
| D | **Composition** | Produce an artifact | The artifact + a submission event | No |
| E | **Exploration** | Manipulate a model | Engagement, session traces | No |
| F | **Puzzle** | Solve a bounded artifact | Completion, time, hints used | No |
| — | **Tutoring layer** | Cross-cutting | Attaches to B and C records | — |
| — | **Content pipeline** | Cross-cutting | Authoring-time; writes banks and materials | — |
| — | **Print layer** | Cross-cutting | Renders any of the above to paper | — |
| — | **Parent layer** | Cross-cutting | Reads everything; writes assignments and sign-off | — |

And the verticals that stack on top of them (§5):

| Vertical | Leans on | Mostly |
|---|---|---|
| **SAT / ACT / AP prep** | A, B, C, scantron, parent layer | content + a timer and scaled scoring |
| **Subject sequences** (history, chemistry, biology) | A, B, pipeline | content, once the pipeline exists |
| **Reading programme** (AR-style) | A, B, D, pipeline | content; a bank per book |
| **Civic and practical literacy** (civics, voting, taxes, statistics, economics) | E, A, B | **code** — parameterized models |

**No second gate.** Only sequential courses lock. That decision is already made
and this roadmap does not reopen it — a fluency drill that locks the next drill
would recreate the dead-end trap on an unattended kiosk.

---

## 2b. The second axis: content items vs. code items

Category tells you what an item *is*. It does not tell you what it *costs*, or
who does the work. That is a separate axis, and mixing the two is how a roadmap
becomes undeliverable:

| | **Content item** | **Code item** |
|---|---|---|
| The work is | Authoring YAML, curating material | Building a component or engine |
| Ships against | Existing runners, unchanged | New frontend + often new backend |
| Example | A quiz bank for a Great Courses lecture | Multiplication tables engine |
| Example | AP US History question sets | Interactive supply/demand curve |
| Scales by | Hours of authoring (or AI generation + review) | Engineering time |
| Blocked by | Nothing, once the runner exists | Design decisions, storage shape |
| Failure mode | Backlog never gets written | Half-built one-off sections |

Two consequences worth holding onto:

1. **Content items are the payoff for code items.** Every hour spent on the quiz
   runner is redeemable against unlimited banks. Before building a new
   interaction, ask whether the want is actually a content gap in an interaction
   that already runs. Most "we need X" turns out to be "we need banks for X."
2. **The tutoring layer's item generation (§4) is a content-cost lever, not a
   feature.** AI-drafted banks with human review is what makes a content backlog
   of hundreds of units plausible. That reframes its priority: it is
   infrastructure for the content axis.

Category sections below tag their candidates **[content]** or **[code]** where it
is not obvious. A few are both — an interactive supply/demand curve is code once
and content thereafter, if it is built as a parameterized model rather than one
hardcoded chart.

---

## 3. The six categories

### A. Consumption — material you take in

**Status:** specced as the materials framework; unbuilt.
**Spec:** [`2026-07-22-school-materials-framework-design.md`](../superpowers/specs/2026-07-22-school-materials-framework-design.md)

Video courses (Plex shows), listening (Plex albums), readalong, reference units.
Source adapters normalize each into materials with units; gate steps compose
(`[readalong, quiz]`).

Candidates that fit here without new architecture:

- **Reading — PDF / EPUB.** Adapters exist; both renderers are stubs. Cheapest
  remaining consumption source.
- **Documentary / field-trip video** as a distinct category from lecture courses,
  since the pedagogy differs (survey vs. sequence) even though the source adapter
  is identical.
- **Map and timeline reference units** — browsable rather than sequenced.

The category is well understood. Its open work is renderers and adapters, not
design.

---

### B. Assessment — one pass, graded against a key

**Status:** built (on-screen quizzes, four item types).

This is the category most likely to be mistaken for "more sections." Most
additions here are **new input transports for the same graded attempt**, not new
kinds of learning.

#### Scantron exams — a transport, not a category

[`_extensions/scantron-relay/`](../../_extensions/scantron-relay/) is protocol-solved
on hardware: a Chatsworth OMR-1100 at 9600 7E1 streaming mark positions over
RS-232 → ATOM Lite → WebSocket. Firmware and backend dispatch remain unbuilt
(`docs/_wip/plans/2026-07-21-scantron-relay-bringup.md`).

The reader is read-only. It reports *which positions were marked* and nothing
else. All scoring is ours, which means **the answer key is already where it needs
to be** — in a `data/content/quizzes/*.yml` bank. Paper is then a second way to
answer an existing bank:

```
on-screen answers ─┐
                   ├─▶ SchoolService grading ─▶ attempt log (attributedTo)
scanned positions ─┘
```

Consequences worth deciding early:

1. **Position→item mapping lives with the form, not the reader.** A printed form
   is a rendering of a bank plus a mark-position map; the same artifact drives
   both printing and decoding. One generator, one map.
2. **Attribution on paper is not the soft tap.** The sheet must carry an identity
   field (a name bubble grid, or a barcode read by the existing
   [`barcode-relay`](../reference/hardware/) rig). Absent that, a scanned card is
   a guest card and records nothing, per the guest rule.
3. **Forms are 3-1/4" wide.** Standard Scantron forms do not fit. We print our
   own, likely as a perforated answer strip on an 8-1/2 × 11 sheet.
4. **Which optical variant we have blocks form design** (Infra Red vs. Visible
   Red dropout ink). Unresolved; see the relay README.

Value: an exam a child takes with pencil at the table, away from a screen, that
still lands in the same attributable record. That is a real pedagogical want,
not a novelty.

#### Other assessment work

- **Oral quizzes.** `IAIGateway.transcribe()` already exists. A spoken answer
  transcribed and matched against the same conservative short-answer rules.
  Worth noting: transcription error becomes grading error, so this likely needs
  a confirm-what-I-heard step rather than blind submission.
- **AI-generated item banks** from an existing material (see §4).
- **Written-response grading** — the hardest item type, and the one most likely
  to be wrong. Treat as tutoring-layer feedback rather than a score, at least
  initially.

---

### C. Fluency drill — repeat to mastery

**Status:** flashcards built; typing tutor specced; everything else unbuilt.
This is the largest genuinely-empty category, and where **multiplication tables
and math drills** land.

A drill is not a small quiz. Its evidence is a **curve, not a score**: how fast
and how accurately a specific fact is recalled, tracked per fact over time. A
score of 100% on multiplication is uninformative; "7×8 takes 4.2 s and 6×9 takes
0.9 s" is the whole point.

Candidates:

| Drill | Axis | Content source | Notes |
|---|---|---|---|
| **Multiplication / division tables** | code | Generated | The canonical case. Per-fact mastery, not per-session score |
| **Arithmetic drills** (add/sub, fractions, decimals, percents) | code | Generated with difficulty parameters | Same engine, different generator |
| **Typing tutor** | code | Curriculum + arcade | Already specced, models `PianoSpaceInvaders`' pure-engine split |
| **Spelling / sight words** | content | Authored lists | Runs on flashcards today; audio prompt needs a little code |
| **Geography** (capitals, map regions) | content + code | Authored bank | Capitals are content now; map-click is a new item type |
| **Vocabulary / foreign language** | content | Authored bank | Spaced repetition is the natural scheduler here |
| **SAT/ACT vocabulary and math facts** | content | Authored bank | See §5A — drills are the cheap half of test prep |
| **Music theory** (note reading, intervals) | code | Generated | Overlaps Piano; shared engine candidate, separate section |

#### The structural decision this category forces

Today a bank is an authored YAML file of items. A multiplication drill has no
items — it has a **generator** and a parameter space. Deciding how generated
content enters the bank format is the single most consequential unbuilt decision
in School:

- A `generator:` bank kind alongside authored banks, producing items on demand
  from a seed, so grading, sessions, and the attempt log stay unchanged.
- Or a separate drill subsystem with its own record type.

The first keeps one grading path and one evidence store, and it is what the rest
of this roadmap assumes. It does require that an attempt record can identify
*which generated fact* was asked (`7×8`), or per-fact mastery is unrecoverable
from the log — and rollups are derived, never stored, so the log has to carry it.

#### Scheduling

Spaced repetition (SM-2 / Leitner) is the obvious scheduler for C, and it is
deliberately absent from today's flashcards, which resurface within a single
drill only. Cross-session scheduling means persistent per-fact state — the first
thing in School that is neither an append-only event nor derived from one.
Recommend deriving the schedule from the attempt log rather than storing a
scheduler state file, keeping convention 2 intact even if it costs a fold.

---

### D. Composition — the child produces an artifact

**Status:** writing specced, unbuilt.
**Spec:** [`2026-07-21-school-writing-assignments-design.md`](../superpowers/specs/2026-07-21-school-writing-assignments-design.md)

Creative writing on TipTap, light rich text, no spell check, Bluetooth keyboard.
Drafts are the one mutable store; the submission is the event.

Extensions in the same shape:

- **Book reports** [content + a rubric]. The natural pair to the reading
  programme in §5C: a structured composition against a prompt, with the prompt
  and rubric authored per book or per form (summary, character, argument). Needs
  one code piece the writing spec does not have — an assignment prompt attached
  to a submission — and then scales as content.
- **Journaling / narration** — Charlotte-Mason style oral or written retelling
  after a course unit, which pairs with A as an alternative comprehension gate to
  a quiz.
- **Recorded oral narration** — `modules/VoiceCapture/` is the shared module;
  do not add a third MediaRecorder.
- **Drawing / handwriting practice** on the Portal touchscreen. Touch-only panel,
  so this is one of the few things the hardware is *better* at than a laptop.
- **Composer mode** — kid notation editor, already specced under Piano
  (`docs/reference/piano/composer.md`). Cross-listed here because it is a
  composition artifact; it should stay in Piano and appear in School as a
  material source if at all.

---

### E. Exploration — manipulate a model

**Status:** unbuilt, undesigned. This is the "brilliant.org clone" bucket.

The defining property: **there is no key.** The learning happens in manipulating
a model and noticing what it does. Evidence is engagement and session traces, and
attempting to score it would misrepresent what happened.

Realistic candidates, cheapest first:

- **Number-line, fraction, and place-value manipulatives** — small, self-contained,
  high value for the age range.
- **Geometry sandbox** — construct, measure, drag.
- **Logic and lateral puzzles** — nonograms, knights-and-knaves, sequences.
- **Physics toys** — pendulum, projectile, circuits.
- **Probability simulators** — dice, spinners, sampling distributions.

**Be clear-eyed about the economics.** Brilliant's value is hundreds of hand-built
interactives; each is bespoke frontend work with no content pipeline behind it.
Building a *platform* for these is the trap — the platform is generic React and
we already have it. The recommendation is: pick a handful of manipulatives that
serve a concrete curricular need, build them as ordinary components under a
single `explore/` section, and never promise a library.

**One exception, and it is a big one.** §5D (civic and practical literacy) is
built almost entirely from this category, and its models are *parameterized* —
a supply/demand curve with a tax wedge, a bracket calculator, a sampling
simulator. Each is code once and content thereafter, which breaks the
one-off economics above. If exploration gets built, that is the reason, and those
are the models to build.

---

### F. Puzzle — solve a bounded artifact

**Status:** unbuilt. The home grid already reserves a **Games** built-in for
"when their sub-projects land" (`home/sections.js`), so this category has a
name waiting for it.

Sudoku and crosswords are their own evidence shape, distinct from the five above:
there **is** a correct answer (unlike E), but it is one artifact solved over a
sitting rather than N items answered in sequence (unlike B), and it is
**self-verifying** — the grid tells you, nothing is submitted for grading.
Evidence is completion, elapsed time, and hints used.

First, a distinction worth holding: **these are not the arcade.** The emulator
console is entertainment, credit-gated, and lives outside School. A School puzzle
is curricular. If the coin economy ever connects the two, puzzles sit on the
*earn* side and the arcade on the *spend* side, which is a coherent story rather
than a coincidence.

#### The good trick: a puzzle is a presentation mode

School's existing bank design already separates the two concerns: *`type`
describes how an item is graded; mode describes how it is presented — so one bank
serves both a quiz and a flashcard drill without duplicating content.*

**A crossword is a third mode over that same bank.** A vocabulary bank's
definitions are already clues; a short-answer item is already an answer with a
letter count. Which means the expensive part of a crossword — the content — is
content we would author anyway, and the puzzle becomes a way to make an existing
bank *fun on a second pass* rather than a parallel content backlog.

That reframing decides which puzzles are worth building:

| Puzzle | Axis | Draws from | Notes |
|---|---|---|---|
| **Crossword** | code + reuse | Any vocab/definition bank | The high-value one. Grid-fill engine is the work; clues come free from banks |
| **KenKen / mathdoku** | code | Generated arithmetic | Arithmetic drill in a puzzle wrapper; shares C's generator |
| **Sudoku** | code | Generated, no bank | Pure logic, zero content cost, well-understood generator + difficulty grading |
| **Logic grid** (knights-and-knaves, Einstein) | code + content | Authored scenarios | Genuinely teaches deduction; scenarios are cheap to author |
| **Cryptogram** | code + reuse | Any quote/scripture source | Trivial engine; doubles as a ciphers-and-encoding lesson |
| **Word search** | code + reuse | Any word list | Nearly free once a word list exists, but the weakest pedagogy here — do not lead with it |
| **Anagrams / word ladders** | code + reuse | Spelling lists | Pairs with the spelling drill |
| **Nonogram / tangram** | code | Generated | Spatial reasoning; no curricular tie-in |

Recommended shape: **build one grid engine and one generator interface**, then
sudoku and KenKen are two configs of the same thing and crossword is the one that
needs real work. Resist a puzzle-per-component sprawl, which is §3E's trap
wearing a different hat.

Two rules this category inherits:

- **Ungated**, like everything except sequential courses.
- **Puzzle completions are not merged with quiz scores.** Same reasoning that
  keeps flashcard tallies separate from quiz tallies: finishing a crossword built
  from a vocab bank is not evidence you know the vocabulary cold, and a parent
  reading a mastery number should not have it diluted by puzzle completions.

Puzzles are also the category that **most wants print** (§4) — a crossword or
sudoku on paper at the kitchen table is arguably better than on the Portal.

---

## 4. The four cross-cutting layers

### Tutoring — AI-assisted help on wrong answers

**Port:** [`IAIGateway`](../../backend/src/3_applications/common/ports/IAIGateway.mjs)
(`chat`, `chatWithJson`, `chatWithImage`, `transcribe`, `embed`).

This is not a section. It attaches to categories B and C at the moment an answer
is wrong, and it is the highest-leverage unbuilt item in the whole module: it
converts a wrong answer from a deduction into a teaching moment, without a parent
present.

Uses, roughly in order of value per unit of effort:

1. **Explain the miss.** Given item, correct answer, and what the child chose,
   produce an age-appropriate explanation. `chatWithJson` for a structured
   `{explanation, hint, misconception}`.
2. **Hint ladder before reveal.** Progressive hints on a resurfaced drill item,
   so the child recovers the answer instead of reading it.
3. **Misconception diagnosis across attempts.** Fold the attempt log for a child
   and name the *pattern* ("borrows incorrectly across a zero"). This is a parent
   -facing output as much as a child-facing one.
4. **Item and distractor generation** from a material, to seed banks for A's
   comprehension gates. Human review before a generated bank counts for anything.
5. **Socratic follow-up** on a written submission — feedback, explicitly not a
   grade.

Design constraints this layer must respect:

- **Server-side, like grading.** One source of logic; the frontend never calls a
  model directly.
- **Latency is a UX problem on a kiosk.** A child staring at a spinner after
  getting something wrong is worse than no explanation. Pre-generate explanations
  for authored banks at author time where possible; reserve live calls for
  generated content.
- **Failures are never silent** (convention 6). An unavailable gateway shows as
  "no help available", never as a hang or a blank.
- **A guest produces no records**, so a guest gets help and leaves no trace.
- **Cost and rate.** A drill can produce dozens of wrong answers per sitting.
  Caching by (item, chosen answer) makes most of them free.

### Content pipeline — turning sources into material

**Status:** undesigned. Probably the highest-leverage unbuilt thing in the module,
because it is what makes the content axis (§2b) tractable at all.

Hand-authoring a bank per lecture, per chapter, per book does not scale past a
few dozen units. A pipeline does: ingest a source document, segment it into
units, and draft materials and question banks from each unit for human review.

```
textbook PDF / EPUB ─▶ extract + segment ─▶ units ─▶ draft bank per unit ─▶ REVIEW ─▶ data/content/quizzes/*.yml
                                             └─────▶ reference material ──▶ materials framework
```

Sources worth ingesting, cheapest first:

- **Textbooks** (PDF/EPUB) — chapter and section structure is usually recoverable
  from the outline; each section becomes a reference unit plus a bank.
- **Public-domain and open textbooks** — CK-12, OpenStax, Gutenberg. No licensing
  question, well-structured, and covers most of history/chemistry/biology at the
  level needed.
- **Course transcripts** — a Great Courses lecture's transcript is the material
  the comprehension gate should be drawn from, which closes the loop on A.
- **Books the child actually read** — for the reading programme in §5C.

Design constraints:

- **Review is not optional.** A generated bank is a draft. Nothing generated
  counts toward a record until a human accepts it, because a wrong key is worse
  than a missing quiz — it teaches the wrong fact and then penalizes the right one.
- **This is an authoring-time pipeline, not a runtime one.** It writes YAML files
  into the existing bank format and then gets out of the way. The runners never
  learn that a bank was generated.
- **Provenance belongs in the bank.** Which source, which page or timestamp,
  which model, when, reviewed by whom. That is what makes a bad item traceable
  back to its cause instead of merely deleted.
- **`chatWithImage` matters here.** Diagrams, chemical structures, and maps are
  where textbook material actually lives, and text extraction drops them.
- It is a **CLI or admin-side tool**, not a Portal surface. No child ever sees it.

### Print — PDF generation for paper output

**Status:** unbuilt for School, but the pattern exists and works.

Printing is what lets School leave the Portal. A screen-only homeschool app can
only teach a child sitting at the panel; a worksheet works at the kitchen table,
in the car, and at a table with a pencil and no glowing rectangle. For several
categories that is not a downgrade — it is the better medium.

#### It is a prerequisite, not a nicety

The scantron section (§3B) already states that **one artifact must drive both
printing and decoding**: a form is a rendering of a bank plus a mark-position
map. That generator *is* this layer. Scantron cannot ship without it, which moves
print earlier in the sequence than its modest size suggests.

#### What wants printing

| Output | Source | Notes |
|---|---|---|
| **Scantron answer forms** | Bank + position map | Hard dependency for §3B. 3-1/4" strip, possibly perforated off a letter sheet |
| **Worksheets** | C's generators | A multiplication generator that can print is worth several times one that cannot |
| **Puzzles** | §3F | Crossword and sudoku are arguably paper-first |
| **Paper quizzes and practice tests** | Bank | Timed full-length practice for §5A |
| **Flashcards** | Bank | Physical cards, cut lines, double-sided |
| **Writing prompts and rubrics** | §3D / §5C | Book report templates |
| **Progress reports, transcripts, portfolio** | Attempt log | Parent layer; the compliance-shaped output some jurisdictions want |
| **Certificates** | Any completion | Cheap, and children care about them more than adults expect |

#### Build on what is already there

`backend/src/4_api/v1/routers/catalog.mjs` already produces multi-page letter
PDFs with `pdfkit` + `svg-to-pdfkit`, embedding SVG as native vector content.
Both dependencies are in `package.json`. Two things to carry over from it:

- **Never rasterize.** SVG goes in as vector. This is a standing rule, not a
  preference for this feature.
- **Its documented gotcha:** `svg-to-pdfkit` cannot handle SVG-nested-in-SVG, so
  embedded SVG images get converted to PNG first. A worksheet with diagrams will
  hit this.

One layering note: catalog.mjs assembles its PDF **inside the router**, which is
the wrong layer under the DDD conventions. A School print service belongs in
`backend/src/1_rendering/school/`, following the renderer-plus-theme pattern the
other renderers use (`fitness/`, `gratitude/`, `nutribot/` all pair a
`*Renderer.mjs` with a `*Theme.mjs`). Extracting catalog.mjs's PDF assembly into a
shared `1_rendering/pdf/` helper is the natural first step, and it pays down
existing debt rather than adding more.

#### Design notes

- **Render from SVG, not from a canvas.** The existing `1_rendering` renderers are
  canvas-based because their targets are raster (e-ink panels, thermal receipts).
  Paper is vector; text must stay selectable and lines must stay crisp at print
  resolution.
- **Print is a rendering of the same artifact, never a second authoring path.**
  A printed quiz and an on-screen quiz come from one bank. The moment a worksheet
  has content that exists nowhere else, the record stops being complete.
- **Deterministic seeds.** A generated worksheet must be reproducible, or the
  printed sheet and its answer key can drift apart. Print the seed on the page.
- **Answer keys are a separate document**, generated alongside and not stapled to
  the child's copy.
- **Getting paper back into the record** is the open half. Scantron solves it for
  bubble answers; a handwritten worksheet needs either parent entry or
  `chatWithImage` on a photo of it. The second is speculative and should not be
  assumed.

### Parent layer — assignment, review, sign-off

**Status:** undesigned. Today's storage makes reassignment *possible*; nothing
performs it.

- **Reassignment UI** — the named gap in the reference doc. Every record is an
  individually attributable event precisely so this can exist.
- **Assignment / curriculum** — what a child is expected to do today, as opposed
  to what is available. Nothing in School currently expresses expectation.
- **Mastery dashboard** — derived from the attempt log; the natural consumer of
  C's fluency curves and the tutoring layer's misconception folds.
- **Sign-off and transcript** — a durable record for a homeschool portfolio,
  including the compliance-shaped output some jurisdictions require.
- **Print** — reports, transcripts, and portfolio output. See the print layer
  above; the parent layer is one of its consumers, not its owner.

---

## 5. Verticals — programmes that compose the categories

The categories in §3 are horizontal: kinds of interaction. What a parent actually
asks for is usually vertical: "AP Biology," "get ready for the SAT," "a reading
programme." A vertical is a **curriculum stack over existing categories**, and it
is mostly content once its categories are built.

Naming them separately keeps the section grid honest. A vertical is not a sixth
category; it is a shelf of material that happens to span five of them.

### A. Exam preparation — SAT / ACT / AP

| Piece | Category | Axis |
|---|---|---|
| Content review by topic | A (consumption) | content |
| Practice sections, timed | B (assessment) | content + code |
| Vocabulary and math-fact fluency | C (drill) | content |
| Full practice tests on paper | B via print + scantron | content + code |
| Score history and readiness | Parent layer | code |

Most of this is content against runners that already exist or are already
specced. The code that test prep specifically needs, and that nothing else in
School wants:

- **Timed sections.** A countdown that ends the section is a real behavioral
  change to the quiz runner, which today is untimed and one-pass.
- **Scaled scoring.** A raw count is not an SAT score. Section scaling and
  composite calculation is small, self-contained domain logic.
- **Review mode after a pass.** Test prep's value is in reviewing what was missed,
  and a quiz is one pass by design. Reviewing a completed attempt is reading the
  attempt log, not resurfacing the items, so this fits the existing rule.

Scantron is a strong fit here specifically: a full-length paper practice test
under timed conditions is closer to the real thing than a screen, and it is the
clearest justification for building the relay.

**AP** differs from SAT/ACT in that it is a *course* first — a year of material
with an exam attached — so it leans much harder on A and the content pipeline,
and it is the best early customer for textbook ingestion.

### B. Subject sequences — history, chemistry, biology, …

A subject is a sequence of units, each with material and a comprehension gate.
Once the materials framework and the content pipeline exist, a subject is almost
purely content: ingest an open textbook, review the drafted units and banks, order
them, publish.

Subject-specific code, where it exists, is mostly **exploration** (§3E) —
molecule viewers, cell diagrams, timelines, phase-change simulations. Treat those
as optional enrichment on top of a working sequence, not as prerequisites. A
biology sequence that is text and quizzes is a real biology sequence; one that is
three beautiful simulations and no units is not.

The economics argument from §3E applies with force here: it is tempting to start
a chemistry vertical by building an interactive periodic table. Start by ingesting
a chemistry textbook.

### C. Reading programme — Accelerated Reader clone

The clearest vertical, and one that composes pieces that already exist or are
already planned:

1. A child reads a book (physical, or A's PDF/EPUB renderer).
2. Takes a comprehension quiz on it — B, one pass, unchanged.
3. Optionally writes a book report — D, against a rubric.
4. Earns points scaled to book length and quiz score.

What AR actually sells is the **quiz library**, which is exactly the content
pipeline's job (§4): a bank per book, drafted from the text and reviewed. The
mechanics on our side are close to free.

Two things to decide:

- **Points.** The household already has a coin economy (earn on one side, spend on
  another). Reading points are a natural earner, and wiring them there is more
  coherent than inventing a second School-only currency. That said, it makes
  reading extrinsically motivated by design, which is a parenting decision rather
  than an engineering one — flag it, do not assume it.
- **Book identity.** Matching a physical book to its bank wants ISBN lookup, and
  the household already has a barcode rig that reads ISBNs off the back cover.

### D. Civic and practical literacy — the things school skips

A curriculum aimed at what an adult needs to follow public argument and run their
own affairs, which conventional schooling covers badly or not at all:

| Strand | Shape |
|---|---|
| **Civics and government** | How a bill actually moves, federalism, courts, what each office can and cannot do |
| **Voting and elections** | Registration, ballot mechanics, primaries, districting, why turnout math matters |
| **Taxes** | Brackets and marginal vs. effective rates, withholding, deductions, filing, payroll tax |
| **Personal finance** | Compound interest, debt, credit, insurance, opportunity cost |
| **Statistics and data literacy** | Sampling, base rates, correlation vs. cause, margin of error, how charts mislead |
| **Economics** | Supply and demand, incentives, trade-offs, inflation, comparative advantage |
| **Rhetoric and argument** | Claim vs. evidence, common fallacies, steelmanning, source evaluation |

**This is the vertical where exploration (§3E) is the core, not enrichment** —
the opposite of §5B's advice, and worth stating plainly. These topics are about
*relationships between variables*, and a manipulable model teaches them in a way
prose cannot:

- A **supply/demand curve** you drag, with a price floor or a tax wedge to drop in
  and watch the deadweight loss appear.
- A **tax bracket calculator** where you move income and watch marginal and
  effective rates diverge, which kills the "a raise pushed me into a higher
  bracket" misconception in about ten seconds.
- A **compound interest** slider over decades.
- A **sampling simulator** — draw from a population repeatedly and see the
  distribution of sample means, which is the whole of margin-of-error intuition.
- A **districting sandbox** — redraw boundaries on a fixed population and watch
  seat counts swing.
- A **misleading-chart gallery** — the same data plotted honestly and dishonestly,
  side by side, with the axis under your control.

Each is a parameterized model, so each is code once and content thereafter: a
different scenario is a config, not a new component. That makes this vertical
much cheaper than §3E's economics warning implies, and it is the strongest reason
to build E at all.

**Neutrality is a design constraint, not a disclaimer.** The goal is a child
equipped to reason about political claims, which means teaching mechanics and
tools rather than conclusions:

- Teach *how a tax bracket works*, not what rates should be. Teach *how a
  district is drawn*, not which map is fair.
- Where a question is genuinely contested, present the strongest version of more
  than one position and say plainly that it is contested. Do not resolve it.
- This constrains the **tutoring layer** hardest. A model asked to explain a
  wrong answer on a policy question will editorialize unless told not to. These
  banks need their own system prompt, and their generated content needs stricter
  review than a chemistry bank does.
- Prefer items with checkable answers (mechanics, arithmetic, definitions,
  identifying a fallacy) over items grading a stance. If an item cannot be
  graded without taking a side, it is a discussion prompt, not a quiz item — put
  it in D as writing.

Sequencing note: statistics, taxes, and personal finance are the strands with
unambiguous right answers and immediate practical payoff. Start there; they are
also the ones the exploration models serve best.

---

## 6. Suggested sequence

Ordered by dependency and by value per unit of work, not by appeal.

**Now — finish what is specced.**
Materials framework (A) unblocks courses, listening, and reference in one go, and
it is the section grid's main gap. Writing (D) and typing (C) are specced and
independent.

**Next — the generator decision (C).**
Multiplication and arithmetic drills are the most-wanted unbuilt thing and the
cheapest to build *once the generated-bank question is settled*. Settle it before
writing a drill, or the second drill will not fit the first drill's storage.

**Then — the tutoring layer (§4).**
Highest leverage, and it improves everything already built rather than adding a
tile. Start with explain-the-miss on authored banks, pre-generated.

**Then — the content pipeline (§4).**
Once A can present material and B can test it, the binding constraint stops being
code and becomes hours of authoring. The pipeline is what lifts that, and every
vertical in §5 is waiting behind it. It also shares most of its machinery with the
tutoring layer, so building it second is cheaper than building it first.

**Then — the first vertical, end to end.**
Pick one and take it all the way through rather than starting four. The reading
programme (§5C) is the best candidate: it exercises A, B, D, and the pipeline, and
it produces something visibly working for a child within a week of content work.
Civic literacy (§5D) is the best *second*, because it justifies exploration.

**Then — the print layer (§4).**
Small, and it multiplies things already built: drills gain worksheets, banks gain
paper quizzes, puzzles gain the medium they are best in. It is also a hard
prerequisite for scantron, so it cannot come after it. Start by extracting
catalog.mjs's PDF assembly into `1_rendering/`.

**Then — scantron (B).**
Firmware plus backend dispatch plus form generation plus paper attribution. Four
pieces, and the optical-variant question still blocks form design. High delight,
non-trivial cost; sequence it after the software wins and after print exists.
Test prep (§5A) is its strongest customer, so the two pair naturally.

**Puzzles (F) fit wherever they are wanted.**
Sudoku is a weekend and depends on nothing. Crossword is the one worth planning,
because its value comes from reading existing banks — so it is best built *after*
there are banks worth reading, and it makes every vocabulary bank pay twice.

**Later — parent layer, then exploration.**
The parent layer becomes worth building when there is enough evidence to review,
which is after C and the first vertical land. Exploration (E) is last as a general
capability — but note §5D inverts this: if the civic-literacy vertical is the
priority, its parameterized models come with it and E arrives early.

**A recurring check.** Before any new section, ask the §2b question: is this a
content gap in a runner we already have? Most of §5 is. The module gets more
valuable per hour by filling existing runners than by adding tiles.

---

## 7. Open questions

1. **Generated banks:** a new bank kind, or a separate drill subsystem? (§3C)
2. **Per-fact mastery in an append-only log:** does an attempt record carry the
   generated fact identity, and is a spaced-repetition schedule derived or stored?
3. **Paper attribution:** name bubbles or barcode? (§3B)
4. **OMR-1100 optical variant** — Infra Red or Visible Red? Blocks form design.
5. **Where AI output lives:** is a generated explanation part of the attempt
   record, a cache keyed by (item, answer), or transient?
6. **Assignment model:** does School gain a notion of "expected today", and if so
   does it stay ungated (convention: no second gate)?
7. **Section grid growth:** at what count does a flat grid stop working, and does
   a category level appear above it? Verticals (§5) are the likely answer — a
   grid of subjects above a grid of activities — but that is a real navigation
   redesign, not a tile.
8. **Generated-bank review workflow:** where does a draft bank live before it is
   accepted, and what marks it reviewed? (§4 content pipeline)
9. **Textbook licensing:** which sources are we willing to ingest? Open textbooks
   sidestep the question entirely and probably cover most of §5B.
10. **Reading points and the coin economy:** does School earn into the household
    ledger, and is extrinsic reward for reading wanted at all? (§5C)
11. **Timed sections:** does the quiz runner grow a timer, or is timed testing a
    separate runner? (§5A)
12. **Neutrality enforcement:** do civic-literacy banks get their own system
    prompt and review bar, and who signs off? (§5D)
13. **Puzzle evidence:** is a completion an attempt-log event like everything
    else, and does a crossword built from a bank record anything against the
    items it drew from? (§3F — the recommendation is no)
14. **Crossword clue source:** can an arbitrary bank be used as-is, or do banks
    need optional puzzle metadata (clue text distinct from question text, answer
    length, no-spaces variants)?
15. **Print delivery:** does a PDF download to a parent's device, or does School
    print directly to a household printer? The second is more useful on a
    touch-only panel and more work.
16. **Handwritten work back into the record:** parent entry, scantron only, or
    `chatWithImage` on a photo? (§4 print)
