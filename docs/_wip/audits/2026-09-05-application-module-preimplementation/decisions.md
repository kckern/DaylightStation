# Findings and decisions

These are source-backed findings and proposed resolutions, not new exceptions to
the binding layer references. No existing code or authoritative reference was
changed. Roles below are accountable review responsibilities, not fictitious
human approvals.

## DEC-RESOURCE-SURFACES — assets have multiple consumers and delivery paths

Owner: rendering/build and affected product reviewers. The source resource review
records three bundled-font readers, four eager SVG glob registries and the backend
reader of School's frontend subject icons. Proposed shared font placement requires
the three exact conditional literal changes in `resource-review.json`, not just a
CanvasFactory import rewrite. Final public resource entry selection remains open.
Runtime font overrides and public URLs stay stable independently of package paths.

Root shell/service-worker cache policy must survive the later loaded-client drill.
Do not register the retired Feed worker or delete the separate old public HTML as
incidental cleanup. Pose import-binding and missing tracked manifest-icon findings
are baseline issues requiring their own reproduction/repair decisions, not hidden
asset substitutions or new failure exclusions.

## DEC-SATELLITE-WIRE — source ownership does not replace transport contracts

Owner: hardware/Piano/screen/identity and installed composition reviewers. Wire
reviews distinguish producer timestamps from receipt clocks, raw snake_case fields
from normalized application data, and bus delivery from firmware acknowledgement.
Pressure command validation and firmware range acceptance differ today; actual
adapter tests preserve that difference. Recorder MIDI transport is not the Android
Piano bridge. Keep independent deployment/operator paths stable until each target's
wire/build contract and authority are reviewed. All nineteen initial reviews are
now present, including a pure helper and an absent implementation, not nineteen
certified running services. Cross-root references include documentation,
operator producers and semantic twins, not only imports.

Preserve Portal volume handling of both down/up regardless of the panel flag,
and the differing optional profile fields/gallery semantics in host/Fitness/central
helpers, as characterized by six new cases. Consolidating them is behavior work,
not a harmless alias rewrite. The independent document watcher/HTTP exclusion
flags, batch-error HTTP success and lightly checked model response are likewise
baseline observations, not approved fixes. Payload acceptance is separate from
successful load; audio header receipt is not full format negotiation.

The newer relay/HTTP cases freeze more differences that must not disappear behind
a generic “ack” or API abstraction. OMR echoes precede asynchronous persistence,
including failed writes. Automotive normally saves/logs before ack, but an
existing-trip retry skips failed-summary repair, and its seq field does not order
the accumulated samples. Neither mechanism proves a two-store transaction.
E-ink config is plain-text key/value data with telemetry effects; its action GET
mutates state and its PNG response intentionally bypasses conditional freshness.
IR/RF success reports local transmission, not target-device state. These are
source/test findings, not authorization to repair behavior or relocate satellites.

Playback Hub's numeric result counts do not identify which requested device
succeeded: the central adapter expands any positive applied count to every
target, independently of `ok`. Keep that baseline visible, not “corrected” during
packaging. Adapter 409 support is not evidence the current Python endpoint emits
409. A controller timeout does not undo appliance work already started.

Piano bridge uses a different note/control dialect from the recorder. Its
browser's successful raw-MIDI send is not a physical acknowledgement, and repair
requires literal `fixed:true`, not merely HTTP success. Its unauthenticated shell
route table is not Portal's token-protected shell. Shell-api/native engine identity
and separately dexed payload classes are real package boundaries to preserve.
The normal Gradle bake task writes under app source assets, so it cannot be used
as a supposedly read-only preparation check. Seven new selected cases document
these consumer behaviors; Android/Python/shell execution remains unproved.

## DEC-FITNESS-WIRE-LIFETIME — transport and identity flow are not one service

Owner: Fitness/identity integration reviewer. The source review and four new cases
separate sensor data, management request/result correlation and passive scan
enrichment. Current gateway correlation uses request ID without checking the
pending operation kind or sender, drops unlock refusal reasons, and retains no
unsubscribe/dispose API. Simulation mode also has different guards for requests
and continuous scanning. Template deletion remains outside those guards.

