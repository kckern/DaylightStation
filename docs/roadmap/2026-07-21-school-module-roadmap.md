# School — Physical Learning Console Roadmap

> A paper-first homeschool system: School plans the work, delivers it on the
> best surface, and returns attributable evidence, feedback, and (when
> configured) household-economy rewards.

**Last updated:** 2026-07-26

**Status:** Roadmap and integration inventory — no implementation implied

**Current implementation:** [`docs/reference/school/README.md`](../reference/school/README.md)
**Programme requirements:** [`docs/superpowers/specs/2026-07-21-portal-homeschool-requirements.md`](../superpowers/specs/2026-07-21-portal-homeschool-requirements.md)

---

## 1. Product direction

School is not primarily a touchscreen app. It is a household homeschool system
with a touchscreen as one useful surface. The default learner experience should
reduce screen time: a child gets a tangible agenda, chooses work by scanning a
code, does the work on paper or an appropriate playback device, and receives a
tangible result and next action.

```text
personal scan card
      ↓
thermal daily agenda with action codes
      ↓
scan a choice
      ↓
paper packet / tracked media / interactive programme / offline instruction
      ↓
OMR scan or parent-reviewed submission
      ↓
thermal result, remediation, and next-action receipt
```

The Portal remains valuable for seeing progress, choosing work, administration,
and genuinely interactive programmes such as language study. It is not the
required doorway to ordinary schoolwork. The living-room screen, headsets,
playback hub, laser printer, thermal printer, barcode scanner, and OMR reader
are all first-class learning surfaces.

The central missing capability is a **School work session**: a durable record
that links a learner, a selected/assigned unit, issued paper, media playback,
an OMR form or reviewable submission, outcome, remediation, and reward.

---

## 2. Non-negotiable principles

1. **Paper-first, not paper-only.** Use paper when it is the better medium;
   reserve screens for video, audio, feedback, and true interaction.
2. **The household is the school.** Household profiles remain the learner
   roster and every credited event remains attributable and reassignable.
3. **One source of grading.** On-screen and paper answers use the same School
   question-bank validation and grading rules.
4. **Opaque printed actions.** QR/barcode values resolve server-side. They never
   contain raw learner IDs, media IDs, curriculum policy, or reward authority.
5. **Idempotent physical interactions.** A scanner can duplicate or replay an
   event. Re-scanning, reprinting, and retrying must not create duplicate forms,
   attempts, or rewards.
6. **Approved curriculum is authoritative.** AI may extract, draft, vary,
   explain, and provide feedback; it does not silently author or change the
   curriculum that grants progress.
7. **No silent failure.** Printing, playback, scan ingestion, saving, and
   grading failures provide a recovery action rather than a dead end.
8. **Only sequential courses gate.** A passing result can release the next unit
   in a sequence; drills, writing, and optional work do not acquire a second
   gate by accident.

---

## 3. Curriculum supply chain

The runtime School module should consume a compact, reviewed catalog. The
private source archive and agent workspace are separate: purchased PDFs,
worksheets, transcripts, and other source materials must retain provenance and
licensing context without becoming learner-facing runtime data.

```text
private source archive
  → agent extraction and segmentation drafts
  → draft curriculum workspace with provenance
  → validation + rendered QA + human review
  → published runtime YAML catalog
  → School planner, documents, media, OMR, progress, and rewards
```

### 3.1 Canonical curriculum model

Do not expand the existing question-bank YAML into one monolithic format. Keep
banks, media, documents, and programme-specific data reusable. A canonical
**unit** composes them and carries the educational and administrative facts:

- stable unit ID, title, objectives, subject/strand, sequence, and prerequisite
  or gate policy;
- core/elective status, priority, estimated effort, and learner applicability;
- passing rule, remediation/retry policy, and optional economy reward policy;
- references to approved question banks, documents, printable forms, media,
  interactive programmes, and parent-review work;
- source provenance, review state, and durable internal asset references.

External locators are not identities. For example, a Plex rating key is one
current locator for a media manifest; the manifest also retains human-readable
metadata such as title, creator/series, hierarchy, duration, edition, aliases,
and provenance so a repair tool can rebind it if the library changes.

