# Future implementation backlog — not authorized

This is an execution skeleton with exact known changes, not a declaration that
PRE-8/9 are complete. Cards whose file/symbol/export decisions remain open are
marked **design-blocked**. Do not hand them to an implementer as finalized tasks.

## Common requirements on every card

Baseline: `baseline.json`, source SHA-256/mode in `source-ledger.json`; verify
freshness at card entry. Preserve all unrelated files and existing user changes.
The allowed change type is named per card. Only that card's listed files may
change, plus new tests explicitly listed by its approved design. A source move
preserves bytes except enumerated import/wiring substitutions; no formatting or
behavior cleanup. Recompute the reverse-impact graph before editing.

Before-change checks: protected-source verification, relevant current baseline
packs, the unchanged six-case stored-shape suite and one-case print adapter suite,
exact runner population and
the current architecture/parse/link gates after safety review. Current dedicated
Node populations: isolation 8, Gratitude 59, rendering/resource 9, browser 25,
architecture observations/prototype 18, native package fixture 7, registration/wire/storage 78. These do not
replace the affected owners' existing suites. Failed, skipped or missing cases
stop the card; they cannot be silently excluded or added to a baseline.

After-change checks: same cases against the real candidate, no baseline fallback;
native Node and browser resolver checks without the preparation bridge; review
status/headers/DTOs, writes, events, print calls, identity and resource bytes.
Cases not yet implemented are blockers, not implied checks. Expected populations
must be frozen in the card's approval before implementation begins.

For storage/Admin/foundation changes, include `storage-authorities.json` and the
five `CASE-GR-ADMIN-DISK-*` and six `CASE-STORE-PROFILE-*` cases in the impact review. Preserve configured versus
literal household paths, `.yml`/`.yaml` precedence, cached versus fresh reads,
raw/parsed responses and each writer's mode/atomicity behavior. None is an
incidental refactor. For lifecycle changes, name affected IDs from
`lifecycle-closure.json` and distinguish unsubscribe, stop, flush and dispose;
existing missing shutdown remains baseline unless separately approved.

The profile impact set includes `ConfigService.mjs`, `configLoader.mjs`,
`ConfigUserDirectory.mjs`, `DataServiceAuthAccountRepository.mjs`,
`YamlUserProfileDatastore.mjs`, `fingerprintProfileWriter.mjs`,
`HouseholdAdminService.mjs`, `YamlAdminConfigStore.mjs` and their composition
bindings; full paths/anchors are in `storage-authorities.json.profileMutations`
and `profileReferences`. Preserve the single persisted profile authority, fresh
versus cached reads, old Map/object identity, explicit refresh and write order.
Rollback restores imports/bindings together, not an old profile snapshot over
new user activity. No new user service or consistency repair is included here.

For bundled-font/public-asset moves, `resource-review.json` supplies nine font/notice
identities, four SVG glob populations and the backend School subject-icon reader.
Its three conditional private-path substitutions are superseded by
`rendering-boundary.json`: one system font-directory export and five exact
runtime/test root consumers, with the nine canonical assets. Preserve stable public
URLs and installed shell/cache behavior. Include `CASE-RESOURCE-*` when affected;
passing them alone is not compiler/image/client recovery proof. For event-bus or
satellite changes, freeze reviewed wire fields and `CASE-WIRE-*` as applicable;
do not equate bus delivery with device application acknowledgement.

For shared volume/context or profile-boundary changes, include the three
`CASE-WIRE-PORTAL-*` and three `CASE-WIRE-FINGERPRINT-*` cases when affected.
Preserve down/up handling, current context instance and optional stored fields;
unifying helpers is not automatically behavior-preserving. `wire-contract-review.json`
also records seven specific operator bindings: working-directory/default script
paths, cross-extension native build input, root package scripts, a semantic
validator twin, OMR replay and controller Docker exclusion. Every affected binding
needs its own exact retained path or replacement and before/after acceptance proof;
the literal reference index is not an import-rewrite list or permission to run tools.

If the affected closure includes firmware gateway/time helpers or e-ink API
assembly, add `CASE-WIRE-KITCHEN-DISPATCH`, `CASE-WIRE-OMR-*`,
`CASE-WIRE-AUTOMOTIVE-*` and `CASE-WIRE-EINK-*` as applicable. Name the exact
source entry in `wire-contract-review.json`; preserve per-protocol timestamp,
field coercion, acknowledgement and HTTP format/side-effect rules. No generic
acknowledgement contract may silently strengthen or weaken these baselines.
The new cases are not firmware, durability, physical display or deployed-image
proof. They do not add these satellite source trees to Gratitude's move list.

Safety: fresh canonical task roots per baseline/candidate process; fake printers,
providers, network, messaging, hardware and identity. No live controller, user
records, real config or device deployment. Never restore fixtures into live data.
Reversal: preserve a reviewed parent commit and immutable fixture/artifact sets;
revert the exact changeset in an isolated workspace, rerun recovery checks, and
retain evidence. Do not reset or clean a user's workspace.

Evidence: one `RUN-...` record per command with full source/config/fixture/tool
identity, expanded population, actual outcomes, red/restored-green linkage and
review. Review roles are responsibilities, not invented approvals. Each card
stops on an unclassified edge, changed contract, missing artifact, hidden write,
case-count drift, unknown rank or dependency-identity change. Escalate to its
named reviewer. No card authorizes deployment, merging or another owner.

## IMP-BASE.04 — split executable household-config helpers from the data contract

Status: **design-blocked; no source change authorized.** Responsible/reviewer:
system-config implementation lead / architecture and test reviewers.
Prerequisites: DEC-CONTRACT-SYMBOL-SPLIT; refreshed source/import inventory;
approved public-entry and package design. Type: narrow symbol extraction.

In one isolated future changeset, retain `HOUSEHOLD_APP_CONFIGS` as the only
export of `@daylight/contracts/household-config`; extract `appConfigRelPath` and
`allAppNames` into a private system-config helper and redirect the exact
ConfigService lookup import. Preserve the single frozen mapping object, its
keys/values/order, unknown-name null behavior and fresh array behavior. Do not
change direct data-map consumers (`configLoader`, `YamlAdminConfigStore`, browser
Admin utilities, migration script) or infer new consumer permissions. Listed
tests include the current household contract test, ConfigService path cases and
direct-map consumer tests, plus new public-export and duplicate-registry red
controls. Candidate/restored runs must prove map identity, lookup/enumeration
behavior and absence of helper exports. Rollback restores source and imports
together; it never rewrites household data.

Exact files: add the approved private helper and focused test fixture only;
edit `backend/src/0_system/config/household-app-configs.mjs`,
`backend/src/0_system/config/ConfigService.mjs`, the approved contracts facade
and its manifest/export map, plus the exact current household-config tests from
`contract-consumption-review.json`. Do not edit direct data-map consumers,
household YAML, Admin endpoints, browser bundles, runners, locks or layer guides.

1. [ ] Freeze the map/hash and current import bindings. Exit: the frozen
   `HOUSEHOLD_APP_CONFIGS` object identity, key/value order and named helper
   consumers are recorded; an added direct helper consumer stops the card.
2. [ ] Extract only the two executable helpers privately. Exit: ConfigService
   retains identical outputs; the contracts facade exports only the data map.
3. [ ] Run positive and negative controls. Exit: household/ConfigService cases
   preserve identity, null lookup and fresh-array behavior; public-helper import
   and duplicate-map fixtures fail with their expected diagnostic.
4. [ ] Review reversal. Exit: source → contract → case evidence is stored;
   reversing the one changeset restores bindings and positive checks.

Before-change checks: protected-source census, `CASE-STORE-PROFILE-*`, current
household-config/ConfigService cases and the binding rows in
`contract-consumption-review.json`. After-change checks: same baseline/candidate
populations, public-export rejection, duplicate-registry negative and restored
green. Store source/map hashes, receipts and reviewer decision.

Safety: synthetic config objects and task-owned roots only; no household records,
controller, service process, deployment, package install or browser session.
Stop and escalate to architecture/system-config reviewers if the map, any
data-only consumer, rank rule, candidate export or case population changes.
Rollback reverses only helper/facade/import/test changes in the isolated
workspace, then runs the before-change checks; never restore persisted data.

- [ ] IMP-BASE.04 complete only with all exit evidence. It remains
  **design-blocked and not authorized** pending prerequisites and approval.

## IMP-BASE.01 — remove the unused controller import

Status: **ready for review, not authorized for execution.**

Responsible/reviewer: implementation lead / architecture and test reviewers.
Prerequisites: PRE-1; fresh baseline; explicit approval of this one-file edit.
Type: boundary preparation. Edit only
`backend/src/5_composition/modules/gratitudeApi.mjs`: remove the unused named
import from `../bootstrap.mjs`. Preserve every function, parameter, default,
registration and event payload. Affected contracts: CTR-GR-COMPOSE-01 and all
CTR-GR-HTTP entries. Reverse callers are in the dependency ledger.

1. [ ] Confirm the import is still unused at the new baseline. Exit: AST binding
   reference count is zero; closure and current file hash recorded.
2. [ ] Remove only that import. Exit: diff contains one deleted import; no other
   bootstrap imports or factory code changed.
3. [ ] Add a dedicated safe composition import/factory test using fake
   config/directory/print/publication ports. Exit: real factory mounts the same
   18 routes and bootstrap is not evaluated.
4. [ ] Restore the forbidden edge in an isolated copy. Exit: startup-refusal
   assertion fails for that reason, then the unmodified candidate passes again.
5. [ ] Review closure and reversal. Exit: no new import cycle or startup effect;
   reverting restores precisely the prior tree. Store parent/candidate diff and
   RUN evidence; architecture reviewer signs the bounded result.

Stop and escalate to the architecture/test reviewers if the binding becomes
used, the one-file diff gains any declaration/registration/event change, the
factory test evaluates bootstrap, or route/case population differs. Do not use
this card to repair the factory, controller, aliases, packages or fixtures.

- [ ] IMP-BASE.01 complete only with all exit evidence. This card is **ready for
  review**, not executed. The source-relative closure count 886→28 is static
  evidence, not a substitute for step 3.

## IMP-BASE.02 — make layer enforcement relocation-aware

Responsible/reviewer: tooling lead / architecture maintainer.
Prerequisites: PRE-3.3, PRE-7.1; DEC-POLICY-RANKS ruling; explicit tooling approval.
Type: reference/enforcement alignment. Exact known files:
`scripts/audit-layer-imports.mjs`, `tests/unit/tooling/auditLayerImports.test.mjs`,
`scripts/audit-direct-fs-imports.mjs`, `tests/unit/tooling/auditDirectFsImports.test.mjs`,
`docs/reference/core/layers-of-abstraction/domain-layer-guidelines.md` and
`docs/reference/core/layers-of-abstraction/decision-register.md` **only if the
maintainer approves exact text**.
Never increase `scripts/audit-baseline.json` to conceal violations.

