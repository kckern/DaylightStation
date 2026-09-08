# Coverage, limitations and remaining preparation

Read `contracts.json` for current source/case/RUN links and `evidence-index.json`
for freshness. “Passed” below means the selected assertion actually ran against
baseline code. It does not certify a candidate or imply every edge case passed.

## Executed contract families

| Contract family | Current actual coverage | Still missing |
|---|---|---|
| CTR-GR-HTTP-01…18 | Every real route registration through the actual API mount; DTOs/status/errors, query household/default, selected validation, transfers/recycling, snapshots, custom publication, printing and representative permission gate; actual Node/Express wire HEAD/OPTIONS/unsupported method behavior and default-CORS projection | Exhaustive body/query/null/household matrix; full auth/device/token/body-parser middleware/start/stop assembly |
| CTR-GR-DATA-01/02/03 | Real service/datastore over synthetic DataService plus real ConfigService/DataService/disk-YAML cases; paths, plain stored shape, fresh reads, malformed/missing data and write failures; malformed snapshots remain listed, filename-substring/latest lookup returns null for a malformed selected file without older-valid fallback; original six stored-shape cases unchanged under Vitest | Concurrent/crash behavior and old-reader/new-writer candidate data; source shows synchronous non-atomic whole-file writes, not a transaction guarantee |
| CTR-GR-PRINT-01/02/03 | Real presentation/native renderer, bundled font, selected IDs, fixed-clock 180° pixel rotation; true/verified-only success; lookup ordering; temporary adapter/port identity, exact bytes/options/job/result, construction-failure cleanup and failure marking; original adapter Vitest assertion executed unchanged | Production Linux/native/font override identity; exhaustive selection/weight/wrap/content cases; failed write/cleanup, collision and delivery/recovery matrix; native candidate public entry |
| CTR-GR-UI-01/02 | Actual kiosk in jsdom; bootstrap/error/empty, focus, Enter/space/user/category, long press, orphan keyup, select/discard/undo/server ID and exit | Actual AppContainer wrapper launch, layout/CSS, repeat/blur/timer edge matrix and persisted browser state |
| CTR-GR-EVENT-01 | Actual context/kiosk against fake transport; Homebot vs external persistence, custom raw payload mismatch, repeated mount teardown | Current delayed selection persists after unmount; this is characterized, not corrected. Full app lifecycle still untested |
| CTR-GR-CONSUMER-01 | Five real FamilySelector/registry cases: wheel/fallback initials/exclusion minimum, option labels/order/duplicates/raw IDs, missing/malformed/rejected response and failed-load surface at unchanged bootstrap URL | Selected winner/keyboard lifecycle, direct new-client promise/throw identity and native candidate/bundle proof |
| CTR-GR-CONSUMER-02 | Twelve real Feed cases: legacy text shapes/types, capped bundle, missing/non-array versus empty, picked null/sparse errors, zero/negative defaults, selected-only interpretation, read/name/error/timestamp order, synchronous timing, independent ID clock and inherited paging/no-op state. Exact returned-operation/private-file/constructor plan in feed-boundary.json | Native injected query/factory/identity and full assembly/UI candidate proof; new eager-projection/async/read-duplication/legacy-removal negative controls specified but not executed |
| CTR-GR-CONSUMER-03 | Eleven real Homebot/batch cases: ordered awaited/unawaited effects, early/save/downstream errors, explicit timezone/category/name defaults, callback input, lazy cached usecase, real duplicate batch and partial-write/retry behavior. Exact returned operation/consumer port/bridge/edits in homebot-boundary.json | Native bridge/factory/service identity and full conversation/controller parity; four additional negative controls specified but not executed |
| CTR-GR-CONSUMER-04 | Real Admin editor/form/hook read-change-save; original Admin router/service/store with real synthetic disk verifies cache versus reload, literal household scope, yml/yaml precedence, raw/parsed/error behavior and atomic replacement modes | Full Admin controller/auth composition, remaining defaults/permissions, concurrency/symlink/Linux behavior and candidate binding |
| CTR-GR-COMPOSE-01 | Real API mount/permission gate and separately wired actual services | Existing composition import pulls in bootstrap; real product composition awaits protected import removal/extraction |
| CTR-GR-ARTIFACT-01 / RECOVERY-01 | Bundled font exists, native canvas works, browser asset paths exist in loader | Real bundling/lazy chunks, source shipping, immutable image and both loaded-client directions remain candidate-pending |
| CTR-ARCH-01/02 | Actual current layer checker old-path rejection and three observed misses; separate D10 gate current-path import forms and three new-root misses; 8 metadata prototype controls | Production relocation-aware resolver/metadata gate, full D1–D10 and subowner/port graph integration; unknown-rank ruling |
| CTR-TEST-01 | 3,826 dedicated files and 3,886 paths under actual root Vitest policy; aliases/omissions reconciled; actual Jest and safe harness selections, per-file static case/parameterization/skip gaps and unsafe discovery dispositions; expanded new Node results and original Vitest assertions | All remaining parameterized case execution and wrong-runner/missing-case real-gate mutation |
| CTR-PACKAGE-01 | Native sibling forwarding, private subpath rejection, facet type/local-import handling; all three installed timezone scopes, actual React/context identity and two canvas versions; offline nested npm install/reinstall with real vendored timezone bytes, both orders and collapsed-instance/missing-export red-restored pairs | Complete original dependency ranges/lock/peer graph and proposed-install product-provider/native identities; vendored metadata is explicitly locally pinned; current-install macOS probes are not Linux adoption proof |
| CTR-BUILD-01 | Source build-input hashes and exact Docker missing-new-root/floating-input findings | Actual immutable image/build-context/asset negative proofs |
| CTR-RESOURCE-01 | Four original static-resource/native-factory cases: generic versus typed avatar fallback, file probing and HTTP headers, raster resize fallback, optional font failure; source maps SVG globs/workers/font literals/public shell | Actual Sass/Vite/Docker context, native glyph/worker/model activation and emitted/loaded-client asset proof |
| CTR-SATELLITE-WIRE-01 | Two original pressure-mat adapter cases: field normalization, receipt clock/status, topic/config separation and command delivery semantics; all nineteen targets now have initial source-boundary reviews and cross-root reference/operator indexing | Complete per-target control/resource/consumer and encoder/audio/ack review, computed/external operator paths and exact build/deployed-identity dispositions |
| CTR-PROFILE-REPRESENTATION-01 | Three original host/Fitness/central helper cases: optional-field differences, duplicate gallery versus last-owner index, write/refresh order and false/throw outcomes with synthetic data | Actual biometric transport, disk/cache durability and deployed helper identity; central writers cross-linked under CTR-HOUSEHOLD-PROFILE-01 |
| CTR-HOUSEHOLD-PROFILE-01 | Six original Admin/Fitness/Auth storage cases: shared profile path, cached versus fresh reads, old Map/object/platform-index identity, retained profile on removal and partial-write failures; three named central writers and 20 named-profile reference files adjudicated | Generic-path and installed/private writer dataflow, full HTTP authorization, boot index collisions, missing-users reload error, concurrent writers, physical template/profile compensation and crash durability |
| CTR-HOUSEHOLD-PROJECTION-01 | Nine real cases: initial Gratitude/Homebot contrasts, non-equivalent general directory, short-circuit field/type/error order, fixed-clock UTC/default/locale behavior, explicit disk/profile refresh, real HTTP bootstrap/users order/error/spread precedence. Exact shared source/query/client/facade/manifests and edits in household-boundary.json | Direct new port/query/adapter/client and bound factory proof, six new negative controls, global metadata/target/lock/build/native candidate gates; not whole identity/auth or controller certification |
| CTR-UTILITY-01 | Six real cases preserve explicit-date/clock defaults and fallback differences, runtime ID format/vector, canonical constructors, error JSON/context/retry and vendor translation. Eleven public entries/thirty-one names preserve runtime and documented APIs. Selected 762-reference census and joint 1,076-edit source proof supplement the 551 utility source-edge dispositions | Two independently approved stale-test import repairs, global scanner gates, full manifests/lock/layer enforcement and candidate/affected-consumer coverage. FileIO fixture proof is separate from full consumer identity. Four edit-verifier controls are not behavioral negatives; new utility contract mutations remain pending |
| CTR-HTTP-MIDDLEWARE-01 | 47 direct HTTP cases pass: ten unchanged original string-error cases plus 37 dedicated cases (6 async, 4 tracing, 12 request logging, 15 error). Four exact source-memory mutations fail and restore. The four-file/one-entry specification has 87 edits and 1,278 literal-reference dispositions; eighteen extracted School predicate observations preserve the narrow API permission | Original listener-opening requestLogger/School suites and actual source-path assertions; native candidate and three tests' expanded loading closure; actual Express invalid-status/header/socket behavior, full controller middleware ordering, remaining candidate/identity/synchronous-throw/webhook negatives |
| CTR-SERVER-LOGGING-01 | 54 unchanged original cases pass: timestamp offsets/DST/runtime default (8), dispatcher/filter/transport/metrics/singleton behavior (26), logger/context/fallback/sampling/aggregation/windows/caps (20). Selected four-entry specification and separate five-step native fixture add twelve identity/timezone/reset/reinitialize/sampling/send/flush/priority probes plus duplicate/leak counterexamples | Actual production/test caller enforcement, original affected-suite split-import parity and full installation/build/controller/transport coverage. Native disposable manual links and fake sinks are not full package adoption; asynchronous send rejection and broader privacy/field/failure matrices remain open |
| CTR-FILEIO-CONSUMERS-01 | 36 unchanged original assertions in six inspected suites: real task-temporary Workout YAML/atomic-write spies, FreshVideo lock, Composer revision/conflict/sharing, Piano presets, media mtime/cache invalidation and actionable Strava jobs. Exact per-file populations and source hashes recorded | Remaining mock-site suites/consumer contracts, same original assertions against the selected 73-name package candidate, full path/namespace/lock/build identity and storage failure/concurrency/recovery matrix. Baseline runtime uses the prep scope loader; it is not native migrated resolution |
| CTR-PORTAL-INPUT-01 | Three original jsdom input cases: field validation, manual text/focus/activation and default prevention; volume both-action/panel-flag behavior, current handler and socket cleanup | Real Android HID/permissions/backlight, reconnect timing, WebView audio/layout and payload/control-plane installation |
| CTR-RELAY-DISPATCH-01 | Three original gateway/policy cases: shared kitchen source split, legacy acceptance/defaults/coercions; OMR age/count/NFC validation/veto and echo before failed persistence | BLE/serial/NFC encoders, offline queues, scale persistence matrix, School grading/manifest/replay, all diagnostic surfaces and hardware identity |
| CTR-AUTOMOTIVE-ACK-01 | Two original gateway/policy cases: arrival-order trip assembly, publication before writes, delayed ack, summary failure and existing-trip retry bypass | Physical buffered-file deletion, actual store durability, full clock/telemetry/sample-floor/recovery matrix and flashed identity |
| CTR-EINK-WIRE-01 | Two original HTTP router cases: exact plain-text snapshot, best-effort telemetry order/filtering, unconditional PNG response, GET action and absent telemetry | Valid PNG/render/dither/panel/RTC, full snapshot hash inputs, parser/firmware execution, trust/auth and fetched build identity |
| CTR-HUB-WIRE-01 | Four original adapter cases: slot/time identity, null/default/domain errors, queue/options, legacy counts versus modern results, 409 and transport/verification rules | Python/shell encoding and timeouts, full admin/control surface, validator parity, durable queue/cache, audible output and installed runtime identity |
| CTR-PIANO-BRIDGE-WIRE-01 | One original browser-hook case and two reset-client cases: note dialect, velocity/hysteresis, local-only send result, strict fixed flag and HTTP/parse/abort/network outcomes | Native MIDI/engine/assets, full control/heartbeat consumers, grace/reconnect, radio repair, permissions and APK/payload build/swap identity |
| CTR-FITNESS-SATELLITE-01 | Four original gateway/policy/decoder cases: request/UI identities, coercions/field drops/cross-kind correlation, timeout, scan versus fault/no-template events, backoff and ant-compatible BLE HR envelope | Full sender/auth/identity policy, actual templates and helper errors, ANT/rope/BT/serial devices, daemon controls/cleanup and deployed native image identity |
| CTR-SCHOOLCALC-INGRESS-SYNC-01 | Three original ingress/orchestration cases: exact Bearer/relay binding, immutable verified identity, ordered stages/current-batch strict acknowledgement and late failure without rollback | Full router/codec/device/agenda authorization, ledger/artifact/grading durability, adaptive digest/ack/cut semantics, C++/Z80/physical parity and current release build |
| CTR-TI86-TRANSFER-FILE-01 | One original Buffer wrapper case: exact signature/name/type/length/record/checksum and invalid name/type errors, without invented semantic validation | Encoded limit/CRC/semantic codec matrix, QR/packet/cable decoding, source-writing builder isolation and actual default release/ROM/toolchain identity |

