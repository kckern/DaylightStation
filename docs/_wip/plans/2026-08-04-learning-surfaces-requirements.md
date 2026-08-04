# Learning Surfaces product requirements

> **Status:** v1 requirements draft. This is the canonical scope and boundary
> document for surface certification and content routing across DaylightStation
> School. It generalizes the contract SchoolCalc proved for calculators
> ([`schoolcalc-requirements.md`](../../../_extensions/ti86-app/docs/schoolcalc-requirements.md))
> to every place learning content can land: calculators, paper, household
> screens, and companion media dispatched to other devices. Family-specific
> documents (SchoolCalc, OMR, Print) refine this contract; they do not override
> it.

## 1. Product definition

DaylightStation School has one authored content corpus
(`data/content/school`) and many **learning surfaces** — places where a child
actually encounters the work:

1. **Calculators** (SchoolCalc: TI-86 today, other families later) — tiny
   text-only offline devices with strict byte, character, and interaction
   limits.
2. **Paper** — laser-printed worksheets, quizzes, and reading sheets; can carry
   vector/bitmap art, barcodes, and OMR bubble grids; answers return through
   the OMR scanner; grading is deferred and server-side.
3. **Screens** — the on-screen School app (Portal, kiosks, browsers) with full
   interactivity, audio, and video.
4. **Dispatch targets** — household playback devices (living-room TV, garage
   display, audio zones) that cannot browse the catalog themselves but can
   receive launched media; and physical references (library books) that no
   surface renders at all.

Today only calculators have a formal fitness contract: content is compiled
through an adapter that refuses what the device cannot present, and the
Catalog annotates every lesson with a verdict and reasons. Paper and screens
route content by convention and discover mismatches at runtime, or not at all.

This product introduces one **unified certification language** governing which
content may be offered on which surface, and one **routing model** for how
certified work reaches a surface and how its results come back. Certification
is the fitness verdict; routing is the movement. Both are backend-owned.

The product comprises five cooperating parts:

1. a shared **capability vocabulary** that content demands and surfaces offer;
2. **surface profiles** — data records describing what each surface offers;
3. a per-family **certification port** every surface adapter implements,
   producing verdicts with reasons;
4. a **certification projection** the Catalog, Print Center, SchoolCalc sync,
   and screen app all consult before offering work; and
5. a **certifier CLI** ("the linter") that verifies any authored YAML against
   any surface, at authoring time and as the publication gate.

## 2. Product principles

The following are requirements, not implementation preferences. They extend
the SchoolCalc principles; where SchoolCalc already states one, it applies
here unchanged.

- **One corpus, many surfaces.** Content is authored once, in surface-neutral
  YAML, and certified per surface. There are no per-surface forks of a lesson;
  a surface-specific *projection* of neutral content is an adapter concern.
- **Certification precedes offering.** A surface never lists, prints,
  installs, or launches content it is not certified for. Runtime
  "unsupported" screens remain as last-resort guards; reaching one is a
  defect, not a UX path.
- **Rejected, never silently dropped.** When content cannot go to a surface,
  the verdict is visible and carries human-readable reasons — to the child
  where actionable ("this one is for the screen"), and to the author always.
- **Capabilities are exact published contracts.** `name@version` identifies
  one exact schema/behavior. A future incompatible version is a different
  capability; compatibility is never guessed (existing rule, now global).
- **Demands derive from content; offers derive from surfaces.** Authors do not
  hand-pick surfaces, and surfaces do not hand-pick lessons. Authored content
  implies or declares *demands*; a surface profile states *offers*; the
  certification port compares them. Curation (assignment, visibility,
  governance) is a separate policy layer on top of certification, never a
  substitute for it.
- **One certifier, everywhere.** The CLI, the publication gate, and the
  runtime projection all call the same production certification port. A
  parallel "lint implementation" that can drift from what delivery actually
  does is prohibited.
- **Render and dispatch are distinct verdicts.** A surface either *renders*
  content itself or *dispatches* it to another surface (a QR on paper that
  starts a video on the TV). Both are legitimate certified outcomes; they are
  never conflated. A physical reference (library book) is dispatch-only
  everywhere.
- **Fail closed.** Unknown module types, unknown block types, undeclared
  asset kinds, and unknown capability IDs make certification fail with a
  reason. Nothing unknown is presumed presentable.
