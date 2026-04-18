# Media App Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the backend APIs and screen-framework extensions that the new
Media App will consume. No work on the Media App itself — this plan digs the
foundation hole before the concrete is poured.

**Architecture:** Three-tier with clear boundaries.
(1) A shared contracts package defines every canonical shape, topic name, and
command envelope as the single source of truth.
(2) Screen-framework gains a structured command envelope (hard cutover from the
current flat shape), new ActionBus action types, and publisher hooks for state
and acks.
(3) Backend gains a session-control HTTP API under `/api/v1/device/:id/session/*`,
a liveness-tracking WebSocket relay for `device-state:<id>` / `device-ack:<id>`,
dispatch idempotency, and atomic session-claim semantics for Take Over.

**Tech Stack:** Vitest (unit tests — backend `suite/` + frontend
screen-framework), Express routers (backend API), WebSocketEventBus (backend WS),
`useScreenCommands` + ActionBus + Input system (screen-framework), DDD layering
(`3_applications/devices/ports`, `3_applications/devices/services`,
`4_api/v1/routers`), ESM everywhere.

**Reference docs:**
- [`docs/reference/media/media-app-requirements.md`](../reference/media/media-app-requirements.md) — functional requirements this plan satisfies.
- [`docs/reference/media/media-app-technical.md`](../reference/media/media-app-technical.md) — contract shapes, endpoint specs, topic layout. Every task below references specific sections of this doc.
- [`docs/reference/content/content-playback.md`](../reference/content/content-playback.md) — Playable Contract (used for `PlayableItem` shape).

---

## Phase 0 — Shared Contracts Package

A single source of truth for shapes, topics, and command envelopes that both
backend and screen-framework consume. Living in `shared/contracts/media/` so
neither side owns it.

### Task 0.1: Create shared contracts directory + index

**Files:**
- Create: `shared/contracts/media/index.mjs`
- Create: `shared/contracts/media/README.md`

**Step 1: Create the directory skeleton**

```bash
mkdir -p shared/contracts/media
```

**Step 2: Write the barrel export**

```js
// shared/contracts/media/index.mjs
export * from './topics.mjs';
export * from './commands.mjs';
export * from './shapes.mjs';
export * from './envelopes.mjs';
export * from './errors.mjs';
```

**Step 3: Write the README**

```markdown
# Media Contracts

Single source of truth for wire-level shapes shared between the backend
media-control API and the screen-framework playback surface.

See `docs/reference/media/media-app-technical.md` §9 for canonical shape
definitions, §6.2 for the command envelope, §7 for topic layout.

Both backend and frontend resolve this directory via import alias.
Do not duplicate these shapes in consumer code.
```

**Step 4: Commit**

```bash
git add shared/contracts/media/
git commit -m "feat(contracts): scaffold shared media-contracts package"
```

---

### Task 0.2: Topic name builders

**Files:**
- Create: `shared/contracts/media/topics.mjs`
- Create: `shared/contracts/media/topics.test.mjs`

**Step 1: Write the failing tests**

```js
// shared/contracts/media/topics.test.mjs
import { describe, it, expect } from 'vitest';
import {
  DEVICE_STATE_TOPIC,
  DEVICE_ACK_TOPIC,
  HOMELINE_TOPIC,
  SCREEN_COMMAND_TOPIC,
  CLIENT_CONTROL_TOPIC,
  PLAYBACK_STATE_TOPIC,
  parseDeviceTopic,
} from './topics.mjs';

describe('topic builders', () => {
  it('builds per-device topics with the deviceId suffix', () => {
    expect(DEVICE_STATE_TOPIC('tv-living-room')).toBe('device-state:tv-living-room');
    expect(DEVICE_ACK_TOPIC('tv-living-room')).toBe('device-ack:tv-living-room');
    expect(HOMELINE_TOPIC('tv-living-room')).toBe('homeline:tv-living-room');
    expect(SCREEN_COMMAND_TOPIC('tv-living-room')).toBe('screen:tv-living-room');
  });
  it('builds per-client topics with the clientId suffix', () => {
    expect(CLIENT_CONTROL_TOPIC('c1')).toBe('client-control:c1');
  });
  it('exposes the broadcast topic as a constant', () => {
    expect(PLAYBACK_STATE_TOPIC).toBe('playback_state');
  });
  it('parses a per-device topic back into { kind, deviceId }', () => {
    expect(parseDeviceTopic('device-state:tv-1')).toEqual({ kind: 'device-state', deviceId: 'tv-1' });
    expect(parseDeviceTopic('homeline:tv-1')).toEqual({ kind: 'homeline', deviceId: 'tv-1' });
    expect(parseDeviceTopic('unrelated')).toBeNull();
  });
});
```

**Step 2: Run the test to confirm it fails**

Run: `npx vitest run shared/contracts/media/topics.test.mjs`
Expected: FAIL — module missing.

**Step 3: Implement**

```js
// shared/contracts/media/topics.mjs
export const PLAYBACK_STATE_TOPIC = 'playback_state';

export const DEVICE_STATE_TOPIC   = (deviceId) => `device-state:${deviceId}`;
export const DEVICE_ACK_TOPIC     = (deviceId) => `device-ack:${deviceId}`;
export const HOMELINE_TOPIC       = (deviceId) => `homeline:${deviceId}`;
export const SCREEN_COMMAND_TOPIC = (deviceId) => `screen:${deviceId}`;
export const CLIENT_CONTROL_TOPIC = (clientId) => `client-control:${clientId}`;

const DEVICE_TOPIC_KINDS = ['device-state', 'device-ack', 'homeline', 'screen'];

export function parseDeviceTopic(topic) {
  if (typeof topic !== 'string') return null;
  const idx = topic.indexOf(':');
  if (idx < 0) return null;
  const kind = topic.slice(0, idx);
  const deviceId = topic.slice(idx + 1);
  if (!DEVICE_TOPIC_KINDS.includes(kind) || !deviceId) return null;
  return { kind, deviceId };
}
```

**Step 4: Run test to verify pass**

