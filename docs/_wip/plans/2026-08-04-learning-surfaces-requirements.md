# Learning Surfaces product requirements

> **Status:** v1 requirements, revision 2 (post-review). This is the canonical
> scope and boundary document for surface certification and content routing
> across DaylightStation School. It generalizes the contract SchoolCalc proved
> for calculators
> ([`schoolcalc-requirements.md`](../../../_extensions/ti86-app/docs/schoolcalc-requirements.md))
> to every surface that *renders* learning content: calculators, paper, and
> screens. Cross-surface **dispatch** (QR-launched companion media, external
> AV, library books) is deliberately deferred to a v2 spec; §14 records the
> v2 outline so v1 decisions don't foreclose it. Family-specific documents
> (SchoolCalc, OMR, Print) refine this contract; they do not override it.
>
> **Revision 2 changes:** capability vocabulary reconciled against the full
> published-ID inventory in code (no renames, no duplicates); dispatch removed
> from the per-family port and from v1 scope; the calculator baseline constant
> named; the certification-time byte check acknowledged as a behavior change;
> §5 shapes corrected against the validators; publication-gate semantics
> softened for currently-runnerless content; CLI exit semantics split into
> gate vs query modes; acceptance restated as falsifiable matrix properties.

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

Today only calculators have a formal fitness contract: content is compiled
through an adapter that refuses what the device cannot present, and the
Catalog annotates every lesson with a verdict and reasons. Paper and screens
route content by convention and discover mismatches at runtime, or not at all.

This product introduces one **unified certification language** governing which
content may be offered on which surface, and one **routing rule** — offers
consume certification — for how certified work reaches a surface and how its
results come back. Certification is the fitness verdict; routing is the
movement. Both are backend-owned.

The product comprises five cooperating parts:

1. a shared **capability vocabulary** that content demands and surfaces offer
   — almost entirely the vocabulary already published in code (§3);
2. **surface profiles** — data records describing what each surface offers;
3. a per-family **certification port** every surface adapter implements,
   producing per-module render verdicts with reasons;
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
  **The published vocabulary is not renamed** (§3.1); this spec adds IDs, it
  never replaces one.
- **Demands derive from content; offers derive from surfaces.** Authors do not
  hand-pick surfaces, and surfaces do not hand-pick lessons. Authored content
  implies or declares *demands*; a surface profile states *offers*; the
  certification port compares them. Curation (assignment, visibility,
  governance, print quotas) is a separate policy layer on top of
  certification, never a substitute for it — and never an input to it.
- **One certifier, everywhere.** The CLI, the publication gate, and the
  runtime projection all call the same production certification port. A
  parallel "lint implementation" that can drift from what delivery actually
  does is prohibited.
- **Fail closed.** Unknown module types, unknown block types, unknown item
  types, and unknown capability IDs make certification fail with a reason.
  Nothing unknown is presumed presentable.
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

### 3.1 Published inventory (grandfathered, never renamed)

A capability ID matches the existing pattern `name@version`
(`CAPABILITY_ID_PATTERN`); the name may contain dots. IDs are opaque exact
strings. The following are **already published in code** and are adopted
verbatim — every one is load-bearing in bundle digests, artifact identities,
or device reports, so none is renamed or aliased:

| Group | IDs | Source of truth |
| --- | --- | --- |
| Module presentation | `reader@1`, `examples@1`, `problems@1`, `flashcards@1`, `quiz@1`, `learning-probe@1`, `activity.matching@1`, `activity.sorting@1`, `activity.sequencing@1`, `activity.timed-drill@1`, `activity.memory@1` | `capabilityForLearningModule` |
| Item response capture | `response.choice@1`, `response.text@1`, `response.matching@1`, `response.region@1`, `response.asset-choice@1` | `capabilityForQuestionItem` (`ITEM_CAPABILITIES`) |
| Document blocks | `math@1`, `table-layout@1`, `image@1`, `scan-action@1` | `capabilityForLearningDocumentBlock` |
| Registered tools | `calculator@1`, `graph@1`, `table@1`, `solver@1`, `matrix@1`, `equation-editor@1`, `native-program@1` | core `LearningModuleRegistry` |
| Family/channel | `cable-sync@1`, `qr-output@1`, `shell-core@1` | TI-86 codec capability lists |