- **Server state is authoritative.** Grading, progress, attribution,
  idempotency, and the certification verdict itself are backend decisions.
  A surface's local score is evidence to verify, never truth (existing
  SchoolCalc rule, now global).
- **Subject-neutral throughout.** Certification reasons speak in capabilities
  and limits, never subjects. Architecture tests extend the existing
  no-subject-vocabulary rule to all certification code.
- **Results converge.** Every surface's return channel (cable, QR, OMR scan,
  web session) ends in the same server-side grading and progress records for
  the same addressed content. New surfaces add return adapters, not new
  grading.

## 3. The capability vocabulary

### 3.1 Grammar

- A capability ID matches the existing pattern `name@version`
  (`CAPABILITY_ID_PATTERN`); the name may contain dots. IDs are opaque exact
  strings; the dot convention below aids reading and tooling but carries no
  matching semantics.
- Already-published IDs are grandfathered contracts and are not renamed:
  `reader@1`, `quiz@1`, `graph@1`, `calculator@1`, `table@1`, `solver@1`,
  `matrix@1`, `equation-editor@1`, `native-program@1`, `math@1`,
  `table-layout@1`, `image@1`, `scan-action@1`, and the registered
  tool/custom module capabilities.
- New capabilities introduced by this product use namespaces:

| Namespace | Meaning | Examples |
| --- | --- | --- |
| `content.*` | Ability to present a module/block family | `content.activity.matching@1` |
| `asset.*` | Ability to present a referenced asset kind beyond static images | `asset.audio@1`, `asset.video@1` |
| `action.*` | Ability to present an outbound action | `action.qr.display@1`, `action.qr.print@1` |
| `capture.*` | Ability to capture learner responses | `capture.omr.choice@1`, `capture.keys@1`, `capture.pointer@1` |
| `return.*` | Ability to return results to the server | `return.session@1`, `return.qr@1`, `return.cable@1`, `return.scan@1` |

- The capability registry (the set of IDs the backend recognizes) is code,
  reviewed and versioned. Content referencing an unregistered capability
  fails publication, exactly as unregistered tool/custom capabilities do
  today.

### 3.2 Demand derivation

A module's **demand set** is derived, in one pure domain function, from:

1. its module type (each registered module type maps to implied
   capabilities — the existing implied-capability mapping, made total);
2. its declared `requiredCapabilities` (already in the lesson schema);
3. its document blocks (`capabilityForLearningDocumentBlock` today:
   `formula`+latex → `math@1`, `table` → `table-layout@1`, `asset` →
   `image@1` or `asset.<kind>@1` per §5.5, `scan_action` → `scan-action@1`,
   `tool_invitation` → its named capability) and its bank item shapes
   (image-bearing items demand `image@1`; `region_click` demands
   `capture.pointer@1`);
4. its tracking class: a tracked module (quiz, problems, probe, flashcards,
   activity) additionally demands *at least one* `capture.*` and one
   `return.*` offer on the surface. This is the only place a demand is a
   class rather than an exact ID, and it is resolved by the certification
   port, not by extending the exact matcher.

A lesson's demand set is the union of its modules' demands (already the
aggregation rule in catalog validation).

## 4. Surface profiles

### 4.1 Profile record

A surface profile is data, not code:

```yaml
schema: school.surface-profile/v1
surfaceId: paper-letter-mono          # stable, lowercase, unique
family: schoolcalc | paper | screen | dispatch
title: Laser worksheets (letter, mono)
liveness: static | observed
capabilities:
  - reader@1
  - quiz@1
  - image@1
  - math@1
  - table-layout@1
  - scan-action@1
  - action.qr.print@1
  - capture.omr.choice@1
  - return.scan@1
limits:                               # family-defined keys, validated by the family adapter
  omrChannels: 12
  maxItemsPerSheet: 25
  maxPagesPerDocument: 20
```

- **`liveness: static`** — the profile is authored configuration (paper, most
  screens, dispatch targets). It lives in the data mount alongside other
  household config and is loaded through the config service.
- **`liveness: observed`** — the profile is asserted by a device capability
  report at sync time (SchoolCalc devices today). The observed report is
  validated against the family's approved capability list, exactly as the
  TI-86 adapter does now.
