# Product-module migration: pre-implementation work plan

**Date:** 2026-09-05
**Status:** Execution started in isolated `preimplementation/application-modules` worktree.
**Execution packet:** [Evidence and progress](../audits/2026-09-05-application-module-preimplementation/README.md).
**Planning source baseline:** `2144f762a37408b906efc0e359dc4649078d5ab4`; revalidate in Phase 1.
**Architecture:** [Application ownership and behavior-preserving migration](2026-09-05-application-module-migration-plan.md).
**Starting inventory:** [Source-area inventory](2026-09-05-application-module-source-inventory.md).
**Prior review:** [Five-round architecture review](2026-09-05-application-module-adversarial-reviews.md).

## Purpose and stopping point

Produce an evidence-backed, detailed, manageable, auditable implementation plan
through the Gratitude rehearsal, without changing the existing application or
its delivery machinery. Exploration, source inventory, contract definition,
documentation, and new isolated tests/experiments are in scope. Executing the
migration, including its shared prerequisites, is not.

The output must tell an implementer which files to change, in which order, which
contracts must survive, how to verify each changeset, when to stop, and how to
reverse it. A folder diagram or a list of test names is not sufficient.

This checklist expands the preparation for the architecture plan's WP-01–05.
Where those packages include repairs, production package adoption, shared-code
extraction, or relocation, this plan only investigates them and writes their
future execution tasks. The narrower scope here controls current execution.
Writing this document does not complete its checkboxes. The prior five review
rounds reviewed the architecture, not execution of this new checklist.

The [layers-of-abstraction references](../../reference/core/layers-of-abstraction)
and [decision register](../../reference/core/layers-of-abstraction/decision-register.md)
remain binding. Read them and the linked adapter guidance before classification.
Do not weaken D1–D10, invent a shared-code exemption, or approve a new domain rank
through a test fixture. Reference discrepancies become documented decisions or
future correction tasks; the authoritative references are not rewritten here.

## Scope boundary

| Allowed now when executing this plan | Not authorized by this plan |
|---|---|
| Read source, manifests, existing tests, build files and documentation | Move, rename, delete, or edit existing application source/assets |
| Write the planning packet and sanitized inventory/evidence files | Change production imports, factories, API mounts, behavior or data formats |
| Add tests, fixtures, local test configs and prototype tools under the dedicated folder below | Edit existing tests, runner configs, audit baselines, hooks, CI or root scripts |
| Run inspected, isolated tests with controlled dependencies and temporary outputs | Run the household controller, auto-start ordinary dev servers, or reuse a live server |
| Create disposable package/loader fixtures with their own manifests, locks, caches and dependencies | Change repository manifests, locks, installed dependencies, aliases or Docker inputs |
| Draft exact future changes and verification commands | Apply those changes, deploy, restart devices, flash satellites, or change household config |
| Record a prerequisite bug or stale fixture | Fix it silently, weaken assertions, or count its test as passing |

New test code is permitted; existing application code is frozen. Any necessary
exception needs explicit approval of an exact change list and is outside this
checklist. Do not interpret a checked planning task as that approval.

A successful test command is not proof it was safe. Inspect import-time effects,
runner setup, automatic server startup, data-path fallbacks, child processes and
report/cache paths first. Different ports do not isolate household controllers.
No provider calls, printing, real messaging, hardware access or private writable
fixtures. Read-only HTTP methods are not inherently safe: Gratitude has GET
operations with storage, broadcast and printing effects.

Existing dirty-worktree changes belong to their author. Record them at entry;
never overwrite, reset or clean them to make an audit appear tidy. No automatic
fetch/merge/rebase, commit, branch operation or deployment is included. If source
freshness requires synchronization, report it and obtain separate direction.

## Dedicated workspace and artifacts

Only create the following new locations as their tasks require them. They do
not yet exist merely because they appear in this plan. Avoid empty scaffolding.

```text
docs/_wip/audits/2026-09-05-application-module-preimplementation/
  README.md                    Evidence index and baseline identity
  task-status.json             Accountable progress and evidence links
  baseline.json                Source/content/runtime/tool provenance
  command-safety.json           Reviewed commands and expected effects
  source-ledger.json            Per-file classification and disposition
  dependency-ledger.json        Import, package and instance relationships
  registrations.json           Routes, catalogs, events, jobs, config bindings
  assets-and-storage.json       Static resources, paths, codecs, writers/readers
  owner-boundaries.json         Proposed owners, facets, exports, constraints
  contracts.json               Contract and case specifications
  test-population.json          Existing/new tests and actual runner coverage
  evidence/                    Sanitized reports indexed by run ID
  decisions.md                 Findings, resolutions and unresolved decisions
  prerequisites.md             Future changes this scope cannot apply
  implementation-backlog.md     Ordered, checkable execution task cards
  gratitude-rehearsal.md        Exact rehearsal changesets and recovery plan
  readiness.md                 Planning completion vs verification/approval

tests/preimplementation/application-modules/
  README.md                    Explicit safe commands and scope warnings
  configs/                     Dedicated runner configs; no root-config edits
  cases/                       Contract cases grouped by runner and concern
  drivers/                     Baseline driver and future candidate interface
  fixtures/                    Synthetic, provenance-documented data
  tooling/                     Read-only inventory/evidence validators
  experiments/                 Minimal package/import/architecture fixtures
```

Use a task-owned OS temporary directory for mutable run outputs, caches, package
installations, generated images and disposable source copies. Persist only
reviewed, sanitized evidence. Do not modify `.gitignore` to conceal new output,
write to existing report files, or link a prototype install into the repository.
Record temporary location references privately where necessary; committed reports
use logical run IDs, not personal filesystem paths.

The dedicated test folder is not automatically included in existing gates.
Provide explicit local runner commands/configuration and reconcile declared
cases with executed cases. Do not modify root discovery merely to include it.
Existing tests remain where they are; reference/reuse them through safe runners
instead of copying them into a second authoritative suite.

## How to check off work

For efficient continuation, follow the task-local
[preparation skill](../../../tests/preimplementation/application-modules/skills/application-module-preparation/SKILL.md).
Start with its read-only status command, then inspect the selected task's evidence;
reuse existing deterministic checks instead of repeating broad investigation.

IDs are stable: `PRE-<phase>.<task>.<subtask>`. Every subtask has an observable
exit; task and phase checkboxes are rollups with their own stated conditions.
Keep IDs when wording changes. Retire an ID explicitly rather than reuse it.

For each ID, `task-status.json` records assignee/reviewer roles, status, prerequisite
IDs, baseline identity, output/evidence IDs, decision/blocker IDs, completion date
and any reopened evidence. One person may fill several roles; no particular team
size is assumed. Roles are investigation lead, architecture reviewer, test owner,
build/runtime reviewer and Gratitude/domain reviewer.

