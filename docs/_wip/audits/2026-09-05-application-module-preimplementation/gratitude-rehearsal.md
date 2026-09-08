# Gratitude rehearsal — future isolated execution only

Status: detailed verification/recovery sequence drafted; **not ready to execute**.
PRE-3/4's exact foundation/public-symbol decisions, missing contract cases and
the real package-install proof still gate the move. This document neither moves
Gratitude nor authorizes a production migration. Use the common task-card rules
and safety/reversal requirements in `implementation-backlog.md` for each card.

## Mixed-tree state and exit destination

The rehearsal has one Gratitude implementation under `modules/gratitude`, using
its sibling public/server/web packages. Unmigrated products remain in their
current directories, working against their existing contracts. Only approved
foundation dependencies move first. There is no `legacy/`, `deprecated/`, copied
controller or second writer. An installed-composition bridge, if indispensable,
must name its exact importers, target, deletion gate and owner; it is not a
catch-all alias or production feature flag.

`owner-boundaries.json.moves` supplies the current **31 old→new candidates**,
source hashes/modes, symbols and reverse consumers. `import-replacements.json`
supplies the **66 resolved edges** touching those candidates. Neither count is
the complete future diff: extracted factory/publication/query/port files and
the final shared-foundation changes need their approved additions. Non-import
registrations/resources must come from their separate ledgers.

The selected utility/FileIO/HTTP/logging/rendering/reference/Feed/Homebot/household plans have a joint
source-edit proof in `combined-boundary-review.json`: 1,076 edit groups in 835
existing files, 35 unique proposed source paths, 82 overlapping edit targets
and four verifier-defect controls. This is an input to the expanded ledger,
not the complete rehearsal diff or a migrated candidate. Incorporate the
remaining foundation, package/enforcement/driver and actual relocation changes
before approving this card. `utility-reference-review.json` separately preserves
mock identities, intentional legacy fixtures, D4 wording and exact guide updates.
`fileio-reference-review.json` adds the exercise-library corpus-guard adaptation;
apply it atomically with its subject's import and preserve the original constraints.

Retain Feed's adapter/card, Homebot's conversations, FamilySelector and shared
Admin form controls with their owners. Preserve `gratitude` AppContainer/content
identity, `Gratitude & Hope` label, config mapping and all 18 HTTP registrations.
No automatic owner-manifest activation is introduced. The generic screen host
remains an importable capability; installed screen content and product widgets
are composed above it. Generic Player/gaming migrations are not this rehearsal.

## IMP-GR-MOVE.01 — relocate the product and update bindings atomically

Responsible/reviewer: implementation lead / Gratitude, architecture and build
reviewers. Prerequisites: completed PRE-3/4/5/8/9; approved applicable IMP-BASE,
IMP-PKG and IMP-SHARED cards; explicit rehearsal approval. Type: relocation and
the enumerated binding substitutions only.

File allowlist:

- The 31 exact paths/destinations in `owner-boundaries.json.moves` (check case,
  SHA-256 and modes, not just filenames).
- Public/facet manifests and forwarding files approved in PRE-4. No wildcard
  `exports`; no parent workspace enclosing the server/web packages.
- `backend/src/app.mjs`: Gratitude service creation, renderer/presentation setup,
  Feed query injection and Homebot narrow command binding.
- `backend/src/5_composition/bootstrap.mjs`: exclusive Gratitude factory/import
  removal after extraction; leave the installed native-app metadata registry.
- `frontend/src/lib/appRegistry.js`: exactly the Gratitude lazy component and
  icon imports. Preserve registry keys/labels/params and household resolver URL.
- `frontend/src/modules/Admin/Apps/AppConfigEditor.jsx`: only Gratitude's editor
  import to its public settings entry; preserve the editor mapping.
- The exact affected importers and resources approved from the graph. An
  unresolved public subpath or unnamed importer stops approval of this card.

1. [ ] Freeze the expanded move/import/resource ledger and parent commit. Exit:
   every file has a destination, owner/layer, exact import substitutions and
   contract IDs; no unapproved split or conditional filename remains.