Registered custom-module capabilities (injected definitions) are likewise
grandfathered by construction.

**Response capture is item-granular by design.** A surface that can capture
multiple-choice marks but not free text offers `response.choice@1` and not
`response.text@1`. There is no coarse "capture" class; matching is the
existing exact `missingCapabilities` comparison. (This resolves what a
capture-class rule could not: an OMR-only surface must never certify a
text-answer quiz.)

### 3.2 New IDs introduced by this product

One new namespace, plus profile-only reuse of existing IDs:

| ID | Meaning |
| --- | --- |
| `return.session@1` | Surface returns results through an authenticated live app session |
| `return.scan@1` | Surface returns results through OMR sheet scanning |
| `return.cable@1` | Surface returns results through relay/cable sync |
| `return.qr@1` | Surface returns results through QR self-report |

The capability registry (the set of IDs the backend recognizes) is code,
reviewed and versioned. Content referencing an unregistered capability fails
publication, exactly as unregistered tool/custom capabilities do today.
Dispatch-related namespaces (`action.*`) are reserved for the v2 spec (§14)
and are not registered in v1.

### 3.3 Demand derivation

A module's **demand set** is derived, in one pure domain function, from
existing per-piece derivations plus one new rule:

1. its module type → `capabilityForLearningModule` (existing);
2. its declared lesson-level `requiredCapabilities` (existing);
3. its document blocks → `capabilityForLearningDocumentBlock` (existing:
   `formula`+latex → `math@1`, `table` → `table-layout@1`, `asset` →
   `image@1`, `scan_action` → `scan-action@1`, `tool_invitation` → its named
   capability);
4. its resolved bank items → `capabilityForQuestionItem` (existing; image-
   bearing items additionally demand `image@1`);
5. **new:** its tracking class — a tracked module (quiz, problems,
   learning_probe, flashcards, activity) demands *at least one* `return.*`
   offer on the surface. This is the only class-shaped demand in the system;
   it is resolved by the certification port (which knows the surface's
   `return.*` offers), not by extending the exact matcher.

A lesson's demand set is the union of its modules' demands (already the
aggregation rule in catalog validation).

## 4. Surface profiles

### 4.1 Profile record

A surface profile is data, not code:

```yaml
schema: school.surface-profile/v1
surfaceId: paper-letter-mono          # stable, lowercase, unique
family: schoolcalc | paper | screen
title: Laser worksheets (letter, mono)
liveness: static | observed
capabilities:
  - reader@1
  - quiz@1
  - problems@1
  - image@1
  - math@1
  - table-layout@1
  - scan-action@1                     # paper can print server-issued QR blocks
  - response.choice@1                 # OMR bubble capture
  - response.asset-choice@1
  - return.scan@1
limits:                               # family-defined keys, validated by the family adapter
  omrChannels: 12
  maxItemsPerSheet: 25
  maxPagesPerDocument: 20
```

- **`liveness: static`** — the profile is authored configuration (paper,
  screens). It lives in the content mount (§5.1) and is loaded through the
  config service.
- **`liveness: observed`** — the profile is asserted by a device capability
  report at sync time (SchoolCalc devices today). The observed report is
  validated against the family's approved list exactly as the TI-86 adapter
  does now (`TI86_SCHOOLCALC_CLIENT_CAPABILITIES`); see §6.2 for how the CLI
  certifies calculators without a live device.

### 4.2 Screen profile resolution

Screens are profiled **per mount identity**, and every mount resolves to an
authored profile — there is no implicit "the web":

- A Portal/kiosk mount (`/screen/<screenId>`) resolves the profile named by
  its screen configuration.
- The plain app mounts (`/school`, `/app/school`) — any ordinary browser with
  no screen identity — resolve to one designated **authored** static profile
  (conventionally `screen-browser`). It is a real profile file, reviewed like
  any other; it is not synthesized.
