# Media Remaining P0 on Stable Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete and end-to-end accept every remaining P0 criterion while preserving the deployed 11-story stable core after every independently deployable batch.

**Architecture:** Treat deployed commit `baad78be05f7e3b1c9bb208a81c38cd72d09d0d7` as the immutable starting baseline and deliver eight dependency-ordered batches. Each batch begins in its own worktree, proves its target criteria RED through ordinary browser input, makes the smallest controller/API/UI changes, then runs both its new journeys and the stable-core manifest before merge and deployment.

**Tech Stack:** React 18, Vitest, Playwright, Node.js ESM, Express, WebSocket EventBus, shared media contracts, Docker deployment gates.

**Spec:** `docs/_wip/plans/2026-09-14-media-app-redesign-requirements.md`, with story criteria in `docs/_wip/plans/2026-09-14-media-app-acceptance-ledger.md` and ownership in `docs/_wip/plans/2026-09-14-media-app-story-implementation-map.md`.

## Global Constraints

- The stable-core manifest remains 11 fully accepted stories / 32 accepted criteria / 1 supporting partial story until newly accepted criteria are added with exact runtime evidence.
- A story is accepted only after user input → target → command → actual player/result → returned state → displayed feedback passes end to end; unit tests alone never accept a story.
- Demonstrate a behavioral RED before implementation. Do not manufacture RED by changing assertions or bypassing UI with synthetic JavaScript clicks.
- Use ordinary pointer, keyboard, and touch-sized browser input at phone `390×844`, tablet `820×1180`, and laptop `1440×900` when a criterion promises size parity.
- Office is the only physical test screen authorized. Use the isolated ordinary-device fixture for all other receiver paths and never command household screens.
- Preserve one bridge-owned local media node across navigation, expansion, and controls. Content modules must not import Media modules.
- Minimum P0 undo lasts 10 seconds from the original tap, cancels pending delivery, restores applied state only if no newer playback owns the screen, and returns live media to live edge.
- Aim and steering target remain separate. Opening Remote or controls never mutates aim.
- A remote ACK proves receipt, not playback. Success requires matching receiver state and native media evidence.
- Use structured logging; do not add raw console calls.
- Every batch updates `docs/reference/media/media-app.md`, the acceptance ledger, and the refactor status with factual evidence only.
- Every batch is committed, independently reviewed, exact-SHA built, stable-core-regressed, merged to `main`, gated, and deployed before the next batch starts.

## Remaining P0 Inventory

The 47 unfinished stories containing P0 work are:

- Pure P0 (34): `FIND.1a`, `FIND.3a`, `FIND.4a`, `FIND.5a`, `FIND.6a`, `FIND.8a`, `FIND.8b`, `PLAY.1a`, `PLAY.2a`, `PLAY.3a`, `PLAY.5a`, `PLAY.6a`, `PLAY.7a`, `PLACE.1a`, `PLACE.2a`, `PLACE.3a`, `PLACE.5a`, `PLACE.6a`, `PLACE.7a`, `PLACE.8a`, `STEER.3a`, `STEER.4a`, `STEER.5a`, `STEER.8a`, `STEER.9a`, `HOUSE.3a`, `RELY.1a`, `RELY.2a`, `RELY.3a`, `RELY.5a`, `RELY.6a`, `RELY.8a`, `AUTO.2a`, `AUTO.3a`.
- P0 with later criteria (8): `STEER.1a`, `STEER.1b`, `STEER.6a`, `STEER.7a`, `HOUSE.2a`, `HOUSE.4a`, `RELY.7a`, `AUTO.1b`.
- Cross-cutting P0 with later scope (5): `RELY.11a`, `RELY.12a`, `RELY.13a`, `RELY.14a`, `AUTO.1a`.

Only the P0 criteria are release-blocking here. Mixed-phase stories remain partial when their P1/P2 criteria are intentionally deferred.

## File and Interface Boundaries

| Unit | Primary files | Stable interface produced |
|---|---|---|
| Acceptance tooling | `scripts/media-stable-core-gate.mjs`, new `scripts/media-p0-gate.mjs`, `tests/unit/tooling/` | Fail-closed story/criterion manifest and serial exact-SHA journeys |
| Aim | `frontend/src/modules/Media/cast/`, `identity/`, `fleet/` | `useAim(): { aim, setAim, touchAim, resetAim }` and visible `AimLabel` |
| Item actions | `frontend/src/modules/Media/search/`, `browse/`, `session/queueOps.js` | One `ItemAction` request and aim-aware executor |
| Queue/undo | `LocalSessionController.js`, `RemoteSessionController.js`, shared contracts, screen action handlers | Owner-issued queue revisions and operation-scoped undo token |
| Search/browse | `MediaContentSearch.jsx`, `SearchMode.jsx`, Content combobox, browse hooks | One query lifecycle and common result action props |
| Controls | `MiniPlayer.jsx`, `NowPlayingView.jsx`, `QueuePanel.jsx`, transport/seek controls | Controller-conformant local/remote controls |
| House/identity | `FleetProvider.jsx`, `ClientIdentityProvider.jsx`, backend EventBus/device services | Stable routable browser identity, canonical state, origin and liveness |
| Outcomes/recovery | dispatch reducer/provider/tray, persistence/nav/reset files | Attempt-keyed outcome records and safe paused restore |