### 3.2 Agent workflow and skills

The agent workspace needs a small, explicit skill suite rather than one broad
“make curriculum” prompt:

1. **Intake and extract** — register source, licence/provenance, text/OCR,
   images, and structural outline.
2. **Segment and map** — propose lessons, objectives, source-page/timestamp
   spans, and reusable assets.
3. **Author candidate assets** — transcribe practice problems, draft banks,
   documents, flashcards, media bindings, and remediation notes.
4. **Validate and render QA** — schema validation, reference resolution,
   deterministic document rendering, and visual inspection.
5. **Review and publish** — a human accepts or rejects drafts before promotion
   to the runtime catalog.

AI is appropriate for approved-curriculum gaps: equivalent practice forms,
follow-up drills, explain-the-miss feedback, and candidate questions. It must
label its provenance and remain reviewable before its output can count for
completion or rewards.

---

## 4. Learning-document system — first implementation priority

The present worksheet renderer is deliberately small and text-oriented. It is
not a safe base for agendas, math sheets, OMR forms, media handoffs, or result
receipts. Replace/expand it into a School-owned document system with a typed,
validated grammar and two initial targets: Letter PDF and thermal receipt.

### 4.1 Typed document blocks

Documents should be structured data, not arbitrary PDF/HTML snippets embedded
in a bank. Initial block types:

| Block | Purpose |
|---|---|
| `rich_text` | Constrained Markdown for instructions and explanations |
| `math` | Inline/display LaTeX rendered to print-ready vector output |
| `plot` | Declarative axes, functions, points, labels, grids, and shading |
| `geometry` | Constrained constructions, shapes, measurements, coordinates |
| `asset` | Reviewed SVG/bitmap with caption, alt text, and placement rules |
| `question` / `answer_space` | Paper practice and free-response areas |
| `omr_response` | Exact machine-readable answer regions |
| `media_action` / `scan_action` | Printed opaque action codes and instructions |

LaTeX is the authoring syntax for notation. The renderer must produce tested
vector output; selecting the exact math package is a rendering spike using
fractions, radicals, matrices, long expressions, inequalities, trig, labels,
and multi-line word problems. Plots and geometry use constrained declarative
specifications so they are reproducible and validatable. Maps, licensed
diagrams, and complex artwork are curated SVG/bitmap assets, not arbitrary
embedded markup.

### 4.2 Layout and output rules

- Measured layout: adaptable font sizing, wrapping, pagination, and
  keep-together question blocks.
- Images, QR/barcodes, answer space, diagrams, and vector assets are
  print-safe and have deterministic placement.
- Generated forms carry stable artifact/form IDs and deterministic seeds.
- Answer keys render separately from learner copies.
- Letter PDF and receipt renderings draw from the same unit/document data;
  neither is a second authoring path.
- Golden rendered-page tests cover wrapping, page breaks, math, SVG, raster,
  codes, plot/geometry, and exact OMR alignment.

This system is the prerequisite for worksheets, quizzes, cheat sheets, daily
agendas, OMR forms, media instructions, remediation slips, and reports.

---

## 5. Physical learning console

### 5.1 Identity and barcode actions

Each learner has a durable personal scan card. Scanning it resolves the learner
and prints or reprints their current agenda; it is the physical equivalent of
claiming a profile on the Portal. It must respect the existing soft-attribution
and reassignment model.

Agenda and recovery receipts contain opaque, server-owned action tokens. They
can represent:

- select or resume a unit;
- issue/reprint a worksheet, quiz, or OMR form;
- choose an allowed media target;
- start or replay media;
- request remediation or an equivalent retry;
- recover a lost agenda or result receipt.

The existing barcode relay remains transport-only. School becomes a new resolver
namespace downstream from that relay, alongside existing consumers. The resolver
needs expiry, one-time/renewable semantics where appropriate, and replay-safe
outcomes. It should not overload existing content or nutrition scan formats.

### 5.2 Agenda, planner, and work sessions

The planner answers: who is studying, what is expected/available now, which
work is core versus elective, what can be chosen, and what should happen after
each outcome. It creates a work session before issuing work.

