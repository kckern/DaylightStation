# Adaptive Playback Control Implementation Plan

**Status (2026-09-25):** A0–A2 on main (35250324c); A3–A6 not started.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select sustainable playback paths and recover without losing position or multiplying provider resources.

**Architecture:** Content-domain selection and recovery consume normalized evidence. Application use cases own durable attempt generations and capacity leases through ports; adapters implement vendor behavior. Frontend renderers execute commands and report observations.

**Tech Stack:** Existing Node ES modules, React, Vitest, YAML/FileIO, existing DASH/HLS.

**Spec:** [Design](2026-09-19-adaptive-playback-design.md); [execution index](2026-09-19-adaptive-playback-implementation.md).

## Global Constraints

Inherit every global constraint and prerequisite in the execution index. No Plex
wire logic outside adapters. No content-domain import from media. Original files
are unchanged. Recovery budgets survive remounts and sparse advancing frames.

## Review Focus

Late opens (A4), short progress bursts (A1/A5), source revision changes (A1/A2),
track loss (A1/A2), uncertain resource close (A3/A4) each have explicit tests below.

## File and interface map

Create the pure modules in `backend/src/2_domains/content/playback/` and orchestration
in `backend/src/3_applications/content/playback/`. Application ports live in
`backend/src/3_applications/content/ports/`. Colocate tests with each module.
New infrastructure lives in `backend/src/1_adapters/content/playback/`, except
Plex implementation which stays in `backend/src/1_adapters/content/media/plex/`.

Contracts defined in A1 use these exact field names:

```js
// Nullable measurements mean unknown, never zero.
// ClientProfile: {profileKey, renderer, evidenceVersion, supportedFormats,
//   supportedCodecs, maxWidth, maxHeight, maxFrameRate}
// Rendition: {renditionId, sourceRevision, format, video, audio, subtitles,
//   trackSelection, conversion, ready, resourceClass, estimatedUnits}
// video: null | {codec, profile, level, bitDepth, width, height, frameRate, hdr}
// audio: null | {codec, channels, layout, language}
// TrackSelection: {audioId, subtitleId, subtitlesRequired}
// Delivery: {format, url, contentOriginMs, seekWindow, expiresAt, segmentDurationMs}
// Observation: {intentId, attemptId, generation, sequence, observedAt,
//   positionMs, paused, seeking, visible, decodedFrames, bufferSeconds,
//   productionRate, deliveryRate, failure}
// failure: null | {kind: 'access-expired'|'decoder'|'network'|'provider'|'unknown'}
```

Provider-specific payloads and filesystem paths are not fields in these contracts.
Signed delivery URLs are ephemeral and excluded from persistent telemetry.

### Task A0: Fast-path trigger policy and scoped learning

**Files:** Create domain playback `assessmentTrigger.mjs`, `interruptionEpisodes.mjs`,
`learnPlaybackRisk.mjs` and their colocated tests; application port
`IPlaybackRiskRepository.mjs`; adapter playback `PlaybackRiskRepository.mjs` and
tests. Persist via A3's state store when available; use an injected fake for the
pure-policy tests. Cache risk snapshots outside the start-critical path.

**Interfaces:** `decideAssessment({media,clientProfileKey,cachedRisk,episodes,failure,now})`
returns `{action:'play'|'assess',reason}`;
`updateEpisodes({state,observation,now})` returns immutable episode state;
`learnPlaybackRisk({rule,outcomes,now})` returns an updated scoped rule.
Risk repository exposes `find({profileKey,environmentVersion})`, `record(outcome)`
and `save(rule)`. Outcomes contain incidentId, sourceRevision, titleId, media
characteristics, profileKey, environmentVersion, attributedCause, correction,
healthyDurationMs and observedAt. Rules contain feature predicates, scope,
supportingIncidentIds, success/failure counts, expiresAt and status.

- [ ] Write and run `npx vitest run backend/src/2_domains/content/playback/assessmentTrigger.test.mjs backend/src/2_domains/content/playback/interruptionEpisodes.test.mjs backend/src/2_domains/content/playback/learnPlaybackRisk.test.mjs` red. Pin the default explicitly:

```js
expect(decideAssessment({media:{kind:'video'},clientProfileKey:'browser-a',
  cachedRisk:[],episodes:[],failure:null,now:1000})).toEqual({action:'play',reason:'optimistic-default'});
expect(decideAssessment({media:{kind:'audio',codec:'aac'},clientProfileKey:'browser-a',
  cachedRisk:[],episodes:[],failure:null,now:1000}).action).toBe('play');
```