2. [ ] Relocate without rewriting behavior; preserve same-owner relative imports
   where valid, use approved public entries across owners. Exit: one physical
   implementation per artifact; all old private paths lose their consumers.
3. [ ] Apply source and registration substitutions in one working changeset.
   Exit: Node composition, AppContainer lazy launch and Admin editor all resolve;
   no intentionally broken intermediate revision is committed.
4. [ ] Check all 18 mounted registrations plus optional print location, unchanged
   IDs/config keys/events and actual DataService binding. Exit: route/consumer
   census diff has only the intended source references, not runtime changes.
5. [ ] Review source diff and first verification pack. Exit: only approved moves,
   imports/manifests/bindings; domain rank and D1–D10 unchanged. Store the complete
   file/mode/edge diff. Missing-export or missing-root negative fixture must fail
   real resolution, not a test-only alias.

- [ ] IMP-GR-MOVE.01 complete. Rollback: reverse the exact move and import/binding
  changeset as one unit in the isolated workspace; do not copy data back or keep
  dual old/new source trees. Re-run baseline population and resolver checks.

### Exact print-adapter subchangeset for IMP-GR-MOVE.01

Design selection: DEC-PRINT-EXPORT. Execution prerequisites remain IMP-BASE.02,
IMP-PKG, IMP-SHARED.04 and the parent MOVE card. Do not install this boundary now.

1. [ ] Move `backend/src/1_adapters/hardware/thermal-printer/TemporaryImagePrintGateway.mjs`
   to `modules/gratitude/server/adapters/print/TemporaryImagePrintGateway.mjs`.
   Retain class name, default/named exports, constructor, byte/options/result
   semantics and cleanup. Exit: source body unchanged except approved imports;
   source hash/mode relation accounted for in the move ledger.
2. [ ] Change only its two source dependencies: FileIO to
   `@daylight/platform/server/system/utils/file-io`; its existing port to
   `../../application/ports/IImagePrintGateway.mjs`. Keep actual `extends`.
   Exit: one port class, one approved FileIO instance; no direct fs or new
   application import of storage mechanics. Existing raw path/OS-temp disposition
   must already be resolved; this card cannot silently waive or repair it.
3. [ ] Add `modules/gratitude/public/server/adapters/image-print-gateway.mjs` with
   the exact forwarding source in `owner-boundaries.json.publicEntries`.
   The server facet exports `./image-print-gateway` to
   `./adapters/print/TemporaryImagePrintGateway.mjs`; the public package exports
   `./server/adapters/image-print-gateway` to its matching `.mjs` file.
   Exit: declared public→private dependency, no wildcard export, default and
   named exports are the same constructor, no port public entry introduced.
4. [ ] Replace the import in `backend/src/5_composition/modules/fitnessApi.mjs`
   and retained `backend/src/1_adapters/hardware/thermal-printer/TemporaryImagePrintGateway.test.mjs`
   with `@daylight/gratitude/server/adapters/image-print-gateway`. In moved
   `modules/gratitude/server/composition/gratitudeApi.mjs`, use
   `../adapters/print/TemporaryImagePrintGateway.mjs`. Exit: all five indexed
   source edges use their exact selected specifiers; no deep private consumer.
5. [ ] Run `CASE-GR-TEMP-CONTRACT`, both `CASE-GR-TEMP-CLEANUP-*` cases and the
   unchanged original Vitest assertion body through inspected baseline and native
   candidate drivers. Exit: root/filename, raw bytes, full options, identical
   job/result/error, cleanup and real port inheritance agree. The original
   Vitest case passes unchanged on baseline; candidate execution remains pending.
6. [ ] Prove public resolution from the actual Fitness composition package,
   same-owner resolution from Gratitude, and layer/private/browser rejection
   with production-ready gates. Exit: no test alias, bootstrap/renderer import,
   duplicate class/FileIO cache, peer-adapter permission or browser server code.

Rollback: reverse the facade/manifests, these five imports and implementation/
port moves with the parent changeset. Do not leave an old-path wrapper or copy
temporary files into household storage. Do not reverse by restoring old user data.

## IMP-GR-VERIFY.01 — baseline/candidate contract comparison