The separate [FileIO package/mock experiments](fileio-mock-review.md) each add eight
subprocess observations, not another product contract family or additions to the
345 baseline count. Both the default 77-name and exact selected 73-name facade
fixtures preserve binding/cache identity and expose the public/private mock
distinction with exact failing/restored assertions; four helpers remain private
in selected mode. The
22-site static exposure review finds no private FileIO reader in the current
projected foundation, so the counterexample does not justify a universal mock
shim. Six original baseline suites now pass; remaining suite execution, complete
reference/storage review, installed package adoption and actual candidate parity
remain open.

The [FileIO reference census](fileio-reference-review.md) additionally records
778 matching tracked-text occurrences. An extracted exercise-library source
predicate accepts baseline but rejects the proposed FileIO import. Its exact
old-or-public replacement preserves both allowed names and all ten forbidden
tokens under 17 string-predicate observations. Those are not an original-suite
run, extra product cases or an additional product mutation pair. The seven additional
reference/guard edits compose with the full selected 1,076-edit plan.

## Case specification rules

The logging native fixture is indexed separately as `logging-identity`. Three
green executions each run the same twelve probes, with exact duplicate-dispatcher
and leaked-test-export failures between them. Do not count repeated executions
as distinct tests or add this mechanism evidence to the 345 baseline assertions
or product mutation pairs. Its source design, exact test entry and
remaining enforcement/consumer gates are in [logging-boundary.md](logging-boundary.md).