- Screens are profiled **per screen**, not "the web": the garage display, the
  office kiosk, and a tablet may offer different `asset.*`/`capture.*` sets.
  A screen's profile is derived from its screen configuration; the School app
  resolves the profile for the mount it is running on.
- **Dispatch targets** are surfaces with (typically) no `content.*` offers and
  no `capture.*` offers — only playback (`asset.video@1`, `asset.audio@1`).
  A physical reference target (the library) offers nothing and exists so that
  dispatch verdicts have an addressee; see §7.3.

### 4.2 Surface registry

The backend owns one registry of surface profiles: static profiles from
configuration plus observed profiles from enrolled devices. The registry is
the single source the certification projection iterates. Adding a surface is
adding a profile (and, for a new *family*, an adapter — §7.1); it is never a
content change.

## 5. Authored content data spec

This section is the concrete YAML contract. §5.1–§5.4 document the shapes
that already exist and validate today; §5.5–§5.7 are the v1 additions. All
IDs are lowercase (`^[a-z0-9][a-z0-9-]{0,63}$`); references may additionally
contain `:._/` up to 128 chars.

### 5.1 Corpus layout

```
data/content/school/
  <subject-dir>/<course-dir>/…        # legacy quizzes/banks, unchanged
  catalog/
    catalogs/<catalogId>.yml          # school.catalog/v1
    documents/<documentId>.yml        # school.learning-document/v1
    question-banks/<bankId>.yml       # question bank schema
    assets/<assetId>.(svg|png|…)      # referenced by asset blocks   [v1: new]
    surfaces/<surfaceId>.yml          # school.surface-profile/v1    [v1: new]
    ti86-packs/…                      # compiled artifacts (generated, not authored)
```

### 5.2 Catalog and lessons (`school.catalog/v1`)

```yaml
schema: school.catalog/v1
catalogId: main
title: …
description: …                        # optional
tags: [ … ]                           # optional
installSets: [ … ]                    # optional, lesson-address groups (unchanged)
subjects:
  - subjectId: science
    title: Science
    courses:
      - courseId: water-cycle
        title: Water Cycle
        estimatedMinutes: 8           # optional
        units:
          - unitId: water-moves
            title: Water Moves
            lessons:
              - lessonId: evaporation
                title: Evaporation and Condensation
                shortTitle: Water Changes        # optional presentation hint
                objectives: [ … ]                # optional strings
                requiredCapabilities: [ … ]      # optional exact IDs
                areaIds: [ … ]                   # optional metadata
                classifications: [ … ]           # optional metadata
                tags: [ … ]                      # optional metadata
                modules: [ … ]                   # ≥1, closed types below
```

**Module types** (closed set; anything else fails publication):

| type | Required fields | Notes |
| --- | --- | --- |
| `lecture_notes` | `documentId` | references a learning document |
| `examples` | `examples[]` with `exampleId`, `prompt`, `steps[]` | ordered worked steps |
| `problems` | `bankId` | practice/drill over a bank |
| `flashcards` | `bankId` or inline cards | front/back study |
| `quiz` | `bankId`, `passingPercent` | one-pass scored assessment |
| `learning_probe` | inline items (≤12 on calc) | immediate-feedback check |
| `activity` | activity kind + config | matching, sorting, sequencing, timed-drill, memory |
| `tool` | `capability`, `config` | registered native tool (calculator@1, graph@1, …) |
| `custom` | `capability`, `config` | registered custom interactive |
| `media` | `media{}` | **new, §5.6** — external/AV reference |

Every module has `moduleId` and optional `title` (surfaces supply neutral
fallback titles for untitled modules, as the TI-86 adapter does today).

### 5.3 Learning documents (`school.learning-document/v1`)

```yaml
schema: school.learning-document/v1
documentId: starter-science-water-cycle
title: …
blocks: [ … ]                         # ≥1, closed types below
```

**Block types** (closed set, existing): `heading`, `prose`, `definition`
(`term`+`definition`), `formula` (`text`, optional `latex` → demands
`math@1`), `worked_example` (`prompt`, `steps[]`, optional `result`),
`table` (`columns[]`, `rows[][]`, all non-empty strings, unique columns →
demands `table-layout@1`), `callout` (`tone: info|tip|warning`, `text`),
`asset` (§5.5), `scan_action` (§5.7), `tool_invitation` (`capability`,
`label`, `config` → demands its capability).