Next action: inventory exact callers/lifetimes and reproduce affected failure
paths with synthetic data before selecting public exports. Broader daemon/template/
driver safety and authorization checks remain missing evidence, not successful
tests. Changing correlation, coercion, simulation, path validation or cancellation
is a separately specified behavior repair; do not introduce it under file moves.
Affected gate: PRE-2.3/3/5 and any future Fitness/identity shared extraction.

## DEC-SCHOOLCALC-RELEASE-INTEGRITY — current release needs its own proof

Owner: School calculator/build reviewer. The canonical Adaptive Study transfer
list differs from retained catalog/profile installers. Its SCSA commit path also
differs from the SCM1 path modeled by the JS staged-sync reference. A passing old
reference or the presence of all program files cannot certify the current release.

Normal relay artifact GET hashes downloaded bytes. Inline adaptive artifact
handling and the inspected adaptive assembly commit do not perform that same
digest comparison; shape/envelope/length checks must not be described as equivalent.
The relay's final success likewise means awaiting calculator commit, not proven
queue deletion or durable commit. Controller sync stages have individual effects,
not whole-session rollback; the new fake-backed orchestration cases preserve this.

Next action: specify exact adaptive malformed-digest/interruption/ack/retry cases
and a disposable current-release build that cannot write source/generated or read
private content/ROM. Keep full device/agenda/ledger authorization separate from
the new ingress middleware test. Any discovered integrity repair requires an exact
behavior-change card and approval; it is not implemented here. Affected gate:
PRE-2.3/5/7 and future School/satellite relocation/build certification.

## DEC-STORAGE-AUTHORITY — preserve paths independently of source ownership

Owner: Gratitude/Admin/platform reviewers. The source-backed
`storage-authorities.json` and five actual Admin/disk cases establish that Admin
uses literal household paths, may create a preferred `.yml` beside `.yaml`, and
does not refresh ConfigService's cache. Atomic text replacement also follows its
staging file's mode rather than copying the old mode. These differ from
DataService/config-resolver behavior and must not be silently unified by a new
shared facade. Boot legacy-app lookup and registry-only reload also differ.

Source relocation leaves persistent names and public editor document IDs stable.
Any household-aware editing, automatic reload, extension consolidation, stronger
durability/locking or permission preservation is separately scoped behavior work.
No generic FileIO API should become an application-layer dependency (D5/D10).
Broader FileIO callers remain unapproved until their exact consumer contracts are
mapped; a green first-move disk pack does not approve moving all storage helpers.

## DEC-REGISTRATION-IDENTITY — discovery and shared registries preserve behavior

Owner: integration/composition reviewers. The current backend manifest registry
has two different `media/files` declarations. Its last-write policy makes the
selected adapter depend on enumeration order. Before a future changeset moves
adapter roots or changes discovery, determine the effective baseline binding and
specify its preservation or a separately approved correction. Do not invent a
winner. This is conditional on touching that mechanism, not an unrelated reason
to block a Gratitude-only move.

Fitness registers 24 widgets into the default screen registry, with 14 legacy
lookup aliases; its 14 metadata exports are not backend provider declarations.
Keep Fitness ownership independent from registry implementation ownership.
Singleton identity and import-time installation are current contracts; replacing
them with explicit installed composition needs its own acceptance tests. See
`provider-lifecycle-review.json` for source/consumer links and the separate
Surround registry instance.

Original loader tests confirm repeated household loading constructs replacement
instances without disposing old ones. Original HTTP helper tests confirm the
legacy direct admin binding returns 503 with its current argument mismatch.
Neither lifecycle cleanup nor admin repair is authorized incidental cleanup.

## DEC-FOUNDATION-CLOSURE — exact shared prerequisites are not yet approved