Run: `npx vitest run shared/contracts/media/topics.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git add shared/contracts/media/topics.*
git commit -m "feat(contracts): add topic name builders"
```

---

### Task 0.3: Command type enums

**Files:**
- Create: `shared/contracts/media/commands.mjs`
- Create: `shared/contracts/media/commands.test.mjs`

**Step 1: Failing test**

```js
// shared/contracts/media/commands.test.mjs
import { describe, it, expect } from 'vitest';
import {
  COMMAND_KINDS,
  TRANSPORT_ACTIONS,
  QUEUE_OPS,
  CONFIG_SETTINGS,
  SYSTEM_ACTIONS,
  isCommandKind,
  isTransportAction,
  isQueueOp,
  isConfigSetting,
} from './commands.mjs';

describe('command enums', () => {
  it('lists every command kind', () => {
    expect(COMMAND_KINDS).toEqual(['transport', 'queue', 'config', 'adopt-snapshot', 'system']);
  });
  it('lists every transport action', () => {
    expect(TRANSPORT_ACTIONS).toEqual(
      ['play', 'pause', 'stop', 'seekAbs', 'seekRel', 'skipNext', 'skipPrev']
    );
  });
  it('lists every queue op', () => {
    expect(QUEUE_OPS).toEqual(
      ['play-now', 'play-next', 'add-up-next', 'add', 'reorder', 'remove', 'jump', 'clear']
    );
  });
  it('lists every config setting', () => {
    expect(CONFIG_SETTINGS).toEqual(['shuffle', 'repeat', 'shader', 'volume']);
  });
  it('lists every system action', () => {
    expect(SYSTEM_ACTIONS).toEqual(['reset', 'reload', 'sleep', 'wake']);
  });
  it('provides type guards', () => {
    expect(isCommandKind('transport')).toBe(true);
    expect(isCommandKind('nope')).toBe(false);
    expect(isTransportAction('seekAbs')).toBe(true);
    expect(isTransportAction('rewind')).toBe(false);
    expect(isQueueOp('clear')).toBe(true);
    expect(isConfigSetting('volume')).toBe(true);
  });
});
```

**Step 2: Run — fails (module missing).**

**Step 3: Implement**

```js
// shared/contracts/media/commands.mjs
export const COMMAND_KINDS = Object.freeze([
  'transport', 'queue', 'config', 'adopt-snapshot', 'system',
]);

export const TRANSPORT_ACTIONS = Object.freeze([
  'play', 'pause', 'stop', 'seekAbs', 'seekRel', 'skipNext', 'skipPrev',
]);

export const QUEUE_OPS = Object.freeze([
  'play-now', 'play-next', 'add-up-next', 'add',
  'reorder', 'remove', 'jump', 'clear',
]);

export const CONFIG_SETTINGS = Object.freeze(['shuffle', 'repeat', 'shader', 'volume']);

export const SYSTEM_ACTIONS = Object.freeze(['reset', 'reload', 'sleep', 'wake']);

export const REPEAT_MODES = Object.freeze(['off', 'one', 'all']);

export const SESSION_STATES = Object.freeze([
  'idle', 'ready', 'loading', 'playing', 'paused',
  'buffering', 'stalled', 'ended', 'error',
]);

export const isCommandKind     = (v) => COMMAND_KINDS.includes(v);
export const isTransportAction = (v) => TRANSPORT_ACTIONS.includes(v);
export const isQueueOp         = (v) => QUEUE_OPS.includes(v);
export const isConfigSetting   = (v) => CONFIG_SETTINGS.includes(v);
export const isSystemAction    = (v) => SYSTEM_ACTIONS.includes(v);
export const isRepeatMode      = (v) => REPEAT_MODES.includes(v);
export const isSessionState    = (v) => SESSION_STATES.includes(v);
```

**Step 4: Run — PASS. Commit.**

```bash
git add shared/contracts/media/commands.*
git commit -m "feat(contracts): add command-kind enums and guards"
```

---

### Task 0.4: Session snapshot + queue shape validators

**Files:**
- Create: `shared/contracts/media/shapes.mjs`
- Create: `shared/contracts/media/shapes.test.mjs`

Validators are hand-rolled predicates (no schema library dep). Each returns
`{ valid: bool, errors: string[] }` so callers can log specific failures.

**Step 1: Failing test**

```js
// shared/contracts/media/shapes.test.mjs
import { describe, it, expect } from 'vitest';
import {
  validateSessionSnapshot,
  validateQueueSnapshot,
  validateQueueItem,
  validatePlayableItem,
  createEmptyQueueSnapshot,
  createIdleSessionSnapshot,
} from './shapes.mjs';

describe('shape validators', () => {
  it('accepts a minimal valid SessionSnapshot', () => {
    const snap = createIdleSessionSnapshot({ sessionId: 's1', ownerId: 'tv-1' });
    expect(validateSessionSnapshot(snap).valid).toBe(true);
  });

  it('rejects a SessionSnapshot with an invalid state', () => {
    const snap = createIdleSessionSnapshot({ sessionId: 's1', ownerId: 'tv-1' });
    snap.state = 'DANCING';
    const r = validateSessionSnapshot(snap);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('state'))).toBe(true);
  });

  it('rejects a SessionSnapshot with an out-of-range volume', () => {
    const snap = createIdleSessionSnapshot({ sessionId: 's1', ownerId: 'tv-1' });
    snap.config.volume = 150;
    expect(validateSessionSnapshot(snap).valid).toBe(false);
  });

  it('validates an empty queue snapshot', () => {
    expect(validateQueueSnapshot(createEmptyQueueSnapshot()).valid).toBe(true);
  });

  it('rejects a QueueItem without contentId', () => {
    const r = validateQueueItem({ queueItemId: 'q1', title: 't' });
    expect(r.valid).toBe(false);
  });

  it('rejects a PlayableItem without contentId', () => {
    expect(validatePlayableItem({ format: 'video' }).valid).toBe(false);
  });

  it('accepts a valid PlayableItem', () => {
    const p = { contentId: 'plex-main:1', format: 'video', title: 'Test' };
    expect(validatePlayableItem(p).valid).toBe(true);
  });
});
```

