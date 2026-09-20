# Provider and Household Playback Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove and deploy reliable playback across the actual configured providers, devices and media classes.

**Architecture:** One semantic adapter contract suite, one renderer/runtime fault harness, and real household device evidence verify the A/B system. Progressive rollout keeps cleanup ownership active even when new adaptive opens are disabled.

**Tech Stack:** Existing Vitest, Playwright, structured log store, injected provider fakes, real media fixtures and device browsers.

**Spec:** [Design](2026-09-19-adaptive-playback-design.md); [index](2026-09-19-adaptive-playback-implementation.md); plans [A](2026-09-19-adaptive-playback-a-control.md) and [B](2026-09-19-adaptive-playback-b-preparation.md).

## Global Constraints

Inherit all index constraints and exact acceptance targets. Missing devices,
disabled probes, skipped decoder tests, or missing provider support do not count
as passing. Do not restart household controllers or take over occupied devices.
Do not start a second household backend through Playwright's webServer option.

## Review Focus

Opaque players falsely reporting health (C1/C2), unknown enabled providers (C1),
two real viewers sharing a content ID (C2), missed provider restart cleanup (C2),
rollback leaving transcoders/jobs active (C3) each receive explicit acceptance cases.

### Task C1: Enabled-provider inventory and semantic contract completion

**Files:** Create `tests/contracts/playbackSource.contract.test.mjs`,
`tests/fixtures/adaptive-playback/providerMatrix.mjs`;
adapter playback `ExistingSourcePlaybackBridge.mjs` and tests;
modify A2 concrete adapters and the relevant enabled source integrations:
`backend/src/1_adapters/content/media/files/FileAdapter.mjs`,
`backend/src/1_adapters/content/stream/StreamAdapter.mjs`,
`backend/src/1_adapters/content/media/youtube/YouTubeContentSource.mjs`,
`backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs`,
`backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfAdapter.mjs`.
Only modify each when runtime inventory confirms a media playback path; record
non-media sources explicitly rather than inventing conversions for books/images.

**Interfaces:** Each enabled media source implements A2 or is translated by
ExistingSourcePlaybackBridge into available delivery plus explicit unsupported
operations. `providerMatrix` exports rows with `{sourceKey,mediaKinds,operations,
fixtureCases,coverageStatus}`. Concrete sourceKey values are configured in private
runtime input, not committed household configuration.

- [ ] Write shared tests for describe/open/close/idempotency/revision, expiry and unknown observation semantics; assert inventory completeness:

```js
it('accounts for every enabled media source', () => {
  expect(new Set(matrix.map(row => row.sourceKey))).toEqual(new Set(enabledMediaSourceKeys));
  expect(matrix.some(row => row.coverageStatus === 'unexamined')).toBe(false);
});
```

Load test inventory from injected config; production certification uses actual
enabled keys. A synthetic fixture inventory only proves the assertion works.

- [ ] Run `npx vitest run tests/contracts/playbackSource.contract.test.mjs` red against incomplete fixture adapters.
- [ ] Complete missing provider translations. Embedded players return observed health only when an actual player bridge supports it; otherwise retain unknown health. Remote sources use native variants/renewal and never claim local preparation. For generic existing sources preserve existing working play responses while adding bounded observation and status. Do not mark bridge coverage equivalent to full controllability.
- [ ] Run shared contract tests and each changed adapter's tests green; update inventory report; commit `feat(playback): cover configured provider capabilities`.

### Task C2: Runtime fixture matrix, fault injection and actual devices

**Files:** Create `playwright.adaptive-playback.config.mjs`,
`tests/live/flow/player/adaptive-playback.runtime.test.mjs`,
`tests/live/flow/player/adaptive-playback-faults.runtime.test.mjs`,
`tests/fixtures/adaptive-playback/cases.mjs`,
`tests/_lib/adaptivePlaybackHarness.mjs`,
`scripts/verify-adaptive-playback-report.mjs`, and
`docs/_wip/audits/2026-09-19-adaptive-playback-acceptance.md`.

**Interfaces:** cases declare `{caseId,sourceRef,expectedOutcome,minPlayMs,
clientProfileKey,fault,positionToleranceMs}`. Harness exports
`runPlaybackCase({page,testCase,baseURL})` returning
`{caseId,buildId,clientProfileKey,startupMs,rebufferCount,decodedProgressMs,
recoveries,positionErrorMs,resourceCounts,cleanupResult,outcome,evidencePaths}`.
Report verifier fails on missing mandatory cases, skips or threshold violations.
The harness writes its private machine-readable report to
`artifacts/adaptive-playback/acceptance.json` (gitignored) and evidence files in
that directory. Commit only the sanitized audit summary.

- [ ] Write runtime assertions for actual decoded progress rather than `paused=false`:

```js
expect(result.startupMs).toBeLessThanOrEqual(5000);
expect(result.rebufferCount).toBe(0);
expect(result.decodedProgressMs).toBeGreaterThanOrEqual(testCase.minPlayMs);
expect(result.cleanupResult).toBe('confirmed');
```

Use these only for ready managed cases; failure fixtures instead require the
expected preparing/unavailable state within 30 seconds. Where decoded counters
are unavailable, record alternate frame/presentation evidence explicitly, and
do not relabel absent measurements as decoded progress.

- [ ] Create a config that cannot auto-start a backend:

```js
import {defineConfig} from '@playwright/test';
if (!process.env.BASE_URL) throw new Error('BASE_URL must name the one approved stack');
export default defineConfig({
  testDir:'./tests/live/flow/player',
  testMatch:'adaptive-playback*.runtime.test.mjs',
  timeout:3*60*60*1000,
  workers:1,
  use:{baseURL:process.env.BASE_URL,trace:'retain-on-failure'},
});
```