Owner: architecture reviewer. `gratitudeApi.mjs` has a static import of
`createGratitudeServices` from the global bootstrap but does not call it. That
one import expands its resolved source closure to 886 files. Omitting that edge
in a *proposed* graph reduces the closure to 28. This is not an existing safe
public entry: removing/extracting it requires a later protected-file change.
The kiosk's closure is 16 files; the settings editor's is 20.

`owner-boundaries.json` lists the candidate foundation and every incoming source
import. Do not move the whole platform or global bootstrap merely to package
Gratitude. Resolve granular time/ID/error/HTTP/renderer helpers, browser
logging/API/WebSocket context, and Admin form/unsaved context exports first.
The Admin product may publish form components without becoming platform core.
Existing broad utility barrels and their cycle need an exact import/extraction
decision; a folder move must not broaden API/application permissions.

Resolution plan: preserve `config.gratitudeServices` as the module's injected
input, remove only the unused bootstrap import, and place the actual factory in
a Gratitude-owned composition facet that accepts the already-composed
`userDataService` and logger. `app.mjs` remains the only installed caller until
the candidate composition graph proves otherwise. The factory must not import
`app.mjs`, create a controller, or use a global singleton as a substitute for
the injection.

Acceptance evidence: a static no-unused-binding check for `gratitudeApi.mjs`;
before/candidate/restored closure counts (886→28 only when that one edge is
removed); original Gratitude router/service cases; and a candidate composition
test showing the factory receives the supplied data service/logger identity.
Rollback restores the one source import/factory location and original import
graph only; it never copies or rewrites household data. This remains an
implementation card prerequisite, not authorization to edit protected sources.

## DEC-POLICY-RANKS — existing reference/checker conflicts remain blocking

Owner: architecture maintainer. D1–D10 remain final. The domain guideline's short
rank table and DDD reference's extended table disagree; `books` has no assigned
scanner rank. Current equal-rank acceptance is not authority to override
lower-ranked-only cross-context prose. System bootstrap examples, old aliases,
object-style ports and deferred-domain-port examples also lag explicit rulings.
Future corrections must name the ruling and exact examples/checker cases.
Do not assign every reusable owner rank 1 or weaken D10.

Resolution evidence required before an affected move is approved:

1. One authoritative rank table assigns every current domain context used by a
   proposed move, including `books`, or marks it intentionally unranked and
   therefore fail-closed for cross-context imports.
2. The layer checker and its focused fixtures agree on lower-ranked imports,
   same-rank cross-context imports, permitted declarative contracts, and the
   D1/D2/D3/D5/D7/D10 prohibitions. A passing unknown rank is a red control,
   not a waiver.
3. The reference documents identify superseded examples rather than silently
   retaining contradictory prose. Each exception names a bounded consumer and
   expiry/review owner; no owner metadata may self-authorize it.
4. A before/candidate/restored disposable check proves that the new rule neither
   accepts an explicitly prohibited edge nor changes the recorded Gratitude
   closure solely through rank fallback.

Rollback restores the prior checker/reference pair and leaves source/package
layout untouched; it never converts an unresolved rank into an implementation
exception. Until then, `IMP-BASE.02` and all moves depending on rank resolution
remain blocked.

The first enforced hierarchy report identifies three existing same-rank imports:
`piano → school` in `gameBudget.mjs`, and two `trigger → barcode` imports in
`BarcodeResolver.mjs`. They are remediation prerequisites, not exemptions:
move their coordination into an application workflow or replace each consumed
value with a separately reviewed declarative `shared/contracts` export. Do not
move executable timing or barcode resolution behavior into a contract merely to
clear the audit.

## DEC-CONTRACT-SYMBOL-SPLIT — household configuration is data, not a helper API

Owner: architecture and system-config reviewers. `HOUSEHOLD_APP_CONFIGS` is a
universal declarative contract: its immutable app-name-to-household-relative-path
mapping is consumed by browser, application, adapter and system code without
granting either cross-layer behavior access. Its current co-located exports
`appConfigRelPath()` and `allAppNames()` are executable lookup/enumeration
helpers, so they are **not** proposed exports of
`@daylight/contracts/household-config`.