The [HTTP middleware specification](http-boundary.md) separately reproduces a
source-gate discovery gap in twelve extracted-predicate/population observations.
The original no-double-mount test scans 191 flat-folder `.mjs` artifacts; moving
Gratitude's router and card test leaves 189 in that folder. A duplicate mount
in the relocated router is missed by the old enumeration and detected by the
full mapped population. Missing/duplicate entries are rejected by the proposed
enumeration contract. These observations do not increase the 345 baseline count
or product mutation pairs; actual target-provider/test edits and suite
execution remain pending. The global-mount predicate itself survives retargeting.

The rendering/font source specification now supplies three shared implementations,
four facades, one system locator, nine canonical font/notice moves, 41 exact edits
and five existing root consumers. Its 123 literal references have dispositions;
the public font locator supersedes private cross-owner paths. These are inventory
and design results, **not new passing cases**. A separate fifteen-step native
experiment now passes the original ten primitive cases before/after/restored,
using only two planned test import changes; helper/assertion bodies and names
are unchanged. Ten probes in twelve fresh processes preserve selected metrics,
wrapping, pixels, PNG, seven font registrations, falsey/explicit overrides and
best-effort missing faces. Five bad graphs detect duplicate helper authority,
wrong font root, missing font/notice and root canvas resolution, then restore
all 43 fixture files and six links. The ten original cases and mechanism checks
are not added to the 345-case catalog or eleven product mutation pairs.
Affected-owner suites, PDF/Timelapse defaults/lifecycle, behavior-specific draw
mutations, complete native/locked graph and build/image evidence remain open.
Installed backend canvas 3.1.0,
backend locked 3.2.3 and root 3.2.1 are distinct authorities, not interchangeable
baseline/candidate results. See `rendering-boundary.md` and IMP-SHARED.04.5.

