# Media Task 6 Salvage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Task 6 of the Media P0 plan (browser fleet rows with Pause/Stop, live-state TV ordering, scoped routine provenance, correlated duplicate ACKs) on current `main`, clearing the four review blockers, then close P0.

**Architecture:** Rebuild on current `main` by merging the rejected Task 6 commits (`480a3f9e3`) plus the unfinished repair, then fix each blocker with one RED → GREEN loop. The backend change swaps the inline client-message router in `backend/src/app.mjs` for the already-existing `ClientIngressService` via one composition function, guarded by a parity test. Frontend changes are local to `frontend/src/modules/Media/{fleet,externalControl,session}`.

**Tech Stack:** Node.js ESM, Express, `ws` WebSocketEventBus, React 18, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-28-media-task6-salvage-design.md`

## Global Constraints

- All work happens in `.worktrees/media-task6-salvage` on branch `media/task6-salvage`. Never touch `.worktrees/media-p0-remaining` except to copy files out of it.
- Never use bare `git stash`; the stash stack is shared across sessions.
- Structured logging only (`mediaLog`, `rootLogger`, injected `logger`); no raw `console.*`.
- A remote ACK proves receipt, not playback.
- Each task: failing test observed first, then implementation, then passing. After two failed fix hypotheses, stop and report to the orchestrator.
- Never run Playwright concurrently with another Playwright run or with the broad Vitest suite.
- Pre-commit runs architecture audits (`audit:fs`, `audit:layers`, `audit:links`, parse, SCSS, composition contracts); a commit that fails them is not done.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Budget ceiling ~3M tokens for the whole salvage (orchestrator tracks).

## Review Focus

1. **A household message kind that routed before the swap stops routing after it** (Home Line call signaling, fitness sensors, piano MIDI, BT pairing, kiosk launch, frontend logs). Expected: byte-identical broadcast topic and payload. Pinned by Task 1's parity table.
2. **`EventBusPlaybackStateRelay` attached twice** after the swap (once by `registerClientIngress`, once by the old line in `app.mjs`). Expected: exactly one attach; duplicated `device-state` relays would double fleet updates. Pinned by Task 1 source assertion.
3. **Frontend log ingestion receives `controlClientId` in its metadata** (the adapter's `clientMetadata` adds it; production passed only `{ ip, userAgent }`). Expected: ingestion metadata is exactly `{ ip, userAgent }`. Pinned by Task 1 parity row.
4. **A successful routine action loses its routine origin** because the origin is cleared before an async transition stamps it. Expected: the transition the routine caused carries `origin.kind === 'routine'`. Pinned by Task 3 positive test.
5. **A configured device with no live entry sorts as `unknown` rank 99 below an off device**, or a stale disconnected one shows its last `playing` forever. Expected: no-entry rows keep configured state; offline rows read `off`. Pinned by Task 2 tests.

---

### Task 0: Worktree and carry-over (orchestrator)

**Files:** none authored; merge + copy.

- [ ] **Step 1: Create worktree from current main**

```bash
cd /opt/Code/DaylightStation
git worktree add .worktrees/media-task6-salvage -b media/task6-salvage main
cd .worktrees/media-task6-salvage
git merge --no-ff 480a3f9e3 -m "merge: Task 6 (rejected checkpoint) onto current main for salvage"
```

- [ ] **Step 2: Copy the unfinished repair (not app.mjs)**

```bash
SRC=/opt/Code/DaylightStation/.worktrees/media-p0-remaining
for f in frontend/src/modules/Media/externalControl/commandHandler.js \
         frontend/src/modules/Media/externalControl/commandHandler.test.js \
         frontend/src/modules/Media/externalControl/useExternalControl.js \
         frontend/src/modules/Media/externalControl/useExternalControl.test.jsx \
         frontend/src/modules/Media/fleet/FleetProvider.jsx \
         frontend/src/modules/Media/fleet/browserLiveness.js \
         frontend/src/modules/Media/fleet/browserLiveness.test.js \
         frontend/src/modules/Media/session/LocalSessionController.js \
         tests/_lib/media-ordinary-device-fixture.mjs \
         tests/live/flow/media/media-app-browser-control.runtime.test.mjs \
         backend/src/5_composition/modules/clientIngress.mjs \
         backend/src/5_composition/modules/clientIngress.test.mjs; do
  diff -q "$SRC/$f" "$f" >/dev/null 2>&1 || cp "$SRC/$f" "$f"