The future implementation card must preserve the registry's one frozen object,
all keys, values and enumeration order. It must extract those two functions to
a private system-config module, redirect only their actual consumers, and keep
the contract entry limited to `HOUSEHOLD_APP_CONFIGS`. At review time the only
production function consumer found is `ConfigService`; `allAppNames` is covered
by the current contract test. The loader, Admin YAML adapter, browser Admin
utility and migration script consume the data map directly and remain data-only
consumers. This is a planned symbol split, not authorization to change the
current mixed source file.

Required proof before implementation: baseline/candidate/restored tests for
known and unknown app lookup, fresh key enumeration, frozen-map identity, every
current direct-map consumer, and an import scan proving no executable helper is
published by the contract entry. Do not duplicate the registry, replace it with
a convention-derived path, or promote a serializer/port/adapter under this
exception. Rollback restores the original three-export source and imports as a
single isolated changeset.

## DEC-PRINT-EXPORT — reuse an application-owned adapter without promotion

Owner: Gratitude and Fitness composition reviewers. Selected design: retain
`TemporaryImagePrintGateway` beside its Gratitude application port and publish
only `@daylight/gratitude/server/adapters/image-print-gateway`, default plus named
class. The exact facade/private-facet exports and five source-edge substitutions
are recorded in `owner-boundaries.json` and `import-replacements.json`.

Fitness composition and the retained original adapter test consume the public
entry; Gratitude composition and the implementation-to-port edge remain local.
D1/D3/D7 continue to apply: applications do not construct concrete adapters and
the adapter really extends its existing application port. This is not permission
to let another adapter import a peer, move the port to domain, or have generic
printing depend on a private Gratitude implementation.

The original class passes bytes/options/job/result/error/cleanup checks in
`CASE-GR-TEMP-CONTRACT`, the prior two cleanup cases and the unchanged original
Vitest assertion (`CASE-EXISTING-GR-PRINT-01`). The package and relocated
consumer are not yet tested. Preserve the original class/export identity and
FileIO dependency scope. The adapter guidance explicitly prohibits raw `path`;
that existing import and OS-temp capability ownership require an explicit
IMP-BASE.02 disposition. Do not infer that the reference explicitly bans `os`;
source compatibility does not waive that policy issue. No code change or new
cross-layer exemption is approved by this selection.

## DEC-SNAPSHOT-FALLBACK — preserve actual file selection and malformed listing

Owner: Gratitude reviewer. `CASE-GR-SNAPSHOT-FILES` confirms that a malformed YAML
file remains in the snapshot list with filename-derived ID and null createdAt.
An explicit lookup matches a filename substring, not the stored payload ID.
Unknown/omitted IDs select the newest filename, even when its data is malformed;
loading then returns null without searching older valid records. The added
`file` field on a successful load is not written back. Corrected the earlier
storage-authority assertion that malformed files were skipped. This is a
documentation correction and new baseline evidence, not a product fix.

## DEC-FEED-QUERY — preserve actual legacy shape tolerance

Owner: Gratitude and Feed reviewers. Feed reads
`gratitude/selections.gratitude.yml` directly and accepts nested `item.text`,
string `item`, or top-level `text`. The normal Gratitude datastore hydrates a
stricter entity. Replacing Feed's read with `getSelections()` without a compatible
projection would change behavior. The proposed narrow selection-text query must
preserve those shapes, empty/error results, user display mapping, sampling cap,
ordering inputs and timestamp selection. Feed keeps bundle policy; composition
binds a public Gratitude operation into a Feed-owned abstraction. No private
peer datastore/workflow imports.

Selected specification: [Feed boundary](feed-boundary.md), with exact source and
edits in `feed-boundary.json`. The existing public composition factory returns
`gratitudeQueries.readSelectionQuotes`; installed composition supplies that
synchronous function as Feed's `readGratitudeQuotes`. Retire the unused
`server/queries` module-export placeholder. Three private Gratitude files define
the application port, its really extending read adapter and query. The existing
factory is expanded once, retaining its original store/service identities.