1. [ ] Freeze authoritative rank/equal-rank/naming-contract rulings. Exit: exact
   paragraphs and exhaustive context table approved; unresolved ranks fail closed.
2. [ ] Replace path-only applicability with canonical owner/layer metadata and
   resolved import/re-export/finite-loader targets. Exit: same D1–D10 across old
   and new layouts, API facade edges retain their actual target layer.
3. [ ] Integrate the new-owner/fs, API/public-application and unknown-rank red
   fixtures demonstrated by `cases/architecture.case.mjs`. Exit: real gate, not
   just prototype, rejects each with the expected diagnostic and accepts each
   legal counterpart; implemented-port and closed naming exceptions stay narrow.
   Apply equivalent applicability checks to the **separate** direct-filesystem
   gate: current API paths catch import/re-export/require/dynamic `fs` access,
   but proposed module API, capability adapter and platform rendering roots do
   not. Fixing only the layer-import scanner does not satisfy D10.
4. [ ] Preserve source/test discovery and reversal. Exit: all current paths remain
   scanned; no unknown file is treated as system or test by default; old and new
   allowlisted snapshots give explainable counts. Reverting restores gate code,
   not a manufactured passing baseline.

- [ ] IMP-BASE.02 complete. **Design-blocked:** exact current-test list, all
  semantic checks and maintainer rulings still require PRE-3.3/7.1 completion.

## IMP-BASE.03 — runner and baseline-fixture reconciliation

Responsible/reviewer: test owner / build and affected-domain reviewers.
Prerequisites: PRE-2.4, PRE-6.3; approval of each existing-file correction.
Type: fixture/tooling repairs. Known targets: `package.json`, `vitest.config.mjs`,
`jest.config.js`, `backend/jest.config.js`, `playwright.config.mjs`,
`scripts/gate-vitest.mjs`, `tests/_infrastructure/harnesses/isolated.harness.mjs`,
`docs/ai-context/testing.md`; only proven-necessary files enter the approved diff.
Piano fixtures are a separate sub-card after exact reproduction, never a blanket
permission to edit that list.

The [runner review](runner-review.md) provides actual discovery evidence and
five separate correction boundaries. It additionally identifies
`tests/_infrastructure/harnesses/integrated.harness.mjs` and
`tests/_infrastructure/harnesses/live.harness.mjs`: their dry-run branches currently
follow setup/network effects. This is a source finding, not authorization to edit.

`fileio-reference-review.json` identifies a separate migration-induced fixture
dependency: the exercise-library corpus-isolation predicate recognizes only the
old FileIO alias. This is **not a demonstrated baseline failure**. Its exact
old-or-public regex adaptation belongs atomically with IMP-SHARED.04.2's subject
import; preserve the original two allowed names, ten forbidden tokens and test
body. Do not weaken the corpus guard or classify its extracted-predicate probe
as original Vitest execution. Safe original-suite population/execution is still
required before this correction can be approved.

1. [ ] Reconcile declarations, dedicated discovery, existing runner discovery and
   assertions executed. Exit: each omission/skip has a disposition and owner.
   Current Vitest finding: 3,886 paths collapse to 3,821 canonical files; 65 alias
   paths come through `backend/shared` and `backend/shared-contracts`, while three
   excluded Node tests and two tracked old-worktree tests explain five omissions.
   Preserve the canonical assertions when correcting duplicate discovery.
2. [ ] Repair missing command references and classify every runner. Exit: commands
   point to existing scripts; relocated test roots cannot silently disappear.
3. [ ] Reproduce the historical Piano failures safely. Exit: exact current failing
   file/case and cause; propose fixture correction only if product behavior is
   right. A real product defect requires separate contract approval.
4. [ ] Remove one test from discovery in a disposable tree, then restore it.
   Exit: the real population gate fails then passes; no automatic exclude hides it.

   Preparation evidence: [discovery-root probe](evidence/discovery-roots-2026-09-06T15-10-13.618Z.json)
   executes the original gate's checked, extracted files-only functions against
   ten synthetic files and one directory symlink. The old root list selects one
   file; adding `modules`, `capabilities`, `platform` selects all five expected
   Vitest-owned files. Node/Jest imports, implicit Jest suite ownership, worktree
   duplicates, symlinks and `.case.mjs` remain excluded; explicit Vitest suite
   ownership remains included. Removing `platform` yields four and fails the
   exact-population assertion; restoring it yields five. This is **not** the
   complete gate's regression reporter or downstream Vitest execution, so this
   subtask remains open. No production gate or baseline was changed.

- [ ] IMP-BASE.03 complete. **Design-blocked:** whole-runner reconciliation and
  present Piano reproduction remain preparation work. Rollback: reverse only
  the approved config/fixture changes together, restore the exact runner roots,
  then confirm both populations and assertion results before closing the card.

## IMP-POLICY.01 — inject the household study-day policy into Piano

Status: **design-blocked and not authorized for execution.**

Responsible/reviewer: Piano owner / architecture and affected-test reviewers.
Prerequisites: the adopted strict-downward policy; a fresh baseline; explicit
approval of this exact source/test change. Type: bounded dependency inversion.
Known current edge: `backend/src/2_domains/piano/gameBudget.mjs:19` imports
`studyDate` from `#domains/school/timing.mjs`. It must be removed without
changing the 4am household-local day contract.

Do **not** copy `studyDate`, move it into `shared/contracts`, or substitute a
UTC/default-timezone calculation. `studyDate` is executable calendar policy,
not a declarative contract. The Piano application/composition layer may supply
a `studyDateFor(instant, timezone)` capability implemented by the selected
calendar policy; the Piano domain must depend only on that injected capability.

Preparation probe (2026-09-06): a disposable candidate using a
Piano-application calendar adapter preserved the 4am/DST outputs and
missing-timezone error under direct Node assertions. This is design evidence,
not a source change or a completed card. The named affected Vitest suites and
the restored-edge negative control remain required for implementation approval.

1. [ ] Freeze the existing contract. Exit: the two current `budgetStudyDate`
   cases, the Piano budget-service boundary/DST cases, and the explicit
   missing-timezone failure are named with current hashes and pass against the baseline.
2. [ ] Select the injection seam. Exit: the approved constructor/factory owns
   the `studyDateFor` binding; it receives the existing School implementation
   from composition or a Piano-owned application adapter. The domain file has
   no `#domains/school` import and has no default executable calendar fallback.
3. [ ] Preserve call semantics. Exit: an injected spy receives the same
   normalized `Date` and nonblank timezone; invalid/blank timezone still
   throws the present D6 error before the capability is invoked; the 4am and
   DST expected dates are unchanged.
4. [ ] Prove the guard. Exit: restoring the direct `piano → school` import in
   an isolated copy produces `domains-no-upward-domain-imports`; the candidate
   has no hierarchy finding for this edge and the original behavior tests pass.
5. [ ] Review reversal. Exit: the exact import/binding diff, affected
   application composition file, and tests are recorded; reverting them
   restores the prior dependency graph and no data file/schema changes.

Exact files: edit `backend/src/2_domains/piano/gameBudget.mjs`, the one approved
Piano application/composition binding and only the named budget/date test files
from the frozen baseline; add at most the selected Piano application adapter and
its focused test. Do not edit School timing, shared/contracts, browser date code,
storage, manifests or layer policy in this card. Stop and escalate if the seam
requires a second domain import, a default calendar implementation, changed
4am/DST output, a new data schema, or a broader owner move.

- [ ] IMP-POLICY.01 complete only with the before/candidate/restored evidence.
  This card does not authorize a generic time platform, School timing changes,
  browser date-code changes, or a storage migration.

## IMP-POLICY.02 — move barcode/trigger orchestration to an application seam

Status: **design-blocked and not authorized for execution.**

Responsible/reviewer: Trigger and Barcode owners / architecture and
affected-test reviewers. Prerequisites: the adopted strict-downward policy;
fresh baseline; explicit approval of the selected application entry and its
composition wiring. Type: bounded application orchestration extraction.
Known current edges: `backend/src/2_domains/trigger/services/BarcodeResolver.mjs:9`
imports `BarcodePayload`, and `:10` imports `KNOWN_COMMANDS`, from the
same-rank `barcode` domain.

`BarcodePayload.parse` is executable grammar and `KNOWN_COMMANDS` is derived
from an executable command map; neither belongs in `shared/contracts`.
The selected design must place the operation that combines barcode parsing,
location defaults, and Trigger `Response` construction in a Level-3
application service (or inject an equivalent application-owned resolver into
the Trigger registry). Domain modules may retain their own pure behavior, but
must not import each other directly.

Preparation probe (2026-09-06): a disposable candidate passed Barcode grammar
into Trigger through an application-owned dependency seam and preserved direct
content/command assertions. This is design evidence, not a source change or a
completed card. The named affected Vitest suites and each restored-edge negative
control remain required for implementation approval.

1. [ ] Freeze observable resolver behavior. Exit: the five existing
   `BarcodeResolver` cases and the ResolverRegistry barcode-routing case are
   named with current hashes; content, command, null, target/default-action,
   options, and case-sensitive content-id outputs are captured.
2. [ ] Select one composition boundary. Exit: the application service has an
   explicit input/output contract and is bound by composition; `ResolverRegistry`
   receives its resolver through a dependency seam rather than importing the
   Barcode domain. Do not leave a second default path that recreates the old
   cross-domain import at module load.
3. [ ] Preserve results and identity boundaries. Exit: the application seam
   delegates parsing to Barcode and response construction to Trigger without
   changing frozen output shapes; unknown locations/unparseable values remain
   `null`; no transport execution, websocket broadcast, or command-map
   evaluation is introduced.
4. [ ] Prove the guard. Exit: each restored direct import independently yields
   `domains-no-upward-domain-imports`; the candidate hierarchy report has no
   Trigger/Barcode finding, and the frozen resolver/registry tests pass.
5. [ ] Review reversal. Exit: exact source, composition, and test files are
   recorded with before/candidate/restored evidence. Reverting restores only
   the import/wiring graph; registry YAML and barcode formats are untouched.

Exact files: edit only `backend/src/2_domains/trigger/services/BarcodeResolver.mjs`,
the selected Trigger application/composition binding and frozen resolver/registry
tests; add only the approved application resolver seam and its focused test. Do
not edit Barcode grammar, command maps, registry YAML, transports, WebSockets,
shared/contracts, manifests or layer policy. Stop and escalate if the change
requires a new cross-domain import, output-shape change, default resolver path,
transport effect, or unrelated owner move.

- [ ] IMP-POLICY.02 complete only with all five exits. This card does not
  authorize promotion of Barcode or Trigger to platform, a generic scanner
  framework, or executable exports from `shared/contracts`.

## IMP-PKG.01 — prove the actual dependency arrangement outside the repository

Status: **ready for review, not authorized for execution.**