- Fail closed: a mount whose profile cannot be resolved (missing file,
  unregistered screenId) offers no learning content and logs the resolution
  failure. It never falls back to "assume everything works."

Identity and guest policy are routing/governance concerns and are **not**
certification inputs: certification answers "can this screen present and
return this work," not "may this child do it now."

### 4.3 Surface registry

The backend owns one registry of surface profiles: static profiles from the
content mount plus observed profiles from enrolled devices. The registry is
the single source the certification projection iterates. Adding a surface is
adding a profile (and, for a new *family*, an adapter — §7.1); it is never a
content change.

## 5. Authored content data spec

This section is the concrete YAML contract. §5.1–§5.4 document the shapes
that exist and validate today (verified against `catalogValidation.mjs`,
`moduleValidation.mjs`, `learningDocumentValidation.mjs`,
`questionBankValidation.mjs`); §5.5 lists the v1 additions, which are
deliberately minimal. All IDs are lowercase (`^[a-z0-9][a-z0-9-]{0,63}$`);
references may additionally contain `:._/` up to 128 chars.

### 5.1 Corpus layout

```
data/content/school/
  <subject-dir>/<course-dir>/…        # legacy curriculum corpus (units, quizzes) — unchanged, outside v1 certification (§9)
  catalog/
    catalogs/<catalogId>.yml          # school.catalog/v1
    documents/<documentId>.yml        # school.learning-document/v1
    question-banks/<bankId>.yml       # question bank schema
    assets/<assetId>.(svg|png|…)      # referenced by asset blocks/items   [v1: existence validated]
    surfaces/<surfaceId>.yml          # school.surface-profile/v1          [v1: new]
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

**Module types** (closed set; anything else fails publication). Every module
has `moduleId` and optional `title` (surfaces supply neutral fallback titles
for untitled modules, as the TI-86 adapter does today).

| type | Fields (per the validators) |
| --- | --- |
| `lecture_notes` | `documentId` (required) |
| `examples` | `examples[]`, each `exampleId`, `prompt`, non-empty `steps[]` |
| `problems` | `bankId` (required), `mode: practice\|drill` (required) |
| `flashcards` | `bankId` (required; no inline cards exist) |
| `quiz` | `bankId` (required), `passingPercent` (optional int 1–100), `remediation` (optional policy) |
| `learning_probe` | `bankId` (required), `phase`, `difficulty` (int 1–5), `conceptIds` (1..8 unique), `feedback{timing: immediate, onIncorrect, maxAttemptsPerItem 1–3}` |
| `activity` | `mechanic: matching\|sorting\|sequencing\|timed_drill\|memory`, `config{}` per mechanic |
| `tool` | `capability` (registered), `config{}` |
| `custom` | `capability` (registered), `config{}` |

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
`asset` (`assetId`, required `alt` → demands `image@1`), `scan_action`
(`actionId`, `label`; tokens and QR modules are server-issued and must not
be authored → demands `scan-action@1`), `tool_invitation` (`capability`,
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
    choices: [ … ]                    # strings; asset_choice choices may be {label} and/or {image: {…}}
    answer: …
    concepts: [ … ]                   # optional concept IDs for remediation
```

**Item types** (closed set, existing) and their demands: `multiple_choice`
(`response.choice@1`), `short_answer` and `cloze` (`response.text@1`),
`matching` (`response.matching@1`), `region_click` (an `asset` plus a string
`answer`; `response.region@1` + `image@1` — no region geometry exists in the
schema), `asset_choice` (`response.asset-choice@1` + `image@1` when choices
carry images).

Answer keys are part of the bank record, and banks are served to rendering
surfaces that need them (the screen quiz runner and the calculator's offline
scoring both receive them today). The server remains authoritative for
grading regardless of what a surface computed locally (§2). Changing *which*
surfaces may receive answer keys is explicitly not a v1 concern.

### 5.5 v1 additions (complete list)

1. **Surface profile files** — `catalog/surfaces/<surfaceId>.yml`
   (`school.surface-profile/v1`, §4.1). New schema; validated like every
   other authored file.