The result is null or a request-local iterable with lazy text/userId/datetime
properties, not eagerly normalized DTOs. It keeps one read before query access,
iteration at the existing spread, selected text/user/display access before
timestamp reduction, and the original error message/timing. No await, eager
field validation, new cache or additional read is permitted. Five new actual
Feed cases establish these ordering constraints, bringing the linked baseline
population to twelve. The interface source is syntax-checked only; native
candidate parity and the newly specified negative controls remain unexecuted.

Additional real-adapter cases distinguish absent/null/non-array input (no bundle)
from an empty array (one empty bundle). A selected null row aborts the batch with
one warning and an empty result; validating every row eagerly could change when
that failure occurs. `limit: 0` and `priority: 0` currently trigger truthiness
defaults, and a negative limit retains JavaScript slice semantics. These quirks
must be captured by the narrow query design, not erased by normalization.

## DEC-HOMEBOT-COMMAND — one batch operation through a consumer-owned port

Owner: Homebot/Gratitude integration reviewers. The exact selected boundary and
eleven baseline command/batch cases are in [Homebot boundary](homebot-boundary.md)
and `homebot-boundary.json`. Public composition returns
`gratitudeCommands.addSelections` bound to the existing Gratitude service.
Installed composition passes that function to the Homebot factory, which
constructs a Homebot-owned adapter extending its own application port. Homebot
receives `gratitudeSelectionGateway`, never a peer private workflow or broad
service. No unused `server/commands` module entry remains.

Keep batch semantics, not repeated `addSelection`: duplicates are accepted,
options are not transferred, writes are sequential and may partially persist.
Homebot awaits save/name/message/delete but not the broadcast; downstream errors
do not compensate writes. Internal dependency keys/validation changes are listed
explicitly. The single canonical planned Gratitude factory source includes both
Feed and Homebot returned operations. Four additional negative controls are
specified, not run; native candidate/factory/layer/identity evidence remains open.

The Gratitude rehearsal retains Homebot in its current owner tree. Its new port
and bridge have exact rehearsal and final module paths, and move once with
Homebot before final cutover. This staging does not authorize a permanent old
tree, a compatibility copy or a second partially adopted Homebot package.

## DEC-IDENTITY — reusable projection versus Gratitude policy

Owner: identity and Gratitude reviewers. `getHouseholdUsers` prefers display/name
and exposes group_label separately; `resolveDisplayName` prefers group_label.
Category validation remains Gratitude. Existing FamilySelector and app resolver
bootstrap URLs stay operational; no mandatory new identity endpoint is proposed.
Three original-source contrast cases now cover roster/confirmation naming,
ordered duplicate members, cache observation, object/falsy ID differences and
optional-versus-required/timezone fallbacks. Homebot supports object roster
entries that Gratitude's string fallback can reject, and performs profile lookup
for null users that Gratitude short-circuits. Gratitude adds a truthy UTC fallback
where Homebot returns the config accessor's value, including empty string.
The selected design is now in [Household boundary](household-boundary.md) and
`household-boundary.json`: shared application source port, extending config
adapter, presentation query, bound public composition, direct-return browser
roster client and two facades. Seven source files, three manifest proposals and
eighteen edit groups are specified. Nine server and five browser-consumer cases
now cover general-directory differences, short-circuit field order, default/UTC
timestamp quirks, explicit profile reload and HTTP/consumer failures.

The generic query returns raw configured timezone; Gratitude keeps its truthy
UTC fallback and timestamp generation. Even that UTC fallback currently formats
through the household-default clock, not UTC. Preserve it rather than slipping
in a timezone repair. The browser client returns the original request promise
and old bootstrap envelope; clients consume users only. No new endpoint or
broader identity DTO is introduced. Full owner metadata/targets, package/lock/
build adoption, six new negative controls and native candidate proof remain open
IMP-SHARED.03.2 dependencies, not gaps in the selected core source interface.

## DEC-SNAPSHOT-COMPAT — preserve surprising existing fallback

