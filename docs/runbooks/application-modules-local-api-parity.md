# Application modules read-only API parity

Use `tests/readiness/application-modules/run-readonly-suite.mjs` to regenerate independently expected fixtures and replay explicitly reviewed packs. The existing runner boots the assembled application against a disposable data snapshot under Landlock/seccomp, listens on127.0.0.1:43129 for30seconds, and has a75-second outer bound. Outbound traffic and unapproved filesystem access are blocked. Reports and response bodies remain in a private output directory. Boot, source classification and HTTP equality each provide separate evidence; `readinessAccepted` remains false.

## Current scope and evidence

The candidate is pinned at `c6ac6e69f8c104a968c397931c92dc55df1297f4`; the reviewed reference source is `14beb0cc931b3e87dc578d4f09dc0e4dbaa63cbd`. All658 committed-source GET declaration IDs match across those checkpoints. Source labels are324 finite-safe,239 with effects,48 external/stream and47 conditional. The591 curated facts preserve durable writes, provider/device actions and session/intent changes. Exact eligibility review permits benign process memoization, font registration and finite existing-file streams when the entire delegated/middleware path is read-only.

`http-readonly-eligibility.json` retains per-declaration effects, mount prerequisites and132 historical comparator cases:131 exact links over87 source declarations plus1Node `/healthz` edge outside the Express declaration count. That case count is not a route coverage percentage. Historical checkpoints and approvals stay in `docs/_wip/plans/2026-10-09-cutover-coverage.json`; reuse requires the current explicit proof index.

`http-expected-installed-route-matrix.json` derives the expected Docker graph from pinned source and a hash-pinned backing configuration snapshot. It has644 unique GET URL templates and384 potentially eligible templates;92 have historical case links and292 do not. The384 include382 without optional HomeDashboard/Concierge construction plus2 optional safe reads. Aliases and alternate guarded handlers count once by URL.34 declarations are source-unwired,13 disabled by School flags,1 Test handler disabled by its default,1 missing-config fallback excluded. Every source prefix is accounted for. This expected graph supplies coverage planning; actual installed mounting remains unobserved.

Two baseline correctness gates remain open. Content-prefix equality does not satisfy the frontend `config.legacy` consumer contract when backing supplies `aliases`/`storagePaths`. Life feedback filtering reads a source timestamp while two stored records use date, so an encompassing period independently expects2 rows and both applications return0. Compatibility evidence does not earn correctness credit for those cases or expand the migration goal to fixing all baseline bugs. School retains six named fixture gaps; five overlap the eligible backlog, while printables needs its narrower eligibility/composition prerequisites. Separately, the Chess ladder projector calls pure product roster/policy helpers, so its independent oracle remains unproved; comparison acceptance alone provides no independent correctness credit.

The completed pre-Piano full suite replayed all 11 then-reviewed packs: 89 unique cases and 89 equivalent comparisons, with 86 independently accepted contracts. CLI exit is 0 and completeness/equivalence are true; correctness and readiness remain false. This renewed execution evidence without increasing historical coverage; changed harness pins require renewal before replay. Its self-contained proof index was `/tmp/readiness-suite-all-corrected-proof.json` (SHA-256 `f3722498428320e8d4b9b9286469837349cd0fa5a29bb13fe9fa49b8b6752bed`); result: `/tmp/readiness-suite-all-corrected-run/suite-result.json`. It covers 120 reviewed source pairs and 92 backing guards; 25 control tests passed.

The original frozen result `/tmp/readiness-suite-all-run/suite-result.json` remains preserved: exit 1, 87 equivalent cases. Shared finance summary projection had overwritten nested transactions in two complete selected budget fixtures; the repair preserves complete `dayToDayBudget` values with nullish assignment and independently checks backed detail invariants after shared projection. A separate reference fetch failure is retained in that original result. The focused corrected five-case replay and subsequent full replay passed comparison without transport relaxation. Exact receipts, repair hashes and limitations are in the durable ledger's `repeatableReadonlySuiteFull89Replay` entry; compatibility acceptance does not resolve the two baseline failures or the Chess oracle limitation.

