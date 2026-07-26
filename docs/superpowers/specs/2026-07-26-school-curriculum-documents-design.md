# School — Curriculum Catalog and Learning Documents

**Status:** Design spec

**Date:** 2026-07-26

**Roadmap:** [`2026-07-21-school-module-roadmap.md`](../../roadmap/2026-07-21-school-module-roadmap.md)

**Depends on:** School identity, question banks, material catalog, and printing

**Enables:** work planning, paper packets, OMR forms, barcode actions, remote
media handoff, curriculum ingestion, and economy policy

---

## 1. Goal

School needs one reviewed, hand-readable curriculum catalog that describes what
a learner is to do without embedding every representation of that work in one
file. A unit may combine a printable worksheet, an existing question bank, a
Plex-backed material, a physical instruction, a language programme, or a later
interactive activity. The unit states the educational and administrative facts;
reusable assets retain their own focused schemas.

The same catalog must render rich, reliable paper artifacts. The current
`WorksheetRenderer` turns a question bank into simple text PDF output, which is
useful but cannot safely represent a math page, a diagram, an image, a QR media
handoff, or a machine-readable answer form. This spec introduces a typed
learning-document grammar, rendered initially as Letter PDF and thermal receipt.

This is **not** a general publishing engine, a browser-based page-layout tool,
or a replacement for existing question-bank and material schemas.

---

## 2. Boundaries and invariants

1. **A unit composes assets; it does not duplicate them.** Question-bank
   grading stays in the existing canonical bank format. Plex material stays in
   the materials framework. The unit references both.
2. **Published curriculum is reviewed data.** Agent-produced output enters a
   separate draft/review workspace and never becomes runtime curriculum merely
   because it validates.
3. **Source provenance is preserved.** Every published unit and cataloged asset
   identifies its source and review metadata. Proprietary source files remain
   outside the runtime catalog.
4. **Stable IDs are semantic; locators are repairable.** A media/document asset
   has an internal ID. A Plex key or file path is one current locator, not its
   identity.
5. **The grammar is declarative and closed.** YAML selects supported block and
   asset types; it cannot embed arbitrary JavaScript, HTML, SVG, XML, or TikZ.
6. **One document definition, explicit target variants.** Shared blocks live
   once; each target names the compatible blocks it renders. A worksheet and a
   thermal instruction receipt may have different layouts without duplicating
   their reviewed source content.
7. **Rendering is deterministic.** An issued artifact records its document
   revision, variables, locale-independent seed, and renderer version so it can
   be regenerated exactly for an answer key, reprint, or audit.
8. **Printing never grants progress.** It only issues an artifact. The later
   work-session and OMR designs decide outcomes; this spec supplies the data and
   rendering contract they consume.

---

## 3. Runtime catalog layout

Published School curriculum lives under `data/content/school/`:

```text
data/content/school/
  curriculum/
    units/
      math/fractions/adding-unlike-denominators-01.yml
    assets.yml
    sources.yml
    approvals.yml
  documents/
    fraction-practice-01.yml
  media/
    great-courses-chemistry-01.yml
```

- `curriculum/units/` contains the learner-facing unit definitions.
- `curriculum/assets.yml` is the manifest for renderable visual assets. It is
  one manifest initially to make cross-file ID uniqueness and validation simple.
- `curriculum/sources.yml` contains bibliographic and private-source provenance
  records; a source is not a renderable asset.
- `curriculum/approvals.yml` binds reviewed content hashes to reviewer and
  timestamp. Metadata inside a file is not proof that its current bytes were
  reviewed.
- `documents/` contains reusable learning-document definitions.
- `media/` contains durable manifests that resolve current media locators.
- Existing `data/content/quizzes/*.yml`, language corpora, and material-source
  configuration remain where they are. The catalog references them by ID.

The private source archive and agent draft workspace are deliberately out of
scope for runtime path conventions. They must not be served to a learner or
copied into the deployed data catalog by default.

---

## 4. Canonical curriculum unit

### 4.1 Shape