Responsible/reviewer: test lead / Gratitude and integration reviewers.
Prerequisites: IMP-GR-MOVE.01; all required cases specified and runnable; approved
candidate driver implementation. Type: verification/new dedicated test wiring.
Exact files: `tests/preimplementation/application-modules/tooling/run-node.mjs`,
`tests/preimplementation/application-modules/tooling/run-browser.mjs`,
`tests/preimplementation/application-modules/cases/gratitude.case.mjs`,
`tests/preimplementation/application-modules/cases/browser.case.mjs`, the approved
candidate-driver/configuration files under
`tests/preimplementation/application-modules/fixtures/gratitude-candidate/`, and
the generated sanitized `evidence/{gratitude,browser,architecture}-*.json` receipts.
No product fix, package manifest, lockfile, CI setting, real data, or device
configuration is in this card; any such need stops this card and requires its own
approved changeset.

### Driver contract

The present `fixture()` drives only baseline code; `candidateDriver()` deliberately
throws `CANDIDATE_NOT_IMPLEMENTED`. Do not pass an extra positional argument to
`run-node.mjs` expecting candidate mode: it denotes a controlled mutation.

The future common interface must return the same request function, state/effect
observers, fixture-reset behavior and household identities for either target.
Candidate construction must import the approved native public composition entry,
record its resolved source/package identity, and reject any route to baseline
implementation. It may adapt dependency wiring, never reproduce business logic.

The preparation selector now makes this operational for the dedicated Node and
browser cases: `PRE_TARGET=candidate` requires a candidate-driver path and a
green `PRE_BASELINE_EVIDENCE` receipt before any test process starts. The runner
compares the ordered named-case population and fails a candidate receipt unless
it exactly matches that baseline. An omitted candidate/receipt is an explicit
`not-run` record outside the test result; the current baseline selector cannot
be supplied as the candidate. This is harness enforcement, not candidate proof:
the eventual candidate driver must still resolve the approved public entries and
record their package/source identity before its parity receipt is accepted.
UI, renderer and consumer drivers must likewise select real candidate entries;
changing only the server fixture does not establish whole-stack parity.

### Ordered verification

1. [ ] Verify frozen inputs and safe execution. Exit: pristine baseline fixture,
   candidate fixture and artifact roots are distinct canonical paths with no
   symlink escape; every external port is fake; effects fail closed.
2. [ ] Run the baseline commands below and freeze exact populations. Exit: required
   existing/new cases pass and RUN hashes match current sources/assertions/tools.
3. [ ] Implement/select real candidate drivers, without the preparation installed-
   scope loader. Exit: native imports resolve public packages; an absent candidate
   or deliberate baseline substitution fails an identity assertion before parity.
4. [ ] Run precisely the same reviewed cases for the candidate. Exit: method,
   status, headers, DTO fields/order, selected IDs, dotted file keys, snapshots,
   event count/payload, failed-print behavior and cleanup match each oracle.
5. [ ] Exercise actual assembly and newly isolated composition. Exit: same instance
   across HTTP/Homebot/Feed, middleware order, defaults and mount population;
   no controller startup or real transport required. The current partial router
   harness is insufficient for full token/device/lifecycle behavior.
6. [ ] Verify real UI launch and interactions. Exit: lazy import, icon/styles,
   load/error/empty states, user/category/focus, short/long/repeat/orphan keys,
   select/discard/undo, exit and event cleanup match. Preserve characterized
   in-flight behavior unless explicitly approved otherwise.
7. [ ] Run the image/resource suite with fixed immutable inputs. Exit: Linux native
   resources/font closure, browser chunks, Node conditions and case-sensitive
   imports work. Mac jsdom/pixel tests cannot substitute for this step.
8. [ ] Repeat relevant red variants, then restored green. Exit: missing mount,
   changed response/storage, failed-print marking, duplicate events, missing
   cleanup/font/export/chunk each fail their named assertion, not setup.

Existing baseline commands (available now, on the reviewed OS/toolchain):

