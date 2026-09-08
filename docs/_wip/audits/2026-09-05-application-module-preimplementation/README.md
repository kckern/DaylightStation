# Pre-implementation execution packet

Status: in progress, not migration-ready. All work is on
`preimplementation/application-modules`, starting at `a7035c49fc`.
The accepted [checklist](../../plans/2026-09-05-application-module-preimplementation-plan.md)
controls scope. Existing application code, tests, manifests and delivery files
remain protected. No migration, deployment, push or live controller is authorized.

## Evidence and status

Start with [readiness](readiness.md), [coverage and gaps](coverage-and-gaps.md),
[prerequisites](prerequisites.md), [future implementation cards](implementation-backlog.md)
and the [Gratitude rehearsal/recovery sequence](gratitude-rehearsal.md).
The [registration review](registration-review.md) separates installed namespaces
and mount provenance; the [runner review](runner-review.md) reconciles actual
file selections, unexpanded cases and unsafe discovery paths.
The [HTTP registration audit](api-registration-audit.md) accounts for API method,
mount, middleware and helper ordering, including source-backed baseline quirks.
The [provider/lifecycle review](provider-lifecycle-review.md) separates adapter
discovery from construction, records a duplicate provider key, and maps Fitness
widget installation plus seven Gratitude/shared lifecycle seams. The supplementary
[lifecycle accounting](lifecycle-closure.md) maps all affected calls, controller
schedules/cleanup and CLI contributions without claiming runtime teardown parity.
The [storage authority review](storage-authorities.md) records first-move paths,
codecs, cache/mode/atomicity behavior, three named central profile writers and
actual synthetic Admin-disk/shared-profile tests;
broader shared-caller namespace review remains open.
The [storage binding review](storage-consumer-review.md) inventories all 77 FileIO
exports, direct/barrel edges, call arguments and 51 production indirect references;
it separates helper contracts from caller-owned persistent namespaces.
The [Feed boundary](feed-boundary.md) specifies the returned Gratitude read
operation, three private files, exact factory/constructor edits and twelve
baseline compatibility cases, without claiming a migrated candidate.
The [Homebot boundary](homebot-boundary.md) specifies its returned batch command,
consumer-owned port/bridge, exact source/test edits and eleven baseline command
cases. The [household boundary](household-boundary.md) specifies the shared
presentation/source/client/facades, three manifest proposals and exact edits;
nine server/five browser cases constrain compatibility. Global package/metadata/
target and native candidate gates remain open.
The [resource review](resource-review.md) connects bundled/public assets, SVG globs,
worker defaults, font path changes, service-worker behavior and Docker declarations.
The [wire review](wire-contract-review.md) covers all nineteen initial satellite/source
boundaries, thirty unique selected wire cases and cross-root operator
references; absent implementations and remaining target proofs are explicit.
The [boundary design](boundary-review.md) classifies the 50 foundation candidates
and indexes their exact incoming symbols; `assembled-api.json` resolves factory
and nested mount provenance, and `external-targets.json` indexes independent
runtimes without claiming deployed-build or wire-protocol certification.
The [utility specification](utility-boundary.md) refines seventeen foundation
candidates into eleven selected public entries and exact source-import changes;
six original utility cases pass. Two preexisting stale test imports and the
remaining full-reference/package/identity gates are explicitly recorded.
The [utility reference census](utility-reference-review.md) adds 762 classified
references and 26 exact changes, while the [combined edit proof](combined-boundary-review.md)
checks all 1,076 utility/FileIO/HTTP/logging/rendering/reference/Feed/Homebot/household edits together in memory.
Their four verifier controls are not product contract mutation tests.
The [FileIO identity/mock review](fileio-mock-review.md) records an actual native/
Vitest facade counterexample and traces all 22 existing mock sites. It separates
stable function/cache identity from mock-target identity, and does not mistake a
synthetic private-reader failure for a demonstrated first-move regression.
The [FileIO public-boundary specification](fileio-boundary.md) selects 73 public
names, keeps four helpers private, and supplies 303 exact import/mock edits.
Six unchanged original consumer suites now pass 36 assertions in isolation;
they establish baseline behavior, not the selected facade's candidate parity.
The selected 73-name facade bytes separately pass the eight-step disposable
native/Vitest fixture, including binding/cache identity, private-helper exclusion
and exact duplicate/mock counterexamples. Full consumer/package adoption remains open.
The [FileIO reference census](fileio-reference-review.md) classifies 778 occurrences
in 388 tracked files and supplies seven additional edits. An extracted original
exercise-library source predicate demonstrably rejects the new import; its narrow
proposed repair retains the two-symbol and ten-forbidden-token constraints.
The [HTTP middleware boundary](http-boundary.md) selects four system files and
one four-name public entry, preserving the cohesive private barrel. Its 82
import changes, four guide spellings and one SchoolCalc predicate edit compose
with the other specifications: 87 edits in 84 files. The protected literal
census covers 1,278 occurrences in 214 files. Eighteen extracted School predicate
observations catch rejection of the new public entry and preserve narrow import
permissions. Four unchanged original suites pass 64 error/logging cases; another
37 direct HTTP cases pass with four exact red/restored controls. Original socket
suites, full middleware assembly and native candidate identity remain explicit
gaps, with exact future tasks under IMP-SHARED.04.3.
Twelve extracted mount-predicate/population observations additionally show why
the original double-mount source check must follow all 191 inspected artifacts:
its old-folder scan would lose Gratitude's router and colocated card test. This
is a source-gate counterexample, not another product assertion or migrated suite.
The selected eleven-file HTTP/utility/logging fragment now also runs natively
through nine exact facades and the backend's UUID 11.1.0 package. All 37 dedicated
HTTP assertions pass before/after four duplicate/leak counterexamples; twelve
identity/state probes verify the fragment, including error-class HTTP status and
module-created logging/sampling effects. Written source/facade/manifest/vendor
hashes and private source population restore exactly. The four original
server-foundation suites additionally pass all 64 cases before/after restoration,
using five exact planned import edits in temporary copies. Prelude/body/local
bindings and the baseline's named case population are preserved; no aliases,
scope loader or root setup is used. This is not full npm installation, lock/build
or all affected-suite parity, and does not increase the baseline case count.
See `http-identity` in the evidence index.
The [logging boundary](logging-boundary.md) selects three unchanged bodies,
three runtime entries/five names and one test-only entry/three names. Thirty
import groups plus two source-guide links are exact; the unused aggregate has
an explicit gated retirement. Its native five-step fixture passes twelve
identity/state probes and detects duplicate-dispatcher and leaked-test-export
counterexamples. Actual caller-role enforcement and full package/consumer parity
remain open; the fixture does not increase baseline assertion totals.
The [rendering boundary](rendering-boundary.md) selects three shared rendering
bodies/eight names and one public system font-directory value, with four facades
and one new locator module. Its 41 exact edits, 17 incoming edges, five font-root
consumers and 123 literal references are accounted for. Nine fonts/notices move
as one proposed authority; no private cross-owner font paths. Installed backend,
locked backend and root canvas versions differ and require explicit native
package/font proof. The separate fifteen-step rendering fixture passes the ten
original primitive cases before/after/restored and preserves selected native
metrics, pixels and fonts. Five bad graphs fail expected identity/root/font/
notice oracles, then restore. This uses installed backend canvas 3.1.0, not the
locked graph. Affected-owner suites, full install/build/image, distribution and
layer-enforcement gates remain open; baseline assertion totals are unchanged.
Machine-readable [current evidence](evidence-index.json) and
[packet integrity](packet-audit.json) distinguish fresh results from retained
failed/stale history. This is a partial preparation checkpoint, not completion
of all ten phases.