```yaml
id: math.fractions.add-unlike-denominators.01
title: Adding unlike denominators
subject: math
strand: fractions
level: 3

objectives:
  - id: add-unlike-denominators
    label: Add fractions by finding a common denominator

classification:
  kind: lesson                    # lesson | practice | assessment | enrichment
  core: core                      # core | elective
  priority: 50                    # 0–100; higher is more urgent
  estimated_minutes: 25
  applicability:
    levels: [3]

prerequisites:
  - unit: math.fractions.equivalent-fractions.02
    outcome: completed

completion:
  all:
    - activity: fraction-assessment
      outcome: pass
      pass_percent: 80

retry:
  kind: equivalent-form            # same-form | equivalent-form | parent-review
  max_attempts: null

remediation:
  document: fraction-practice-01

activities:
  - kind: document
    id: fraction-practice
    document: fraction-practice-01
    target: letter
  - kind: assessment
    id: fraction-assessment
    bank: fraction-addition-01
    delivery: on-screen

provenance:
  source_refs: [source.third-grade-math.chapter-7]
```

### 4.2 Validation

`curriculumUnitValidation.mjs` is pure and returns a normalized whitelist. It
rejects unknown fields rather than preserving them. Required fields are `id`,
`title`, `subject`, `objectives`, `classification`, `activities`, and
`provenance`.

Rules:

- IDs use lowercase dotted identifiers and are unique across units.
- `subject` is one of the fixed IDs `english`, `writing`, `math`, `history`,
  `scripture`, `science`, `language`, `skills`, or `arts`. The registry must
  move to a shared School domain module before this validator ships, so backend
  validation and frontend shelving cannot diverge. `strand` is a free, readable
  grouping label and does not control navigation.
- `estimated_minutes`, if present, is a positive integer.
- `classification.core` is `core` or `elective`; `priority` is an integer from
  0 through 100; `applicability.levels` contains positive integer levels.
- `prerequisites` contains distinct known unit IDs and cannot form a cycle.
- `completion.all` names distinct activity IDs. A `pass` outcome has a pass
  percentage from 1 through 100. `retry.kind` is one of the closed values shown
  above and `max_attempts`, if supplied, is a positive integer.
- A curriculum completion rule cannot duplicate a material unit's existing
  quiz gate. Material sequencing and its bank backlink remain governed solely
  by the materials-category policy; curriculum completion describes only this
  unit's own activities.
- `activities` is non-empty. Every referenced document, bank, material ID, or
  programme resolves through the appropriate static catalog/index at validation
  time; live availability is checked only when the activity is accessed.
- `delivery` is `on-screen` in the first implementation. `paper-omr` and
  `parent-review` are rejected until their designs add their own validators and
  issuance contracts.
- `provenance.source_refs` is non-empty and every source reference resolves to
  `sources.yml`. A matching approval-manifest digest is required for publication.

The unit is a curriculum definition, not a mutable learner-progress record. It
contains no assigned learner, completion flag, scan token, printer destination,
reward, or current media session.

### 4.3 Activities are closed types

`activities[].kind` is a closed code-owned set:

| Kind | Required reference | Meaning |
|---|---|---|
| `document` | `document` | Render a reviewed learning document |
| `material` | `material_id`, optional `unit_id` | Consume an existing School material/unit |
| `assessment` | `bank` | Attempt a canonical question bank |
| `composition` | `assignment` | Draft and submit a reviewed composition assignment |
| `programme` | `programme` | Launch a named School programme |
| `instruction` | `document` | Offline or parent-led direction rendered from a document |

The runtime does not infer policy from activity order. The later planner/work
session design interprets a unit's sequence and activity graph. For now,
activities are ordered learner-facing components and validation confirms that
they are statically resolvable. `material_id` and `unit_id` are existing School
material IDs (for example `plex:...`), not a second playback/progress identity.
Durable media manifests are optional locator-repair metadata for a later media
resolver; they are not an alternate activity type in this first slice.

---

## 5. Asset and media manifests

### 5.1 Asset, source, and approval manifests

Every referenced visual or source has a stable internal ID and human-readable
metadata. The initial manifest permits only reviewed assets:

```yaml
assets:
  - id: visual.unit-circle.standard
    type: svg                       # svg | bitmap
    title: Standard unit circle
    alt: Unit circle with radians and common coordinates
    file: diagrams/unit-circle.svg
    checksum: sha256:...
    provenance:
      source_ref: source.openstax-prealgebra
      license: CC-BY-4.0
      reviewed_at: '2026-07-26T00:00:00.000Z'
      reviewed_by: parent

```