Fixtures use an isolated media-provider/fault service injected into the approved
stack, not another household controller. C2 tests never point mutations at real
provider sessions unless an explicit owned test attempt is identified.

- [ ] Run `npx playwright test --config playwright.adaptive-playback.config.mjs --list` to verify discovery without launching playback. Execute against the approved stack and confirm unsupported implementations fail with evidence.
- [ ] Implement cases for H.264, HEVC 8/10-bit, AV1, VP9, 60fps, HDR, unusual AAC, alternate language, text/image subtitles, timestamps, corruption, expired URLs, live seek windows and opaque sources. Include two simultaneous viewers, composite slots, seek storms, pause during renewal, process death after open, delayed old responses, network reduction and slow encoder output. Assert bounded resource counts and recovery state, not merely eventual playback.
- [ ] Add fast-path assertions: ordinary audio/video and unknown unflagged metadata call no assessment endpoint, probe or preparation job. Measure at least 30 paired old/new starts per representative profile; require <=10ms p95 local risk-decision cost and <=100ms p95 added startup, alongside the existing total-startup targets. Include a proven-compatible HEVC source that suppresses repeated seed assessment.
- [ ] Add episode/learning acceptance: many events during one stall trigger no second-stall assessment; two distinct qualifying episodes trigger exactly one; pauses, bounded seek warmup and suspension count zero. Test immediate decoder rejection and unresolved-first-stall timeout. Feed attributed multi-title failures with successful corrective playback to promote only the matching device-scoped rule; network and unknown failures must not promote it. Verify seven-day expiry, three-success demotion and source/client/environment invalidation with injected clocks.
- [ ] Run generated fixtures with A/B enabled and disabled to prove measurements catch the known failure signatures. Fix implementation defects with focused regressions before rerunning the affected cases. Log independent production server/client timestamps accurately.
- [ ] Run on every inventoried household renderer/device with its real autoplay/decoder constraints. Start from a permitted actual user gesture where required, without test flags that hide production autoplay behavior. Record profile/version/build, evidence paths and exact outcomes. Include at least one full-length film and a 30-minute prepared case for each supported profile; shorter fixtures run in full. Devices unavailable now remain outstanding.
- [ ] Implement report verifier using node assertions, including these mandatory checks:

```js
assert.equal(report.requiredCases.every(id => report.results.some(r => r.caseId === id)), true);
assert.equal(report.results.some(r => r.outcome === 'skipped'), false);
assert.equal(report.results.every(r => r.buildId === report.buildId), true);
assert.equal(report.acceptanceViolations.length, 0);
```

Compute violations from raw metrics and expected outcomes inside the verifier;
never trust a supplied empty violations array. Store device-private identifiers
outside committed reports; publish anonymized stable profile keys.

- [ ] Run `node scripts/verify-adaptive-playback-report.mjs --report artifacts/adaptive-playback/acceptance.json` and inspect failures. Commit harness, regression fixes and sanitized evidence as `test(playback): certify adaptive playback across providers and devices` only when evidence supports the wording.

### Task C3: Controlled rollout, rollback and goal audit

**Files:** Modify composition `adaptivePlayback.mjs`, `mediaPreparation.mjs`;
add `backend/src/5_composition/modules/adaptivePlayback.rollback.test.mjs`;
update `docs/reference/player/adaptive-playback.md` and acceptance report.

**Interfaces:** feature policy injected from configuration:
`{enabled,enabledProfileKeys,preparationEnabled}`. Disabling new adaptive opens
must not disable existing attempt cleanup or job reconciliation.

- [ ] Write rollback test before changing wiring:

```js
it('keeps cleanup running after disabling new adaptive playback', async () => {
  await controller.setPolicy({enabled:false,preparationEnabled:false});
  await scheduler.tick();
  expect(source.close).toHaveBeenCalledWith(expect.objectContaining({attemptId:'owned-old'}));
  expect(preparation.request).not.toHaveBeenCalled();
});
```

Build controller/setPolicy as composition test helpers around the real module's
injected policy source; do not introduce a production mutable configuration API
only to satisfy the test.

- [ ] Run rollback test red; implement admission-disable with reconciliation retained, then run green.
- [ ] Run index verification gates and C2 report verification on the exact candidate build. Complete source-level review for provider leakage and double retry authorities. Commit `feat(playback): gate rollout while preserving resource cleanup`.
- [ ] Apply the workspace's deploy/idle gate and current authorization policy. Canary one unoccupied profile, inspect sustained playback/cleanup and preparation quota behavior, then expand to each supported profile. Verify actual container build matches the candidate. No source-tree HEAD substitution.
- [ ] Perform one controlled rollback and re-enable during an owned test attempt; prove resources settle, progress remains correct, and new legacy opens work. Re-run affected acceptance cases after any fix.
- [ ] Compare all attempted starts, preparation waits, rebuffering, recovery outcomes and resource counts against baseline. Include unavailable outcomes in denominators. Run a 24-hour household observation period after rollout with actual playback on the inventoried profiles; query the log store for each session and reconcile missing evidence. Lack of household usage is not a passing soak.
- [ ] Audit every design acceptance item against exact files, commands, report entries and runtime build evidence. Keep the objective active if any profile/provider requirement is missing, any required test skipped, or any observed regression unresolved. Mark complete only when all requirements have authoritative evidence.

**Exit:** deployed, verified household playback under normal and fault conditions,
with managed preparation and documented provider limitations. A review-approved
plan, successful compilation or isolated policy suite alone is not this exit.