A work session records at minimum:

- learner and selected/assigned unit;
- state and next actionable step;
- issued document/form artifacts and their reprint lineage;
- media dispatch and completion correlation;
- resulting attempt/submission/review records;
- retry/remediation path and stable reward outcome ID.

Work sessions are not replacements for the append-only attempt log. They supply
the context the log intentionally lacks: why work was selected, what paper was
issued, and what comes next. Derived reports continue to use attributable
evidence rather than mutable progress counters.

### 5.3 Media handoff

A scan can dispatch a unit to an authorised TV, headset, Portal, or other
playback target. Starting playback is not completion. The work session must
correlate the dispatch/device event with a verified end/completion event, then
release the linked paper or on-screen quiz.

For a sequential course, the normal physical loop is:

```text
scan media action → play assigned unit → verified end
→ issue quiz/form → grade → pass releases next unit
```

If playback fails or is interrupted, the learner receives an explicit replay or
recovery action. Existing in-app School player behaviour remains valid; this is
the bridge for remote/physical dispatch, not a rewrite of the player.

---

## 6. Paper assessment and feedback loop

Paper is a second answer transport for the canonical question bank, not a
parallel assessment system.

```text
on-screen answers ─┐
                   ├─→ canonical School grading → attributable attempt evidence
OMR scanned marks ─┘
```

### 6.1 OMR pipeline

The OMR hardware decoder/protocol is a foundation, but the deployed relay and
School integration are still missing. Build the pipeline in this order:

1. Relay ingestion, device configuration, normalized scan events, append-only
   history, and operator-visible malformed/ambiguous frames.
2. Form generator that produces the learner sheet, stable form ID, exact
   mark-position map, identity/form markers, source-bank linkage, and answer
   key from one artifact definition.
3. Form registry/resolver that validates form, learner, session, and scan
   state; unknown, duplicate, malformed, and ambiguous scans go to recovery or
   review rather than silently grading.
4. Adapter to canonical School grading and session progression.

Form geometry and print calibration are part of the product. The OMR optical
variant and dropout-ink constraints must be verified before treating generated
PDFs as a normal print target.

### 6.2 Reviewable work

Machine-score only what the form can genuinely score. Written responses,
drawing, handwriting, and open composition enter a parent-review queue. AI may
offer feedback or assist review, but it must not present uncertain judgement as
an authoritative score.

### 6.3 Result and remediation receipts

After grading, the thermal printer provides a short, actionable result:

- score/outcome and objectives needing further work;
- opaque replay, remediation, retry, or next-unit actions;
- a recovery/reprint action if the child loses the receipt.

Retries must be clearly attributable to the original work session while
preserving individual attempt evidence. A pass can advance a configured course;
otherwise it informs progress without creating new gates.

---

## 7. Progress, parent review, and household economy

School already has the right foundations: household profiles, individually
attributable append-only attempts, derived reports, and the economy’s
policy-governed earning path. The physical console needs integration, not a
parallel ledger.

### 7.1 Progress and parent layer

Add a parent-facing layer for:

- curriculum/agenda assignment and priority;
- review and sign-off for unscored work;
- rejected or ambiguous OMR scans;
- attribution reassignment and documented overrides;
- work-session history, remediation state, and learner-facing next actions;
- portfolio, transcript, and printable progress reports.

`GetSchoolReport` and the existing programme reporting contract remain the
aggregation seam. New work-session/planner reporters should contribute their
facts through that contract rather than giving each programme a bespoke parent
dashboard.

### 7.2 Economy integration

Coins are an optional policy result of a stable School work outcome, never of a
barcode scan or printer request. The economy service remains the only path to
award currency. School supplies a deterministic outcome/reward ID so print
retries, scanner replays, and cross-day recovery cannot award twice.

Reward policy belongs with the approved curriculum/unit configuration: what can
earn, the passing requirement, amount/caps, and whether a parent sign-off is
required. Whether academic rewards are desired at all is a household policy,
not an implementation default.

---

## 8. Existing integration seams