`task-status.json` records individual exits; checkboxes are updated only after
reviewing actual evidence. One investigator currently fills all reviewer roles;
self-review is explicitly not a fresh independent adversarial review.
The five architecture reviews remain historical evidence, not approval of tests
that had not been written at review time.

Evidence IDs describe reproducible commands, baseline, outcome and limitations.
Failures, unavailable prerequisites and missing coverage are not passes. Candidate
verification remains pending until a separately authorized implementation exists.

## Bootstrap evidence — RUN-BOOTSTRAP

On 2026-09-05, before branching, refreshed `origin` and inspected deployed source
with read-only Git commands. Both were at `2144f762a37408b906efc0e359dc4649078d5ab4`;
the deployed tracked worktree was clean. Committed the six planning documents as
`a7035c49fc02c5fdf47292f3f68e1e97364c358d` on main and created this isolated worktree.
No push, deployment or source merge was performed. Running image provenance has
not been verified merely by checking its source checkout.

The normal main-worktree pre-commit hook passed: direct filesystem checks
(2,542 runtime files), layer audit (existing 44 failure-object baseline unchanged),
UI tokens, ESM links (3,588 working-tree/3,586 staged modules), parsing
(9,341 working-tree/9,268 staged), SCSS (316 entrypoints), and the composition
contract registry (one file, nine tests). These are bootstrap diagnostics, not a
new-worktree full-suite or future-module certification.