### 5.4 Question banks

```yaml
id: starter-math-ten-percent
title: …
audience: generic | assigned
items:
  - id: q1
    type: multiple_choice             # closed set below
    prompt: …
    choices: [ … ]                    # strings, or {label|image} for asset_choice
    answer: …                         # SERVER-SIDE answer key; never shipped in cleartext
    concepts: [ … ]                   # optional concept IDs for remediation
```

**Item types** (closed set, existing): `multiple_choice`, `short_answer`,
`cloze`, `matching`, `region_click` (image + target region → demands
`image@1` + `capture.pointer@1`), `asset_choice` (choices may be
`{image: {…}}` → demands `image@1`).

### 5.5 Asset blocks and asset kinds (v1 extension)

The existing `asset` block (`assetId`, required `alt`) gains two optional
fields; absent, behavior is exactly today's (`kind: image`, required):

```yaml
- blockId: cell-diagram
  type: asset
  assetId: cell-diagram-v2            # must resolve to a real file under catalog/assets/
  alt: A labelled plant cell          # required, existing
  kind: image | audio | video        # default image
  required: true | false              # default true
```

- `kind: image` demands `image@1` (grandfathered; covers svg and bitmap —
  which the surface can rasterize is a family concern, not vocabulary).
  `audio`/`video` demand `asset.audio@1`/`asset.video@1`.
- `required: false` marks decoration: a surface lacking the capability is
  still certified to render the block's siblings and omits the asset (with a
  projection warning). A required asset that cannot be presented fails the
  module's render verdict with a reason.
- Publication validates that `assetId` resolves to a real file whose format
  matches the declared kind; dangling or mismatched asset references fail
  publication, like every other dangling reference.

### 5.6 Media reference modules (v1 extension)

One new module type for external/AV content:

```yaml
- moduleId: watch
  type: media
  title: "Watch: The Water Cycle"
  media:
    kind: video | audio | book
    ref: "plex:483194/483215"         # or a library/book reference for kind: book
    durationMinutes: 12               # optional
  completion: attest | played         # book ⇒ attest only; av defaults to played
```

- Kind `video` demands `asset.video@1` to **render**; `audio` demands
  `asset.audio@1`; `book` renders nowhere.
- Any surface offering `action.qr.*` (or an on-screen launch affordance) can
  be certified to **dispatch** the module instead (§7.3).
- Completion for `played` comes from the existing playback progress pipeline;
  `attest` is a server-recorded attestation (who may attest is governance
  policy, outside this spec).
- Publication validates the ref shape; certification validates it resolves
  (§7.3).

### 5.7 Companion actions