## Review Focus

1. A late ACK after Undo or a newer Play must not start or restore obsolete playback; Tasks 3 and 7 test operation identity at the actual owner.
2. Disconnecting an idle browser must become uncertain after 2 minutes without being called Off while still connected; Task 6 tests heartbeat and close paths.
3. Same-title queue generations must remain distinct when jumping, undoing, or retrying; Task 3 tests `queueItemId`, revision, position, and native source.
4. Search failure plus zero matches must show failure before widening and must not look like loading; Task 4 tests mixed source completion orders.
5. Large text, reduced motion, phone overlays, and unavailable capabilities must retain every action without overlap or color-only meaning; Task 8 tests computed layout and ordinary interaction.

---

### Task 1: Freeze the Stable-Core Extension Gate

**Stories:** infrastructure for all batches; no story accepted by this task.

**Files:**
- Create: `scripts/media-p0-gate.mjs`
- Create: `tests/unit/tooling/mediaP0Gate.test.mjs`
- Modify: `package.json`
- Modify: `docs/_wip/plans/2026-09-14-media-app-acceptance-ledger.md`

**Interfaces:**
- Consumes: `ACCEPTED_STORIES`, `SUPPORTING_ACCEPTED_CRITERIA`, and `validateReport` from `scripts/media-stable-core-gate.mjs`.
- Produces: `validateP0Manifest(entries)`, `runP0Gate({ env })`, and `npm run test:media-p0`; manifests add criteria but may never remove or weaken the stable-core entries.

- [ ] **Step 1: Create an isolated worktree from the deployed baseline**

```bash
git status --porcelain
git rev-parse HEAD
git worktree add -b media/p0-batch-0-gate .worktrees/media-p0-batch-0 baad78be05f7e3b1c9bb208a81c38cd72d09d0d7
```

Expected: source status is empty, the SHA is exact, and the new worktree is clean.

- [ ] **Step 2: Write fail-closed RED tests**

```js
it('retains every deployed stable-core criterion', () => {
  expect(() => validateP0Manifest([])).toThrow(/missing FIND\.1b\/AC1/);
});

it('rejects skips, duplicate criteria and evidence without a journey', () => {
  expect(() => validateP0Manifest([...BASE, BASE[0]])).toThrow(/duplicate/);
  expect(() => validateP0Manifest([...BASE, { story: 'FIND.1a', criteria: ['FIND.1a/AC1'] }]))
    .toThrow(/journey/);
  expect(() => validateReport({ suites: [{ specs: [{ tests: [{ status: 'skipped' }] }] }] }))
    .toThrow(/skipped/);
});
```

- [ ] **Step 3: Run RED**

```bash
npx vitest run tests/unit/tooling/mediaP0Gate.test.mjs
```

Expected: fail because `scripts/media-p0-gate.mjs` does not exist.

- [ ] **Step 4: Implement an additive manifest**

```js
export function validateP0Manifest(entries) {
  const criteria = new Set();
  for (const entry of [...ACCEPTED_STORIES, ...SUPPORTING_ACCEPTED_CRITERIA, ...entries]) {
    if (!entry.file || !entry.grep) throw new Error(`journey required for ${entry.story}`);
    for (const criterion of entry.criteria) {
      if (criteria.has(criterion)) throw new Error(`duplicate ${criterion}`);
      criteria.add(criterion);
    }
  }
  return { criteria: criteria.size };
}
```

`runP0Gate` must group identical `{ file, grep }`, execute Playwright serially with JSON output, call `validateReport`, and write reports under `MEDIA_P0_EVIDENCE_DIR`. The initial exported extension list is empty, so this command first proves the deployed stable core unchanged.

- [ ] **Step 5: Run GREEN and the original gate unit tests**

```bash
npx vitest run tests/unit/tooling/mediaP0Gate.test.mjs tests/unit/tooling/mediaStableCoreGate.test.mjs
```