| Area | Reusable foundation | Required extension/new module |
|---|---|---|
| Identity | Household profiles; School attribution | Personal scan cards and physical-session attribution |
| Grading | `SchoolService`, question-bank schema, attempts | Paper form mapping and OMR grading adapter |
| Barcode ingress | Existing relay/event path | School action namespace and opaque token resolver |
| Laser printing | School `PrintService`, PDF transport/quota | Issued document artifacts, session-aware reprint/failure flow |
| Thermal printing | Receipt transport and queued jobs | Agenda, result, remediation, and recovery renderers |
| OMR | Proven protocol/decoder source | Deployed relay, persistence, form registry, ingestion, review flow |
| Media | Materials, progress, dispatch/playback infrastructure | Work-session correlation and verified completion bridge |
| Economy | Append-only ledger and `EconomyService.earn()` | Stable School outcome/reward integration and policy |
| AI | Gateway/agent infrastructure | Curriculum intake, draft/review/publish skills; feedback boundaries |
| Reporting | `GetSchoolReport`, programme reporter port | Planner/work-session and review-state reporting |

Preserve these boundaries: barcode and printer adapters are transports;
`SchoolService` remains the canonical scorer; the datastore remains the
persistence boundary; and `EconomyService.earn()` remains the only coin path.

---

## 9. Delivery sequence

1. **Curriculum contract and learning-document spike.** Define the composable
   unit/asset/reference model and prove document rendering with representative
   text, math, diagrams, QR codes, and pagination.
2. **Document system and print QA.** Establish Letter and thermal templates,
   stable artifact IDs, network-print errors/retries, and golden visual tests.
3. **Work sessions and School barcode actions.** Build personal cards, agenda
   issuance, opaque action resolution, replay protection, and recovery flows.
4. **First end-to-end paper unit.** Select one real unit: agenda → worksheet or
   media → paper assessment → result receipt. This validates the core before
   generalising the catalog.
5. **OMR relay and form pipeline.** Deploy ingress, calibrate forms, grade via
   the canonical engine, and handle all rejected/duplicate paths.
6. **Remote media completion bridge.** Add target selection, playback
   correlation, quiz release, and failure recovery.
7. **Parent review and economy policy.** Add sign-off, reassignment/overrides,
   reward outcomes, and reports once genuine work-session evidence exists.
8. **Curriculum ingestion skill suite.** Turn purchased/unstructured sources
   into reviewable catalog drafts; use it to populate complete sequences.

Do not begin with a broad new interactive-app library. First prove that one
reviewed unit can be planned, delivered, completed, graded, recovered, and
reported without a child needing to stay at a touchscreen.

---

## 10. Discovery and acceptance inventory

Before detailed design, validate the following seams:

- Canonical curriculum/unit, document-block, asset-manifest, and media-resolver
  validation.
- Rendered PDF/receipt golden tests for wrapping, math, SVG/raster content,
  QR/barcodes, graphs/geometry, answer spaces, and OMR alignment.
- Barcode action parsing, expiry, duplicated/replayed scans, and no regressions
  to existing barcode consumers.
- OMR frame ingestion, persistence, form-map decoding, calibration, duplicate
  scans, grading parity with on-screen answers, and ambiguity/review handling.
- Laser and thermal printer delivery, status/failure behaviour, and reprint
  idempotency.
- Media dispatch/start/end correlation, interruption recovery, and quiz-release
  gating.
- Economy awards, caps, stable reward IDs, retries crossing day boundaries, and
  reassignment implications.
- Parent-review, unscored-work, sign-off, override, and report lifecycles.

## 11. Open questions

1. What exact OMR optical/dropout constraints and physical form geometry are
   required by the installed reader?
2. Which media targets may a child select autonomously, and which require
   parent approval or device availability checks?
3. How long should printed action tokens remain valid, and when should a scan
   require a fresh agenda rather than resuming stale work?
4. Which source licences may enter the private archive, be transformed into
   runtime assets, or be reproduced in printed packets?
5. What is the minimum human-review workflow for curriculum promotion and
   AI-generated variants?
6. Which outcomes earn coins, if any, and which require a parent sign-off?
7. What is the appropriate recovery path when paper is lost or a learner needs
   an equivalent—not identical—retry form?
