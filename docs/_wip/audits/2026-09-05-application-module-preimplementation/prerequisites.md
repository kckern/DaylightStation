# Prerequisites and approval boundaries

Status: investigated, not authorized or implemented. Source identity is in
`baseline.json`. These findings do not amend the binding layers-of-abstraction
references or the accepted architecture. The five prior adversarial rounds
reviewed that architecture, not this execution packet.

## Decisions that constrain the first rehearsal

| ID | Finding and proposed disposition | Accountable role / blocked gate |
|---|---|---|
| DEC-FOUNDATION-CLOSURE | Remove the unused global-bootstrap import from `backend/src/5_composition/modules/gratitudeApi.mjs`; extract the real service factory with explicit `dataService` injection. Do not import the controller to characterize it. The 50-file foundation in `owner-boundaries.json` is a candidate closure, not an approved platform move list. | Architecture reviewer; IMP-BASE.01, IMP-SHARED.01/04 |
| DEC-LOGGING-BOUNDARY | Three unchanged system bodies, three runtime entries/five names and one test-only entry/three names; 37 incoming edges, 91 text references, 32 edits across 27 files. Retire only the zero-caller broad logging aggregate after reference gates; keep config/transports in place. Five native fixture steps preserve twelve identity/state contracts and detect duplicate dispatcher/leaked test exports. Real test-only caller enforcement, complete package adoption and original affected-consumer parity remain open. | Platform/logging/API/test/build reviewers; logging-boundary.json/md, IMP-SHARED.04.4 |
| DEC-UTILITY-EXPORTS | `utility-boundary.json` refines 17 candidate files into fourteen moves, two gated barrel retirements and one untouched leaf; eleven public entries publish thirty runtime/test-consumed names plus the documented pure `parseToDate` helper. It specifies 551 source-edge dispositions and 541 edit groups in 473 files. Preserve pure-time versus clock identity and distinct error families; full package/candidate identity gates remain open. | Platform/architecture/build reviewers; IMP-SHARED.04.1 |
| DEC-UTILITY-REFERENCES | 762 selected references are classified; 26 exact additional edits preserve mock targets, source/guide references and narrowly admit the pure core-error entry in three SchoolCalc predicates. D4 and old-path fixtures remain unchanged. Twenty-two FileIO mocks, 23 existing dynamic import edges and global scanner/native-identity follow-ups stay explicit. | Platform test/build/architecture reviewers; IMP-BASE.02, IMP-SHARED.04.1 |
| DEC-FILEIO-MOCK-SCOPE | Actual FileIO bytes preserve 77 function bindings and one directory cache through a facade, but a public mock misses a synthetic private reader; canonical partial mocking restores it. All 22 existing sites are traced: nine retained adapter readers after utility projection, zero remaining foundation-private IO reader imports, and three test-local injected fixtures. Do not infer a current first-move failure, delete those fixtures, widen factories or adopt universal private mocking. Exact candidate import/runner/suite proof remains open. | Platform/test/build reviewers; IMP-SHARED.04.2; fileio-mock-review.md/json |
| DEC-COMBINED-BOUNDARIES | Ten utility/FileIO/HTTP/logging/rendering/reference/Feed/Homebot/household plans compose: 1,076 edit groups in 835 existing files, 35 unique new source paths, 82 multi-specification files and one consistent factory. Source parses in memory and four edit-verifier defect probes fail as intended. This is not a candidate tree, behavioral red/green run, package/build proof or implementation approval. | Implementation/build reviewers; IMP-SHARED.04.1/04.2/04.3/04.4, full rehearsal integration gate |
| DEC-HTTP-MIDDLEWARE | Four system files retain a cohesive private barrel and one four-name public entry. Exact proposal: 82 imports, four guide spellings and one SchoolCalc permission edit; 1,278 literal occurrences in 214 files have dispositions. Eighteen extracted School observations preserve the narrow permission. Thirty-seven dedicated HTTP cases and four red/restored controls supplement 64 original error/logging cases. The eleven-source/nine-facade native fragment preserves UUID/error/logger identity, catches four duplicate/leak graphs and passes the same 37 assertions with restoration hashes. Four original suites also pass their same 64 named cases twice after five exact import edits in temporary copies; prelude/body/local bindings and combined hashes match. Error-string aggregate loading is covered; the other two leaf-import suites, full installed identity, caller/LoA enforcement, computed/untracked references and original socket/source-predicate suites remain open. Missing devProxy documentation and stale mixed middleware recipe are pre-existing defects, not extra moves/exports. | Platform/API/logging/test/build reviewers; http-boundary.json/md, IMP-SHARED.04.3; documentation reviewer owns separately scoped stale-guide repair |
| DEC-FILEIO-REFERENCES | 778 tracked occurrences across 388 files classified; seven additional comment/example/corpus-guard edits in five files. The original exercise-library regex rejects the proposed import spelling; exact old-or-public matcher retains two allowed names and all ten forbidden tokens under 17 extracted-predicate observations. Preserve D5/D10 and old-path fixtures; three enforcement regexes still require semantic resolver integration. | Test/platform/architecture reviewers; fileio-reference-review.json/md, IMP-BASE.02/03 and IMP-SHARED.04.2 |
| DEC-FILEIO-EXPORTS | Selected one system-layer public entry with 73 named exports, four unchanged private-only helpers, 281 import and 22 mock-target changes across 281 files. Five namespaces/43 property uses and all 23 dynamic imports are accounted for. Six unchanged original suites pass 36 baseline cases; exact 73-name facade bytes separately pass native/Vitest binding/cache/private-helper and mock counterexamples. Original-suite candidate, full references/storage, lock/build and layer adoption remain gated. | Platform/test/build reviewers; fileio-boundary.json/md, IMP-SHARED.04.2 |
| DEC-UTILITY-STALE-TESTS | Two Home Automation tests import nonexistent system `AuthorizationError`; their actual use cases use the application semantic-errors class. Exact two-specifier repair proposed, separately approved and reproduced before retirement; no new platform type or passing-original-test claim. | Test reviewer; IMP-BASE.03, IMP-SHARED.04.1 |
| DEC-FEED-QUERY | Exact selected operation/port/reader/query, factory expansion and ten edits are in `feed-boundary.json`. Public composition returns synchronous `gratitudeQueries.readSelectionQuotes`; Feed gets the bound operation, not a private import or unused query module export. Lazy selected-row interpretation preserves twelve baseline cases; native candidate and new negative controls remain required. | Gratitude/Feed reviewers; IMP-SHARED.02 |
| DEC-HOMEBOT-COMMAND | Exact returned batch operation, consumer-owned extending bridge/port, eleven edit groups and nine existing import-edge dispositions are in `homebot-boundary.json`. Eleven baseline cases preserve batch duplicates/partial writes, event timing, message/state errors and lazy identity. Four new negative controls and native candidate proof remain required. | Homebot/Gratitude reviewers; IMP-SHARED.03.1 |
| DEC-IDENTITY | Exact shared source port/extending config adapter/query, public composition and direct-return browser client are in `household-boundary.json`: seven sources, three manifest proposals, eighteen edits. Nine server/five browser cases preserve naming, UTC/default quirks, refresh and HTTP/error order. Category/time generation stays Gratitude; no new endpoint. Global package/metadata/test/dev/build, six new negatives and candidate proof remain required. | Identity/Gratitude reviewers; IMP-SHARED.03.2 |
| DEC-PRINT-EXPORT | Select Gratitude's public adapter subentry for Fitness composition and the retained adapter test, keeping actual inheritance from its private application port. Exact facade/facet/import spellings are recorded; native package/FileIO identity, the explicit adapter raw path prohibition and OS-temp capability ownership remain gates. No promotion to generic printing or implicit layer exemption. | Gratitude/Fitness/architecture reviewers; IMP-BASE.02, IMP-SHARED.04, IMP-GR-MOVE.01 |
| DEC-POLICY-RANKS | Proposed ruling: `books` is Level 2; domains import strictly downward; unknown ranks fail closed; equal-ranked contexts may share only declarative names/schemas/data constants through `shared/contracts`. Current policy/checker behavior remains baseline until a separately approved implementation changeset. The current source has three findings under the proposed rule: `piano → school` once and `trigger → barcode` twice. No proposed rule grants API→application/domain, domain→application ports, a D10 exception, or executable code in `shared/contracts`. | Architecture maintainer; IMP-BASE.02 and IMP-POLICY.01/02 require explicit implementation approval. |
| DEC-CONTRACT-SYMBOL-SPLIT | `HOUSEHOLD_APP_CONFIGS` is the sole public declarative contract from the current household-config source. Co-located `appConfigRelPath` and `allAppNames` are executable helpers; extract them privately to system config without duplicating the frozen map. Only ConfigService currently imports the lookup helper; direct map consumers remain data-only. | Architecture/system-config/test reviewers; IMP-BASE.04 and PRE-3.1.1/PRE-3.3.2 evidence. |
| DEC-PACKAGE-REAL-GRAPH | Sibling forwarding/type/import-map/private-subpath fixture passes; offline nested install and clean reinstall preserve real timezone runtime separation in both orders. Vendor metadata is pinned to local sources; the complete original lock/range/peer/native/React graph remains unproved. | Build reviewer; IMP-PKG.01/02 |
| DEC-CYCLES | Six source SCCs exist. Relocation cannot turn Player into a generic host with a product dependency. Some SCCs may remain within a legitimate owner; source cycles are not automatically owner cycles. | Architecture reviewer; owner-specific extraction, IMP-SHARED.04 |
| DEC-TEST-SAFETY | Keep the OS effect boundary. Default scripts can kill ports, start controllers or reuse live servers; ports and GET verbs are not isolation. | Test owner; every implementation verification |
| DEC-RUNNER-GAPS | Static filename count, dedicated file discovery and actual case execution are different populations. Audit each runner's setup and roots before making it a gate. | Test/tooling reviewer; IMP-BASE.03 |
| DEC-IMAGE-INPUTS | Docker uses mutable image/package/downloader/supervisor inputs. Mac native rendering is not production-image proof. | Build reviewer; IMP-PKG.03 |
| DEC-BROWSER-EVENT-MISMATCH | `/new` publishes `type: gratitude_item`; the kiosk handles `action: item_added`. The raw payload is currently ignored. Preserve that baseline unless separately approved as a behavior fix. | Gratitude reviewer; any optional behavior repair, not relocation |
| DEC-REGISTRATION-IDENTITY | Two backend manifests claim media/files; selection is last enumerated. Fitness's 24 widgets share the screen singleton but retain product ownership. Preserve selected bindings, registration order and identity if discovery/host composition changes; do not add disposal or fix legacy admin behavior incidentally. | Integration/host composition reviewers; conditional prerequisite for affected mechanisms, not an unrelated Gratitude blocker |