Expected: all tests pass with zero skips.

- [ ] **Step 6: Commit**

```bash
git add scripts/media-p0-gate.mjs tests/unit/tooling/mediaP0Gate.test.mjs package.json docs/_wip/plans/2026-09-14-media-app-acceptance-ledger.md
git commit -m "test(media): extend stable core with fail-closed P0 gate"
```

### Task 2: Close the Existing Aim and Transport Partials

**Stories:** complete P0 for `PLACE.2a`, `STEER.3a`, `STEER.4a`, `PLAY.6a`; preserve mixed `STEER.6a` and `STEER.7a` as partial after their P0 criteria pass.

**Files:**
- Modify: `frontend/src/modules/Media/cast/aimLifetime.js`
- Modify: `frontend/src/modules/Media/cast/CastTargetProvider.jsx`
- Modify: `frontend/src/modules/Media/peek/RemoteSessionController.js`
- Modify: `frontend/src/modules/Media/session/queueOps.js`
- Modify: `frontend/src/modules/Media/shell/TransportBar.jsx`
- Modify: `frontend/src/modules/Media/shell/SeekBar.jsx`
- Modify: `frontend/src/modules/Media/shell/MiniPlayer.jsx`
- Modify tests beside every file above
- Modify: `tests/live/flow/media/media-app-aim-persistence.runtime.test.mjs`
- Modify: `tests/live/flow/media/media-app-remote-controls.runtime.test.mjs`

**Interfaces:**
- Consumes: deployed aim persistence and controller conformance.
- Produces: `skipPrev` means previous queue entry, while restart-current remains a separately named command; remote and local seek expose `{ seekable, live, reason }`; Add returns the resulting ordinal and queue revision.

- [ ] **Step 1: Add RED tests for the known junction failures**

```js
it('STEER.3a Previous selects the prior queue item rather than restarting current', async () => {
  const controller = makeRemoteController({ currentIndex: 1, queue: [arrival, disclosure] });
  await controller.skipPrev();
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ command: 'skipPrev' }));
  expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'seekAbs', position: 0 }));
});

it('PLACE.2a does not expire an aim while matching sent playback remains active', () => {
  expect(resolveAimExpiry({ idleMs: TWO_HOURS + 1, matchingPlaybackActive: true })).toBe(false);
});
```

- [ ] **Step 2: Run focused RED**

```bash
npx vitest run frontend/src/modules/Media/{cast/aimLifetime,peek/RemoteSessionController,session/queueOps,shell/TransportBar,shell/SeekBar,shell/MiniPlayer}.test.{js,jsx}
```

Expected: Previous/restart and remaining criterion tests fail for behavioral reasons.

- [ ] **Step 3: Separate queue navigation from restart and return authoritative state**

```js
async skipPrev() { return this.#send('skipPrev'); }
async restartCurrent() { return this.#send('seekAbs', { position: 0 }); }
async add(input) {
  const result = await this.#send('queueAdd', { input });
  return { queueRevision: result.queueRevision, ordinal: result.currentQueue.length };
}
```

Wire unavailable live seeking to visible copy rather than a no-op. Keep Stop queue retention accessible from `MiniPlayer` in `ready` state.

- [ ] **Step 4: Run focused GREEN**

```bash
npx vitest run frontend/src/modules/Media/cast/aimLifetime.test.js frontend/src/modules/Media/peek/RemoteSessionController.test.js frontend/src/modules/Media/session/queueOps.test.js frontend/src/modules/Media/shell/TransportBar.test.jsx frontend/src/modules/Media/shell/SeekBar.test.jsx frontend/src/modules/Media/shell/MiniPlayer.test.jsx
```

- [ ] **Step 5: Run exact browser journeys**

```bash
BASE_URL="$OWNED_BASE_URL" npx playwright test \
  tests/live/flow/media/media-app-aim-persistence.runtime.test.mjs \
  tests/live/flow/media/media-app-remote-controls.runtime.test.mjs \
  --workers=1 --reporter=line
```

Expected: aim remains visible/persistent until its correct expiry, Previous and Next change actual receiver queue items, seek changes native time, Add preserves playback and reports the correct position, Stop leaves queue reachable.

- [ ] **Step 6: Extend the P0 manifest and commit**

Add only criterion entries proven by the preceding exact reports, then:

```bash
git add frontend/src/modules/Media tests/live/flow/media scripts/media-p0-gate.mjs docs/reference/media/media-app.md docs/_wip/plans/2026-09-14-media-app-acceptance-ledger.md
git commit -m "fix(media): close aim and transport P0 junctions"
```

### Task 3: Establish One Item-Action, Queue, and Undo Contract