2. **Asset existence validation** — publication resolves every `asset` block
   `assetId` (and every bank item `asset`/image reference) to a real file
   under `catalog/assets/`; dangling references fail publication like every
   other dangling reference.

Nothing else about authored content changes in v1. In particular: no new
module types, no new block types, no new block fields, no changes to
existing capability derivations. (Media/AV/book modules and asset `kind`
extensions are v2 — §14.)

## 6. Disqualification conditions

What keeps content off a surface. Conditions marked **existing** are
enforced today (calculator: in the codec; paper/screen: nowhere — making
them enforced *before offering* is the point of this product). Numbers are
the current published limits; families own their numbers and may revise them
in their refining documents without changing this contract.

### 6.1 Every surface (publication-level; content is unpublishable)

- Unknown `schema`, module type, block type, or item type. **existing**
- Unregistered or malformed capability ID anywhere. **existing**
- Dangling references: `documentId`, `bankId`, catalog addresses,
  install-set members **(existing)**; `assetId`/item asset files *(v1)*.
- Executable-shaped fields in content (downloaded data is non-executable).
  **existing**
- Authored server-issued fields (`token`, `qrModules` on scan_action).
  **existing**

Content that is schema-valid but certifies `none` on every registered
profile is **not** a publication error: it is a prominent certifier warning
(§8) and it is absent from every offer. (The existing corpus contains valid
content whose runners are not yet registered — e.g. `activity` modules; a
hard gate would make today's corpus unpublishable, and content validity must
not vary with deployment shape.)

### 6.2 Calculator (TI-86; other families analogous)

| Condition | Limit / rule | Status |
| --- | --- | --- |
| Missing capability | exact-match vs the capability report (`image@1`, `math@1`, `table-layout@1`, `response.text@1` etc. are absent from the TI-86 codec set → asset blocks, latex formulas, tables, and text/matching/region items disqualify) | existing |
| Lesson artifact size | > 12,288 bytes hard (8,192 target ⇒ warning). **Enforced at compile time today; v1 moves it into certification, which therefore compiles (or byte-exactly sizes) the artifact — an acknowledged behavior change and cost (§7.1)** | existing check, new location |
| Module count | > 128 modules per lesson | existing |
| Assessment size | > 48 items; probe > 12 items | existing |
| Choice shape | > 5 choices; choice text > 23 chars | existing |
| Reader blocks | block type outside heading / prose / definition / formula(text) / worked_example / callout / **scan_action** (scan_action renders today, with its own label/token projection limits) | existing |
| Tool mapping | `tool`/`custom` capability with no native mapping on this family | existing |
| Whole-lesson rule | any module `incompatible` ⇒ lesson not installable (family tightening, §7.2) | existing |

**Baseline for CLI certification (no live device):** the codec-projectable
set `TI86_SCHOOLCALC_CODEC_CAPABILITIES` — *not*
`TI86_SCHOOLCALC_CLIENT_CAPABILITIES` (`['shell-core@1']`), which is the
fleet-proven runtime advertisement and would certify nothing. The certifier
labels calculator verdicts `baseline: codec` to keep the code's deliberate
projectable-vs-proven distinction visible; production delivery always
recomputes against the observed device report, unchanged. A `full` verdict
against the codec baseline gates *authoring and publication* only; it never
authorizes delivery to a device whose report disagrees.

### 6.3 Paper

| Condition | Rule |
| --- | --- |
| Response capture | item-granular: every item's `response.*` demand must be offered. A paper profile offering `response.choice@1`/`response.asset-choice@1` (OMR bubbles) therefore disqualifies any tracked module containing `short_answer`, `cloze`, `matching`, or `region_click` items — verdict `incompatible` with the item-level reason. (No "render-only worksheet" carve-out in v1; see §13.) |
| OMR geometry | a certified choice item needs ≤ `omrChannels` (12) choices, each with a printable label; items per sheet ≤ `maxItemsPerSheet`; document pages ≤ `maxPagesPerDocument` (20, aligned with the print job ceiling) |
| Interactivity | `tool`, `custom`, `activity`, `learning_probe` (immediate-feedback loop) do not render on paper |
| Assets | `image@1` renders (svg/bitmap); missing asset files fail at publication (§6.1) |
| Return | tracked modules require `return.scan@1` (§3.3 item 5) |
| Quota | print quota (`printing.mjs`) is a *routing-time* policy, never a certification input |

