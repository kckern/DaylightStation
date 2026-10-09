# Application modules cutover readiness implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Keep an evidence ledger and complete each acceptance gate before declaring readiness.

**Goal:** Prove that the migrated application preserves the current main branch’s outward-facing behavior and can be deployed and rolled back safely.

**Architecture:** Keep the existing isolated refactor worktree. Reconcile current main into the owned layout. Build the actual production image and compare two fully booted applications with identical isolated synthetic data and controlled external service fixtures; preserve actual routing, middleware, composition, persistence, and browser behavior.

**Tech Stack:** Git, Node/Express, React/Vite, existing Vitest/Playwright suites, production Dockerfile, existing confined selected-test runner.

**Spec:** User goal “complete cutover readiness,” with explicit old/new API equivalence and daily-use regression concerns; docs/roadmap/2026-08-31-full-stack-application-modules.md sections 0.5–0.7.

## Current phase: read-only live/local parity (latest user direction)

This phase takes precedence over the broader release tasks below. First inventory the read-only API surface across every application; then build and execute the comparison suite. The reference is the currently running live server. The candidate may be a local server from the isolated worktree on a distinct loopback port; building or deploying a Docker image is not a prerequisite.

Record each mounted method/path, application owner, source evidence, parameters, inherited middleware, delegated effects, data dependencies and classification: reviewed read-only, excluded side effects, or unresolved. Exclude Express settings getters from endpoint counts. Include dynamic mounts and implicit HEAD as explicit unresolved items until resolved. GET alone is not permission to execute a request.

Only reviewed read-only requests may reach live. Do not exercise create/update/delete APIs, side-effectful GETs, session-touching identities, devices, generation/refresh commands or background jobs in this phase. Candidate startup must use separate storage and prevent autonomous production/provider effects; never reuse writable live data/config blindly. Use a consistent private snapshot where needed for meaningful comparisons, keeping credentials and household response bodies out of tracked artifacts.

Compare the same explicit requests against live and candidate. Assert expected status, headers, structure and meaningful values independently, then compare responses with narrowly documented volatile-field exceptions. Report live-data drift separately from code differences. Record the observed live build identity where available, rather than assuming it is current main. A local process has source/config provenance; it does not need a fictional image digest.

Report inventory completeness, eligible endpoints, reviewed cases and actual executed outcomes separately. The present synthetic comparator controls and router tests are not live/local parity evidence. Writes, browser journeys, WebSocket behavior, packaging and rollback remain separate future release work; do not expand this requested baseline into those tasks before delivering it.

## Locked read-only validation pattern and coverage gate

The first real run establishes the mechanism, not migration-wide confidence: the actual assembled candidate, production request handler and TCP listener passed three independent contract checks and live comparisons. Keep this as a reusable runner, reviewed case manifests, private target/fixture metadata, and sanitized per-case reports. Do not rebuild bespoke scratch probes for each application.

### Required coverage before accepting the read-only migration baseline