```sh
node tests/preimplementation/application-modules/tooling/census.mjs verify
PRE_TOOLCHAIN_ROOT=<installed-toolchain> node tests/preimplementation/application-modules/tooling/run-node.mjs isolation
PRE_TOOLCHAIN_ROOT=<installed-toolchain> node tests/preimplementation/application-modules/tooling/run-node.mjs gratitude
PRE_TOOLCHAIN_ROOT=<installed-toolchain> node tests/preimplementation/application-modules/tooling/run-node.mjs rendering
PRE_TOOLCHAIN_ROOT=<installed-toolchain> node tests/preimplementation/application-modules/tooling/run-node.mjs browser
PRE_TOOLCHAIN_ROOT=<installed-toolchain> node tests/preimplementation/application-modules/tooling/run-vitest.mjs stored-shape
PRE_TOOLCHAIN_ROOT=<installed-toolchain> node tests/preimplementation/application-modules/tooling/run-vitest.mjs print-gateway
```

Candidate/image commands are **not available yet**. Their exact expansion,
fixtures and expected case population must be supplied by the approved driver/
build changeset before this verification card is ready. Do not invent a
`npm run gratitude:test` success claim or use a dev/live harness as a replacement.

- [ ] IMP-GR-VERIFY.01 complete only after the required full comparison. Evidence:
  contract→case→baseline/candidate RUN matrix, source/import/instance manifest,
  red/restored pairs and reviewer disposition for every non-pass. Stop/reverse
  the isolated changeset on unexplained differences; retain failed evidence.

## IMP-GR-RECOVER.01 — storage and loaded-client rollback

Responsible/reviewer: test/build lead / Gratitude and browser reviewers.
Prerequisites: IMP-GR-VERIFY.01 and immutable baseline/candidate artifacts.
Type: fixture-only recovery. Exact files: the approved recovery driver/configuration
under `tests/preimplementation/application-modules/fixtures/gratitude-recovery/`,
`tests/preimplementation/application-modules/cases/gratitude.case.mjs`,
`tests/preimplementation/application-modules/cases/browser.case.mjs`, and generated
sanitized recovery manifests/receipts under `evidence/`. No production records,
device, source asset, service-worker or serving changes.

1. [ ] Baseline-writer → candidate-reader. Create synthetic options/selections/
   discarded records, printed history and snapshots with the baseline. Freeze
   raw YAML bytes and a semantic projection, then copy only those fixtures into
   an independent candidate root. Exit: candidate reads identical records,
   timestamps/order/IDs and historical Feed shapes without migration writes.
2. [ ] Candidate-writer → baseline-reader. Exercise add/select/discard/recycle/
   mark/snapshot using candidate code; close it completely. Freeze bytes, then
   open a copy using the baseline. Exit: original six stored-shape assertions
   and functional reads still pass; rollback requires no inverse data transform.
3. [ ] Candidate failure → baseline recovery. Interrupt only the synthetic process
   at approved operation boundaries. Exit: failed print never marks, temporary
   file outcomes match baseline, one writer remains, and no cleanup reaches
   outside the task root. Do not invent transaction guarantees the original lacks.
4. [ ] Baseline-loaded browser → candidate server/assets. Start an isolated static
   server with baseline assets and fake API/event ports. Open shell but not
   Gratitude/Admin lazy views; record loaded URLs. Swap only the served immutable
   artifact selection while keeping approved baseline chunks available. Open
   both lazy views and reconnect. Exit: no missing chunk, wrong bytes, duplicate
   subscriptions or changed bootstrap/config/event contract.
5. [ ] Candidate-loaded browser → rollback. Repeat the same process in reverse,
   leaving candidate chunks available for already-loaded clients. Exit: both
   cold and warm sessions still launch and operate. Include existing service-
   worker/offline behavior only if present; do not add a new offline feature.
6. [ ] Negative asset retention test. Remove an unopened required old chunk from
   a disposable served copy. Exit: the recovery test fails that URL; restoring
   its identical bytes passes. Stable-name collisions must have an explicit
   policy; a hashed-file retention rule alone does not solve them.