**Stories:** `PLAY.1a`, `PLAY.2a`, `PLAY.3a`, `PLAY.5a`, `PLAY.6a`, `PLAY.7a`, `PLACE.3a`, `FIND.8a`, `FIND.8b`, `STEER.8a`, `STEER.9a`, and the P0 dependency of `RELY.4a`.

**Files:**
- Create: `frontend/src/modules/Media/actions/itemAction.js`
- Create: `frontend/src/modules/Media/actions/itemAction.test.js`
- Create: `frontend/src/modules/Media/session/undoLedger.js`
- Create: `frontend/src/modules/Media/session/undoLedger.test.js`
- Modify: search/browse result and detail action owners
- Modify: local and remote session controllers, queue panel, shared command contracts and screen handlers
- Modify: `tests/live/flow/media/media-app-queue-journey.runtime.test.mjs`

**Interfaces:**
- Produces `executeItemAction({ kind, item, collectionItems, destination, operationId, options })` where `kind` is `playNow | shuffle | playNext | playFirst | add | playOn | addOn | details`.
- Produces `UndoRecord = { operationId, targetId, priorSnapshot, appliedRevision, expiresAt, status }` and `undo(operationId)`.

- [ ] **Step 1: Write table-driven RED tests for every verb**

```js
it.each([
  ['playNow', false, 'keep tail'], ['shuffle', true, 'replace shuffled'],
  ['playNext', false, 'FIFO next band'], ['playFirst', false, 'front'],
  ['add', false, 'append'],
])('%s has one local and remote meaning', async (kind, clearRest) => {
  await executeItemAction({ kind, item, destination: remote, operationId: 'op-1' });
  expect(remote.execute).toHaveBeenCalledWith(expect.objectContaining({ kind, clearRest, operationId: 'op-1' }));
});
```

Add REDs for collection natural order, duplicate pending Play, same-title `queueItemId` generations, unsupported receiver reason, undo before ACK, undo after ACK, expiry at tap+10s, late delivery, newer playback, and live edge.

- [ ] **Step 2: Run RED**

```bash
npx vitest run frontend/src/modules/Media/actions/itemAction.test.js frontend/src/modules/Media/session/undoLedger.test.js frontend/src/modules/Media/session/queueOps.test.js
```

- [ ] **Step 3: Implement the minimal common contract**

```js
export const ITEM_ACTIONS = Object.freeze(['playNow','shuffle','playNext','playFirst','add','playOn','addOn','details']);
export function createOperationId(crypto = globalThis.crypto) { return crypto.randomUUID(); }
```

Content components receive additive `onAction(action)` props; they must not import this Media module. The playback owner compares `operationId` and `appliedRevision` before undoing. Queue replacement captures a native position before mutation.

- [ ] **Step 4: Run GREEN and receiver contract tests**

```bash
npx vitest run frontend/src/modules/Media/actions frontend/src/modules/Media/session frontend/src/modules/Media/search frontend/src/modules/Media/browse frontend/src/modules/Media/shell/QueuePanel.test.jsx shared/contracts/media
npx vitest run frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx frontend/src/screen-framework/commands/useScreenCommands.test.jsx
```

- [ ] **Step 5: Run ordinary-input queue acceptance**

```bash
BASE_URL="$OWNED_BASE_URL" npx playwright test tests/live/flow/media/media-app-queue-journey.runtime.test.mjs --workers=1 --reporter=line
```

Expected: menus open without resuming playback or clearing search; every verb mutates the actual owner; same-title jumps start the selected generation at zero; Undo survives pending/applied timing and never replaces newer playback.

- [ ] **Step 6: Extend manifest and commit**

```bash
git add frontend/src/modules/Media frontend/src/modules/Content frontend/src/screen-framework shared/contracts/media tests/live/flow/media scripts/media-p0-gate.mjs docs/reference/media/media-app.md docs/_wip/plans/2026-09-14-media-app-acceptance-ledger.md
git commit -m "feat(media): unify item actions queues and minimum undo"
```

### Task 4: Finish One Search and Browse System

**Stories:** `FIND.1a`, `FIND.3a`, `FIND.4a`, `FIND.5a`, `FIND.6a`, plus search/browse criteria in `FIND.8a` and `FIND.8b`.

**Files:**
- Modify: `frontend/src/hooks/useStreamingSearch.js`
- Modify: `frontend/src/modules/Content/combobox/`
- Modify: `frontend/src/modules/Media/search/`
- Modify: `frontend/src/modules/Media/browse/`
- Modify: search/browse Playwright journeys

