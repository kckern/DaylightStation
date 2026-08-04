# School educational-technology research audit

> **Scope:** the cross-surface School product: authored content, School domain,
> application use cases, `/api/v1/school`, web/kiosk experiences, calculator
> clients, and relay-assisted offline/realtime transport.
>
> **Assessment date:** 2026-08-02. This is an architecture and product-readiness
> review, not evidence that SchoolCalc itself improves learning outcomes. That
> claim requires a learner pilot.

## Executive assessment

The cross-surface School learning system currently scores **78/100 (3.9/5)**
against the practices supported
by the supplied research bundle. Its strongest properties are immediate local
scoring, offline-first evidence capture, retry-safe cross-surface synchronization,
neutral curriculum structure, embedded formative checks, non-stigmatizing
recommendations, and a deliberate quiz-first / conditional-chat model. Its
largest remaining weaknesses are empirical validation with learners, explicit
consent/retention policy, before/during-task metacognition, accessibility
profiles, and an adult intervention-resolution workflow.

Technical conformance evidence has advanced since this assessment: the TI-86
application now passes an owned-ROM MAME release gate through a virtual Graph
Link, TI-OS launch, learner progress, Catalog/reader, quiz, durable offline
result, and QR presentation. This increases confidence in the offline surface
as software, but intentionally does **not** change the score: it provides no
new learner, accessibility, retention, transfer, or physical-relay evidence.

The classic compact-reference interaction discussed during this review also
produced a general design rule that applies well beyond chemistry:

> Keep the whole information space visible, move one stable focus through it,
> and devote a stable inspector to the focused item's detail.

That rule now governs dense custom-module contracts and the cross-surface
curriculum-history view. On the TI-86, My Progress uses a bounded overview of
recorded Catalog/Subject/Course/Unit/Lesson/Module nodes, directional focus,
and a stable inspector instead of opening a procession of nearly identical
detail pages. The same grammar suits periodic tables, maps, timelines,
flashcard-deck coverage, long collections, skill maps, and error clusters.

## Method and limits

Eight supplied PDFs were reviewed. Evidence was weighted by study design and
relevance, not by how enthusiastically a paper described technology.

| Source | Evidence type | What it can support | Important limit |
| --- | --- | --- | --- |
| Liu et al., *To Chat or to Quiz?* | Within-subject study, 14 high-school learners | Relative experience of bounded quizzes and generative chat in science-video learning | Very small sample; draft metadata; no significant between-mode learning-gain difference |
| Zainuddin et al. (2026), *Quiz-based inquiry* | Quasi-experiment, 90 undergraduates, three conditions | Incremental low-stakes questions as instructional structure; feedback and engagement | One online public-administration course; not a calculator study |
| Cotton (1988), *Monitoring Student Learning in the Classroom* | Research synthesis | Frequent varied monitoring, prompt feedback, record review, instructional adjustment | Older synthesis; predates current digital systems |
| Rocha et al., *Quizzes ... for self-regulated learning* | Systematic mapping in software-engineering education | Forethought/performance/reflection cycle; confidence, error analysis, self-assessment | Included studies rarely applied the full model explicitly; field-specific evidence |
| Squire, *Comparative Study of Game-Based Epedagogies* | Posttest-only quasi-experiment, 218 undergraduates | Active/game-like formative mechanics can affect later performance | No control or pretest; one institution/course; formative actions were not linked per learner to the posttest |
| Özelçi et al. (2016), *Rethinking Tracking Practices* | Qualitative case study, 18 school staff | Risks of durable ability labels and rigid tracks; value of mobility | One school and staff perspectives rather than learner outcome experiment |
| Okafor (2025), *The Role of Digital Tools in Assessment* | Narrative review | Alignment, timely feedback, personalization, equity, privacy, transparency, teacher involvement | Publication-bias and non-systematic-review limits acknowledged by the author |
| Yusufjonova (2025), *Advantages of Pedagogical Software Tools* | Descriptive overview | Low-weight corroboration for accessibility, interaction, monitoring, and responsible adoption | Broad claims with little causal evidence; not used for scoring by itself |

The review therefore treats the two quasi-experiments and the chat/quiz study as
promising contextual evidence, not universal causal laws. It treats the
narrative/descriptive papers as design prompts. No source justifies a claim that
more technology, more chat, or more gamification is inherently better.

## Scorecard

Scores mean: **0 absent**, **1 named only**, **2 designed**, **3 implemented in
part**, **4 implemented with strong automated evidence**, **5 validated in its
intended learning setting**. Each dimension is equally weighted.

