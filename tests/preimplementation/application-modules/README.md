# Isolated module-migration preparation tests

New characterization and tooling experiments live here. Existing application
source and existing tests remain unchanged. Never run the household controller,
default live harness or default Playwright configuration from this directory.

Use explicit inspected commands from the worktree root. `tooling/census.mjs`
captures source fingerprints and emits the evidence packet; its `verify` mode
checks protected files. It does not import runtime code. Dedicated baseline
drivers and case packs now exist. A migrated candidate deliberately fails with
`CANDIDATE_NOT_IMPLEMENTED`; it never falls back to baseline.

## Available commands

Set `PRE_TOOLCHAIN_ROOT` to the explicitly inspected checkout containing the
existing installed root/backend/frontend dependencies. Do not install or symlink
dependencies into this worktree. Run from the worktree root:

```sh
node tests/preimplementation/application-modules/tooling/census.mjs verify
PRE_TOOLCHAIN_ROOT=/path/to/installed/checkout node tests/preimplementation/application-modules/tooling/probe-sandbox-capability.mjs
node tests/preimplementation/application-modules/tooling/run-node.mjs isolation
node tests/preimplementation/application-modules/tooling/run-node.mjs gratitude
node tests/preimplementation/application-modules/tooling/run-node.mjs rendering
node tests/preimplementation/application-modules/tooling/run-node.mjs browser
node tests/preimplementation/application-modules/tooling/run-node.mjs architecture
node tests/preimplementation/application-modules/tooling/run-node.mjs packages
node tests/preimplementation/application-modules/tooling/run-node.mjs registrations
node tests/preimplementation/application-modules/tooling/run-vitest.mjs discover
node tests/preimplementation/application-modules/tooling/run-vitest.mjs default-discover
node tests/preimplementation/application-modules/tooling/run-vitest.mjs stored-shape
node tests/preimplementation/application-modules/tooling/run-vitest.mjs print-gateway
node tests/preimplementation/application-modules/tooling/run-package-install.mjs
node tests/preimplementation/application-modules/tooling/run-fileio-identity.mjs
node tests/preimplementation/application-modules/tooling/run-fileio-identity.mjs selected
node tests/preimplementation/application-modules/tooling/run-fileio-consumers.mjs
node tests/preimplementation/application-modules/tooling/run-server-foundation.mjs
node tests/preimplementation/application-modules/tooling/run-http-middleware.mjs
node tests/preimplementation/application-modules/tooling/run-http-identity.mjs
PRE_TOOLCHAIN_ROOT=/path/to/installed/checkout node tests/preimplementation/application-modules/tooling/run-sass-bare-import.mjs
node tests/preimplementation/application-modules/tooling/run-logging-identity.mjs
node tests/preimplementation/application-modules/tooling/review-rendering-boundary.mjs
node tests/preimplementation/application-modules/tooling/review-combined-boundaries.mjs
node tests/preimplementation/application-modules/tooling/run-discovery.mjs jest-root
node tests/preimplementation/application-modules/tooling/run-discovery.mjs jest-backend
node tests/preimplementation/application-modules/tooling/run-discovery.mjs isolated
node tests/preimplementation/application-modules/tooling/run-discovery.mjs backend
node tests/preimplementation/application-modules/tooling/run-discovery.mjs legacy-unit
node tests/preimplementation/application-modules/tooling/run-discovery-roots.mjs
node tests/preimplementation/application-modules/tooling/audit-packet.mjs
```

These execution wrappers require macOS `sandbox-exec` and may need tool approval
to establish the explicit OS sandbox. Do not run their child commands directly
or bypass the sandbox when setup fails. Run `probe-sandbox-capability.mjs` first
when execution availability is unknown. A `host-denied` result means no case
process started; restore or approve the sandbox capability before treating any
baseline as executable. Test outputs/caches/installations are
task-owned temporary data; sanitized reports go in the audit packet.

`run-node.mjs gratitude <mutation>` accepts only the seven reviewed variants
(the missing-asset variant uses `rendering`). Its second argument is **not** a
candidate target. The mutation child must fail the expected named assertion;
the parent success indicates that expected red was observed.

`architecture` records known current checker misses plus prototype controls;
its green test count is not passing current enforcement. `packages` is a native
manual-link probe. `run-package-install.mjs` additionally performs an offline
nested install/clean reinstall with real vendored runtime bytes, both timezone
import orders, and two red/restored controls. Its local metadata pins are not a
certification of the complete original lock/peer/React/Linux graph.

