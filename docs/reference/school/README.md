# School — reference index

> **Repository status:** the learner surface, curriculum/session lifecycle,
> assignments and whole-course enrollment, timed planning, agenda printing,
> quizzes and OMR, teacher console, feedback, repair, reporting, program
> integration, and Sentence Ladder are implemented on `main`.
>
> **Deployment status is separate.** A commit or push does not prove that a
> particular host is running it. Household content rollout and learner
> enrollment are also separate from runtime support. Check those explicitly in
> operations rather than inferring them from this page.
>
> **Not built:** syllabus-authoring UI, module-subset enrollment, per-learner
> pass bars, per-enrollment report-card rows, writing/composition delivery, and
> typing tutor, general PDF/EPUB reading.
>
> **Requirements (the whole programme):** [`docs/superpowers/specs/2026-07-21-portal-homeschool-requirements.md`](../../superpowers/specs/2026-07-21-portal-homeschool-requirements.md)
>
> **Roadmap (candidate future work, categorized):** [`docs/roadmap/2026-07-21-school-module-roadmap.md`](../../roadmap/2026-07-21-school-module-roadmap.md)
>
> **Enrollment and syllabi (whole-course path built):**
> [`enrollment.md`](./enrollment.md) — `school.course-enrollment/v2` exists and
> the planner and issue path honor it fully. `EnrollLearner`/`UnenrollLearner`
> now materialize/remove enrollments from a saved *syllabus* — a reusable set
> of arguments to `createCourseEnrollment` — through the whole-school matrix
> and its drawer, behind `teacherGate`. There is still no console UI for
> *authoring* a syllabus (`putSyllabus`/`archiveSyllabus` exist in the client
> with no caller), so a syllabus must be written by hand or via API before the
> drawer has anything to enroll from. Scope subsetting and the per-learner pass
> bar remain designed, not built.

> **Time-sensitive planning (runtime core built):**
> [`timing-and-priority.md`](./timing-and-priority.md) — household-owned event
> anchors, materialized enrollment timing, automatic deadline urgency, and
> temporary cross-subject focus days. Anchor/template editing remains
> hand-authored/API-driven. It deliberately separates availability, targets,
> scheduling priority, and durable learning evidence.
>
> **Cross-surface educational-technology audit:** [`edtech-research-audit.md`](./edtech-research-audit.md)
>
> **Formative learner/three-calculator pilot:** [`school-learning-pilot-protocol.md`](./school-learning-pilot-protocol.md)
>
## Start here

| Question | Canonical reference |
| --- | --- |
| What belongs in a learner's plan? | [Planning](./planning.md) |
| How do syllabi and frozen enrollments work? | [Enrollment](./enrollment.md) |
| How do dates, urgency, and catch-up work? | [Timing and priority](./timing-and-priority.md) |
| How does today's paper and completion gate work? | [Agenda and completion](./agenda-and-completion.md) |
| How are attempts graded and notes delivered? | [Assessment and feedback](./assessment-and-feedback.md) |
| What do progress, course grade, and status mean? | [Progress and reporting](./progress-and-reporting.md) |
| How do I inspect or repair live state? | [Operations](./operations.md) |
| How do external programs plug in? | [Programs](./programs.md) |
| How can a School course execute in Fitness and return evidence? | [School-owned Fitness courses](../fitness/school-course-contract.md) |
| How does the sentence sequence work? | [Sentence Ladder](./sentence-ladder.md) |
| What happens when content or a collaborator is missing? | [Failure policy](./failure-policy.md) |

The remainder of this file is the detailed subsystem inventory. The focused
pages above are authoritative for lifecycle vocabulary and current behavior;
historical wave narratives below are retained only when they explain an
existing constraint.

---

## Household data taxonomy

`data/content/school/` is the authored curriculum. Household-specific School
data has a separate, mutually exclusive layout under `data/household/school/`:

| Root | Holds | Does not hold |
|---|---|---|
| `school.yml` | Household policy, roster, levels, and device policy | Per-learner work or generated data |
| `plans/` | Reusable syllabi, academic periods, milestones, pass overrides, and each learner’s active course enrollments or standalone work | Today’s agenda or a worksheet |
| `runtime/` | Revocable tokens, pending queues, live review work, and resumable remediation | Issued work or long-term evidence |
| `records/` | Plan revisions, work sessions, issued worksheets, assessment scans, print events, attestations, notes, enrichment, and reassignments | Active/revocable runtime state |
| `artifacts/` | Generated documents, physical-card records, form maps, captures, and calculator files | Authored curriculum |

A course enrollment is one record inside a learner plan. An agenda is derived
from that plan; choosing an agenda item opens a work session; issuing paper
creates a worksheet record and a print artifact. Those are distinct records,
not successive names for an “assignment.”

### Worksheet read-along

An issued worksheet can include a second, six-digit **Read Along** panel code
in its lesson card. It opens a generic ordered read-along playlist, so the
same interaction can support scripture, audiobooks, or other narrated
material. Handler-owned state lives in `records/companions/`, separately from the
immutable worksheet and its OMR result. Each offering owns its participation
policy: it can record opened, position, and completed parts for informational
use or make that evidence part of a configured completion rule. It never
changes an OMR score.

The offering-level shape is deliberately small:

```yaml
companion:
  enabled: true
  participation: optional # optional | required
  handler: readalong # e.g. readalong, singalong, player, program, surface
  label: Read along # printed/action wording for this companion
```

Handlers own the action: they may mount a local renderer, open a player, print,
dispatch to a surface, or emit an application event. Progress is optional and
implemented only by handlers that have meaningful progress to record.

Time-sensitive work follows the same boundary: a syllabus may offer defaults,
but an enrollment or standalone-work plan owns the resolved household dates and
priority. See [Time-sensitive School planning](./timing-and-priority.md).

A dated course, such as Come Follow Me, follows the calendar rather than a
learner's oldest unfinished lesson. This week's module comes first; missed
weeks remain available as catch-up (newest first) and never block a future
week. Future modules cannot be opened early.

---

## 1. What School is

The Portal — a repurposed Facebook Portal panel, touch-only, running FullyKiosk
— **is** the school device, the way the living-room screen is the TV. Its
screen renders the School app as its whole surface rather than a menu
containing a School entry.

A child claims a profile, works through material, and that work is recorded
against them. The household **is** the school: the roster is the full household
membership from `data/users/{id}/profile.yml`, not a separate list.

---

## 2. Implemented subsystem inventory

### Identity

A **soft, self-declared tap** — no PIN, no authentication. A child taps their
face to claim the device; identity is visible in the chrome and lapses after 10
minutes idle. Guest is session-only and never persisted.

Deliberately soft because mis-attribution is **repairable** rather than
prevented: a parent can reallocate credit later. That is also why every record
below is an individually attributable event, not a rollup — a rolled-up counter
cannot be split or reassigned after the fact.

Shared identity elements live in `frontend/src/lib/identity/`, extracted out of
the Piano Kiosk. **A module is not an export surface for other modules:** School
never imports from `modules/Piano/`; both import from the shared home.

### Quizzes and flashcards

One canonical question-bank format. Banks live INSIDE their work:
`data/content/school/{subject}/{work}/quizzes/…​.yml`, and a bank id is the
path with the `quizzes/` container elided (`history/us-capitals/us-state-capitals`)
— see [authoring/content-layout.md](authoring/content-layout.md). `type`
describes how an item is **graded**; mode describes how it is **presented** —
so one bank serves both a quiz and a flashcard drill without duplicating
content.

Four item types: `multiple_choice`, `short_answer`, `cloze`, `matching`.

`school.question-bank/v2` is the authored-pool format for printable mastery
worksheets. A multiple-choice item stores one correct `answer`; a multi-select
item stores two or more correct `answers`. Both store incorrect options under
`decoys`, with 5–10 total answers and decoys per pool. A v2 item never authors
`choices`. At issuance the domain combines the fields, assigns bank-revision-scoped
option IDs, retains every correct option, and stores the exact visible subset,
order, A–E mapping, prompt, and source locator in an immutable issued snapshot.
Reprints reuse that snapshot; remediation may issue only missed item IDs with a
new subset/order. Grading therefore resolves against the issued snapshot, not
against mutable bank YAML. Existing v1 banks retain their original schema and
answer-key behavior.

- **Grading is server-side**, for single-source logic rather than secrecy.
  Banks ship with their answers because flashcards must reveal them; this is
  explicitly not a security boundary.
- **A quiz is one pass** — each item asked once, then a score. Resurfacing
  would converge every score to 100% and destroy the completion signal courses
  depend on. A multiple-choice answer takes two taps on the same tile: the
  first arms it and says "tap again"; the second submits. Choosing another
  tile moves the arm, so an accidental kiosk tap is never irreversible.
- **A flashcard drill resurfaces** missed cards until they are got. Drilling
  and assessment are different jobs. Its third lane, **Show me again
  (doesn't count)**, rotates the card to the back without recording an answer
  or changing first-try/cards-seen totals.
- Short-answer matching is deliberately conservative: trim, collapse
  whitespace, casefold, nothing more. "St. Paul" vs "St Paul" is an explicit
  `accept` entry's job, not a clever matcher's.
- **Matching is all-or-nothing**, checked as a true bijection — unique lefts
  covering exactly the item's lefts. (An earlier count-based check let one
  correct pair repeated N times grade as fully correct.)

### The attempt log

`data/users/{userId}/apps/school/attempts/{YYYY-MM-DD}.yml` — append-only,
date-sharded, mirroring the economy ledger. Every answer is one event carrying
`attributedTo`.

Rollups are **derived, never stored**. The log is the source of truth, so a
later reassignment moves the evidence and the statistics together.

Quiz and flashcard tallies are **never merged**: one is server-graded evidence,
the other a self-report.

A guest grades normally and records nothing.

### Mid-quiz resume (sittings)