- [ ] Implement seed matching from cached facts, not provider calls: video AND
  codec in HEVC/VP9/AV1 AND (width >=1920 OR height >=1080). Known successful
  evidence for the same exact source/profile/environment suppresses redundant
  seed reassessment. Missing metadata is not a risk match. Test cropped 1920x804,
  portrait video, 720p, unknown dimensions and a proven compatible HEVC source.
- [ ] Implement episode deduplication: >=1s unexpected no-progress opens one
  episode; five healthy seconds close it; two starts within 120s trigger once.
  Test repeated DOM events, remounts, user/app pause, seek warmup, suspension,
  and one unresolved episode. Definitive decoder incompatibility bypasses the
  two-episode rule; the first-stall timeout remains independently active.
- [ ] Implement learning thresholds from the design: >=3 revisions across >=2
  titles and >=2 proven successful corrections within a client/environment scope;
  no network/unknown promotions; seven-day expiry and three-success demotion.
  Test incident deduplication, success denominators, exact-item quarantine versus
  pattern promotion, scope invalidation, and lack of evidence. Learned rules
  trigger assessment only. Persist only after observations, never synchronously
  before normal playback.
- [ ] Run the three tests green. Integrate durable repository tests after A3 and
  commit `feat(playback): assess only known risks and repeated interruptions`.

### Task A1: Pure compatibility, selection and recovery decisions

**Files:** Create `playback/contracts.mjs`, `playback/selectRendition.mjs`,
`playback/decideRecovery.mjs` under the domain directory above, plus each matching
`.test.mjs`. Create `tests/fixtures/adaptive-playback/policyCases.mjs` for reusable
normalized inputs (no real provider credentials or household IDs).

**Interfaces:** `selectRendition({candidates, client, tracks, evidence, capacity})`
returns `{kind:'selected', renditionId}` or `{kind:'prepare'|'unavailable', reason}`.
`decideRecovery({observations, ledger, candidates, now})` returns
`{action:'wait'|'renew'|'replace'|'prepare'|'fail', reason, renditionId?}`.
Export `advanceRecoveryLedger({ledger, now, healthy, replaced})`; ledger fields are
`incidentCount`, `replacementTimes`, `healthySince`, `lastReplacementAt`.

- [ ] Write table tests with complete source/client characteristics. Include unknown bit depth, exact profile rejection, 60fps passthrough, unknown AAC layout, required subtitle loss, incompatible HDR, absent observations, paused/seeking cases and expiring access. The following regression must fail before policy exists:

```js
import { expect, it } from 'vitest';
import { advanceRecoveryLedger } from './decideRecovery.mjs';
it('does not forgive three failures after one second of progress', () => {
  const ledger = { incidentCount: 3, replacementTimes: [1000, 5000, 9000],
    healthySince: 10000, lastReplacementAt: 9000 };
  expect(advanceRecoveryLedger({ledger, now: 11000, healthy: true, replaced: false})
    .incidentCount).toBe(3);
});
```

- [ ] Run `npx vitest run backend/src/2_domains/content/playback` and confirm missing-module/behavior failures, not harness errors.
- [ ] Implement immutable validated contracts, stable ranking and budget updates. This richer selection runs after A0 triggers assessment or when an existing assessed rendition is available. Unknown evidence on ordinary playback does not require a probe. Use explicit negative evidence to reject; after a trigger, any probe requires capacity. Core budget behavior:

```js
const recent = ledger.replacementTimes.filter(at => now - at < 600000);
const healthySince = healthy ? (ledger.healthySince ?? now) : null;
const recovered = healthySince !== null && now - healthySince >= 60000;
const incidentCount = recovered ? 0 : ledger.incidentCount;
const exhausted = incidentCount >= 3 || recent.length >= 6;
// Apply one recorded increment only when a replacement transition is accepted.
```

Use 1s/2s/4s bounded transient backoff, with the 30s incident deadline governing
all waits/operations. Never decide encoder starvation from CPU alone. Require
falling buffer plus production evidence; missing provider data retains unknown
cause. Do not reset the rolling cap on recovery or user retry.

- [ ] Run the directory tests green and `npm run audit:layers`. Commit explicit new files as `feat(playback): define rendition selection and recovery policy`.

### Task A2: Source port and provider translation