- Check an item only when its stated exit is satisfied and evidence is linked.
- A task to **record** a failure can finish with an accurate failure report. A task
  to **prove** behavior cannot finish by relabeling that failure as success.
- Keep test outcomes separate: `passed`, `failed`, `blocked`, `not-run`, and
  `candidate-pending`. Skips and missing prerequisites are never passes.
- Every failure/blocker gets an owner, impact, next action, and affected future
  implementation gate. No unresolved item disappears into a generic TODO.
- Evidence records expanded command/configuration, runtime versions, source and
  fixture hashes, expected/actual populations, result and safe output references.
- Source, fixture, assertion or relevant tool changes invalidate affected evidence.
  Reopen the affected items; a previous green result is not timeless approval.
- A document can be complete while migration readiness is blocked. The final
  report must state both; it must not declare a green baseline or production
  readiness merely because all investigation outputs are accounted for.

Future task cards use separate `IMP-...` IDs. Contract IDs (`CTR-...`), case IDs
(`CASE-...`), source IDs (`SRC-...`), decisions (`DEC-...`) and evidence (`RUN-...`)
form the traceable chain: source → boundary → contract → case → result → changeset.

## Phase sequence

| Phase | Work | Prerequisites | Principal output |
|---|---|---|---|
| 1 | Scope, baseline and safety | This accepted scope | Baseline and command-safety records |
| 2 | Complete source and registration census | 1 | Source/asset/storage/test inventories |
| 3 | Ownership, layers and dependency analysis | 2 | Classified graph and decisions |
| 4 | Public boundaries and package specification | 3 | Owner/export/import replacement matrices |
| 5 | Contract catalog and Gratitude case specification | 2/3; reconcile with 4 | Contract-to-case coverage matrix |
| 6 | Dedicated baseline characterization tests | 1/5; relevant 4 entries | Safe test packs and baseline outcomes |
| 7 | Red/green and package feasibility experiments | 3/4/6 | Reproducible mechanism evidence |
| 8 | Prerequisite and impact synthesis | 2–7 outputs | Exact future repair/integration tasks |
| 9 | Detailed Gratitude rehearsal work plan | 4/5/8 | Dependency-ordered implementation packet |
| 10 | Audit, readiness and handoff | 1–9 outputs | Audited backlog and explicit next gate |

Discovery work in 4 and 5 may overlap after relevant classifications stabilize;
Phase 6 can proceed by completed contract family. No overlap permits skipping a
prerequisite for that family. Global package/tooling changes bring every affected
owner into impact analysis, not only Gratitude. Whole-repository contract coverage
is inventoried here; executable depth first targets Gratitude, its consumers and
the shared mechanisms affected by its proposed prerequisites.

## Phase 1 — Establish scope, baseline and safe execution

**Depends on:** accepted scope. **Responsible roles:** investigation lead, test owner.

### Task PRE-1.1 — Identify the source and evidence baseline

- [x] **PRE-1.1.1 — Record source identity.** Exit: `baseline.json` names the full revision, worktree status, relevant existing changes and the time of inspection without treating dirty content as committed source.
- [x] **PRE-1.1.2 — Verify freshness without changing source.** Exit: local/deployed baseline relationship is verified through available read-only evidence or explicitly marked unverified with an owner; any required synchronization is a separate action.
- [x] **PRE-1.1.3 — Capture dependency/tool inputs.** Exit: root/backend/frontend manifest and lock hashes, actual Node/npm versions, resolver configs and inspected build inputs are recorded; unavailable deployed image provenance is labeled, not invented.
- [x] **PRE-1.1 — Complete task.** Exit: another investigator can identify exactly which source/content and tools the planning evidence describes.

### Task PRE-1.2 — Define the write and execution budget

- [x] **PRE-1.2.1 — Establish the allowed-output list.** Exit: new docs/test locations and task-owned temporary outputs are enumerated; protected source/config/test/tooling files have an initial content fingerprint inventory.
- [x] **PRE-1.2.2 — Inspect candidate commands.** Exit: `command-safety.json` records import/startup, filesystem, network, process and device effects for each proposed command, including commands not safe to run.
- [x] **PRE-1.2.3 — Specify isolation and refusal behavior.** Exit: tests must use synthetic roots and fake external dependencies, reject live-server reuse and private path fallback, and stop on unexpected network/process/device effects; environment isolation is established before imports.
- [x] **PRE-1.2 — Complete task.** Exit: there is no command whose safety relies solely on its name, HTTP method, port or `--dry-run` label.

### Task PRE-1.3 — Create progress and evidence conventions

- [x] **PRE-1.3.1 — Initialize accountable records.** Exit: task/status and evidence-index schemas exist with stable IDs, dependencies, owner/reviewer and blocker fields.
- [x] **PRE-1.3.2 — Define refresh and privacy rules.** Exit: evidence invalidation criteria and a synthetic-data/redaction policy are documented; secrets, private records and instance-specific locations are excluded.
- [x] **PRE-1.3 — Complete task.** Exit: a completed item can be independently checked from its evidence, and a blocked item has a concrete next action.

- [x] **PRE-1 — Phase exit.** Baseline identity, authorized output boundaries, safe execution rules and progress tracking are complete; unresolved baseline freshness limits are visible before any execution result is relied on.

## Phase 2 — Build the complete inventory

**Depends on:** Phase 1. **Responsible roles:** investigation lead, test owner.

### Task PRE-2.1 — Enumerate tracked source and build inputs

- [x] **PRE-2.1.1 — Expand the directory census to files.** Exit: backend layers/composition, frontend roots, shared, CLI, scripts, tests and all satellite source are enumerated without following aliases into duplicate entries.
- [x] **PRE-2.1.2 — Account for assets and less-visible roots.** Exit: public assets, native/worker resources, schemas, hidden build/editor/tooling configuration, executable modes and generated input references have explicit dispositions.
- [x] **PRE-2.1.3 — Reconcile tracked and effective build source.** Exit: ignored/generated/local-only requirements are reported separately, not silently excluded or copied from private mounts; source coverage counts reconcile to the frozen baseline.
- [x] **PRE-2.1 — Complete task.** Exit: `source-ledger.json` has one stable entry per canonical artifact, with explicit unknowns rather than missing rows.

### Task PRE-2.2 — Inventory public and installed registrations