| Dimension | Required gate | Current evidence |
| --- | --- | --- |
| Surface accounting | Every discovered mounted route and static declaration reconciled to an endpoint, conditional fixture, duplicate/non-route, or documented exclusion | Current source accounting and expected URL graph are maintained in the [coverage ledger](2026-10-09-cutover-coverage.json), [eligibility ledger](../../../tests/readiness/application-modules/http-readonly-eligibility.json), and [expected route matrix](../../../tests/readiness/application-modules/http-expected-installed-route-matrix.json). The configured runtime installed denominator remains unknown. |
| Safety classification | Every candidate classified with handler, middleware and delegated-service evidence; unresolved cases block a claim of complete read-only coverage | Per-declaration effects, eligibility and source-mount dispositions are in the [eligibility ledger](../../../tests/readiness/application-modules/http-readonly-eligibility.json); conditional construction and remaining gaps are in the [expected route matrix](../../../tests/readiness/application-modules/http-expected-installed-route-matrix.json). Actual production installation remains unobserved. |
| Eligible endpoint coverage | 100% of migration-affected read-only endpoints have an executed old/new case with independent expected behavior | Exact case mappings and separate historical runs are in the [coverage ledger](2026-10-09-cutover-coverage.json). Historical receipts do not establish a combined replay or a coverage percentage; this gate remains open. |
| Successful behavior | At least one meaningful populated/default success per eligible endpoint; a missing-service error does not cover success | Independent contract outcomes and remaining endpoint gaps are recorded in the [coverage ledger](2026-10-09-cutover-coverage.json) and [expected route matrix](../../../tests/readiness/application-modules/http-expected-installed-route-matrix.json). This gate remains open. |
| Distinct response branches | Cases for supported empty results, missing IDs, invalid input, filters/pagination/order, relevant config variants and permitted identity differences where those change behavior | Branch prerequisites and remaining route templates are maintained in the [expected route matrix](../../../tests/readiness/application-modules/http-expected-installed-route-matrix.json); select cases from reviewed source contracts rather than multiplying parameter combinations. |
| Critical read journeys | Cover the entire API read sequence of daily-use School, Piano, Fitness/playback, Media, Health and other installed applications, including ownership boundaries | Case-level evidence is in the [coverage ledger](2026-10-09-cutover-coverage.json). Journey-level coverage remains unestablished, so this gate remains open. |
| Differential results | Zero unexplained status, header, body, ordering, route or configuration differences in the required population | Current case outcomes and baseline correctness gates are recorded in the [coverage ledger](2026-10-09-cutover-coverage.json) and [local API parity runbook](../../runbooks/application-modules-local-api-parity.md). The historical live-reference checkpoint is not the current installed-production graph; this gate remains open. |
| Repeatability | A fresh candidate run uses pinned source/tree/config identities, explicit targets, isolated writes, reviewed requests and a machine-readable report | Runner, pack receipts and proof identities are documented in the [coverage ledger](2026-10-09-cutover-coverage.json) and [local API parity runbook](../../runbooks/application-modules-local-api-parity.md). Changed proof inputs require renewed pins; readiness remains open. |

Treat every installed read route as potentially affected by the composition change until its dependency path proves otherwise. Sampling one endpoint per application is an intermediate checkpoint, not the acceptance gate. Test all distinct endpoint contracts, then select scenarios by observable branches and known regressions rather than aiming at a line-coverage percentage.

Use three reported dimensions: surface accounted for; eligible endpoints exercised; required scenarios passed. Keep exclusions and unresolved entries visible next to these numbers. A skipped, unreachable, unconfigured or baseline-failing case is not a pass. Distinguish a baseline contract defect, intended post-live feature change, data drift, and migration regression. Matching a pre-existing defect is parity evidence only, not a successful contract.

The original live reference used for the first three passes predates the incoming School and Chess features. Live subsequently advanced to `25b5318b72`, which includes those features; the before-pack build guard detected the change and stopped the seven-case attempt before business requests. Pin and retain the observed live identity, record intentional deltas explicitly, and use the same source revision with matching data when isolating an ambiguous refactor difference. Never weaken expected values or erase body fields to obtain equality. Before actual cutover, rerun the required suite against the final candidate and then run the reviewed production-safe smoke set immediately afterward; preserve the old source/build reference for diagnosis.

This gate covers the user-requested read-only baseline. It does not certify mutation APIs, WebSocket lifecycle, background jobs, physical devices, browser interaction or deployment rollback. Those stay visible as separate release risks and future gates; they are not silently counted as covered by GET parity.

### Execution order

1. Make the proven local runner and first three cases reproducible from the worktree.
2. Finish mounted/static reconciliation and safety classification, maintaining the application-by-application matrix.
3. Add meaningful read cases for every application, starting with daily-use cross-module flows; use narrowly copied private backing data where required.
4. Expand each endpoint to its distinct response branches and known historical regressions.
5. Run the complete required population against the final candidate and report remaining failures/exclusions explicitly before any cutover decision.

## Global constraints