**Interfaces:**
- Consumes Task 3 `onAction` contract.
- Produces one `SearchState = { query, scope, sources, results, phase, failedSources }`; `phase` is exactly `idle | loading | partial | complete | failed`.

- [ ] **Step 1: Write RED lifecycle and navigation tests**

```jsx
it('reports failed sources before widening a zero-result scoped search', async () => {
  renderSearch({ scope: 'audiobook', sources: { plex: 'failed', files: 'complete' }, results: [] });
  expect(await screen.findByText('Plex did not answer')).toBeVisible();
  expect(screen.getByText('From everything')).toBeVisible();
  expect(screen.queryByText('Still searching')).toBeNull();
});
```

Add REDs for preserving query/scope after each action, closing to exact prior route/scroll/focus, All on new open, pagination, breadcrumb parents, natural collection order, and pictures/placeholders.

- [ ] **Step 2: Run RED**

```bash
npx vitest run frontend/src/hooks/useStreamingSearch.test.jsx frontend/src/modules/Content/combobox frontend/src/modules/Media/search frontend/src/modules/Media/browse
```

- [ ] **Step 3: Implement the single lifecycle**

Remove divergent Media/Content status calculations. Reducer transitions must ignore stale query generations and retain completed source failures. Search action completion must not close the surface. Browse history stores `{ path, scrollTop, focusedId }` per entry.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run frontend/src/hooks/useStreamingSearch.test.jsx frontend/src/modules/Content/combobox frontend/src/modules/Media/search frontend/src/modules/Media/browse --maxWorkers=2
```

- [ ] **Step 5: Run the browser matrix**

```bash
BASE_URL="$OWNED_BASE_URL" npx playwright test \
 tests/live/flow/media/media-app-search-journey.runtime.test.mjs \
 tests/live/flow/media/media-app-search-lifecycle.runtime.test.mjs \
 tests/live/flow/media/media-app-search-recovery.runtime.test.mjs \
 tests/live/flow/media/media-app-search-states.runtime.test.mjs \
 tests/live/flow/media/media-app-browse-breadcrumb.runtime.test.mjs \
 --workers=1 --reporter=line
```

- [ ] **Step 6: Extend manifest and commit**

```bash
git add frontend/src/hooks/useStreamingSearch* frontend/src/modules/Content/combobox frontend/src/modules/Media/search frontend/src/modules/Media/browse tests/live/flow/media scripts/media-p0-gate.mjs docs/reference/media/media-app.md docs/_wip/plans/2026-09-14-media-app-acceptance-ledger.md
git commit -m "feat(media): finish unified search and browse P0"
```

### Task 5: Make Aim, Controls, and Moves Truthful and Failure-Safe

**Stories:** `PLACE.1a`, `PLACE.5a`, `PLACE.6a`, `PLACE.7a`, `PLACE.8a`, `STEER.1a` P0, `STEER.1b` P0, `STEER.5a`, `STEER.6a` P0, `STEER.7a` P0.

**Files:**
- Create: `frontend/src/modules/Media/cast/AimLabel.jsx` and test
- Modify: aim provider/consumers, handoff/takeover executor, session controllers
- Modify: mini/full/remote controls and queue access
- Modify: backend handoff services and shared contracts only where owner confirmation is missing
- Modify: move/control Playwright journeys

**Interfaces:**
- Produces `MoveRequest { operationId, sourceOwnerId, sourceRevision, destinationId, snapshot, keepSource }`.
- Produces `MoveResult { status: 'adopted'|'rejected'|'uncertain', destinationRevision?, reason? }`.
- Source Stop is conditional on the unchanged `{ sourceOwnerId, sourceRevision }` and occurs only after `adopted`.

- [ ] **Step 1: Write REDs for visible aim and failed moves**

```js
it('does not stop source when destination playback fails', async () => {
  destination.adopt.mockResolvedValue({ status: 'rejected', reason: 'MEDIA_ERROR' });
  await move(request);
  expect(source.stop).not.toHaveBeenCalled();
});