`file` is relative to `data/content/school/` and must resolve without escaping
that root. SVG and bitmap assets require `alt`, checksum, and a reviewed
provenance record. The loader uses realpath containment and rejects symlinks,
verifies the declared checksum and MIME signature before decoding, and enforces
configured byte, pixel, and dimension limits. SVG sanitization rejects scripts,
`foreignObject`, external URLs, external fonts, and external images.

`sources.yml` contains the non-renderable source records, including a source
title, owner/licence, private-archive locator hint, and optional acyclic parent
source. It must not expose or serve a purchased PDF from the runtime catalog.

`approvals.yml` is the review authority:

```yaml
approvals:
  - kind: document
    id: fraction-practice-01
    revision: 1
    sha256: ...
    dependency_digests:
      - asset: visual.unit-circle.standard
        sha256: ...
    reviewed_by: parent
    reviewed_at: '2026-07-26T00:00:00.000Z'
```

Published units, documents, assets, and media manifests require an approval
whose digest matches their current normalized bytes. Approval metadata in the
content file is descriptive only; a changed file must be re-approved.

### 5.2 Media manifest

```yaml
id: media.chemistry.atomic-structure.01
title: Atomic Structure
creator: The Great Courses
edition: How Chemistry Surrounds You
duration_ms: 1812000
locators:
  - kind: plex
    value: plex:123456
aliases:
  - Atomic Structure and the Periodic Table
provenance:
  source_refs: [source.chemistry-course]
  reviewed_at: '2026-07-26T00:00:00.000Z'
  reviewed_by: parent
```

At least one locator is required at publication. A future media resolver maps a
durable manifest to `{ status, materialId, unitId, locator }`; only that resolver
may bridge it to the existing materials framework. A missing current Plex
locator does not make the unit's identity meaningless, but it makes its activity
unavailable and must surface a clear configuration error. Locator repair may use
title, creator, edition, duration, hierarchy, and aliases; it never silently
changes a binding.

---

## 6. Learning-document grammar

### 6.1 Shape

```yaml
id: fraction-practice-01
title: Adding Unlike Denominators — Practice
revision: 1
variables:
  student_name: { type: string, required: false }
blocks:
  - id: introduction
    type: rich_text
    markdown: |
      Add each pair of fractions. Show your work.

  - id: example-equation
    type: math
    display: true
    latex: '\\frac{1}{3} + \\frac{1}{4} ='

  - id: work-space
    type: answer_space
    lines: 3

  - id: unit-circle
    type: asset
    asset: visual.unit-circle.standard
    caption: Use this reference when needed.

  - id: receipt-introduction
    type: rich_text
    markdown: Fraction practice is ready at the school printer.

targets:
  letter:
    blocks: [introduction, example-equation, work-space, unit-circle]
  thermal:
    blocks: [receipt-introduction]
```

`learningDocumentValidation.mjs` is pure. It validates document ID/revision,
variable declarations, uniquely named block schema, asset references, and each
target's independently compatible ordered block list. It returns a normalized
document; rendering never receives raw YAML. A block can be shared by multiple
targets, but a target never receives an incompatible block by fallback or silent
omission.

### 6.2 Supported blocks

| Block | Required fields | Initial target support |
|---|---|---|
| `rich_text` | `markdown` | Letter, thermal |
| `math` | `latex`; optional `display` | Letter |
| `asset` | asset ID; optional caption | Letter |
| `bank_item` | bank ID and item ID | Letter |
| `prompt` | constrained Markdown | Letter |
| `answer_space` | line count or height | Letter |
| `page_break` | none | Letter |

No raw HTML, arbitrary URL, SVG/XML string, JavaScript expression, or direct
filesystem path is valid block content. Markdown is constrained to the project
approved inline/block subset; links and HTML are disabled in initial rendering.
`bank_item` receives a canonical item by reference and builds distinct learner
and answer-key render models; answer-bearing bank objects never reach learner
rendering. `prompt` is explicitly ungraded. The first renderer rejects paper
conversion for `region_click` and any other bank item type without an explicit
paper renderer; `asset_choice` is added only with a design that defines its
learner and answer-key representations.