- Work only in `.worktrees/application-modules` on `refactor/application-modules`; do not change main, deploy, push, or disturb live use.
- Preserve current main functionality, public routes, authorization, payloads, state changes, events, jobs, configuration semantics, and browser workflows.
- Never treat test counts as a coverage percentage. Map evidence to the actual inventoried surface and report gaps explicitly.
- No private credentials, household data, physical devices, or live provider side effects in test fixtures. Test mutation flows on fresh disposable data only.
- Retain existing Landlock profiles for selected tests. A separate isolated container test environment must have task-owned storage and no route to production/provider networks; do not weaken host security or change Docker socket permissions.
- Preserve all historical failed receipts. Existing known failures are not passing tests and require explicit disposition if they affect a daily-use release gate.
- For this phase, actual live/local HTTP comparison is required; Docker and browser work are deferred. Vite builds, mocked routers and static checks cannot substitute for live/local evidence.

## Review focus

- Missing or changed mounted routes, middleware ordering, authentication and permission failures.
- File-relative assets, configuration defaults, migrations and write paths after relocation.
- Stateful workflows, restart persistence, emitted events, retries and duplicate effects.
- Lazy browser imports, deep links, WebSocket reconnect and playback/reading lifecycle.
- Image-only missing sources/dependencies, startup/job registration, rollback preserving intervening main work.

## Task 1: Establish the coverage denominator and comparison contract

- [ ] Inventory actual HTTP routes/methods/mounts and dynamic registration sites; separately enumerate WebSocket/event, jobs and browser entry points. Record unresolved dynamic routes rather than silently omitting them.
- [ ] Map existing tests and actual executed evidence to each surface: full-server HTTP, router/service with substitutes, browser flow, static-only, untested, or external/hardware-dependent.
- [ ] Define identical original/candidate fixtures and contract assertions for status, headers, response shape/content, auth, persistence and events. Normalize only specifically reviewed nondeterministic fields; never mask missing/extra fields or errors.
- [ ] Produce durable `2026-10-09-cutover-coverage.json` and a human-readable coverage/gap summary in this plan’s progress ledger.

## Task 2: Reconcile current main

- [ ] Pin main SHA and preserve a refactor checkpoint. Integrate School story-time noRepeatDays behavior and all intervening tracked changes into the owned paths; preserve both histories.
- [ ] Run the relevant original main tests and migrated tests with identical named populations and fixtures in the existing confinement lane. Verify new browser helpers remain discoverable.
- [ ] Independently review the integration diff, including app composition and incoming imports; do not claim parity with an obsolete pre-feature main.

## Task 3: Validate real deployment packaging

- [ ] Inspect `docker/Dockerfile`, root `.dockerignore`, owned YAML/assets and dependency setup against actual source/resource consumers. Repair demonstrated omissions with focused regression checks.
- [ ] Prepare a tracked-only, secret-free build context and invoke the actual production Dockerfile on an accessible approved builder. Record context digest, source revision, image ID and complete build result.
- [ ] Verify required owned runtime assets and package resolutions inside the image. Resource limits and isolation must protect the host’s ongoing work.

## Task 4: Differential full-application acceptance

- [ ] Boot original current-main and candidate images with identical disposable fixtures and controlled external provider boundaries. Use actual production entrypoint/server, not a replacement test-only router.
- [ ] Compare inventoried HTTP contracts, including successful reads/writes, empty/error cases, auth/permissions, persisted results and event effects. Each required surface must have executed evidence or an explicit unresolved release blocker.
- [ ] Exercise representative daily-use browser journeys through those servers: School portal/reading/story-time, Piano controls/games, Fitness/playback, shared media/screens, and other routinely used surfaces identified by the inventory. Verify real lazy bundles and WebSocket lifecycle.
- [ ] Exercise startup/readiness, job registration and safe controlled job effects, restart persistence, configuration loading and graceful shutdown. Keep provider/hardware verification limits explicit.
- [ ] Record exact original/candidate image/source hashes, per-case outcomes and differences; fix candidate regressions and rerun only affected gates plus required integration checks.

## Task 5: Cutover and rollback package

- [ ] Write `docs/runbooks/application-modules-cutover.md` with concrete image/source identification, fresh-main reconciliation, deployment readiness and usage-idle gates, smoke checks, rollback trigger and rollback commands preserving intervening main changes.
- [ ] Refresh the stale roadmap and refactor status to distinguish structural completion, verified readiness and future runtime-framework work.
- [ ] Review all readiness changes and evidence against this plan; run the unchanged original commit hook, verify a clean local checkpoint and final main inclusion.
- [ ] Mark readiness complete only after all required actual image/runtime tests pass and no daily-use release blocker remains. Deployment and merging into main remain separate actions.