`run-fileio-identity.mjs` uses unchanged FileIO bytes in manually linked disposable
packages, real native imports and the installed Vitest runner. It verifies all
77 bindings, stable dynamic imports, one directory-cache read and rejection of a
private public-package path. It expects a duplicate implementation to fail, and
a public-facade mock to miss a synthetic private reader; a canonical-leaf partial
mock restores both readers. Overall success records those observations, not
mock parity for existing consumer suites. No root loader, installation, controller
or original test body is used. Source exposure for all 22 current mock sites is
generated by `tooling/review-fileio-mocks.mjs`; that static overapproximation is
not actual test execution. Keep `PRE_TOOLCHAIN_ROOT` set for evidence auditing.

The `selected` mode repeats all eight steps with the exact 73-name facade source
in `fileio-boundary.json`, verifying the four private helpers do not leak and the
remaining bindings/cache retain identity. It fingerprints that specification.
Both modes use a simplified facade file location and experimental manifests;
neither is the full proposed install or original-suite candidate. These records
are separate from the baseline assertion count and product mutation pairs.

`run-fileio-consumers.mjs` runs six inspected original files unchanged: Workout,
FreshVideo lock, Composer, Piano preset, media progress cache and Strava job store.
Its explicit expected population is 36 cases, including five parameterized IDs.
Workout reads/writes real YAML under task TMPDIR and cleans its per-case fixture;
the other suites keep original mocks. Source closure hashes and exact per-file
counts are captured. This is baseline execution through the existing scope
loader, not a migrated package, narrowed namespace or all-consumer proof.
`tooling/review-fileio-boundary.mjs` writes the source-only 73-name public proposal
and 303 import/mock edits; it never applies those replacements to product code.
`tooling/review-fileio-references.mjs` scans all protected text for FileIO spelling,
classifies 778 occurrences, and specifies seven additional comment/example/test
predicate changes. Seventeen extracted-regex observations preserve the existing
exercise-library corpus-isolation constraint. No original test or corpus is
loaded; these observations are not baseline assertion-count additions. Run this
after `review-fileio-boundary.mjs` and before `review-combined-boundaries.mjs`.

`run-server-foundation.mjs` runs four unchanged original suites: error string
responses (10 cases), timestamp offsets (8), dispatcher (26) and logger (20).
It verifies all 64 actually pass with no skipped, missing or additional cases.
Only in-memory responses/transports, bounded fake timers and restored stream
spies are used, under the existing OS-denied effects and scope loader. This
does not run the original listener-opening requestLogger/School suites or prove
full middleware/candidate identity. `review-http-boundary.mjs` records the exact
four-file/one-entry middleware proposal, 82 import replacements and three guide
spellings. Run it before `review-combined-boundaries.mjs`; it edits only the packet.
It also extracts the original requestLogger source predicates without executing
that suite. Twelve in-memory observations expose the old-folder guard missing
the relocated router and specify a complete 191-artifact target population;
they are separate from original-suite or runtime assertion counts.

`review-rendering-boundary.mjs` specifies three shared rendering bodies and eight
existing public drawing names, plus one public system font-directory value.
It records four facades, one new locator, nine canonical font/notice moves, five
existing font-root consumers, 41 exact source/reference edits and 123 classified
literal occurrences. Run after `review-resources.mjs`, then run the combined
review. Nothing is moved or evaluated. Backend installed/locked/root canvas
versions differ; complete package/Linux and actual layer enforcement remain
separate tasks.

`run-rendering-identity.mjs` uses that source specification in disposable old/new
layouts: three rendering bodies, six planned edits, one locator/four facades,
nine byte/mode-preserved assets and two exact original-suite import changes.
The original ten assertions run before/after/restored. Ten native probes in
twelve fresh processes verify selected metrics/pixels/PNG, real font registration,
overrides and best-effort failures. Five bad graphs detect a duplicate helper,
wrong root, missing font/notice and root canvas resolution, then restore all
written hashes and links. Set `PRE_TOOLCHAIN_ROOT` explicitly as for the other
native fixtures. Network and outside-task writes are OS-denied. No scope loader,
root setup, production controller or repo install. Installed backend canvas
3.1.0 is a baseline characterization, not adoption of declared/locked versions.
The packet auditor independently validates the exact receipt and six tampered
receipt controls; these and the ten original cases are outside baseline totals.

`run-http-middleware.mjs` adds 37 memory-only original-code cases: six async,
four tracing, twelve request-logging and fifteen error-handling cases. It uses
the existing scope loader and response/event doubles, not native candidate
resolution or a listener. The separate population manifest must match exactly.
Its sole optional argument is one of `http-async-rejection`,
`http-duplicate-response`, `http-trace-overwrite`, or `http-private-fields`.
Each must produce the exact declared failing case set and nonzero child exit;
the parent succeeds only for that expected red. Run without an argument again
to record the restored 37-case green. No existing source is mutated on disk.
Response doubles do not prove Express status-range validation or socket/header
behavior. The four controls are product pairs; source-predicate experiments are not.