Owner: Gratitude reviewer. An unknown snapshot ID falls back to the latest file
when snapshots exist; an empty snapshot directory returns 404 through the actual
error middleware. The router's special exact-message branch does not match the
entity error's suffixed message. Characterize the actual default error object,
not just that dead special branch. No behavioral repair is folded into moves.

## DEC-PACKAGE-REAL-GRAPH — feasibility is still not adoption evidence

Owner: build/runtime reviewer. Prior synthetic sibling-package results remain
historical evidence. The new Node tests intentionally use a read-only bridge to
the original checkout's installed root/backend/frontend scopes, not a new
workspace install. They cannot certify migrated package exports, Node ESM
conditions, React/context identity, timezone instance isolation or Linux canvas.
No new node_modules symlink/install, package or alias was added to production.

Update: a fresh disposable offline workspace now proves nested install and clean
reinstall with identical lock hash, native forwarding/type/import maps, private
subpath rejection, real timezone runtime separation in both import orders, and
collapsed-instance/missing-export red-restored controls. Vendor dependency metadata
is pinned to local sources; this is still not the complete original lock/range/
peer/React/Linux graph. See the current `package-install` evidence entry.

Actual installed probes identify root/backend/frontend timezone versions
0.5.46/0.6.0/0.5.47 as three distinct instances. Frontend React and ReactDOM are
18.3.1; a copied second React instance fails hook rendering, while a second
context object with the same React silently yields its default. Root/backend
canvas 3.2.1/3.1.0 are distinct native modules and both render synthetic PNGs on
this macOS host. These are actual dependency observations, not proof that a
prospective workspace install preserves the real product providers or Linux ABI.

## DEC-CYCLES — real graph relationships before relocation

Owner: architecture reviewer. Six source SCCs were found, including system error
barrels, School document helpers, two chess CLI entries, browser logging/socket
machinery, Player/AppContainer/School and a larger Fitness UI/context component.
Concrete files and edges are in `dependency-ledger.json`. Source SCCs are not
automatically owner cycles; classify each edge and distinguish actual imports
from intended injection. The Player/School cycle must not become generic Player
depending on installed products after source reorganization.

## DEC-TEST-SAFETY — verified effect isolation, limited scope

Owner: test owner. The OS sandbox denies networking, child processes and writes
outside a canonical task temporary root, and denies private user/mount reads
except explicitly allowed source/dependency roots. Seven positive/negative
probes passed. Two initial sandbox attempts failed (startup read policy, then
uncanonicalized temporary path); their reports remain as failed evidence.
No household controller was started. Native rendering uses one backend canvas
installation and the bundled font; this is macOS evidence, not image parity.

## DEC-CENSUS-TOOL-REPAIR — invalid initial generated output removed

Owner: investigation lead. The first new census tool calculated one directory
too high. It wrote two generated JSON reports outside its intended packet and
failed before completing. Both invalid tool-owned reports were removed, the
root calculation was corrected, and worktree-root/baseline-overwrite guards
were added. No existing application files were changed. The valid initial
capture contains 13,084 artifacts and 13,083 protected fingerprints.

## DEC-RUNNER-GAPS — declared tests are not discovered/executed tests

Owner: test owner. The static census found 3,826 test-named files. Import-based
runner ownership and static declarations are available, but actual full runner
discovery/parameter expansion is not complete. The testing primer still names a
missing `scripts/test-backend.mjs`; current `test:backend` delegates to the
isolated harness. `smoke:yaml` names a missing script. Existing Vitest roots and
output paths must be addressed in a separate integration task, not changed here.

Update: dedicated Vitest files-only discovery found all 3,826 inventoried test
files, without loading test bodies/default setup. The unchanged six stored-shape
characterization cases pass in the dedicated isolated Vitest configuration.
This does not certify default-runner discovery or all parameter expansions.