it('does not stop newer source playback after a late adoption', async () => {
  source.revision = request.sourceRevision + 1;
  destination.adopt.mockResolvedValue({ status: 'adopted', destinationRevision: 9 });
  await move(request);
  expect(source.stop).not.toHaveBeenCalled();
});
```

Add REDs for AimLabel at every verb, busy origin, stop/keep choice, identical local/remote layouts, unsupported speed reason, ready queue, and no duplicate full controls.

- [ ] **Step 2: Run RED**

```bash
npx vitest run frontend/src/modules/Media/cast frontend/src/modules/Media/peek frontend/src/modules/Media/controller frontend/src/modules/Media/shell
```

- [ ] **Step 3: Implement conditional handoff and common controls**

Do not stop on envelope ACK. Wait for destination state naming `operationId`, queue identity, item identity, and an advancing/paused native state. Bind both local and remote controls to `useSessionController(target)` and render unavailable reasons from capabilities.

- [ ] **Step 4: Run GREEN and backend gates**

```bash
npx vitest run frontend/src/modules/Media/cast frontend/src/modules/Media/peek frontend/src/modules/Media/controller frontend/src/modules/Media/shell
npm run audit:layers
npm run test:composition-contracts
```

- [ ] **Step 5: Run browser acceptance**

```bash
BASE_URL="$OWNED_BASE_URL" npx playwright test \
 tests/live/flow/media/media-app-move-safety.runtime.test.mjs \
 tests/live/flow/media/media-app-handoff-picker.runtime.test.mjs \
 tests/live/flow/media/media-app-unavailable-controls.runtime.test.mjs \
 tests/live/flow/media/media-app-stop-flow.runtime.test.mjs \
 --workers=1 --reporter=line
```

- [ ] **Step 6: Extend manifest and commit**

```bash
git add frontend/src/modules/Media backend/src shared/contracts/media tests/live/flow/media scripts/media-p0-gate.mjs docs/reference/media/media-app.md docs/_wip/plans/2026-09-14-media-app-acceptance-ledger.md
git commit -m "feat(media): make aim controls and moves failure-safe"
```

### Task 6: Complete House Identity, Liveness, Origin, and Routine Safety

**Stories:** `HOUSE.2a` P0, `HOUSE.3a`, `HOUSE.4a` P0, `AUTO.1a` P0, `AUTO.1b` P0, `AUTO.2a`, `AUTO.3a`, and the P0 identity dependency of `RELY.14a`.

**Files:**
- Modify: Media identity/fleet providers and views
- Modify: EventBus client ingress/media ingress and device session services
- Modify: shared media envelopes/topics/shapes
- Modify: screen publishers and control registration
- Modify: fleet/browser-control runtime journeys

**Interfaces:**
- Browser identity is `{ clientId, deviceId, name, room?, connectedAt }`, persisted across reload.
- Canonical state carries `{ deviceId, ownerId, revision, origin, state, currentItem, queue, lastHeardAt }`.
- Trigger dedupe key is `{ triggerId || hash(content,target,kind), targetId }` for a 10-second window.

- [ ] **Step 1: Write RED identity/liveness tests**

```js
it('marks a silent disconnected browser uncertain after two minutes, not immediately off', () => {
  expect(displayState({ connected: false, lastHeardMs: 119_999 })).toBe('idle');
  expect(displayState({ connected: false, lastHeardMs: 120_001 })).toBe('uncertain');
});
```

Add REDs for unique persisted names, rename routing by stable ID, browser rows, command round trips, origin propagation, close/disconnect, and trigger duplicate suppression without suppressing a later human action.

- [ ] **Step 2: Run RED**

```bash
npx vitest run frontend/src/modules/Media/identity frontend/src/modules/Media/fleet frontend/src/modules/Media/externalControl backend/src/1_adapters/eventbus backend/src/3_applications/devices shared/contracts/media
```

- [ ] **Step 3: Implement one authoritative publication path**

Use the browser's existing local session broadcast through `EventBusMediaClientIngress`; do not synthesize a second conflicting state stream. Route `client-control:<clientId>` to the registered owner and copy optional origin through every envelope and snapshot.

- [ ] **Step 4: Run GREEN and architecture gates**

```bash
npx vitest run frontend/src/modules/Media/identity frontend/src/modules/Media/fleet frontend/src/modules/Media/externalControl backend/src/1_adapters/eventbus backend/src/3_applications/devices shared/contracts/media
npm run audit:fs && npm run audit:layers && npm run audit:links && npm run test:composition-contracts
```

- [ ] **Step 5: Run browser acceptance**

```bash
BASE_URL="$OWNED_BASE_URL" npx playwright test \
 tests/live/flow/media/media-app-fleet.runtime.test.mjs \
 tests/live/flow/media/media-app-browser-control.runtime.test.mjs \
 tests/live/flow/media/media-app-house-browser-session.runtime.test.mjs \
 --workers=1 --reporter=line