### 6.4 Screen (per resolved profile, §4.2)

| Condition | Rule |
| --- | --- |
| Runner availability | module type/capability with no registered runner in this profile (replaces the hardcoded launch switch; `learning_unsupported` becomes a stale-cache guard) |
| Item capture | item-granular `response.*` matching, same rule as paper (a remote-only screen without pointer capture omits `response.region@1`) |
| Tracked work | requires `return.session@1` |
| AV / rich blocks | per-profile `image@1`, `math@1`, `table-layout@1` presence (an e-ink or text-only screen omits what it cannot show) |

## 7. Certification

### 7.1 The certification port

Every surface **family** ships one adapter implementing one port:

```
certify(bundle, profile) -> {
  modules: [{ moduleId, verdict: render | incompatible,
              reasons: string[],              # for incompatible
              warnings: string[] }],
  lesson: { verdict: full | partial | none },
  resource?: { estimatedBytes | pages, limitsApplied }
}
```

- Input is the existing device-neutral lesson bundle (`BuildLearningLesson`
  output) plus **one** surface profile. The port is deterministic and does no
  I/O; everything it needs (bundle, resolved banks, asset metadata, profile)
  is supplied by the caller. It knows nothing about other surfaces — dispatch
  verdicts, which require cross-surface knowledge, are a projection-layer
  concern and are out of v1 entirely (§14).
- The exact-match capability comparison (`missingCapabilities`) is the shared
  first pass. Family adapters add their structural checks — byte ceilings and
  module counts for calculators, page/item/channel layout for paper,
  registry-backed runner availability for screens.
- **Calculator family:** the port wraps today's `supports()` *plus* the byte
  ceiling that today lives only in `compile()`. Producing the byte verdict
  requires compiling (or byte-exactly sizing) the artifact at certification
  time. This is a deliberate behavior change from "catalog projects without
  compiling": publication-time cost is corpus × calculator profiles, bounded
  by caching on (content digest, profile digest) — identical inputs are
  compiled once, and compilation is already deterministic (same digest ⇒ same
  bytes). Certification reports the size as `resource.estimatedBytes` and the
  above-target warning exactly as `compile()` does today.
- Certification never throws for "content doesn't fit"; it returns
  `incompatible` with reasons. It throws only for malformed inputs (invalid
  bundle, invalid profile), which are publication/enrollment defects.

### 7.2 Verdict roll-up

- Certification is decided **per module**; the lesson verdict is a roll-up:
  `full` (all modules render), `partial` (some), `none`.
- A family may tighten the roll-up for its delivery mechanics: SchoolCalc
  keeps full-or-nothing per lesson artifact. Paper and screens offer partial
  lessons: the Print Center prints the printable modules; the screen runs the
  runnable ones. A partial offer always shows what was left out and, where
  the matrix knows it, where it can be done.
- Roll-up policy is pure domain code shared by all families; the tightening
  is a declared family flag, not a fork.

### 7.3 Certification projection and manifest

- One application use case answers: for a content address (lesson or module)
  and optionally a surface, the matrix
  `{surfaceId, verdict, reasons, warnings, resource}`.
- At **publication**, the certifier (§8) runs the mounted catalog corpus
  against every registered static profile plus each calculator family's
  codec baseline, and writes a certification manifest keyed by
  (content digest, profile digest). With dispatch out of v1, a manifest
  entry depends on nothing but its two keys; entries are invalidated by
  either digest changing, nothing else.
- At **runtime**, every consumer (the `/api/v1/school/certification` router
  facade, the screen app, the Print Center) certifies **on-demand**, per
  request, through the same production ports the manifest was built from —
  it does not read the published manifest file. Runtime manifest
  *consumption* (a fast-path read of the persisted matrix, falling back to
  on-demand certification on a miss) is deferred past v1; see §13.