| Dimension | Score | Current evidence and judgment |
| --- | ---: | --- |
| Embedded, frequent formative checks | 4.0 | `learning_probe` is a first-class subject-neutral Lesson module with concept binding, immediate feedback, bounded retry, immutable first-response scoring, separate interaction evidence, web rendering, and a TI-86 runtime. Learner/physical validation remains. |
| Immediate, specific feedback | 4.5 | Offline answer keys, local score display, explanations, review/remediation actions, and independent server regrading are implemented. Physical and learner validation remain. |
| Adaptive remediation | 4.0 | Policy-configured low-score follow-ups and bounded A–E realtime tutoring exist across application, API, relay, and TI contracts. Live-model quality and dialogue-dosage controls remain. |
| Learner self-regulation and metacognition | 3.5 | My Progress and optional, score-independent post-activity confidence/self-assessment/strategy evidence are implemented. Sparse pre-task and during-task prompts plus learner-set goals remain. |
| Teacher monitoring and actionability | 4.0 | Evidence is sliceable by learner, time, curriculum, concept, classification, and source; the adult web view exposes misconception and authored-pacing signals with transparent recommendation basis/expiry. Recording an intervention and later resolution remains. |
| Curriculum coherence and sequencing | 4.5 | The neutral Catalog → Subject → Course → Unit → Lesson → Module spine, learner-scoped visibility, ordered modules, embedded probes, and immutable server-resolved evidence context are implemented. General spaced-retrieval schedules remain. |
| Equity, offline access, and resilience | 4.5 | Offline study/scoring, QR upload, durable cable queue, Guest, switchable learners, and low-end hardware are unusually strong. Accessibility profiles and real fleet evidence remain. |
| Privacy, governance, and transparency | 3.5 | Opaque device/action identity, learner-scoped Catalog access, server-resolved evidence context, minimal tutor payloads, immutable evidence, repairable attribution, and recommendation explanations/expiry are implemented. Consent, retention/export/deletion, and AI provenance policy remain. |
| Non-stigmatizing adaptation and mobility | 4.5 | Static architecture checks prohibit ranking/permanent ability labels, recommendations carry evidence/policy/expiry, remediation is private, and new evidence immediately changes the suggested action in mobility tests. Intended-setting validation remains. |
| Active/game-like learning | 3.5 | Generic games, matching, flashcards, custom modules, and compact spatial interaction are supported. Mechanics are not yet evaluated against retained mastery and must remain subordinate to objectives. |
| Cross-surface evidence integrity | 4.5 | Append-only evidence, receipt-time semantics, device-sequence idempotency, QR/cable duplicate convergence, and honest hierarchy rollups are extensively tested. Physical interruption evidence remains. |
| Empirical validation | 1.5 | Host tests and an early physical QR proof establish technical feasibility, not usability, retention, transfer, equity, or learning efficacy. |
| **Overall** | **3.9 / 5** | **46.5 / 60 = 77.5 / 100, rounded to 78.** |

## Findings translated into product rules

### 1. Questioning is part of instruction, not merely its terminal test

The quiz-based-inquiry study found that incrementally sequenced, low-stakes
questions embedded through a lesson outperformed a post-lecture quiz condition;
differences between the two delivery platforms were small. The transferable
lesson is that **sequence and feedback matter more than the novelty of the
surface**.

School now has a generic authored `learning_probe` module that may appear at
conceptual transitions inside a lesson. It supports:

- one objective/concept binding;
- a bounded question bank and difficulty marker;
- immediate corrective feedback or explanation;
- a retry/review branch that does not falsify the original assessment result;
- independent evidence for response, feedback viewed, and continuation.

The first answer remains the score-bearing evidence; bounded retries cannot
rewrite it. Web and TI-86 implementations emit feedback-viewed and continuation
evidence independently. It is subject-neutral configuration. The School domain owns the learning
meaning and evidence; applications orchestrate branching; adapters compile it;
each surface renders within its own constraints. Remaining work is authored use
in real courses plus emulator, physical, and learner validation—not another
probe model.

### 2. Quiz-first and conditional chat is the right default

In Liu et al., both modes produced pre/post gains and neither mode had a
significantly better learning gain. Chat elicited deeper language and was often
more thought-provoking, but required more effort and sometimes frustrated
learners by requesting unnecessary detail. Multiple choice was faster and
easier for checks and reinforcement.

The current School policy, including its bounded SchoolCalc client, is
consequently well founded:

1. use locally scoreable, bounded questions for routine checks;
2. invoke connected remediation when evidence indicates a specific need;
3. ground tutoring in authored objectives, expected components, and immutable
   result evidence;
4. keep F-key responses and an obvious stop/skip path;
5. never make connectivity or AI availability a prerequisite for completing
   the authored lesson.