**Step 2: Run — FAIL.**

**Step 3: Implement**

```js
// shared/contracts/media/shapes.mjs
import { isSessionState, isRepeatMode } from './commands.mjs';

const FORMATS = new Set([
  'video', 'dash_video', 'audio', 'singalong', 'readalong',
  'readable_paged', 'readable_flow', 'app', 'image', 'composite',
]);

const isStr   = (v) => typeof v === 'string' && v.length > 0;
const isNum   = (v) => typeof v === 'number' && Number.isFinite(v);
const isBool  = (v) => typeof v === 'boolean';
const isInt0  = (v) => isNum(v) && Number.isInteger(v) && v >= 0;
const inRange = (v, lo, hi) => isNum(v) && v >= lo && v <= hi;

function result(errors) {
  return { valid: errors.length === 0, errors };
}

export function validatePlayableItem(obj) {
  const e = [];
  if (!obj || typeof obj !== 'object') return result(['PlayableItem: not an object']);
  if (!isStr(obj.contentId)) e.push('PlayableItem.contentId: required string');
  if (!isStr(obj.format) || !FORMATS.has(obj.format)) e.push('PlayableItem.format: invalid');
  if (obj.title != null && !isStr(obj.title)) e.push('PlayableItem.title: must be string');
  if (obj.duration != null && !isNum(obj.duration)) e.push('PlayableItem.duration: must be number');
  return result(e);
}

export function validateQueueItem(obj) {
  const e = [];
  if (!obj || typeof obj !== 'object') return result(['QueueItem: not an object']);
  if (!isStr(obj.queueItemId)) e.push('QueueItem.queueItemId: required');
  if (!isStr(obj.contentId))   e.push('QueueItem.contentId: required');
  if (obj.priority && obj.priority !== 'upNext' && obj.priority !== 'queue') {
    e.push('QueueItem.priority: must be "upNext" or "queue"');
  }
  return result(e);
}

export function validateQueueSnapshot(obj) {
  const e = [];
  if (!obj || typeof obj !== 'object') return result(['QueueSnapshot: not an object']);
  if (!Array.isArray(obj.items)) e.push('QueueSnapshot.items: required array');
  else {
    obj.items.forEach((item, i) => {
      const r = validateQueueItem(item);
      if (!r.valid) e.push(`QueueSnapshot.items[${i}]: ${r.errors.join('; ')}`);
    });
  }
  if (!Number.isInteger(obj.currentIndex)) e.push('QueueSnapshot.currentIndex: required integer');
  if (!isInt0(obj.upNextCount)) e.push('QueueSnapshot.upNextCount: required non-negative int');
  return result(e);
}

export function validateSessionSnapshot(obj) {
  const e = [];
  if (!obj || typeof obj !== 'object') return result(['SessionSnapshot: not an object']);
  if (!isStr(obj.sessionId))  e.push('SessionSnapshot.sessionId: required');
  if (!isSessionState(obj.state)) e.push('SessionSnapshot.state: invalid');
  if (obj.currentItem !== null) {
    const r = validatePlayableItem(obj.currentItem);
    if (!r.valid) e.push(`SessionSnapshot.currentItem: ${r.errors.join('; ')}`);
  }
  if (!isNum(obj.position) || obj.position < 0) e.push('SessionSnapshot.position: required non-negative number');
  const qr = validateQueueSnapshot(obj.queue);
  if (!qr.valid) e.push(`SessionSnapshot.queue: ${qr.errors.join('; ')}`);
  const c = obj.config;
  if (!c || typeof c !== 'object') e.push('SessionSnapshot.config: required object');
  else {
    if (!isBool(c.shuffle))          e.push('config.shuffle: required boolean');
    if (!isRepeatMode(c.repeat))     e.push('config.repeat: required enum');
    if (c.shader !== null && !isStr(c.shader)) e.push('config.shader: string or null');
    if (!inRange(c.volume, 0, 100))  e.push('config.volume: 0..100');
    if (c.playbackRate != null && !isNum(c.playbackRate)) e.push('config.playbackRate: number');
  }
  if (!obj.meta || !isStr(obj.meta.ownerId) || !isStr(obj.meta.updatedAt)) {
    e.push('SessionSnapshot.meta: required { ownerId, updatedAt }');
  }
  return result(e);
}

export function createEmptyQueueSnapshot() {
  return { items: [], currentIndex: -1, upNextCount: 0 };
}

export function createIdleSessionSnapshot({ sessionId, ownerId, now = new Date() } = {}) {
  return {
    sessionId,
    state: 'idle',
    currentItem: null,
    position: 0,
    queue: createEmptyQueueSnapshot(),
    config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1.0 },
    meta: { ownerId, updatedAt: now.toISOString() },
  };
}
```

**Step 4: Run — PASS. Commit.**

```bash
git add shared/contracts/media/shapes.*
git commit -m "feat(contracts): add SessionSnapshot/QueueSnapshot/PlayableItem validators"
```

---

### Task 0.5: Command envelope builders + validators

**Files:**
- Create: `shared/contracts/media/envelopes.mjs`
- Create: `shared/contracts/media/envelopes.test.mjs`

**Step 1: Failing test** covering:
- `buildCommandEnvelope({ targetDevice, command, params, commandId })` returns a valid envelope.
- Rejects unknown command kinds.
- `validateCommandEnvelope(env)` returns `.valid = true` for good envelopes; catches missing `commandId`, missing `command`, mismatched `params` for each command kind (transport without `action`, queue without `op`, config without `setting`/`value`, adopt-snapshot without `snapshot`).
- `buildAck({ deviceId, commandId, ok, error? })`.
- `validateAck(ack)`.
- `buildDeviceStateBroadcast({ deviceId, snapshot, reason })`.
- `validateDeviceStateBroadcast`.

**Step 2: Run — FAIL.**

**Step 3: Implement.** Pattern mirrors shapes.mjs with predicate validators;
builders stamp `ts` ISO strings and set `topic` fields appropriately.

