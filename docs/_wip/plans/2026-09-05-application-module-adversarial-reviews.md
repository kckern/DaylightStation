# Product-module migration: adversarial review record

**Parent:** [Migration execution design](2026-09-05-application-module-migration-plan.md)
**Current handoff:** [PRE-1 — Establish scope, baseline and safe execution](2026-09-05-application-module-preimplementation-plan.md#phase-1--establish-scope-baseline-and-safe-execution).
**Requirement:** Five adversarial agent review rounds, with revisions between
rounds, covering implementation architecture, names, classification, binding
layers, integration, migration safety, and contributor focus.

This reviews the plan, not an implemented migration. Findings must identify a
concrete defect, its consequence, correction, and verification. A round is
complete only after its finding dispositions are recorded and revisions are
present in the working documents. Later rounds must inspect the revised text.
Do not count the author's own review or several simultaneous reads of one
unchanged draft as five completed rounds.

## Evidence and reviewed revisions

The [recovered evidence packet](../audits/2026-09-06-application-module-review-evidence/README.md)
preserves the original reviewer responses, reconstructed draft snapshots,
timestamped revision patches, and a fresh reproduction of the synthetic package
experiment. Its verifier checks snapshot hashes, patch replay, sequential review
windows, and the captured package assertions. Recovery did not conduct additional
review rounds or complete implementation gates.

| Round | Plan lines at dispatch | Preserved evidence |
|---|---:|---|
| 1 | 375 | [Input, revisions and reviewer response](../audits/2026-09-06-application-module-review-evidence/README.md#round-1) |
| 2 | 1,162 | [Input, revisions, findings and package follow-up](../audits/2026-09-06-application-module-review-evidence/README.md#round-2) |
| 3 | 1,259 | [Input, revisions and reviewer response](../audits/2026-09-06-application-module-review-evidence/README.md#round-3) |
| 4 | 1,303 | [Input, revisions and reviewer response](../audits/2026-09-06-application-module-review-evidence/README.md#round-4) |
| 5 | 1,380 | [Input, revisions and explicit final closure](../audits/2026-09-06-application-module-review-evidence/README.md#round-5) |

Snapshots were reconstructed from recorded edits, not saved contemporaneously
as commits. Changes made during a review are retained with timestamps; the
dispatch snapshot is not a claim that every document stayed unchanged throughout
that round. The packet also separates post-review preparation-scope additions
from the text reviewed in Round 5. Current planning scope is controlled by the
pre-implementation checklist, not by the historical reviewers' WP-01 handoffs.

## Round 1 — Foundational architecture and completeness

**Reviewer:** `architecture_review_r1` (independent agent, read-only).
**Input:** Original 375-line execution draft, roadmap/runtime context, all layer
references plus adapter guidance, and representative repository source.
**Result:** Seven findings; revision adds concrete implementation specification,
source inventory, and stronger binding policy. No production code changed.

| ID | Severity | Finding | Disposition and evidence |
|---|---|---|---|
| R1-01 | High | Layer/reference/checker disagreements could authorize same-rank or unknown-domain imports | Addressed in main §8.1–8.3 and inventory §3: D1–D10 binding, exact context ranks, unknown classification fails, explicit reference reconciliation before moves |
| R1-02 | High | Public runtime labels lack layer provenance; blanket app-import ban can reject legitimate application-port inversion | Addressed in main §7.2/8.2/8.3: per-export provenance, no API/rendering upward exception, adapter port-contract distinction, re-export resolution and negative fixtures |
| R1-03 | High | Destination/names and production coverage remain directional | Addressed in main §7/9/13 and complete directory-level source inventory; per-file coverage remains an explicit implementation deliverable |
| R1-04 | Medium | Existing gaming experience middle abstraction omitted | Addressed in main §7.1/10.3 and inventory §4: experience subowners, environment → experience → platform, independent fake environment test |
| R1-05 | Medium | Cross-app bridges have no concrete owner/binding treatment | Addressed by integration register in main §10.4; preserves old public URLs and places policy outside composition |
| R1-06 | Medium | Contributor isolation lacks measurable delivery | Addressed in main §12/WP-09: owner README, safe fake-backed dev target, persona trials and clean-checkout command checks |
| R1-07 | Medium | Gate execution/adjudication and alias decision unspecified | Addressed in main §9/13/14: selected package experiment, named evidence artifacts, command/coverage matrix, no ignored architecture or moved-owner failures |

Reviewer verified synthetic `piano → gaming` and `books → health` are not
reported by the old hierarchy scanner. This is a coverage defect, not a new
permission. The exact reference ruling and implementation repair are prerequisites
of WP-02, not completed by this documentation update.

## Round 2 — Package feasibility and source-layer contradictions

**Reviewer:** `architecture_review_r2` (independent agent; source inspection and
offline temporary package fixtures; no repository implementation edits).
**Input:** Expanded execution design and inventory after Round 1, binding layer
references, dependency manifests/locks and actual import resolution.
**Result:** Two high-severity findings; both have concrete design amendments.
Reviewer also reconciled all 74 application, 43 domain, 35 frontend module and
19 extension directory names against tracked source.

| ID | Severity | Finding | Disposition and evidence |
|---|---|---|---|
| R2-01 | High | One full-stack package cannot preserve three resolved timezone versions; hoisting can merge mutable transitive instances | Main §7.2/7.3/9 selects non-overlapping sibling facade/runtime-facet workspaces, nested install plus explicit identity policy, manifest/type/imports/install closure rules. Real dependency/native/browser parity remains a named WP-03 gate |
| R2-02 | High | System discovery dynamically loads higher layers; executable provider manifests under adapters import peers | Main §10.1/10.2 and source inventory §5 split system enumeration from composition loading, give provider manifests concrete composition destinations, and require dynamic-edge negatives plus ordered discovery replay |

R2-01 historical source inspection: existing Fitness importers resolved `moment-timezone`
0.5.47 (web), 0.6.0 (server), 0.5.46 (CLI) and distinct `moment@2.30.1` instances.
A synthetic offline sibling-workspace fixture using Node 22.22.0/npm 10.9.4
passes install and clean reinstall, both import orders, cross-facet mutable
instance separation, same-facet direct/facade identity and deep-import rejection.
The author reran both import orders successfully. An ancestor/descendant-package
variant returned successful install status but failed runtime imports; that
layout was rejected. The fixture's no-script installation is not a production
install policy, and its success does not claim the real dependency graph passed.

[Recovered fixture sources and reproduction instructions](../../../tests/preimplementation/application-modules/experiments/review-package-resolution/README.md)
now accompany the [original reviewer result](../audits/2026-09-06-application-module-review-evidence/reviews/round-2-2.md).
The [fresh captured run](../audits/2026-09-06-application-module-review-evidence/package-results.json)
reproduces both import orders after install and clean reinstall: all four sibling
cases pass, and all four recovered ancestor/local-link cases fail specifically
with `ERR_MODULE_NOT_FOUND` for `@probe/timezone` despite successful installation.
That rejection is an expected negative result. Other historical ancestor-layout
variants and real dependency/native/browser/image parity are not certified by
this reproduction.

R2-02 verification basis: `FileModuleManifestDiscovery.load` invokes dynamic
import, `AdapterRegistry._import` delegates to it, and the OpenAI manifest lazily
imports its concrete adapter. The plan names each source split and its negative/
positive fixtures; no discovery implementation was changed in this doc task.

## Round 3 — Declarative contracts and subowner enforcement

**Reviewer:** `architecture_review_r1`, reviewing the revised 1,259-line plan
after Round 2, inventory/review record, layer references and representative code.
**Result:** Two findings, both addressed; prior package/port/provider repairs
were found materially sound at plan level.

| ID | Severity | Finding | Disposition and evidence |
|---|---|---|---|
| R3-01 | High | Executable-layer matrix omitted sanctioned naming contracts and could misclassify mixed shared/kernel code | Main §7.2/8.1–8.3 explicitly models approved declarative-contract artifacts with closed permissions/reference provenance; concrete household registry, media builder, nutrition serializer and gaming coordinator classifications; source inventory §7 updated |
| R3-02 | Medium | Experiences promised subowner boundaries but private-import enforcement only crossed owner IDs | Main §7.1/8.3/9 now applies visibility across subowners, classifies presenter registry as composition, and requires same-owner private-import negatives plus public-consumer positives |

Evidence inspected: system reference explicitly sanctions the household naming
registry and its actual consumers; the registry exposes pure lookup functions.
Media envelopes read the clock, nutrition's food record helper serializes data,
and gaming's coordinator orchestrates injected stores and time. The plan no
longer labels these uniformly as declarations or domain merely by directory.
Acceptance fixtures and authoritative-policy reconciliation are named WP-01/02
deliverables, not claimed implemented checks.

## Round 4 — Release artifacts, clients and rollback

**Reviewer:** `architecture_review_r2`, after Round 3 revisions; inspected
Docker/build scripts, browser lazy imports/SW/boot recovery, gates and runbook.
**Result:** Two high-severity gaps addressed. Earlier architecture, contract,
subowner, provider-loader and package amendments remained sound at plan level.

| ID | Severity | Finding | Disposition and evidence |
|---|---|---|---|
| R4-01 | High | Old loaded clients can request missing lazy chunks after cutover; rollback breaks candidate-loaded clients symmetrically | Main §11.2/14/15 specifies certified candidate/rollback asset closures, immutable baseline preservation, collision/stable-name rules, client retention/reload policy and bidirectional cache/SW/reconnect tests |
| R4-02 | High | Floating base/APK/yt-dlp/global supervisor and dirty build context can change behavior despite npm parity and a HEAD label | Main §9/WP-03/14/15 freezes upstream toolchain provenance and exact source/content inputs, adds changed-input negatives, and uses immutable certified artifacts without rebuilding during rollback |

Evidence: AppContainer has lazy imports; Express serves the current dist;
SW retains at most 120 fetched entries; boot repair disarms after mount.
Docker resolves a tagged base, unpinned native packages, yt-dlp Git HEAD and
global forever; the build script labels the current directory with HEAD without
proving context equivalence. These facts motivate explicit implementation gates,
not a claim those future deployment artifacts have already been built.

## Round 5 — Fresh final adversarial audit

**Reviewer:** `architecture_review_r5`, a fresh independent agent, after all
Round 4 revisions. Read the complete plan/inventory/review record, all seven
layer reference files and adapter guidance; checked representative source.
**Result:** No remaining blocking architectural design finding. One low-severity
ordering clarification is incorporated before handoff.

| ID | Severity | Finding | Disposition and evidence |
|---|---|---|---|
| R5-01 | Low | §8.2 could imply WP-01 performs mixed-file extraction before policy/package gates | Corrected §8.2: WP-01 records/classifies required splits and assigns execution packages; extraction follows WP-02/03, consistent with §6/13 |

The reviewer confirmed prior fixes are materially specified: export/layer
provenance, subowner visibility, provider loading in composition, dependency
identity, closed declarative contracts, loaded-client rollback assets and build
provenance. Actual screen-host/Piano imports support the proposed separation of
generic host from installed widget composition without reversing the dependency.
Acceptance is for the plan and handoff to inventory work, not a production move.
The reviewer rechecked the corrected §8.2 against §13 and explicitly closed
R5-01 and Round 5 with no unresolved blocking architectural plan finding.

## Final exit audit

Five **sequential** adversarial review/revision rounds were completed across
three reviewer agents. Fourteen findings have explicit dispositions. Earlier
high-severity findings received substantive design amendments and subsequent
independent review; none was cleared merely by renaming it future work.

| User requirement | Design coverage and evidence |
|---|---|
| A focused full-stack space for experienced contributors | Main §1/7/12: product ownership, applicable server/web/CLI facets, safe real-product dev composition, domain-expert task trials |
| Platform vs shared capability vs product, including app-owned public exports | Main §1/7–10 plus source inventory; ownership, role, runtime, layer and visibility are separate axes |
| Generic screen-framework and reusable Player/gaming | Main §1.1–1.4/7/10: generic host vs installed selection, supported playback entries, experience subowners and one-way engine dependencies |
| Existing abstraction requirements remain binding | Main §8: final D1–D10, context ranks, reference reconciliation, export provenance, closed contract permissions and destination-path negative fixtures |
| Migration/integration plan, not new functionality | Main §2/6/10/11/13: behavior freeze, incoming/outgoing bridges, all-primary-source scope, explicit external-runtime ownership; runtime exploration clearly deferred |
| Fast coordinated cutover without permanent cruft | Main §6/13/15: incremental branch preparation, one controller cutover, no deprecated source tree/duplicate writers, certified rollback and client asset retention |
| Red/green contracts and reliable import migration | Main §3–5/9/14: discovered test/case and artifact populations, deliberately failing fixtures, real resolver/image gates, package prototype and preserved dependency identity |
| Open-source contribution readiness | Main §12: synthetic scenarios, clean-checkout commands, maintained public contracts, licensing/private-data review distinct from publication authorization |
| Five rounds, not five parallel reviews of one draft | Rounds 1–5 above, with each subsequent review inspecting the prior revisions |

The original exit-audit report, before the pre-implementation checklist and later
scope links were added, recorded: 100 local links/anchors, balanced fences, no trailing
whitespace, five recorded rounds, 14 unique finding IDs, source-folder coverage,
and documentation-only worktree changes. `git diff --check` passed. The inventory
contains all tracked names in the four enumerated groups: 74 application folders,
43 domain contexts, 35 frontend module folders and 19 extensions. This does not
pretend that the implementation's required per-file ledger already exists.

That review-stage report covered the roadmap and four planning Markdown files;
the consolidated commit also added the later pre-implementation checklist. These
historical file/link counts are not current evidence-packet counts. No application code
was relocated, no implementation gate was declared passed, and no live
controller or deployment was run for these reviews. Planning-time evidence
includes source inspection and the synthetic package-resolution experiment;
main §3.1 separately reports the existing diagnostic sample, including its two
failing Piano fixtures.

**Handoff:** Start [PRE-1](2026-09-05-application-module-preimplementation-plan.md#phase-1--establish-scope-baseline-and-safe-execution),
beginning with PRE-1.1.1 source identity, then follow the preparation checklist's
dependencies and scope boundaries. It permits investigation, documentation and
isolated tests/experiments. Existing-file repairs, authoritative-reference edits,
package/lock adoption, extraction and the Gratitude rehearsal remain later,
separately authorized changes; do not execute WP-02/03 from this review record.
This evidence recovery does not check off any PRE item.

Real package/native/browser parity, authoritative-reference
reconciliation, full file classification, CI enforcement, contributor trials
and release certification are unexecuted implementation gates. Completing this
plan neither claims production readiness nor grants deployment authority.