Later source-reviewed files-only execution of the actual root Vitest inclusion/
exclusion policy found 3,886 paths: 65 additional shared-code symlink paths and
five omissions versus the canonical tracked list (three explicit Node exclusions,
two tracked old-worktree tests). Canonicalization yields 3,821. New preparation
cases now use `.case.mjs`; default Vitest collects none of them. Other runners'
actual safe discovery has since been reconciled in `runner-review.json`: root
Jest 1,521 files (including wrong-runner imports), backend Jest zero, the isolated
harness 2,182 and the current test:backend selection 850. Parameterized execution
and correction of runnable ownership remain open; unsafe discovery is explicitly
refused and source-attributed rather than executed.

## DEC-BROWSER-EVENT-MISMATCH — characterize, do not fix during relocation

Owner: Gratitude reviewer. The `/new` custom-item payload has `type: gratitude_item`
but no `action: item_added`; the actual kiosk ignores that raw payload. A pending
selection animation can also persist once after immediate unmount even though
both transport subscriptions have been removed. The real-component tests record
both behaviors. Altering them requires a separate functional decision and baseline
refresh, not an unannounced migration cleanup.

## DEC-PROFILE-AUTHORITY — shared record does not imply one consistency model

Owner: household-identity, Admin, Auth and Fitness reviewers. Source and six
selected case results are linked in `storage-authorities.json`; no existing
source changed. All three named central writers reach the shared user profile,
but use distinct write ordering, atomicity, cache refresh and error behavior.
Auth mixes cached profile enumeration with fresh login reads; Fitness refresh
does not rebuild the boot platform index. A returned Map is not a live cache view.

Disposition: preserve those contracts in the structural migration. Keep workflow
policy with its owner and storage mechanics in adapters, with D5/D10 unchanged.
Do not introduce an always-fresh User service or duplicate the profile file under
each module. Name each reader/writer explicitly in the foundation/identity
changeset and include `CASE-STORE-PROFILE-*` in affected-consumer verification.

Separate source findings: malformed Fitness profile reads can be overwritten;
Admin/Auth multi-record writes and device-then-profile enrollment are not one
transaction; missing optional enrollment writer can report success; reload with
no initial users map attempts a frozen-object assignment. These are recorded
without repair approval. Follow-up owner must specify any desired behavior
change and refresh its baseline separately before applying it.

Next action: adjudicate remaining generic-path FileIO/DataService consumers and
installed operator writer identity, then finalize public identity operations and
consumer imports. Affected gates: PRE-2.3.1, PRE-4 and IMP-SHARED.03/04. The
20-file named-profile reference census is not proof that arbitrary/private writers
do not exist, nor full authorization/concurrency certification.

## DEC-FILEIO-BINDINGS — primitive sharing preserves effects and indirection

Owner: platform/adapter and build reviewers. `storage-consumer-review.json`
records all 77 FileIO exports, 321 direct/carrier edges and 51 production non-call
references under 14 source-reviewed policies. No new product test result or
namespace approval is inferred from these counts.

Disposition: retain the original primitives' error suppression/propagation,
parent creation, file modes, atomic/exclusive/stream behavior and directory-cache
identity. Keep injected whole-object overrides distinct from per-method nullish
fallbacks. Retain the image download callback and its configured media-root and
public-URL chain; FileIO is not a uniform pure persistence library. Its new public
spelling, if approved, does not override D5/D10 or transfer domain policy to the
platform. Unused bindings are not cleanup authority.

Next action: use argument/binding source spans and reference-policy targets to
adjudicate generic caller namespaces and needed downstream invocation paths;
connect those dispositions to approved import replacements and affected-owner
tests. Affected gates: PRE-2.3.1, PRE-4, PRE-7 and IMP-SHARED.04. No source move,
dependency-version change, consistency repair or network download is authorized.

## DEC-RENDERING-FONTS — shared presentation, public source-asset authority

Owner: platform/rendering, affected-product, test and build reviewers. The exact
selected design is in `rendering-boundary.json`: three platform-owned rendering
bodies, eight existing drawing names, one system font-directory value, four
public facades, one new locator, nine bundled artifacts and one gated unused
aggregate retirement. Product renderers stay product-owned; D2 still requires
application presentation ports. Public visibility never changes a layer rank.