Responsible/reviewer: build lead / architecture and frontend/runtime reviewers.
Prerequisites: PRE-4.2; exact approved owner/facet/export matrix. Type: disposable
experiment, no production change. Inputs: the three captured manifest/lock scopes,
`owner-boundaries.json`, installed version/instance records. Write only task-owned
fixture manifests, locks, code and caches.

1. [ ] Generate non-overlapping sibling owner/public/server/web workspace packages.
   Exit: names/exports collide nowhere; owner roots are not packages; no wildcard
   private export; no private peer imports by consumers.
2. [ ] Perform offline or explicitly approved network installation with nested
   strategy and controlled scripts. Exit: initial install and clean reinstall
   produce the same lock/instance graph; report unavailable package archives,
   rather than borrowing repository install state silently.
3. [ ] Test real timezone versions in both import orders, React/provider identity,
   native canvas single-instance constraints, ESM/CJS export conditions and
   transitive peer constraints. Exit: every must-share/must-separate requirement
   is satisfied under the proposed install, without test-alias substitution.
4. [ ] Delete/alter an exported entry and deliberately collapse timezone scopes in
   separate fixture variants. Exit: named resolution/identity tests fail and
   restored fixtures pass. Preserve hashes, lock, compact dependency tree and logs.

Exact files: task-owned disposable manifests, locks, fixture source and caches
only; read the captured root/backend/frontend manifests and lock scopes without
editing them. Before/after verification records resolved public/private paths,
timezone/React/canvas identities, clean reinstall tree, fixture hashes and red/
restored-green logs. Stop if an archive is unavailable, a fixture needs a
repository dependency, a native/peer identity differs from the approved matrix,
or a network/install side effect exceeds explicit authority. Rollback deletes
only the task-owned disposable root and retains its sanitized evidence; it never
modifies production manifests, locks, caches or installed dependencies.
Required evidence: `RUN-PACKAGE-INSTALL` receipts for initial, clean-reinstall,
missing-export, collapsed-timezone and restored fixture variants.

- [ ] IMP-PKG.01 complete. **Partially proved:** native tests plus the later offline
  nested install/reinstall experiment preserve real timezone bytes in both import
  orders and detect collapsed instances/missing exports. Local vendor metadata
  pins do not certify all original ranges/locks/peers or React/Linux constraints.
  Complete those remaining in-scope experiments before repository adoption.

## IMP-PKG.02 — adopt approved packages and resolver projections

Responsible/reviewer: build lead / all affected-owner test reviewers.
Prerequisites: IMP-BASE.02/03, IMP-PKG.01, final PRE-4 matrix; explicit production
manifest/lock/tooling approval. Type: package/tooling. Targets: root/backend/
frontend `package.json` and `package-lock.json`, new approved facet manifests,
`frontend/vite.config.js`, `vitest.config.mjs`, `jest.config.js`,
`backend/jest.config.js`, `nodemon.json` and
`docker/Dockerfile`/`.dockerignore`. The source-reviewed projection matrix below
distinguishes required changes from checks; it does not yet freeze the package
manifest/lock diff.

Exact files: only the projection-matrix rows selected by the later frozen diff;
no other manifest, lock, resolver, watcher, editor or Docker file is in scope.

### IMP-PKG.02 projection matrix

| Exact source | Existing behavior to preserve | Required acceptance / future edit boundary |
|---|---|---|
| Root/backend/frontend `package.json` and `package-lock.json` | Three install scopes; root/backend import maps are scope-relative | Freeze all six files together with the approved new facet manifests. Native Node must resolve public entries without Vite/Jest aliases. Preserve intentional distinct dependency instances. |
| `frontend/vite.config.js` | Browser `@`, gaming and five shared aliases; React transform; Sass compiler options; environment-derived ports/proxies | Project only approved browser exports. Compile moved JSX/SCSS, SVG globs and worker imports with the same options. Verify external-root access/HMR in an isolated fixture; do not add a broad filesystem allowlist speculatively. |
| `vitest.config.mjs` | Matching browser aliases plus `#frontend`; explicit frontend React/library identities and root canvas alias; worktree excludes | Preserve test-environment behavior while adding approved resolutions. Assert actual imported React/provider identity. The canvas alias is a test arrangement, not proof of native production identity. Keep separate native checks. |
| `jest.config.js` | Root-relative `#system`, `#domains`, `#adapters`, `#rendering`, `#apps`, `#api`, `#backend`, browser and test-helper mappings; explicit test globs | Update affected aliases/mocks and discovery only for classified changes. Preserve existing exclusions and runner ownership; do not broadly map public packages to private trees and thereby bypass exports checks. |
| `backend/jest.config.js` | No alias map; no transform; backend-scoped `__tests__` and `.spec` discovery | Verify which moved files leave this scope. Assign each to its intended runner under IMP-BASE.03; do not duplicate the root Jest mapper merely for symmetry. |
| `scripts/gate-vitest.mjs`, `tests/_infrastructure/harnesses/isolated.harness.mjs` | Gate roots are `tests/unit`, `tests/isolated`, `backend`, `frontend`; isolated colocated root is `frontend/src` | IMP-BASE.03 owns discovery changes. Add approved new test roots, preserve runner classification and canonical deduplication, and reconcile exact moved case identities. Missing-root negative control must fail even if all remaining tests pass. |
| `package.json` script `backend:dev`, `nodemon.json` | Script explicitly uses `--watch backend`; config watches `backend` and `.env`; extensions `js,mjs,json,yml` | Update both surfaces coherently for moved server/shared inputs. Verify restart for a representative file in each approved server root, no duplicate restart, and no restart loop from generated output. Keep browser-only edits on the browser HMR path. |
| `tests/_infrastructure/frontend-env.mjs`, `frontend/src/test-setup.js` | Custom DOM environment and frontend dependency/setup authority | Keep as retained consumers unless package installation changes their resolution. Test worktree and clean-install resolution; never borrow an unrelated checkout unnoticed in the clean candidate experiment. |
| `.vscode/settings.json` | Watch/search exclusions only; no path aliases | Retain unchanged unless an observed editor failure requires a specific edit. Do not invent a `jsconfig.json`/`tsconfig.json` or alias mapping as part of a filesystem-only move. |
| `docker/Dockerfile`, `.dockerignore`, `docker/entrypoint.sh` | Install/source stage ordering and runtime launch/resource contracts | IMP-PKG.03 owns image context, resource and runtime-overlay checks; this card supplies its exact approved package/lock inventory. Entrypoint is a retained contract, not an automatic edit. |

The matrix is a source-based planning result. Resolver execution, watcher events,
editor behavior and full package installation have not been newly tested here.
Approval still requires the exact public-export projection and per-file patch,
not merely this list of affected settings. Reversal restores package, resolver,
discovery and watch inputs as one compatible set; keep discovered assertion IDs
stable across both layouts.

1. [ ] Freeze the full manifest/lock/resolver diff. Exit: no accidental version
   changes, ancestor workspaces, hoist collisions or overlapping owner IDs.
2. [ ] Add Node type/import maps and explicit public exports; project into
   Vite/Vitest/Jest/Sass/editor/watch tools. Exit: native Node succeeds without
   the preparation loader; browser builds resolve intended facet identities.
3. [ ] Run the complete affected-owner population, not only Gratitude. Exit:
   global install changes preserve all scoped versions/instances and test counts.
4. [ ] Omit a facet manifest/export/resource in an isolated build. Exit: real
   build or resolver fails with expected cause; restored candidate passes.

Exact files are the projection-matrix rows selected by the frozen diff; no
unlisted manifest, lock, resolver, watcher, editor or Docker file may change.
Required verification evidence: `RUN-PACKAGE-INSTALL`, native resolver and
affected-owner population receipts, plus missing-facet/export/resource and
restored-green diagnostics. Stop if the lock strategy, a peer/native instance,
an owner population or a public/private resolution differs from the approved
matrix; amend the design rather than widening aliases or exports.

- [ ] IMP-PKG.02 complete. **Design-blocked:** final lock strategy, all projection
  files and global affected tests are not yet specified. Reversal restores the
  complete previous manifest/lock/config set and does a clean isolated reinstall.

## IMP-PKG.03 — immutable controller build and loaded-client asset closure

Status: **candidate-pending and not authorized for execution.**

Responsible/reviewer: build/release lead / browser and runtime reviewers.
Prerequisites: PRE-2.3/7.3; IMP-PKG.01; approved build-only changes. Type: tooling/
build. Known files: `docker/Dockerfile`, `.dockerignore`, `docker/entrypoint.sh`,
approved workspace manifests/locks and browser build configuration. No deployment
or entrypoint behavior rewrite is authorized by this card.

1. [ ] Capture image digest, OS repository/package versions, downloader commit,
   supervisor version, native/font inputs and exact clean source context. Exit:
   baseline/candidate use immutable identical non-source inputs.
2. [ ] Enumerate every new manifest before install and every required owner asset
   before build; preserve executable modes and canonical symlinks. Exit: missing
   owner-root and changed-toolchain variants fail a content/provenance gate.
3. [ ] Emit transitive static/dynamic asset graphs for baseline and candidate. Exit:
   stable URLs are distinguished from hashed assets; same-URL/different-byte
   collisions are rejected or receive an explicitly reviewed serving strategy.
4. [ ] Execute both directions of already-loaded-client recovery in the isolated
   runbook below. Exit: unopened lazy routes still work; no new offline promise.

### IMP-PKG.03 source-context and runtime-overlay acceptance details

Source inspection of `docker/Dockerfile`, `.dockerignore` and
`docker/entrypoint.sh` establishes the following additional subtasks. These are
implementation acceptance requirements, not completed image experiments.

1. [ ] **Install-stage owner closure.** Extend the package-file COPY section
   before the first `npm ci` with every approved facet manifest and applicable
   lock from IMP-PKG.02. Preserve `scripts/install-git-hooks.mjs` there: root
   installation invokes it although `.git` is excluded. Record the three current
   root/frontend/backend installation scopes and `--legacy-peer-deps` behavior;
   changing those scopes requires the global identity tests, not only Gratitude.
   Exit: an engine-built context can install without checkout dependencies, and
   omission of a required facet manifest fails the named install/resolution gate.
2. [ ] **Source-stage owner closure.** Extend the source COPY section before
   `cd frontend ... npm run build` for the approved `modules/`, `capabilities/`
   and `platform/` populations. Preserve `--chown=node:node` and verify actual
   image paths/modes, not just Dockerfile text. Exit: all approved source and
   resource destinations are present; omission of an owner root fails the build
   or its explicit runtime-import gate. Do not require an unused root merely
   because the architecture reserves its name.
3. [ ] **Ignore-rule and native-resource closure.** Use Docker's actual context
   selection to check the nine approved font/notice destinations against their
   recorded hashes. Preserve the School subject-icon backend reader's frontend
   source assets until its authority is separately changed. Check that the
   Rubik's course YAML exception still reaches its unchanged consumer; a future
   move requires an exact replacement negation after the YAML exclusion. Keep
   `_extensions/` and `_extentions/` outside the controller image. Exit: resource
   omission controls fail; both `stockfish-18-lite-single.js` and `.wasm` survive
   same-layer pruning and callers still explicitly select `lite-single`.