## Historical initial evidence and constraints

- Refactor starting checkpoint: `7c0936d1b5d450c3495fb5c105d7aaf196d3bc54`.
- Main at intake: `16a0f157f1`, containing new School story-time repeat protection `ef5e840864`.
- Historical selected evidence: 39 groups / 6,480 original passing executions, 27 added guards, 39 supplemental existing cases, 11 known failed executions; calculator 46 suites / 213 enabled passes / one original skip. Counts overlap; no whole-application coverage percentage is established.
- Docker client exists, but this user cannot access the system daemon; noninteractive sudo needs a password. Rootless binaries exist but user mappings are unavailable and the user-namespace probe fails. Builder access was requested previously; the user subsequently selected a local-server alternative, so Docker access does not block the read-only baseline.

## Execution ledger

- Intake: verified clean existing worktree, inspected fresh-main delta and production build files. No production changes.
- User clarified release fidelity: full-server API equivalence and daily-use connectivity are required. Added explicit surface inventory and differential full-application gates; selected tests alone cannot complete this goal.

## Read-only API comparison contract (user refinement)

The first executable smoke population covers every inventoried endpoint proven read-only for its specified parameters. A method name is not a safety proof: finance account reads can request a refresh, TTS exposes generation through GET, and content/streaming routes may fetch providers or populate caches. Classify those separately and keep unresolved cases visible.

Retain an immutable reference image identified by image ID/digest and source SHA, plus the fixture revision. Run reference and candidate on separate loopback-only ports with separate disposable data clones of the same frozen snapshot. Block production/provider network access and prevent autonomous jobs/device connections from the reference. Keep the exact image available after cutover for repeatable comparisons; never rely on a mutable `latest` tag. Pin the actual pre-cutover production image separately for rollback, even if the functional baseline has since incorporated newer main commits.

Each manifest case records method/path/query, fixture IDs, auth identity, required configuration/provider fixture, expected status/content type/schema/meaningful values, headers and body comparison policy. Test populated and empty reads, missing IDs, invalid queries, filters/pagination/order, and relevant authorized/unauthorized household roles. Pass requires both baseline-contract assertions and old/new comparison; identical 500s or identical empty responses do not satisfy populated success cases.

Default comparison is exact structured JSON (ignoring object key order only), exact array order, and exact binary hashes where deterministic. Declare individual nondeterministic fields explicitly and assert their type/format/relationships. Build version/digest must differ as expected; do not broadly erase timestamps, IDs, URLs or fields. Normalize only the known reference/candidate origin where self-links require it. Record every exception with rationale.

Requests use explicit base URLs, bounded timeouts and concurrency, restricted redirects, response size/stream limits, and no fallback to production. The runner must report skipped, unreachable, unconfigured or unclassified cases as unverified, never green. A failing baseline blocks parity certification for that case. Save request metadata, both result artifacts, image/fixture identities and focused diffs without credentials.

Coverage report denominator: inventoried mounted route+method entries, then eligible read-only entries, entries with meaningful fixtures, entries with reviewed expectations, and entries actually executed/passed in both images. Keep parameter/auth/error scenarios as a separate case count; do not inflate endpoint coverage with many cases on one route. Include missing/extra routes and unresolved dynamic registration separately. Read-only suite coverage does not certify writes, WebSocket lifecycle, jobs, browser interaction or physical hardware.

### Historical inventory checkpoint

Static API/composition scans of main `16a0f157f1` and refactor `7c0936d1b5` each found 1,176 literal route declarations and 83 literal API registry mount entries. Counts are declarations, not unique reachable endpoints or coverage percentages. Conditional/nested/dynamic mounts remain unresolved. The inspected selected HTTP evidence contains 15 School/ePaper request declarations through real mounted routers with synthetic services; it is not fully assembled application HTTP proof. Raw inventory packets are under `/tmp/cutover-http-surface/` pending a compact durable reviewed manifest.