Key functions:
```js
export function buildCommandEnvelope({ targetDevice, targetScreen, command, params, commandId, ts }) { ... }
export function validateCommandEnvelope(env) { ... }
export function buildCommandAck({ deviceId, commandId, ok, error, code, appliedAt }) { ... }
export function validateCommandAck(ack) { ... }
export function buildDeviceStateBroadcast({ deviceId, snapshot, reason, ts }) { ... }
export function validateDeviceStateBroadcast(msg) { ... }
export function buildPlaybackStateBroadcast({ clientId, sessionId, displayName, state, currentItem, position, duration, config, ts }) { ... }
```

All validators reuse §6.2, §9.x shape rules from the tech doc.

**Step 4: Run — PASS. Commit.**

```bash
git add shared/contracts/media/envelopes.*
git commit -m "feat(contracts): add command envelope + ack + broadcast builders"
```

---

### Task 0.6: Error code constants

**Files:**
- Create: `shared/contracts/media/errors.mjs`
- Create: `shared/contracts/media/errors.test.mjs`

**Step 1: Failing test** for: `ERROR_CODES` enum matches §12.2 of the tech doc;
`buildErrorBody({ error, code, details, retryable })` returns the §12.1 shape.

**Step 2: FAIL → Step 3: Implement.** Straight constants + one builder.

```js
export const ERROR_CODES = Object.freeze({
  CONTENT_NOT_FOUND: 'CONTENT_NOT_FOUND',
  SEARCH_TEXT_TOO_SHORT: 'SEARCH_TEXT_TOO_SHORT',
  DEVICE_NOT_FOUND: 'DEVICE_NOT_FOUND',
  DEVICE_OFFLINE: 'DEVICE_OFFLINE',
  DEVICE_REFUSED: 'DEVICE_REFUSED',
  DEVICE_BUSY: 'DEVICE_BUSY',
  WAKE_FAILED: 'WAKE_FAILED',
  ATOMICITY_VIOLATION: 'ATOMICITY_VIOLATION',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
});

export function buildErrorBody({ error, code, details, retryable } = {}) {
  const body = { ok: false, error: String(error ?? 'Unknown error') };
  if (code) body.code = code;
  if (Array.isArray(details) && details.length) body.details = details;
  if (typeof retryable === 'boolean') body.retryable = retryable;
  return body;
}
```

**Step 4: PASS. Commit:**

```bash
git add shared/contracts/media/errors.*
git commit -m "feat(contracts): add error-code constants and body builder"
```

---

### Task 0.7: Wire shared/ into backend import path

**Files:**
- Modify: `backend/package.json` — add `"imports": { "#shared-contracts/*": "../shared/contracts/*" }` (or equivalent existing pattern).

**Step 1:** Inspect `backend/package.json` `imports` block. Add the alias
alongside existing `#system/*`, `#apps/*`, etc.

**Step 2: Write a smoke test in the adapters suite**

```js
// backend/tests/unit/suite/0_system/contracts/shared-import.test.mjs
import { describe, it, expect } from 'vitest';
import { PLAYBACK_STATE_TOPIC, ERROR_CODES } from '#shared-contracts/media/index.mjs';

describe('shared-contracts import alias', () => {
  it('resolves from the backend via the alias', () => {
    expect(PLAYBACK_STATE_TOPIC).toBe('playback_state');
    expect(ERROR_CODES.DEVICE_OFFLINE).toBe('DEVICE_OFFLINE');
  });
});
```

**Step 3:** Run: `npx vitest run backend/tests/unit/suite/0_system/contracts/`
Expected: PASS once alias is registered.

**Step 4: Commit.**

```bash
git add backend/package.json backend/tests/unit/suite/0_system/contracts/
git commit -m "feat(backend): add #shared-contracts import alias"
```

---

### Task 0.8: Wire shared/ into frontend Vite config

**Files:**
- Modify: `frontend/vite.config.*` — add resolve alias `@shared-contracts`.

**Step 1:** Open Vite config; add under `resolve.alias`:
```js
'@shared-contracts': path.resolve(__dirname, '../shared/contracts'),
```

**Step 2: Write a smoke test**

```jsx
// frontend/src/lib/contracts/_alias-smoke.test.js
import { describe, it, expect } from 'vitest';
import { PLAYBACK_STATE_TOPIC } from '@shared-contracts/media/index.mjs';

describe('@shared-contracts alias', () => {
  it('resolves from frontend', () => {
    expect(PLAYBACK_STATE_TOPIC).toBe('playback_state');
  });
});
```

**Step 3:** `npx vitest run frontend/src/lib/contracts/`
Expected: PASS.

**Step 4: Commit.**

```bash
git add frontend/vite.config.* frontend/src/lib/contracts/
git commit -m "feat(frontend): add @shared-contracts Vite alias"
```

---

## Phase 1 — Screen-framework Extensions

Hard cutover from flat command shape to structured `CommandEnvelope`. Add new
ActionBus types. Add state + ack publishers.

### Task 1.1: Extend ActionBus with new action types

**Files:**
- Modify: `frontend/src/screen-framework/input/actionMap.js` — add `media:seek-abs`, `media:seek-rel`, `media:queue-op`, `media:config-set`, `media:adopt-snapshot`.
- Modify: `frontend/src/screen-framework/input/actionMap.test.js` — extend.

**Step 1:** Add the new action name constants to the `ACTION_MAP` export.

**Step 2:** Extend the existing tests to assert the new names exist and (if
`translateAction` covers them) translate properly.

**Step 3:** `npx vitest run frontend/src/screen-framework/input/actionMap.test.js`

**Step 4: Commit.**

```bash
git add frontend/src/screen-framework/input/
git commit -m "feat(screen-framework): register media:seek-abs/seek-rel/queue-op/config-set/adopt-snapshot actions"
```

---

### Task 1.2: Replace `useScreenCommands` parser — envelope-first

**Files:**
- Modify: `frontend/src/screen-framework/commands/useScreenCommands.js` (full rewrite of `handleMessage`)
- Modify: `frontend/src/screen-framework/commands/useScreenCommands.test.jsx` (full rewrite)