done
```

Before copying, confirm for each file that `git diff 480a3f9e3 HEAD -- <file>` is empty after the merge (main did not change it since Task 6's base). Where it is not empty, apply `git -C $SRC diff -- <file>` hunks by hand instead of copying.

- [ ] **Step 3: Commit as unfinished**

```bash
git add -A && git commit -m "wip(media): carry over unfinished Task 6 repair (RED tests, partial fixes)"
```

`backend/src/app.mjs` is intentionally not carried over — Task 1 redoes it against current main.

---

### Task 1: Production client ingress with parity

**Files:**
- Modify: `backend/src/app.mjs` (the authorizer block ~L778–784, the inline `eventBus.onClientMessage` router ~L816–900, the BT relay ~L906, the kiosk relay ~L918, `new EventBusPlaybackStateRelay(...).attach()` ~L1544, and imports of `EventBusPlaybackStateRelay` / `ClientRelayPolicy`)
- Modify: `backend/src/5_composition/modules/clientIngress.mjs`
- Modify: `backend/src/1_adapters/eventbus/EventBusClientIngressAdapter.mjs` (only if parity requires)
- Modify: `backend/src/3_applications/eventbus/ClientIngressService.mjs` (only if parity requires)
- Test: `backend/src/5_composition/modules/clientIngress.test.mjs`

**Interfaces:**
- Produces: `registerClientIngress({ eventBus, getCallLeaseService, homelineSignaling, frontendLogIngestion, getFitnessPresence, logger }) → { ingress, publications, playbackStateRelay }`. Called exactly once by `app.mjs` and by `tests/_lib/media-ordinary-device-fixture.mjs` and the browser-control runtime test.
- `frontendLogIngestion` is `{ ingest(message, { ip, userAgent }, { onEvent }) }`; `app.mjs` passes `{ ingest: ingestFrontendLogs }`.

- [ ] **Step 1: Write the parity test (RED)**

Add to `clientIngress.test.mjs` a table-driven test using a fake bus that records calls, so each row is fast and deterministic:

```js
function fakeBus() {
  const calls = [];
  const handlers = { message: [], disconnect: [] };
  let subAuth = null; let msgAuth = null;
  return {
    calls,
    setClientSubscriptionAuthorizer: fn => { subAuth = fn; },
    setClientMessageAuthorizer: fn => { msgAuth = fn; },
    onClientDisconnection: fn => handlers.disconnect.push(fn),
    onClientMessage: fn => handlers.message.push(fn),
    broadcast: (topic, payload) => calls.push(['broadcast', topic, payload]),
    sendToClient: (id, payload) => calls.push(['send', id, payload]),
    getClientMeta: () => ({ ip: '10.0.0.5', userAgent: 'UA', clientId: 'ctl-1' }),
    subscribe: () => () => {}, // for EventBusPlaybackStateRelay; adjust to its real needs
    emit: (clientId, message) => handlers.message.forEach(h => h(clientId, message)),
    disconnect: clientId => handlers.disconnect.forEach(h => h(clientId)),
    get subAuth() { return subAuth; }, get msgAuth() { return msgAuth; },
  };
}