4. [ ] **Runtime payload overlay.** Treat `/payloads/*` separately from immutable
   Vite output. The entrypoint copies `data/system/payloads/*.jar` into
   `frontend/dist/payloads` at startup, tolerating copy failure; those bytes are
   not determined by the image digest. With synthetic mounts only, record the
   absent-directory, empty-directory, successful-copy and same-name replacement
   outcomes for baseline and candidate. Exit: served URL and byte parity hold
   for the same supplied payload set, and the rollback manifest identifies that
   set separately. Do not promise that reverting an image restores older JARs,
   overwrite persistent payloads, or invoke the real entrypoint against live
   data/media/ADB/SSH mounts during preparation.
5. [ ] **Entrypoint contract and reversal.** Retain `/usr/src/app`,
   `DAYLIGHT_BASE_PATH`, `DAYLIGHT_ENV=docker`, `cd backend` and the
   `su-exec node forever index.js` launch contract unless a separately approved
   card changes them. Exit: candidate import resolution succeeds under that
   working directory and user, and reversal restores the previous Docker and
   package inputs plus prior immutable browser assets while preserving current
   persistent data and the explicitly selected runtime payload set.

Exact files: only the approved `docker/Dockerfile`, `.dockerignore`,
`docker/entrypoint.sh`, package/lock inputs and browser build configuration
identified by the frozen source-context manifest; task-owned image/build
fixtures are additive. Stop and escalate if an immutable input cannot be pinned,
a context/asset byte lacks provenance, an entrypoint contract changes, or loaded
client recovery needs live data, a controller, device, SSH or ADB access.

- [ ] IMP-PKG.03 complete. **Candidate-pending:** no candidate image or real
  browser asset handoff exists. Reversal serves the preserved prior immutable
  asset closure; a source revert alone is not sufficient recovery evidence.

## IMP-CAP-SCREEN.01 — split generic screen-host capability from installed-surface composition

Status: **design-specified and not authorized for execution.**

Responsible/reviewer: screen-host owner / architecture, browser-runtime and
affected product reviewers. Prerequisites: PRE-3.1.3, PRE-4.1/4.2, IMP-PKG.01,
IMP-BASE.02/03 and explicit scope approval. Type: future capability extraction;
**not part of the Gratitude rehearsal move.**

The current `frontend/src/screen-framework/index.js` exports both reusable
primitives and `registerBuiltinWidgets`. The latter imports product widgets,
and `ScreenRenderer.jsx` calls it at module load. `ScreenRenderer` also imports
Surround, menu navigation, app registry, FKB/global key capture and browser API
facilities. `ScreenActionHandler.jsx` imports Menu, Player queue/session
facilities, AppContainer and DaylightAPI. Those facts prohibit treating the
present index or renderer as a generic platform entry.

Proposed facets, subject to exact PRE-4 manifests and export maps:

| Facet | Candidate source boundary | Public rule |
|---|---|---|
| `capabilities/screen-host/web` | Initially product-free closure: `providers/ScreenProvider`/`useScreen`, `widgets/registry` and `input/actionMap` | Candidate `@daylight/screen-host/web` exports must have no product widget, AppContainer, menu, room, FKB, direct API or WebSocket-context import in their transitive closure. Browser logging/input adapters are reviewed separately; no server API is implied. |
| `capabilities/screen-host/composition` | `ScreenRenderer`, `panels/PanelRenderer`, built-in registration, action/command/subscription bridges, overlay/PiP/session publishers, Portal Keys and current device/menu/player wiring | Private composition facet. It receives the generic capability and product widget registrations; it owns installed room URLs, API/config loading, kiosk bindings and session behavior. |
| Product registrations | Current `widgets/builtins.js` imports: Time, Weather, Forecast, Upcoming, Finance, Health, Entropy, Piano, Menu, Art, Weekly Review, Camera, Party Games, School, School Reading and School Lesson | No product widget becomes a screen-host dependency. Preserve all 16 current registration names and their current component identities in an explicit installed-surface registration bundle. Additional products register through composition, not by editing generic capability exports. |
| Playback/Gaming integrations | `ScreenActionHandler`, `ScreenOverlayProvider`, Player session registry/bindings and Party Games surface | Playback remains `capabilities/playback`; Gaming remains `capabilities/gaming` with experience/environment subowners. The screen composition imports their public APIs or receives injected operations; it must not import their internals as a shortcut. |

Current graph measurement against `dependency-ledger.json` establishes the
initial boundary more narrowly than folder names suggest. `ScreenProvider`,
`useScreen`, `WidgetRegistry` and `actionMap` have no current product/context
closure. `ActionBus`, `useScreenAction`, `ScreenDataProvider` and
`useScreenData` reach the existing platform browser logging/WebSocket-service
graph; they are candidate **browser-runtime extensions** only after singleton
identity is tested. `PanelRenderer` reaches overlay/PiP and menu navigation
through the widget path, so it begins in composition—not the generic facet.
This is a graph observation, not a claim that platform logging itself is already
an approved package dependency.

1. [ ] Freeze the original `screen-framework/index.js` export surface, current
   registry names and each importer before moving anything. Exit: every old
   import has either a retained compatibility facade or an exact replacement;
   the generic entry is not created by retargeting the existing mixed barrel.
2. [ ] Extract only the confirmed product-free closure into the web facet and
   inject required browser services at the composition boundary. Start with
   ScreenProvider/useScreen, WidgetRegistry and actionMap; promote ActionBus or
   data primitives only after their browser-logging/service identity is proved.
   Exit: a static closure gate rejects `modules/`, `AppContainer`, menu
   navigation, `DaylightAPI`, app registry, FKB, product widget and direct
   WebSocket-context imports from the generic entry; any retained browser
   singleton has an explicit identity test. PanelRenderer remains composition
   until its overlay/PiP/menu dependency is inverted and separately verified.
3. [ ] Move the existing registry call and all room/product bindings together
   into installed-surface composition. Exit: the exact 16-widget registry
   population, Screen URL/autoplay behavior, key/input handling, Player session
   binding and current School/Party Games surfaces pass their affected existing
   tests plus a synthetic registration-population test. Do not claim physical
   kiosk/device activation from those tests.
4. [ ] Prove a negative package graph where generic screen-host imports without
   a product registration bundle, and a positive composition graph where all
   current registrations load once. Exit: the first has no product imports and
   the second has the frozen names exactly once; duplicate React/context or
   widget-registry instances fail the identity gate and restoration passes.

Known current-source anchors: `frontend/src/screen-framework/index.js`,
`ScreenRenderer.jsx`, `widgets/builtins.js`, `actions/ScreenActionHandler.jsx`,
`overlays/ScreenOverlayProvider.jsx`, `Apps/FitnessApp.jsx`, `Apps/PianoApp.jsx`,
`Apps/GamingApp.jsx`, `modules/Player/Player.jsx` and
`modules/Gaming/platform/runtime/GamingRuntime.jsx`. Exact moved-file lists,
manifest/lock/config projections and runner populations are deferred until the
subpath closure in step 2 is measured. Do not add a package or aliases as part
of this card's design phase.

Exact files: only the measured product-free generic-host closure, the
installed-surface composition entries and their frozen registration tests; the
anchor list is context, not permission to move every listed file.
Before-change and after-change verification compares the frozen generic import
closure and all 16 registration names, then runs the stated identity negatives
and restored-green composition graph.

Exact files are only the measured product-free generic-host closure, the
installed-surface composition entries and their frozen registration tests; the
anchor list is not permission to move every listed file. Required verification:
generic no-product-import graph, installed all-registration-once graph, React/
context/widget identity negatives and restored-green candidate receipts. Stop if
the closure retains a product widget, adds Player/Gaming product ownership to
generic host, requires a broad alias, or changes kiosk/config/device behavior.

Rollback restores the prior source/import/manifest/configuration set atomically,
then reruns the registry, import-closure and affected-surface checks. It does not
alter screen configuration, kiosk state, household data or a deployed device.

- [ ] IMP-CAP-SCREEN.01 complete. **Design-specified, execution-blocked:**
  present screen framework is mixed; exact product-free closure, package
  projections, affected test population and candidate build remain open.

## IMP-SHARED.01 — extract Gratitude composition and publication

Status: **design-specified and not authorized for execution.**

Responsible/reviewer: implementation lead / Gratitude and architecture reviewers.
Prerequisites: IMP-BASE.01; public/package design; explicit extraction approval.
Type: boundary extraction. Known edits:

| Source | Exact future change |
|---|---|
| `backend/src/5_composition/bootstrap.mjs` | Extract `createGratitudeServices` (currently lines 1920–1938) and its exclusive imports; retain unrelated factories and native content-app registry. Do not copy the global `dataService` singleton into the product. |
| `modules/gratitude/server/composition/createGratitudeServices.mjs` | Add factory with explicit `{dataService, logger}`; preserve returned store/service identities and default logger semantics. IMP-SHARED.02/03 add `gratitudeQueries.readSelectionQuotes` and `gratitudeCommands.addSelections` to that same factory; its canonical full proposed source is in `feed-boundary.json`, cross-checked by `homebot-boundary.json`. |
| `backend/src/3_applications/events/RealtimePublications.mjs` | Extract only `GratitudeEvents`; retain School/Gaming/Camera/Media classes and their callers. |
| `modules/gratitude/server/application/events/GratitudeEvents.mjs` | Same constructor/customItem contract, single publication and exact payload; no event-schema repair. |
| `backend/src/app.mjs` | Supply the same installed DataService/logger to the public factory; switch only Gratitude factory imports. Preserve single service instance shared by HTTP/Homebot/Feed bindings. |
| `modules/gratitude/public/server/compose.mjs` | Forward classified composition exports only. No global controller import. |

1. [ ] Freeze all incoming symbol references and public entries. Exit: factory and
   event class have complete replacement lists, no mixed barrel leakage.
2. [ ] Extract once and update consumers atomically. Exit: one implementation,
   no duplicate service/storage authority or compatibility bootstrap copy.
3. [ ] Compare exact factory outputs and all event/HTTP effects. Exit: baseline
   cases plus real new composition pass; duplicate-event and controller-import
   variants fail correctly; all other publication classes retain their tests.
4. [ ] Reverse the extraction in the fixture workspace. Exit: no new data format,
   provider startup or persistent state exists to undo.

Exact files: the six table rows plus their frozen direct importers and focused
composition/event tests; no other bootstrap factory, publication class, registry,
storage adapter or manifest may change. Stop and escalate if extraction creates a
second DataService/store/event instance, imports the global controller, alters a
payload/schema, expands the public compose surface, or requires unrelated owner
updates.