School and Fitness must use the public source-font entry, not relative paths
into platform's private server package. This supersedes the three conditional
resource-path proposals and includes two original test fixture roots. There are
41 exact edits and 123 classified literal references; no code/assets were moved.
Runtime override roots, default/null/empty differences, supplied notices and
native process-global registration semantics remain unchanged.

Dependency finding: backend installed canvas is 3.1.0, backend lockfile is 3.2.3,
root installed/locked is 3.2.1, and both manifest ranges are `^3.2.1`. Exact
manifest/lock/installed-manifest hashes support the finding. Do not silently
upgrade or switch scope to make a fixture green. Resolve original/candidate
package identity and native/font metrics before adoption. Actual best-effort
font registration conflicts with the generic existing rendering error guidance;
adjudicate that separately, not by changing behavior or weakening the guidance
during relocation. Missing bundled Roboto notice/provenance remains a distribution
gate. See IMP-SHARED.04.5 for exact acceptance, dependencies and rollback.

## DEC-IMAGE-INPUTS — immutable provenance remains unproved

Owner: build reviewer. Docker copies the present four source roots but not new
modules/capabilities/platform roots. Its node image, apk selection, yt-dlp Git
checkout and global supervisor are not all digest/version pinned. The current
native/font tests use macOS, not the future Linux image. IMP-PKG.03 defines the
immutable context and already-loaded-client requirements; no image was built or
deployed to hide these gaps.

## DEC-HTTP-MIDDLEWARE — preserve semantics and source-test permissions

Owner: platform/API, School/test and build reviewers. `http-boundary.json`
specifies four system implementation files, one four-name public entry and
87 exact consumer/reference edits. The 1,278-occurrence protected literal census
distinguishes paths from retained function names, source predicates and history.
No ownership label relaxes API/application/domain restrictions.

The SchoolCalc HTTP import predicate accepts only the old middleware spelling.
Eighteen extracted-helper/predicate observations show the correct public import
would fail, and that adding only this exact entry preserves ten forbidden and
three retained forms. Apply the recorded predicate span together with the
already planned utility-related spans in the same test; preserve the original
assertions, family/wire/construction restrictions and complete corpus population.
This is a proposed test-location repair, not a new layer exemption or proof that
the original whole suite passes. The original requestLogger mount predicates
retain their separate 191-artifact target-provider requirement.

Thirty-seven dedicated HTTP cases and four exact red/restored controls now
characterize async, tracing, logging and error behavior alongside ten original
HTTP cases. Real response/socket/controller and native candidate resolution
remain open; response doubles are not substitutes for those gates.

The separate native HTTP/utility/logging fragment now demonstrates that the
selected eleven-source/nine-facade graph preserves identity without a loader.
Seven pre-specified edits narrow the original 21-source closure. All 37 assertion
bodies pass with only import-section changes; twelve probes catch duplicated
functions, error class and dispatcher, plus a leaked default export. Duplicating
InfrastructureError demonstrably changes an opaque-renamed object's response
from 503 to 500: canonical class identity is a behavior contract, not cosmetic
package hygiene. A disconnected dispatcher loses both module-created HTTP
loggers and sampling continuity. Exact written hashes and source population
restore. Four original suites now pass all 64 original error/logging cases twice
after five exact planned import edits in temporary copies. Full named populations,
local bindings, preludes and helper/assertion bodies remain unchanged. This
confirms the logging runtime/testing split and the error-string suite's expanded
barrel loading; the other two leaf-import suites remain unrun. Full installed
package/lock/build and remaining affected-suite proof remain separate; do not
promote this selected fragment to rehearsal approval.

Two baseline documentation defects remain explicitly separate: network-exposure
references a missing `devProxy.mjs`, and AppContainer's implementation recipe
imports a nonexistent mixed middleware barrel with webhook exports absent from
the selected facade. The documentation reviewer must map those to actual code
before proposing repairs. Neither justifies fictional source moves or expanding
the platform public API. No existing application, test or guide file changed.