- [x] **PRE-2.2.1 — Enumerate assembled API registrations.** Exit: method, full mount chain, route pattern/aliases, middleware/error handling order and source registration are mapped; optional patterns, HEAD/OPTIONS behavior and computed mounts are not lost to literal grep counts.
- [x] **PRE-2.2.2 — Enumerate browser and configuration registrations.** Exit: browser routes, AppContainer IDs, content-app entries, widget/presenter registries, admin entries and config mappings are separately recorded with their actual populations.
- [x] **PRE-2.2.3 — Enumerate lifecycle and integration registrations.** Exit: relevant provider loaders/manifests, events, schedules, subscriptions, startup/stop and CLI dispatch contributions are associated with source and consumers.
- [x] **PRE-2.2 — Complete task.** Exit: `registrations.json` can identify every registration affected by a proposed Gratitude or shared-prerequisite move without assuming catalogs are interchangeable.

### Task PRE-2.3 — Inventory storage, resources and external consumers

- [x] **PRE-2.3.1 — Map data authorities.** Exit: each relevant namespace/path resolver has identified writers/readers, codec, household scope, cache/reload behavior, file modes and atomicity/locking expectations; no live record contents are copied.
- [x] **PRE-2.3.2 — Map non-import resource dependencies.** Exit: stylesheet imports, fonts/icons, URLs, `import.meta.url`, dynamic globs, workers/native artifacts and Docker ignore/copy behavior are connected to their consumers.
- [x] **PRE-2.3.3 — Map satellite and operator dependencies.** Exit: each target's logical owner, runtime/toolchain, lock/build identity, wire protocol and stable operator paths are recorded; physical relocation remains a later decision.
- [x] **PRE-2.3 — Complete task.** Exit: `assets-and-storage.json` distinguishes source moves from persistent paths, public URLs and independent deployments that must remain stable.

### Task PRE-2.4 — Inventory actual tests and runners

- [x] **PRE-2.4.1 — Identify runner ownership.** Exit: existing Jest, Vitest, node:test and browser tests are classified by actual imports/configuration, with ambiguous or unowned files explicitly reported.
- [x] **PRE-2.4.2 — Compare declared and discovered populations.** Exit: safe discovery identifies file/case IDs, parameterized cases, skips and omissions; discovery that would execute unsafe setup is blocked and labeled rather than run.
- [x] **PRE-2.4.3 — Reconcile documentation with commands.** Exit: stale commands/aliases, missing scripts, fixed-root omissions and automatic setup/report writes are listed as future corrections, with authoritative current command expansion recorded.
- [x] **PRE-2.4 — Complete task.** Exit: `test-population.json` distinguishes tests that exist, tests a runner discovers and tests whose assertions actually execute.

- [x] **PRE-2 — Phase exit.** Source, registrations, data/resources and test populations reconcile; every unknown has an ID and owner. The seed census of 74 application folders, 43 domain contexts, 35 frontend module folders and 19 extensions is revalidated, not treated as permanent truth or full per-file classification.

## Phase 3 — Classify owners, layers and dependencies

**Depends on:** Phase 2. **Responsible roles:** architecture reviewer, investigation lead.

### Task PRE-3.1 — Assign ownership independently of layer

- [x] **PRE-3.1.1 — Classify each relevant artifact.** Exit: owner/subowner, product/capability/platform category, runtime, executable layer or approved declarative-contract kind, context/rank and visibility are recorded separately.
- [x] **PRE-3.1.2 — Resolve Gratitude and shared-seam splits.** Exit: mixed files have proposed split boundaries and destinations, including Gratitude/identity helpers, Feed/Homebot bridges, renderer/print transport and admin editor/shared form controls; no code is split yet.
- [x] **PRE-3.1.3 — Validate generic host and experience ownership.** Exit: Player, screen-host, gaming mechanism/experience/environment and app-owned exports have explicit ownership explanations; same-owner experience subboundaries are included.
- [x] **PRE-3.1 — Complete task.** Exit: no relevant file is classified as generic solely because its directory says `shared`, `kernel`, `platform` or `contracts`.

### Task PRE-3.2 — Build the resolved dependency graph

- [x] **PRE-3.2.1 — Resolve source import edges.** Exit: relative paths, package exports, `#` aliases, re-exports, CommonJS, literal dynamic imports and symlinks resolve to canonical targets; unresolved computed targets are recorded for finite-loader specification.
- [x] **PRE-3.2.2 — Record runtime/package provenance.** Exit: importer → resolved package/version/instance paths are captured for the affected graph, including must-share and must-separate singleton/context/native identities.
- [x] **PRE-3.2.3 — Report cycles and boundary violations.** Exit: file and owner/subowner cycles include concrete paths; port-contract edges and composition bindings are distinguished without hiding their real runtime imports.
- [x] **PRE-3.2 — Complete task.** Exit: `dependency-ledger.json` supports reverse impact queries for every proposed rehearsal/prerequisite change, including callers outside Gratitude.

### Task PRE-3.3 — Reconcile authoritative policy and current exceptions

- [x] **PRE-3.3.1 — Cross-check reference/checker disagreements.** Exit: unknown domain ranks, same-rank rules, stale examples, allowed kernel/naming contracts and D1–D10 requirements have exact references and current-source evidence.
- [x] **PRE-3.3.2 — Specify narrowly permitted contract consumption.** Exit: sanctioned declarations such as household config naming have per-export consumers/operations/closure; clocked builders, serializers, ports and gaming orchestration are not laundered into that permission.
- [x] **PRE-3.3.3 — Record necessary decisions and repairs.** Exit: each conflict has a proposed resolution, accountable reviewer and blocked future task; current references/audits remain unchanged, and D10 receives no grandfathered exception.
- [x] **PRE-3.3 — Complete task.** Exit: policy assumptions are explicit enough to test, with unresolved rulings preventing approval of their affected moves.

- [x] **PRE-3 — Phase exit.** Gratitude and its impact closure have a reviewed classification/graph; remaining repository-wide unknowns have explicit owners and blocking packages. No unresolved classification is silently promoted to permission.

## Phase 4 — Specify public boundaries and package mechanics

**Depends on:** Phase 3. **Responsible roles:** architecture reviewer, build/runtime reviewer.

### Task PRE-4.1 — Define owner and export contracts

- [x] **PRE-4.1.1 — Specify owner metadata.** Exit: proposed schema covers unique IDs/categories, facets, subowners, context assignments, public classifications and dev/test/satellite references, without becoming a production activation manifest.
- [x] **PRE-4.1.2 — Define real public entries.** Exit: every proposed export names existing symbols/behavior, consumer, semantic layer/runtime, transitive closure, state/context expectations and a contract ID; mixed barrels are rejected.
- [x] **PRE-4.1.3 — Map old imports to new entries.** Exit: every affected consumer has an exact proposed target and binding owner; internal relative imports and same-owner facet access still obey layers/subowner visibility.
- [x] **PRE-4.1 — Complete task.** Exit: `owner-boundaries.json` is an actionable interface specification, not just a list of packages.