- [ ] IMP-SHARED.01 complete. Final import/export closure is still PRE-4 work.

## IMP-SHARED.02 — replace Feed's private storage knowledge

Status: **design-specified and not authorized for execution.**

Responsible/reviewer: Feed lead / Gratitude and architecture reviewers.
Prerequisites: approved DEC-FEED-QUERY; completed applicable IMP-BASE/PKG and
IMP-SHARED.01/04; explicit protected-source approval. Type: boundary extraction.
The [selected specification](feed-boundary.md) and `feed-boundary.json` replace
the previous unresolved normalized-DTO/query-facade proposal. The port/query/
reader paths, source snippets, ten exact edits and twelve baseline cases are now
named; syntax validation is not candidate execution.

File allowlist:

- `backend/src/1_adapters/feed/sources/GratitudeFeedAdapter.mjs`: nine anchored
  edits in `feed-boundary.json`, preserving all other sampling/bundle/port code.
- `backend/src/app.mjs`: one anchored constructor-binding edit; initial factory
  import/dataService injection belongs to the prerequisite SHARED.01 changeset.
- `modules/gratitude/server/application/ports/IGratitudeQuoteSource.mjs`:
  new synchronous application port, no imports.
- `modules/gratitude/server/adapters/yaml/YamlGratitudeQuoteSource.mjs`:
  new adapter, actual `extends` of that port, injected DataService only.
- `modules/gratitude/server/application/queries/GratitudeSelectionQuery.mjs`:
  new query over the injected port, no persistence implementation import.
- `modules/gratitude/server/composition/createGratitudeServices.mjs`:
  expand the single prerequisite factory using the exact selected source.

Neither the strict `YamlGratitudeDatastore` nor `GratitudeService` needs a behavior
edit for this seam. The Feed-owned browser card and existing prototype-based
`AdapterProvides.test.mjs` stay unchanged. Do not add `server/queries` exports,
a second Feed port, compatibility fallback or a household identity endpoint.

Stop and escalate if a proposed source anchor is stale, a Feed edit needs a
different constructor dependency, or the operation requires a new API, storage
writer, asynchronous boundary or cross-owner private import.

1. [ ] Freeze the source hashes, edit anchors and private-file source/import
   lists in `feed-boundary.json`. Exit: all anchors still occur exactly once,
   import targets resolve under their named owner/layer, and the only installed
   constructor caller is accounted for. Update preparation fixture construction
   through target-specific drivers, not changed behavior expectations.
2. [ ] Create the three private files and expand the one composition factory.
   Exit: port has a real extending adapter; query only consumes that port;
   original store/service identities remain intact; one new bound operation is
   returned as `gratitudeQueries.readSelectionQuotes`, with no startup read.
3. [ ] Apply the nine Feed edits and installed binding in the same changeset.
   Exit: Feed takes `readGratitudeQuotes`, never DataService/YAML or a private
   Gratitude import; missing dependency throws the explicitly new constructor
   error; no old/new fallback path remains.
4. [ ] Run all twelve `CASE-GR-FEED*` oracles against baseline and candidate.
   Exit: absence versus empty, legacy truthiness/types, negative/default limits,
   selected-only interpretation, group-label/error/timestamp order, default
   household, synchronous scheduling, warning behavior and inherited page/no-op
   contracts match. Record fixture and resolved implementation identities.
5. [ ] Check the new operation directly: exactly one read per call, no read during
   construction/iteration/field access beyond that read, no write/network/event/
   job, no global cache and no raw-row/storage-path API. Exit: repeat calls see the
   current source; views retain only their own read result and require no dispose.
6. [ ] Execute the specified negative controls: remove legacy-string support,
   eagerly project all rows, insert an await, and duplicate the read. Exit: the
   corresponding legacy, SAMPLE-ORDER/ERROR-ORDER or synchronous/read-count
   assertion fails for the intended reason, then passes after restoration.
7. [ ] Run native composition/private-import/layer checks and relevant Feed
   assembly/frontend acceptance. Exit: public composition supplies the operation,
   no private facade leak or app/FileIO permission is introduced, and bundle/
   card/avatar behavior is unchanged. Original provides declarations remain valid.

- [ ] IMP-SHARED.02 complete only after all execution exits above. **Exact plan
  available; execution/candidate proof still gated.** Rollback: remove the installed
  binding, Feed constructor, factory expansion and three new private files as
  one unit. Restore only code/bindings, never older household records. Retain
  no second query facade, old constructor fallback or duplicate writer.

## IMP-SHARED.03 — Homebot command and household projection

Status: **design-specified and not authorized for execution.**

Responsible/reviewer: product integration lead / Homebot, identity and Gratitude
reviewers. Prerequisites: IMP-SHARED.01/02 canonical factory; DEC-HOMEBOT-COMMAND,
DEC-IDENTITY; final PRE-4.3; explicit extraction approval. Type: boundary extraction.

Exact files: the Homebot subcard's eight source/test targets and the household
subcard's seven new files, three manifests and six existing edit targets, plus
only their separately approved package-card files.
Stop and escalate if either subcard requires a second Gratitude factory, a
cross-owner private import, a new endpoint, a duplicate client/store instance,
or an unlisted package/workspace/test-root edit.

### IMP-SHARED.03.1 — exact Homebot command changeset

Source/edits: [Homebot boundary](homebot-boundary.md) and `homebot-boundary.json`.
Exact production/original-test allowlist: its two `newFiles`, five distinct
`edits[].path` targets and `sharedFactory.path`—eight files, not the entire
Homebot tree. The new files join retained Homebot paths for the Gratitude
rehearsal and have mandatory single-copy final destinations under
`modules/homebot/server`; see the staging table. No new dependency package is
needed for the retained backend-scope port/adapter.

1. [ ] Freeze hashes of all eight targets/absences, eleven edit groups and nine
   existing import edges. Reconcile the shared factory hash with IMP-SHARED.02.
   Exit: no stale anchor, competing factory, unclassified import or surprise file.
2. [ ] Create `IGratitudeSelectionGateway` and its real extending
   `GratitudeSelectionCommandAdapter` from the specified source. Exit: adapter
   imports only its Homebot port; no service/datastore/HTTP/event dependencies.
3. [ ] Apply the usecase/container key rename and composition/app bindings;
   add the canonical returned command if not already present. Exit: one bridge
   per Homebot factory, same installed Gratitude service, same cached use case;
   no old-key fallback or broad-service injection into Homebot.
4. [ ] Update only the named original test's dependency keys/error string; add
   baseline/candidate preparation bindings. Exit: retained behavior assertions
   and all eleven linked command/batch cases run against both implementations;
   neither copied workflow logic nor skipped cases count as parity.
5. [ ] Add direct bridge/factory checks for five exact arguments, original array,
   bound service receiver, same promise/entity/error identity and no invocation
   during construction. Exit: actual D7 inheritance, D1 container isolation and
   early invalid-function error are proved; no extra async boundary or publication.
6. [ ] Execute the four `nextControls` in the machine specification and restore
   green. Exit: early broadcast, single-item substitution, clearing failed state
   and awaited-broadcast changes each fail their intended assertion.
7. [ ] Run native public-composition/owner-private/layer/instance gates and the
   affected HTTP/Homebot/browser event cases together. Exit: source:homebot still
   prevents browser duplicate persistence, batch partial-failure/retry semantics
   survive, and old bootstrap URLs remain unchanged.

- [ ] IMP-SHARED.03.1 complete only after execution proof. **Exact plan available,
  not executed.** Roll back the five existing-file edits, two new files and only
  the command addition to the shared factory as one unit; preserve its Feed query
  if IMP-SHARED.02 remains installed. Restore test bindings alongside code. Never
  overwrite newer selection data to reverse a source change. The eventual
  Homebot move must relocate these two files once before final cutover.

### IMP-SHARED.03.2 — exact household presentation/query/client changeset

Source/interface specification: [Household boundary](household-boundary.md) and
`household-boundary.json`. Core extraction targets are its seven `newFiles`,
three `manifests` and six distinct existing `edits[].path` files. Eighteen edit
groups have original anchors, ordered replacement text and Gratitude relocation
destinations. The unchanged router and two retained helper import dispositions
are explicit; no broad identity subsystem move is included.

`combinedEditSequence` verifies Feed → Homebot → household: 39 edit groups apply
in memory to ten original files and parse, thirteen proposed source paths are
unique, and the shared Gratitude factory hash agrees. This does not include all
foundation/relocation/package/driver edits; revalidate the actual prerequisite
state before executing the cards.

Additional prerequisites: IMP-PKG.02/03, IMP-SHARED.04 transport foundation,
approved `capabilities/household-identity/owner.json` and owner README/test/dev
targets. Root workspace/lock, backend/frontend dependency declarations and
build/watch/runner changes remain the package cards' explicit allowlists; the
sixteen core files do not stand in for that larger integration changeset.

1. [ ] Revalidate source hashes/absent destinations and the two exact public
   entries. Freeze the package and metadata prerequisites before implementation.
   Exit: no unknown target, layer/rank escape, version mismatch or undocumented
   workspace/runner addition. Do not create empty targets to satisfy metadata.
2. [ ] Add the shared application source port, its **extending** config adapter,
   presentation query and inert composition factory from the specified source.
   Exit: source/DTO fields are separated; no raw profile, IO mechanics, category
   policy or timestamp generation moves into the shared query.
3. [ ] Add the exact sibling public/server/web manifests and two classified
   facades under the approved package card. Exit: only the declared composition
   and roster-client entries resolve publicly; cross-owner private imports fail.
   Server imports no browser/React code; browser transport identity remains the
   approved platform instance, not a copied helper or accidentally isolated cache.
4. [ ] Apply the Gratitude helper/composition and installed app edits; coordinate
   the unused bootstrap helper import removal with existing extraction work.
   Exit: same ConfigService receiver, no read/side effect at construction, one
   injected query object; product category/time policy and router stay unchanged.
5. [ ] Add the direct-return roster client and switch FamilySelector/registry
   calls. Exit: original GET promise/response/error identity and bootstrap URL;
   no extra async/then, normalization, cache, retry, request or household selector.
   Preserve their separate label/avatar/error/selection policies and platform
   DaylightMediaPath import rewrite from IMP-SHARED.04.
6. [ ] Bind the new candidate to the existing baseline driver contract. Execute
   all nine linked server cases, five browser-consumer cases and affected
   Gratitude HTTP/print/timestamp flows on both sides. Exit: names/order/duplicates,
   raw value types, short-circuit failures, UTC/default/locale quirks, explicit
   reload visibility and response-spread/call order match without normalization.
7. [ ] Add direct source/query/factory/client tests for four bound operations,
   required versus optional config methods, actual port inheritance, caller
   argument/receiver identity and no eager profile reads. Exit: query can run on
   a synthetic application source without ConfigService or filesystem imports;
   browser facade returns the exact underlying promise and synchronous throw.