The separate `http-identity` experiment now loads the exact selected eleven-file
HTTP/utility/logging closure, nine facades and original backend UUID 11.1.0 bytes
through native Node package exports. The same 37 dedicated contract assertions
pass twice with only three import-section substitutions. Twelve native probes
pass; four controlled graphs fail exact sets for duplicated middleware, error
class, dispatcher and leaked default export. The duplicate class changes the
object response for an opaque-renamed instance from 503 to 500. All restoration
hashes and the eleven-file private population match. Four original suites also
pass their same 64 named cases twice after only five exact planned import edits
in temporary copies. Original preludes/helpers/assertions/local bindings and
combined proposed hashes are verified; no aliases, scope loader or root setup.
This covers the error-string suite's leaf-to-barrel expansion and all 54 original
logging cases, not the other two leaf suites or all affected consumers.
These are repeated cases
and mechanism probes, not additions to 345 baseline cases or eleven product
pairs. Full installed candidate, remaining affected protected suites, actual
caller/LoA enforcement and real socket/controller checks remain unproved.

The same HTTP specification records 1,278 protected literal references and the
exact SchoolCalc old-or-public permission repair. Eighteen observations apply
the extracted original scanner/path helpers and predicate to two protected
sources, projected import strings and forbidden/retained forms. They do not
count as original-suite passes or product pairs; full source-root/LoA/candidate
enforcement remains separate.