Main subsequently added documentation-only commit `27e7b58a68`; the feature delta remains the same School story-time change. No merge has occurred. Rootless Docker was also ruled out by absent subordinate UID/GID mappings and a denied user-namespace probe; no host permission changes were attempted.

### Readiness implementation lanes

- Comparator and negative controls: `tests/readiness/application-modules/api-comparator.mjs` and `comparator-controls.test.mjs`; executable expectations in `api-expectations.json`.
- Source declarations and per-case classification: `tests/readiness/application-modules/http-source-inventory.json` and `http-case-inventory.json`. Lexical risk flags are screening evidence only; delegated side effects and mounting remain unresolved until reviewed or exercised.
- Isolation recipe: `tests/readiness/application-modules/isolated-container-recipe.md`.
- Cutover procedure: `docs/runbooks/application-modules-cutover.md`, currently unexecuted. Host deployment script recreates both backend and browser and does not itself enforce the usage-idle gate; exact effective runtime configuration and image retention require Docker access and rehearsal.
- The scan includes 657 GET call candidates and no explicit HEAD declarations. These include nonliteral/unresolved calls and are not a count of safe public endpoints. Express implicit HEAD behavior needs separate cases.

### Historical verified integration and tooling checkpoint

At this historical checkpoint, main `27e7b58a68` was reconciled into the owned paths. Original main and migrated candidate each passed the same 179 cases across seven School suites (`Vdk3GX` / `kTK5tU`), with complete collection, confinement controls and protected-source checks. The predicted 175 count was superseded by actual execution. Four preliminary harness/collection failures remain recorded; none was accepted as passing. The new reading UI helper remains School-owned, and the repeat check shares the existing story-time launcher.

At the next historical tooling checkpoint, Vite build `YykVLk` passed with 109 owned chunks; the comparator then had ten passing synthetic controls and no actual HTTP execution. A later checkpoint recorded fourteen comparator controls and three actual live/local cases (liveness, player defaults and the authored Fitness course). These are historical milestones; current case evidence and remaining API gaps are maintained in the [coverage ledger](2026-10-09-cutover-coverage.json) and [expected route matrix](../../../tests/readiness/application-modules/http-expected-installed-route-matrix.json). The Fitness authored-YAML Docker exception is corrected. A homemade policy matcher used during inspection was removed from the durable test suite; actual Docker context and image verification remain future deployment gates, not prerequisites for the local read-only suite.

See [the current coverage and verification record](2026-10-09-cutover-coverage.json). All full-runtime release gates remain open. This is an integration/tooling checkpoint, not a cutover-readiness declaration.

### Historical pinned-main local checkpoint (superseded)

The uncommitted merge now legitimately names pinned main `989124c4ca5e6a27a859abddb3921df11cb6fb06`. A verified private snapshot preserved changed/untracked files, modes, deletion/symlink metadata, raw index and binary patches before normal Git abort/merge operations. Saved School/Chess owner integrations and readiness files were restored; the archive intersection was merged three-way, and Piano ghost engraving imports retained music-notation ownership.

At this historical checkpoint, original and mapped ghost engraving/resolved-staff component suites passed the same 148 named tests, and the production Vite build passed. Exact owned source/test hashes preserved prior School179 and Chess176 evidence without rerunning those suites. The original pre-commit hook and local commit had not yet run at that point. Receipt paths, snapshot verification and subsequent main drift are recorded in the coverage ledger. These checkpoint checks did not accept whole-application readiness.

### Latest committed source checkpoint

The latest committed checkpoint is `c6ac6e69f8c104a968c397931c92dc55df1297f4` (`Merge pinned main into application modules and record local readiness checkpoint`). It is the original-hook checkpoint. Its source and historical local validation evidence are recorded in the [coverage ledger](2026-10-09-cutover-coverage.json); current API case mappings and expected-route gaps are maintained in the [eligibility ledger](../../../tests/readiness/application-modules/http-readonly-eligibility.json) and [expected route matrix](../../../tests/readiness/application-modules/http-expected-installed-route-matrix.json). The commit establishes a source checkpoint only. Read-only live/local parity, actual production installation, and the broader runtime release gates remain open. A local candidate comparison does not establish production route installation or replace the separately required live-reference distinction.