**Step 1: Write failing tests first** covering every command kind:

```jsx
// useScreenCommands.test.jsx (new structure)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScreenCommands } from './useScreenCommands.js';

const buildEnvelope = (overrides) => ({
  type: 'command',
  targetDevice: 'tv-1',
  commandId: 'cid-1',
  command: 'transport',
  params: { action: 'play' },
  ts: new Date().toISOString(),
  ...overrides,
});

describe('useScreenCommands (structured envelope)', () => {
  let bus, wsConfig;
  beforeEach(() => {
    bus = { emit: vi.fn() };
    wsConfig = { commands: true, guardrails: { device: 'tv-1' } };
  });

  // Dispatch tests per command kind
  it('dispatches transport play to media:playback', () => { /* ... */ });
  it('dispatches transport seekAbs to media:seek-abs with value', () => { /* ... */ });
  it('dispatches queue op play-now to media:queue-op with contentId', () => { /* ... */ });
  it('dispatches config setting volume to media:config-set', () => { /* ... */ });
  it('dispatches adopt-snapshot with snapshot payload', () => { /* ... */ });
  it('ignores envelopes with mismatched targetDevice', () => { /* ... */ });
  it('ignores envelopes targeting a different screen', () => { /* ... */ });
  it('rejects envelopes missing commandId (no emit)', () => { /* ... */ });
  it('rejects envelopes with unknown command kind', () => { /* ... */ });
  it('rejects flat legacy shapes (no emit, warn log)', () => { /* ... */ });
});
```

**Step 2:** Run — FAIL (because current code handles flat shapes).

**Step 3: Rewrite `handleMessage`** using
`validateCommandEnvelope` from `@shared-contracts/media`. Route per
`command` kind via `bus.emit('media:<action>', { ...params, commandId })`.
Remove every flat-shape branch.

```js
import { validateCommandEnvelope } from '@shared-contracts/media/index.mjs';

function handleMessage(data) {
  // targetDevice / targetScreen guards (unchanged)
  if (data.targetDevice && data.targetDevice !== g.device) return;
  if (data.targetScreen && data.targetScreen !== screenIdRef.current) return;

  if (data.topic === 'playback_state') return;

  const v = validateCommandEnvelope(data);
  if (!v.valid) {
    logger().debug('commands.envelope-invalid', { errors: v.errors });
    return;
  }

  switch (data.command) {
    case 'transport': dispatchTransport(bus, data); break;
    case 'queue':     dispatchQueue(bus, data);     break;
    case 'config':    dispatchConfig(bus, data);    break;
    case 'adopt-snapshot': bus.emit('media:adopt-snapshot', { ...data.params, commandId: data.commandId }); break;
    case 'system':    dispatchSystem(bus, data);    break;
  }
}
```

Define the small `dispatchX` helpers in-file.

**Step 4:** Run the whole screen-framework test folder.

Run: `npx vitest run frontend/src/screen-framework/`
Expected: PASS.

**Step 5: Commit.**

```bash
git add frontend/src/screen-framework/commands/
git commit -m "feat(screen-framework)!: replace flat command parser with structured envelope

BREAKING CHANGE: useScreenCommands no longer accepts flat { playback, volume,
shader, play, queue } messages. All commands MUST use the structured envelope
defined in @shared-contracts/media §6.2."
```

---

### Task 1.3: Migrate any other flat-shape consumers

**Files:** scan the frontend for any code that constructs flat command messages
targeting screens.

**Step 1:**

Run: `rg "playback:\s*['\"]|data\.playback\s*=|data\.volume\s*=" frontend/src -l`

**Step 2:** For each hit: either (a) replace with a call to
`buildCommandEnvelope(...)` from `@shared-contracts/media`, or (b) delete if
dead code. Update tests.

**Step 3:** Full frontend test suite.

Run: `npx vitest run frontend/src/`

**Step 4: Commit per logical group** (one commit per module touched).

```bash
git commit -m "refactor(<module>): migrate to structured command envelope"
```

---

### Task 1.4: `useSessionStatePublisher` hook — debounce + heartbeat

**Files:**
- Create: `frontend/src/screen-framework/publishers/useSessionStatePublisher.js`
- Create: `frontend/src/screen-framework/publishers/useSessionStatePublisher.test.jsx`

**Step 1: Failing tests**
- On mount, publishes `initial` snapshot to `device-state:<deviceId>`.
- When the `sessionSource` snapshot changes, publishes with `reason: 'change'`, debounced 500ms.
- Emits `reason: 'heartbeat'` every 5s while state is non-idle.
- When state transitions to `idle`, emits one idle snapshot, then no more heartbeats.
- Uses `buildDeviceStateBroadcast` from `@shared-contracts/media`.

Use `vi.useFakeTimers()` for the debounce + heartbeat assertions.

**Step 2:** Run — FAIL.

**Step 3: Implement**

```js
// useSessionStatePublisher.js
import { useEffect, useRef } from 'react';
import { wsService } from '../../services/WebSocketService.js';
import { DEVICE_STATE_TOPIC, buildDeviceStateBroadcast } from '@shared-contracts/media/index.mjs';

const DEBOUNCE_MS = 500;
const HEARTBEAT_MS = 5000;

export function useSessionStatePublisher({ deviceId, getSnapshot, subscribe }) {
  const publishRef = useRef(null);
  useEffect(() => {
    if (!deviceId) return;
    let debounceTimer = null;
    let heartbeatTimer = null;

    const publish = (reason) => {
      const snapshot = getSnapshot();
      if (!snapshot) return;
      wsService.send(buildDeviceStateBroadcast({
        deviceId, snapshot, reason, ts: new Date().toISOString(),
      }));
    };

    publish('initial');

    const onChange = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => publish('change'), DEBOUNCE_MS);
    };

    const startHeartbeat = () => {
      if (heartbeatTimer) return;
      heartbeatTimer = setInterval(() => publish('heartbeat'), HEARTBEAT_MS);
    };
    const stopHeartbeat = () => {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    };

    const unsub = subscribe({
      onChange,
      onStateTransition: (state) => {
        if (state === 'idle') stopHeartbeat();
        else startHeartbeat();
      },
    });

    return () => {
      unsub?.();
      clearTimeout(debounceTimer);
      stopHeartbeat();
    };
  }, [deviceId, getSnapshot, subscribe]);
}
```