8. [ ] Execute all six specified `negativeControls` and restore green. Exit:
   general-directory substitution, eager profile copy, UTC repair, stale cache,
   early HTTP projection and swallowed browser rejection fail named assertions.
9. [ ] Verify native package exports/whole build context and layer gates, then
   both loaded-client artifact directions in the isolated rehearsal. Exit: no
   legacy/private source dependency or missing capability facet/asset; a source
   revert alone is not counted as browser recovery.

- [ ] IMP-SHARED.03.2 complete only after execution exits. **Exact core source/API
  plan available; global package/metadata/target and native candidate gates stay
  open.** Roll back the server/browser bindings, shared source/facades and their
  package/workspace additions together. Restore the old inline projection/helper
  and client calls; coordinate unused-import removal with the owning extraction.
  Keep unrelated Feed/Homebot/platform cards if still installed. No profile or
  selection data rollback is needed or authorized; the capability owns no new
  persistent state. Re-run baseline and loaded-client recovery proofs.

- [ ] IMP-SHARED.03 complete when both subcards meet their exits. Current command
  evidence is not a completed extraction or full conversation-flow certification.

## IMP-SHARED.04 — bounded foundation, not a platform-wide move

Responsible/reviewer: architecture lead / platform, Admin and build reviewers.
Prerequisites: complete PRE-3/4, IMP-PKG.02; explicit exact-file approval.
Type: relocation/extraction. Input allowlist is the **50 exact paths** in
`owner-boundaries.json.foundation`, their symbol references in the resolved graph,
and resource dependencies in `assets-and-storage.json`.

Exact files: only those 50 indexed foundation paths, their resolved direct
consumer edits, and the separately approved test/package files; no broad
platform or owner-directory move is authorized.

Measured impact: 1,830 incoming edges from 1,456 distinct source files, including
1,431 outside the foundation itself. A count of 50 dependencies must not be sold
as a 50-file changeset. Finalize the per-symbol minimum first; the approved
foundation-first architecture is unchanged, and no temporary facade strategy is
silently substituted to avoid this impact.

1. [ ] Assign each symbol its genuine layer/owner. Exit: generic errors/time/IO/
   logging/drawing/HTTP/browser transport are not mixed with Admin's public form
   controls, household naming declarations or Gratitude publication policy.
2. [ ] Produce the exact destination/public-subpath/consumer table for every
   required symbol. Exit: no `platform/services` bucket, broad wildcard, implicit
   `#` alias inheritance, or unclassified transitive helper remains.
   FileIO inputs are `storage-consumer-review.json`: 77 original exports, 321
   direct/barrel edges, source-addressed calls and 14 policies covering all 51
   production non-call references. Preserve injected default/callback selection,
   caller path suppliers, directory-cache identity and image download semantics;
   do not treat clock-only barrel imports as filesystem invocations. Source
   classification does not replace the remaining namespace/consumer-test review.
   `firstMoveImpact` separates seven moving IO-carrier consumers from 299 retained
   ones. Only the Gratitude datastore and temporary-print gateway have direct
   moving calls (eight plus two); their runtime roots do not derive from source
   location. Preserve the exact snapshot fallback and print projection cases,
   while reviewing retained consumers' import/identity effects independently.
3. [ ] Move only the approved minimum and update the complete reverse impact set.
   Exit: old/new-path layer tests, affected-owner suites and runtime identity
   checks pass. Keep unrelated Player/gaming/screen-host migrations out of this
   batch; their direction/classification is a constraint, not a request to move.
4. [ ] Record any temporary installed-composition bridge with exact consumers and
   final-cutover deletion gate. Exit: zero duplicate implementation or writer;
   reversal restores old paths/imports and instance graph together.

- [ ] IMP-SHARED.04 complete. **Design-blocked:** this is intentionally not a
  permission to relocate all 50 files. Their final public-symbol matrix is a
  remaining preparation deliverable, not work to invent during implementation.

### IMP-SHARED.04.1 — selected utility/core export and import changeset

Exact source specification: [Utility boundary](utility-boundary.md) and
`utility-boundary.json`. Responsible/reviewer: platform investigator / architecture,
test and package reviewers. Prerequisites: IMP-BASE.02/03, IMP-PKG.02, all five
`UTILITY-GATE-*` records and separately approved exact protected-file changes.
This subcard does not replace the wider IMP-SHARED.04 foundation work.

Additional exact inputs: `utility-reference-review.json` provides 26 source/mock/
guide/predicate edits; `combined-boundary-review.json` proves the joint selected
1,076-edit sequence on 835 existing files including FileIO/reference guards, HTTP, logging and rendering/fonts. Public utility names total 31,
including documented `parseToDate` at its pure origin; no new runtime behavior.

1. [ ] Resolve the two `baselineDefects` first. Exit: safely characterize the
   missing-export behavior under the actual Home Automation test runner (do not
   assume it rejects instead of yielding an undefined matcher), separately approve changing only their
   `AuthorizationError` specifiers to the existing application semantic-errors
   module, and run the original assertions unchanged under their proper runner.
   Do not invent a platform error export to make a stale fixture load.
2. [ ] Complete `UTILITY-GATE-REFERENCES`. Exit: every old-path mock, literal
   source/AST assertion, operator/tool/config/document reference has an exact
   update or justified retained reference. Two barrel deletions remain prohibited
   until this population is reconciled with the 551 source-edge dispositions.
   The selected 762-reference population is now classified. Apply the two Piano
   mock replacements with their imports; retain three intentional legacy-fixture
   references; add only the exact core-error entry to the three SchoolCalc
   predicates. Twelve live guide updates do not rewrite D4. Resolve the 22
   FileIO mock and 23 linked dynamic-import identity follow-ups and global scanner
   adoption separately; do not call them passed because their locations are known.
3. [ ] Approve package/metadata/enforcement changes. Exit: the eleven facade
   texts and export-map fragments integrate with the full platform public/server
   manifests, version/dependency/lock rules, contributor targets and per-entry
   layer metadata; actual loaded-target classification enforces D4/D5/D8/D10.
   No new rank, broad aggregate/wildcard, or old-tree private facade is accepted.
4. [ ] Compose exact edits against the canonical future sequence. Exit: all
   541 edit groups in 473 files retain their source anchors or have individually
   reviewed rebased replacements; the Feed/Homebot/household factory changes,
   other foundation edits and path moves apply together without lost edits.
   Retained consumers use public entries; moving server-facet consumers use
   private relative links. Preserve both School tests' lazy import timing.
   The ten selected specifications now pass the 1,076-edit in-memory check,
   including 82 shared-file overlaps and all 35 unique new source paths.
   Preserve its stale-span/overlap/anchor/rename-count controls. Still add remaining
   foundation, relocation, package, enforcement and driver changes before treating
   the whole execution sequence as verified.
5. [ ] Relocate the fourteen approved implementations once and add the eleven
   permanent classified facades; retire the two barrels after all consumers
   switch. Exit: no duplicate constructor, old/new implementation, compatibility
   shim or unresolved old import exists. Leave the unneeded string helper
   untouched; do not silently extend this into a general dead-code cleanup.
6. [ ] Verify affected behavior and import identity. Exit: six original utility
   cases plus all selected affected consumer suites pass on baseline/candidate;
   public/private errors retain `instanceof` identity, pure `parseToDate` remains
   the same binding and the clock formatter remains its distinct wrapper.
   Prove dependency-free configuration-error loading, clock/error closure
   exclusion of FileIO, and actual package resolution without the prep loader.
7. [ ] Run duplicate-error-class, changed-default-timezone and wrong-time-helper
   mutations. Exit: each fails the named acceptance oracle and restored candidate
   is green; these utility negatives are not yet executed preparation evidence.
8. [ ] Re-run preservation/architecture/API/storage/consumer gates from the
   rehearsal packet. Exit: no route, payload, persisted timestamp, stored data,
   event or side-effect-order change is hidden in import cleanup.

Rollback: revert the utility implementation moves, facade/export/dependency/lock
changes, barrel retirements and their entire consumer import set as one coherent
revision. Restore old paths and module identities together; never leave a facade
pointing to a missing private module or retain two class copies. The independently
approved Home Automation fixture correction can remain if it is separately
committed and tested against the restored baseline. Do not roll back household
records, change timezone settings, or compensate for this code-only relocation
with a data migration. Record any generated build artifacts using the rehearsal's
artifact recovery procedure.

- [ ] IMP-SHARED.04.1 complete. Source imports/exports are specified; the five
  explicit gates above still prevent execution approval.

### IMP-SHARED.04.2 — FileIO package, mock and namespace preservation

Responsible/reviewer: platform/test lead / build and affected adapter reviewers.
Prerequisites: PRE-3/4/7, IMP-PKG.02/03, selected utility barrel retirement in
IMP-SHARED.04.1, and exact-file implementation approval. This subcard remains
design-blocked; the disposable probe is not permission to move FileIO.

Exact current inputs:

- `backend/src/0_system/utils/FileIO.mjs`: one canonical implementation, proposed
  `platform/server/system/utils/FileIO.mjs` and public
  `@daylight/platform/server/system/utils/file-io`.
- All 321 direct/barrel edges and 306 consumer files in
  `storage-consumer-review.json`; `fileio-boundary.json` selects the 73-name public
  entry and four unchanged private-only helpers. Default 77-name and selected
  exact 73-name facade fixtures both pass their eight expected native/Vitest
  observations. These are mechanism probes, not full package or original-consumer
  candidate approval; the selected source specification is fingerprinted.
- The 22 exact test-file/mock call spans and nine retained adapter reader paths
  in `fileio-mock-review.json`, plus the 23 linked dynamic-import edge IDs in
  `utility-reference-review.json`. They overlap the storage census, not a second
  import population.
- Native/real-Vitest experiments and scope limits in `fileio-mock-review.md`:
  the selected 73 bindings equal their private references, all four helpers
  remain private and one cache is shared. Duplicate implementation and mock-target
  controls fail the exact expected assertion and restore green. Simplified
  fixture layout/manual links do not certify the planned manifests/lock/build.
- All 303 exact import/mock edits across 281 files in `fileio-boundary.json`.
  The 36 unchanged original cases under `CTR-FILEIO-CONSUMERS-01` establish six
  baseline suites; same-case narrowed-facade candidate proof remains required.
- `fileio-reference-review.json`: 778 classified occurrences in 388 files and
  seven exact additional changes in five files. Three source comments and three
  adapter-guidance examples change spelling only. The exercise-library test's
  source regex gains only the exact public entry; keep its two allowed names,
  ten forbidden tokens, assertion body and manifest-only corpus rule. Its 17
  extracted-predicate observations are not an original-suite pass. Retain D5/D10
  and legacy path fixtures; three current layer regexes require resolved-target
  enforcement under IMP-BASE.02, not a broader public-import allowance.