**Files:** Create `IPlaybackSourceGateway.mjs` in application ports;
`RegistryPlaybackSourceGateway.mjs` in adapter playback;
`PlexPlaybackSource.mjs` under media/plex; `FilePlaybackSource.mjs` and
`RemotePlaybackSource.mjs` under adapter playback; matching tests. Modify
`RegistryContentCatalogGateway.mjs` only to expose normalized source references
where existing resolution is needed. Do not inspect source methods in use cases.

**Interfaces:** source port:

```js
openDefault({contentId, attemptId, generation, positionMs, tracks, client})
// Ordinary existing resolution/negotiation; same opened result as open, no added assessment.
describe({contentId, client, tracks}) // {kind:'available', sourceRevision, candidates, operations} | unavailable
open({contentId, renditionId, sourceRevision, attemptId, generation, positionMs, tracks, client})
// {kind:'opened', handle, delivery, actualRendition, conversion} | failed
inspect({attemptId, handle}) // {kind:'observed', productionRate, alive} | unknown | unsupported
renew({attemptId, handle}) // {kind:'renewed', delivery} | unsupported | failed
close({attemptId, handle}) // {kind:'closed'|'pending'|'unsupported'}
findOwned({attemptId}) // {kind:'found', handle} | absent | unknown | unsupported
```

All operations use deadlines/AbortSignal supplied by the application; adapters
must propagate cancellation and map timeout separately from proven absence.

- [ ] Write port contract tests using injected provider fakes. Confirm describe never starts a conversion, two calls with one attemptId never intentionally open two resources, revision mismatch refuses open, unsupported is explicit, and actual selected mode may differ from request:

```js
it('does not label an unexpected encode as stream copy', async () => {
  const provider = { decide: async () => ({videoDecision: 'transcode'}) };
  const source = new PlexPlaybackSource({provider});
  expect(await source.describe({contentId:'source:item', client:{}, tracks:{}}))
    .toMatchObject({kind:'available', candidates:expect.arrayContaining([
      expect.objectContaining({conversion:'video'})])});
});
```

Make the test fake's full metadata/decision shape match captured sanitized provider
responses before implementation; do not substitute imaginary vendor fields.

- [ ] Run `npx vitest run backend/src/1_adapters/content/playback backend/src/1_adapters/content/media/plex/PlexPlaybackSource.test.mjs` red.
- [ ] Implement per-provider translation using existing clients injected in composition. Keep `PlexAdapter` caps until an equivalent measured path is proven. Normalize actual decision tracks; build offsets, session identifiers and URLs inside `PlexPlaybackSource`. File references remain opaque; remote HLS and embedded responses advertise only supported controls. An HTTP 200 alone cannot be normalized to confirmed decoding.
- [ ] Run the new tests plus `npx vitest run tests/unit/adapters/plex/transcodeProfile.test.mjs` green. Commit `feat(playback): add provider-neutral source gateway`.

### Task A3: Durable attempt repository and capacity leases

**Files:** Create application ports `IPlaybackAttemptRepository.mjs`,
`IPlaybackCapacityGateway.mjs`; adapter playback `PlaybackStateStore.mjs`,
`PlaybackCapacityAdapter.mjs`; domain playback `PlaybackIntent.mjs`; matching tests.

**Interfaces:** repository `get(intentId)`, `compareAndSet(intentId, expectedVersion, next)`
returns `saved` or `conflict`; `listUnsettled()` returns intents with opening/closing
attempts. `PlaybackIntent` holds ID, surfaceId, slotId, contentId, sourceRevision,
generation, version, tracks, desiredState, confirmedPositionMs, activeAttempt,
pendingAttempt, cleanupAttempts and recovery ledger. Capacity port
`reserve({attemptId, resourceClass, units, now, ttlMs})`, `renew({attemptId, now})`,
`release({attemptId, proof})`, `snapshot({now})`.

- [ ] Write simultaneous CAS/reservation tests, restart tests, token ownership tests and unknown-close tests:

```js
it('retains capacity after an unconfirmed close', async () => {
  const capacity = new PlaybackCapacityAdapter({stateStore, limits:{video:1}});
  await capacity.reserve({attemptId:'a',resourceClass:'video',units:1,now:1,ttlMs:45000});
  await capacity.release({attemptId:'a',proof:'pending'});
  expect(await capacity.reserve({attemptId:'b',resourceClass:'video',units:1,now:2,ttlMs:45000}))
    .toMatchObject({kind:'denied'});
});
```

Each test creates an isolated temporary stateStore fixture and removes only that
fixture afterward. Race two independent adapter instances, not merely two calls
through the same in-memory lock.