- **Standalone question banks** are first-class certification subjects
  alongside lessons (the Print Center and practice shelves offer bare banks
  today). A bank's demand set is its items' demands plus its tracking class;
  its address is its `bankId`. Legacy curriculum units
  (`<subject>/<course>/…`, §5.1) are outside v1 certification; the Print
  Center's existing unit-printing pipeline is unchanged (§9).

## 8. The certifier CLI

One command (working name `school:certify`, superseding and wrapping
`schoolcalc:validate`) is the author's linter, the CI gate, and the manifest
writer. It calls the production certification ports — never a parallel
implementation.

```
school:certify                            # whole catalog corpus × all registered profiles + codec baselines
school:certify --file <path.yml>          # one catalog/document/bank/profile file
school:certify --address main/science/…  # one lesson/module/bank address
school:certify --surface paper-letter-mono [--surface …]   # restrict profiles (query mode)
school:certify --json                     # machine-readable report
school:certify --write-manifest           # gate mode (default in CI/deploy)
```

Behavior:

- **Validation pass** (schema + references, aggregated — today's eager walk):
  every error reported, nothing certified on schema failure.
- **Certification pass**: per content address × profile, print the matrix —
  verdict, reasons, warnings, resource. Human output is a compact table;
  `--json` emits `{address, surfaceId, baseline?, verdict, reasons[],
  warnings[], resource}` records.
- **Exit semantics are modal.** *Gate mode* (no `--surface`; the CI/deploy
  form): exit `0` = corpus valid (warnings allowed, including
  certified-nowhere warnings); exit `1` = schema/reference errors. *Query
  mode* (`--surface`/`--file`/`--address`): exit `0` whenever the requested
  certification ran, whatever the verdicts — "`none` on TI-86" is a correct
  *answer* to "will this work on the TI-86?", not a failure; exit `1` only
  for schema/reference errors in the requested scope. Scripts that want to
  fail on a verdict test the `--json` output.
- Warnings (above-target sizes, certified-nowhere content) never fail the
  gate; they are always printed.
- **Determinism:** v1 certification inputs are entirely local (YAML, asset
  files, profiles, deterministic compilation). `--json` output is stable
  across runs on unchanged content and profiles — fit for CI diffing and for
  retention as delivery-matrix evidence. (This property is a v1 boundary
  condition; v2's external-ref resolution must define its own snapshot
  semantics rather than silently breaking it — §14.)

## 9. Routing

Routing consumes certification; it never overrides it.

- **Catalog browsing (screen).** In v1 the catalog badge shown is the
  **current mounted surface's** full/partial chip for that lesson — not a
  multi-surface matrix. The screen app consults the *current mount's*
  certification before launch; `learning_unsupported` remains as the gate's
  refusal panel (not merely a stale-cache guard — it is the normal path for
  any module this surface never certified). A catalog / calculator / paper
  cross-surface matrix badge is out of v1; see §13.
- **SchoolCalc sync.** Unchanged: the calculator catalog is the calculator
  projection of the same matrix against the observed device report, with
  install/update/request states layered on the `render` verdict.
- **Print Center.** Its **catalog-content** offerings (bare banks, printable
  lesson modules) come exclusively from paper certification. Its legacy
  curriculum-unit pipeline (`IssueDocument` over `<subject>/<course>/…`
  units) is explicitly outside v1 certification and continues unchanged;
  bringing that corpus into the model is future work, stated here so nobody
  reads "exactly the certified work" as covering it yet.
- **Results return.** Each family keeps its return channel — web sessions,
  OMR scan → paper grading, QR/cable → result importer — and each channel
  ends in the same grading (`gradeAnswer`), the same progress statuses, and
  the same per-learner records, addressed by the same content IDs. A tracked
  module certified `render` implies the surface offered a `return.*`
  capability (§3.3 item 5); a surface with no viable return path was never
  certified, so the dead-end is discovered at certification time, never
  after a child finishes the work.

## 10. Backend and DDD ownership

| Layer | Owns |
| --- | --- |
| Domain (`2_domains/school`) | Capability grammar and derivations (existing), profile validation, verdict/roll-up shapes and policy — all pure |
| Application (`3_applications/school`) | Surface registry, certification projection + manifest lifecycle, routing use cases |
| Adapters (`1_adapters`) | Per-family certification ports (calculator codecs, paper layout feasibility, screen runner registry), return-channel importers, profile observation |
| Rendering (`1_rendering`) | Paper drawing behind the existing renderer port; the layout-feasibility logic certification needs lives where the paper adapter can run it without printing |
| CLI | `school:certify` — thin shell over the application projection |
| Data mount | All authored content, assets, static surface profiles, certification manifest |

Frontend consumes certification; it never computes it. In v1 the screen
app's module-type switch (`SchoolApp.jsx`'s `startLearning`) **remains** —
what changed is that the certification gate now runs in front of it
(`moduleLaunchAllowed`, refusing to `learning_unsupported` before the switch
is ever reached), not that the switch itself was replaced. Retiring the
switch in favor of a registry-driven runner lookup keyed by capability ID is
out of v1 scope; see §13.