### 6.3 Math

- Math is LaTeX input rendered server-side into print-ready vector output. The
  implementation begins with a renderer spike rather than committing this spec
  to a package. The accepted renderer must pass a representative visual suite
  and embed no remote resources.
- Plot and geometry blocks are deferred. Their coordinate units, expression
  grammar, bounds, labels, dimensions, overflow policy, and SVG output contract
  must be separately designed before those block names enter the validator.
- Complex maps and historical/scientific diagrams are reviewed assets, not
  escape hatches for arbitrary embedded markup.

### 6.4 Variables and issued artifacts

Documents may only interpolate declared variables. At render time the caller
supplies a variable map; missing required variables and unexpected variables are
validation errors. Interpolation is text-only—never YAML, markup, or asset-path
construction.

Every rendered artifact receives an immutable issuance snapshot outside the
document body:

```text
artifactId, documentId, documentRevision, normalizedInputHash,
dependencyDigests, resolvedVariables, seed, rendererVersion, targetProfile
```

The application layer assigns `artifactId` and `renderedAt`, stores the complete
snapshot (with protected storage for any sensitive variable values), and freezes
the rendered bytes before quota/approval. The pure renderer receives normalized
document plus render context and returns bytes, page count, content hash, and
layout metadata.

---

## 7. Rendering architecture

### 7.1 Layers

| Layer | Responsibility |
|---|---|
| Domain | Validate/normalize units, manifests, and documents; resolve static references through supplied indexes |
| Application | Load catalog, resolve declared variables/assets, issue/freeze stable render context |
| Rendering | Measure/layout blocks and produce PDF or thermal raster/commands; no policy or I/O |
| Adapter | Read YAML/assets and send bytes/jobs to laser or thermal printer |

`WorksheetRenderer` is retired as the direct public renderer once the Letter
document renderer ships. A compatibility adapter converts an existing question
bank worksheet request into a generated normalized learning document, preserving
current print behaviour while preventing two independent layout engines.

`PrintService` is extended with a `document` printable type while retaining its
existing `bank` and `pdf` types:

```yaml
type: document
documentId: fraction-practice-01
revision: 1
target: letter
```

It renders and freezes the artifact before quota approval. A pending approval
stores the frozen bytes or the complete immutable issuance snapshot; approval
prints that exact artifact, never a later revision. `listPrintables()` uses
declared target metadata for unpersonalized listings and does not render every
possible personalized document merely to discover page count.

### 7.2 PDF and receipt targets

- **Letter PDF** uses measured pagination, adaptive but bounded type scaling,
  keep-together blocks, native/vector SVG embedding where supported, and
  separate answer-key generation.
- **Thermal** is an intentionally reduced target for agendas, instructions,
  outcomes, and recovery actions. `LearningDocumentReceiptRenderer` returns the
  existing thermal `PrintJob` POJO (`text`, `image`, `barcode`, `line`, `space`,
  `cut`), with a resolved printer profile passed into layout. It validates
  wrapping and character encoding against that profile. ESC/POS generation
  remains exclusively inside `ThermalPrinterAdapter`.
- Printer transports remain dumb. The laser adapter receives a PDF; the thermal
  adapter receives an already-rendered receipt/image/job; neither knows School
  curriculum semantics.

### 7.3 Failure behavior

The publication CLI performs exhaustive schema, approval-digest, and static
reference validation. Runtime catalog loading performs local structural/index
validation only: it must not resolve Plex, enumerate every lazy question bank,
or turn a media outage into a startup failure. Generated bank sources participate
through a registry `canResolve(id)` contract.

Runtime publishes a new immutable catalog snapshot only when the entire static
catalog validates. Invalid entries and their reverse dependents are quarantined
with an aggregate diagnostic; the previous good snapshot remains active. On a
cold start with no valid snapshot, School curriculum is unavailable with one
clear diagnostic rather than a half-mutated catalog. Live material/media/
programme availability is resolved when an activity is accessed and returns an
explicit `unavailable` state.

Render errors identify the document/block/target without emitting a partial
artifact. Printer delivery failures are outside the renderer and later work
sessions must surface retry/reprint actions. A render or print failure never
marks an activity complete.