### Task PRE-4.2 — Specify the package/dependency arrangement

- [x] **PRE-4.2.1 — Model non-overlapping packages.** Exit: prospective owner roots contain sibling public/server/web and applicable other facet packages; no ancestor workspace encloses descendant workspaces; private facet names and export maps are collision-checked.
- [x] **PRE-4.2.2 — Model dependency identity.** Exit: each affected dependency has version and sharing/separation requirements, selected nested-install/peer treatment, its test, and any unresolved representability question.
- [x] **PRE-4.2.3 — Specify all resolver/build projections.** Exit: proposed Node `type`/`imports`, Vite/Vitest/Jest/Sass/editor mappings, workspace membership, manifest copy/install closure, native scripts and lock changes are enumerated but not applied.
- [x] **PRE-4.2 — Complete task.** Exit: the later integration can be described as an exact manifest/configuration changeset with defined acceptance tests.

### Task PRE-4.3 — Specify Gratitude integration ownership

- [x] **PRE-4.3.1 — Define the public composition and web surfaces.** Exit: owner composition, existing UI/exit callback, configuration editor and required operation exports are named; public spelling preserves current default/named behavior or has an explicit compatibility wrapper design.
- [x] **PRE-4.3.2 — Specify consumer-side bridges.** Exit: Feed's query, Homebot's narrow command and reusable household projection are bound through the correct ports/composition; private datastore/workflow imports are not proposed as shortcuts.
- [x] **PRE-4.3.3 — Preserve installed contracts.** Exit: bootstrap URL, app/content IDs, admin/config mappings, events, print callback/registry and household behavior are mapped before/after without new enablement or endpoint semantics.
- [x] **PRE-4.3 — Complete task.** Exit: each incoming and outgoing Gratitude seam has a responsible owner, public contract and concrete verification case.

- [x] **PRE-4 — Phase exit.** Boundary/package/import replacement specifications are complete for the rehearsal closure. Unsupported proposals remain explicit decision blockers; no production folders, aliases, manifests or locks have been changed.

## Phase 5 — Specify the functional and API contract catalog

**Depends on:** Phases 2/3; reconcile with Phase 4. **Responsible roles:** test owner, domain reviewer.

### Task PRE-5.1 — Establish the contract/case schema and coverage rules

- [x] **PRE-5.1.1 — Define contract records.** Exit: each record includes owner/source, consumer, preconditions, input, observable output/state/effects/cleanup, expected errors, evidence basis, criticality and case IDs.
- [x] **PRE-5.1.2 — Define per-case oracles.** Exit: cases state expected status/headers/body or function results, storage/events/calls, ordering where observable, deterministic controls and narrowly permitted normalization.
- [x] **PRE-5.1.3 — Map repository-wide coverage and gaps.** Exit: every inventoried public registration/contract has existing/planned coverage or an explicit gap; Gratitude and globally affected prerequisites are distinguished from later owner suites.
- [x] **PRE-5.1 — Complete task.** Exit: coverage is measured by identified contracts/cases, not only test counts or line coverage percentages.

### Task PRE-5.2 — Specify every Gratitude HTTP registration

- [x] **PRE-5.2.1 — Reconcile the route seed in Appendix A.** Exit: all current registrations, composed mounts/aliases, optional printer-location expansion, middleware and error translation are represented; source comments are not assumed to be actual URLs.
- [x] **PRE-5.2.2 — Expand validation and household cases.** Exit: each applicable family covers valid/invalid input, missing/null/empty values, household/default selection and current access behavior; surprising behavior is identified for disposition, not silently improved.
- [x] **PRE-5.2.3 — Specify state/effect assertions.** Exit: option recycling, selection transfers, print marking, broadcasts, snapshots and failure ordering are explicit, including side-effecting GETs.
- [x] **PRE-5.2 — Complete task.** Exit: each seed route has test-ready cases and an expectation source; no rehearsal route is covered only by a generic “returns 200” test.

### Task PRE-5.3 — Specify storage, rendering and public consumer cases

- [x] **PRE-5.3.1 — Specify persisted-format compatibility.** Exit: record fields, dotted filenames/extensions, ordering/defaults, printed history, snapshots and old-reader/new-writer scenarios have synthetic fixtures and assertions.
- [x] **PRE-5.3.2 — Specify rendering/printing contracts.** Exit: selection policy vs renderer roles, selected IDs, layout/fonts/orientation, accepted success outcomes, no-mark-on-failure and temporary-file cleanup are separately testable.
- [x] **PRE-5.3.3 — Specify consumer compatibility.** Exit: Family Selector, app parameter resolver, Feed legacy-shape tolerance, Homebot assignment and Admin config workflows have concrete boundary cases and failure/default expectations.
- [x] **PRE-5.3 — Complete task.** Exit: Appendix B is expanded into executable-case specifications, including consumers not physically located under Gratitude.

### Task PRE-5.4 — Specify browser and lifecycle behavior

- [x] **PRE-5.4.1 — Specify interaction cases.** Exit: launch, loading/error/empty states, user/category navigation, selection/discard/undo, exit, focus, long-press and orphan key events have expected observations.
- [x] **PRE-5.4.2 — Specify event/context cleanup.** Exit: WebSocket payload handling/persistence, provider identity, repeated mount/unmount, duplicate-listener prevention and callback cleanup are covered.
- [x] **PRE-5.4.3 — Specify asset/session transition cases.** Exit: lazy launches, styles/icons, browser state and already-loaded-client candidate/rollback scenarios are defined; genuinely unavailable candidate assertions remain explicitly candidate-pending.
- [x] **PRE-5.4 — Complete task.** Exit: a fake-backed browser driver can execute the intended scenarios without household controller or device setup.

- [x] **PRE-5 — Phase exit.** The contract catalog covers the rehearsal and all affected prerequisite consumers, with stable cases, expectation sources, gaps and reviewer decisions. No unreviewed new functionality is treated as the baseline contract.

## Phase 6 — Add dedicated baseline characterization tests

**Depends on:** Phase 1 safety and completed Phase 5 families; relevant Phase 4 boundaries.
**Responsible roles:** test owner, domain reviewer.

### Task PRE-6.1 — Build the isolated test harness