**Step 4:** Tests PASS. Commit.

```bash
git add frontend/src/screen-framework/publishers/useSessionStatePublisher.*
git commit -m "feat(screen-framework): useSessionStatePublisher — debounced change + heartbeat"
```

---

### Task 1.5: `useCommandAckPublisher` hook

**Files:**
- Create: `frontend/src/screen-framework/publishers/useCommandAckPublisher.js`
- Create: `frontend/src/screen-framework/publishers/useCommandAckPublisher.test.jsx`

Same TDD pattern. Subscribes to the ActionBus; publishes an ack on
`device-ack:<deviceId>` after each command handler reports completion.

Key behaviors covered by tests:
- Publishes `{ ok: true, commandId }` on successful handler.
- Publishes `{ ok: false, error, code }` on handler rejection.
- Debounces duplicate acks for the same commandId within 60s (idempotency log).

**Commit:**

```bash
git add frontend/src/screen-framework/publishers/useCommandAckPublisher.*
git commit -m "feat(screen-framework): useCommandAckPublisher — per-command acks"
```

---

### Task 1.6: `SessionSource` contract + reference implementation

**Files:**
- Create: `frontend/src/screen-framework/publishers/SessionSource.js` — interface + a `createSessionSource(queueController, player)` factory that bridges an existing queue controller and player into the `{ getSnapshot, subscribe }` contract expected by `useSessionStatePublisher`.
- Create: `frontend/src/screen-framework/publishers/SessionSource.test.js`

**Step 1: Failing tests**
- `getSnapshot()` returns a valid `SessionSnapshot` per `@shared-contracts/media.validateSessionSnapshot`.
- `subscribe({ onChange, onStateTransition })` fires `onChange` on queue mutation, `onStateTransition` on play/pause/ended.

**Step 2: Implement.** Build snapshot by reading queue controller state +
player state + config store.

**Step 3: Commit.**

```bash
git add frontend/src/screen-framework/publishers/SessionSource.*
git commit -m "feat(screen-framework): SessionSource factory for state publishers"
```

---

### Task 1.7: Wire publishers into the ScreenRenderer for media screens