## 11. Integrity and failure behavior

- Verdicts, reasons, and offer decisions are logged with content address and
  surface ID, so "why can't I see this here?" is answerable from logs.
- Removing a capability from a profile (or a device report shrinking) flips
  affected verdicts on next projection; already-delivered work is not
  retracted, but re-offering requires re-certification (matches SchoolCalc's
  install/update model).
- Profile changes are ordinary reviewed config changes; certification makes
  their blast radius visible (the certifier diff shows every verdict a
  profile edit flips).

## 12. v1 acceptance

Every criterion is a checkable property of the matrix or the gate, not a
demo walk.

1. **Vocabulary safety:** with the v1 code in place, every capability ID in
   every bundle digest, artifact identity, and device report is unchanged
   from today (byte-identical bundles for unchanged content; the golden
   TI-86 byte digests still pass).
2. **Calculator parity:** for every lesson in the corpus, the certifier's
   TI-86 codec-baseline verdict equals what today's `supports()` +
   `compile()` pair produces (`supports()` reasons ∪ byte-ceiling throw ⇒
   `incompatible` with the same reasons; otherwise `render`), and an
   oversized synthetic lesson yields the byte-limit reason via certification
   without a thrown error.
3. **Offer soundness (the generalized "unreachable guard" property):** for
   every (module, profile) pair in the matrix with verdict ≠ `render`, no
   offer exists — the module is absent from that screen profile's catalog
   launches, from the Print Center's catalog offerings for paper, and from
   calculator install candidacy. Verified by walking the matrix against each
   offer surface's listing API, not by a scripted UX tour.
4. **Paper capture soundness:** a bank containing any `short_answer`/
   `cloze`/`matching`/`region_click` item certifies `incompatible` on the
   OMR paper profile with an item-level reason; a conforming choice bank
   certifies `render`, prints, scans, and grades through the existing OMR
   pipeline untouched.
5. **Corpus inventory:** the certifier runs the full current corpus with
   zero schema errors, and its certified-nowhere warning list is reviewed
   and attached as evidence — nothing currently published becomes
   unpublishable (§6.1 semantics).
6. **Determinism:** two consecutive `--json` runs on an unchanged corpus are
   byte-identical.
7. **Shared contract suite:** every family adapter (TI-86, the simulated
   second calculator family, paper, screen) passes one shared
   certification-port contract suite (extending the existing lifecycle
   harness in `tests/_lib/school/`); architecture tests reject subject
   vocabulary and layer violations across all new certification code. This
   branch does not build a second real calculator-family port — the
   "simulated second family" is stood in by the **domain-primitives fake**
   port already living in
   `tests/isolated/application/certificationContract.selftest.test.mjs`
   (a ~40-line `certify()` built directly from `deriveModuleDemands` +
   `capabilityReasons` + `moduleVerdict` + `rollUpLesson`, with no
   family-specific logic of its own). It is a legitimate second-family
   witness for the contract suite's purpose (proving the contract is
   satisfiable by *any* conforming port, not just TI-86's), just not a
   second production adapter.