The subsequently accepted `piano-stored` pack adds 18 disjoint cases across 16 templates and 12 declarations: 18 equivalent comparisons and 12 independent contracts, exit 0. At that checkpoint, historical totals reached 107 cases and 98 independent contracts across the completed runs; no combined replay was claimed. Six Producer list/detail cases preserve all 130 original YAML records' validation failures and receive equivalence-only credit, with zero healthy populated Producer credit. Bank counts distinguish 4,896 Cartesian combinations from 4,893 within keyboard MIDI range 21–108; catalog/search fields beyond the asserted finite contracts remain comparison-only. The two lesson templates still require verified media mapping/backing.

Piano result: `/tmp/readiness-piano-stored-keyboard-run/suite-result.json`; self-contained proof: `/tmp/readiness-piano-keyboard-reviewed-proof.json`, SHA-256 `ec1524ac7e88d7d23b70ea993b75b474b99e6b5b527598a5f2edd8551e844198`. The ledger preserves the first header failure and the subsequent Cartesian-count failure, the independent corrections, exact receipts and current limits. Content-prefix, Life filtering and Chess oracle limitations persist; correctness and readiness remain false.

The accepted `school-stored` pack adds nine disjoint populated JSON cases across seven templates and seven declarations: 9/9 equivalent and independently correct, exit 0. At that checkpoint totals were 116 cases and 107 independent contracts across separate 89/18/9-case completed runs; no combined116-case run was claimed. Result: `/tmp/readiness-school-stored-bounded-run/suite-result.json`; self-contained proof: `/tmp/readiness-school-bounded-reviewed-proof.json`, SHA-256 `01b193de4ac69d50171804f143d4d38aa7a53bfe96ad41fbde3da6a67e1e963d`.

School uses a pinned independently prepared source/backing snapshot, not dynamically regenerated School contracts. Changed backing or the guarded UTC teacher year requires a fresh independent projection and renewed approval; API response bodies must never become the expectation oracle. Its proof embeds expected contracts, exact descriptors and guarded configuration without requiring archived preparation scripts at runtime. All31 attempt shards remain copied for results while the attempt-days getter independently selects the newest14. The ledger preserves the initial8/9 run and omitted14-row bound correction.

The accepted `fitness-stored` pack adds ten disjoint cases across seven templates and seven declarations: 10/10 equivalent comparisons and independent contracts. At that checkpoint current historical totals were 126 cases and 117 independent contracts across separate 89/18/9/10-case completed runs; no combined126-case run was claimed. The strict composite proof retains and equates `Content-Length` across all ten comparisons, links exact requests to the raw manifest, and normalizes only `Date`, `Connection` and `Keep-Alive`. The strict manifest was not sent and caused no additional HTTP requests. The original second-boundary `Date` header failure remains recorded; this is composite offline comparison evidence, not a new HTTP replay. Fitness backlog falls from19 templates/declarations to12; readiness remains false.

The School packet copies52 exact UTF-8 files and four bounded binary backing files into disposable fixtures. These supply lexicons, referenced media and retained-manifest integrity; all nine requests return JSON, so binary-response coverage is zero. Candidate lifecycle uses enabled virtual adapters for the reviewed finite getters; this proves no production mount identity or device action. Six existing composition gates and22 remaining School target templates persist. The new binary boundary has a separate bounded review before further extension. Previous baseline correctness failures remain; overall correctness and readiness are false.

## Run a reviewed suite

Create a fresh private output directory (0700). Keep proof indexes, selected identifiers, backing projections, raw responses and receipts outside the repository with0600 files. Run transport/filesystem controls before executing selected cases:

```sh
node tests/readiness/application-modules/run-local-app.mjs \
  --source-root /absolute/candidate \
  --tool-root /absolute/installed-dependencies \
  --output-root /absolute/private-controls-output \
  --controls-only
```

Run only packs explicitly admitted by a current source/build/proof index:

```sh
node tests/readiness/application-modules/run-readonly-suite.mjs \
  --source-root /absolute/candidate/worktree \
  --tool-root /absolute/dependency/tool/root \
  --data-root /absolute/private/backing/data \
  --output-root /absolute/fresh/private/suite-output \
  --reference-url http://127.0.0.1:3111 \
  --reference-commit FULL_REVIEWED_REFERENCE_SHA \
  --candidate-commit FULL_REVIEWED_CANDIDATE_SHA \
  --proof-index /absolute/private/reviewed-suite-proof.json \
  --packs school-stored
```