**Files:**
- Modify: `frontend/src/screen-framework/ScreenRenderer.jsx` — when `websocket.publishState: true` in the screen YAML and a player is present, mount `useSessionStatePublisher` and `useCommandAckPublisher`.
- Modify: `frontend/src/screen-framework/ScreenRenderer.test.jsx` (add new cases, don't replace existing).

**Step 1: Failing test** — asserts `wsService.send` is called with a
`device-state:<id>` message on mount when `publishState: true` and a session
source is provided.

**Step 2: Implement.** Look up `deviceId` from `websocket.guardrails.device`;
build a session source; pass to the publisher hooks.

**Step 3:** Run: `npx vitest run frontend/src/screen-framework/ScreenRenderer.test.jsx`

**Step 4: Commit.**

```bash
git add frontend/src/screen-framework/
git commit -m "feat(screen-framework): opt-in state+ack publishers for media screens"
```

---

## Phase 2 — Backend Relay & Liveness

Runs in parallel with Phase 1. The shared contracts (Phase 0) gate both.

### Task 2.1: Topic allowlist + routing in WebSocketEventBus

**Files:**
- Modify: `backend/src/0_system/eventbus/WebSocketEventBus.mjs`
- Create: `backend/tests/unit/suite/0_system/eventbus/WebSocketEventBus.routing.test.mjs`

**Step 1: Inspect current bus** to understand how topics are published/subscribed.

**Step 2: Failing test** — publishing a message on `device-state:tv-1` reaches
only subscribers of that topic (not wildcard), and publishing on
`screen:tv-1` reaches only the client identified as `tv-1`.

**Step 3: Implement.** Add a thin routing helper (pure function) that uses
`parseDeviceTopic` from `@shared-contracts/media` to route payloads. Guard
rails: unknown topic prefixes are logged and dropped.

**Step 4: Commit.**

```bash
git add backend/src/0_system/eventbus/ backend/tests/unit/suite/0_system/eventbus/
git commit -m "feat(eventbus): route per-device topics via shared contracts parser"
```

---

### Task 2.2: Device liveness tracker + offline synthesis

**Files:**
- Create: `backend/src/3_applications/devices/services/DeviceLivenessService.mjs`
- Create: `backend/tests/unit/suite/3_applications/devices/DeviceLivenessService.test.mjs`

**Step 1: Failing tests**
- When a device publishes a heartbeat on `device-state:<id>`, liveness is marked `online` with `lastSeenAt`.
- 15s after the last heartbeat (using fake timers), service emits a synthesized `device-state:<id>` with `reason: "offline"` and the last-known snapshot.
- On a new heartbeat, service emits `reason: "initial"` and resumes.
- Service exposes `getLastSnapshot(deviceId)` for §4.1 consistency.

**Step 2:** FAIL.

**Step 3: Implement** the service. Wires into the event bus via subscribe.

**Step 4:** PASS. Commit.

```bash
git add backend/src/3_applications/devices/services/DeviceLivenessService.*
git add backend/tests/unit/suite/3_applications/devices/DeviceLivenessService.*
git commit -m "feat(devices): DeviceLivenessService — offline synthesis + last-snapshot cache"
```

---

### Task 2.3: Replay last snapshot on new subscription

**Files:**
- Modify: `backend/src/0_system/eventbus/WebSocketEventBus.mjs` — on new subscription to `device-state:<id>`, immediately send the cached last snapshot from `DeviceLivenessService`.
- Modify: `backend/tests/unit/suite/0_system/eventbus/WebSocketEventBus.routing.test.mjs`

**Step 1:** Extend the routing test to assert replay.

**Step 2:** Implement. On subscribe, look up via
`livenessService.getLastSnapshot(deviceId)`; if present, dispatch
asynchronously to the new subscriber.

**Step 3:** PASS. Commit.

```bash
git commit -m "feat(eventbus): replay last device-state snapshot on subscribe"
```

---

### Task 2.4: Wire `DeviceLivenessService` into bootstrap

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs` (or the devices container in `3_applications/devices/index.mjs`) — instantiate `DeviceLivenessService` and subscribe it to the event bus on startup.

**Step 1:** Locate bootstrap for devices.

**Step 2:** Add the liveness service with logger/eventbus dependencies.

**Step 3:** Add a smoke unit test that boot creates the service and it's
subscribed. (Or assert via integration harness — see Phase 5.)

**Step 4: Commit.**

```bash
git commit -m "feat(bootstrap): register DeviceLivenessService on startup"
```

---

## Phase 3 — Session API Endpoints

Builds HTTP endpoints that relay commands to devices over WS and read live state
from `DeviceLivenessService`. Each endpoint is a separate TDD'd task.

### Task 3.1: `ISessionControl` port

**Files:**
- Create: `backend/src/3_applications/devices/ports/ISessionControl.mjs`
- Create: `backend/tests/unit/suite/3_applications/devices/ISessionControl.test.mjs`

Port interface:
- `sendCommand(envelope): Promise<{ ok, commandId, error? }>` — publishes on `screen:<deviceId>`, awaits ack on `device-ack:<deviceId>` with matching `commandId` (timeout configurable, default 5s).
- `getSnapshot(): SessionSnapshot | null` — reads from liveness cache.
- `waitForStateChange(predicate, timeoutMs): Promise<SessionSnapshot>` — used by `claim` (§4.6).

TDD: failing tests → implement type guard + no-op factory → commit.

```bash
git commit -m "feat(devices): ISessionControl port — command relay + snapshot read"
```

---

### Task 3.2: `SessionControlService` — HTTP-to-WS bridge

**Files:**
- Create: `backend/src/3_applications/devices/services/SessionControlService.mjs`
- Create: `backend/tests/unit/suite/3_applications/devices/SessionControlService.test.mjs`

Implements `ISessionControl` over the event bus + liveness service.

Key behaviors to TDD:
- `sendCommand` generates envelope via `buildCommandEnvelope`, publishes on
  `screen:<deviceId>`, returns on matching ack or timeout.
- Idempotency: same `commandId` within 60s returns cached result.
- Timeout: returns `{ ok: false, code: 'DEVICE_REFUSED' }` or
  `{ code: 'DEVICE_OFFLINE' }` depending on last-seen state.

**Commit:**

```bash
git commit -m "feat(devices): SessionControlService — HTTP-to-WS bridge with command idempotency"
```

---

### Task 3.3: `GET /api/v1/device/:id/session` endpoint

**Files:**
- Modify: `backend/src/4_api/v1/routers/device.mjs` — add route.
- Create: `backend/tests/unit/suite/4_api/v1/routers/device.session.test.mjs`

TDD failing tests cover:
- 200 returns last-known `SessionSnapshot` when device is online.
- 204 when device is idle.
- 503 with `{ offline: true, lastKnown, lastSeenAt }` when offline.
- 404 when device is unknown.

**Commit:**

```bash
git commit -m "feat(api): GET /api/v1/device/:id/session endpoint"
```

---

### Task 3.4: `POST /api/v1/device/:id/session/transport` endpoint

**Files:** same device router. Add body parser + validator using
`TRANSPORT_ACTIONS` from shared contracts.

TDD:
- 200 for each action (play, pause, stop, seekAbs, seekRel, skipNext, skipPrev).
- Rejects invalid action with 400.
- Rejects missing `commandId` with 400.
- Surfaces device-side errors as 502.
- 409 when device offline (includes `lastKnown`).

**Commit:**

```bash
git commit -m "feat(api): POST /api/v1/device/:id/session/transport endpoint"
```

---

### Task 3.5: `POST /api/v1/device/:id/session/queue/:op` endpoint

**Files:** same router.

TDD: one test per op (`play-now`, `play-next`, `add-up-next`, `add`, `reorder`,
`remove`, `jump`, `clear`). Each op has distinct body-validation rules — assert
each rejection path. Response includes updated `queue: QueueSnapshot`.

**Commit:**

```bash
git commit -m "feat(api): POST /api/v1/device/:id/session/queue/:op endpoint — 8 ops"
```

---

### Task 3.6: Config setter endpoints (`shuffle` / `repeat` / `shader` / `volume`)

**Files:** same router.

TDD: four separate `PUT` endpoints, each with a focused validation test.
Reject out-of-enum repeat modes, out-of-range volume, non-string shader.

**Commit:**

```bash
git commit -m "feat(api): PUT /api/v1/device/:id/session/{shuffle|repeat|shader|volume}"
```

---

### Task 3.7: `POST /api/v1/device/:id/session/claim` — atomic Take Over

**Files:** same router + `SessionControlService.claim()` method.

TDD atomicity:
- Happy path: snapshot captured, then `stop` command sent, ack received, 200 returned with snapshot + stoppedAt.
- If snapshot capture fails: no stop sent, device unchanged, 503 returned.
- If `stop` command fails after snapshot: service attempts to re-advertise the snapshot by forwarding a synthesized `device-state` on `reason: 'initial'` with the snapshot it already read (best-effort), returns 502 `ATOMICITY_VIOLATION`. Client sees `snapshot: lastKnown`.

**Commit:**

```bash
git commit -m "feat(api): POST /api/v1/device/:id/session/claim — atomic Take Over"
```

---

### Task 3.8: Amend `POST /api/v1/device/:id/load` for snapshot adoption

**Files:**
- Modify: existing `/device/:id/load` handler in `device.mjs` — accept `application/json` body with `{ dispatchId, snapshot, mode: "adopt" }`.
- Modify: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` — new path that skips content resolution and builds an `adopt-snapshot` command after wake.
- Modify or extend: `WakeAndLoadService.test.mjs`.

TDD:
- POST with `{ mode: "adopt", snapshot }` runs wake → then dispatches an
  `adopt-snapshot` command to the device instead of a bare `contentId` load.
- GET with existing query params still works (regression).
- Idempotency: same `dispatchId` within 60s returns cached result.

**Commit:**

```bash
git commit -m "feat(api): /device/:id/load accepts SessionSnapshot body for Hand Off adoption"
```

---

### Task 3.9: Surface `dispatchId` on `homeline:<deviceId>` events

**Files:**
- Modify: `WakeAndLoadService.mjs` — include `dispatchId` on every `wake-progress` emit.
- Extend existing WakeAndLoadService test.

**Commit:**

```bash
git commit -m "feat(devices): include dispatchId in wake-progress events"
```

---

## Phase 4 — External Control, Idempotency, Error Envelopes

### Task 4.1: `client-control:<clientId>` relay

**Files:**
- Modify: `backend/src/0_system/eventbus/WebSocketEventBus.mjs` — accept
  external publish-only access to `client-control:<clientId>` topics, routed to
  the single subscriber matching that clientId.
- Create: `backend/tests/unit/suite/0_system/eventbus/WebSocketEventBus.clientControl.test.mjs`

TDD:
- Publish on `client-control:c1` from an external source is delivered to the
  browser identified as `c1`.
- Cross-client publish attempts are rejected.
- Command envelope validation is applied at the edge (invalid envelopes
  dropped + logged).

**Commit:**

```bash
git commit -m "feat(eventbus): client-control:<id> topic with envelope validation"
```

---

### Task 4.2: Dispatch idempotency store

**Files:**
- Create: `backend/src/3_applications/devices/services/DispatchIdempotencyService.mjs`
- Create: `backend/tests/unit/suite/3_applications/devices/DispatchIdempotencyService.test.mjs`

In-memory LRU/TTL cache keyed by `dispatchId`. 60s TTL. Used by
`WakeAndLoadService.runWithIdempotency(dispatchId, fn)`.

TDD:
- Same `dispatchId` within TTL returns cached result without re-running.
- Different payload with same `dispatchId` → `IDEMPOTENCY_CONFLICT`.

**Commit:**

```bash
git commit -m "feat(devices): DispatchIdempotencyService — 60s TTL cache"
```

---

### Task 4.3: Command idempotency at `SessionControlService`

**Files:**
- Modify: `SessionControlService.mjs` — add the same pattern for `commandId`.
- Extend its test file.

**Commit:**

```bash
git commit -m "feat(devices): command idempotency in SessionControlService"
```

---

### Task 4.4: Standardize error envelopes across the device router

**Files:**
- Modify: `backend/src/4_api/v1/routers/device.mjs` — route every error
  response through `buildErrorBody` from `@shared-contracts/media`.
- Extend existing test files to assert the error shape + `code` values in §12.2.

**Commit:**

```bash
git commit -m "refactor(api): standardize device-router errors via shared buildErrorBody"
```

---

### Task 4.5: Deprecate legacy `GET /api/v1/device/:id/volume/:level`

**Files:**
- Modify: `backend/src/4_api/v1/routers/device.mjs` — leave the route
  functional but log a `device.volume.deprecated` warn on every call.
- Modify: `docs/reference/media/media-app-technical.md` — note the deprecation.

**Commit:**

```bash
git commit -m "chore(api): deprecate GET /device/:id/volume/:level — use PUT /session/volume"
```

---

## Phase 5 — Integration & Cleanup

### Task 5.1: End-to-end integration test — command round-trip

**Files:**
- Create: `tests/live/api/device-session-roundtrip.runtime.test.mjs`

A single runtime test that:
1. Boots backend.
2. Mounts a fake screen-framework client (`useScreenCommands` + publishers)
   against a mocked `wsService`.
3. POSTs `/api/v1/device/tv-fake/session/transport` with `action: play`.
4. Asserts the fake client receives the envelope, emits an ack, and the
   HTTP response is 200 with `ok: true`.

**Commit:**

```bash
git commit -m "test(live): device-session round-trip integration test"
```

---

### Task 5.2: End-to-end integration test — claim (Take Over) atomicity

Same pattern; exercises §4.6 failure paths.

**Commit:**

```bash
git commit -m "test(live): claim atomicity integration test"
```

---

### Task 5.3: End-to-end integration test — liveness / offline synthesis

Starts the fake device, issues a heartbeat, stops heartbeating, asserts that
within 15s the `device-state:tv-fake` topic receives a synthesized
`reason: "offline"` message with the last snapshot.

**Commit:**

```bash
git commit -m "test(live): offline synthesis integration test"
```

---

### Task 5.4: Doc updates — cross-link plan + reference docs

**Files:**
- Modify: `docs/reference/media/media-app-technical.md` — link the relevant §
  heads to the test files that validate them (e.g., §4.3 → `device.session.test.mjs`).
- Modify: `docs/docs-last-updated.txt` — update marker.

**Commit:**

```bash
git commit -m "docs: cross-link technical contracts to backing tests"
```

---

### Task 5.5: Remove any temporary TODO/FIXME left in the cutover

Run: `rg "TODO|FIXME" shared/contracts/media/ backend/src/3_applications/devices/ backend/src/4_api/v1/routers/device.mjs frontend/src/screen-framework/`

Address each or open a follow-up ticket with a `see:` reference in the plan.

**Commit:**

```bash
git commit -m "chore: clean up foundation-phase TODOs"
```

---

## Done criteria

All of the following are true:

- `npm run test:unit` passes across `shared/`, `backend/`, `frontend/src/screen-framework/`.
- `npm run test:live:api` passes for `tests/live/api/device-session-roundtrip`, `claim-atomicity`, `offline-synthesis`.
- The technical doc (§4 and §6) matches implementation — spot-check by reading each endpoint's test.
- No flat-shape command messages remain in the codebase (`rg` clean).
- `useScreenCommands` consumers all send structured envelopes.
- `docs/docs-last-updated.txt` points to HEAD.

At this point: foundation poured. Next plan is the Media App itself.