## Repairs are not migration cleanup

Rendering/font prerequisite **DEC-RENDERING-FONTS / IMP-SHARED.04.5** now has an
exact three-body/four-facade/one-locator/nine-asset specification, 41 edits in 22
files and five current font-root consumers. Use the public system font locator
for retained School/Fitness consumers, never the superseded private-relative
paths. Preserve all application presentation ports and native font state.
Resolve backend installed 3.1.0 versus backend locked 3.2.3 versus root 3.2.1
canvas, original affected suites, font metrics/negative controls, package/Linux
delivery, caller enforcement and supplied/missing notice provenance before
adoption. These are explicit gates, not permission to alter versions or source.

1. The older sampled Piano failures are historical, not rerun in this packet.
   The relevant `backend/src/4_api/v1/routers/pianoGames.test.mjs` and its
   `PianoGamesContainer`/`OpponentLadder` fixtures need a safe reproduction before
   anyone edits or excludes them. Vitest's comment reports a different count;
   neither a comment nor a prior sample is current approval of a failure count.
2. `docs/ai-context/testing.md` references a missing `scripts/test-backend.mjs`;
   the actual root `test:backend` delegates to
   `tests/_infrastructure/harnesses/isolated.harness.mjs` with an explicit category
   filter. `smoke:yaml` also points at a missing script. Corrections require their
   own exact changeset; existing files remain frozen here.