- [x] **PRE-6.1.1 — Add dedicated runner configurations.** Exit: explicit commands execute only the intended runner/case population using the existing installed toolchain, write only allowed outputs, and do not inherit automatic controller startup or unsafe setup.
- [x] **PRE-6.1.2 — Add safe fixtures and baseline drivers.** Exit: real existing services/routers/components are used with synthetic storage and fake external ports; imports are audited before evaluation; the driver adapts wiring, not business rules.
- [x] **PRE-6.1.3 — Define the candidate driver interface.** Exit: the same cases can target future public entries; a missing candidate fails or reports not-run outside the test result, never falls back to baseline and reports parity.
- [x] **PRE-6.1.4 — Verify isolation itself.** Exit: disposable negative probes for private-path fallback, out-of-root writes, unauthorized network/device/process access and live-server reuse are rejected before effects; fixture roots are canonicalized with symlinks considered.
- [x] **PRE-6.1 — Complete task.** Exit: the harness is safe and its declared/executed case population reconciles; unsupported setup needs are explicit blockers, not reason to import the global controller.

### Task PRE-6.2 — Implement the safe baseline packs

- [x] **PRE-6.2.1 — Add storage/application cases.** Exit: Appendix B storage/workflow cases have runnable tests against real baseline code, reusing existing characterizations without editing or duplicating their authority.
- [x] **PRE-6.2.2 — Add HTTP/composition cases.** Exit: Appendix A cases exercise real router translation and the safely reachable assembled mount/middleware boundary; any assembly requiring source extraction is precisely recorded as blocked coverage.
- [x] **PRE-6.2.3 — Add rendering/print cases.** Exit: policy, renderer and delivery outcomes have separate assertions using safe fonts/native dependencies and fake printers; unavailable exact-render prerequisites are visible.
- [x] **PRE-6.2.4 — Add browser/consumer cases.** Exit: Appendix B interaction and external-consumer cases have dedicated tests using actual code and synthetic dependencies; no private services or independent reimplementation of the product is required.
- [x] **PRE-6.2 — Complete task.** Exit: specified baseline cases exist in the dedicated folder or link to reusable existing tests; any case unsafe/impossible without a protected-file change has a specific blocked record and future prerequisite, never an empty passing test.

### Task PRE-6.3 — Run, adjudicate and freeze baseline evidence

- [x] **PRE-6.3.1 — Execute reviewed baseline commands.** Exit: every safe selected case has an actual outcome and evidence; source, fixtures, renderer/tool versions and populations are recorded; no broad `npm test` or live harness is invoked by convenience.
- [x] **PRE-6.3.2 — Triage every non-pass.** Exit: distinguish test defect, product defect, infrastructure/safety blocker and missing coverage; existing-file fixes become Phase 8 tasks, while errors in newly added tests may be repaired within this scope.
- [x] **PRE-6.3.3 — Review expected outputs.** Exit: baselines are checked against contract intent/source evidence, nondeterministic fields preserve identity relationships and timezone semantics, and snapshots are not blindly regenerated to match whatever ran.
- [x] **PRE-6.3 — Complete task.** Exit: the baseline result matrix is reproducible and honestly classified; no task claims a green baseline unless all cases required for that claim passed.

- [x] **PRE-6 — Phase exit.** Safe characterization packs and baseline evidence are delivered, with complete explicit dispositions for unavailable/failing cases. This is evidence-accounting completion, not a waiver of the later rehearsal's passing-test gates.

## Phase 7 — Run isolated red/green and feasibility experiments

**Depends on:** Phases 3/4/6. **Responsible roles:** test owner, architecture and build/runtime reviewers.

### Task PRE-7.1 — Validate architecture and discovery checks against negative fixtures

- [x] **PRE-7.1.1 — Exercise current blind spots safely.** Exit: old/new-path unknown-source, forbidden filesystem/layer/private import and missing-test probes have actual diagnostic results; a current checker that misses them is recorded as failing that requirement.
- [x] **PRE-7.1.2 — Specify and prototype missing enforcement locally.** Exit: additive test-folder experiments resolve aliases/re-exports/computed finite targets and enforce owner/subowner/port/contract rules; exact future integration into existing audits is recorded rather than applied.
- [x] **PRE-7.1.3 — Verify positive controls and restoration.** Exit: each negative fixture has the expected failure reason plus a legal counterpart/restored green result, including sanctioned household naming and adapter→implemented-port dependencies.
- [x] **PRE-7.1 — Complete task.** Exit: `red-green` evidence distinguishes behavior of current gates from successful prototype gates; no prototype is misrepresented as CI enforcement.

### Task PRE-7.2 — Test contract sensitivity without changing production source

- [x] **PRE-7.2.1 — Introduce controlled contract mutations.** Exit: disposable fixtures/copies test removed mounts, changed response/storage fields, print-failure marking, duplicate events, missing cleanup and missing assets, each linked to the expected case failure.
- [x] **PRE-7.2.2 — Verify restored behavior.** Exit: the unmutated baseline passes the same applicable cases; an unrelated setup failure is not accepted as the red proof.
- [x] **PRE-7.2.3 — Audit comparison integrity.** Exit: baseline and candidate data/processes cannot contaminate each other, normalization cannot erase semantic changes, and baseline-against-baseline is labeled harness validation only.
- [x] **PRE-7.2 — Complete task.** Exit: every claimed sensitive contract check has an observed red/restored-green pair; unproven checks remain identified gaps.

### Task PRE-7.3 — Reproduce and extend package feasibility

- [x] **PRE-7.3.1 — Reproduce the sibling-facet mechanism.** Exit: an isolated fixture verifies public forwarding, private subpath rejection, facet-local type/import maps and clean reinstall; all manifests, locks, installs and caches remain outside production packages.
- [x] **PRE-7.3.2 — Probe actual dependency risks.** Exit: real affected version/instance cases, including timezone variants and React/context/native constraints, have import-order and identity checks; synthetic success is not substituted for missing real-dependency evidence.
- [x] **PRE-7.3.3 — Probe browser and image assumptions.** Exit: isolated browser/build/native checks record actual coverage and missing toolchain requirements; no repository Dockerfile, npm installation or running controller is modified to make the experiment pass.
- [x] **PRE-7.3.4 — Record the package adoption decision.** Exit: chosen mechanism, limitations, rejected variants and exact future integration acceptance are recorded; failures that require a design amendment block adoption.
- [x] **PRE-7.3 — Complete task.** Exit: packaging feasibility is supported by reproducible results with explicit pass/fail/not-run boundaries, not an install exit code alone.

- [x] **PRE-7 — Phase exit.** Architecture, contract-sensitivity and packaging experiments have inspectable evidence and adjudicated gaps. Missing red/green proofs or real-runtime checks remain blockers to their future implementation gates even when investigation is documented.

## Phase 8 — Turn findings into exact prerequisite tasks