Configurable turn/time/generation budgets, repetition rejection, explicit
stop/skip/explain/challenge controls, and a terminal change/next-action summary
are implemented in the shared remediation model and web/TI projections. The
remaining questions are live-model instructional quality, disconnect behavior
on physical hardware, and learner-tested dosage.

### 3. Progress must close a decision loop

Cotton defines useful monitoring as evidence collected for instructional
decisions and feedback. Totals without a next decision are accounting, not a
learning loop. School’s curriculum history therefore keeps stable identity
and context at every level and should drive two distinct views:

- **Learner view:** where I have worked, what is recorded, what needs review,
  and the next available action.
- **Adult/teacher view:** where a learner or cohort is struggling, which
  concepts/items produce common errors, whether pacing or instruction should
  change, and which action was taken.

The adult web surface now has a purpose-built concept/item/pacing inspector
whose recommendations show their evidence basis, policy version, reassessment
rule, and expiry. The remaining loop is to record which adult intervention was
taken and determine from later evidence whether it resolved the signal.

The existing hierarchy is deliberately evidence-backed. It must not mark an
authored parent complete merely because every observed child is complete; only
an authored curriculum outline can establish coverage. Likewise, cohort views
must preserve counts and provenance rather than average away missing data.

### 4. Self-regulation needs an explicit before/during/after cycle

The quiz mapping review highlights forethought, performance, and
self-reflection. School covers performance well and now records an optional
post-activity self-reflection without changing the score. It still does not
capture the whole cycle.

The generic metacognitive envelope allows these fields without requiring them;
the next surface work is to use the before/during phases sparingly:

- confidence before a problem or assessment;
- confidence after feedback;
- a bounded error-category or reflection response;
- the preparation strategy used;
- a learner-selected review goal or next action.

These are separate evidence dimensions, never components of the academic score.
They must be optional and sparingly prompted; otherwise reflection itself
becomes cognitive load. A TI-86 can collect low-bandwidth forms with F keys,
while web surfaces may offer richer text.

### 5. Adapt without tracking or ranking learners

The tracking case study reinforces a critical invariant: temporary adaptation
must not become a durable identity such as “low learner.” School should:

- recommend a task for a learner at a point in time, never assign an immutable
  ability tier;
- allow reassessment and movement immediately when new evidence arrives;
- keep remediation private by default;
- omit peer rank, leaderboards, and comparative labels from learner progress;
- expose the evidence, policy version, and expiry behind adult-facing
  recommendations;
- aggregate classrooms for instructional decisions, not student sorting.

### 6. Game mechanics are instruments, not outcomes

Squire found a medium difference between two game-based formative formats, but
the design could not connect individual formative behavior to later scores and
cannot isolate “gamification” as the cause. School should keep games and
specialized interfaces reusable and engaging, while evaluating each mechanic
by later accuracy, retention, transfer, and voluntary return—not by points,
streaks, or screen time alone.

### 7. Compact overview/detail is a learning component

The periodic-table example works because it preserves spatial context, uses a
single movable cursor, and reserves one stable detail area. Nothing jumps as
focus changes. Dense information becomes explorable rather than tiny.

General applications include:

| Use case | Overview | Focus | Stable inspector |
| --- | --- | --- | --- |
| Curriculum history | recorded hierarchy nodes | selected course/unit/lesson/module | trail, activity count, completion, accuracy, last work, next action |
| Flashcards | deck coverage or confidence buckets | selected card/bucket | prompt/status/due state; answer remains gated by flip |
| Long collection | compressed alphabet/category bands | selected item | full label, position, availability, action |
| Skill map | prerequisite topology | selected skill | evidence, dependencies, recommended practice |
| Error review | concept/error clusters | selected cluster | example error, frequency, explanation/retry |
| Timeline | ordered event marks | selected event | full date/description/relationship |
| Spatial reference | map/table/diagram geometry | selected cell/region | label, values, available action |

The design-system contract remains: one focus; shape/topology communicates
meaning; status and focus are independent; the inspector stays fixed; arrows
move predictably; list fallback exists; position survives detail and return;
and no fact is encoded by inversion alone.

## Prioritized gap register

### P0 — learner-pilot gates and remaining software