---

## 8. Authoring and publishing workflow

1. Register a private source with licence/provenance information.
2. Extract/segment it into a draft workspace; agents may propose units,
   documents, assets, banks, and media bindings.
3. Validate all candidate YAML and render every target used by the candidate.
4. Human-review educational correctness, source fidelity, licence, answer keys,
   and visual output.
5. Promote only reviewed files and assets to `data/content/school/`, generate
   matching approval digests, and publish the resulting immutable catalog
   snapshot.
6. Runtime catalog reload validates the complete static snapshot and either
   swaps it atomically or keeps the prior good snapshot. It never quietly turns
   a broken lesson into a permissive/gated alternative.

This spec deliberately does not define the private archive tool, agent skill
implementation, review UI, or promotion command. It fixes the contract those
tools must produce and validate.

---

## 9. File and API inventory

| Path | Responsibility |
|---|---|
| `backend/src/2_domains/school/curriculumUnitValidation.mjs` | Unit validation, cycle detection inputs, normalized unit shape |
| `backend/src/2_domains/school/learningDocumentValidation.mjs` | Document/block/variable validation |
| `backend/src/2_domains/school/catalogValidation.mjs` | Cross-reference and catalog-wide uniqueness validation |
| `backend/src/3_applications/school/CurriculumCatalogService.mjs` | Load and resolve published catalog/read models |
| `backend/src/3_applications/school/RenderLearningDocument.mjs` | Resolve render context and invoke a target renderer |
| `backend/src/1_rendering/school/LearningDocumentPdfRenderer.mjs` | Pure Letter PDF layout/rendering |
| `backend/src/1_rendering/school/LearningDocumentReceiptRenderer.mjs` | Pure thermal receipt rendering |
| `backend/src/1_adapters/persistence/yaml/YamlSchoolDatastore.mjs` | Read published units, manifests, and documents |

No HTTP routes are added by this spec. Existing `PrintService` gains the frozen
`document` printable seam defined in §7; issuing documents for an agenda, OMR
forms, barcode actions, and work sessions are subsequent designs.

---

## 10. Test and acceptance criteria

### Domain and catalog tests

- Reject malformed/unknown unit, document, manifest, activity, and block data.
- Reject unresolved references, duplicate IDs, invalid targets, undeclared or
  unexpected variables, invalid completion/retry combinations, and sequence
  cycles.
- Reject a missing/mismatched approval digest, an unsafe/malformed image or SVG,
  and a target that selects an incompatible block.
- Confirm existing banks/materials can be referenced without changing their
  schemas.
- Confirm a failed runtime reload retains the previous good snapshot and
  quarantines broken entries plus reverse dependents.

### Rendering tests

- Golden PDF pages for long text/wrapping, page breaks, multi-block questions,
  LaTeX, SVG, raster assets, and answer space.
- Render a document twice with identical normalized input/context and assert
  equivalent layout metadata and deterministic artifact content hashes.
- Assert a thermal render returns a profile-compatible `PrintJob` and rejects a
  target that selects an unsupported block.
- Ensure answer keys are separate from learner copies and no answer data leaks
  into a learner worksheet through a bank reference.

### Acceptance slice

One reviewed fraction unit can be loaded from the catalog, resolve an existing
bank and reviewed visual asset, render a Letter practice PDF with math and answer
space, render a separate thermal instruction receipt, freeze a document artifact
through the print approval path, and report precise validation errors for a
broken reference. No scanner, work-session, reward, or new learner UI is
required for this slice.

---

## 11. Explicit deferrals

- Assignment scheduling, daily agendas, personal scan cards, opaque action-token
  storage, and work-session state.
- OMR form geometry, mark decoding, relay deployment, paper identity, and
  scan-to-grade flow.
- Media dispatch/completion correlation and playback target selection.
- Parent review/sign-off, reassignment UI, and economy award execution.
- Reading/EPUB rendering and an interactive document viewer.
- OMR response blocks, scan/media action blocks, plot/geometry blocks, a general
  graphing calculator, geometry editor, arbitrary SVG/HTML/TikZ, arbitrary
  remote media, and arbitrary unreviewed agent-generated curriculum.