**Depends on:** outputs of Phases 2–7. **Responsible roles:** investigation lead, architecture/build/test reviewers.

### Task PRE-8.1 — Specify baseline and policy repairs without applying them

- [x] **PRE-8.1.1 — Write existing-test repair cards.** Exit: each stale fixture/discovery issue names exact files, failing cases, intended correction and assertions that must remain; no approved failure count is silently increased.
- [x] **PRE-8.1.2 — Write reference/enforcement alignment cards.** Exit: each change names authoritative ruling, affected context/paths, exact audit/reference files, negative/positive fixtures and scope of permissible correction.
- [x] **PRE-8.1.3 — Separate product behavior fixes.** Exit: any necessary functional correction has its own approval, before/after contract decision and baseline-refresh task; it is not bundled into relocation.
- [x] **PRE-8.1 — Complete task.** Exit: every repair outside the allowed-output list has a future `IMP-...` card and remains unapplied.

### Task PRE-8.2 — Specify shared/package/build prerequisites and their impact

- [x] **PRE-8.2.1 — Bound the shared foundation.** Exit: the former broad “platform/capability foundation” step is an exact file/symbol/change list required by the rehearsal, including provider enumeration/loading separation where affected; unrelated owner moves are excluded.
- [x] **PRE-8.2.2 — Specify repository package/tooling adoption.** Exit: manifest/lock/alias/runner/watcher/editor/Docker changes name all affected owners and tests; a global install change cannot receive only Gratitude testing.
- [x] **PRE-8.2.3 — Specify immutable build and asset prerequisites.** Exit: base/OS/downloader/supervisor/native/font inputs, clean context provenance and loaded-client asset retention have exact later evidence requirements, including same-URL byte collisions and stable-name asset handling.
- [x] **PRE-8.2 — Complete task.** Exit: every prerequisite has a bounded change surface, risk classification, acceptance and rollback method; no production change is disguised as an experiment.

### Task PRE-8.3 — Build the prerequisite execution graph

- [x] **PRE-8.3.1 — Link dependencies and approvals.** Exit: future cards have resolvable predecessors, blocked contracts and approval boundaries; cycles are resolved by explicit task splits or recorded design decisions.
- [x] **PRE-8.3.2 — Define changeset granularity.** Exit: each card describes one independently reviewable outcome; moves and consumer updates are atomic where needed; no deliberately broken intermediate revision is required.
- [x] **PRE-8.3 — Complete task.** Exit: there is a topologically ordered route from known blockers to rehearsal readiness, with no vague “fix dependencies” or “move shared code” catch-all.

- [x] **PRE-8 — Phase exit.** `prerequisites.md` and the implementation backlog contain every necessary out-of-scope change, its owner, impact, evidence and gate. None has been executed under this plan.

## Phase 9 — Author the detailed Gratitude rehearsal work plan

**Depends on:** Phases 4/5/8. **Responsible roles:** investigation lead, domain/test/build reviewers.

### Task PRE-9.1 — Specify exact relocation and binding changesets

- [x] **PRE-9.1.1 — Write the move ledger.** Exit: every Gratitude-owned source/test/asset has an old/new path, symbol preservation decision, consumer update list and associated contract IDs; unrelated files have explicit non-move dispositions.
- [x] **PRE-9.1.2 — Write composition/consumer change cards.** Exit: router/service/renderer wiring, Feed/Homebot/identity bindings, AppContainer/content/admin registration and config/event consumers have exact edits and verification, not inferred automatic registration.
- [x] **PRE-9.1.3 — Define the mixed-tree rehearsal state.** Exit: one implementation/writer per feature, current unmigrated locations, public entry usage and any narrowly tracked temporary binding/deletion condition are explicit; no deprecated tree or duplicate runtime is proposed.
- [x] **PRE-9.1 — Complete task.** Exit: an implementer can locate every rehearsal change without rediscovering ownership or dependencies.

### Task PRE-9.2 — Specify rehearsal verification and recovery

- [x] **PRE-9.2.1 — Write the ordered verification runbook.** Exit: baseline/candidate commands, fixture resets, expected case populations, architecture checks, storage/event/print/browser comparisons and actual image checks are assigned to the appropriate changeset.
- [x] **PRE-9.2.2 — Specify recovery tests.** Exit: old-reader/new-writer compatibility, candidate-to-baseline fixture recovery and already-loaded browser lazy-chunk tests in both directions have exact inputs and expected outcomes; no live data restore is implied.
- [x] **PRE-9.2.3 — Specify the contributor trial.** Exit: a clean-checkout Gratitude dev/test walkthrough uses actual product code, synthetic identity/data and fake external ports, with no unrelated service configuration; proposed commands are labeled unavailable until implemented.
- [x] **PRE-9.2 — Complete task.** Exit: success/failure and safe recovery are objectively testable without production rollout.

### Task PRE-9.3 — Make every future task independently auditable

- [x] **PRE-9.3.1 — Complete the task-card fields.** Exit: every future card satisfies Appendix C, including file allowlist, prerequisites, protected invariants, red/green commands, expected population, evidence and stop conditions.
- [x] **PRE-9.3.2 — Define handoffs and the rehearsal stop.** Exit: cards end with reviewable evidence; completing rehearsal does not automatically authorize another product, a merge or deployment; lessons feed a separate subsequent plan revision.
- [x] **PRE-9.3 — Complete task.** Exit: `gratitude-rehearsal.md` and the backlog are checkable changeset-by-changeset rather than one large refactor instruction.

- [x] **PRE-9 — Phase exit.** The detailed implementation plan through Gratitude rehearsal is authored and reviewed, including exact prerequisite changes, verification and recovery. Planning the rehearsal is complete; performing it remains out of scope.

## Phase 10 — Audit the packet and hand off honestly

**Depends on:** outputs of Phases 1–9. **Responsible roles:** investigation lead plus reviewer roles.

### Task PRE-10.1 — Audit traceability and scope preservation

- [x] **PRE-10.1.1 — Validate artifact consistency.** Exit: IDs are unique/resolvable, dependencies acyclic, source populations reconcile, exports resolve in specifications, and source → contract → case → result → changeset links have no unexplained gaps.
- [x] **PRE-10.1.2 — Validate checklist/evidence integrity.** Exit: every checked item has the required evidence and review; no candidate-pending, blocked or skipped case is represented as passed; baseline changes reopen affected claims.
- [x] **PRE-10.1.3 — Verify the no-code-change boundary.** Exit: protected-file fingerprints and worktree comparison show no changes caused by this work outside allowed docs/new tests and task-owned outputs; unrelated concurrent edits are identified separately, never reverted.
- [x] **PRE-10.1 — Complete task.** Exit: the packet and preserved-source claim can be checked without relying on the author's narrative.