The existing `scan_action` block (`actionId`, `label`; tokens and QR modules
are server-issued and must not be authored — existing rule) generalizes: its
target vocabulary becomes the same neutral action language the portal-launch
pipeline already consumes (launch a bank, a program, a media ref, mark
progress). One resolver executes a scanned/tapped action regardless of which
surface presented it (SchoolCalc's action resolver is the seed). A companion
action inside otherwise-renderable content never blocks certification of the
content itself; a surface that cannot present actions omits them with a
warning.

## 6. Disqualification conditions

What keeps content off a surface. Conditions marked **existing** are
enforced today (calculator: in the codec; paper/screen: nowhere — making
them enforced *before offering* is the point of this product). Numbers are
the current published limits; families own their numbers and may revise them
in their refining documents without changing this contract.

### 6.1 Every surface (publication-level, content is unpublishable)

- Unknown `schema`, module type, block type, or item type. **existing**
- Unregistered or malformed capability ID anywhere. **existing**
- Dangling references: `documentId`, `bankId`, `assetId`, catalog addresses,
  install-set members. **existing** (assets: v1)
- Executable-shaped fields in content (downloaded data is non-executable).
  **existing**
- Authored server-issued fields (`token`, `qrModules` on scan_action).
  **existing**
- A lesson certified `none` on every registered profile (§7.4). *(v1)*

### 6.2 Calculator (TI-86; other families analogous)

| Condition | Limit / rule | Status |
| --- | --- | --- |
| Missing required capability | exact-match vs device report (`image@1`, `math@1` etc. are absent on TI-86 → any required asset/latex/table content disqualifies) | existing |
| Lesson artifact size | > 12,288 bytes hard (8,192 target ⇒ warning) | existing |
| Module count | > 128 modules per lesson | existing |
| Assessment size | > 48 items; probe > 12 items | existing |
| Choice shape | > 5 choices; choice text > 23 chars | existing |
| Reader blocks | block type outside heading/prose/definition/formula(text)/worked_example/callout | existing |
| Non-text assets, AV | always disqualify **render**; `media` + scan_action may certify **dispatch** via QR | v1 |
| Tool mapping | `tool`/`custom` capability with no native mapping on this family | existing |
| Whole-lesson rule | any module `incompatible` ⇒ lesson not installable (family tightening, §7.2) | existing |

### 6.3 Paper

| Condition | Rule |
| --- | --- |
| AV content | `asset.audio/video` never renders; `media` modules certify dispatch-only (printed QR) |
| Interactivity | `tool`, `custom`, `activity`, `region_click`, `learning_probe` (feedback loop) do not render; probe/activity may be re-authored as banks if wanted on paper |
| OMR capture | a **tracked quiz** requires every item `multiple_choice`/`asset_choice` with ≤ `omrChannels` (12) choices and a printable label per bubble; `short_answer`/`cloze`/`matching` items make the quiz render-only (worksheet without machine capture) with a reason |
| Sheet budget | items per sheet > `maxItemsPerSheet`; document pages > `maxPagesPerDocument` (20, aligned with the print job ceiling) |
| Assets | `image` kind renders (svg/bitmap); missing/corrupt asset file fails at publication |
| Quota | print quota (`printing.mjs`) is a *routing-time* policy, never a certification input |

### 6.4 Screen (per screen profile)

| Condition | Rule |
| --- | --- |
| Runner availability | module type/capability with no registered runner on this screen's profile (replaces the hardcoded launch switch; `learning_unsupported` becomes a stale-cache guard) |
| AV | `asset.video@1`/`asset.audio@1` present per screen (an audio-only zone or a muted kiosk omits them) |
| Pointer capture | `region_click` requires `capture.pointer@1` (absent on remote-only screens) |
| Tracked work | requires `return.session@1` and a claimable identity (guest policy is routing/governance, not certification) |

### 6.5 Dispatch (any presenting surface → any target)

| Condition | Rule |
| --- | --- |
| Presenter | must offer `action.qr.print@1` / `action.qr.display@1` (or native launch affordance) |
| Target exists | at least one registered surface renders the module (or, for `book`, the physical-reference target) |
| Ref resolves | `plex:`/library refs must resolve at certification time; a dead ref disqualifies dispatch with a reason |
| Books | never render anywhere; dispatch = printed/displayed pointer (title, call number, cover) + attestation completion |

## 7. Certification

### 7.1 The certification port

Every surface **family** ships one adapter implementing one port:

```
certify(bundle, profile) -> {
  modules: [{ moduleId, verdict: render | dispatch | incompatible,
              reasons: string[],              # for incompatible/dispatch
              warnings: string[] }],          # omitted decorations etc.
  lesson: { verdict: full | partial | dispatch | none },
  resource?: { estimatedBytes | pages | minutes, limitsApplied }
}
```

- Input is the existing device-neutral lesson bundle (`BuildLearningLesson`
  output) plus one surface profile. No I/O beyond asset stat/ref resolution
  supplied by the caller; deterministic; safe to run at publication over
  every profile.
- The exact-match capability comparison (`missingCapabilities`) is the shared
  first pass. Family adapters add their structural checks — byte ceilings and
  module counts for calculators (exactly today's `supports()`), page/item/
  channel layout for paper, registry-backed runner availability for screens.
- The TI-86 codec's `supports()` becomes this port's calculator
  implementation with no behavior change; its whole-lesson artifact rule is
  preserved as family policy (§7.2).

### 7.2 Verdict roll-up

- Certification is decided **per module**; the lesson verdict is a roll-up:
  `full` (all modules render), `partial` (some render), `dispatch` (nothing
  renders, something dispatches), `none`.
- A family may tighten the roll-up for its delivery mechanics: SchoolCalc
  keeps full-or-nothing per lesson artifact. Paper and screens offer partial
  lessons: the Print Center prints the printable modules; the screen runs the
  runnable ones. A partial offer always shows what was left out and where it
  can be done.
- Roll-up policy is pure domain code shared by all families; the tightening
  is a declared family flag, not a fork.

### 7.3 Dispatch verdicts

A module is certified `dispatch` on a surface when the three §6.5 conditions
hold (presenter capability, renderable target elsewhere, resolvable ref).
The verdict names its fulfillment surface(s). A book's only
non-incompatible verdict anywhere is `dispatch`.

### 7.4 Certification projection and manifest

- One application use case answers: for a content address (lesson or module)
  and optionally a surface, the matrix
  `{surfaceId, verdict, reasons, warnings, resource}`.
- At **publication**, the certifier (§8) runs the whole mounted corpus
  against every registered static profile and writes a certification manifest
  keyed by content digest + profile digest. Publication fails on schema
  errors as today; a lesson certified `none` everywhere is a publication
  error (content nobody can ever receive is authored in error).
- At **runtime**, consumers read the manifest; observed-profile surfaces
  (calculators) recompute against the live capability report exactly as the
  SchoolCalc catalog projection does now. Manifest entries are invalidated by
  content digest or profile digest change, nothing else.

## 8. The certifier CLI

One command (working name `school:certify`, superseding and wrapping
`schoolcalc:validate`) is the author's linter, the CI gate, and the manifest
writer. It calls the production certification ports — never a parallel
implementation.

```
school:certify                            # whole corpus × all registered static profiles
school:certify --file <path.yml>          # one catalog/document/bank/profile file
school:certify --address main/science/…  # one lesson/module address
school:certify --surface paper-letter-mono [--surface …]   # restrict profiles
school:certify --json                     # machine-readable report
school:certify --write-manifest           # publication mode (default in CI/deploy)
```

Behavior:

- **Validation pass** (schema + references, aggregated — today's eager walk):
  every error reported, exit nonzero, nothing certified on schema failure.
- **Certification pass**: per content address × profile, print the matrix —
  verdict, reasons, warnings, resource estimates. Human output is a compact
  table; `--json` emits `{address, surfaceId, verdict, reasons[],
  warnings[], resource}` records.
- **Exit codes**: `0` all published content certifies somewhere and the
  requested scope has no errors; `1` schema/reference errors; `2` content
  certified `none` everywhere (or, with `--surface`, `none` on every
  requested surface — the "will this work on X?" authoring question).
- Warnings (omitted decorations, above-target sizes) never fail the gate;
  they are always printed.
- An observed-profile family (calculator) certifies in the CLI against its
  family's **approved capability baseline** (the same list device reports
  are validated against), clearly labeled as a baseline, since real devices
  report at sync time.
- The certifier is what the delivery matrix calls evidence: its `--json`
  output is stable enough to diff in CI and to retain as case artifacts.

## 9. Routing

Routing consumes certification; it never overrides it.

- **Catalog browsing (screen).** The learning catalog annotates every lesson
  with its surface matrix (badges: calculator / paper / this screen /
  dispatch). The screen app consults the *current screen's* certification
  before launch; `learning_unsupported` remains only as a guard for stale
  caches.
- **SchoolCalc sync.** Unchanged: the calculator catalog is the calculator
  projection of the same matrix, with install/update/request states layered
  on the `render` verdict.
- **Print Center.** Offers exactly the paper-certified work (banks and
  document modules with `render` on the paper profile), through the existing
  issue pipeline (tokens, form maps, quotas). A paper quiz's OMR layout
  feasibility is part of paper certification, not discovered at render time.
- **Dispatch.** A certified `dispatch` verdict materializes as a companion
  action: a QR printed on paper or shown on the calculator/screen, resolved
  by the shared action resolver (§5.7) into the existing household launch
  pipeline. Dispatch execution records who launched what, where, against
  which content address.
- **Results return.** Each family keeps its return channel — web sessions,
  OMR scan → paper grading, QR/cable → result importer — and each channel
  ends in the same grading (`gradeAnswer`), the same progress statuses, and
  the same per-learner records, addressed by the same content IDs. A module
  certified `render` on a surface with no viable return path for its tracking
  class is not certified (§3.2 item 4); this is checked at certification
  time, never discovered after a child finishes the work.

## 10. Backend and DDD ownership

| Layer | Owns |
| --- | --- |
| Domain (`2_domains/school`) | Capability grammar (existing), demand derivation, profile validation, verdict/roll-up shapes and policy — all pure |
| Application (`3_applications/school`) | Surface registry, certification projection + manifest lifecycle, routing use cases, action resolution |
| Adapters (`1_adapters`) | Per-family certification ports (calculator codecs, paper renderer, screen runner registry), return-channel importers, profile observation |
| Rendering (`1_rendering`) | Paper layout/drawing behind the existing renderer port; layout *feasibility* logic it shares with certification lives where the paper adapter can run it without printing |
| CLI | `school:certify` — thin shell over the application projection |
| Data mount | All authored content, assets, static surface profiles, certification manifest |

Frontend consumes certification; it never computes it. The screen app's
module-type switch is replaced by a registry lookup driven by the same
capability IDs the backend certified against.

## 11. Integrity and failure behavior

- Certification never throws for "content doesn't fit"; it returns
  `incompatible` with reasons. It throws only for malformed inputs (invalid
  bundle, invalid profile), which are publication/enrollment defects.
- A missing or stale manifest degrades to on-demand certification, never to
  offering unverified content.
- Verdicts, reasons, and dispatch executions are logged with content address
  and surface ID, so "why can't I see this here?" is answerable from logs.
- Removing a capability from a profile (or a device report shrinking) flips
  affected verdicts on next projection; already-delivered work is not
  retracted, but re-offering requires re-certification (matches SchoolCalc's
  install/update model).

## 12. v1 acceptance

1. `school:certify` runs the starter catalog against the TI-86 baseline, one
   paper profile, and two screen profiles from one command, with the
   ten-percent lesson `full` on all and an oversized synthetic lesson
   `incompatible` on TI-86 carrying today's byte-limit reason unchanged.
2. A lesson containing a `media` video module certifies `partial` on TI-86
   (modules render, media dispatches via QR), `full` on a video-capable
   screen, `partial` on paper; the printed QR launches the video on a
   household target through the existing dispatch pipeline, and the launch is
   recorded.
3. A question bank exceeding the paper profile's channel/item limits is
   absent from the Print Center, with the reason visible in the certifier
   report; a conforming bank prints, scans, and grades through the existing
   OMR pipeline untouched.
4. The screen app launches only modules certified for its own profile; the
   `learning_unsupported` guard is unreachable in the acceptance walk.
5. A book-kind media module never certifies `render` anywhere, certifies
   `dispatch` on paper and calculator (pointer + attestation), and its
   attestation records completion.
6. Architecture tests reject subject vocabulary and layer violations across
   all new certification code; every family adapter passes one shared
   certification-port contract suite (extending the existing simulated
   second-family lifecycle suite).
7. Publication fails, with aggregated reasons, for: unregistered capability
   IDs, dangling asset refs, kind-mismatched assets, and content certified
   `none` on every registered profile. `--json` output is byte-stable across
   runs on unchanged content (fit for CI diffing).

## 13. Explicitly outside v1

- Automatic surface *selection* ("route this child's quiz to the best
  surface") — v1 certifies and offers; humans choose.
- Mid-activity cross-surface handoff (start on calc, finish on screen).
- New calculator families, new paper form factors beyond the current
  reader/printer, and any new runner types on screens.
- Commerce/licensing semantics of any kind.
- Retroactive re-rendering of already-issued paper or already-installed
  calculator artifacts when content changes (existing update flows apply).
- i18n of certification reasons (English copy, structured codes).
- Re-authoring probes/activities into paper-capable forms (§6.3 notes the
  door; nothing walks through it in v1).

## 14. Refining documents

- SchoolCalc: `_extensions/ti86-app/docs/schoolcalc-requirements.md` and its
  delivery matrix (the calculator family's refinement of this contract).
- OMR reader and paper pipeline: `docs/reference/omr/README.md`.
- School app and portal: `docs/reference/school/README.md`.
- On acceptance, the endstate of this document is folded into
  `docs/reference/school/` per the reference-docs convention; this file then
  moves to `_archive/`.