- [ ] Run `npx vitest run backend/src/1_adapters/content/playback/PlaybackStateStore.test.mjs backend/src/1_adapters/content/playback/PlaybackCapacityAdapter.test.mjs` red.
- [ ] Implement durable state via injected FileIO with atomic replacement under an exclusive OS file lock and a single configured controller. Lock acquisition uses exclusive creation; lock includes process identity/start identity. Only prove-dead same-host owners may be reclaimed; age alone never steals a live lock. CAS and resource reservations share the lock. Reject unsupported multi-host writes. Inject clock/process-liveness probes into infrastructure. Defaults: heartbeat 10s, lease 45s, reconciliation 5s. Lease expiry triggers cleanup, not immediate reuse of unconfirmed conversion capacity.
- [ ] Run race, process-death and corruption tests green; `npm run audit:fs`. Commit `feat(playback): persist attempt ownership and capacity leases`.

### Task A4: Open, observe, replace and reconcile use cases

**Files:** Create application playback `OpenPlayback.mjs`, `ObservePlayback.mjs`,
`ReconcilePlayback.mjs`, `ClosePlayback.mjs`, with matching tests; create port
`backend/src/3_applications/content/ports/IReadinessRepository.mjs` and adapter
`backend/src/1_adapters/content/playback/EmptyReadinessRepository.mjs`.

**Interfaces:** constructors receive `{source, repository, capacity, readiness, clock, ids, logger}`;
readiness port defines `find({sourceRevision,profileKey})`, `save(evidence)` and
`invalidate({sourceRevision,artifactRef})`. Its initial EmptyReadinessRepository
returns `[]` for find and `{kind:'unsupported'}` for writes. B1 supplies durable
storage without changing this contract.
`OpenPlayback.execute({intentId, surfaceId, slotId, contentId, client, tracks, positionMs, desiredState})`;
`ObservePlayback.execute(observation)`; `ClosePlayback.execute({intentId})`;
`ReconcilePlayback.execute()` returns settled and still-unknown counts.

- [ ] Test injected fake sources and repositories: concurrent seek/cancel, late open, crash after external open, stale observation, pause preservation, distinct viewer sessions, confirmed-position mapping, close timeout and provider disappearance. Assert external calls as well as state:

```js
it('closes a late open without installing it', async () => {
  const pending = openPlayback.execute(request);
  await closePlayback.execute({intentId:request.intentId});
  providerOpen.resolve({kind:'opened',handle:'owned-a',delivery,actualRendition,conversion:'video'});
  await pending;
  expect(source.close).toHaveBeenCalledWith(expect.objectContaining({handle:'owned-a'}));
  expect((await repository.get(request.intentId)).desiredState).toBe('stopped');
});
```

Define the fake's deferred promise and full request in the test before use; use
fixed IDs and an injected clock so failures cannot depend on wall-clock timing.

- [ ] Run `npx vitest run backend/src/3_applications/content/playback` red.
- [ ] Invoke A0 using already-resolved metadata and the in-memory risk snapshot. For `play`, call openDefault without describe, readiness lookup, ffprobe or preparation; retain necessary ownership and ordinary provider negotiation. Do not reserve video conversion units for known direct/audio playback. Where the provider requires conversion, its normal decision supplies resource needs for admission without invoking the deeper assessment pipeline. For `assess`, deduplicate by intent/revision/profile, assess in background while a viable original plays, and select/prepare only when evidence justifies it.
- [ ] Implement transaction ordering: reserve needed capacity; persist opening intent and attemptId; call openDefault or open; CAS attach if generation still current; otherwise enqueue owned cleanup. Persist close intent before external close. Reconciliation uses findOwned after ambiguous opens. Replacement consumes the durable ledger once, closes old resource before reserving replacement by default, and maps media-element time through delivery.contentOriginMs. Only confirmed progress advances resume state. An incident deadline returns preparing/unavailable rather than waiting forever. Feed attributed outcomes and sustained successes to the risk repository asynchronously; do not teach codec rules from network/unknown failures.
- [ ] Run all new use-case tests green. Commit `feat(playback): orchestrate recoverable owned playback attempts`.

### Task A5: Client capabilities and one recovery authority

**Files:** Create `frontend/src/modules/Player/lib/clientPlaybackProfile.js`,
`frontend/src/modules/Player/hooks/usePlaybackAttempt.js`, matching tests;
modify `hooks/useMediaResilience.js`, `hooks/useCommonMediaController.js`,
`hooks/usePlaybackHealth.js`, `lib/recoveryLedger.js`, `renderers/VideoPlayer.jsx`,
`components/SinglePlayer.jsx`. Keep changes limited to the playback path.