`run-http-identity.mjs` evaluates the selected native closure in a disposable
fixture: eleven implementation files, seven already specified import/comment
edits, nine exact public facades, eight private subentries and two manually linked
sibling packages. All 190 files of the installed backend UUID 11.1.0 package are
copied byte-for-byte under the private server facet. Native Node resolves its
ESM versus CJS conditions; no preparation loader or root UUID fallback is used.
The same 37 dedicated cases run before and after controls with only three import-
section substitutions (including splitting the logging testing entry). Their
assertion body hash is unchanged; this is not a second authoritative suite.
The four original server-foundation suites also execute before/after restoration:
64 identical named cases each time, using five exact HTTP/logging import edits
in temporary copies. Prelude/body hashes and local bindings remain identical;
all four projected hashes match the combined specification. A source-fresh
original receipt supplies expected full names and is included with its inputs
in the new receipt's provenance. `configs/http-originals.mjs` has no source
aliases, scope loader, root setup or ordinary discovery; only these four suites
are selected. Vitest is linked only inside the disposable fixture. No skipped,
pending, todo, missing or additional assertions are accepted.
Nine separate probe processes each run the same twelve declared checks. Four
counterexamples must fail exact sets: duplicate middleware (one), duplicate error
class (two), duplicate dispatcher (four), leaked default export (one). Restored
source/facade/manifest/vendor hashes and the eleven-file private population must
match the initial graph; temporary duplicate bodies are removed inside the fixture.
No product file changes. This native-fragment experiment is separate from baseline
counts and does not certify full install/lock/build, remaining affected suites,
production test-entry enforcement or real socket/header behavior. Refresh it
after any of its five input specifications, original baseline inputs, selected
tests or runner/config/fixture/vendor inputs change. The receipt has thirteen
steps and 197 explicit toolchain fingerprints, not full transitive attestation.

`review-http-boundary.mjs` also scans all protected text for the HTTP path and
four exported names, recording 1,278 occurrences in 214 files. Its exact extra
SchoolCalc matcher and network-guide edits bring the proposal to 87 changes.
Eighteen observations use extracted original pure helpers/predicate over two
protected School HTTP sources and projected import strings: the old matcher
rejects the new entry; the narrow replacement preserves ten forbidden and three
retained import forms. No original suite or app source is evaluated. The missing
devProxy guide link and stale mixed middleware recipe are baseline defects, not
permission to invent extra exports or moves. Computed/untracked references remain open.

`review-logging-boundary.mjs` specifies the three-body/four-entry logging surface,
32 exact import/reference edits and unused-barrel retirement; 91 tracked text
references have dispositions. Run it before the combined source-edit review.
`run-logging-identity.mjs` uses exact selected facade paths/bytes and export fragments
with unchanged runtime bodies in manually linked disposable native packages.
Twelve identity/timezone/reset/sampling/transport probes pass; a copied dispatcher
and leaked runtime test exports each produce the named expected failure, followed
by restoration. No prep loader, third-party runtime package, controller, real
transport or network is used. Refresh after the logging specification or fixture
changes. Test-only caller enforcement and full original-suite/install/build
parity remain pending; fixture observations are separate from baseline counts.

`browser` uses real components in jsdom, synthetic fetch/socket transport and
no-layout resource/scroll stubs. It does not prove CSS, real browser assets or
loaded-client recovery. The original six-case stored-shape suite is executed
unchanged through the dedicated Vitest config. `print-gateway` separately runs
the existing single temporary-image adapter assertion unchanged; only synthetic
bytes and a fake printer are used. Execution modes reject missing/skipped/extra
case populations.

`gratitude` also exercises actual Express/Node HTTP response serialization through
an in-memory duplex: HEAD body suppression and side effects, router OPTIONS,
current CORS preflight behavior, and unsupported method fallthrough. It never
opens a socket. This does not import or certify the controller's full middleware.