- [ ] IMP-GR-RECOVER.01 complete. Retain exact fixture/asset manifests and the
baseline/candidate serving selection used in each direction. Reversal is the
tested immutable baseline selection, not a live filesystem restore.
Stop: an unenumerated chunk, service-worker cache behavior, storage write, external
port, or recovery difference stops the isolated run; preserve the receipt and
return to IMP-GR-VERIFY.01 or a separately approved corrective card.

## IMP-GR-RECOVER.02 — focused contributor trial

Responsible/reviewer: developer-experience lead / a Gratitude/domain reviewer.
Prerequisites: verified owner packages, real safe development composition and
IMP-GR-VERIFY.01. Type: dedicated owner README/dev/test fixtures; its new exact
File allowlist: `modules/gratitude/README.md`,
`tests/preimplementation/application-modules/fixtures/gratitude-contributor/`,
`tests/preimplementation/application-modules/cases/gratitude.case.mjs`, and generated
sanitized `evidence/gratitude-contributor-*.json`. Any product source, workspace,
package, live-data, printer, Plex or household-service edit is excluded and stops
this card.

1. [ ] Start from a clean checkout with only documented toolchain prerequisites.
   Exit: the contributor can identify `modules/gratitude` and its public imports
   without configuring Plex, a household YAML mount, printer or global controller.
2. [ ] Run owner-focused tests and synthetic UI/server composition. Exit: real
   product code consumes fake identity/storage/print/event ports; no permissive
   fallback loads actual household data or changes server activation.
3. [ ] Make a throwaway domain-rule or private-UI change in the fixture checkout,
   observe its focused red/green feedback, then restore. Exit: contributor works
   inside the owner but still sees layer, API-contract and dependency violations.
4. [ ] Exercise the escape hatch deliberately: add a sample owner API handler
   through an injected operation, not a direct application import. Exit: the
   existing API layer rule remains enforced. No requirement to become a platform
   maintainer merely to contribute app behavior.

The owner walkthrough is not executable yet. Its future command is
`node tests/preimplementation/application-modules/tooling/run-node.mjs gratitude-contributor`
and its required population is the recorded `CASE-GR-CONTRIBUTOR-*` clean-checkout,
fake-port, red/green and injected-operation cases. Until the named driver and
candidate package exist, record this as `not-run`; no baseline command may stand in.

- [ ] IMP-GR-RECOVER.02 complete. Proposed future owner commands must be shown as
unavailable until implemented and verified. Record actual commands/time/setup
and friction; do not stage the throwaway feature as part of migration.
Rollback: discard the documented throwaway fixture-checkout change and verify that
the checkout returns to its recorded candidate revision; retain only its sanitized
red/green receipt. Stop and escalate to the architecture owner if the trial needs a
global controller, real household data, a direct cross-layer import, or any file
outside this allowlist.

## IMP-GR-REVIEW.01 — audit and stop

Responsible/reviewer: investigation lead / architecture, test, build and domain
reviewers. Prerequisites: MOVE, VERIFY and both RECOVER cards. Type: documentation.
Exact files: `gratitude-rehearsal.md`, `readiness.md`, `evidence-index.json`,
`packet-audit.json`, `task-status.json`, and generated sanitized evidence receipts.
No product, package, deployment, hardware, live-data or migration file is allowed.

1. [ ] Reconcile files, edges, exports, registrations, resources and tests with the
   approved ledger. Exit: no unexplained leftover or missing entry; remaining
   old-tree products are intentional and explicitly owned.
2. [ ] Review every evidence record and failure disposition. Exit: no stale,
   skipped, baseline-only, alias-only or prototype-only result masquerades as
   candidate/production proof.
3. [ ] Publish lessons and next-owner implications. Exit: foundation cost and
   generalization are supported by actual rehearsal results, not assumptions.
4. [ ] Stop. Exit: no subsequent owner migration, merge, deploy, hardware action
   or production data change without separate authorization.

- [ ] IMP-GR-REVIEW.01 complete. The final report must distinguish a successful
isolated rehearsal from a deployable full-repository cutover. This planning
packet has not executed any of these future cards.
Rollback: restore only an erroneous planning/evidence record to its prior reviewed
revision, then rerun the packet audit; never use this documentation card to revert
product or data state.