1. [ ] Adopt the selected public/private entries and complete package/import matrix.
   Exit: every production, CLI and test consumer has its exact selected entry;
   alias/native/test-runner resolution reaches one physical FileIO implementation
   with the intended backend dependencies. D5/D10 still reject forbidden layers
   through the public facade; no shared-code exemption or wildcard private export.
2. [ ] Finalize each mock rewrite alongside its subject's import rewrite.
   Exit: the 22 call spans retain their factories, hoisting, partial export sets
   and asserted behavior. Public entry is the candidate for retained adapter
   readers, not an automatic global private-leaf mock. Retain all three
   test-local Fitness history fixtures and preserve 23 dynamic-import timings.
   If a new foundation-private IO reader is introduced, reopen DEC-FILEIO-MOCK-SCOPE
   and explicitly approve/test a narrowly owned test mechanism before proceeding.
3. [ ] Complete the safely runnable original-suite baseline, then run the same
   assertions against the approved candidate. Six original suites already pass;
   all remaining affected files still need their evidence. Exit: each file has the actual
   runner/population, reviewed setup/import effects, deterministic temporary
   fixtures, matching mock-call counts/arguments and no real filesystem fallthrough.
   Unsafe provider/controller/listener setup is isolated separately, not silently
   omitted or enabled. Fixture-only successes cannot stand in for these suites.
4. [ ] Verify native binding/cache and test-namespace behavior independently.
   Exit: public forwarding shares all approved function references and the
   original directory cache; repeated static/dynamic imports of the same entry
   share a namespace. Distinct public/private namespaces are not falsely required
   to be identical. Duplicate implementation and wrong-mock-target controls fail
   for the expected reasons; restored candidate passes. Never widen factories
   with `importOriginal` merely to suppress a missing-export failure.
5. [ ] Close package/build and broader consumers before moving Gratitude.
   Exit: manifests/lock/dependency instances, CLI loaders, retained adapters,
   browser exclusion and Linux/native delivery gates all name their actual
   evidence. Existing persisted paths, YAML behavior, image URLs and writer
   counts are unchanged. Stop on an unaccounted FileIO consumer or loader route.

Rollback: restore the old FileIO location, all affected production/test/mock/
dynamic import paths and package/lock configuration as one coherent revision.
Remove the corresponding candidate facade from the rolled-back artifact; never
leave two copies or a facade targeting a missing implementation. Retain diagnostic
evidence. No household data restoration or format migration is part of this
source-only change. Global release rollback remains the rehearsal's artifact
procedure, not a second writer or compatibility tree.

- [ ] IMP-SHARED.04.2 complete only after these exact consumer and package gates;
  current evidence establishes the mechanism and source exposure, not the move.

### IMP-SHARED.04.3 — cohesive HTTP middleware boundary

Responsible/reviewer: platform investigator / API, logging, test and build
reviewers. Exact inputs: `http-boundary.json` and [HTTP boundary](http-boundary.md),
`combined-boundary-review.json`, `api-registration-audit.json`, original-source
hashes and current server-foundation receipt in `evidence-index.json`.
Prerequisites: finalized PRE-3/4/7, IMP-BASE.02/03, IMP-PKG.02/03, the selected
utility/core import changes in IMP-SHARED.04.1, and separate exact-file approval.
The logging state/export boundary must be finalized before this changeset runs.

Exact move set: `backend/src/0_system/http/middleware/{index,errorHandler,
requestLogger,tracing}.mjs` to the same basenames under
`platform/server/system/http/middleware/`. This notation denotes exactly the
four `files` rows, not a shell glob or permission for a broader move.
Add only `platform/public/server/system/http/middleware.mjs`, whose four-name
source/hash and public/private package entries are specified in the JSON.
Retain the private index and all three private leaf defaults unchanged.

1. [ ] Finalize boundary/package/state approvals. Exit: per-entry metadata keeps
   platform ownership and system layer; selected public/private exports resolve
   to the one index, backend UUID dependency and canonical logger/error graph.
   The three logging candidates have their own exact visibility/instance plan;
   no broad logging barrel or test-reset control is implicitly published.
   Actual loaded targets enforce layer policy through facades, including the
   existing API/application/domain restrictions. No package wildcard bypass.
2. [ ] Finish every non-import and affected-test reference disposition. Exit:
   fixed-source-path assertions, mock targets, operator/configuration references
   and the three leaf-importing tests' expanded closure each have an exact
   retained/update decision and acceptance case. Keep School's dynamic import
   awaited at its existing beforeAll point; do not turn it into an eager import.
   The requestLogger double-mount predicate's exact baseline population is 191
   flat-directory `.mjs` artifacts. Map all of them explicitly for the candidate:
   189 retained plus the Gratitude router and colocated card test. The twelve
   `mountGuard` observations prove the unchanged old-root scan misses a duplicate
   mount in the moved router; an explicit full-population projection catches it
   and rejects missing/duplicate paths. Keep both original regexes/assertions,
   including old-router and test-file coverage. Specify the target-provider/
   runner edits with IMP-BASE.03; do not use exists-based fallback or call the
   string experiment an original-suite pass. The app global-mount path stays put.
   The protected literal census now records 1,278 occurrences in 214 files.
   Apply the exact SchoolCalc predicate and network-guide edits, bringing this
   card to 87 edit groups in 84 files. Eighteen extracted School observations
   show why only the exact public entry must be added: the two-file/three-import
   corpus fails the old predicate after retargeting, while ten forbidden and
   three retained forms preserve the old constraints. Keep all other School
   assertions. The missing devProxy guide link and stale mixed middleware recipe
   are pre-existing defects; neither justifies invented exports/source moves.
3. [ ] Freeze the complete safe baseline acceptance population. Exit: the 64
   original server-foundation cases remain green; dedicated tests additionally
   cover immediate async invocation/returned chain/synchronous throw, trace
   propagation and generated IDs, request finish/close/abort/exactly-once logging,
   sampling bypass/budget, path/device/body/query privacy and the full error
   status/shape/webhook/headers-sent matrix. Record fresh case IDs and expectation
   sources; do not substitute the 54 logging cases for missing middleware cases.
   Preparation now provides 37 passing dedicated cases (6 async, 4 tracing,
   12 logging, 15 error) plus the ten original direct HTTP cases. They use
   response/event doubles: actual Express status enforcement, socket/header
   behavior and full assembly remain acceptance gates. The same 37 assertions
   now also pass in the eleven-file native fragment with only three import-section
   substitutions and an identical assertion-body hash. Four original suites also
   pass all 64 named cases twice in the same fixture after only five planned
   import edits; original prelude/body/local bindings remain unchanged and full
   projected hashes match the combined plan. Remaining affected protected suites
   and the full installed candidate still need their own acceptance runs.
4. [ ] Specify and safely run original router/socket-suite verification. Exit:
   exact requestLogger, deviceIdentity and School suite selections retain their
   original assertions, source-mount predicates and populations; disposable
   listeners never attach to/reuse a household controller. Under the current
   network-denied harness these remain not-run, not passing. Any different safe
   listener harness needs its own inspected command/effect record first.
5. [ ] Apply the exact coherent source/package changeset. Exit: four bodies move
   once, three private re-exports remain valid, all 82 import literals, four
   guide spellings and the one School predicate edit apply at reviewed spans;
   the four-name facade matches its stored source. Merge the two utility/reference edits inside errorHandler;
   preserve all LoA guidance except the three approved path spellings. Reconcile
   the full combined edit proof with moves and manifests before execution.
6. [ ] Verify native package and state identity. Exit: public/private functions
   and InfrastructureError constructor are identical, with one intended logger/
   dispatcher graph, preserved module-created sampling state and dependency scope.
   Repeated static/dynamic imports retain identity. No prep scope loader counts
   as native resolution proof. Test timestamp defaults, global timezone retention,
   initialize/reset/flush effects and actual transport failure semantics without
   silently improving them during relocation.
   Preparation's `http-identity` experiment now proves the selected eleven-file
   closure using seven exact planned edits, nine facade paths/bytes and eight
   private subentries. Native UUID 11.1.0 resolves ESM/CJS separately under the
   server facet; all 190 vendor files are hashed. Twelve probes and the same
   37 contract assertions pass without a preparation loader. Initial/restored
   source/facade/manifest/vendor hashes and private source population match.
   All 64 original error/logging cases now also pass twice over this fragment;
   the error-string suite's leaf-to-barrel expansion is covered. This does not
   close full installation/lock/build, remaining-suite parity or actual caller/
   layer enforcement. Require fresh evidence for the
   real package graph after applying the separately approved changeset.
7. [ ] Verify all affected routers and global middleware ordering. Exit: baseline
   and candidate contract populations match, including current trace/device/auth/
   session/body-parser/request-logging/error ordering, string/object envelopes,
   webhook behavior, implicit HTTP methods and absence of duplicate logging.
   URLs, statuses, payloads, privacy behavior and lifetime are unchanged. Tests
   cover all affected consumers, not just Gratitude's directly imported router.
8. [ ] Demonstrate named counterexamples and restoration. Exit: duplicate-function
   or dispatcher identity, changed synchronous-throw handling, double finish/close
   logging, query/body leakage and altered webhook/trace behavior each fail the
   intended oracle; restored candidate is green. Four original-source controls
   now fail the exact declared case sets and restore all 37 cases: removed async
   rejection chain (three failures), removed duplicate-response guard (one),
   overwritten incoming trace (one), and private-field reads (one). They bring
   the recorded product pairs to eleven. Four separate native graph controls
   now catch duplicate middleware (one probe), duplicate InfrastructureError
   (two, including object-response 503-to-500 change), duplicate dispatcher
   (four, including both HTTP loggers and sampling) and leaked default (one).
   Each restored fragment passes all twelve probes; all 37 dedicated contracts
   and the 64 original error/logging cases pass again.
   Do not add these mechanism runs/repeated cases to the product baseline count.
   Changed synchronous-throw/webhook behavior and the full installed candidate's
   controls remain open; fragment proof is not production migration approval.

Rollback: restore the four original locations and exact consumer/guide imports,
canonical utility/error/logging dependencies, facade/export maps and lock/resolver
changes as one coherent revision. Remove the candidate facade from the reverted
artifact; do not leave two middleware implementations or dispatchers, dangling
public entries or a deprecated runtime. Restore the original deployed artifact
via the rehearsal recovery procedure if needed; do not edit logs, household data,
trace settings or API clients as compensation for a source-only relocation.

- [ ] IMP-SHARED.04.3 complete only after these consumer, layer, state and package
  gates. Current evidence specifies the move/import surface and selected baseline;
  it does not authorize relocation or certify full middleware/candidate behavior.

### IMP-SHARED.04.4 — server logging runtime/test surface and singleton preservation

Responsible/reviewer: platform investigator / logging, API, affected-test and
build reviewers. Exact inputs: `logging-boundary.json`, [logging boundary](logging-boundary.md),
current `logging-identity` receipt, the original server-foundation receipt and
`combined-boundary-review.json`. Prerequisites: finalized PRE-3/4/7, IMP-BASE.02/03,
IMP-PKG.02/03 and exact-file implementation approval. Coordinate with HTTP
IMP-SHARED.04.3 so its module-created loggers keep the same canonical graph.