The separate `CASE-REG-*` pack now adds 12 real HTTP registration-helper cases:
omitted/supplied map keys; required/optional proxy prefixes and rewrite ordering;
native agent sync/background/SSE; supplied concierge auth and wire format; legacy
admin argument mismatch and method effects. It supports PRE-2.2.1 accounting but
does not claim full controller startup, production auth or proxy-upstream coverage.

`CASE-PROVIDER-DUPLICATE` and `CASE-PROVIDER-LOAD` exercise original registry/loader
classes with injected synthetic discovery and adapters. They prove last-write
collision behavior, lazy construction, config precedence and repeat-load instance
replacement without disposal. They do not import real providers or establish the
winning manifest in deployed filesystem enumeration order. This is the separate
`CTR-INTEGRATION-REGISTRATION-01` family, not HTTP helper coverage.

The named current test body is its executable input/oracle specification. Do not
infer complete contract coverage merely because a route has one matching case.
IDs and timestamps are checked by shape and relationships, not erased. The
renderer orientation comparison freezes the clock and compares every pixel;
that test does not establish a cross-platform visual golden. Browser tests use
real components and data behavior but substitute CSS/SVG URLs and scrolling;
they cannot assert layout. Full contract records for every Appendix B row and
every missing edge case remain PRE-5 work; the coverage table is not a replacement
for those records.

Resource inventory also identifies the current PoseDetectorService import binding
mismatch and missing tracked PNG manifest icons; neither has been repaired or
counted as passing runtime/model/build behavior. Generic versus typed avatar
fallback and adapter versus firmware threshold ranges are observed differences,
not assumptions to unify in a migration facade.

The candidate interface must make its target observable and refuse baseline
fallback. A test that passes twice against baseline validates a harness only.
Mutation children deliberately exit nonzero; the parent reports whether the
expected *named* failure occurred. Unrelated syntax/import/setup failures are
not red proofs. Every mutation has an independent fresh synthetic root.

## Negative evidence observed

Seven contract mutations: missing API mount; changed mark-response count; renamed
stored printed history; marking failed prints; double publication; omitted
temporary-file deletion; missing font reference. All now fail a specific named
case, and the relevant untouched packs pass again. The first storage mutation
did not fail the initially selected mark assertion: later printing recreated the
field. A new before-first-print persistence assertion now detects the lost field
directly. Its earlier failed sensitivity attempt remains in history.