| Gap | Required outcome | DDD owner(s) | Validation |
| --- | --- | --- | --- |
| Embedded learning probes | **Software complete; validation gate.** Author representative transition probes and prove web/TI use, interruption recovery, and learner comprehension | Content authors; surface adapters; pilot | Compiler/contracts pass; emulator, physical, and learner scenarios remain |
| Tutor cognitive-load guardrails | **Software complete; validation gate.** Validate bounded, fresh, learner-controlled turns with the live configured model and learners | Shared remediation application/domain; AI and surface adapters | Deterministic fake-gateway tests pass; live-model and physical-disconnect trials remain |
| Metacognitive evidence | **Partial.** Post-task confidence/self-assessment/strategy evidence is implemented; add sparse pre/during prompts only where a course hypothesis needs them | School domain/application/API; surface UI | Validation, idempotency, score separation, and web tests pass; prompt-dosage pilot remains |
| Teacher action loop | **Read side complete; write loop missing.** Add intervention action, note, resolution status, and later-evidence outcome | School domain/application/API/frontend | Current misconception/pacing fixtures pass; intervention lifecycle tests remain |
| Anti-tracking policy | **Software complete; validation gate.** Preserve vocabulary checks, recommendation expiry, transparent basis, and immediate mobility | School domain/application/frontend | Static prohibition, exact-expiry, and new-evidence mobility tests pass |
| Pilot protocol | **Specified, not executed.** Measure usability, completion, learning gain, delayed retention, cognitive load, disconnect recovery, and attribution errors | Product/research protocol outside runtime layers | See `school-learning-pilot-protocol.md`; pilot data does not yet exist |

### P1 — after the first usable pilot

- Add spaced retrieval and delayed retention probes without replacing the
  authored course sequence.
- Add explicit consent, retention, export/deletion, and AI provenance policy.
- Add surface capability/accessibility profiles and alternative input/output
  paths.
- Calibrate item difficulty and success ranges from evidence while preserving
  content-author review and immediate learner mobility.
- Let adults annotate interventions and observe whether the next evidence
  resolved the misconception.

### P2 — evaluate, do not assume

- Compare game mechanics using retained learning rather than engagement alone.
- Explore learner-authored/shared quiz questions with review/moderation and
  provenance; do not turn sharing into competition by default.
- Compare bounded quiz, bounded chat, and mixed sequences by prior knowledge,
  subject, and learner preference.

## Layer ownership

This roadmap adds no DDD layer and preserves the project reference architecture.
Every pedagogical meaning originates in the School bounded context. SchoolCalc
is one downstream product projection, never the owner of those meanings.

| Concern | Correct home |
| --- | --- |
| Curriculum/evidence meanings, probe and reflection invariants, non-stigmatizing vocabulary | `backend/src/2_domains/school` |
| Probe/tutor/recommendation orchestration and teacher/learner read-model use cases | `backend/src/3_applications/school` |
| YAML/content mounts, persistence, AI gateway, media providers, TI-family codecs | `backend/src/1_adapters` and extension-owned adapters |
| HTTP translation only | `backend/src/4_api/v1` |
| Dependency wiring only | `backend/src/5_composition` |
| Full web/kiosk learner and adult experiences | `frontend/src/modules/School` |
| TI-86 rendering, keys, memory bounds, native handoff, and QR presentation | `_extensions/ti86-app` |
| Electrical/link/BLE/network transport and diagnostics | `_extensions/ticalc-relay` |
| Subject/course facts and sequences | configured content/data mounts, never application code |

The application may know Course, Unit, Lesson, Module, assessment, evidence,
and remediation. It must not know math, chemistry, geography, a media provider,
an ESP32, or a calculator family.

## Source register

The reviewed local bundle was supplied at `~/Downloads/Research` and was found
at `~/.Trash/Research` during the audit. Filenames are retained here so the
exact inputs can be re-associated without committing third-party PDFs:

- `2335975-Wang-1.pdf` — Liu et al., *To Chat or to Quiz?: Examining the
  Pedagogical Benefits and Risks of AI Tutors in Facilitating High School
  Science Learning from Videos*.
- `Zainuddin_Quiz-based_P2026_2_.pdf` — Zainuddin et al. (2026), *Quiz-based
  inquiry: embedding incrementally sequenced questions to enhance engagement
  and learning in synchronous online lectures*, DOI
  `10.1007/s11423-026-10614-1`.
- `monitoring-student-learning.pdf` — Kathleen Cotton (1988), *Monitoring
  Student Learning in the Classroom*.
- `Sharing_Quizzes- Final.pdf` — Rocha et al., *Quizzes (as a tool for
  self-regulated learning) in Software Engineering Education*.
- `EJ1383948.pdf` — Nikki Squire, *Comparative Study of Game-Based Epedagogies
  in an Online Undergraduate Course*.
- `EJ1116369.pdf` — Özelçi et al. (2016), *Rethinking Tracking Practices: What
  Teachers Say*, DOI `10.13189/ujer.2016.041012`.
- `58-71+The+Role+of+Digital+Tools+in+Assessment+and+Their+Impact+on+Educational+Practices.pdf`
  — Okafor (2025), DOI `10.64420/ijitl.v2i1.202`.
- `AI+maqola.pdf` — Yusufjonova (2025), *Advantages of Pedagogical Software
  Tools*.