3. Snapshot lookup's unknown-ID fallback, malformed-file listing/latest behavior
   and router error-message mismatch are characterized quirks. Do not repair
   them while moving files; see DEC-SNAPSHOT-FALLBACK.
4. A read-modify-write workflow across separate DataService calls is not made
   transactional by this plan. Do not silently add locking, caching, validation,
   authorization, new file names, new event schemas, or new print behavior.

## What remains possible without changing existing files

The open investigation items in `task-status.json` remain preparation work:
finish shared-caller storage/resource/protocol accounting (HTTP/browser/provider/lifecycle source accounting is complete), classify the complete affected closure,
resolve every proposed public import, expand missing UI/storage/auth cases,
prove the real workspace installation in disposable roots, and finalize the
prerequisite changesets. These are not automatically blocked merely because the
current package proposals need more investigation.

Actual application-factory startup, migrated imports, candidate browser assets,
old-reader/new-writer candidate data, clean candidate images and contributor
commands cannot be certified until the corresponding implementation exists.
Their status is candidate-pending, not passed. Protected-source extraction,
repository package adoption, existing test repair and rehearsal require the
user's next explicit implementation authorization.

## First protected-file change to request, not perform

`IMP-BASE.01` removes exactly the unused `createGratitudeServices` import from
`backend/src/5_composition/modules/gratitudeApi.mjs`. It does not extract the
factory, alter mounts or migrate anything. Its acceptance is a safely importable
composition module with the same observable factory behavior and a reduced
dependency closure; both positive tests and a restored-edge negative check must
run. This is a small first gate, not approval for the remaining backlog.