A signed-in quiz survives a dropped tab or a server restart:
`data/users/{userId}/apps/school/sittings.yml` holds one entry per bank —
mode, start time, bank content-rev, and the answers banked so far. Opening the
same quiz again resumes where it left off (the runner shows a "picked up where
you left off" chip; re-answering an already-banked item is refused), and the
sitting is deleted the moment the last item is answered. A deliberate restart
("Try again") opens with `fresh: true`, which wipes the sitting first; the
timed-out-session card's "Start again" deliberately does NOT, so its "your
finished answers are saved" promise actually resumes the run.

### Failed-quiz adaptive tutor handoff

A failed Catalog quiz with authored `remediation:` policy and concept-tagged
bank items can immediately offer **Get tutor help**. `POST
/api/v1/school/sessions/:sessionId/remediation-offer` accepts only the learner
and session identities. The server owns the rest: it verifies session
ownership and completion, reads durable answers, uses the immutable bank
snapshot, re-resolves the exact Catalog lesson/module, refuses content-revision
drift, evaluates the authored trigger, and mints or reuses the durable adaptive
remediation session. Neither answers nor answer keys round-trip through the
browser. The School shell opens `AdaptiveTutorPanel` with the returned session
id; modules without remediation policy retain **Review this lesson** as the
honest fallback.

A sitting is a **convenience, not evidence** — the attempt log stays the sole
record. That asymmetry sets every edge rule: sittings are quiz-mode,
signed-in, screen-transport only (paper grading and calculator imports never
touch them); one older than 24h or from an edited bank (content-rev mismatch)
is ignored and replaced; so is one that isn't an ordered **prefix** of the
bank's items — `answers[i].itemId` must equal `bank.items[i].id` for every
`i`, or a gap left by a failed mid-run write would otherwise land the
index-based resume on an already-answered item and loop on the 400 refusal
until the 24h TTL finally clears it; a corrupt file reads as "no sittings" and
refuses writes until cleared; and every sitting write is best-effort — a store
failure warns (`school.sitting.write-failed`) and never fails the answer.

### Where it lives

| Layer | Path |
|---|---|
| Domain (pure) | `backend/src/2_domains/school/` — bank validation, grading, attempt factory |
| Persistence | `backend/src/1_adapters/persistence/yaml/YamlSchoolDatastore.mjs` |
| Persistence (sittings) | `backend/src/1_adapters/persistence/yaml/YamlSittingStore.mjs` |
| Application | `backend/src/3_applications/school/SchoolService.mjs` — sessions, guest rule, mode contract, results fold, sitting resume |
| API | `backend/src/4_api/v1/routers/school.mjs` → `/api/v1/school` |
| Frontend | `frontend/src/modules/School/` |
| Shared identity | `frontend/src/lib/identity/` |
| Screen | `data/household/screens/portal.yml` → `widget: school` |
| Config | `data/household/school/school.yml` |

Any screen's config YAML may carry an optional top-level `surfaceProfile: <surfaceId>` key naming which certified surface profile that screen presents as, resolved via `GET /api/v1/school/surfaces/profile?screen=<screenId>` (a bare `browser`/absent screen resolves the fixed `screen-browser` profile instead).

Sessions are **in memory by design**. A restart costs the rest of one sitting,
never a recorded attempt — those are already on disk.

**Design spec:** [`2026-07-21-school-identity-quiz-design.md`](../../superpowers/specs/2026-07-21-school-identity-quiz-design.md)

### The home shell

School's landing surface is the **subject wall**: nine fixed paired subjects —
English & Literature, Writing & Typing, Language & Culture, Math & Money,
Science & Nature, Life & Skills, History & Geography, Scripture & Gospel,
Arts & Culture — in a 3×3 grid on the left two-thirds, each tile carrying an
inline-SVG shelf icon (`home/icons/`, household SVG Repo set), and a
meta rail on the right third holding the **student panel** (identity, up-next
action, latest score, done-for-today flip; tap = the full progress board), the
**Library**, and **Print** (worksheets, see Printing below). One home serves
claimed and unclaimed visitors alike — the student panel is itself the claim
affordance; when nobody is claimed it shows the household's **kid faces**
(roster filtered to under-18) as one-tap claim targets rather than a picker
button.

Subjects are the top level; the second level inside each subject is instances
of **reusable content frameworks** — a custom sentence-ladder program, Plex
materials with quiz gates, quiz/flashcard banks — and one framework class can
appear under any subject. Shelving is config-driven via a `subject:` field on
materials sources (`school.yml`) and bank YAMLs (distinct from banks'
free-form `topics` tags); language courses shelve under Language
automatically. A source may carry `subject_overrides` (a `material-id →
subject` map) for a mixed-subject Plex collection — one root holding a money
show and a science show — so each show lands on its own shelf. Untagged and
`reference` content lands in the Library, whose Practice group holds untagged
banks. An empty shelf renders greyed, not hidden. A tile never points at an
absent endpoint.

**Deep links.** Under `/school` (or `/app/school`) the URL tracks the
navigation level: `…/subject/<id>`, `…/subject/<id>/material/<materialId>`,
`…/library`, `…/library/material/<materialId>`, `…/progress`, `…/practice`,
`…/lang/<courseId>`. Opening a material URL lands straight on its unit
browser; browser back/forward re-parse the URL. Mounted as the Portal screen
widget there is no `/school` URL, so deep-linking is inert (home is the root).

**Video course browser.** A material's units render FitnessShow-style —
poster + context on the left, a thumbnail unit grid on the right — not a flat
list. Units carry a proxied episode `thumb`; completed units show a check,
locked ones a lock overlay, in-progress ones a resume bar.

**Quizzes on demand.** A `course` unit with no authored quiz bank does NOT
auto-satisfy its gate: the child can watch it, but the next unit stays locked
("… is waiting for its quiz — request one to move on"). The current unit's
info panel then offers **Request a quiz** — a signed-in child taps once to add
the unit to the authoring backlog (`POST /quiz-requests`; household list at
`data/apps/school/quiz-requests.yml`). Guests see the explanation but cannot
request. Authoring a bank bound to that unit (`unit: plex:<key>`) restores the
normal watch-then-quiz gate immediately.

Back steps one navigation level: runner → shelf → home → exit. The exit
control only exists when School is mounted as an app; on the Portal, where
School is the screen, home is the root and no exit affordance renders.

**Design specs:** [`2026-07-22-school-nine-subjects-design.md`](../../superpowers/specs/2026-07-22-school-nine-subjects-design.md), [`2026-07-22-school-home-topics-redesign-design.md`](../../superpowers/specs/2026-07-22-school-home-topics-redesign-design.md), [`2026-07-22-school-materials-framework-design.md`](../../superpowers/specs/2026-07-22-school-materials-framework-design.md) §8

### The materials framework

Plex-backed material — video courses, audio plays, freestyle audiobooks — is
normalised into one model: a **material** with ordered **units**. Where content
lives is a *source* (`media-series` for collection→show→season→episode, `media-album`
for artist→album→track); how it behaves is a *category* (`course` sequenced,
quiz-gated, credited; `reference` free browse; `listening` records "finished",
earns nothing). Categories are a **closed set in code**; config only selects one
per source, and an unknown name fails closed to `reference` with a loud warning.

A quiz bank gains an optional `unit:` backlink to the Plex item it gates. Within
a sequential material, every unit after the first incomplete one is locked, and
a locked unit always names what to do (`Pass the quiz for “…” first`). A unit
with no bank has no gate — the escape hatch that lets quizzes be authored
incrementally. Completion is comprehension-based: `played` (≥ the configured
percent) AND the gate, derived fresh on every read from the progress store and
the attempt log — never stored as a flag, so reassignment keeps working.

Per-child playhead/percent lives at
`data/users/{id}/apps/school/material-progress.yml` via the shared progress
store (parameterised, Piano untouched); School reads raw playhead/percent only
and computes its own completion. The home grid grows one section per category
present in config; grid → detail → player, with the player wrapping the shared
Player from the consumer side and handing off to the quiz on unit end.

**Explicitly not built** (named deferrals, not gaps): the video forward-clamp
(the quiz gate is the enforcement; clamp is anti-skip UX), the readalong source
and readalong gate-step UI (banks may carry `readalong:` — validated and
preserved — but no configured content uses it; a gate runner meeting one treats
it as unsatisfied and warns), and coin/curriculum *consumption* of completion
(sub-projects 4 and 6 read what this framework records).

**Config:** `data/household/school/school.yml` `materials:` block — sources
(label, source, root, medium, category) plus `completion_threshold_percent` and
`quiz_pass_percent`. Boot-cached; config edits need a container restart.

### The program report interface

Every program answers the same four questions about a learner — **who has been
studying, how far along, how they are doing, what is next** — so the parent app
can build one board across all of them without knowing what any of them does.

A program implements `IProgramReporter`
(`3_applications/school/ports/IProgramReporter.mjs`): an `id`, a `label`, and
`summarize({ userId })` returning zero or more reports. It returns an ARRAY
because one program may run several courses for the same learner.

Metric kinds are a **closed set in code** (`2_domains/school/reporting.mjs`),
the same posture as `categories.mjs`: config selects from it, nothing invents a
new one. A program cannot emit a shape the parent has no renderer for, because
the shape does not exist. Adding a seventh kind is a code change in one file
plus one branch in `MetricTile` — deliberately not config.

| kind | payload | answers |
|---|---|---|
| `progress` | `value, total, unit` | how far along |
| `count` | `value, unit` | what you've done |
| `score` | `value` (0–1 ratio) | how well |
| `streak` | `value, unit` | consistency |
| `trend` | `points[{at,value}]` | direction |
| `duration` | `ms` | time spent |

A program emits whichever apply. A language course has a streak; a writing
assignment has a word count; **neither is obliged to pretend it has the other,
and `metrics: []` with `next: null` is a valid report.** Quizzes emit no `next`
precisely because nothing there assigns work — inventing one would put a
suggestion on the board indistinguishable from a real assignment.

Rules the contract holds to, each inherited from a decision School already made:

- **Derived on every read, never stored** — so a reassignment moves the
  evidence and the statistics together.
- **A blocked `next` always names the remedy.** A blocked step that omits one
  is surfaced *and* logged rather than dropped, because a silent lock is the
  real trap. This is the materials framework's quiz gate, generalised.
- **One failing program never blanks the board.** Each reporter is called in
  its own try; a malformed metric is dropped while its siblings survive.
- **A guest produces no report at all.**

Ordering answers "who needs attention" top-down: blocked, then active, then
idle, then not-started, then complete; most recently touched first within each.

| Layer | Path |
|---|---|
| Contract (pure) | `backend/src/2_domains/school/reporting.mjs` |
| Port | `backend/src/3_applications/school/ports/IProgramReporter.mjs` |
| Aggregate use case | `backend/src/3_applications/school/GetSchoolReport.mjs` |
| API | `GET /api/v1/school/report[?userId=]` |
| Frontend | `frontend/src/modules/School/report/` |

Registering a program means adding it to the `reporters` array in the
composition root. `GetSchoolReport` gains no branch.

### Cross-surface learning progress and curriculum history

The program report above summarizes heterogeneous programs. The complementary
learning-progress model derives auditable facts from append-only evidence
across every surface. Its curriculum vocabulary is structural and follows the
School nomenclature: **Catalog → Subject → Course → Unit → Lesson → Module**.
Math, geography, chemistry, finance, and other subject names remain data.

`aggregateLearningProgress` returns totals, facets, requested flat breakdowns,
recent scores, follow-up actions, and `curriculumHistory`. The latter is a
nested overview/detail read model. Each node has a stable path key, structural
kind and ID, direct evidence count, descendant roll-up, latest activity, and
children. Nodes are ordered by latest recorded activity and then stable ID.
Evidence with no curriculum path is retained in an explicit `unscoped`
summary, never dropped.

### Calculator-family progress is a projection, not a second School model

SchoolCalc is one optional surface of this same learning-progress capability.
The School application projects the selected calculator's eligible learners
into a bounded `SCG1` record; its TI-86 adapter renders the selected learner's
Catalog/Subject/Course/Unit/Lesson/Module evidence locally. It does not own
grading, progression, time semantics, or a subject-specific branch. QR and
cable arrivals return to the same School result-import/idempotency path.

**No calculator-family or wire-format vocabulary appears in domain or
application production code.** "TI-86", device-family names, and wire concepts
like write ordering belong in the adapter — `Ti86SchoolCalcCodec` and its
siblings — never in `2_domains/school/` or `3_applications/school/`. This is
enforced, not merely encouraged:
`tests/isolated/application/school/schoolcalcArchitecture.test.mjs` fails on any
such leak, alongside its checks that the School domain stays independent of
outer layers and that SchoolCalc use cases depend only on domains, ports, and
pure hashing. Feature work has drifted across this line before — a domain error
message and a wire-ordering concern both had to be moved back out — so treat a
failure of that test as a real boundary violation to relocate, not a test to
relax.

The adapter's 2026-08-03 owned-ROM MAME release gate exercises that projection
alongside Catalog browsing, a reader, local quiz scoring, durable result
queueing, and QR display. This is transport/client conformance evidence only;
it is not evidence of learning efficacy or physical relay readiness. The
reproducible harness is
[`_extensions/ti86-app/docs/emulator-testing.md`](../../../_extensions/ti86-app/docs/emulator-testing.md).

This tree is intentionally evidence-backed. Evidence for one lesson does not
prove that every authored lesson in its unit exists in the selected window, so
the tree does not invent parent completion, mastery, coverage, or “not
started.” Those claims require a separately supplied authored curriculum
outline. The application/API expose this same neutral contract to web, kiosk,
classroom/household roll-ups, and device adapters; a calculator codec may only
bound and format it.

| Layer | Path |
|---|---|
| Evidence/history model (pure) | `backend/src/2_domains/school/progress/learningProgress.mjs` |
| Aggregate use case | `backend/src/3_applications/school/GetLearningProgress.mjs` |
| API | `GET /api/v1/school/progress` |
| Frontend overview/detail | `frontend/src/modules/School/progress/` |
| TI-86 projection (adapter only) | `backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs` |

### Shared authored Catalog

The authored Catalog is a School capability, not a calculator feature. Its
validated hierarchy and hydrated Lesson projection are available when
`schoolcalc.enabled` is false. Web, print, and device products consume the same
`school.learning-lesson/v1`; only the last step into family bytes belongs to a
calculator adapter.

Mounted content is configured under `school.catalog`, independently of the
SchoolCalc transport product:

```yaml
catalog:
  content:
    root: content/school/catalog
    catalog_directories: [...]
    document_directories: [...]
    question_bank_directories: [...]
    action_directories: [...]
  access:
    unassigned: hidden
    guest: none
```

`access` translates the existing per-learner assignment records plus optional
address-prefix include/exclude rules. Empty ancestors are removed from list
results, and direct hydration of a hidden Lesson returns not-found rather than
revealing that it exists. The web client sends its selected learner on both
list and hydration calls; Guest uses the explicit Guest rule.

Tracked Catalog modules do not trust curriculum context supplied by a browser.
`OpenCatalogLearningSession` re-resolves the authorized Lesson, module, bank,
and required mode and derives Catalog/Subject/Course/Unit/Lesson/Module,
concept, area, classification, and tag evidence from the publication. It then
opens grading against the validated mounted bank snapshot. A forged client
context, bank ID, or mode therefore cannot misfile progress.

| Layer | Path |
|---|---|
| Catalog/module invariants | `backend/src/2_domains/school/catalog/` |
| Neutral ports/hydration/session use cases | `backend/src/3_applications/school/ports/`, `catalog/`, `GetLearningCatalog.mjs`, `OpenCatalogLearningSession.mjs` |
| YAML and assignment-policy adapters | `backend/src/1_adapters/school/catalog/`, `backend/src/1_adapters/school/config/` |
| Generated catalog sources + composites | `backend/src/3_applications/school/sources/` |
| Independent wiring | `backend/src/5_composition/modules/schoolCatalog.mjs` |
| API | `GET /api/v1/school/catalogs`, `GET /api/v1/school/catalogs/:address`, `POST /api/v1/school/sessions` |
| Web | `frontend/src/modules/School/catalog/` |

#### Generated catalogs (the anatomy shelf)

`GetLearningCatalog` and `BuildLearningLesson` each take ONE catalog repository
and ONE content repository, not a registry. Additional sources therefore join
the authored YAML ones behind `CompositeLearningCatalogRepository` /
`CompositeLearningContentRepository`
(`backend/src/3_applications/school/sources/`), which merge several sources into
the same two port shapes. Precedence is **first-wins in the order given, authored
YAML first** — so a hand-authored catalog or document always overrides a
generated one of the same id, and the projection can be corrected without a code
change. A source that throws is logged and skipped, never allowed to blank the
authored curriculum.

`ExerciseLibraryCatalogSource` is the first such source. It projects the shared
exercise-reference corpus (see `docs/reference/fitness/`) into an anatomy shelf:

| Corpus | Catalog |
|---|---|
| muscle group (12) | unit |
| muscle (38) | lesson |
| muscle `fullDescription` | a `lecture_notes` document, one `prose` block per paragraph |
| exercises targeting the muscle | an `examples` module (prompt + instruction steps) |
| equipment (29) | one `equipment` course holding a single guide lesson |

```yaml
catalog:
  exercise_library:
    enabled: true
    catalog_id: anatomy
    max_examples_per_muscle: 6   # the corpus has up to 197 for biceps
```

Two constraints shape the projection:

- **Block types are chosen for what the reader renders.**
  `LearningContentReader` handles `table`, `worked_example` and `formula`, and
  falls through to `<p>{block.text}</p>` for everything else — so `definition`
  and `asset` blocks validate but render **blank**. The projection emits `prose`
  and `heading` only, and omits exercise demo images rather than shipping
  invisible `asset` blocks. (`assetId` is a `REFERENCE_ID`, which cannot express
  the corpus's mixed-case, parenthesised, percent-encoded media paths anyway.)
- **An invalid catalog is worse than no catalog.** `GetLearningCatalog` throws on
  any invalid catalog, which would blank `/catalogs` for *every* catalog. The
  source therefore validates its own projection with `validateLearningCatalog`
  before publishing, and publishes nothing — logging
  `school.catalog.exercise-library.empty|invalid|failed` — when the corpus is
  missing, empty, or unreadable. Groups with no muscles are dropped for the same
  reason (`validateUniqueList` rejects empty lists).

Generated lessons are subject to the same `access` rules as authored ones, and
the defaults (`guest: none`, `unassigned: hidden`) hide them. Reference shelves
must be granted explicitly — see `catalog.access` in the household `school.yml`.

### Cross-surface calculator continuation codes

An authored Catalog module may declare `continuationCode`: a unique six-digit
module route in the range `000000`–`249999`. A School surface can ask the
application for a learner-scoped, six-digit **Continue on calculator** code;
the TI-86 enters it through its Home `CODE` action and opens the installed
target directly. The route is a convenience deep link, never authentication or
authorization: possession of the number grants no server access and does not
alter progress by itself.

The pure School contract reserves four explicitly configured, stable learner
slots. It combines the slot and authored route into the complete decimal
space, then applies a reversible affine permutation. This keeps all six-digit
codes usable and evenly distributed without a server lookup or arithmetic that
the TI-86 must reproduce. The Calculator adapter receives a compact installed
index (`SCCO` / `DSCODE`) of only currently available routes. It verifies the
current Catalog generation before resolving a code, so a stale, uninstalled,
or wrong-device route safely reports **NOT INSTALLED — SYNC** rather than
opening an arbitrary lesson.

This is shared School behavior, not a TI-86 curriculum branch: web and kiosk
surfaces request the same application use case and may present the code beside
any eligible module. The device adapter only formats its fixed codebook and
maps its resolved hierarchy back into the generic Catalog runtime.

| Layer | Path |
|---|---|
| Pure six-digit encoding | `backend/src/2_domains/school/continuationCode.mjs` |
| Learner-slot application use case | `backend/src/3_applications/school/IssueSchoolContinuationCode.mjs` |
| HTTP route | `GET /api/v1/school/continuation-code?learnerId=&moduleCode=` |
| TI-86 offline codebook adapter | `backend/src/1_adapters/schoolcalc/ti86/Ti86ContinuationCodebook.mjs` |
| TI-86 `CODE` interface | `_extensions/ti86-app/src/schoolcalc.asm` |

### Sentence Ladder

A revival of KC's 2016–2017 `korean.kckern.info` drill app, rebuilt as a School
program. Each sentence climbs a **four-rung ladder, one rung per day**:
`repetition` (shadow it) → `dictation` (type the target) → `recording` (say it)
→ `interpretation` (type the meaning). A day's work is *N brand-new sentences*
plus *everything that cleared rung k yesterday and not yet rung k+1*.

Deliberately **not** SM-2: no ease factors, no intervals, nothing grades. A
sentence is seen four times, in four cognitive modes, on four days. The only
pacing knob is new-sentences-per-day.

- **The queue is derived from the attempt log on every read, never stored.**
  This is the fix for the failure that killed the original: the queue lived in
  a `user_queue` table, a server migration lost the writes, and a real user's
  progress silently froze for weeks. Derived state cannot desynchronise from
  its own evidence.
- **A study day runs 4am→4am**, not midnight→midnight, so a session past
  midnight is the same day. Rollover needs the queue complete *and* the
  boundary passed — finishing early must not hand out tomorrow's sentences,
  because the spacing is the method.
- **Transcription accuracy is recorded but gates nothing.** A wrong dictation
  still graduates; the diff is for the learner's review. Consistent with "No
  second gate anywhere".
- **Rungs are defined over roles, not languages.** `source` is the language the
  learner has, `target` the one being acquired; the corpus binds them
  (`source: EN, target: KR`) and sentence text is keyed by language code. A
  Spanish course, or a reversed course, is a corpus file plus an adapter — no
  domain change.
- **Agenda status is scoped to the program instance.** The planner preserves
  each unit's `programInstance`, status maps key `program + instance`, and the
  language launcher reads only that corpus. Progress or an outage in one
  language therefore cannot masquerade as the status of another.
- **Capability filtering, per language.** `textInput` is a list of language
  codes rather than a boolean, because `dictation` needs a target-script IME
  while `interpretation` needs only the source script; a US keyboard satisfies
  one and not the other. A rung the device cannot perform is removed from the
  chain and sentences **graduate across the gap** — it is never rendered as a
  dead input. Script availability cannot be detected by any web API, so it is
  declared per device and defaults to assuming nothing.
- **Legacy import from the recovered database.** The 2016–2020 MySQL dump
  survived (`dbbackup/2020-12-01/glossika.gz`) and carries the whole history:
  **5,348 events across all four rungs**, real day numbers (KC 1–59, parent-two
  1–119), and **2,655 typed answers**, all scored on import so the Review diff
  has something to compare against. `import-db` supersedes the earlier
  mtime-based reconstruction, which could only recover 519 undated recordings.
  Because the queue is derived, both learners resume at their exact 2019/2020
  positions.
- **Two sources, one corpus.** Seq 1–3000 are the commercial course read by
  native speakers; 3001–4143 came from a later wordbook import whose audio was
  **TTS**. Each sentence records its `origin`. They share one corpus because
  the 2016 app drove both up a single ladder with one sequence and one day
  counter — splitting them would invent a division the history never had.
- **A sentence with no audio is history, not work.** 818 have no recording;
  every rung's prompt is audio, so `buildDayQueue` takes a `playable` set and
  never queues them — while still counting them as studied, so they are not
  re-admitted as new material either.
- **Re-run ownership is `source`.** An event carrying a source marker is
  imported evidence and may be replaced by a later import; an event with no
  source is live study and is always preserved.

**Glossika is a vendor, not domain vocabulary** — the 2016 app already drove
Naver Wordbook sentences up the same ladder. The pedagogy is the domain; the
supplier is an adapter.

| Layer | Path |
|---|---|
| Domain (pure) | `backend/src/2_domains/school/language/` |
| Persistence | `backend/src/1_adapters/persistence/yaml/YamlLanguageStudyDatastore.mjs` |
| Application | `backend/src/3_applications/school/SentenceLadderService.mjs` (legacy module remains an import alias) |
| API | `backend/src/4_api/v1/routers/sentenceLadder.mjs` → `/api/v1/school/sentence-ladder` (`/language` is deprecated) |
| Frontend (sentence-ladder pedagogy) | `frontend/src/modules/School/Programs/SentenceLadder/` |
| Legacy dump reader | `backend/src/1_adapters/glossika/LegacyDumpReader.mjs` |
| Ingest CLI | `cli/glossika.cli.mjs` (`import-db` is authoritative) |
| Corpus | `data/content/school/language/{corpusId}.yml` |
| Per-user | `data/users/{id}/apps/school/language/{corpusId}/` (progress + append-only log) |
| Media | `media/school/language/{corpusId}/` (audio + per-user recordings) |

**Design spec:** [`2026-07-21-glossika-program-design.md`](../../_wip/plans/2026-07-21-glossika-program-design.md)

### Geography / interactive quizzes

Two item types extend the quiz engine beyond text answers: **click a region of
an image** and **pick among images**. Both are built asset-agnostic — nothing
map-specific lives in the engine, only in the content that configures it.

- `region_click` — click a region of a **clickable asset**: any SVG whose
  regions carry a stable region id. A US states map is the shipped instance;
  the renderer imposes no map-specific code, so a different clickable SVG (a
  diagram, a keyboard) is a new asset, not new engine work.
- `asset_choice` — pick among choices that each carry a label, an image, or
  both. World flags are the shipped instance (an image prompt, text choices);
  the reverse shape (text prompt, image choices) is the same item type.

Both grade by **strict `===`** against the item's `answer` — no
normalization, unlike short-answer/cloze, because the value is a
machine-generated id (a region code, an ISO code), never free text a child
might mistype.

**The content pipeline is generation, not per-question authoring.** A mounted,
hand-maintained **dataset** is the source of truth. A generic **bank recipe**
declares the bank ID/title, entity dataset, item type, prompt/image templates,
answer field, distractor field, collections, topics, and subject metadata. A
pure subject-neutral generator turns one recipe plus entity rows into a full
question bank with stable item IDs and seeded distractors. A filesystem adapter
loads recipes/datasets from the configured content mount, synthesizes a bank on
first read, and caches it. Subject names, collection names, ID namespaces, and
entity fields are data; the domain/application contains no geography branch.

`SchoolService` tries injected generic bank sources before its ordinary bank
lookup and lists their summaries by a caller-supplied collection. The outer
Geography API/UI selects the `geography` collection and maps `summaryId` to its
presentation's `deckId`; that specialized surface does not leak inward.

**`drill` is a third session mode**, alongside `quiz` and `flashcard`: it
grades server-side immediately like `quiz` (each answer returns
correct/expected) but **resurfaces missed items** like a flashcard drill, and
records into its **own reporting lane** — never the `quiz` lane. This
matters because quiz completion gates course progression; a drill that
converges every score toward 100% by resurfacing would corrupt that signal if
it landed in the same lane as one-pass quizzes. Drill attempts count toward
"sets attempted" headline stats but are excluded from a student's
latest-score summary — drill is practice, not an assessment.

### Chess

**Chess is an app tile on the Arts & Culture shelf**, registered the same way
Typing and Geography are (`SUBJECT_PROGRAMS` in `home/SubjectPage.jsx`, opening
a top-level section at `/school/chess`). It is a curriculum, not a game surface:
eight units from naming a square to beating an opponent, thirty lessons,
each with a live board.

The honest state is visible in the interface. Every lesson carries a
`status` derived from whether its teaching steps are written, and an unwritten
one renders with an **Outline** flag and says so on opening — the board is live
and explorable, but nothing pretends a lesson exists that does not. That is the
same discipline as a greyed empty shelf: the shape of the course is a real
claim, the content is not yet.

Lessons come in three kinds — *watch* (play through a line), *try* (find the
move), and *play* (a full game against the bundled opponent, at three
difficulties). The board and the rules are shared with the piano kiosk's Piano
Chess rather than reimplemented: `frontend/src/modules/Chess/ChessBoard.jsx`
renders both, and the rules come from `shared/gaming/rulesets/chess/`. School passes
algebraic coordinates; the kiosk passes chord names for the same squares.

| What | Where |
|---|---|
| Curriculum (units, lessons, kinds) | `frontend/src/modules/School/chess/chessCurriculum.js` |
| Course shell | `frontend/src/modules/School/chess/ChessLessons.jsx` |
| Board (shared with the kiosk) | `frontend/src/modules/Chess/ChessBoard.jsx` |
| Rules and opponent | `shared/gaming/rulesets/chess/` |

## Teacher check-in workspace

The teacher workspace uses the work session's persisted `studyDay`, not the
time a card happened to be scanned. `GET /api/v1/school/teacher/day?studyDay=YYYY-MM-DD`
returns `school.teacher-day/v2`; late scans and grade corrections are listed
once under `processedToday` while scores remain on the original study day.
`/teacher/today` remains the compatibility array endpoint.

Teacher session reads (`school.teacher-session/v2`) join the immutable
worksheet, original and effective scores, review/OMR evidence, answer-card
capacity, generated result images, curriculum taxonomy, progress, and reward
reconciliation. Result PNGs are deterministic rendered artifacts—not photos
of a scanned card. Course, lesson, and learner-course context routes back the
canonical teacher URLs under `/school/teacher/curriculum/` and
`/school/teacher/students/`.

The learner timeline (`school.learner-timeline/v1`) and the `/review/learner`
feed join the curriculum catalog at read time, so History rows and feedback
entries carry lesson/course titles and posters; session records store only
ids. The feedback lane rolls consecutive same-session verdicts into one
expandable summary; machine grading is never attributed as if it were a
person.

Console information architecture: the Curriculum page is a course-card
catalog; lessons and pass bars (including a bulk course-level set, written
through the per-unit override store) live on the per-course drill-in page.
"The whole school" enrollment matrix renders once, on the catalog page,
transposed — courses as rows, students as columns — with a legend and an
unassigned-course count. The dashboard is the Today digest plus a compact
backlog-count strip; the Action queue owns the item-level review/print/quiz
lists. Every learner's roster card carries a one-tap link to that day's printed
agenda — the child's paper is what a parent reaches for before deciding whether
to open anything else, so it sits on the card, not behind the disclosure.
Expanding a learner shows the whole day as a grid of
lesson cards — done work with its score as green-check/red-cross
marks plus a percentage, planned-but-unstarted offers, deferred/blocked
subjects, and unplanned extras — built by joining the digest row with the
learner's agenda preview (one lazy, non-recording read per expand) through the
same day-join the day record uses. The grid waits for that read rather than
growing rows under a teacher mid-scan, and every card slot — the 2:3 poster
frame above all — is reserved at full size before its content exists, so
nothing on the grid moves or resizes once art loads or fails. Each graded card
carries small worksheet (PDF) and result-receipt icons whose links ride the
digest itself: the digest derives artifact URLs from session state at read
time, so the dashboard never pays a per-session document fetch to show them.
There is exactly one destination behind each icon, so there is no interstitial:
the icon IS the artifact. The drill-in also offers one link into the full day
record. Destructive flows are two-tap arm→confirm everywhere (enrollment
changes included), the curriculum-exceptions form starts neutral, and the
period-close control lives with the closed periods below the live report
card.

Published `school.course/v2` packages require `poster: poster.jpg`. The asset
must be a contained JPEG; runtime never reads the source PDF/EPUB. Use
`node scripts/school/build-course-posters.mjs` to normalize the published
catalog to 1200×1800 sRGB artwork.

Curriculum exceptions are append-only `school.curriculum-exception/v1`
records. `excused` and `replaced` satisfy a learner's planner gate without a
grade or mastery; `deferred` stays outstanding. Global `paused` is restricted
to defective, garbled, missing, broken, or inappropriate content and blocks
new agendas, sessions, printing, remediation, retries, and reprints while
leaving already printed work scannable and auditable. Retraction resumes the
content without deleting its history.

**The Geography topic grid** is an app tile on the **History & Geography**
subject shelf — the same mechanism the Typing tile uses to sit on Writing &
Typing — not a fixed top-level subject of its own. Opening it fetches the
deck list from a decks endpoint and renders one tile per deck; a deck with no
shipped content yet renders greyed and unclickable rather than being hidden
(same "an empty shelf renders greyed, not hidden" rule as the subject wall).
Launching a deck goes through the same identity-claim gate as the rest of
School — an unclaimed child is prompted to pick a profile first, so a drill
is never recorded against nobody.

The drill itself runs in a graded, resurfacing runner: each answer grades
immediately; a miss flashes the correct answer (the map highlights the right
region; the flag choice highlights the true match) and requeues the item; a
correct answer drops it. The session ends with a mastery summary. An
unrecorded answer (a transient save failure) is never silently dropped or
counted as mastered — it requeues as not-yet-mastered and a banner surfaces
the failure, the same "failures are never silent" rule the rest of School
holds to.

**Adding a new geography deck is content, not engine work:** add a row to the
dataset (or reuse an existing one) and one recipe line — deck id, title,
entity source, item type, prompt template, answer/distractor fields. No code
change.

**Reusing the framework for a non-geography interactive quiz is the same
shape.** For a region-click quiz: a new clickable SVG asset (each region
tagged with a stable region id) plus a small dataset naming each region and
its answer. For a choice-among-images quiz: new images plus a dataset naming
each choice's value and label. Neither touches grading, validation, the
runner, session plumbing, or reporting — only the shipped geography *decks*
are geography-specific; the item types, the clickable-asset renderer, and the
choice renderer are not.

| Layer | Path |
|---|---|
| Domain (pure) | `backend/src/2_domains/school/grading.mjs`, `questionBankValidation.mjs` — `region_click`/`asset_choice` grade + validate |
| Domain (pure) | `backend/src/2_domains/school/generatedBanks/` — subject-neutral recipe projection and seeded distractor sampler |
| Adapter | `backend/src/1_adapters/school/generated-content/GeneratedBankSource.mjs` — mounted-data load, synth-on-read, memoized per bank |
| Content | configured `data/content/school/generated-banks/` mount — `recipes.yml` plus referenced datasets |
| API | `GET /api/v1/school/geography/decks` (`backend/src/4_api/v1/routers/school.mjs`) |
| Frontend renderers | `frontend/src/modules/School/quiz/clickable/ClickableAsset.jsx` (+ `assets/`), `frontend/src/modules/School/quiz/items/RegionClickItem.jsx`, `AssetChoiceItem.jsx` |
| Frontend flag assets | `frontend/src/modules/School/geography/flags.js` (+ `flags/`) |
| Frontend geography module | `frontend/src/modules/School/geography/` — `GeographyGrid.jsx` (topic grid), `GeoQuizRunner.jsx` (graded, resurfacing runner), `useGradedSession.js` (shared session plumbing, `GeoQuizRunner`-only) |

Asset licenses are recorded next to the assets themselves (the clickable
US-states SVG and the flag set each carry a source + license note in their own
folder).

**Design spec:** [`2026-07-23-interactive-geography-quizzes-design.md`](../../superpowers/specs/2026-07-23-interactive-geography-quizzes-design.md)

### Printing (worksheets on the kitchen laser printer)

A child finds a worksheet in School and prints it themselves on the household
laser printer. The whole feature exists to make that self-service *without*
becoming a way to print a ream of paper unattended — so a **rolling page quota
with grown-up approval** is the spine, not an afterthought.

**The quota decides three ways** (`evaluatePrintQuota`, pure domain). Over a
rolling window (default **5 pages / 60 min**), a request is:

- **allowed** — within budget: prints immediately and logs the pages;
- **needs approval** — would exceed the budget: prints *nothing*, files a
  pending request for a grown-up;
- **denied** — a single job over the per-job hard cap (default 20 pages):
  refused outright, because approval is for "a bit much", not "the whole book".

The window is a strict rolling sum of the child's own recent jobs; a job
exactly `windowMinutes` old has aged out. `remaining` is budget-minus-used
*before* the request, which is what the on-screen banner shows.

**A printable resolves to a PDF two ways** (config-declared in `school.yml`
`printables:`):

- `type: bank` — an existing quiz bank rendered as a **worksheet PDF**
  (`WorksheetRenderer`, pdfkit). The same bank that drives an on-screen quiz
  becomes paper: numbered questions, lettered multiple-choice options, ruled
  lines for short-answer/cloze, two columns for matching. **Answers are never
  printed** — it is the worksheet, not the key (the on-screen quiz is still
  where grading happens).
- `type: pdf` — a file from `data/household/content/worksheets/`.

Page count is resolved per printable (rendered for a bank, sniffed from the PDF
for a file) so the picker can show it and the quota can price it.

**Approval is adult-only and never self-served.** An over-budget request
becomes a pending entry; a **grown-up** (roster member ≥ 18 by `birthyear`)
approves or denies it. Approve re-renders and prints the job and logs it with
`approvedBy`; deny drops it, printing nothing. A child cannot approve their own
print — the check is in the service, and the frontend only shows the approvals
panel to an adult. The pending queue is one household list; a future Telegram
hook can approve from the same API without a frontend.

**A guest cannot print** — no identity, no attribution, nothing to meter. The
button tells them to sign in and the service also rejects a guest request.

**Transport: raw JetDirect (port 9100), not IPP.** The kitchen Brother
HL-L2460DW's IPP does **not** accept a PDF — it advertises only `image/urf` +
`image/pwg-raster` + generic `application/octet-stream`, rejects
`application/pdf` (IPP status `0x040a`) and hangs on an octet-stream PDF (its
auto-detect can't parse PDF). Its built-in **PDF Direct Print on port 9100**
renders the PDF as-is. So `LaserPrinterAdapter.printPdf` streams over 9100 and
resolves on *flush* (JetDirect is fire-and-forget and often leaves its half of
the socket open after receiving a job — waiting on socket `close` hangs until
the idle timeout even though the job printed). IPP (port 631) is retained for
`getStatus`/`ping` only, where its structured Get-Printer-Attributes is clean.
No CUPS, no client-side rasterization, no npm printing dependency.

The adapter is **dumb transport** — it pushes bytes and reports state. Every
policy decision (quota, approval, who-may-print) lives in `PrintService`, per
the layer rules. The printer host defaults to the `kitchen-printer` entry in
`devices.yml`; `school.yml` `printing:` need only opt in and can override
limits.

#### Duplex: supplied by the printer, not by the job

**Double-sided output comes from the printer's own `sides-default`, not from
anything the job carries.** The adapter deliberately sends no `sides` attribute
at all, and the document arrives duplexed because the device is configured to
duplex everything.

That is not a design preference — it is what this firmware permits. The
HL-L2460DW advertises a complete, spec-shaped `sides-supported:
["one-sided","two-sided-long-edge","two-sided-short-edge"]`, and then rejects a
Print-Job with `0x0505 server-error-temporary-error` the instant a `sides`
attribute is **present at any value — including its own `sides-default`**.
Measured against the physical device with Validate-Job (no paper produced):

| job attributes | result |
|---|---|
| no `sides` attribute | accepted, `0x0` |
| `sides=one-sided` | rejected, `0x505` |
| `sides=two-sided-long-edge` | rejected, `0x505` |

That is why `sides` is first in `negotiate.mjs`'s `JOB_ATTRIBUTE_TRIM_ORDER`:
the Validate-Job negotiation drops it before anything physically consequential,
so the job is accepted at all. See Transport above for how that negotiation
works and why it exists.

**Setting it.** Duplex is a device setting, changed at the printer — its web UI
(2-sided Print → Long Edge) or front panel (Settings → Printer → 2-sided). It
is not in `school.yml` and cannot be set from this codebase. Read the live value
over IPP without printing anything:

```
GET_PRINTER_ATTRIBUTES → decoded `.attrs`   (note: `.attrs`, not `.attributes`)
  sides-default   = ["two-sided-long-edge"]   ← duplex is on
  sides-supported = ["one-sided","two-sided-long-edge","two-sided-short-edge"]
```

**The layout already assumes it.** `DocumentPdfRenderer` alternates the binding
gutter by page parity for duplex archetypes independently of any printer
setting — so a worksheet is laid out for double-sided binding whether or not
the device is currently duplexing. A printer left on `one-sided` therefore
produces pages whose gutters alternate for no reason; that is the visible
symptom of the device default having drifted.

**`duplex` still travels with the job, but only drives reporting.**
`printPdf({ duplex: true })` never changes the wire format. It makes the
adapter read the printer's real `sides-default` and log which of two truths
applies:

| log event | meaning |
|---|---|
| `laser-printer.duplex-via-printer-default` | duplex requested, and the device default satisfies it (carries `sidesDefault`) |
| `laser-printer.duplex-requested-not-applied` | duplex requested, device default is not two-sided — pages will print single-sided (carries `sidesDefault`, `sidesSupported`, and the remedy) |

The lookup is isolated: if reading printer attributes fails, it degrades the
*duplex report*, never the print. A failed read logs
`laser-printer.sides-default-lookup-failed` and the job proceeds.

**Copies are an IPP job attribute** (`printJobAttrs` in `ipp.mjs`) — `copies: 3`
sends the document once and asks the firmware for three, rather than
concatenating three PDFs. Concatenation would hand the raster personality one
contiguous stream and plausibly print one copy while the quota charged three.

**`binding` is vestigial.** `schoolLifecycle.mjs` still threads
`binding: cfg.printing?.binding || 'LONGEDGE'` into the adapter, and
`tests/isolated/composition/schoolLifecyclePrinterOptions.test.mjs` still pins
that wiring, but `LaserPrinterAdapter` no longer reads it — long-edge vs
short-edge is whatever the device is set to. Treat a `printing.binding` entry
in `school.yml` as having no effect.

`VirtualLaserPrinterAdapter` records `duplex`/`binding` in its job sidecar and
applies neither — it has no printer, so its captures stay plain readable PDFs.

#### Duplex follows the document, not the adapter default

A print job's duplex setting is **not** simply the adapter default: the
print-document pipeline overrides it per job with the geometry the renderer
actually drew.

`RenderPrintDocument` reserves a 3-hole-punch gutter, and *where* it reserves it
depends on the archetype:

| Archetype | Gutter | Printed |
|---|---|---|
| `worksheet` | alternates side by page parity (mirror margins) | double-sided |
| everything else (`quiz`, `infopage`, …) | fixed to the **left of every page** | single-sided |
| v1 legacy documents | no gutter drawn at all | adapter default |

Print a fixed-gutter document double-sided and page 2's reserved punch margin
sits on the opposite physical edge from page 1's while the two share one sheet.
**That is a comfort loss, not lost content.** These documents are loose-leaf;
punching is archival, not primary. And the 54pt `page.marginPt` is applied to
*both* edges independently of the 18pt gutter, so on the gutter-less side
content still starts 54pt in — clear of a standard ¼″ hole centred ½″ from the
edge, whose outer rim reaches only ~45pt. The gutter buys room from the binder
rings, not hole clearance. The **Printed** column above describes what the
render *asks* for; what actually comes out is the device's `sides-default`
(see Duplex below), and that asymmetry is tolerable for exactly this reason.

The render still reports its own decision (`duplex` on the `execute()` result:
`true`, `false`, or `null` for v1), and `IssueDocument` /
`ReplaceLostAnswerSheet` pass it straight to `printPdf({ duplex })`, where it
now drives reporting rather than the wire format.

`PrintService`'s quota path (`/print/request`, bank worksheets and `type: pdf`
files) has no such per-document decision and stays on the adapter default.

Adding an archetype to `DUPLEX_ARCHETYPES` changes page *layout*, not just a
printer setting — it needs its own visual check.

The **quota is unaffected**: it meters *pages*, not sheets, so duplex halves
the paper a child burns without changing what any request costs them.

> ⚠️ **UNVERIFIED against the physical Brother HL-L2460DW.** PJL duplex is a
> well-documented de facto standard (HP's PJL Technical Reference, broadly
> implemented by Brother firmware) and the wire format above is what we now
> send — but as of **2026-08-15** nobody has held a sheet of paper from this
> printer to confirm it. Two things a physical test should check: (1) the sheet
> actually comes out double-sided, and (2) `@PJL ENTER LANGUAGE=PDF` is
> accepted — PDF is a vendor personality, not one of the PJL spec's named
> languages, so if the firmware balks, the first thing to try is dropping that
> one line and letting PDF Direct Print auto-detect, as it did before this
> change. **Whoever runs that print: replace this block with "confirmed working
> as of `<date>`" or "confirmed NOT supported, fell back to `<X>`".**

| Layer | Path |
|---|---|
| Domain (pure) | `backend/src/2_domains/school/printing.mjs` — the quota policy |
| Rendering | `backend/src/1_rendering/school/WorksheetRenderer.mjs` — bank → worksheet PDF |
| Adapter | `backend/src/1_adapters/hardware/laser-printer/` — `LaserPrinterAdapter` (raw 9100) + `ipp.mjs` (status codec) |
| Application | `backend/src/3_applications/school/PrintService.mjs` — resolve → quota → print/pend, approve/deny |
| Persistence | `YamlSchoolDatastore` — `readPrintLog`/`appendPrintLog`, `readPrintPending`/`savePrintPending` |
| API | `backend/src/4_api/v1/routers/school.mjs` → `/api/v1/school/print/*` |
| Frontend | `frontend/src/modules/School/print/PrintCenter.jsx` (rail tile + `…/print` deep link) |
| Print log | `data/household/school/records/print/jobs.yml` (append-only; feeds the quota) |
| Pending queue | `data/household/school/runtime/queues/print.yml` |
| Worksheet files | `data/household/content/worksheets/*.pdf` (for `type: pdf`) |
| Device | `data/household/config/devices.yml` → `kitchen-printer` (Brother HL-L2460DW) |
| Config | `data/household/school/school.yml` → `printing:` + `printables:` |

**API:** `GET /print/printables` (with resolved page counts), `GET
/print/quota?userId=`, `POST /print/request` `{userId, printableId, copies}` →
`{decision: printed|approval|deny, …}`, `GET /print/pending`, `POST
/print/:requestId/approve` `{approver}`, `POST /print/:requestId/deny`.

**Config** (`school.yml`):

```yaml
printing:              # optional; omitting host defaults to the kitchen-printer device
  windowMinutes: 60
  pagesPerWindow: 5    # pages a child may print unattended per window
  maxPagesPerJob: 20   # hard ceiling on one job (approval cannot bypass it)
  duplex: true         # optional; default true. ACCEPTED BUT NOT APPLIED on the
                       # HL-L2460DW — it rejects the IPP `sides` attribute at
                       # any value, so the adapter logs the request and prints
                       # one-sided. See negotiate.mjs's trim order.
  binding: LONGEDGE    # optional; default LONGEDGE. LONGEDGE | SHORTEDGE
  printCooldownMinutes: 10 # IssueDocument's own debounce (see below) — a
                        # DIFFERENT axis: total pages across the household vs.
                        # repeat prints of one physical console session
printables:
  - id: state-capitals
    label: US State Capitals
    type: bank
    bankId: history/us-capitals/us-state-capitals   # a full path-form bank id
    subject: history
```

Boot-cached like the rest of `school.yml`; edits need a container restart.

**Explicitly not built** (named deferrals): paper-size selection (Letter only),
a print history surface for parents (the log exists; nothing renders it), and
Telegram approval (the pending API is ready for it, no bot hook is wired).
Duplex *was* on this list; it now ships on by default — see Duplex above,
including the standing caveat that it is not yet hardware-confirmed.

### Print documents — worksheets, quizzes, and OMR grading

> **Full reference:** [`print-documents.md`](./print-documents.md)

The richer sibling of the quota printing above: authored YAML sources publish
into answer-free revisioned documents, render on demand as per-student
worksheet/quiz PDFs (modern workbook aesthetic, teacher answer keys as a
pin-gated render mode, per-child shuffle variants and retakes), and grade
through physical Chatsworth OMR bubble cards. The card is the sheet's
identity: random 7-digit ids, shared across documents via row offsets,
tracked in an allocation store with a full lifecycle
(`live → satisfied | released | superseded`), and a card-backed sheet prints
**no on-page bubbles** — answers ride the card.

A card scan resolves rows to their newest claimant, grades at the record's
pinned revision/variant against the derived bank, files paper-transport
attempts into the same per-learner log the on-screen engine writes, and
advances the issuing work session `issued → submitted → graded` — holding at
`submitted` whenever a person must look first (ambiguous marks, essays,
short answers land in the parent review queue as pending; machine marks land
as resolved engine verdicts on the same sheet). Mis-bubbled card ids, retired
cards, and refused records all surface at `warn` with actionable detail —
a child's work never vanishes silently. When a Home Assistant gateway is
configured for the household AND `school.yml` sets `grading_hook.script`,
one HA script fires per **fully-resolved** terminal scan outcome — `graded`,
`review` (awaiting-review), `unresolved`, and `refused` — never on
`unknownCard`, `deadCard`, a card with no live allocation at all, or any
other `recorded:false` outcome, none of which fire anything (see
[`print-documents.md` §8, "The grading hook"](./print-documents.md#8-scan-back-grading-and-the-lifecycle)).

`GET /api/v1/school/print/<taxonomy-id>` (variety defaults to `omr`;
`variety=hand` for on-page bubbles) is the surface — and
`GET /print/<7-digit card id>` alone reproduces the sheet that card was
printed for;
`cli/school.mjs docs` covers validate/publish/render/release-card.
Sources live at `data/content/school/catalog/documents/` under hierarchical
taxonomy ids (`subject/course/slug`) — the authored document *class*, on the
same catalog shelf as the `school.learning-document/v1` files;
`data/content/school/print-documents/` holds only the artifacts minted from
them (`published/`, `derived-banks/`, `allocations/`). Curriculum units
reference a printed quiz as `document: print/<id>@<rev>`.

### The physical learning console

> **Status (2026-07-29): LIVE in production.** Enabled via `school.yml` →
> `lifecycle.enabled: true`, and the tap-to-agenda path is verified on real
> hardware — see [NFC personal cards](#nfc-personal-cards--tap-to-agenda) below.
> Architecture: [`2026-07-27-school-physical-console-architecture.md`](../../superpowers/specs/2026-07-27-school-physical-console-architecture.md).
>
> An earlier revision of this section said "built on a feature branch
> `feature/school-document-system`, not yet merged or deployed". That branch
> exists **nowhere** — not locally, not on origin, not on the homeserver — because
> the work is already on `main`. Don't go looking for it.

School is becoming a paper-first system with the touchscreen as one surface
among several. A child scans a personal card, a thermal agenda prints, they scan
a choice, a worksheet prints or media plays, the work is graded through the
*same* engine as the on-screen quiz, and a result receipt prints with the next
action on it. Four new pieces carry that.

**A re-scan of an already-issued sheet is a REPRINT, and a re-scan inside the
print debounce window is a SILENT no-op.** `IssueDocument` deliberately reuses
the original artifact id, worksheet instance, and OMR card/start-row on every
reprint — a lost or forgotten sheet is a real, expected event, and the same
piece of paper (same Student No., same bubble geometry) has to come back out,
not a second copy of a first attempt. Two identical scans within
`school.yml` `printing.printCooldownMinutes` (default 10) of the last
*successful* print, though, are collapsed into one job — the second is silent:
no second worksheet, no thermal slip explaining why. That is a deliberate,
narrow exception to the console's own rule that a scan never succeeds
silently (see `tokens.mjs`'s module doc), made once, for this one case, and
commented at the check site so it reads as an authorised exception rather than
a bug. The window is timed from the *print*, not the *scan* — a print that
failed (printer offline) never counts against the window, so the very next
scan retries immediately.

**The curriculum catalog** — a published, reviewed set of units at
`data/content/school/curriculum/{units,documents,manifests}/`. A unit composes
references (bank, document, media manifest, review rubric) and carries the
educational and administrative facts; it never inlines them. Validation is pure
and cross-referential: `validateUnit(raw, {bankIds, documentIds, manifestIds})`
resolves every reference at publish time, so runtime never discovers a dangling
one. **The promotion boundary is "valid YAML in the published directory with
`reviewState: approved`"** — runtime is ignorant of how a draft was authored,
which is what keeps the AI ingestion pipeline out of the runtime contract.

Two rules that exist because of specific traps:
- **External locators are not identities.** A manifest holds `plex:<key>` as a
  *current* locator plus durable metadata (title, series, aliases). A manifest
  whose only identity is its locator is rejected — otherwise a Plex library
  rebuild orphans the curriculum with nothing to rebind from.
- **A declared `id` must match its filename.** References resolve by filename,
  so a mismatch is dead metadata that makes every referrer report "not found"
  against a file plainly on disk.

**The learning-document system** — typed blocks (`rich_text`, `math`, `plot`,
`geometry`, `asset`, `question`, `answer_space`, `omr_response`,
`media_action`, `scan_action`) rendered to Letter PDF and thermal receipt from
one source. The block set is closed in code, the same posture as
`categories.mjs` and `reporting.mjs`.

- **Documents cannot carry answers.** Validation walks the whole tree and
  rejects any `answer`/`answers` key anywhere, including inside a renderer-owned
  `plot` spec. Learner copies and keys render from the document plus the bank;
  a document that *could* hold an answer is one that can print it on the
  learner's sheet.
- **Layout is measured, not streamed.** A measure pass sizes every block, then a
  place pass applies keep-together (a question and its answer space never split),
  widow/orphan minima, a spacing-class table (inter-block space is a decision,
  not a residue), and answer-space distribution into leftover page space. An
  atomic fragment taller than a page is a publish-time error, not a print-time
  surprise.
- **An `omr_response`'s `itemId` must equal its enclosing question's.** The
  bubble row and the question must grade the same bank item, or the sheet marks
  up one item and the grader scores another.
- Rendering is pure-JS in-process (pdfkit + MathJax→SVG + svg-to-pdfkit); no
  typesetting binary in the container. **Three svg-to-pdfkit normalizations are
  mandatory** and a fourth MathJax rule besides — see
  [the spike results](../../_wip/plans/2026-07-27-school-math-rendering-spike-results.md).
  Skipping any one produces silently wrong output, not an error.
- **What was recorded is checked against what was printed.** The renderer writes
  each bubble's geometry into the form map and the grader reads that same
  record, so the two agree by construction and a drift between the record and
  the ink is invisible to both. `tests/isolated/rendering/school/optical.test.mjs`
  closes that: it rasterizes the real fixture at 300dpi, finds the bubbles by
  detecting the holes ink encloses and fitting a circle to each rim at sub-pixel
  resolution, and asserts every recorded centre and radius against the measured
  one. The printed QR is decoded the same way — located by its finder patterns
  and read module by module by a decoder that did not draw it
  (`#testlib/school/qrDecode.mjs`), because `codeMap` is written by the draw
  loop and cannot testify about itself. Both checks are proved able to fail by
  named mutations in the sabotage suite.
- **Golden pages carry two tolerances.** Prose gets a whole-page budget loose
  enough to absorb antialiasing; bubble rows and code boxes get a budget five
  times tighter applied to their own small boxes. One number could not do both:
  adding the QR symbol at all moved 0.33% of a page and failed nothing.

**Work sessions** — the durable record School lacked: append-only events per
session under `data/household/school/records/sessions/{YYYY-MM}/{sessionId}.yml`, with
state derived on every read (the language-ladder pattern). It supplies the
context the attempt log intentionally lacks — why work was selected, what paper
was issued, what comes next.
- `failed` and `reassigned` are **annotations, not states**: they record a fact
  at any non-terminal state and leave the lifecycle where it was, so a failed
  print leaves the token valid and the next scan retries.
- **Every non-terminal state yields a non-null next action**, asserted as a
  property across all reachable states. A state without one is a wedged session.
- The outcome carries a deterministic id (`out:{sessionId}`) used as the
  economy `ref`. **School checks its own `rewardTxn` before calling
  `EconomyService.earn()`**, because that guard only scans the current UTC day's
  ledger shard and would pay the same ref again tomorrow.

**Opaque action tokens** — printed as `sch:<opaque>` and resolved server-side.
They encode nothing: no learner id, no unit id, no policy. `identify` (the
personal card) never expires; selection/media/remediation tokens are renewable
and return a friendly "already done" once the session has advanced past them —
a child holding a piece of paper is never shown an error. Token records live
one-per-file in the data volume and are **pruned on a grace period**: a record
whose expiry is more than a week past is deleted (at boot, and opportunistically
after mints), so the registry never grows without bound. Inside the grace
window an expired ticket still resolves to the "out of date" slip; after
pruning it resolves like any unknown ticket. Unexpiring records are never
pruned.

SchoolCalc adds one closed token class, `learning_action`, for persistent
calculator lesson QR codes. Its subject is only calculator device, lesson
address, action ID, and explicit token version. A dedicated HMAC adapter derives
the 16-character body and atomically claims that meaning; the downloaded
artifact contains no learner, printable/media target, provider, command, or
policy. These tokens intentionally do not expire, but remain revocable, and
version rotation makes old scans stale. The shared scan resolver re-reads the
enrolled calculator/default learner and current mounted action on every scan,
then uses the existing print approval/quota or media trigger/debounce service.

**Virtual hardware** — every physical endpoint has a double implementing the
*same* surface as the real adapter (laser printer, thermal printer, scanner,
playback target, OMR reader), with fault injection. Production code never
branches on test mode; composition picks the double. The OMR double synthesizes
bubble marks from the **real form map the PDF renderer emits**, which is what
makes the paper-grading path testable years before the reader hardware exists.
Gated behind `school.yml` → `virtualDevices: true`, default false — a
production deployment must never expose a "make the printer fail" endpoint.

---

### Self-service panel codes (six digits, typed at the school-room Portal)

Scanning a `sch:` token needs the barcode scanner, and the scanner is
parent-controlled — so a child who finished one thing had to find a grown-up to
start the next. Panel codes close that loop without handing children a scanner.

`BuildAgenda` mints one six-digit code per subject alongside the `subject_next`
token it already mints, and `agendaDocument` prints it on the lesson card as
**`PANEL CODE 481920`**. A child types it into the school-room Portal, which
answers with an identified, contextual **launch card**: the learner's avatar
and name, subject/course/module/lesson trail, course poster, available course
and unit progress, one primary action for that lesson, and a consistent way
out. The keypad remains anonymous; identity appears only after a valid code has
resolved, so the card also confirms whose paper and progress are about to be
changed.

The wire format is additive `school.self-service-card/v2`. The domain builds
semantic context (including `{kind:'learner'}` avatar and
`{kind:'course-poster'}` artwork references) without URLs or I/O. The
application layer joins roster, curriculum, enrollment, and session facts; the
frontend resolves those references through existing avatar infrastructure and
the learner-safe
`GET /api/v1/school/self-service/curriculum/:courseId/poster.jpg` route. That
route serves published poster bytes and nothing else—never course answers,
assignment data, or history.

**Artwork is real or absent; it is never invented.** A course id is either a
curriculum shelf id, whose `poster.jpg` ships inside the published package and
is served by that route, or a `plex:<ratingKey>` id for a course whose cover
only exists in Plex—which the panel resolves through `/api/v1/proxy/plex`, the
same image proxy the materials grid and the Player draw Plex artwork through,
sized to the box via `sizedPlexImage`. When neither yields a cover the route
404s and the card draws its own blank placeholder. No generated substitute
exists on either the learner or the teacher route: one used to answer a missing
cover with a hue-derived gradient captioned with the raw course id, at HTTP
200, so the panel's `onError` never fired and a child was shown a fabricated
poster in place of their lesson's own. Missing metadata degrades to stable IDs
and placeholders rather than removing the context shell.

**Three six-digit codes now exist, two of them on the same sheet of paper.**

| Code | Typed into | Nature |
|---|---|---|
| `continuationCode.mjs` | a calculator | reversible affine encoding of `learnerSlot × moduleCode`; permanent, enumerable, "not authentication" by its own header |
| SchoolCalc **study code** | a calculator | random, printed beside the lesson with "Enter on calculator." |
| **panel access code** | the **Portal keypad** | random, study-day scoped, printed as `PANEL CODE …` |

The printed treatment is what keeps them apart, and it is asserted by tests: the
panel code is labelled and unspaced, the calculator code is bare and grouped in
threes, and each names a different device. Schoolcalc entries mint `token: null`
and are therefore **not** keypad-reachable — intended, not an oversight.

**Two clocks on one record.** `subject_next` tokens carry a 7-day TTL so the
printed QR outlives the day. A code riding that clock would still be typable a
week later and would open whatever the subject offers *that* day, contradicting
the paper in the child's hand. So the record carries its own
`accessCodeExpiresAt`, set to the next 4am study-day boundary, and
`createTokenRecord` refuses a code that would outlive its token. Codes are legal
on `subject_next` only.

**`/resolve` does not write.** `ResolveSubjectNext.execute` calls `ensureSession`,
which appends a `created` event when an entry has no session — so resolving a
code that way would let a child typing a *sibling's* code write sessions into
that sibling's history. `ResolveAccessCode` computes `nextMove` against a
synthetic `created` state instead and hands `/act` a `SYNTHETIC_SESSION_ID` that
must never reach a use case. `/act` is where a real session is opened, because by
then the child has pressed a button.

**One action per card, never a composite.** A one-tap print-and-play is forbidden
by the session event schema in both directions (`issued` has no media edge;
`media_dispatched` is not in `IssueDocument`'s `ISSUABLE`). A video with a
worksheet offers `play`; after it completes, the recomputed card offers `print`.
`offeredActions` owns every button's wording and semantics — the panel renders
`action.label` verbatim and sends `action.kind` back, while `role`, `operation`,
and `followUp` keep primary/secondary styling and post-action transitions
independent of wording. In particular, a stable `retry` can print, play, mount a
bank, or dispatch a launch according to the fresh remediation session instead
of every retry pretending to be a print. `/act` returns the authoritative
`transition` (`confirm-print`, `mount`, `message`, or `close`).

The card shell persists through printing confirmation and the final outcome:
identity, poster, breadcrumb-style trail, and progress do not disappear while
the learner answers **Did it print?** or reads a refusal. All action states use
the same two-column grid and 72-pixel minimum target; a single action spans the
grid, and narrow screens stack the same controls in the same order.

**Never a dead end.** An unknown code, an expired one, a backend that is down —
every path returns HTTP 200 with a sentence a child can act on. `ok:false`
distinguishes a refusal from a real card that simply has no buttons (`served`,
`locked`), and a `reason` discriminator separates a bad code from an outage so
rewording the copy cannot remove the retry button.

#### Configuration — two independent switches

```yaml
# data/household/school/school.yml   (colocated School policy; the retired config tree is not consulted)
selfService:
  enabled: true                  # mint and print codes
  mediaSurface:
    id: livingroom-tv            # must be a real dispatch target
    label: living room           # bare room name -> "Play in the living room"

# data/household/screens/portal.yml
school:
  mode: locked                   # THIS panel shows the keypad
  idleTimeoutSeconds: 120
  screenOffTimeoutSeconds: 600   # optional; 0/absent disables automatic display sleep
```

`idleTimeoutSeconds` and `screenOffTimeoutSeconds` are intentionally separate.
The first returns an abandoned launch card to the keypad. The second uses the
Fully Kiosk Browser bridge to turn off the display only while the keypad is
idle; activity resets it, and cards, runners, scans, and in-flight requests
suppress it. The keypad always provides a two-tap **Turn off screen** control.
If the bridge is unavailable, the panel stays on and shows a visible failure.

The locked resting screen is a stable two-pane wall: the keypad and a read-only
per-learner `Today at school` board share the panel evenly. The board is
informational only—no teacher controls or links—and its delayed refresh never
changes the keypad's size or position. Every 90 seconds the panes trade sides
to spread static-screen wear without remounting a code a child is entering.

Minting and locking are independent so the rollout can be staged: print codes
first, confirm one resolves, lock the panel last. **Both off is exactly the
behaviour before this feature existed**, pinned by a characterisation test.

The locked panel's resting state is a split home: the keypad in one pane
and the read-only **AgendaStatusBoard** in the other — every student with
their agenda-lesson pills, a done count, and Not started / In progress /
Done for the day. The board accepts no taps (codes and printed agendas stay
the only entry path), never blocks the keypad (a failed status fetch just
hides the board), does not count as keypad activity for screen-off, and the
two panes swap sides every 90 seconds for burn-in without losing a
half-typed code. The board component lives at
`frontend/src/modules/School/status/AgendaStatusBoard.jsx` and reads the
same agenda-preview + teacher-day models the teacher console uses.

A locked panel still accepts `school.launch` broadcasts — `portal.yml` is the
only screen in the house that mounts School, so ignoring them would break the
scanner's "answer on the screen" path with nothing to catch it. Keypad-launched
quizzes register their sitting through `SchoolService`, or DoNow's clobber
protection would be blind to them. Lock mode fails *open*: an unreachable screen
config leaves the panel browsable, because "config absent" and "fetch failed" are
indistinguishable from the client.

**Printer locality.** Worksheets print on the kitchen laser (see *Printing*
above). The kitchen adjoins the school room through an open doorway, so a child
at the panel can see and hear the printer and the confirm step can simply ask
"Did it print?". If the laser ever moves out of sight of the panel, that step
needs revisiting — the confirm assumes the child can check.

**"Did it print?" never waits forever, and never asks alone.** The Yes button
carries a visible ~15-second fill and the question resolves itself to **yes**
when it expires, so a child who takes their sheet and walks away does not leave
the panel parked on their worksheet for the next child to answer about. Yes,
not no: the question is only reached after the print action succeeded, and a
"no" on expiry would book a reprint of a sheet already in a child's hand.

While the question is up the panel polls
`GET /api/v1/school/self-service/printer-status`, which reads printer-level IPP
state (`printer-state` / `printer-state-reasons`) through `ReadPrinterHealth`.
Per-*job* confirmation does not exist — the laser is fire-and-forget, and a jam
does not fail the print call — but out-of-paper, jam, cover-open and offline are
all readable at the *printer*, and any of them stops the question and tells the
child what is wrong instead of making them adjudicate it. The bar for declaring
a fault is deliberately high (a `stopped` printer, or a named blocking reason;
`-warning`/`-report` severities and unrecognised reasons are not faults),
because a false fault replaces an answerable question with a dead end.

The poll is an enhancement, never a precondition: a status call that 404s,
errors, hangs or answers without a verdict leaves the plain timer behaviour
exactly as it was. Only an explicit `healthy: false` changes what a child sees.

**The scan ceremony is a fallback, not a receipt.** A graded scan whose result
receipt reached paper shows **nothing** on the panel — the paper in the child's
hand is the feedback, and repeating the score on a wall screen both duplicates
it and reads a grade out loud to whoever is in the room. The banner survives for
the case where the sheet was read but the outcome never printed, and there it
says *"I got your sheet — it's marked, but nothing printed"* without the score:
the child's next move is to fetch a grown-up, not to learn their mark from a
wall. Every other outcome (`scan-review`, `scan-unresolved`, `scan-refused`,
`scan-stale-sheet`, `reader-error`) still shows regardless, because those are
precisely the scans that produced no paper at all. Suppression requires an
explicit `printed: true` on the `scan-graded` broadcast — sourced from
`CloseSessionOutcome`'s `{printed, printReason}`, the same pair
`ReceiptPrinting.print()` returns — so a missing field, an older backend or a
failed settle all still speak. A suppressed scan is still logged, so a silent
screen never becomes indistinguishable from a scan that never arrived.

**A scan never happens silently.** A sheet that reaches the consumer and earns
no ceremony of its own gets `scan-not-recorded` — an `error`-toned banner
reading *"Already done — I read that sheet, but there was nothing new to
mark."* It covers every terminal state that records nothing: a re-fed sheet
whose session is already `rewarded`, rows recorded on an earlier pass
(`duplicate-scan`), a missing session, a partial re-feed. Recording nothing is
often correct; saying nothing about it never is. The flag is tracked per
**sheet**, not per record — a card can carry six allocation records, and six
sounds at a child standing at the scanner is an alarm rather than feedback.
It fires only when a recorder is actually wired: the resolve-and-score-only
composition never attempted to record, so it is in no position to announce
that nothing was recorded.

### NFC personal cards — tap to agenda

> **Verified end to end on hardware 2026-07-29.** A tap produced
> `school.card.agenda-printed` and paper came out of the thermal printer.

> **Long agendas print completely, and do not shift the next job.** The thermal
> adapter waits for its write's flush callback before closing, rather than
> closing on a fixed timer — a timer-closed socket truncated long jobs and left
> residual bytes that offset whatever printed next, so a long agenda could
> corrupt the following receipt. Raster conversion is also linear now.
> Verified on paper 2026-08-22 with a 576×5000 PNG: 360,034 bytes,
> 19,895 ms / 698 MB RSS → 11,080 ms / 124 MB. `thermalPrinter.job.complete`
> logs real byte counts, and only after the flush.

> **A print reports what the printer knows, not what we hope.** The thermal
> adapter answers a claim tier — `{dispatched, verified, printerState}` — and
> asks the printer both before and after every job. The pre-flight rides the
> job's own socket (this printer refuses concurrent connections) and refuses
> before a byte goes out when the reply says no paper, cover open, or an error;
> the post-job read runs on a fresh connection *after* the job's socket is
> closed, and is how a roll that ran out halfway down a receipt is caught.
> `ReceiptPrinting.print()` maps `verified` to `printed: true` and reports the
> in-between case as `reason: 'unverified'` — the bytes went, the printer would
> not confirm it — so a permanent `issued` fact is never written on a hope.
>
> `verified` means *"the printer reports it can print, and reports no fault
> after the job"* and nothing more: this hardware answers all four `DLE EOT`
> queries but supports neither `GS r` nor `ESC v`, so there is no end-of-job
> barrier that could mean "this raster rendered". Cover state comes from
> `DLE EOT 2` alone — bit 2 of `DLE EOT 1` is the cash-drawer pin, and the live
> printer sets it while perfectly healthy. A status read that fails is an
> absence of knowledge, never a fault: it drops `verified` and never blocks a
> job, because a broken probe must not stop a household from printing.

The personal card is NFC, not a printed barcode. A child taps it on the reader in
the school room and a **sectioned daily agenda** prints — one block per assigned
subject, at most one scannable ticket per subject per study day (see
[An assigned course, not a catalog, is what prints](#an-assigned-course-not-a-catalog-is-what-prints)
for what a section holds and how scanning it resolves). The card is the recovery
path for every other failure in the system, which is why it never expires and has
no preconditions.

```text
NFC tap (omr-relay)                        emits {type:'nfc', uid} on the `omr` bus topic
  -> canonicalizeNfcUid                    one card = one identity, whatever the reader spells
  -> config/triggers/bindings/nfc/cards.yml  uid -> school_learner
  -> ResolvePersonalCard                   -> BuildAgenda -> thermal receipt
```

**The tag registry, not School, owns the uid → learner mapping.** One registry
answers *what a tag is* for the whole house; the owning domain decides what
happens. A book sticker resolves to a Plex id because for books the meaning IS
the action; a personal card resolves to a learner because what happens next is
the planner's decision. This is the rule the roadmap already states for barcode —
the relay stays transport-only and School is a resolver namespace downstream:

| File | Holds |
|---|---|
| `config/triggers/bindings/nfc/cards.yml` | personal cards: `school_learner: <household user id>` |
| `config/triggers/bindings/nfc/books.yml` | audiobook/content tags (`plex:`, `action:`) |
| `config/triggers/bindings/nfc/unsorted.yml` | where a newly-seen tag is filed when named at runtime |

Four traps worth knowing before editing any of that:

- **Tag fields must be SCALARS.** `parseNfcTags` reads any object-valued key as a
  per-reader override block and throws on an unknown reader id, so a nested
  `school: {learner: x}` fails at boot. Hence the flat `school_learner`.
- **UIDs are canonical: lowercase, separators stripped.** Readers disagree — the
  audiobook readers write `04_66_9c_0f_cb_2a_81`, the omr-relay's ST25R3916
  reports `04669C0FCB2A81`. Before canonicalization those were two identities and
  a registered card could read as unknown.
- **Keys must stay QUOTED in YAML.** A separator-free hex uid can be valid
  scientific notation: `838e6806` and `0421e521470289` both parse as float
  `Infinity`, so an unquoted dump collapses two distinct tags into one duplicated
  mapping key and the file stops parsing. js-yaml quotes them correctly; a
  hand-rolled migration script did not. Locked down in
  `tests/isolated/domain/trigger/nfcUid.test.mjs`.
- **One layout only.** NFC bindings live either as `bindings/nfc.yml` or as
  `bindings/nfc/*.yml`, never both — both present is a deliberate hard boot error,
  because this household already lost time to two plausible tag files diverging
  (62 entries in a stale path, 58 in the live one) with nothing to say which was
  authoritative.

An **unregistered** tag still falls through to the trigger pipeline rather than
being swallowed here, because that is where the unknown-tag notify fires and that
notify is how a new card gets enrolled. A card that IS enrolled while the school
lifecycle is off logs at ERROR: a child tapping their own card and getting nothing
is the failure the spec calls worse than having no card at all.

`lifecycle.nfcLocation` is intentionally **unset**. It would route non-school tags
tapped on the school reader into the trigger pipeline, which needs that location
registered in `triggers/sources.yml` with a target and action. Until there is an
answer to "what should a book sticker do in the school room", such a tap is logged
and does nothing.

### An assigned course, not a catalog, is what prints

> An assignment entry may carry a `profile` and a
> `school.course-enrollment/v2` snapshot: effective progression, module
> membership/order, optional modules, frozen lesson order, and—when dated—its
> module schedule. `EnrollLearner` materializes it from a stored syllabus;
> re-materialization and unenrollment are explicit teacher-gated operations.
> See [enrollment and syllabi](./enrollment.md).

A valid curriculum catalog offers **nothing** on its own. `BuildAgenda` builds
strictly from what a grown-up has assigned — courses, standalone units, and
program units alike — so an unassigned catalog prints a correct but empty
agenda (`offers: 0`). That is the design, not a bug: the catalog is what
*exists*, the assignment is what *this child* is doing.

```bash
curl -X PUT .../api/v1/school/lifecycle/assignments/<learner>   -H 'Content-Type: application/json'   -d '{"courses":["math-fractions"],"units":["language-daily"],"assignedBy":"<grown-up roster id>"}'
```

`assignedBy` must pass `GrownUpGate`. Assigning one course yields the gating the
curriculum declares — with `math-fractions` assigned: 4 assigned, unit `.01`
available, `.02`–`.04` **locked** behind it, `next: math-fractions.01`. Passing a
unit releases the next; only sequential courses gate. A standalone unit named
under `units` (curriculum or program) carries no such gate.

The catalog lives inside each work at
`data/content/school/{subject}/{work}/{units,documents,manifests}/` (curriculum
ids stay flat basenames; see [authoring/content-layout.md](authoring/content-layout.md)),
and question banks at `…/{work}/quizzes/` — a bank id is the subject/work path
with `quizzes/` elided. A unit whose bank is missing is **rejected at load**
with `school.curriculum.invalid-units` rather than failing when a child opens it.

**Learner-day completion is a four-state read model**, derived from this same
agenda plan rather than persisted separately. Consumers read
`GET /api/v1/school/lifecycle/learners/:learnerId/completion`, which returns
`incomplete`, `complete`, `no_work_today`, or `indeterminate`, plus excused
reasons and faults. A broken plan or unavailable required program is
`indeterminate`; it never masquerades as a no-work day.
The endpoint is side-effect free and `Cache-Control: no-store`; it never opens
a session or mints a ticket. Consumers must choose their own policy for
`no_work_today`: the piano Games gate treats it as unlocked, while an economy
reward must require actual `complete` work. Guest and failed reads remain
locked.

**The printed agenda is sectioned by subject, not listed by unit.** It opens
with the standard header — the learner's display name (resolved from the
household roster) knocked out of a full-width black band; thermal has no ink
concerns. Every assigned entry — across every course and every standalone
unit — is grouped by its `subject` (the nine-subject wall order, then
`other`); only a subject with at least one assigned entry gets a block, and
each block offers **at most one** scannable action, drawn with its subject's
shelf icon — the same nine SVGs the School home grid renders
(`frontend/src/modules/School/home/icons/`), shared rather than copied. A
subject already served today gets no header at all: every finished subject is
collected into a single **Done today** strip — a rule, a tick, and the subject
names — printed once at the foot of the sheet, below the work still open. A
tally of what is already behind the child never outranks what is in front of
them. Otherwise the subject prints one
line naming the next thing to do (or, if everything assigned in that subject is
locked, the lock's own remedy) with a QR beside it. "Served today" comes from
either a **passing** curriculum outcome recorded this study day, or a program
unit's own `doneToday` — a *failed* attempt never serves the subject, because
the section is the retry's only way back in.

**The study day is 4am→4am**, the same boundary the language ladder already
uses — one shared implementation, so the agenda's "today" and the ladder's
"today" can never drift apart across a DST change. Serving a subject locks
nothing: a child who finds an old per-subject ticket in a coat pocket and
scans it after that subject has already been served gets a "done for today,
scan your card tomorrow" slip, never a second credit; the same ticket scanned
*before* the subject is served still resolves to whatever is actually next,
recomputed fresh on that scan, rather than trusted from the moment it printed.

**A program unit delegates an entire subject to a registered program**
instead of composing a bank/document/media reference — named on the unit, with
a daily cadence if it should re-offer every study day rather than terminally
complete. It opens **no work session**; the program's own append-only records
are the evidence, and the program answers exactly three things for the
agenda — done today, how far along, and what "go do this" means for it. A
program that throws degrades its subject to an "unavailable — try the Portal"
line rather than blanking the rest of the agenda. Language study is the first
program: the day queue's own "everything cleared" is what "done today" means
for it.

**Program ids are addresses, not a fixed enum.** A `program:` value resolves
to either a code-registered launcher (`sentence-ladder`; legacy `language`
assignments normalize at the boundary) or a `school.yml`
`programs:` entry backed by the generic `SurfaceProgramLauncher` — config
selecting from DoNow's closed *surface* vocabulary (`garage-fitness`,
`piano-kiosk`, `portal`, ...), the household "start this, there, now" dispatch
facade every program launcher now calls through
(`docs/superpowers/specs/2026-07-30-household-donow-dispatch-design.md`). It
is the surface set that stays closed in code, same posture as
`categories.mjs` — not the program id set; a `programs:` entry whose id
collides with a code-registered launcher is a **boot-time error**, never a
silent override.

**Scanning a subject's ticket that resolves to on-screen work — the quiz
runner, or a program — hands the learner to the Portal.** The console
broadcasts a launch event naming the learner and the runner to open on the
shared WS bus; whichever screen has the School app mounted receives it, claims
the learner (the same soft-claim the touch flow uses), and navigates into that
runner. There is no acknowledgement path back to the scan, so **every** such
scan also prints a slip naming the manual fallback ("Language is starting on
the Portal — or open it there yourself") — the paper is always the truth, the
broadcast is a bonus.

**The printed code is a QR, not a linear barcode.** Every ticket on the
console's tape is a model-2 QR, read by the console's own 2D imager — a
linear-only laser scanner cannot read it. A plain linear barcode remains the
receipt renderer's default everywhere else in the house; the school console is
the one caller that opts into QR.

| Layer | Path |
|---|---|
| Domain | `backend/src/2_domains/school/studyDay.mjs` — the 4am→4am study-day boundary, shared with the language ladder |
| Domain | `backend/src/2_domains/school/agenda.mjs` — `planDailyAgenda`: plan entries → subject sections, pure |
| Application | `backend/src/3_applications/school/usecases/offerSession.mjs` — `ensureSession`/`nextMove`, shared by `BuildAgenda` and `ResolveSubjectNext` |
| Application | `backend/src/3_applications/school/usecases/ResolveSubjectNext.mjs` — what a `subject_next` ticket means right now, recomputed on every scan |
| Port | `backend/src/3_applications/school/ports/IProgramLauncher.mjs` — `status()`/`launch()`, the whole surface a program plugs in |
| Application | `backend/src/3_applications/donow/DoNowService.mjs` — the household dispatch facade every program launcher (and every `launch:` unit) now calls through; composed in `backend/src/5_composition/modules/donow.mjs`, independent of this lifecycle's own `enabled` gate |
| Application | `backend/src/3_applications/school/SurfaceProgramLauncher.mjs` — the generic `IProgramLauncher` for a `school.yml` `programs:` entry — one class, config-driven, zero new code per surface program |
| Application | `backend/src/3_applications/school/DoNowSchoolBridge.mjs` — closes a `launch:` unit's session when a PENDING DoNow dispatch is later approved out of band |
| Application | `backend/src/3_applications/school/SentenceLadderProgramLauncher.mjs` — the `IProgramLauncher` face of Sentence Ladder, dispatching through the `portal` DoNow surface |
| Frontend | `frontend/src/modules/School/useSchoolLaunch.js` — the Portal-launch subscription hook |
| API | `GET /api/v1/school/lifecycle/learners/:learnerId/agenda/preview` — dry-run twin of the printed agenda (no session/token side effects), PNG with a real scannable QR |

### Gradebook, report cards, and the teacher's day

Everything above this section produces evidence — quiz attempts, card scans,
work-session outcomes, a grown-up's review verdicts. This section is the
rollup: one course grade, one printable report card, one glance at what
happened today, and the notes a grown-up writes finding their way back to the
child who earned them.

**Academic periods are configured, not computed.** A household names its own
terms — `school.yml` → `progress.academicPeriods`, a flat array of
`school.academic-period/v1` records, each a `periodId` + `kind` + `label`
bounded by canonical-ISO `startsAt`/`endsAt` (an optional `parentPeriodId`
records that one period nests inside another; `kind` — term, semester,
season, or whatever a household calls it — is data, not a closed set).
Boot-cached, validated at construction — a malformed period or a duplicate
`periodId` fails at startup, not on first report-card request. `GET /api/v1/school/periods` answers the whole
configured list as a plain array (no envelope), which is the one thing a
child-facing surface needs to work out "the current period" for itself: the
period whose `startsAt <= now < endsAt`.

```yaml
progress:
  academicPeriods:
    - schema: school.academic-period/v1
      periodId: 2026-fall
      kind: semester
      label: Fall 2026
      startsAt: '2026-08-24T00:00:00.000Z'
      endsAt: '2026-12-19T00:00:00.000Z'
```

**Course grades are a pure projection, `best-of-unit-mean-v1`.** A retake must
*improve* a grade, never dilute it into a mean over every attempt: each unit
contributes only its single best graded session, and the course percent is
the mean of `bestPercent` across units that were attempted at all — an
unattempted unit does not drag the average toward zero, it simply doesn't
enter it. The policy name travels with every projection it produces
(`courseGradeFromSessions` → `{courseId, policy, coursePercent, unitGrades}`),
so a report card can print which rule scored it without the reader having to
trust an unlabeled number.

**The report card is a period-scoped snapshot**, not "current state re-read
into a template." `GetReportCard` answers course grades, materials-framework
progress, an evidence aggregate, active-instructional-days, concept mastery,
open remediation arcs, and the review backlog for one learner and one
period — read-only; nothing here writes.

**Assignment history entries carry `recordedAt`, and it is load-bearing.**
Period-window filtering is done on that timestamp, and the admin activity trail
keys its rows on it. An entry read back without `recordedAt` does not fail
loudly — it silently falls outside every window, so a report card quietly loses
courses and the audit feed quietly loses rows. Any read path that maps stored
history into domain records must preserve it: mapping through a projection that
only knows current-state fields drops it, which is precisely how this broke
once. `tests/isolated/adapter/school/lifecycleStores.test.mjs` pins the
round-trip.

Which courses appear is deliberately **not** "what is this learner currently
assigned" — a course assigned in week 2 and dropped in week 6 still happened,
and work done on a course nobody currently assigns is still work. The course
list is the union of (a) every course named in the learner's assignment
*history* at any point during the period, plus whatever was assigned at the
moment the period started, and (b) the course of any unit with a graded
session inside the window regardless of assignment. A learner who predates
the assignment-history feature (empty history) falls back to their plain
current assignment rather than silently reporting zero courses.

**Frozen closes are events, not documents.** A live report card
(`GET /report-card?learnerId=&periodId=`) is generated fresh on every
request and marked **DRAFT**; `POST /report-card/close` (`GrownUpGate` —
only a roster grown-up may close) freezes that exact snapshot into a durable
record under the learner's own data, marked **FROZEN** with `closedBy` /
`closedAt`. A plain re-close of an already-closed period is refused outright;
the only way to replace one is `supersede: true`, which archives the current
freeze to `{periodId}.v<n>.yml` **first** — the prior record is preserved,
never destroyed — before writing the new one.
`GET /report-card/frozen?learnerId=&periodId=` reads one frozen record (or,
with no `periodId`, every frozen record the learner has).

**The report card prints.** `?format=pdf` on either report-card GET renders
the same snapshot as a Letter PDF — courses, materials, active days,
per-unit pass/needs-remediation, concept mastery, remediation arcs, and the
pending-review count — with a DRAFT or FROZEN banner matching the JSON's own
mode, and the file name (`report-card-<learner>-<period>.pdf`) built from
slugified query values so a hostile `learnerId` can never inject a second
`filename=` into the response header.

**The teacher's day digest is one glance at the whole roster.**
`GET /teacher/today` answers, per learner, attempts today, correct-today,
the sessions touched today (whatever their state — finished work shows
alongside in-flight), and how many items are waiting on a grown-up's mark — all
scoped to the same 4am→4am study day the language ladder and the printed
agenda already use, not the plain UTC calendar date, so a session at 11pm
still belongs to "today" until the boundary rolls. Each session row also
carries its paper-record references (`artifacts.worksheet` /
`artifacts.receipt` with original/thumbnail URLs), derived from the already
reduced session state at zero extra I/O — an id only enters the event log when
a capture archived the bytes, so a link in the digest is live by construction. The parent report board
renders it as a **Today strip** above each learner's card; a needs-review
badge on that strip links straight to the Admin review queue
(`/admin/school/review`) — the digest names the backlog, Admin is where it
gets worked.

**A grown-up's written feedback reaches the child, not just the parent's
paper.** Resolving a review item (`ResolveReviewItem`) may carry a free-text
`note`. Notes surface in three places, capped to the most recent three at 120
characters each so a receipt or a printed agenda never drowns in commentary:
the result receipt for the session the note belongs to, the printed agenda's
"Notes for you" section (current or previous study day only — a note from
last week is stale), and `GET /review/learner/:learnerId`, which answers only
a learner's own *resolved* items, newest first — never a pending one still
awaiting a verdict — backing the student panel's Feedback list.

**A child sees where they stand.** The student panel resolves the current
period from `GET /periods` client-side, then reads that period's live report
card and renders every course with a graded session as `courseId: N%`. Three
zero-states — no current period configured, a current period with nothing
graded yet, or the report-card feature simply not wired server-side — all
render as the same quiet empty panel, never error chrome for something that
just hasn't happened yet.

**The concept registry is household-authored and optional.**
`data/content/school/concepts.yml` (`{concepts: [{id, label, parent?}]}`,
kebab ids) supplies a friendly label for concept ids graded evidence already
names — `conceptMastery` counts a concept whether or not it is registered;
the registry only decides whether the report card prints a label or falls
back to the bare id. An absent file degrades to an empty registry (the
feature is opt-in); a file that exists but is malformed — a bad id shape, a
missing label, a duplicate id — fails loud at construction, because that is
authored content and a typo there deserves to be caught at boot. The report
card's `concepts` facet reduces the period's own attempts into
`{mastered, developing}` rows, windowed to the report period itself rather
than the domain's independent rolling default, so "mastery this period"
cannot disagree with the period it is printed on. `school:certify
--strict-concepts` escalates a bank's use of an unregistered concept id from
a warning to a hard failure, certifying nothing until the registry catches
up.

**The authored curriculum feeds the same outline the evidence tree reads
against.** A `CurriculumExpectationSource` derives one expectation per
cataloged unit directly from the curriculum catalog — grouped by course,
ordered by each unit's authored sequence — and merges with any
configuration-authored expectations, which win a same-target collision.
`curriculumHistory` (§ above) annotates an evidence-backed tree node with
`outline` wherever a merged expectation names that same target, and lists an
authored-but-untouched unit under a new `outstanding` field. The honesty rule
holds exactly as before: a bare expectation still never fabricates tree
ancestry evidence didn't produce, and a course never cataloged still
generates no expectation at all — this source can only narrow the "we don't
actually know" gap, never paper over it.

**Every graded attempt carries where it happened, not just that it
happened.** A quiz attempt and a scanned card row alike now record a
`learning: {subjectId, courseId, unitId, conceptIds}` context and a
`workSessionId` in provenance — the session that issued the paper, not the
throwaway per-scan grading session. This fixed a real bug: two attempts
scanned off the same printed card with no work session behind them were
grouping as separate singleton assessments in recent-scores, because grouping
fell straight back to a bare evidence id once `sessionId` was absent.
Evidence now derives an `assessmentId` — the session id, or failing that the
scanned card's own record id — and groups on that first, so a card's rows
land together as one assessment the way an on-screen quiz's answers already
did.

| Layer | Path |
|---|---|
| Domain (pure) | `backend/src/2_domains/school/progress/courseGrade.mjs` — `courseGradeFromSessions`, `best-of-unit-mean-v1` |
| Domain (pure) | `backend/src/2_domains/school/progress/conceptMastery.mjs`, `attemptEvidence.mjs` — concept aggregation, attempt → evidence (incl. `assessmentId`) |
| Domain (pure) | `backend/src/2_domains/school/progress/learningProgress.mjs` — academic-period validation, expectation merge, `curriculumHistory` outline/`outstanding` |
| Application | `backend/src/3_applications/school/usecases/GetReportCard.mjs` — the period-scoped snapshot |
| Application | `backend/src/3_applications/school/usecases/CloseAcademicPeriod.mjs` — freeze + supersede-archive, `GrownUpGate` |
| Application | `backend/src/3_applications/school/usecases/GetTeacherToday.mjs` — the 4am→4am digest |
| Application | `backend/src/3_applications/school/usecases/ResolveReviewItem.mjs` — the `note` field a verdict may carry |
| Application | `backend/src/3_applications/school/usecases/BuildAgenda.mjs`, `CloseSessionOutcome.mjs` — "Notes for you" on the agenda and the result receipt (`reviewNoteLines`, cap 3 / 120 chars) |
| Adapter | `backend/src/1_adapters/school/progress/ConfiguredSchoolLearningDirectory.mjs` — `ConfiguredAcademicPeriodSource` |
| Adapter | `backend/src/1_adapters/school/progress/YamlConceptRegistry.mjs`, `CurriculumExpectationSource.mjs` |
| Adapter | `backend/src/1_adapters/persistence/yaml/YamlSchoolDatastore.mjs` — `readAttemptsInRange`, frozen report-card read/write/archive |
| Adapter | `backend/src/1_adapters/persistence/yaml/YamlAssignmentStore.mjs` — `history()`, append-only alongside current state |
| Adapter | `backend/src/1_adapters/persistence/yaml/YamlReviewQueue.mjs` — settled sessions (`*.settled.yml`) skip the pending scan |
| Rendering | `backend/src/1_rendering/school/reportcard/ReportCardRenderer.mjs` — the printable PDF |
| API | `GET /api/v1/school/report-card`, `GET /report-card/frozen`, `POST /report-card/close`, `GET /teacher/today`, `GET /periods`, `GET /review/learner/:learnerId` (`backend/src/4_api/v1/routers/school.mjs`) |
| Frontend | `frontend/src/modules/School/report/useTeacherToday.js`, `ReportPanel.jsx` (Today strip) |
| Frontend | `frontend/src/modules/School/home/useLearnerFeedback.js`, `useLearnerStanding.js`, `StudentPanel.jsx` |
| CLI | `cli/school.mjs certify` — `--strict-concepts` |
| Content | `data/content/school/concepts.yml` — the concept label registry |
| Config | `data/household/school/school.yml` → `progress.academicPeriods` |

### The teacher console

The grown-up side of the desk is the responsive workspace at
**`/school/teacher`** (with **`/school/teacher-next`** as an additive alias),
never a Portal widget and never in kiosk navigation. Its URL is the complete
workspace state: global dashboard/queue/curriculum/operations views and
learner-scoped overview, courses, history, reports, operations, and session
inspection can all be deep-linked and survive refresh/back/forward. The older
Today, Planning, Records, and Repair panels remain reachable inside this
workspace while their server-authoritative functions are consolidated.

**Teachers are config-declared, not age-derived.** `school.yml` `teachers:`
lists roster ids; `GET /api/v1/school/teachers` resolves them against the
live roster per request (shape-only validation at boot; a typo or blank
birthyear costs a picker entry and a warning, never the container) and
answers `{configured, teachers: [{id, name}]}` — profile fields never leave
the server. The console's soft claim (sessionStorage) is attribution only.
Authority lives in a server-side capability session represented by an
HttpOnly, SameSite=Strict cookie: 10-minute idle expiry, 30-minute absolute
expiry. PINs exist only in the prompt while unlocking or confirming an action;
they are not stored in React state, sessionStorage, logs, or ordinary mutation
bodies. High-consequence writes—agenda dispatch, grade correction/retraction,
bulk regrade, period supersession, and postview artifact rendering—also require
a two-minute, one-use grant scoped to the exact action and resource.

**Panel isolation, five states.** Every panel fetches independently through
`usePanelFetch` (`loading | error | empty | unavailable | ok`): one failing
endpoint never blanks a tab; a 404 maps per read (lifecycle route absent →
`unavailable`; assignments-for-unassigned-learner → `empty`); `/report-card`'s
unwired `null` maps to `unavailable`, never a quiet zero-state. On a
lifecycle-disabled install each lifecycle panel derives `unavailable` from
its own fetch and ONE banner renders only when all of them do.

**Wave 2 — the daily-loop mutations are live.** Marking work (verdict + a
≤120-char note that reaches the child's agenda and receipts), approving or
denying print requests, and clearing the quiz-request backlog (auto-`fulfilled`
once a bank bound to the unit exists, plus explicit dismiss via
`POST /quiz-requests/dismiss`) all run inline on the Today tab. Every write
goes through **`TeacherGate`** (`3_applications/school/TeacherGate.mjs`) inside
the owning use case — adult on the live roster, listed in `teachers:` when the
key exists (role is authority; absent key falls back to any-adult), and the
distinct console PIN (`school.yml` → `teacher.pin`) when configured. A 403
invalidates the browser capability and opens the PIN prompt; the blocked action
is replayed at most once after a successful unlock. The Admin
`ReviewQueue`/`CurriculumPlanner` sign-off now draws its adults from the
teachers read (the school roster is learners-only, so the old age filter found
nobody — sign-off had been dead on live installs) and carries the same PIN.
Along the way a latent transport bug was fixed: the production object-shape
error handler discarded stamped `err.status`, so every lifecycle refusal or
missing-entity surfaced as 500 — explicit status now wins, and the lifecycle
router stamps statuses by name at its boundary.

**Wave 3 — the planning domains are live.** The Planning tab carries no
stubs: assignments and academic periods are editable (periods are promoted
from boot-cached config to `data/household/school/plans/periods.yml` with
append-only history — the stored file wins after the first teacher edit,
config remains the fallback before it); pass-criteria overrides
(`household/school/plans/pass-overrides.yml`) win over a unit's authored
`passing.percent` at the one grading consumption point
(`CloseSessionOutcome`); milestones (`household/school/plans/milestones.yml`,
`2_domains/school/milestones.mjs`) carry derived met/behind/upcoming
statuses joined from passed sessions — due dates are fixed facts, enrichment
excusal is a report-time adjustment (wave 4); and the enrichment log
(`household/school/records/enrichment.yml`, append-only) records out-of-band learning as
its own attributed evidence kind, never merged into graded evidence. Routes:
`PUT /periods`, `GET/PUT /pass-overrides[/:unitId]`, `GET/PUT /milestones`
(learner-scoped write — a one-learner save never touches siblings),
`GET/POST /enrichment` — every write through the same `TeacherGate`.

**Wave 4 — records are live.** The Records tab closes/supersedes periods
from the UI (two-tap confirm, gate-checked); `GET /progress-report`
(`GetProgressReport` + `ProgressReportRenderer`) renders the period-to-date
read model where `paceMilestones` turns a behind-but-enrichment-covered
milestone into **excused — never delinquency** (spec C5), with the period's
enrichment entries as their own credit section; `GET /certificate`
(`CertificateRenderer`) prints a course-completion certificate and refuses a
course with nothing graded — no fabricated diplomas. The certificate is
landscape US Letter, with the ceremony border, centered name, and signature
line. Only the three repair
rows remain in the placeholder registry.

**Wave 5 — repair is live; the placeholder registry is EMPTY.** Attestation
overrides (`household/school/records/attestations.yml`, append-only, reason mandatory)
unlock gates for real — `BuildAgenda`/`ResolveSubjectNext` fold an attested
unit into the planner's history as a synthetic pass, and milestones count it
met — while the report card deliberately never reads them (an override is
its own evidence kind, not an engine grade). Attribution repair moves the
attempt events themselves (`YamlSchoolDatastore.moveAttempts` — destination
shard first, provenance stamped into each moved event, `attributedTo`
rewritten), so every derived rollup follows the evidence; `GET
/attempts-summary` feeds the picker and `POST /reassign` is the gated
write. Standalone teacher notes (`household/school/records/teacher-notes.yml`) ride the
same delivery surfaces as review notes: merged into `GET /review/learner`
(kind:'note') and the agenda's "Notes for you" window. The **e2e journey
test** (`tests/isolated/e2e/school/teacherJourney.e2e.test.mjs`) drives a
fake student through teacher enrollment → the *How Chemistry Surrounds You*
printed checkpoint → the
virtual OMR reader → grading → and asserts the today digest, report card,
and milestone pacing all tell the truth about it.

Three backend enablers shipped with the skeleton: the teachers read; the
`/print` route-order fix (the `/print/*id` splat had shadowed
`printables`/`quota`/`pending` — all three 404'd in production; fixed routes
now register first, pinned both directions by `school.print.routes.test.mjs`);
and `GET /lifecycle/learners/:id/sessions?window=today`, backed by
`ListLearnerSessions` filtering on `updatedAt` with the `studyDayWindow`
extracted to `2_domains/school/studyDay.mjs` — one copy of the 4am window
math shared with `GetTeacherToday`.

| Layer | Path |
|---|---|
| Domain | `backend/src/2_domains/school/studyDay.mjs` — `studyDayWindow`, `withinStudyWindow` |
| Application | `backend/src/3_applications/school/usecases/GetTeachers.mjs`, `ListLearnerSessions.mjs` |
| API | `/api/v1/school/teacher/auth/*`; teacher timeline/session/artifact/agenda-dispatch/grade-adjustment endpoints; existing lifecycle reads and gated writes |
| Frontend | `frontend/src/modules/School/teacher/` — `TeacherConsole`, `WorkspaceViews`, `TeacherProfileContext`, `useTeacherWrite`, legacy `tabs/` and `panels/` |
| Routes | `frontend/src/main.jsx` — `/school/teacher[/*]`, `/school/teacher-next[/*]`, and `/app/school/teacher` redirect |
| Config | `data/household/school/school.yml` → `teachers:` |

**Design spec:** [`2026-08-06-school-teacher-console-design.md`](../../superpowers/specs/2026-08-06-school-teacher-console-design.md) — includes the full use-case catalog, wave decomposition (mutations, planning domains, renderers, repair), and the placeholder registry future waves work from.

### The teacher workspace's organizing unit: the Learner Day

`/school/teacher/students/:learnerId/day/:studyDay` is the canonical record of
one child on one school day. It joins two side-effect-free reads —
`GET /lifecycle/learners/:id/agenda/preview?format=json&studyDay=…` (the plan)
and `GET /teacher/day?studyDay=…` (the record) — through the pure function
`learnerDay.js#joinLearnerDay`, which classifies each subject as done,
not started, deferred, blocked, or extra. Previewing a day never writes.

- It also carries the **printed-agenda dry run**: the exact thermal-printer PNG
  for the selected day, from the same GET route, on demand. `previewAgenda` is
  `BuildAgenda` with `previewOnly: true`, which emits `token: null,
  tokenClass: 'preview'` and relabels every offer "Preview only — ask a
  grown-up to start this lesson" — so the QR and digit codes on a previewed
  sheet are inert by construction. Nothing is minted, for today or any day.
- The dashboard and the History tab both LINK here; neither re-renders it.
- `/students/:id` and `/students/:id/overview` both resolve to the day record.
- Paper records (worksheet PDF, result receipt) are fetched lazily per lesson
  via `SessionPaperRecord`, never eagerly for a whole day.
- Repair tooling is indexed in `interventions.js`; each tool has exactly one
  home, and `InterventionsIndex` is the only thing that lists them.
- The plan-to-record match is by **unit id**, not subject: the planner buckets
  non-canonical subjects into `'other'` while the projection keeps the raw
  subject, so a subject-keyed join double-counted one activity as two rows.

### Student advocacy (wave 7)

The kid-facing surfaces hold up their end of the same contract the teacher
console got: **no silent verbs about children.** Every adult action whose
subject is a child produces one child-readable sentence through the notes
channel, and every kid surface tells the truth about waiting, passing, and
what didn't save.

- **The review loop closes itself.** Resolving the LAST pending review item
  of a session grades and closes it in the same act (receipt, coins, unlock)
  — `ResolveReviewItem` takes optional `gradeSubmission`/`closeSessionOutcome`
  finishers and degrades to resolve-only if either fails.
- **The pass bar is stamped, not remembered.** `GradeSubmission` writes the
  effective passing percent into the graded event; `CloseSessionOutcome`
  prefers the stamp, so a later override never moves a bar under an
  already-graded kid. Quiz summaries and paper receipts both state the
  threshold, and a passing-but-unsignedoff receipt prints "Coins: waiting
  for a grown-up's OK."
- **The receipt says "8 of 10", not just "80%".** Both producers of the
  `graded` event — `GradeSubmission` (screen and grown-up-marked work) and
  `RecordCardScanOutcome` (a scanned answer card) — emit `correctCount` and
  `totalCount` alongside `percent`. `reduceSession` projects them as
  `gradedCorrectCount`/`gradedTotalCount`, and `CloseSessionOutcome` passes
  them to the result receipt, where the renderers draw a per-question tick
  row and the "N of M correct" line. Both must be integers or the line is
  dropped, so a producer that omits them prints a receipt with no count at
  all.
- **Kids can talk back.** Kid-safe (ungated) requests: `POST
  /retake-requests` from a failed quiz summary and `POST /flags` ("Something
  seem wrong? Tell a grown-up") — both land as `kind:'retake'` / `kind:'flag'`
  rows in the quiz-request backlog with badges on the teacher's Today tab.
  Dismissing ANY backlog row requires a reason, delivered to the child as a
  note. Reassignment, attestation, and attestation-retraction auto-write
  child-readable notes.
- **Runners tell the truth.** Guest runs carry a "won't be saved" banner; a
  failed session open shows a sign (never eternal Loading); unrecorded
  answers say "didn't save — won't count as wrong" in a child's register;
  every summary celebrates in tiers; a wrong multiple-choice keeps the kid's
  own pick marked ("— your pick") with a one-line text verdict. The geo
  drill has a Stop exit and a skip-after-two-misses escape hatch; flashcards'
  Missed is "Not yet."
- **The kid's board is theirs.** `ReportPanel kidMode` (wired by roster age)
  drops the Everyone unfocus, admin links, and the Needs-attention flag;
  the review badge reads "waiting for a grown-up to check." The student
  panel shows banked coins (optional wallet call), humanized standings,
  a note-envelope icon for teacher notes (never a wrong-answer X), 60s
  feedback polling with a New badge, and softens the last-active counter
  past two weeks. The profile picker's auto-dismiss shows a countdown.
- **Outcomes never vanish.** `PrintService.deny` keeps the row as a
  `denied` record (30-day prune); `GET /print/requests?userId=` +
  PrintCenter's "Your asks" show pending/denied outcomes to the child.
  Learner reflections surface on the teacher's roster strip
  (`GetTeacherToday` optional `evidenceRepository` dep).

The plan appendix items once deferred with these records are now shipped:
mid-quiz resumability, tap-to-confirm choices, the no-stakes flashcard lane,
failed-quiz tutor handoff, and the Portal day-plan panel.

### Administration (wave 8)

The recording was always honest; wave 8 makes the system RECONCILE — every
store that can drift from another now has a read, a sweep, or a refusal
that says so.

- **Boot resilience**: a missing/malformed `generated-banks/recipes.yml`
  degrades to an empty source with a warn/error log — never a crash-loop.
  Malformed banks are named at warm (`GET /banks/health`). Cold start is a
  runbook: [`runbooks/school-cold-start.md`](../../runbooks/school-cold-start.md);
  authoring docs live in git under [`authoring/`](authoring/).
- **Drift is named**: report cards surface graded work whose unitId no
  longer resolves (`unresolvedUnits`, warn-logged, rendered on Records);
  the catalog CLI prints history drift and refuses bank↔unit seam breaks
  (duplicate claims, dead backlinks); screen attempts stamp `bankRev` (a
  content hash) so an answer-key fix never silently rewrites history; a
  nightly manifest task (`school:content-manifest`) diffs the content tree.
- **The bird's-eye view**: the Planning tab's SchoolMatrix (learners ×
  courses with dead-reference/zero-enrollment/override/orphan flags) and
  ActiveOverrides (every pass-override and attestation, by whom, since
  when). Planner refusals render on the morning drill-in. `SetAssignments`
  refuses unknown learners/courses BY NAME (degrading when the catalog
  itself is down).
- **Corrections have a full story**: `POST /attempts/regrade` re-runs the
  one grading engine over recorded attempts (dry-run default, gated, reason
  required, corrective rows carry `provenance: {kind: 'regrade'}`);
  superseded freezes are readable (`GET /report-card/frozen/versions`);
  retractions are visible (`?includeRetracted=1`); `GET /audit?since=`
  merges the four history trails; `GET /learner/:id/record` is one child's
  whole communications record.
- **Stale work is noticed**: `abandoned` finally has its writer (gated
  `MarkSessionAbandoned`, reason required) with a Repair-tab list of stuck
  sessions; `school-docs list-cards` finds stranded OMR cards; a daily
  retention sweep archives the print log and drops settled rows (a child's
  retakes/flags are NEVER swept).
- **Identity and format**: `school-rekey-learner` CLI walks both data
  roots (dry-run default, actor keys untouched); periods refuse same-kind
  overlap and frozen-card strandings, boundaries are half-open; banks/units
  accept an optional `schema:` (absent = v1); the Admin planner arms the
  stale-save guard and renders stale assignment ids honestly.

### Production hardening (wave 10)

The stores that record a child's work now refuse to make things worse when
they're already broken, two mutating GETs stopped minting side effects on a
plain read, human sign-off lanes carry a PIN, and a chapter-structured
course gates correctly for the first time.

- **Corrupt ≠ missing, everywhere it matters.** The attempt shards
  (`YamlSchoolDatastore`), the assignment store (`YamlAssignmentStore`), and
  sittings (`YamlSittingStore`) all now hold the posture the academic-period
  store set: a missing file is a valid cold state (quiet `[]`/`null`); a file
  that exists but won't parse is a LOUD read (one `warn` log naming the file)
  and a REFUSED write — never a silent clobber down to one fresh row. Every
  write in these three stores is atomic (stage + rename).
- **Two GETs stopped minting.** `GET /learners/:id/agenda` now runs the
  side-effect-free preview (the same dry-run twin `/agenda/preview` already
  used) instead of building a real session; `POST /learners/:id/agenda` is
  the mutating twin for a caller that genuinely needs to print. `GET
  /print/*id` refuses `card=`/`freshCard=`/`teacherPin=` query params with a
  400 naming `POST /print/render`, which takes the same fields — including
  the PIN — in the request body instead of the URL; a plain proof GET (no
  card params) is unaffected.
- **PIN on the human sign-off lanes.** `GradeSubmission`'s human-verdict
  branch and `CloseSessionOutcome`'s signed-off-coin-release branch now also
  assert `TeacherGate` — additive on top of the existing grown-up check, not
  a replacement, and only when a gate is wired — so a wrong or missing PIN
  refuses the verdict/sign-off outright. The self-closing finisher lane (a
  review item's last mark auto-grading and auto-closing its session) supplies
  neither `verdicts` nor `signedOff`, so it never reaches the gate and keeps
  settling unattended.
- **Chapter banks gate their parent unit — ALL must pass.** A course
  material whose chapters (Plex tracks) each carry their own quiz bank used
  to never gate at all — the units fetch only ever matched a bank bound
  directly to the listed unit, and no real chapter content does that. The
  fetch now rolls every chapter bank bound under a unit into one ordered
  gate: `unit.quiz` names the next UNPASSED chapter
  (`{bankId, banksTotal, banksPassed}`), and the unit only completes once
  every chapter bank has a passed session. `MaterialDetail` shows "Quiz N of
  M" whenever a unit has more than one chapter bank. A failed leaf listing
  degrades to the old ungated behavior (`needsQuiz: true`) rather than
  blocking the unit fetch.
- **One identity ceremony, everywhere.** Dismissing the shared
  `ProfilePicker` — the ✕, the backdrop, the auto-timeout — is now always a
  **cancel**: it drops the pending launch and leaves identity exactly as it
  was. Guest is reachable through exactly one door: an explicit button
  inside the picker itself ("Just practicing — continue as guest"). Tapping
  it is the only thing that ever demotes to guest, and it still trips the
  existing "sign in for this one" refusal notices for assigned banks and
  course units. A claimed kid launching generic work never sees the picker
  at all.
- **`/audit` gains reassignments; approvers can preview.** Every
  attribution move (`ReassignEvidence`) appends a best-effort entry to
  `household/school/records/reassignments.yml`, merged into `GET /audit` under its own
  `kind`. `GET /print/printables/:id/preview` streams the resolved PDF for a
  pending quota approval — no quota check, no print, no log — and a
  `Preview` link on each PrintCenter approval row lets the approver see the
  sheet before saying yes.
- **The nudge reads live teachers; stale saves are 409s.** The hourly
  `school:teacher-backlog-nudge` task reloads `teachers:` from disk instead
  of the boot-cached copy (falling back to the cached list if the reload
  fails), so a teacher added to `school.yml` gets nudged the same day.
  Concurrent-edit refusals (`STALE_SAVE`, on both assignments and periods)
  are `409`, not `400`/`500`, and error envelopes carry a real `traceId`.
- **A lost session says so.** A 410 mid-quiz/flashcard/drill no longer
  bounces the child out silently — the runner shows a "took a long break and
  timed out — your finished answers are saved" card with Back (and Start
  again wherever a restart affordance exists).
- **The console is smoke-tested live.** `tests/live/flow/school/teacherConsole.runtime.test.mjs`
  drives `/school/teacher` headless against the real running server — four
  tabs, the Today roster matching the live household roster by name, the
  Planning matrix, and a wrong-PIN write refusal through the real UI
  ceremony — gated by a `beforeAll` probe that refuses to run the mutation
  test at all unless the install's PIN gate proves itself armed first.

**Software-only closeout (2026-08-24).** The five choices previously left open
are closed. Multiple-choice uses tap-then-confirm; flashcards have a no-stakes
rotate-to-back lane; a settled paper result offers an explicit optional **One
more?** continuation whose `subject_next` token carries `continueToday:true`;
certificates render landscape; and a failed, remediation-enabled Catalog quiz
mints and opens a server-authoritative tutor session for the exact lesson and
bank revision. Deployment, physical-printer checks, live-model/learner trials,
and the manual stranded-session decision remain separate operational or human
verification, not unfinished software behavior.

## 3. Specced, not built

No delivery surface exists for anything in this section. Each available design
links its spec.

| Sub-project | Spec | Shape |
|---|---|---|
| **Writing assignments** | [`2026-07-26-school-composition-delivery-design.md`](../../superpowers/specs/2026-07-26-school-composition-delivery-design.md) | Keyboard-first composition, curriculum-defined submission, advisory rubric feedback, and parent-controlled print/email/postal outbox |
| **Typing tutor** | [`2026-07-21-school-typing-tutor-design.md`](../../superpowers/specs/2026-07-21-school-typing-tutor-design.md) | Drill (curriculum) + arcade, modelled on `PianoSpaceInvaders`' pure-engine split. No npm dependency |
| Reading (PDF / EPUB) | — | Not yet designed. Adapters exist; the two renderers are stubs |

### Decisions already made in those specs

- **Course completion is comprehension-based** — a post-video quiz, not
  watch-percentage plus presence. An attention check only proves a body was in
  the room. This is why quizzes were built before courses: they are a
  *dependency* of course completion, not a follow-on.
- **Sequential courses lock on the first *incomplete* lecture**, and incomplete
  includes "quiz not passed" — so watching fully but failing does not advance
  you. Piano locks on the first *unwatched*; this is stricter on purpose.
- That mastery rule carries a **dead-end risk** on an unattended kiosk, so
  three mitigations ship with it: unlimited retakes, a pass bar of 80 rather
  than 100, and a lock that always names the quiz to retake. A silent lock is
  the real trap.
- **Learning log and writing submissions join the same attributable record** as
  quiz attempts, so a parent's reassignment moves a whole sitting together.
  Writing drafts are the one mutable store — a draft is edited by nature; the
  submission is the event.
- **No second gate anywhere.** Only sequential courses lock. The learning log,
  writing word-counts and typing lessons are all explicitly ungated.

---

## 4. Conventions this subsystem holds to

1. **Per-child records are append-only events with `attributedTo`.** Anything
   a parent might need to reassign must survive as individual evidence.
2. **Rollups are derived, never stored.**
3. **A module is not an export surface for other modules.** Shared code moves
   to a shared home and every consumer imports from there, including the module
   it came from.
4. **The shared Player is never modified.** School chrome wraps it from the
   consumer side, exactly as Piano and Fitness do.
5. **Guests do not produce records.** No identity means no attribution, so the
   affordance is absent rather than failing on submit.
6. **Failures are never silent.** An unrecorded answer, an unsaved draft, a
   failed transcript — each surfaces at the moment it happens. Silence is what
   makes a progress record untrustworthy.
7. **Config is fail-closed.** `audience` defaults to `assigned`, so an omission
   never exposes material to a guest.

---

## 5. Gotchas

- **`data/household/school/school.yml`'s `materials:` block is live config** —
  the materials framework reads it at boot. The old staged `courses:` block is
  retired. A missing `materials:` block degrades to an empty catalog with a
  single logged warning, never a 500.
- Piano's `completion_threshold_percent` / `engagement_timeout_seconds` are
  deliberately **absent** from that file. Copying them would silently
  reinstate the watch-plus-presence completion model that School rejected.
- The old Portal menu list was deleted; the School home grid is the panel's
  navigation now. Music and Art return as material *sources* when the
  materials framework lands (they are curricular; they get no top-level
  section of their own). Ambient and Webcam are screen-level utilities, not
  School sections — still unwired.
- **The TouchChrome lane is content-only.** It is drawn when something sits
  over the screen's own layout (a cast overlay, anything on the nav stack) and
  is absent while the Portal shows the School app — which has its own header,
  back-navigation and transport, and needs the full 800px for 16:9 video. The
  School header's apple is the app's own home/refresh control: home from any
  depth, and a page reload once you are already home (the kiosk has no address
  bar). See `screen-framework/overlays/ScreenOverlayProvider.jsx`.
- Screen-framework features survive the single-widget layout — the doorbell
  subscription, PiP, casting, software volume and `portalKeys` are all
  screen-level. Casting in particular works because `ScreenActionHandler`
  mounts content via `showOverlay()` and does not need a menu widget present
  (and it brings the lane back with it, so a cast is never a dead end).
- `Fitness/player/panels/hooks/useVoiceMemoRecorder.js` is a second
  MediaRecorder implementation that predates and ignores
  `modules/VoiceCapture/`. Pre-existing debt; School uses the shared module and
  adds no new fragmentation.
- **The kitchen laser printer prints over raw port 9100, NOT IPP.** The Brother
  HL-L2460DW rejects `application/pdf` via IPP (`0x040a`) and hangs on an
  octet-stream PDF; only its raw JetDirect PDF Direct Print renders a PDF. Do
  not "fix" the adapter to POST PDFs over IPP — it was tried and does not work.
  IPP is used for status only. See Printing → Transport.
- **Raw 9100 is single-session.** A print in progress (or a leaked half-open
  client socket) holds the port and blocks new connections, while IPP status
  keeps reporting the printer `idle` — the two ports are independent. A wedged
  9100 clears on the printer's own TCP idle timeout. `printPdf` resolves on
  flush, not on the printer closing the socket, precisely so a fire-and-forget
  job doesn't hang on that.
- **Duplex is the printer's setting, and the job cannot override it either
  way.** The adapter sends no IPP `sides` attribute, because this firmware
  rejects one at any value (see Printing → Duplex for the Validate-Job
  measurements). So sidedness is whatever the device default is, applied
  uniformly: a job cannot request duplex, and — the sharper edge — cannot
  request single-sided. With the device on `two-sided-long-edge`, fixed-gutter
  archetypes (`quiz`, `infopage`) print double-sided despite rendering
  `duplex: false`. **Accepted, and not a defect:** these are loose-leaf
  documents, and the 54pt base margin on both edges already clears a standard
  three-hole punch (~45pt) without help from the 18pt gutter, so the cost is
  binding-edge comfort on archived versos, not content. The PJL envelope that
  would carry a per-job override was never measured on this hardware and no
  longer exists in the adapter; reviving it would mean proving at the printer
  that it works, on a transport that now sends rasterized `image/urf` rather
  than PDF — a lot of work to buy back 18pt of comfort.
- **YAML scalar trap in question banks:** a choice written as a bare number
  (`- 12`) parses as an integer and fails the bank validator's non-empty-string
  check. Quote numeric choices (`'12'`). The error names the field but not the
  cause, so this is worth knowing before you go looking.
- **`\fbox` switches TeX to text mode**, where `\phantom` is invalid — use
  `\enclose{box}{\phantom{X}}` for a fill-in blank. Schema validation cannot
  catch this class of error; only the catalog's `--render-probe` can, which is
  why it exists. Run `node cli/school.mjs catalog validate --render-probe`
  before promoting authored curriculum.
- **Never build a MathJax document without filtering out the `noundefined`
  package.** With it (the default in `AllPackages`), an undefined control
  sequence — a macro typo, the single likeliest authoring mistake — renders as
  **red literal text** instead of raising an error, and prints that way on a
  child's worksheet. `mathSvg.mjs` filters it; any new MathJax consumer must too.
- **Printable bankIds are full path-form ids.** Since the 2026-07-30
  restructure `readBankRaw` resolves the `{subject}/{work}/…` path form (the
  `quizzes/` container elided) — the old "top-level only" restriction is gone;
  this bullet previously documented the pre-restructure layout.
- **Teacher agenda dispatch is durably at-most-once.** The server reserves an
  idempotency key before contacting the printer and stores the completed receipt
  under `school/records/teacher-action-receipts/`. Completed requests replay
  across restarts; conflicting payloads and crash-indeterminate reservations
  return 409 instead of silently printing twice.