Four additional HTTP mutations bring the product total to **eleven pairs**:
removed async rejection chaining, removed finish/close duplicate guard, replaced
incoming trace ID and private body/query reads. The first has three exact failing
cases; each other mutation has one. All execute the full 37-case population;
the untouched pack subsequently passes all 37. These are original-code mutations
in loader memory, not migrated candidate or socket tests.

The architecture pack's green results include **observations of bad current
enforcement**: new owner paths escape old path applicability, a public facade
hides API→application import semantics, and unknown `books` rank is ignored.
Those requirements remain failed in current gates. The in-memory metadata
prototype detects representative violations but is not installed enforcement.

## Failure triage

The default Vitest path population is not the canonical file population:
`backend/shared` and `backend/shared-contracts` add 65 paths through symlinks;
three explicitly excluded Rubik's Cube Node tests and two tracked files under
old `.claire/worktrees` account for five omissions. Canonicalized default discovery
has 3,821 files. Nothing was deleted or excluded by this preparation. New Node
cases were renamed to `.case.mjs` so the broad default Vitest glob does not run
them with the wrong runner; existing configs and tests remain unchanged.

| Evidence class | Cause / disposition | Owner / next gate |
|---|---|---|
| Early isolation startup failures | New sandbox profile denied needed startup reads; later temporary path used noncanonical `/var` spelling. New harness repaired; negative probes now pass | Test owner; preserve evidence, never widen household access |
| Early FamilySelector assertions | New test expected a wheel with one eligible user, then expected a visible full name where the wheel shows avatars/initials. Corrected to actual minimum and image-error initials behavior | Test owner; baseline UI source unchanged |
| First undo test setup | jsdom lacks `scrollIntoView`; dedicated no-layout stub added. Do not claim scroll/layout proof | Test owner; real-browser layout still pending |
| First HEAD publication fixture | New wire test omitted the required text query, correctly received 400; fixture corrected to supply synthetic text, then HEAD published once with an empty body | Test owner; original route and requirements unchanged |
| First registration HTTP fixture | New harness omitted IncomingMessage.complete at body EOF; Node aborted the synthetic stream and cancelled later cases. Corrected only the new harness to model parser completion; all 12 cases now pass, original failure retained | Test owner; not a product regression or controlled red proof |
| First backend discovery guard | New allowlist omitted digits and rejected the existing e2e target before execution; guard corrected and exact manifest command re-reviewed | Test owner; no existing command or runtime source altered |
| First changed-storage sensitivity | Wrong expected assertion, as above; strengthened newly added test, did not change stored shape | Test owner; mutation must fail direct storage assertion |
| Custom item vs UI action mismatch | Actual existing payload/consumer behavior; preserve for relocation | Gratitude reviewer; separate optional functional approval |
| In-flight selection after unmount | Actual existing delayed action still writes once; subscriptions are removed. Do not equate transport cleanup with cancellation of all queued work | Gratitude reviewer; separate optional functional approval |
| Historical Piano suite failures | Not rerun in this packet; no current pass or exact failure count asserted | Test/Piano reviewer; safe reproduction and separate repair card |
| Candidate/image/loaded-client gaps | Implementation/artifacts do not exist; not executable parity claims | Build/test reviewer; future approved changesets |

## Open work is not all an authority blocker

The following can and should continue within preparation: broader shared-caller
storage/resource/protocol review (API/browser/provider/lifecycle source registration
accounting is complete, and 12 first-move storage authorities are reviewed); complete
foundation symbol classification and public-import replacement; runner/case gap
expansion; actual disposable npm installation/identity experiments; finalized
Appendix C cards and artifact audit. They remain in progress or not yet complete,
not “blocked by user” merely because they take further work.

The actual protected import/factory changes, production package adoption and
Gratitude move need new implementation authorization. No checked PRE item
supplies that authority. A handoff before the remaining preparation is finished
must be labeled partial.