1. [ ] Adopt the exact public and test-only metadata/export contract. Exit:
   three runtime entries publish exactly five names; the fourth publishes only
   `LogDispatcher`, `LEVEL_PRIORITY` and `resetLogging` to test consumers. Both
   dispatcher facades resolve the same private implementation. Production and
   runtime re-export chains to testing fail the real checker; normal internal
   class/priority use remains legal. Node exports alone are not this enforcement.
   Do not add a NODE_ENV branch, wildcard private export or second test dispatcher.
2. [ ] Reconcile the full reverse/reference population before retirement. Exit:
   all 37 incoming edges and 91 selected text references have current dispositions;
   computed/external/runner consumers are separately closed. Confirm zero callers
   of `backend/src/0_system/logging/index.mjs` and approve its one-file retirement
   explicitly. Keep its five re-exported utility/config/transport targets in place;
   no unrelated leaf cleanup or old forwarding shim is authorized.
3. [ ] Apply the source/import changes as one coherent graph. Exit: move exactly
   `logger.mjs`, `dispatcher.mjs`, `localTimestamp.mjs` from the old logging folder
   to `platform/server/system/logging/` with unchanged bodies/default aliases;
   add four exact facades under `platform/public/server/system/logging/` and
   integrate their recorded manifest fragments. Apply all 30 import groups and
   two spelling-only source/guide references; preserve five private relative
   links. Retire the unused aggregate after the reference gate. No transport,
   runtime hostname, timezone, configuration or API behavior change.
4. [ ] Preserve original test import binding and runner populations. Exit:
   API-status, dispatcher, ingestion, logger and session-file imports split into
   their exact runtime/testing entries without altered assertions or hoisting.
   All selected old/new original cases run under the intended runner and fixture;
   include the original 54 logging cases and every affected HTTP/ingestion/session/
   CLI consumer. Any unsafe listener/provider/data setup requires separate safe
   command design, not omission or live-server reuse.
   Preparation's thirteen-step `http-identity` receipt now executes the original
   54 logging and ten error-response cases twice using five exact proposed
   import edits in temporary copies. The runtime/testing splits retain local
   bindings and unchanged assertion bodies, with the same original named cases.
   This selected-fragment result is not ingestion/session/CLI or full installed
   candidate parity; those populations and enforcement remain required.
5. [ ] Reproduce native identity and state checks on the actual candidate. Exit:
   the twelve `LOGGING-*` probes retain exact IDs and expectations using actual
   installed candidate manifests, no preparation loader/manual-link substitution.
   Preserve late lookup, module-global timezone, caller/runtime timestamps,
   replacement without flush, synchronous reset with pending flush, per-logger
   sampling state, child budgets, send/flush failures and mutable priority identity.
6. [ ] Demonstrate counterexamples and enforce caller roles. Exit: a duplicate
   dispatcher fails binding/state tests and leaked runtime test exports fail the
   export oracle; restored candidate passes. Additionally fail production direct
   and re-export imports of the testing entry through the actual semantic checker.
   The existing five-step disposable fixture proves only the first two controls;
   caller-role enforcement is still an implementation prerequisite.
7. [ ] Verify integrated loading and delivery. Exit: all affected consumers resolve
   one canonical dispatcher and the intended module-created loggers; no omitted
   test, retained transport path, package/lock/build/watch input or source reference.
   Combine these 32 edits with the full relocation/package sequence; the current
   source-only combined proof does not perform deletions, installations or moves.
   No new startup, shutdown, transport, schedule or disposal semantics enter the diff.

Rollback: restore the three original locations, retired index, all import/test
splits and the two guide/source links together with the original export maps,
lock/resolver/build artifact. Remove the four candidate facades from the reverted
artifact; never leave two dispatchers or a test reset bound to a different graph.
Retain diagnostic evidence, and use the rehearsal's coherent artifact rollback
for any later release. Do not rewrite logs/household data or change timezone
settings to compensate for this source-only migration.

- [ ] IMP-SHARED.04.4 complete only when all source, consumer, enforcement and
  package gates pass. The exact source design and native fixture are delivered;
  real package adoption, retirement/moves and affected-suite parity are not done.

### IMP-SHARED.04.5 — rendering helpers and one bundled-font authority

Responsible/reviewer: platform/rendering investigator / Gratitude, Fitness,
School, Piano, eink, test and build reviewers. Exact file/span/source inputs:
`rendering-boundary.json`, [rendering boundary](rendering-boundary.md), the current
combined edit proof, original resource/rendering receipts and protected census.
Prerequisites: finalized PRE-3/4/7, IMP-BASE.02/03, IMP-PKG.01/02/03 and explicit
implementation approval. Source design is selected; package/native/font and
affected-suite gates remain design/verification prerequisites, not waived.

Preparation evidence: `run-rendering-identity.mjs` supplies a fifteen-step
old/new/restored selected-fragment receipt. The same ten original primitive
assertions pass with only two planned import substitutions. Ten probes in twelve
fresh native processes preserve selected pixels/metrics/PNG and font override/
failure behavior; five bad graphs detect duplicate helper, wrong locator,
missing font/notice and root canvas resolution. All written bytes/modes/links
restore. This is installed backend canvas 3.1.0 with manual task-package links;
it does not close locked/native adoption, all-owner suites, actual enforcement
or any implementation checkbox below. Re-run the reviewed command after any
source/spec/runner/native input change; `audit-packet.mjs` verifies freshness,
exact original names/bodies, source/asset/manifest reconstruction and negative
receipt controls. Full details and remaining limits are in the rendering review.

1. [ ] Resolve the actual native baseline before adopting a package. Exit:
   document installed backend canvas 3.1.0 versus backend locked 3.2.3 versus
   root installed/locked 3.2.1, with both declared ranges `^3.2.1`. Capture safe
   before/after resolution, binary and font-metric evidence for the approved
   dependency graph. No root fallback, incidental version update or silently
   pinned fixture stands in for this decision. Adjudicate the actual best-effort
   font-registration behavior versus the existing guideline separately; keep
   move-only semantics and binding layers explicit. Preserve supplied notices;
   unresolved Roboto distribution provenance is not open-source approval.
2. [ ] Approve exact ownership, visibility and artifact populations. Exit:
   three rendering implementations, four named public facades, one private
   system locator, nine bundled font/notice artifacts and one zero-caller
   aggregate retirement match the JSON. Recheck all 17 incoming edges, 123
   selected references and five font-root consumers. Rendering public entries
   do not grant application/API imports; no unused port or wildcard asset loader.
3. [ ] Freeze baseline and candidate test populations. Preparation now includes
   [four original consumer suites](rendering-consumer-review.md), 23 named cases
   passing before/after over the 48-file selected closure with twenty exact
   rendering edits. The JSON impact map retains all 84 test candidates, including
   nineteen further rendering suites and fifty-nine transitive suites.
   Exit: the five original
   `tests/unit/rendering/lib/TextRenderer.test.mjs` and five original
   `LayoutHelpers.test.mjs` cases execute unchanged, not merely parse. Enumerate
   and safely run affected School workbook/PDF/receipt, Fitness receipt/timelapse,
   Piano-image and eink-widget suites with fixed IDs, font fixtures and runner
   configurations. `workbookTheme.test.mjs` and `stub-widgets.test.mjs` retain
   every original assertion when their fixture roots change. Existing dedicated
   rendering/resource cases are supplemental, not all-owner coverage. Never use
   private fonts, records, live printers or a household controller.
4. [ ] Apply the coherent source/resource changeset. Exit: the three
   `backend/src/1_rendering/lib/{CanvasFactory,LayoutHelpers,TextRenderer}.mjs`
   implementations move to `platform/server/rendering/`; add the exact locator
   and four facade bytes; apply all 41 source/import/module/guide/comment edits
   in 22 files at recorded spans. Move all nine assets to
   `platform/server/assets/fonts` preserving bytes/modes/notices. Retire only the
   unused `backend/src/1_rendering/lib/index.mjs` after reference gates. The
   public system locator replaces the earlier conditional private-path proposals;
   do not apply both. Keep all runtime overrides, font basenames, frontend public
   resources and product rendering implementations in their existing ownership.
5. [ ] Verify same behavior through real public entries. Exit: all selected
   original cases pass, named helpers/private exports share identity, and the
   intended native canvas module is shared by moved and retained callers.
   Check absolute bundled root independent of CWD, primary/extra registration
   ordering before canvas creation, falsey Canvas overrides versus undefined-only
   PDF defaults, Timelapse's current absent-Bold/retry behavior, exact font
   metrics/PDF goldens and draw/rotation/crop/style mutations. Preserve existing
   swallowing/propagation; PNG magic alone cannot pass the font gate.
6. [ ] Demonstrate negatives and enforce boundaries. Exit: wrong locator root,
   omitted/altered bundled face or notice, duplicate canvas/helper authority and
   changed null/empty override semantics each fail a named oracle; restoration
   returns the identical population to green. Actual semantic checks reject
   application/API-to-renderer and cross-owner private source/asset imports.
   FileIO/D5/D10 are not bypassed by exposing a directory string.
7. [ ] Verify delivery and recovery. Exit: full installed package contents,
   lockfile, watcher/build inputs and Linux image contain the nine exact bundled
   artifacts once and resolve the approved native dependency. No omitted source
   root, changed frontend URL or swallowed font loss. Rehearsal recovery restores
   original imports, font authority, dependency artifact and baseline output.

Rollback: restore the three original source paths, retired aggregate, nine original
asset paths and all 41 recorded imports/root expressions/guide references with
the prior manifests/locks/build artifact as one revision. Remove the locator and
four candidate facades from that reverted artifact. Do not leave duplicate font
authorities, renderer bodies, native modules, private-path consumers or fallback
shims. Do not edit runtime media fonts, data, printer settings or user records as
compensation. Retain receipts and rerun the same named cases after reversal.

- [ ] IMP-SHARED.04.5 completes only when every source, policy, original-consumer,
  font, dependency and delivery gate passes. Preparation supplied exact changes
  and source-reference evidence, not authorization to perform them.

## Dependency order

`BASE.01` can be reviewed independently. Policy and runner reconciliation precede
global tooling adoption. `PKG.01` is an isolated preparation experiment;
`PKG.02/03` require its proof. The SHARED cards require their own exact reviewed
boundaries; a package facet must not import an implementation that has not yet
been placed legally. Combine dependent source/import/registration updates in one
reviewable changeset if splitting them would produce a broken revision.

Then follow `gratitude-rehearsal.md`: MOVE → VERIFY → RECOVER → REVIEW. Rehearsal
does not authorize rollout or another owner's migration. Any new functional fix
gets a distinct behavior decision and baseline refresh before relocation resumes.