`registrations` adds 12 HTTP helper cases for omitted/supplied API keys, required
and placeholder proxy prefixes, Plex rewrite ordering, native agent JSON/SSE,
supplied concierge auth and wire format, and legacy admin behavior. It uses the
same memory-only wire driver, fake capabilities and existing OS-denied effects.
The same pack includes two `CASE-PROVIDER-*` cases for duplicate manifest indexing,
lazy construction, config precedence and repeated-load lifetime using original
loader classes with synthetic discovery/adapters. Additional pressure/profile/
relay/automotive/eink/hub/Piano reset/Fitness/calculator cases bring this pack to
78 actual cases. Six `CASE-UTILITY-*` cases characterize pure versus clocked time,
runtime ID contracts, canonical error identity, subclass/JSON/retry semantics and
vendor error translation. These are original-source cases, not new facade or
candidate proof. Ten additional `CASE-GR-HOMEBOT-*` cases characterize ordered
effects, early/save/downstream failures, locale/category/name defaults, lazy
container/callback input and real batch duplicate/partial-write behavior. Three
`CASE-HOUSEHOLD-PROJECTION-*` cases preserve divergent Homebot/Gratitude naming,
roster/null/config/timezone behavior. These thirteen cases use in-memory fake
dependencies only; the temporary locale formatter is restored in finally.
Six further `CASE-HOUSEHOLD-PROJECTION-*` cases test the non-equivalent general
directory, lazy field/error order, fixed Date/timezone behavior, one additional
synthetic profile disk/refresh fixture and in-memory HTTP bootstrap/users ordering.
The Date mock resets in finally; no real controller or profile is accessed.
Five `CASE-GR-FEED-*` cases preserve selected-only inspection,
legacy field types, read/name/error/timestamp order, synchronous scheduling and
inherited paging/read-state. Math.random and the ID clock are restored after each
bounded case; no provider, disk or controller is used for these Feed fixtures.
`CASE-GR-SNAPSHOT-FILES` protects malformed snapshot listing and
latest/substr lookup with one additional synthetic household; `CASE-GR-TEMP-CONTRACT`
protects original adapter/port identity, raw bytes/options/result and cleanup
around job-construction failure using a transport-free printer object.
Six `CASE-STORE-PROFILE-*` cases use three fresh synthetic
temporary YAML fixtures and failing synchronous stores to characterize Admin,
Fitness and Auth writers, cache identity and partial failure. They do not exercise
HTTP authorization, credentials against an account system or biometric devices.
Fitness uses fake biometric timers/bus and a bounded pure scan
policy. SchoolCalc uses synthetic credentials, operation spies and Buffer records;
it does not run a codec build, emulator, relay firmware or household controller.
Playback uses injected raw-HTTP responses; Piano reset uses fake fetch and a
bounded cancel timer. No appliance or Android process is run. The browser pack
now has 25 cases, including malformed/rejected household-consumer behavior and
Piano note/hysteresis/raw-send semantics with a fake
socket. Neither local send success nor HTTP success certifies hardware repair.
`review-api-closure.mjs` reconciles source assembly and middleware dispositions;
its inventory closure is not a whole-controller or provider-runtime proof.

`run-discovery.mjs` runs only reviewed files-only/dry-run paths under the same
OS restrictions. The backend script's current selection is the isolated tree;
backend Jest's current zero-file selection is recorded, not a successful suite.
`reconcile-runners.mjs` adds per-file static declaration/expansion gaps and source
command reconciliation. `review-registrations.mjs` adds separate catalog,
browser-route, API-binding, provider and lifecycle provenance without execution.
`review-storage-consumers.mjs` parses FileIO carriers and consumers with Babel
lexical binding analysis, classifies all 77 exports and inventories direct call
arguments plus indirect function references. Its scope probe and source counts
are not product assertions. It never imports FileIO or executes a consumer;
`PRE_TOOLCHAIN_ROOT` selects the inspected read-only parser installation.
`review-feed-boundary.mjs` similarly reads source and contracts, validates unique
edit anchors and parses proposed private-file snippets. It writes only the
`feed-boundary.json` planning artifact; it never writes those proposed product
files or executes their code. This is a boundary specification, not a rehearsal.

The new Node cases use `*.case.mjs`, deliberately avoiding existing default
Vitest/Jest/Playwright `*.test`/`*.spec` discovery. Explicit wrappers above own
their population. Do not rename them into default globs without runner ownership.
This folder is not automatically part of existing project gates. A future
integration must reconcile discovery, case counts and actual outcomes explicitly.
Missing candidate implementations and safety prerequisites are never skipped into
a passing result. See the linked plan in the execution packet under `docs/_wip/audits/`.
# Efficient continuation

Use the [application-module preparation skill](skills/application-module-preparation/SKILL.md)
to resume from existing evidence and runners. Begin with
`node tests/preimplementation/application-modules/tooling/preparation-status.mjs`;
append a PRE task ID for a focused report. The command is read-only and reports
historical audit status explicitly. It does not replace the accepted checklist
or repeat runtime verification.