The coordinator independently regenerates the projection once, validates every selected request, then invokes the existing runner sequentially. Source/build identity and backing identity/content/absence/directory guards run before and after each pack. A guard or transport-control failure stops subsequent requests. The default disposable fixture has synthetic credentials and empty device/provider/integration configuration. Add only reviewed harmless composition dependencies; activating physical adapters, providers, timers or authenticated sessions is outside the read lane.

The self-contained proof index schema is `daylight.readonly-suite-proof/v1`. It contains full `candidateCommit`/`referenceCommit`, exact `sourceGuards` entries `{path,sha256}`, and named reviewed `packs`. Each pack records `sourceEquivalence` entries `{candidatePath,livePath,candidateSha256,liveSha256}` and exact cases `{id,method,path,safety,branch,independentContractAccepted}`. Source guards cover the admitted runtime inventory and the runner/comparator/probe/loader/C launcher, generator, fixture and base manifest. Changed hashes do not renew route approval. Requests must exactly match reviewed read-only dispositions with `sideEffects:false`, `nonlocal:false`, `longLived:false`; no headers, bodies, discovery or extra routes are admitted by this suite.

Prepare proof entries from source review and explicit branch contracts; importing hash-verified prior approvals is optional. Expectations come from fresh independent source projections, never archived response bodies. Changed backing-derived request selection needs renewed exact case approval. The no-cookie/no-Bearer path avoids token session access; a valid active SID can persist lastSeenAt even before permission denial. A401/403 does not count as successful data coverage, and access must not be bypassed.

Fixed pack names are initial, next, extended, reconciled, feedback, calendar, automotive, health-stored, finance-stored, life-stored, school-records, piano-stored and school-stored. Selecting a pack without a matching current proof fails before its API case requests. Check the supplied proof index and resulting suite artifact for what was actually admitted, executed and completed; the Piano and School proofs separately admit piano-stored and school-stored. The preceding 89-case proof records its completed run; changed source, fixture or selection needs renewed proof. Do not infer a combined approval from separate receipts.

The optional `rawUTF8Files` fixture array preserves exact bytes using rows `{destination,sha256,byteLength,encoding:"utf8",base64}`. Only canonical `data/household[-HOUSEHOLD]/piano/producer/{loops,crate,songs}/SLUG.yml` and `data/users/PROJECTED_ROSTER_USER/apps/piano/composer/SLUG.musicxml` destinations are admitted, with one MiB per file and eight MiB total. Exact approved destination/hash/length/encoding pins are part of the Piano proof. The validator rejects traversal, noncanonical paths/base64, config/secrets/device destinations, missing projected roster profiles, duplicate paths, JSON collisions, invalid UTF-8 and NUL bytes. The probe writes byte-for-byte with exclusive `wx` creation into disposable scratch; sandbox read/write/network grants remain unchanged. The 131 accepted files total 905,823 bytes and preserve YAML Date types. The Piano scope alone does not authorize School media or binaries; the School packet requires its separately reviewed exact fixture pins.

Inspect `suite-result.json` for exact unique case IDs, occurrences, branch counts, individual receipts/comparisons, completeness, equivalence and correctness. A successful exit establishes selected comparison acceptance. Semantic findings remain explicit even when both applications agree. Replaying existing cases adds no historical coverage credit; whole-application readiness remains false.

## Choose the next coverage packs

The accepted `language-stored` pack adds six populated cases across six alias URL templates and three declarations: 6/6 equivalent comparisons and independently correct contracts. The cases cover two JSON arrays and four finite MP3 responses, establishing the first four binary-response coverage cases. At that Language checkpoint, totals were 132 historical cases and 123 independent contracts across separate 89/18/9/10/6-case runs; no combined132-case run is claimed. Six Language templates remain in the backlog. The expected denominator remains source-derived and conditional; actual runtime installation is unobserved. Documentation changed after the reviewed proof, so future proof pins need refresh.

The expected-route matrix's `coverageBacklog` groups all292 unlinked templates into86 fixture families over282 declarations. Every route lists exact template/declaration IDs, path parameter selection, lexical request inputs, recorded branch/mount requirements, existing fixture gaps and source proofs. Ten alias groups share fixture inputs while retaining separate URL contracts. Lexical query names are not proof a parameter is required; exact selected contracts must follow the linked reviewed source.