```

- [ ] **Step 6: Extend manifest and commit**

```bash
git add frontend/src/modules/Media backend/src shared/contracts/media frontend/src/screen-framework tests/live/flow/media scripts/media-p0-gate.mjs docs/reference/media/media-app.md docs/_wip/plans/2026-09-14-media-app-acceptance-ledger.md
git commit -m "feat(media): complete P0 house identity and routing"
```

### Task 7: Unify Outcomes, Retry, Reset, and Paused Recovery

**Stories:** `RELY.1a`, `RELY.2a`, `RELY.3a`, `RELY.5a`, `RELY.6a`, `RELY.7a` P0, `RELY.8a`.

**Files:**
- Modify: dispatch reducer/provider/tray and status overlay hooks
- Modify: local player failure bridge and mini-player problem state
- Modify: session persistence and NavProvider
- Modify: SettingsMenu/ConfirmDialog reset flow
- Modify: recovery/reset Playwright journeys

**Interfaces:**
- Outcome record: `{ attemptId, targetId, kind, phase, item, command, snapshot, reason, createdAt, updatedAt }`.
- `retry(attemptId)` replays the immutable named attempt only; successful sibling targets are excluded.
- Persistence restores `{ session, queue, config, nav, aim }` paused and version-valid.

- [ ] **Step 1: Write RED attempt and recovery tests**

```js
it('retries the selected failed attempt, not the latest attempt', async () => {
  const first = recordAttempt({ targetId: 'office', item: arrival });
  recordAttempt({ targetId: 'browser', item: disclosure });
  await retry(first.attemptId);
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'office', item: arrival }));
});
```

Add REDs for per-target progress, unconfirmed clearing on matching state, offline Not sent/no later replay, local media error/skip notice, malformed/older persistence, paused restore, and itemized Start fresh retaining checked parts.

- [ ] **Step 2: Run RED**

```bash
npx vitest run frontend/src/modules/Media/cast frontend/src/modules/Media/session frontend/src/modules/Media/shell frontend/src/hooks/useStatusOverlay.test.jsx
```

- [ ] **Step 3: Implement immutable attempt records and paused restore**

Late state updates locate their exact `{ attemptId, targetId }`. Offline transport produces terminal `not-sent` and is never queued for reconnect. Restore hydrates before default persistence and never calls Play automatically.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run frontend/src/modules/Media/cast frontend/src/modules/Media/session frontend/src/modules/Media/shell frontend/src/hooks/useStatusOverlay.test.jsx --maxWorkers=2
```

- [ ] **Step 5: Run browser acceptance**

```bash
BASE_URL="$OWNED_BASE_URL" npx playwright test \
 tests/live/flow/media/media-app-ordinary-dispatch.runtime.test.mjs \
 tests/live/flow/media/media-app-search-recovery.runtime.test.mjs \
 tests/live/flow/media/media-app-resume.runtime.test.mjs \
 tests/live/flow/media/media-app-reset-confirm.runtime.test.mjs \
 --workers=1 --reporter=line
```

- [ ] **Step 6: Extend manifest and commit**

```bash
git add frontend/src/modules/Media frontend/src/hooks tests/live/flow/media scripts/media-p0-gate.mjs docs/reference/media/media-app.md docs/_wip/plans/2026-09-14-media-app-acceptance-ledger.md
git commit -m "feat(media): unify P0 outcomes retry and recovery"
```

### Task 8: Enforce Accessibility, Responsive Parity, and P0 Acceptance

**Stories:** `RELY.11a`, `RELY.12a`, `RELY.13a`, remaining P0 of `RELY.14a`, and final criterion verification for every story in this plan.

**Files:**
- Modify: Media shell/search/browse/fleet SCSS and JSX only where measured failures exist
- Create: `tests/live/flow/media/media-app-p0-personas.runtime.test.mjs`
- Create: `tests/live/flow/media/media-app-p0-accessibility.runtime.test.mjs`
- Modify: `scripts/media-p0-gate.mjs`
- Modify: acceptance ledger, refactor status, and media reference

**Interfaces:**
- Produces the final P0 manifest with every accepted criterion mapped exactly once to an ordinary-input exact-SHA journey.
- No product interface is added unless a failing accessibility/parity test requires it.

- [ ] **Step 1: Write RED measurable parity tests**