### Task PRE-10.2 — Publish separate planning and verification statuses

- [x] **PRE-10.2.1 — Publish planning completion.** Exit: `readiness.md` lists delivered artifacts, completed/open PRE items, decisions and the next executable task with its prerequisites; incomplete work is not hidden behind an overall “done”.
- [x] **PRE-10.2.2 — Publish rehearsal readiness.** Exit: all baseline, classification, resolver, affected-consumer, image and safety gates are explicitly passed/blocked/not-run; all required future post-change checks remain pending, not pre-certified.
- [x] **PRE-10.2.3 — Record the approval boundary.** Exit: the handoff identifies the exact first out-of-scope changeset and required approval, and states that existing-file repair, package adoption, extraction and rehearsal are not authorized by this preparation plan.
- [x] **PRE-10.2 — Complete task.** Exit: a reader can distinguish “the plan is complete,” “preconditions are verified,” and “implementation is authorized.”

- [x] **PRE-10 — Phase exit.** The audited planning packet and honest readiness report are delivered, all PRE exits are accounted for, and the work stops before existing-file changes or Gratitude migration. If a genuine proof task remains blocked, leave its checkbox open and label the handoff partial; do not force full completion by redefining its exit.

## Appendix A — Gratitude HTTP contract seed

These are source-backed starting cases, not executed tests or a complete
generated route inventory. Reconfirm against the selected baseline in PRE-5.2.
The [current router](../../../backend/src/4_api/v1/routers/gratitude.mjs) contains
18 registrations; the printer route has an optional location segment. Resolve
actual mounts and aliases separately. Paths below are relative to the Gratitude
mount, normally `/api/v1/gratitude`; comments using older prefixes are not proof.

| Contract ID | Registration | Required scenario/observation seed |
|---|---|---|
| CTR-GR-HTTP-01 | GET `/bootstrap` | Users/options/selections/discarded and `_household`; default/explicit household; profile fallbacks; storage effects of depleted-option recycling |
| CTR-GR-HTTP-02 | GET `/users` | User IDs/names/group labels, order, empty household and fallback names; household marker |
| CTR-GR-HTTP-03 | GET `/options` | Both categories, item DTOs, controlled shuffle, empty/depleted queues and recycling writes |
| CTR-GR-HTTP-04 | GET `/options/:category` | Accepted case normalization, invalid category 400, items/household and category-specific effects |
| CTR-GR-HTTP-05 | POST `/options/:category` | 201 valid item; missing/non-string/whitespace text; invalid category; generated identity and plain stored record |
| CTR-GR-HTTP-06 | GET `/selections/:category` | Selection DTO including nested item and printed history; order, empty set and invalid category |
| CTR-GR-HTTP-07 | POST `/selections/:category` | 201 creation, 409 same-user/item duplicate, missing user/item ID, timestamp/household, removal from options/discarded and no unintended writes on rejection |
| CTR-GR-HTTP-08 | DELETE `/selections/:category/:selectionId` | Removed DTO, remaining records, missing selection 404, invalid category and no extra mutation |
| CTR-GR-HTTP-09 | GET `/discarded/:category` | Item DTOs/order, empty and invalid category; observation separated from recycling calls |
| CTR-GR-HTTP-10 | POST `/discarded/:category` | 201 discarded item, missing item ID, option removal and subsequent recycling behavior |
| CTR-GR-HTTP-11 | POST `/snapshot/save` | 201 result, identifier/name/time, complete plain snapshot payload, storage locations and errors |
| CTR-GR-HTTP-12 | GET `/snapshot/list` | Empty/populated list, naming/order/default semantics and household marker |
| CTR-GR-HTTP-13 | POST `/snapshot/restore` | ID and supported filename forms, unspecified selection behavior, restored fields, missing snapshot 404/error mapping and failure side effects |
| CTR-GR-HTTP-14 | GET `/new` | Missing text 400; trimming/generated ID; exact `gratitude` topic, `gratitude_item` type, `isCustom`, timestamp and one publish per invocation |
| CTR-GR-HTTP-15 | GET `/print` | Group/display names, item DTO, print count/history, categories/order and household behavior |
| CTR-GR-HTTP-16 | POST `/print/mark` | Category/array validation, empty/unknown/repeated IDs, timestamp history and reported count semantics |
| CTR-GR-HTTP-17 | GET `/card` | PNG type/length/disposition, default unflipped vs `upsidedown=true`, selected content/layout and unavailable-renderer 501 |
| CTR-GR-HTTP-18 | GET `/card/print{/:location}` | Both location forms, default flipped vs explicit false, unknown printer 404 before render, unavailable renderer 501, success/failure response and marking only rendered IDs after success |

For every family, add applicable body/query/parameter edge cases, current access
and household handling, relevant headers, thrown-error translation, observable
call ordering and negative effects (“no write,” “no print,” “no publication”).
Do not invent stronger validation or authorization merely because it seems
desirable. Record discovered defects for explicit correction decisions.

Particularly important baseline quirks to investigate:

- `GratitudeService.getOptions` may recycle discarded records; bootstrap calls
  these methods too. GET/read classification alone does not imply no writes.
- The router's household choice and the renderer's composition-captured default
  household can differ. Characterize this safely; a correction is separate work.
- A successful driver result is interpreted by `GratitudeCardPrintService` as
  `true` or `{ verified: true }`; merely truthy results are not equivalent.
- Preview and print orientation defaults differ. Preserve both.
- Feed tolerates legacy text shapes that entity hydration may reject. A public
  query cannot accidentally erase that compatibility or expose raw YAML mechanics.

## Appendix B — Functional, storage, consumer and negative-test seeds

Each row becomes one contract record with separately numbered cases. Rows are
not substitutes for execution evidence. Preserve existing assertions from the
[stored-shape characterization](../../../tests/unit/domains/gratitude/gratitudeStoredShape.char.test.mjs)
and other relevant suites; do not edit them under this plan.