## 13. Explicitly outside v1

- **Dispatch, media modules, external AV, and books** — the entire
  cross-surface launch story (v2, outlined in §14).
- Automatic surface *selection* ("route this child's quiz to the best
  surface") — v1 certifies and offers; humans choose.
- Mid-activity cross-surface handoff.
- Certification of the legacy curriculum corpus and the Print Center's
  unit-printing pipeline (§9).
- "Render-only worksheet" paper output for non-OMR item types (print without
  machine capture) — a deliberate cut; if wanted later it needs its own
  completion story, not a certification loophole.
- Restricting which surfaces receive answer keys (§5.4).
- New calculator families, new paper form factors, new screen runner types.
- Commerce/licensing semantics; i18n of certification reasons.
- Retroactive re-rendering of already-issued paper or already-installed
  calculator artifacts when content changes (existing update flows apply).
- **Runtime manifest consumption.** v1 ships publication-time manifest
  generation (`--write-manifest`, §8) but every runtime consumer certifies
  on-demand, per request, straight through the production ports (§7.3) —
  nothing reads the manifest file back. Per-request certification is cheap
  at household corpus scale, so there is no correctness or latency gap this
  closes yet; wiring a manifest-read fast path (with on-demand fallback on a
  miss) is v1.1 scope, not required for launch.
- **Cross-surface catalog badges.** §9's catalog badge in v1 is the current
  mounted surface's own full/partial chip — not a calculator/paper/screen
  matrix badge shown while browsing on any one surface. Surfacing the whole
  matrix in the catalog UI is deferred; it needs its own design pass (which
  surfaces to show, how partial-vs-full reads across three very different
  presenting devices) rather than being a certification-plumbing afterthought.
- **Registry-driven module runner lookup.** §10's screen app keeps its
  module-type switch in v1; the certification gate runs in front of it, but
  the switch itself is not replaced by a capability-ID-keyed registry
  lookup. That refactor is orthogonal to shipping certification and is
  deferred.

## 14. v2 outline: dispatch and external media (deferred, not forgotten)

Recorded so v1 decisions stay compatible; nothing here is v1 scope.

- **Dispatch verdicts** (`dispatch` alongside `render`/`incompatible`) are
  computed in the **projection layer**, which sees the whole registry — never
  in the per-family port (§7.1). The manifest key must then incorporate a
  registry digest, and external-ref liveness (Plex items, library records)
  needs explicit snapshot semantics so §8's determinism survives.
- **`media` module type** (video/audio/book refs, `played`/`attest`
  completion) and **asset `kind` extensions** (audio/video, `required:
  false` decoration) enter the content schema in v2.
- **`action.*` namespace** (QR display/print offers) is registered in v2;
  presenting surfaces (paper, calculator, screens) gain dispatch offers
  through it. `scan_action` remains the on-content carrier.
- **Action vocabulary expansion:** today `LEARNING_ACTION_KINDS` is exactly
  `['print_document', 'launch_media']`. v2's additions (launch a bank, a
  program, mark progress) are new scope; scan-triggered progress writes are a
  forgeable-input surface and require their own authorization/threat
  section.
- **`surfaceId` reconciliation:** DoNow already has a live surface-id space
  (`SurfaceProgramLauncher` dispatch targets). v2 must define the join
  between profile `surfaceId`s and DoNow surface ids before dispatch routes
  through the household launch pipeline.
- **Attestation** (book/AV completion by a person's say-so) requires the
  governance model for who may attest; it ships with that model or not at
  all.

## 15. Refining documents

- SchoolCalc: `_extensions/ti86-app/docs/schoolcalc-requirements.md` and its
  delivery matrix (the calculator family's refinement of this contract).
- OMR reader and paper pipeline: `docs/reference/omr/README.md`.
- School app and portal: `docs/reference/school/README.md`.
- On acceptance, the endstate of this document is folded into
  `docs/reference/school/` per the reference-docs convention; this file then
  moves to `_archive/`.