const ROWS = [
  ['fitness', { source: 'fitness', type: 'hr', v: 1 }, [['broadcast', 'fitness', { source: 'fitness', type: 'hr', v: 1 }]]],
  ['fitness-simulator', { source: 'fitness-simulator', x: 1 }, [['broadcast', 'fitness', { source: 'fitness-simulator', x: 1 }]]],
  ['piano midi', { source: 'piano', topic: 'midi', type: 'note_on', timestamp: 5, sessionId: 's', data: { n: 60 }, extra: 'dropped' },
    [['broadcast', 'midi', { source: 'piano', type: 'note_on', timestamp: 5, sessionId: 's', data: { n: 60 } }]]],
  ['piano midi invalid', { source: 'piano', topic: 'midi' }, []],
  ['homeline device topic', { topic: 'homeline:livingroom-tv', type: 'wake' }, [['broadcast', 'homeline:livingroom-tv', { topic: 'homeline:livingroom-tv', type: 'wake' }]]],
  ['homeline call topic', { topic: 'homeline-call:abc', type: 'offer' }, [['broadcast', 'homeline-call:abc', { topic: 'homeline-call:abc', type: 'offer' }]]],
  ['device-state', { topic: 'device-state', deviceId: 'tv', snapshot: { state: 'playing' }, ts: 't' },
    [['broadcast', 'device-state:tv', { deviceId: 'tv', snapshot: { state: 'playing' }, reason: 'change', ts: 't' }]]],
  ['device-ack', { topic: 'device-ack', deviceId: 'tv', commandId: 'c' }, [['broadcast', 'device-ack:tv', { topic: 'device-ack', deviceId: 'tv', commandId: 'c' }]]],
  ['bt relay', { topic: '<a real bt.* topic accepted by shouldRelayBtTopic>' }, 'relayed-once'],
  ['kiosk relay', { topic: '<a real topic accepted by shouldRelayKioskLaunchTopic>', deviceId: 'k' }, 'relayed-once'],
  ['unknown', { topic: 'nothing-here' }, []],
];
```

Rows marked `relayed-once` assert exactly one `['broadcast', topic, message]`. Read `backend/src/3_applications/eventbus/ClientRelayPolicy.mjs` for real accepted topics. For each row: `registerClientIngress({ eventBus: bus, logger: quiet })`, `bus.emit('c1', msg)`, then `expect(bus.calls).toEqual(expected)`.

Separate cases in the same file:
- **homeline-authorize:** with `getCallLeaseService: () => ({ authorize: vi.fn(() => ({ ok: true, lease: 'L' })) })`, emitting `{ type: 'homeline-authorize', topic: 'homeline-call:abc' }` yields exactly `[['send', 'c1', { type: 'homeline-authorize-ack', topic: 'homeline-call:abc', ok: true, lease: 'L' }]]`; with `getCallLeaseService: () => null` the ack body is `{ ok: false, code: 'LEASES_NOT_READY' }`.
- **authorizers:** `bus.subAuth('c1','fitness') === true`; `bus.subAuth('c1','homeline-call:x')` returns the lease service's `canSubscribe` result (false with no service); `bus.msgAuth('c1', { topic: 'homeline-call:x' })` returns `validateSignal`'s result or `{ ok: false, code: 'LEASES_NOT_READY' }`; `bus.msgAuth('c1', { topic: 'fitness' })` returns `{ ok: true, message }`.
- **disconnect:** `bus.disconnect('c1')` calls the lease service's `disconnect('c1')`.
- **logging:** with `frontendLogIngestion: { ingest: vi.fn() }` and `getFitnessPresence: () => ({ observe })`, emitting `{ topic: 'logging', events: [] }` calls `ingest` once with `(message, { ip: '10.0.0.5', userAgent: 'UA' }, { onEvent })` — metadata **exactly** those two keys — and `onEvent(x)` calls `observe(x)`. Same for `{ source: 'playback-logger' }`.
- **single composition:** extend the existing source test: `app.mjs` contains no `eventBus.onClientMessage((clientId, message) => {` block that tests `message.source === 'fitness'`, no `setClientSubscriptionAuthorizer`, no `new EventBusPlaybackStateRelay`, and exactly one `registerClientIngress({`.

Before writing rows, diff `git show 480a3f9e3:backend/src/app.mjs` against `main`'s `app.mjs` in the router region (~L780–930) and add a row for any branch `main` gained since.

- [ ] **Step 2: Run RED**

Run: `npx vitest run backend/src/5_composition/modules/clientIngress.test.mjs`
Expected: source-assertion test FAILS (app.mjs still inline); logging-metadata row FAILS (adapter adds `controlClientId`). Record any other failing row — each is a real parity gap.

- [ ] **Step 3: Implement**

In `app.mjs`: delete the authorizer block and the three inline `onClientMessage` handlers (router, BT relay, kiosk relay) and the `EventBusPlaybackStateRelay` attach + imports; at the authorizer block's position insert:

```js
  registerClientIngress({
    eventBus,
    getCallLeaseService: () => callLeaseService,
    frontendLogIngestion: { ingest: ingestFrontendLogs },
    getFitnessPresence: () => donowModule?.presence?.fitness,
    logger: rootLogger,
  });
```

Keep `let donowModule` / `let callLeaseService` declarations above it. Keep every other `onClientMessage` registration (pose log, CommandHandlerLivenessService, etc.) untouched.

In `ClientIngressService.handle`'s logging branch, pass only `{ ip, userAgent }`:

```js
      const { ip, userAgent } = this.publications.clientMetadata(clientId) ?? {};
      this.frontendLogIngestion?.ingest(message, { ip, userAgent }, {
        onEvent: (normalized) => this.getFitnessPresence()?.observe(normalized),
      });
```

Fix any other parity gap found in Step 2 in the service/adapter, not by special-casing the test.

- [ ] **Step 4: Run GREEN + broad**

```bash
npx vitest run backend/src/5_composition backend/src/3_applications/eventbus backend/src/1_adapters/eventbus
node -e "import('./backend/src/app.mjs').then(()=>console.log('app.mjs imports OK'))" 2>&1 | tail -2   # import smoke only if app.mjs has no side effects at import; otherwise rely on audit:links
npm run audit:links && npm run test:composition-contracts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app.mjs backend/src/5_composition/modules backend/src/3_applications/eventbus backend/src/1_adapters/eventbus tests/_lib/media-ordinary-device-fixture.mjs
git commit -m "fix(media): production composes the one client-ingress path the fixture proves"
```

---

### Task 2: Physical-device live state in the fleet

**Files:**
- Modify: `frontend/src/modules/Media/fleet/browserLiveness.js`
- Modify: `frontend/src/modules/Media/fleet/FleetProvider.jsx`
- Test: `frontend/src/modules/Media/fleet/browserLiveness.test.js`

**Interfaces:**
- Produces: `mergeCanonicalFleetState(devices: Array<{id,state?}>, entries: Map<id,{snapshot?:{state}, offline?:boolean}>) → Array<device & {state, displayState}>`.
- Consumes: `browserEntries` map already maintained by `FleetProvider` from `device-state:*` broadcasts; `sortFleetDevices`.

- [ ] **Step 1: Add tests (the carried-over merge/sort test plus these)**

```js
  it('keeps configured state for a device with no live entry and never ranks it above live ones', () => {
    const merged = mergeCanonicalFleetState([{ id: 'quiet', state: 'idle' }, { id: 'tv' }],
      new Map([['tv', { snapshot: { state: 'playing' }, offline: false }]]));
    expect(merged.find(d => d.id === 'quiet')).toMatchObject({ state: 'idle', displayState: 'idle' });
    expect(sortFleetDevices(merged).map(d => d.id)).toEqual(['tv', 'quiet']);
  });

  it('shows an offline device as off even if its last snapshot said playing', () => {
    const [row] = mergeCanonicalFleetState([{ id: 'tv' }], new Map([['tv', { snapshot: { state: 'playing' }, offline: true }]]));
    expect(row).toMatchObject({ state: 'off', displayState: 'off' });
  });

  it('does not mutate the configured device objects', () => {
    const devices = [{ id: 'tv', state: 'idle' }];
    mergeCanonicalFleetState(devices, new Map([['tv', { snapshot: { state: 'playing' } }]]));
    expect(devices[0]).toEqual({ id: 'tv', state: 'idle' });
  });
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run frontend/src/modules/Media/fleet`
Expected: any test that fails against the carried-over `mergeCanonicalFleetState` is a real defect; if all pass already, record "RED observed on 480a3f9e3" by running the merge/sort test against `git show 480a3f9e3:frontend/src/modules/Media/fleet/browserLiveness.js` (it lacks the export → fails).

- [ ] **Step 3: Implement / fix**

Adjust `mergeCanonicalFleetState` so rows without a live entry keep `device.state ?? 'unknown'` and set `displayState` to the same. `FleetProvider.jsx` uses the merged `configured` list (carried over). Confirm `FleetProvider` re-renders on `browserEntries` changes for non-browser ids (the entries map must be populated for configured device ids from `device-state:<id>`; if it only tracks `browser:*`, extend the subscription to configured ids).

- [ ] **Step 4: Run GREEN + broad**

Run: `npx vitest run frontend/src/modules/Media`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/fleet
git commit -m "fix(media): configured devices sort by their live state, not static config"
```

---

### Task 3: Routine provenance lives for one command

**Files:**
- Modify: `frontend/src/modules/Media/externalControl/commandHandler.js`
- Modify: `frontend/src/modules/Media/session/LocalSessionController.js`
- Test: `frontend/src/modules/Media/externalControl/commandHandler.test.js`

**Interfaces:**
- Consumes: controller `setOrigin(origin)`, `clearOrigin()`, `getSnapshot().meta.origin`.
- Produces: `applyWithOrigin(controller, origin, mutate)` (module-private) — origin staged before `mutate`, cleared after it settles (sync return, promise resolve, promise reject, throw).

- [ ] **Step 1: Add the positive tests next to the carried-over leak tests**

```js
  it('stamps a successful synchronous routine transport with the routine origin', () => {
    const controller = createLocalSessionController({ clientId: 'origin-owner' });
    const origin = { kind: 'routine', name: 'Breakfast', triggerId: 'daily-0700' };
    applyCommandEnvelope(controller, { ...env('config', { setting: 'volume', value: 30 }), origin });
    expect(controller.getSnapshot().meta.origin).toEqual(origin);
  });

  it('stamps a successful async routine item action with the routine origin', async () => {
    const controller = createLocalSessionController({ clientId: 'origin-owner' });
    const origin = { kind: 'routine', name: 'Breakfast', triggerId: 'daily-0700' };
    const realExecute = controller.execute;
    controller.execute = vi.fn(async (p) => { await Promise.resolve(); return realExecute(p); });
    await applyCommandEnvelope(controller, { ...env('queue', {
      op: 'item-action', operationId: 'ok-1', kind: 'playNow', item: { contentId: 'plex:1' }, tappedAt: Date.now(),
    }), origin });
    expect(controller.getSnapshot().meta.origin).toEqual(origin);
  });
```

Adjust `env(...)` shapes to the helper already defined in the test file and the controller's real item-action contract (read `LocalSessionController.execute`).

- [ ] **Step 2: Run RED**

Run: `npx vitest run frontend/src/modules/Media/externalControl/commandHandler.test.js`
Expected: the leak tests fail on `480a3f9e3`'s handler; the async positive test is the one most likely to fail on the carried-over repair if the transition is stamped after `clearOrigin`.

- [ ] **Step 3: Implement / fix**

Keep `applyWithOrigin`. If the async positive test fails, change the controller so the staged origin is captured by the operation at call time rather than read from `pendingOrigin` at transition time: in `LocalSessionController`, when an operation starts (`execute`, `undo`, transport, queue, config, adoptSnapshot) capture `const opOrigin = pendingOrigin` and stamp transitions that operation produces with `opOrigin`; `clearOrigin()` then only resets `pendingOrigin`.

- [ ] **Step 4: Run GREEN + broad**

Run: `npx vitest run frontend/src/modules/Media`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/externalControl frontend/src/modules/Media/session
git commit -m "fix(media): routine provenance lives for one command and never leaks to the next"
```

---

### Task 4: Duplicate commands correlate to their own ID

**Files:**
- Modify: `frontend/src/modules/Media/externalControl/useExternalControl.js`
- Test: `frontend/src/modules/Media/externalControl/useExternalControl.test.jsx`
- Test: `tests/live/flow/media/media-app-browser-control.runtime.test.mjs` (carried over; runs in Task 6 gate)

**Interfaces:**
- Produces: per-hook `commandResults: Map<commandId, { value, result: Promise }>` bounded to 256 (oldest evicted). A repeat `commandId` replays the stored result with `{ persist: false }` and ACKs with that same `commandId`. Routine dedupe (`routineTriggers`, 10s window, persisted triggers) ACKs the duplicate under **its own** `commandId` and records it in `commandResults`.

- [ ] **Step 1: Add tests alongside the carried-over duplicate test**

```js
  it('replays an identical commandId without re-executing, even for human origin', () => {
    const { unmount } = renderHook(() => useExternalControl(controller));
    const msg = { topic: 'client-control:live-1', replyToControlClientId: 'caller-live', commandId: 'h-1',
      command: 'transport', params: { action: 'pause' }, origin: { kind: 'device', id: 'browser:x' } };
    act(() => { capturedCallback(msg); capturedCallback(msg); });
    expect(controller.transport.pause).toHaveBeenCalledOnce();
    expect(sendFn.mock.calls.map(([m]) => [m.commandId, m.ok])).toEqual([['h-1', true], ['h-1', true]]);
    unmount();
  });

  it('evicts the oldest cached result past 256 commands', () => {
    const { unmount } = renderHook(() => useExternalControl(controller));
    const msg = id => ({ topic: 'client-control:live-1', replyToControlClientId: 'c', commandId: id,
      command: 'transport', params: { action: 'pause' } });
    act(() => { for (let i = 0; i <= 256; i += 1) capturedCallback(msg(`c-${i}`)); });
    act(() => capturedCallback(msg('c-0')));
    expect(controller.transport.pause).toHaveBeenCalledTimes(258);
    unmount();
  });

  it('acks a rejected command replay with the same failure, not success', () => {
    controller.transport.pause.mockImplementation(() => { throw new Error('no-media'); });
    const { unmount } = renderHook(() => useExternalControl(controller));
    const msg = { topic: 'client-control:live-1', replyToControlClientId: 'c', commandId: 'r-1',
      command: 'transport', params: { action: 'pause' } };
    act(() => { capturedCallback(msg); capturedCallback(msg); });
    expect(sendFn.mock.calls.map(([m]) => m.ok)).toEqual([false, false]);
    unmount();
  });
```

Use the `controller`/`sendFn`/`capturedCallback` fixtures already defined in the test file; adapt `controller.transport.pause` to however that fixture exposes transport mocks.

- [ ] **Step 2: Run RED**

Run: `npx vitest run frontend/src/modules/Media/externalControl/useExternalControl.test.jsx`
Expected: the carried-over duplicate test fails on `480a3f9e3`'s hook (duplicate ACKs with original id). Record which new tests fail on the carried-over repair.

- [ ] **Step 3: Implement / fix**

Keep the carried-over `remember`/`replay` structure. Ensure the error path stores `{ ok: false, reason }` (not success), the eviction uses `Map` insertion order, and `mediaLog.externalControlRejected({ commandId, reason })` still fires on a thrown command (the repair dropped it — restore it).

- [ ] **Step 4: Run GREEN + broad**

Run: `npx vitest run frontend/src/modules/Media`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Media/externalControl
git commit -m "fix(media): duplicate commands ACK under their own id and replay the original result"
```

---

### Task 5: Independent review (fresh Fable agent)

Review `main..media/task6-salvage` against the four blockers in `docs/_wip/hand-offs/2026-09-22-media-p0-handoff.md` §"Review blockers", the spec, and this plan's Review Focus. Must explicitly state per blocker: cleared / not cleared, with file:line evidence. Parity completeness: compare the deleted `app.mjs` router line by line against `ClientIngressService` + adapter. Findings go back to a fix implementer (max 5 rounds).

### Task 6: Exact-SHA certification (orchestrator)

- [ ] Clean tree; `SHA=$(git rev-parse HEAD)`; `EVID=/tmp/daylight-media-p0-evidence/$SHA/task6-salvage`; `mkdir -p $EVID`.
- [ ] Start the owned acceptance server per the header of `tests/live/flow/media/media-app-browser-control.runtime.test.mjs` and `tests/_lib/media-redesign-server.mjs` (production `--build` + preview), record its URL.
- [ ] Broad Vitest first (not concurrently with Playwright): `npx vitest run frontend/src/modules/Media backend/src/1_adapters/eventbus backend/src/3_applications/eventbus backend/src/5_composition shared/contracts/media`.
- [ ] `BASE_URL=<owned url> MEDIA_P0_EVIDENCE_DIR=$EVID npm run test:media-p0` (read `scripts/media-p0-gate.mjs` for exact env names). Bar: 25 stories / 54 criteria, 0 skipped/failed, stable core included.
- [ ] Stop the server.

### Task 7: Merge and deploy (orchestrator)

- [ ] `cd /opt/Code/DaylightStation && git merge --no-ff media/task6-salvage` (main checkout clean; if `main` moved, re-run Task 6's broad Vitest on the merge).
- [ ] `./scripts/deploy-gate.sh` (exit 1 halts) → `./scripts/build-daylight.sh` → `./scripts/deploy-gate.sh && sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight` (one chained command).
- [ ] Verify: `curl -s localhost:3111/build.txt` shows the merged SHA; `/media` 200; container healthy; log store over 10 min after deploy shows `fitness`/`midi`/`homeline` traffic continuing (when devices active) and zero `eventbus.*.invalid` spikes.

### Task 8: Close-out

- [ ] Records: `docs/_wip/plans/2026-09-14-media-app-acceptance-ledger.md`, `docs/_wip/refactors/2026-09-14-media-app-redesign.md` status + "What has actually happened", `.superpowers/sdd/2026-09-21-media-remaining-p0-on-stable-core/progress.md` (Task 6 line corrected to cite this salvage; Tasks 7–8 deferred), `docs/superpowers/plans/2026-09-21-media-remaining-p0-on-stable-core.md` header note (Tasks 7–8 deferred, not scheduled, briefs linked), `docs/reference/media/media-app.md` (fleet live ordering, browser control path, routine origin, duplicate ACK). Move `docs/_wip/hand-offs/2026-09-22-media-p0-handoff.md` → `docs/_archive/hand-offs/`.
- [ ] Cleanup (never lose work): for each `git worktree list` entry under `/tmp/daylight-media-*`, `.worktrees/media-redesign`, `.worktrees/media-p0-remaining`, `.worktrees/media-task6-salvage`: if clean and HEAD ⊂ main → `git worktree remove`; else, if dirty, commit everything in that worktree as `wip(archive): <name> uncommitted state` (use `--no-verify` only there, since it is an archive of unfinished work), tag `archive/media/<name>-2026-09-28` at the resulting HEAD, then `git worktree remove --force`. Branches `feat/media-redesign`, `release/media-stable-core`, `feat/media-redesign-batch-1`, `media/p0-remaining`, `media/task6-salvage`: log each in `docs/_archive/deleted-branches.md`, tag unmerged ones, then delete.
- [ ] `git worktree prune`; commit docs.