## Reproducibility and privacy

Run commands from the isolated worktree. Source and fixture hashes identify
content; branch names alone do not. Reopen evidence if an input, lock, tool,
expectation, classification, resolver or fixture changes. Changed source outside
this task must be recorded separately and never reverted to manufacture a clean
audit. No personal paths, household records, tokens or device addresses belong in
this packet; use synthetic households `audit-household-a` and `audit-household-b`.

The only mutable repository outputs are this packet, the accepted checklist's
progress annotations, and new files under `tests/preimplementation/application-modules/`.
Runtime fixtures, installs, caches and render outputs use task-owned OS temporary
directories. No `.gitignore`, normal runner/configuration, or dependency-install
change is permitted. No `node_modules` symlink is created in this worktree.

## Commands inspected for initial use

`node tests/preimplementation/application-modules/tooling/census.mjs capture`
reads the tracked index and source bytes (symlinks as links, not followed), gets
Node/npm versions, and writes only this audit packet's JSON records. It does not
import application code or inspect private data. Capture is for initial evidence;
do not repeat it over the original baseline to conceal changes.

`node tests/preimplementation/application-modules/tooling/census.mjs verify`
compares protected fingerprints and the Git change allowlist without writing.
Neither command uses the live server, external services, install hooks or devices.

Ordinary `npm test`, dev/start commands, live harnesses and default Playwright
configuration are prohibited here: they can kill ports, start/reuse the household
controller, load real configuration or contact devices. Future commands require
their own command-safety entry before use.

## Refresh order

Do not repeat the initial census capture. After new case results, run the source
description, inventory enrichment, evidence audit and coverage annotation in
that order. Then run `reconcile-runners.mjs`, `review-registrations.mjs`,
`review-external-targets.mjs`, `assemble-api.mjs`, `review-api-closure.mjs`, `assemble-browser.mjs` and
`review-boundaries.mjs`, `review-provider-lifecycle.mjs` and
`review-lifecycle-closure.mjs`, `review-storage-authorities.mjs`, `review-storage-consumers.mjs`,
`review-feed-boundary.mjs`, `review-homebot-boundary.mjs`, `review-household-boundary.mjs`,
`review-utility-boundary.mjs`,
`review-utility-references.mjs`, `review-fileio-mocks.mjs`, `review-fileio-boundary.mjs`,
`review-fileio-references.mjs`, `review-http-boundary.mjs`, `review-logging-boundary.mjs`,
`review-resources.mjs` and `review-wire-contracts.mjs` to restore their enriched
records, then `review-rendering-boundary.mjs` (which depends on resource inventory)
and `review-combined-boundaries.mjs`, followed by `review-progress.mjs`, `progress.mjs`
and a final `audit-packet.mjs`. The tools live in the dedicated test folder;
parsing tools require the explicitly selected `PRE_TOOLCHAIN_ROOT`.
Descriptions intentionally regenerate ledgers, so skipping later enrichers loses
annotations. Freshness never converts an observed failure into a pass.

The independent `run-fileio-identity.mjs` experiment can be refreshed without
rerunning unchanged baseline packs. Run `audit-packet.mjs` with the explicit
`PRE_TOOLCHAIN_ROOT` to validate its runner/dependency manifest fingerprints as
well as source/fixture hashes. The audit keeps its counterexamples separate from
the selected product test counts. Run both default and `selected` modes after
wrapper/fixture changes; selected mode also depends on `fileio-boundary.json`.
`run-logging-identity.mjs` similarly fingerprints `logging-boundary.json`; refresh
it after selected-source/facade/spec/fixture changes. It uses exact selected paths
and manual package links, not a full install or original-suite candidate.

`run-http-identity.mjs` fingerprints the HTTP, utility, utility-reference,
logging and combined specifications. Refresh it after any of those change,
even if a change only updates recorded verification metadata. It also requires
the exact current parser, five runner entry/manifest fingerprints and full
190-file UUID vendor population. The referenced original baseline and all its
inputs, original tests and dedicated config are fingerprinted. The final audit
verifies its thirteen-step outcomes, source/facade/test/restoration hashes and
exact 37 dedicated/64 original case populations independently; repeated cases
and package controls remain separate from selected baseline totals.

`review-rendering-boundary.mjs` fingerprints source/resource/boundary inventories,
the selected font bytes and two installed canvas manifests. Run it after resource
inventory changes, then the combined review and any experiment that fingerprints
that combined artifact. Do not interpret source-only font path calculations as
native font metrics or package-content approval.