The largest owner families are School22 templates/22 declarations, Fitness12/12, Gaming15/15, Home12/6 and Language6/3. Piano retains11/11 gaps after the accepted16-template stored/authored pack: two lessons need verified media backing; the remaining learning/progress/manifest contracts need their separately recorded backing/composition prerequisites. Omitted progress does not prove an empty enabled branch. The accepted School pack covers its seven prepared templates; remaining requests need new explicit source and fixture approval.

School's22-template remaining family should split copied authored descriptors, stored attempts/reports/remediation/artifact/poster reads, and the named lifecycle/print gaps. Frozen reports/transcript use finite per-request PDF rendering; posters require existing local bytes. Pass-overrides needs harmless lifecycle store injection; print quota/pending/requests need harmless PrintService construction with exact source policy and queue windows; milestones needs existing plans plus independently joined session/attestation status. No physical printer or provider activation follows from preparing those fixtures.

Fitness's12-template family should split existing workout/cycle-race/session/voice-memo records and menu assets from process-only status projections. Preserve exact getter contracts and independently derive stored summaries; ladder/personal-best index repair, simulation actions and provider reads remain excluded. Each new pack needs explicit source-equivalence/fixture/branch proof entries before HTTP. Respect the listener window by dividing broad families into coherent small packs.

## Reproduce source accounting

The committed-source capture parses declarations without executing product modules:

```sh
node tests/readiness/application-modules/capture-http-declarations.cjs \
  /absolute/candidate /absolute/captured-declarations.json

python3 tests/readiness/application-modules/reconcile-http-denominator.py \
  --source-root /absolute/candidate \
  --capture /absolute/captured-declarations.json \
  --layer-receipt /absolute/private-http-run/receipt.json \
  --output-file /absolute/generated-reconciliation.json
```

Use `--update-mounted-inventory` only when refreshing that tracked artifact. The reconciler checks declaration identities and evidence hashes, including the expected-mount matrix if present. It does not boot the app or authorize requests. `http-mounted-layer-observation.json` contains exact synthetic layer observations, not a live census. Device opaque wrappers, aliases, guarded variants and source-unwired factories retain separate source evidence in the expected matrix.

## Resolve the production metadata gap

The source-derived profile assumes Docker configuration and successful boot. Actual production DAYLIGHT_ENV and loaded configuration identity are unobserved because Docker socket access was denied; no permission workaround was attempted. HomeDashboard's declared home-automation integration does not prove successful gateway load. Concierge registers within try/catch. The four affected templates are `/api/v1/home-dashboard/{config,state,history}` and `/v1/models`; state/history remain provider reads outside the allowed policy. Physical School lifecycle uses the configured kitchen-printer host fallback despite absent direct School printing.host. School agenda renderer availability chooses ready/partial handlers at the same URLs; successful contracts need renderer evidence.

Prepared diagnostic `/tmp/readiness-production-mount-metadata-diagnostic.py` emits `daylight.sanitized-production-mount-metadata/v1`. With authorized Docker access, run:

```sh
python3 /tmp/readiness-production-mount-metadata-diagnostic.py \
  --container EXACT_DAYLIGHT_CONTAINER \
  --config-root EXACT_BOUND_BACKING_ROOT \
  --expected-config-observation /tmp/readiness-mount-config-pinned.json
```

The diagnostic reads inspect/log metadata and local configuration file hashes. Its output contains only DAYLIGHT_ENV, image/start identity, configuration hashes/match flags and selected startup registration booleans/times. It emits no full environment, credential values, raw logs or host paths, and makes no HTTP/container exec calls. Missing or rotated startup logs remain unknown. Match the source/image and loaded configuration to the pinned profile before treating expected routes as observed installed routes. Isolated coverage preparation can continue while this specific metadata gap remains.

## Compare isolated original and candidate source processes

Prepare one fixture with the existing independent projector, then admit its exact bytes and selected manifest using a reviewed `daylight.isolated-api-pair-proof/v1` packet. Run the selected cases against both actual source trees sequentially on the existing task-owned loopback listener:

```sh
node tests/readiness/application-modules/run-isolated-pair.mjs \
  --original-root /absolute/reviewed/original-source \
  --candidate-root /absolute/candidate/worktree \
  --tool-root /absolute/canonical/dependency/root \
  --output-root /absolute/fresh/private/pair-output \
  --fixture /absolute/private/projection/fixture.json \
  --manifest /absolute/private/projection/selected-expectations.json \
  --proof /absolute/private/reviewed-pair-proof.json
```

The packet records `reviewed:true`, `name`, exact reviewed `cases` (the same selection/contract approval fields as the live suite), `fixtureFileSha256`, `manifestFileSha256`, `backingInputs` from projection provenance, and `originalSha256`, `candidateSha256`, `runtimeSha256`, `harnessSha256`. Obtain the latter inventories using the exported `collectPairInputs({originalRoot,candidateRoot,toolRoot})`; each pin is SHA256 of `JSON.stringify` of its respective returned property. Source inventories include actual source bytes and commit identity; runtime inventories include canonical installed dependency bytes and native runtime inputs. Renew the reviewed packet after any change; generating hashes alone does not approve requests or expectations.

The coordinator checks inventories and backing inputs at admission and role boundaries, binds capture rows to exact requests and final guarded receipts, and compares stored bytes offline with the existing JSON/text/binary contracts and explicit normalizations. Inspect `pair-result.json`, `comparison.json`, `input-inventory.json` and both role receipts. Contract failures remain failures; existing baseline semantic defects retain failed correctness even when both captures agree. This lane uses the current installed dependencies with original and candidate source, carries no production-image claim, makes no live-reference requests, and adds no live or historical coverage. Whole-application readiness remains false.


## Completed live and isolated evidence

The [coverage ledger](../_wip/plans/2026-10-09-cutover-coverage.json) records 134 distinct live-reference cases and 125 accepted independent contracts after two populated Piano descriptor checks. These are separate completed runs, not a combined134-case replay.

The actual-source isolated lane completed 57 distinct case IDs: two smoke cases, twelve existing Health cases, four synthetic config cases, fifteen further synthetic cases, ten additional stored-data cases, nine Gaming descriptor/content cases, and five stored-array cases across four further templates. Fourteen replay existing live IDs. Deduplicating live and isolated evidence yields 177 accepted case IDs and 168 independent contracts. The isolated lane contributes forty-three new case IDs across forty-one additional source templates; it adds no live-reference credit. No combined177-case replay is claimed.

Historical live links cover 94 of the 384 potentially eligible source templates. The live/isolated source-evidence union covers135, leaving249 without executed evidence; the historical-live backlog remains290. These counts describe selected source contracts. The configured installed-runtime denominator and coverage percentage remain unknown, and readiness remains false. Prior baseline contract failures remain recorded.

The ledger pins role receipts, comparisons, reviewed infrastructure and the refreshed source/runtime/harness proof. Original14beb and candidate source processes used current installed dependencies; no original production image or fictional image identity is claimed. The rejected recipe-array admission attempt and the initial learner-name contract failure remain immutable private evidence. The corrected fifteen-case fixture adds the source-required display name and keeps expected bytes unchanged. Raw response payloads and fixture values stay in private artifacts.

Bookkeeping changes the expected-route matrix used in harness admission. Refresh future proof pins after this update, before another capture; new hashes do not independently approve a packet.

The isolated branch now contains the full pinned-main 10d8 delta at its mapped owners, pending final review and commit. Fresh integration evidence is 353 matching named JS assertions per role, one confined production build and one repeated Chess resumable GET against actual 10d8 source. Five additional stored-array GETs matched actual original14beb against the integrated candidate and passed independent contracts; this does not refresh all 177 historical HTTP cases. Five reviewed Chess dependency pins and unchanged GET identities were renewed; the candidate capture explicitly identifies recovery HEAD f302 plus the uncommitted Chess router bytes. Run the canonical source capture after the merge commit before future proof admission. Earlier integration failures and the 177-assertion incomplete setup run remain recorded. The exact Chess DOM pack uses a 3000ms TestingLibrary default on both roles, preserves explicit overrides and the product fetch deadline, and checks a bounded never-true condition; no UI latency certification follows. The durable confined JVM unit lane passed the same 35 named assertions on both roles with no failures, skips or assumptions. It uses a shared unit stub and Java11 bytecode targeting on the pinned JRE21; it does not certify Android/device behavior, Java11 platform compatibility, or outbound-connect denial.