| Contract ID | Required scope |
|---|---|
| CTR-GR-DATA-01 | Plain item/selection fields, printed arrays/history, dotted `.yml` keys and no entity-private-field serialization |
| CTR-GR-DATA-02 | Option → selection/discard transfer, empty-queue recycling, duplicates, deletion and order under deterministic randomness |
| CTR-GR-DATA-03 | Snapshot content/list/restore, missing/null/legacy input, controlled time and old-reader/new-writer fixture compatibility |
| CTR-GR-PRINT-01 | Selection weighting/counts, injected clock/random, chosen IDs and group attribution independent of renderer |
| CTR-GR-PRINT-02 | Font/native/toolchain-pinned rendering, wrapping/orientation/dimensions/content; tolerate only explicitly reviewed nondeterminism |
| CTR-GR-PRINT-03 | Printer resolution/accepted outcomes, failure/throw behavior, correct marking, scoped temporary-file cleanup without a real printer |
| CTR-GR-UI-01 | Existing AppContainer/content launch, load/error/empty states, user/category selection, queue/discard/undo and clear/exit callback |
| CTR-GR-UI-02 | Focus, arrow/enter/space/long-press behavior, repeats, orphan keyup, mount/unmount timers/listeners and persisted browser state |
| CTR-GR-EVENT-01 | Payload shape/routing, custom-item delivery and persistence, repeated mount cleanup, no duplicate subscriptions/effects |
| CTR-GR-CONSUMER-01 | Family Selector and app parameter resolver keep the bootstrap URL, options/user projection and existing failure/default behavior |
| CTR-GR-CONSUMER-02 | Feed item shape, legacy text fallback, limit/random selection/time/label semantics and logged-error fallback through the proposed public query |
| CTR-GR-CONSUMER-03 | Homebot assignment command, category/user/household/time propagation, batch results and errors; no real AI/messaging calls |
| CTR-GR-CONSUMER-04 | Admin editor read/change/save, canonical config mapping, unknown keys, defaults/cache and existing permissions; no real household config writes |
| CTR-GR-COMPOSE-01 | Actual safe factory inputs/outputs, one registration/state authority, callback/context identity, setup ordering and teardown |
| CTR-GR-ARTIFACT-01 | Lazy UI/editor imports, icons/styles/fonts/native resources and required shipped-source closure |
| CTR-GR-RECOVERY-01 | Baseline-loaded client → candidate and candidate-loaded client → rollback, unopened lazy chunks, warm/cold/SW/reconnect states; preserve existing offline behavior only |
| CTR-ARCH-01 | Forbidden API→application/domain, application→adapter/rendering/FileIO, domain→higher/unknown context, system→provider loader edges remain forbidden through public facades |
| CTR-ARCH-02 | Closed declarative naming contracts, port provenance, private owner/facet/subowner imports, generic screen-host/gaming direction and alias/re-export/computed resolution |
| CTR-TEST-01 | Missing test file/case, wrong runner, skipped assertion, missing prerequisite and stale baseline evidence are detected rather than accepted |
| CTR-PACKAGE-01 | Sibling package discovery, real exports/type/imports, no test-alias-only success, dependency versions and must-share/must-separate identities |
| CTR-BUILD-01 | Frozen upstream toolchain and exact build context, required native assets, missing owner root, unsupported asset URL and changed-input negative proofs |

## Appendix C — Required future implementation task card

Every card in `implementation-backlog.md` and `gratitude-rehearsal.md` must have
these fields. The schema is a template; no implementation task is authorized by
its appearance here.

```text
ID: IMP-<stage>.<task>
Title and single observable outcome:
Responsible/reviewer roles:
Prerequisite PRE/IMP/DEC IDs and required approval:
Baseline revision/content/fixture identity:
Exact files to add, move, edit, remove (old → new; modes/symlinks if relevant):
Allowed change type (fixture repair / tooling / package / boundary / relocation):
Protected files and behavior explicitly not in scope:
Affected owners, imports, registrations, resources and contracts:
Numbered subtasks, each with its exit criterion:
Before-change checks and expected case/file population:
Implementation steps (no unspecified “fix imports” catch-all):
After-change positive checks and expected observations:
Controlled negative proof and expected diagnostic:
Data/side-effect safety and fixture reset instructions:
Rollback/reversal and recovery verification:
Evidence artifacts, generating commands and required review:
Stop conditions and escalation/decision owner:
Task completion checkbox (all exit evidence present):
```

Future stage sequence to instantiate with actual files, not execute now:

1. `IMP-BASE`: approved fixture/policy/test-discovery repairs and baseline refresh.
2. `IMP-PKG`: approved repository package/resolver/build adoption and full affected-owner checks.
3. `IMP-SHARED`: exact rehearsal-required shared boundary/extraction changes, no unrelated moves.
4. `IMP-GR-MOVE`: Gratitude relocation plus atomic consumer/registration updates.
5. `IMP-GR-VERIFY`: real baseline/candidate contract, browser, storage and artifact comparison.
6. `IMP-GR-RECOVER`: fixture rollback/loaded-client recovery and contributor trial.
7. `IMP-GR-REVIEW`: audited result, lessons, remaining work and stop before rollout/next owner.

The graph from Phase 8 determines any finer ordering. An atomic combination may
be necessary if separating moves and consumers would create a broken revision;
record why and preserve independently reviewable evidence. A task card is not
complete if the implementer still has to invent its architectural boundary.

## Initial known findings to reconcile, not silently fix

These are starting observations from the architecture review and source pass,
not current results of running this checklist:

- The earlier targeted test sample was 95 passing and 2 failing Piano router
  fixtures; it was not a green repository baseline.
- Existing architecture/test checks have different source roots and can miss
  destination paths or unowned tests. A file being present is not execution.
- `npm test` has a port-cleaning pretest; browser defaults can auto-start/reuse
  the real stack. Neither is a safe default pre-implementation command.
- The testing primer contains stale command/path statements; resolve scripts
  from actual manifests and source. Missing `smoke:yaml` coverage is not a skip.
- Three existing dependency scopes resolve different library versions/instances;
  a successful synthetic workspace fixture does not certify the actual graph.
- Provider discovery currently crosses a system/composition seam; a corrected
  source split is a future prerequisite, not a sanctioned layer exception.
- The current build has floating non-npm inputs and a HEAD label that does not
  prove context contents; loaded browsers require forward/rollback asset support.

Add new findings to the decision and prerequisite records. If investigation
changes an architectural assumption, propose a documented amendment and reopen
affected tasks rather than quietly changing the target.

## Completion statement to use at handoff

Report, separately:

1. **Planning package:** complete/partial, with completed and open PRE IDs.
2. **Baseline evidence:** passed/failed/blocked/not-run by required case group.
3. **Architecture/package feasibility:** demonstrated mechanisms and remaining real-graph checks.
4. **Implementation backlog:** exact first eligible changeset and its approvals/prerequisites.
5. **Scope preservation:** only allowed documentation/new dedicated tests/temporary outputs changed.
6. **Stop:** no existing-code migration, production package adoption, Gratitude rehearsal or deployment performed.

The intended final product is a set of small, checkable implementation tasks
supported by trustworthy evidence—not a partially migrated application and not
an assertion that future implementation checks have already passed.