## Future approval and execution graph

This is a topological route for **separately approved** changesets. A later node
is blocked until every named predecessor has review evidence; failure never
authorizes a workaround or broader scope.

| Order | Future outcome | Required predecessors | Stops before |
|---|---|---|---|
| 1 | `IMP-BASE.04` contract/helper split | DEC-CONTRACT-SYMBOL-SPLIT, public-entry approval | package adoption |
| 2 | `IMP-BASE.01` unused controller-import removal | fresh baseline, exact one-file approval | factory extraction |
| 3 | `IMP-BASE.02` relocation-aware enforcement | DEC-POLICY-RANKS, architecture approval | source moves/baseline edits |
| 4 | `IMP-BASE.03` runner/discovery repair | exact reproduction, per-file approval | test-count/exclusion changes |
| 5 | `IMP-PKG.01` disposable package-risk proof | final owner/export matrix | repository manifests/locks |
| 6 | `IMP-PKG.02` package/resolver adoption | BASE.02/03, PKG.01, exact package approval | image/build adoption |
| 7 | `IMP-PKG.03` immutable image/client closure | PKG.02, build-only approval | deployment/controller changes |
| 8 | `IMP-SHARED.04` bounded foundation | PKG.02, exact symbol/import set | product extraction |
| 9 | `IMP-SHARED.01` Gratitude factory/publication | BASE.01, package/public-entry approval | consumer seams |
| 10 | `IMP-SHARED.02` / `.03` reviewed consumer seams | SHARED.01/04, applicable PKG cards, per-seam approval | Gratitude relocation |
| 11 | `IMP-GR-MOVE.01` atomic Gratitude rehearsal | all applicable predecessors and explicit rehearsal approval | another owner, merge or deployment |
| 12 | verification, recovery and contributor trial | completed move and real candidate entries | production rollout |

`IMP-POLICY.01`, `IMP-POLICY.02` and `IMP-CAP-SCREEN.01` are separate owner
tracks. They are not Gratitude predecessors unless an approved rehearsal diff
touches their declared symbols; neither track widens the other.