**Interfaces:** `getClientPlaybackProfile({mediaCapabilities, mediaSource, rendererVersion})`
returns normalized ClientProfile plus capability evidence. `usePlaybackAttempt`
consumes `{intentId, client, tracks, transport, mediaElement}` and returns
`{delivery, status, report, seek, pause, stop}`. Transport calls A6 endpoints.

- [ ] Add tests for absent MediaCapabilities, false-positive support followed by decoder failure, bursty progress, remount, live seek window, paused recovery and simultaneous legacy watchdog signals. Example invariant:

```js
it('coalesces watchdog and decoder recovery into one request', async () => {
  report({sequence:1,failure:{kind:'decoder'}});
  report({sequence:2,failure:{kind:'unknown'}});
  await flushObservations();
  expect(transport.observe).toHaveBeenCalledTimes(1);
  expect(legacyHardReset).not.toHaveBeenCalled();
});
```

Use a hook harness with injected transport/media element to define report and
flushObservations; fake timers flush batching deterministically.

- [ ] Run `npx vitest run frontend/src/modules/Player/hooks/usePlaybackAttempt.test.jsx frontend/src/modules/Player/lib/clientPlaybackProfile.test.js` red.
- [ ] Reuse existing lightweight health signals; sample locally at 1s while active and piggyback normal summaries on existing heartbeat traffic. Report qualified interruption transitions and definitive errors immediately; normal playback must not incur one new assessment/network call per second. Apply A0 episode semantics across remounts. Expose intentional app pause separately from unexpected stalled progress. Use decoded-frame observations where supported; mark absent counters unknown. Adapt quality natively within the current manifest. When attempt mode is enabled, legacy URL-remount actors report to the coordinator instead of firing. Legacy mode retains its existing contract. Unmount closes best-effort; leases guarantee eventual reconciliation. Backend disconnection does not stop already-buffered playback or mint unowned conversions.
- [ ] Run tests green plus existing `useMediaResilience.*`, `useCommonMediaController.*`, `VideoPlayer.*` tests. Commit `feat(player): integrate adaptive attempt observations and recovery`.

### Task A6: API, composition, statuses and provider URL migration

**Files:** Create `backend/src/4_api/v1/routers/playbackAttempts.mjs` and tests;
`backend/src/5_composition/modules/adaptivePlayback.mjs` and tests;
modify composition `contentApi.mjs`, router `play.mjs`, application
`services/PlayResponseService.mjs`; create `frontend/src/modules/Player/components/PlaybackStatus.jsx`
and tests. Update `docs/reference/content/content-playback.md`.

**Interfaces:** POST `/api/v1/playback-attempts` opens/reuses client intent;
POST `/api/v1/playback-attempts/:intentId/observations` applies observation batch;
POST `/api/v1/playback-attempts/:intentId/seek` replaces position intentionally;
DELETE `/api/v1/playback-attempts/:intentId` closes. Responses use
`{intentId,generation,status,delivery?,reason?,progress?}`. Status is
`opening|playing|paused|recovering|preparing|unavailable|stopped`.

- [ ] Test request validation, ownership authorization, duplicate request IDs, old-client responses, no raw provider payloads and preparing/unavailable UI. Test no provider-specific offset/session mutation remains in PlayResponseService:

```js
it('passes an adapter delivery descriptor without rewriting its URL', () => {
  const response = service.toPlayResponse(item, null, {descriptor});
  expect(response.mediaUrl).toBe(item.mediaUrl);
});
```

Add adapter regression tests demonstrating old resume/session URL behavior still
works through the translated boundary; do not merely delete that behavior.

- [ ] Run router/composition/status tests red.
- [ ] Wire dependencies in composition, including injected clock/IDs/repository and scheduler cleanup. Validate surface ownership using existing identity/access service; reject forged intent IDs and invalid observations. Keep legacy GET play responses compatible. Generate opaque intent IDs per user selection, stable across remounts. Render “Preparing video”, actual progress, “Recovering playback”, or reason plus retry; never silently advance the queue on selected-film failure. Use framework logging with correlation fields and URL redaction.
- [ ] Run router/composition/frontend tests green, then index verification gates. Commit `feat(playback): expose adaptive playback flow and honest status`.

**Delivery A exit:** one real source and one distinct provider class play through
the full coordinated path with recorded recovery and cleanup. This demonstrates
integration, not final fleet acceptance. Continue to B.