```js
for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1440, height: 900 }]) {
  test(`all P0 actions remain reachable at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('button', { name: /search/i })).toBeInViewport();
    await expect(page.getByTestId('aim-label')).toBeInViewport();
    await expect(page.getByRole('button', { name: /play|pause/i })).toBeInViewport();
  });
}
```

Also assert 44px hit targets, keyboard order, labelled Back, live-region outcome text, non-color fleet status, 200% text reflow, reduced-motion styles, overlay dismissal, and tap budgets from the accepted requirements.

- [ ] **Step 2: Run RED**

```bash
BASE_URL="$OWNED_BASE_URL" npx playwright test tests/live/flow/media/media-app-p0-accessibility.runtime.test.mjs tests/live/flow/media/media-app-p0-personas.runtime.test.mjs --workers=1 --reporter=line
```

- [ ] **Step 3: Repair only measured failures**

Use existing design tokens, semantic roles, `aria-live`, visible text, and responsive layout. Do not hide unavailable controls; disable them with their reason. Remove superseded duplicate controls only after `rg` proves no callers remain.

- [ ] **Step 4: Run focused GREEN, static gates, and repository tests**

```bash
npx playwright test tests/live/flow/media/media-app-p0-accessibility.runtime.test.mjs tests/live/flow/media/media-app-p0-personas.runtime.test.mjs --workers=1 --reporter=line
npm run audit:fs && npm run audit:layers && npm run audit:ui && npm run audit:links
npm run check:parse && npm run check:scss
npm test
```

- [ ] **Step 5: Certify the exact candidate**

```bash
candidate_sha=$(git rev-parse HEAD)
test -z "$(git status --porcelain)"
MEDIA_ACCEPTANCE_EXPECTED_SHA="$candidate_sha" node tests/_lib/media-redesign-server.mjs --build
BASE_URL="$OWNED_BASE_URL" MEDIA_STABLE_CORE_EVIDENCE_DIR="$EVIDENCE/stable" npm run test:media-stable-core
BASE_URL="$OWNED_BASE_URL" MEDIA_P0_EVIDENCE_DIR="$EVIDENCE/p0" npm run test:media-p0
```

Expected: stable core remains 11/11 and every newly claimed P0 criterion passes with zero skipped, interrupted, or failed cases.

- [ ] **Step 6: Commit certification documentation**

```bash
git add frontend/src/modules/Media tests/live/flow/media scripts/media-p0-gate.mjs docs/reference/media/media-app.md docs/_wip/plans/2026-09-14-media-app-acceptance-ledger.md docs/_wip/refactors/2026-09-14-media-app-redesign.md
git commit -m "docs(media): certify remaining P0 acceptance"
```

### Task 9: Per-Batch Merge and Deployment Gate

**Files:**
- No product edits; execute after each Task 2–8 batch.

**Interfaces:**
- Consumes a clean reviewed batch branch and exact runtime evidence.
- Produces a healthy production container serving the exact merged SHA, or stops without deployment.

- [ ] **Step 1: Independent review**

Review the batch diff against its story criteria. Reject criterion claims without actual-player evidence, any stable-core manifest deletion, and any widened unrelated scope.

- [ ] **Step 2: Merge into current `main` and rerun focused plus stable gates**

```bash
git checkout main
git merge --no-ff media/p0-batch-N -m "merge: media P0 batch N"
npm run test:media-stable-core
npm run test:media-p0
```

The commands require an owned exact-SHA acceptance server and evidence directories as defined in Task 8.

- [ ] **Step 3: Run the household gate before building**

```bash
./scripts/deploy-gate.sh
```

Expected: exit 0. Any occupied or unreachable condition halts deployment.

- [ ] **Step 4: Build, re-gate, and deploy**

```bash
./scripts/build-daylight.sh
./scripts/deploy-gate.sh
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 5: Verify exact production identity and health**

```bash
test "$(curl -fsS http://127.0.0.1:3111/build.txt | sed -n 's#.*commit/##p')" = "$(git rev-parse HEAD)"
test "$(sudo docker inspect -f '{{.State.Health.Status}}' daylight-station)" = healthy
curl -fsS -o /dev/null http://127.0.0.1:3111/media
```

- [ ] **Step 6: Preserve rollback provenance and clean the merged branch**

Record branch name/SHA in `docs/_archive/deleted-branches.md`, commit that record as part of the next batch setup, then delete the merged branch and its owned `.worktrees/` worktree through the branch-finishing workflow.

## Self-Review Results

- **Spec coverage:** All 47 unfinished stories containing P0 work are assigned. Pure P1/P2 criteria in mixed stories are explicitly excluded rather than silently accepted.
- **Placeholder scan:** Every task has named files, interfaces, RED/GREEN commands, runtime evidence, and commit boundaries; no unspecified implementation steps remain.
- **Type consistency:** `operationId`, owner/revision guards, immutable attempt records, canonical browser identity, and additive manifest entries retain the same names across producing and consuming tasks.
- **Review focus:** Late ACK/Undo is owned by Tasks 3 and 7; liveness by Task 6; same-title generations by Task 3; mixed search failures by Task 4; responsive/accessibility parity by Task 8.
- **Stable-core safety:** Every batch reruns the immutable stable-core gate before merge and again on the exact merged artifact before deployment.
