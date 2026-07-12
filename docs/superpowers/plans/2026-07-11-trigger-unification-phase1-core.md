# Trigger Unification — Plan 1 of 6: Additive Core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the unified trigger vocabulary (`TriggerEvent`, `Response`, response-handler registry, named guard stages) and rewire the existing NFC/state path onto it, with **zero behavior change** and all existing tests green.

**Architecture:** Additive strangler-fig step. We add a canonical `TriggerEvent` value object, a discriminated-union `Response` value object, an `intent → Response` mapper (so the existing `NfcResolver`/`StateResolver` internals stay untouched — only their output is normalized), an open `responseHandlers` registry generalizing today's `actionHandlers`, and three named guard stages (`authenticate`/`debounce`/`authorize`) extracted from `TriggerDispatchService`. The service is rewired to `guards → resolve → map → dispatchResponse` while keeping its NFC-specific HA-guard-suppression and unknown-tag capture inline.

**Tech Stack:** Node.js ES modules (`.mjs`), vitest, `#`-prefixed subpath imports (`#domains/*`, `#applications/*`, `#system/*`). No new dependencies.

## Global Constraints

- **Node subpath imports:** use `#domains/*` → `backend/src/2_domains/*`, `#applications/*` (alias `#apps/*`) → `backend/src/3_applications/*`, `#system/*` → `backend/src/0_system/*`. Never relative `../../..`.
- **Layer rules (DDD):** `2_domains/` imports nothing from adapters/apps/system-config; no `Date.now()`/`new Date()` in domain (pass timestamps in). `3_applications/` never imports `1_adapters/`; receives adapters via constructor injection.
- **Test runner:** vitest. Tests live under `tests/isolated/<layer>/<domain>/…test.mjs`. Run a single file with `npx vitest run <path>`; a single test with `npx vitest run <path> -t "<name>"`.
- **No behavior change in this plan.** The existing suites `tests/isolated/application/trigger/TriggerDispatchService.test.mjs`, `tests/isolated/domain/trigger/services/*.test.mjs`, and `tests/isolated/api/routers/trigger*.test.mjs` MUST stay green after every task.
- **Commit after every task** (frequent commits). Branch: `trigger-unification` (already created).
- **Response kinds (this plan):** `content`, `device`, `ha`. (`transport` lands in Plan 3, `script` in Plan 5.) Registry is open — a kind is one handler entry.
- **Content postures:** `authoritative` (implemented here) and `optimistic` (deferred to Plan 3, which brings the ack/broadcast plumbing). Default posture is `authoritative`; requesting `optimistic` with no optimistic dispatcher available falls back to `authoritative` (real fallback, not a stub).

---

## File Structure

**Create:**
- `backend/src/2_domains/trigger/TriggerEvent.mjs` — canonical event value object.
- `backend/src/2_domains/trigger/Response.mjs` — discriminated-union response value object + factories.
- `backend/src/3_applications/trigger/mapIntentToResponse.mjs` — resolver-intent → `Response`.
- `backend/src/3_applications/trigger/responseHandlers.mjs` — `responseHandlers` + `dispatchResponse` (generalizes `actionHandlers`).
- `backend/src/3_applications/trigger/guards/authenticate.mjs` — token/none auth stage.
- `backend/src/3_applications/trigger/guards/debounce.mjs` — per-key-window/off debounce stage.
- `backend/src/3_applications/trigger/guards/authorize.mjs` — none/policy authorize stage.

**Modify:**
- `backend/src/3_applications/trigger/TriggerDispatchService.mjs` — add `handleEvent(triggerEvent, options)`; rewire internals to guards + map + `dispatchResponse`; keep `handleTrigger(...)` as a thin wrapper.

**Tests (create):**
- `tests/isolated/domain/trigger/TriggerEvent.test.mjs`
- `tests/isolated/domain/trigger/Response.test.mjs`
- `tests/isolated/application/trigger/mapIntentToResponse.test.mjs`
- `tests/isolated/application/trigger/responseHandlers.test.mjs`
- `tests/isolated/application/trigger/guards/authenticate.test.mjs`
- `tests/isolated/application/trigger/guards/debounce.test.mjs`
- `tests/isolated/application/trigger/guards/authorize.test.mjs`

`actionHandlers.mjs` stays in place until Plan 3 (barcode) fully replaces its call site; `dispatchResponse` supersedes `dispatchAction` inside the service.

---

## Task 1: `TriggerEvent` value object

**Files:**
- Create: `backend/src/2_domains/trigger/TriggerEvent.mjs`
- Test: `tests/isolated/domain/trigger/TriggerEvent.test.mjs`

**Interfaces:**
- Produces: `class TriggerEvent` with `static create({ source, location, value, meta })` and readonly getters `source`, `location`, `value`, `meta`. `value` is normalized to a lowercased string; `meta` defaults to `{}` and is frozen.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/domain/trigger/TriggerEvent.test.mjs
import { describe, it, expect } from 'vitest';
import { TriggerEvent } from '#domains/trigger/TriggerEvent.mjs';

describe('TriggerEvent', () => {
  it('normalizes value to a lowercased string and defaults meta', () => {
    const e = TriggerEvent.create({ source: 'nfc', location: 'livingroom', value: '04_AB_CD' });
    expect(e.source).toBe('nfc');
    expect(e.location).toBe('livingroom');
    expect(e.value).toBe('04_ab_cd');
    expect(e.meta).toEqual({});
  });

  it('preserves meta and is immutable', () => {
    const e = TriggerEvent.create({ source: 'barcode', location: 'garage', value: 'plex:1', meta: { device: 'ds2278', transport: 'ws' } });
    expect(e.meta.device).toBe('ds2278');
    expect(() => { e.meta.device = 'x'; }).toThrow();
  });

  it('throws when source or location is missing', () => {
    expect(() => TriggerEvent.create({ source: '', location: 'x', value: 'v' })).toThrow();
    expect(() => TriggerEvent.create({ source: 'nfc', location: '', value: 'v' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/domain/trigger/TriggerEvent.test.mjs`
Expected: FAIL — cannot resolve `#domains/trigger/TriggerEvent.mjs`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// backend/src/2_domains/trigger/TriggerEvent.mjs
/**
 * TriggerEvent — canonical, transport-agnostic value object produced by every
 * ingress adapter and consumed by the one dispatch core.
 *
 * Layer: DOMAIN value object (2_domains/trigger). No I/O, no clock.
 *
 * @module domains/trigger/TriggerEvent
 */
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

export class TriggerEvent {
  #source; #location; #value; #meta;

  constructor({ source, location, value, meta }) {
    this.#source = source;
    this.#location = location;
    this.#value = value;
    this.#meta = Object.freeze({ ...(meta || {}) });
    Object.freeze(this);
  }

  /**
   * @param {Object} args
   * @param {string} args.source   modality / source id (e.g. 'nfc', 'barcode')
   * @param {string} args.location origin id (reader/scanner/endpoint)
   * @param {string} args.value    raw payload; normalized to a lowercased string
   * @param {Object} [args.meta]   transport-specific extras (device, timestamp, token, transport)
   * @returns {TriggerEvent}
   * @throws {ValidationError} if source or location is missing
   */
  static create({ source, location, value, meta } = {}) {
    if (!source) throw new ValidationError('TriggerEvent.source required', { code: 'TRIGGER_EVENT_SOURCE' });
    if (!location) throw new ValidationError('TriggerEvent.location required', { code: 'TRIGGER_EVENT_LOCATION' });
    return new TriggerEvent({ source, location, value: String(value ?? '').toLowerCase(), meta });
  }

  get source() { return this.#source; }
  get location() { return this.#location; }
  get value() { return this.#value; }
  get meta() { return this.#meta; }
}

export default TriggerEvent;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/domain/trigger/TriggerEvent.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/trigger/TriggerEvent.mjs tests/isolated/domain/trigger/TriggerEvent.test.mjs
git commit -m "feat(trigger): add TriggerEvent canonical value object"
```

---

## Task 2: `Response` value object (discriminated union)

**Files:**
- Create: `backend/src/2_domains/trigger/Response.mjs`
- Test: `tests/isolated/domain/trigger/Response.test.mjs`

**Interfaces:**
- Produces: `Response` with static factories:
  - `Response.content({ target, expression, posture, end, endLocation })` → `{ kind:'content', ... , posture: posture||'authoritative' }`
  - `Response.device({ target, op, path, params })` → `{ kind:'device', ... }` (`op` ∈ `'open'|'clear'`)
  - `Response.ha({ op, scene, service, entity, data })` → `{ kind:'ha', ... }` (`op` ∈ `'scene'|'service'`)
  - Each returns a frozen plain object with a `kind` field. `expression` is `{ action, contentId, options }`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/domain/trigger/Response.test.mjs
import { describe, it, expect } from 'vitest';
import { Response } from '#domains/trigger/Response.mjs';

describe('Response', () => {
  it('content defaults posture to authoritative', () => {
    const r = Response.content({ target: 'livingroom-tv', expression: { action: 'queue', contentId: 'plex:1', options: { shuffle: true } } });
    expect(r.kind).toBe('content');
    expect(r.target).toBe('livingroom-tv');
    expect(r.posture).toBe('authoritative');
    expect(r.expression).toEqual({ action: 'queue', contentId: 'plex:1', options: { shuffle: true } });
  });

  it('content preserves explicit posture + end behavior', () => {
    const r = Response.content({ target: 't', expression: { action: 'play', contentId: 'plex:2', options: {} }, posture: 'optimistic', end: 'tv-off', endLocation: 'living_room' });
    expect(r.posture).toBe('optimistic');
    expect(r.end).toBe('tv-off');
    expect(r.endLocation).toBe('living_room');
  });

  it('device requires a valid op', () => {
    expect(Response.device({ target: 't', op: 'open', path: '/x' }).kind).toBe('device');
    expect(() => Response.device({ target: 't', op: 'frobnicate' })).toThrow();
  });

  it('ha carries op-specific fields and is frozen', () => {
    const r = Response.ha({ op: 'scene', scene: 'scene.movie' });
    expect(r).toEqual({ kind: 'ha', op: 'scene', scene: 'scene.movie', service: undefined, entity: undefined, data: undefined });
    expect(() => { r.op = 'service'; }).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/domain/trigger/Response.test.mjs`
Expected: FAIL — cannot resolve `#domains/trigger/Response.mjs`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// backend/src/2_domains/trigger/Response.mjs
/**
 * Response — discriminated-union value object: the shared output of every
 * resolver and the shared input of every response handler. Discriminated by
 * `kind`. Additive-open: new kinds are new factories + handler entries.
 *
 * Layer: DOMAIN value object (2_domains/trigger). Pure.
 *
 * @module domains/trigger/Response
 */
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

const DEVICE_OPS = new Set(['open', 'clear']);
const HA_OPS = new Set(['scene', 'service']);

export const Response = {
  /**
   * @param {Object} a
   * @param {string} a.target
   * @param {{action:string, contentId:string, options:Object}} a.expression
   * @param {'authoritative'|'optimistic'} [a.posture='authoritative']
   * @param {string} [a.end]
   * @param {string} [a.endLocation]
   */
  content({ target, expression, posture, end, endLocation } = {}) {
    if (!target) throw new ValidationError('Response.content target required', { code: 'RESPONSE_CONTENT_TARGET' });
    if (!expression || !expression.contentId) throw new ValidationError('Response.content expression.contentId required', { code: 'RESPONSE_CONTENT_EXPR' });
    return Object.freeze({ kind: 'content', target, expression, posture: posture || 'authoritative', end, endLocation });
  },

  /** @param {{target:string, op:'open'|'clear', path?:string, params?:Object}} a */
  device({ target, op, path, params } = {}) {
    if (!target) throw new ValidationError('Response.device target required', { code: 'RESPONSE_DEVICE_TARGET' });
    if (!DEVICE_OPS.has(op)) throw new ValidationError(`Response.device op must be open|clear (got ${op})`, { code: 'RESPONSE_DEVICE_OP' });
    return Object.freeze({ kind: 'device', target, op, path, params });
  },

  /** @param {{op:'scene'|'service', scene?:string, service?:string, entity?:string, data?:Object}} a */
  ha({ op, scene, service, entity, data } = {}) {
    if (!HA_OPS.has(op)) throw new ValidationError(`Response.ha op must be scene|service (got ${op})`, { code: 'RESPONSE_HA_OP' });
    return Object.freeze({ kind: 'ha', op, scene, service, entity, data });
  },
};

export default Response;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/domain/trigger/Response.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/trigger/Response.mjs tests/isolated/domain/trigger/Response.test.mjs
git commit -m "feat(trigger): add Response discriminated-union value object"
```

---

## Task 3: `mapIntentToResponse` — resolver intent → `Response`

**Files:**
- Create: `backend/src/3_applications/trigger/mapIntentToResponse.mjs`
- Test: `tests/isolated/application/trigger/mapIntentToResponse.test.mjs`

**Context:** `ResolverRegistry.resolve(...)` returns the existing intent shape (from `NfcResolver`/`StateResolver`): `{ action, target, params, content?, scene?, service?, entity?, data?, end?, endLocation? }`. This mapper normalizes that to a `Response` without touching the resolvers. Action → kind mapping: `queue|play|play-next` → content; `open|clear` → device; `scene` → ha(scene); `ha-service` → ha(service).

**Interfaces:**
- Consumes: `Response` (Task 2).
- Produces: `mapIntentToResponse(intent, { posture } = {})` → `Response` | `null` (null when `intent` is null). `posture` defaults `'authoritative'` and applies only to content.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/application/trigger/mapIntentToResponse.test.mjs
import { describe, it, expect } from 'vitest';
import { mapIntentToResponse } from '#apps/trigger/mapIntentToResponse.mjs';

describe('mapIntentToResponse', () => {
  it('maps queue/play/play-next to content with expression', () => {
    const r = mapIntentToResponse({ action: 'queue', target: 'livingroom-tv', content: 'plex:456598', params: { shuffle: 1 } });
    expect(r).toMatchObject({ kind: 'content', target: 'livingroom-tv', posture: 'authoritative' });
    expect(r.expression).toEqual({ action: 'queue', contentId: 'plex:456598', options: { shuffle: 1 } });
  });

  it('carries end behavior onto content', () => {
    const r = mapIntentToResponse({ action: 'play-next', target: 't', content: 'plex:1', params: {}, end: 'tv-off', endLocation: 'living_room' });
    expect(r.end).toBe('tv-off');
    expect(r.endLocation).toBe('living_room');
  });

  it('maps open/clear to device', () => {
    expect(mapIntentToResponse({ action: 'open', target: 'office-tv', params: { path: '/videocall', room: 'x' } }))
      .toEqual({ kind: 'device', target: 'office-tv', op: 'open', path: '/videocall', params: { room: 'x' } });
    expect(mapIntentToResponse({ action: 'clear', target: 'office-tv', params: {} }))
      .toEqual({ kind: 'device', target: 'office-tv', op: 'clear', path: undefined, params: {} });
  });

  it('maps scene and ha-service to ha', () => {
    expect(mapIntentToResponse({ action: 'scene', scene: 'scene.movie' })).toEqual({ kind: 'ha', op: 'scene', scene: 'scene.movie', service: undefined, entity: undefined, data: undefined });
    expect(mapIntentToResponse({ action: 'ha-service', service: 'light.turn_on', entity: 'light.x', data: { brightness: 5 } }))
      .toEqual({ kind: 'ha', op: 'service', scene: undefined, service: 'light.turn_on', entity: 'light.x', data: { brightness: 5 } });
  });

  it('returns null for null intent and throws for unknown action', () => {
    expect(mapIntentToResponse(null)).toBeNull();
    expect(() => mapIntentToResponse({ action: 'nope', target: 't' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/application/trigger/mapIntentToResponse.test.mjs`
Expected: FAIL — cannot resolve `#apps/trigger/mapIntentToResponse.mjs`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// backend/src/3_applications/trigger/mapIntentToResponse.mjs
/**
 * Normalize a resolver intent into a Response. Keeps the existing resolvers
 * (NfcResolver/StateResolver) untouched — only their output is converged here.
 *
 * Layer: APPLICATION (3_applications/trigger).
 *
 * @module applications/trigger/mapIntentToResponse
 */
import { Response } from '#domains/trigger/Response.mjs';

const CONTENT_ACTIONS = new Set(['queue', 'play', 'play-next']);

/**
 * @param {Object|null} intent  resolver output { action, target, params, content?, scene?, service?, entity?, data?, end?, endLocation? }
 * @param {Object} [opts]
 * @param {'authoritative'|'optimistic'} [opts.posture='authoritative']
 * @returns {Object|null} Response, or null if intent is null
 * @throws {Error} on an unknown action
 */
export function mapIntentToResponse(intent, { posture = 'authoritative' } = {}) {
  if (!intent) return null;
  const { action } = intent;

  if (CONTENT_ACTIONS.has(action)) {
    return Response.content({
      target: intent.target,
      expression: { action, contentId: intent.content, options: intent.params || {} },
      posture,
      end: intent.end,
      endLocation: intent.endLocation,
    });
  }
  if (action === 'open') {
    const { path, ...params } = intent.params || {};
    return Response.device({ target: intent.target, op: 'open', path, params });
  }
  if (action === 'clear') {
    return Response.device({ target: intent.target, op: 'clear', path: undefined, params: intent.params || {} });
  }
  if (action === 'scene') {
    return Response.ha({ op: 'scene', scene: intent.scene });
  }
  if (action === 'ha-service') {
    return Response.ha({ op: 'service', service: intent.service, entity: intent.entity, data: intent.data });
  }
  throw new Error(`mapIntentToResponse: unknown action "${action}"`);
}

export default mapIntentToResponse;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/application/trigger/mapIntentToResponse.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/trigger/mapIntentToResponse.mjs tests/isolated/application/trigger/mapIntentToResponse.test.mjs
git commit -m "feat(trigger): add mapIntentToResponse (resolver intent -> Response)"
```

---

## Task 4: `responseHandlers` + `dispatchResponse`

**Files:**
- Create: `backend/src/3_applications/trigger/responseHandlers.mjs`
- Test: `tests/isolated/application/trigger/responseHandlers.test.mjs`

**Context:** Generalizes `actionHandlers.mjs`. `deps` are the same objects the current service passes: `{ wakeAndLoadService, deviceService, haGateway }`. Content authoritative path replicates today's `actionHandlers.queue/play/play-next` → `wakeAndLoadService.execute(target, query, loadOptions)` with `query = { ...options, [action]: contentId }` and `play-next` adding `op:'play-next'`. `loadOptions = { dispatchId, endBehavior?, endLocation? }`. Optimistic posture is deferred (Plan 3); with no `contentDispatcher.optimistic` available it falls back to authoritative.

**Interfaces:**
- Consumes: `Response` (Task 2).
- Produces:
  - `responseHandlers` — object keyed by kind: `content`, `device`, `ha`.
  - `dispatchResponse(response, deps)` → `Promise<any>`; throws `UnknownResponseKindError` for an unregistered kind.
  - `class UnknownResponseKindError extends Error` with `.kind`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/application/trigger/responseHandlers.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { dispatchResponse, UnknownResponseKindError } from '#apps/trigger/responseHandlers.mjs';
import { Response } from '#domains/trigger/Response.mjs';

const deps = () => ({
  wakeAndLoadService: { execute: vi.fn().mockResolvedValue({ ok: true }) },
  deviceService: { get: vi.fn(() => ({ loadContent: vi.fn().mockResolvedValue('loaded'), clearContent: vi.fn().mockResolvedValue('cleared') })) },
  haGateway: { callService: vi.fn().mockResolvedValue('ha-ok') },
});

describe('dispatchResponse', () => {
  it('content authoritative → wakeAndLoad with query keyed by action', async () => {
    const d = deps();
    const r = Response.content({ target: 'livingroom-tv', expression: { action: 'queue', contentId: 'plex:1', options: { shuffle: 1 } }, end: 'tv-off', endLocation: 'living_room' });
    await dispatchResponse({ ...r, dispatchId: 'd1' }, d);
    expect(d.wakeAndLoadService.execute).toHaveBeenCalledWith(
      'livingroom-tv',
      { shuffle: 1, queue: 'plex:1' },
      { dispatchId: 'd1', endBehavior: 'tv-off', endLocation: 'living_room' },
    );
  });

  it('content play-next adds op:play-next', async () => {
    const d = deps();
    const r = Response.content({ target: 't', expression: { action: 'play-next', contentId: 'plex:2', options: {} } });
    await dispatchResponse({ ...r, dispatchId: 'd2' }, d);
    expect(d.wakeAndLoadService.execute).toHaveBeenCalledWith('t', { 'play-next': 'plex:2', op: 'play-next' }, { dispatchId: 'd2' });
  });

  it('optimistic posture falls back to authoritative when no optimistic dispatcher', async () => {
    const d = deps();
    const r = Response.content({ target: 't', expression: { action: 'play', contentId: 'plex:3', options: {} }, posture: 'optimistic' });
    await dispatchResponse({ ...r, dispatchId: 'd3' }, d);
    expect(d.wakeAndLoadService.execute).toHaveBeenCalledWith('t', { play: 'plex:3' }, { dispatchId: 'd3' });
  });

  it('device open → deviceService.get(target).loadContent(path, params)', async () => {
    const d = deps();
    const dev = { loadContent: vi.fn().mockResolvedValue('ok'), clearContent: vi.fn() };
    d.deviceService.get = vi.fn(() => dev);
    await dispatchResponse(Response.device({ target: 'office-tv', op: 'open', path: '/videocall', params: { room: 'x' } }), d);
    expect(dev.loadContent).toHaveBeenCalledWith('/videocall', { room: 'x' });
  });

  it('ha scene → haGateway.callService(scene, turn_on, {entity_id})', async () => {
    const d = deps();
    await dispatchResponse(Response.ha({ op: 'scene', scene: 'scene.movie' }), d);
    expect(d.haGateway.callService).toHaveBeenCalledWith('scene', 'turn_on', { entity_id: 'scene.movie' });
  });

  it('throws UnknownResponseKindError for an unregistered kind', async () => {
    await expect(dispatchResponse({ kind: 'nope' }, deps())).rejects.toBeInstanceOf(UnknownResponseKindError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/application/trigger/responseHandlers.test.mjs`
Expected: FAIL — cannot resolve `#apps/trigger/responseHandlers.mjs`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// backend/src/3_applications/trigger/responseHandlers.mjs
/**
 * Open response-handler registry. Generalizes actionHandlers: dispatch by
 * Response.kind. deps = { wakeAndLoadService, deviceService, haGateway }.
 *
 * Layer: APPLICATION (3_applications/trigger).
 *
 * @module applications/trigger/responseHandlers
 */
import { randomUUID } from 'node:crypto';

export class UnknownResponseKindError extends Error {
  constructor(kind) {
    super(`Unknown response kind: ${kind}`);
    this.name = 'UnknownResponseKindError';
    this.kind = kind;
  }
}

function buildContentQuery(expression) {
  const { action, contentId, options } = expression;
  if (action === 'play-next') {
    return { ...(options || {}), 'play-next': contentId, op: 'play-next' };
  }
  return { ...(options || {}), [action]: contentId };
}

function buildLoadOptions(response) {
  const opts = { dispatchId: response.dispatchId || randomUUID() };
  if (response.end) {
    opts.endBehavior = response.end;
    if (response.endLocation) opts.endLocation = response.endLocation;
  }
  return opts;
}

export const responseHandlers = {
  // Content: authoritative goes straight to wake-and-load. Optimistic posture
  // (broadcast + ack + fallback) is provided by an injected contentDispatcher
  // in Plan 3; absent that, fall back to authoritative (real behavior).
  content: async (response, deps) => {
    const query = buildContentQuery(response.expression);
    const loadOptions = buildLoadOptions(response);
    if (response.posture === 'optimistic' && deps.contentDispatcher?.optimistic) {
      return deps.contentDispatcher.optimistic(response.target, query, loadOptions);
    }
    return deps.wakeAndLoadService.execute(response.target, query, loadOptions);
  },

  device: async (response, deps) => {
    const device = deps.deviceService.get(response.target);
    if (!device) throw new Error(`Unknown target device: ${response.target}`);
    if (response.op === 'clear') return device.clearContent();
    if (!response.path) throw new Error('device open requires a path');
    return device.loadContent(response.path, response.params || {});
  },

  ha: async (response, deps) => {
    if (response.op === 'scene') {
      return deps.haGateway.callService('scene', 'turn_on', { entity_id: response.scene });
    }
    const [domain, service] = String(response.service || '').split('.');
    if (!domain || !service) throw new Error(`Invalid ha service: ${response.service}`);
    const data = { ...(response.data || {}) };
    if (response.entity) data.entity_id = response.entity;
    return deps.haGateway.callService(domain, service, data);
  },
};

export async function dispatchResponse(response, deps) {
  const handler = responseHandlers[response.kind];
  if (!handler) throw new UnknownResponseKindError(response.kind);
  return handler(response, deps);
}

export default { responseHandlers, dispatchResponse, UnknownResponseKindError };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/application/trigger/responseHandlers.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/trigger/responseHandlers.mjs tests/isolated/application/trigger/responseHandlers.test.mjs
git commit -m "feat(trigger): add responseHandlers registry + dispatchResponse"
```

---

## Task 5: Guard stages (`authenticate`, `debounce`, `authorize`)

**Files:**
- Create: `backend/src/3_applications/trigger/guards/authenticate.mjs`
- Create: `backend/src/3_applications/trigger/guards/debounce.mjs`
- Create: `backend/src/3_applications/trigger/guards/authorize.mjs`
- Test: `tests/isolated/application/trigger/guards/authenticate.test.mjs`
- Test: `tests/isolated/application/trigger/guards/debounce.test.mjs`
- Test: `tests/isolated/application/trigger/guards/authorize.test.mjs`

**Context:** These extract the auth + debounce logic currently inline in `TriggerDispatchService`. Each stage is a pure-ish function returning a structured result; the service composes them. `debounce` keeps its own `Map` + prune (a small stateful helper factory) — matching the existing 30s window semantics (set key before dispatch; caller deletes on failure).

**Interfaces:**
- Produces:
  - `authenticate({ expectedToken, providedToken })` → `{ ok: true }` | `{ ok: false, code: 'AUTH_FAILED' }`. Passes when `expectedToken` is falsy (no auth configured) or equals `providedToken`.
  - `createDebounce({ windowMs, clock })` → `{ check(key, now), set(key, now), delete(key) }`. `check` prunes then returns `{ debounced: false }` or `{ debounced: true, sinceMs }`.
  - `authorize({ policy, strategies, context })` → `Promise<{ approved: true }>` | `{ approved: false, reason }`. Default (`policy` falsy / no strategies) approves. (Full gatekeeper strategies arrive in Plan 3; this file defines the seam + the no-op default.)

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/isolated/application/trigger/guards/authenticate.test.mjs
import { describe, it, expect } from 'vitest';
import { authenticate } from '#apps/trigger/guards/authenticate.mjs';

describe('authenticate', () => {
  it('passes when no token is configured', () => {
    expect(authenticate({ expectedToken: null, providedToken: undefined })).toEqual({ ok: true });
  });
  it('passes when tokens match', () => {
    expect(authenticate({ expectedToken: 'abc', providedToken: 'abc' })).toEqual({ ok: true });
  });
  it('fails when tokens differ', () => {
    expect(authenticate({ expectedToken: 'abc', providedToken: 'x' })).toEqual({ ok: false, code: 'AUTH_FAILED' });
  });
});
```

```javascript
// tests/isolated/application/trigger/guards/debounce.test.mjs
import { describe, it, expect } from 'vitest';
import { createDebounce } from '#apps/trigger/guards/debounce.mjs';

describe('createDebounce', () => {
  it('first check passes, repeat within window is debounced', () => {
    const d = createDebounce({ windowMs: 30000 });
    expect(d.check('k', 1000)).toEqual({ debounced: false });
    d.set('k', 1000);
    expect(d.check('k', 5000)).toEqual({ debounced: true, sinceMs: 4000 });
  });
  it('passes again after the window and prunes stale keys', () => {
    const d = createDebounce({ windowMs: 30000 });
    d.set('k', 1000);
    expect(d.check('k', 40000)).toEqual({ debounced: false });
  });
  it('delete clears a key', () => {
    const d = createDebounce({ windowMs: 30000 });
    d.set('k', 1000);
    d.delete('k');
    expect(d.check('k', 2000)).toEqual({ debounced: false });
  });
});
```

```javascript
// tests/isolated/application/trigger/guards/authorize.test.mjs
import { describe, it, expect } from 'vitest';
import { authorize } from '#apps/trigger/guards/authorize.mjs';

describe('authorize', () => {
  it('approves by default (no strategies)', async () => {
    expect(await authorize({ strategies: [], context: {} })).toEqual({ approved: true });
  });
  it('denies when a strategy denies', async () => {
    const deny = { evaluate: async () => ({ approved: false, reason: 'nope' }) };
    expect(await authorize({ strategies: [deny], context: {} })).toEqual({ approved: false, reason: 'nope' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/isolated/application/trigger/guards/`
Expected: FAIL — cannot resolve the three guard modules.

- [ ] **Step 3: Write minimal implementations**

```javascript
// backend/src/3_applications/trigger/guards/authenticate.mjs
/**
 * Authenticate stage. Passes when no token is configured for the (source,
 * location) or when the provided token matches. Layer: APPLICATION.
 * @module applications/trigger/guards/authenticate
 */
export function authenticate({ expectedToken, providedToken }) {
  if (expectedToken && expectedToken !== providedToken) {
    return { ok: false, code: 'AUTH_FAILED' };
  }
  return { ok: true };
}
export default authenticate;
```

```javascript
// backend/src/3_applications/trigger/guards/debounce.mjs
/**
 * Debounce stage factory. Per-key sliding window with prune-on-check.
 * Mirrors the 30s window semantics previously inline in TriggerDispatchService.
 * Layer: APPLICATION.
 * @module applications/trigger/guards/debounce
 */
export function createDebounce({ windowMs = 30000 } = {}) {
  const recent = new Map(); // key -> timestampMs
  const prune = (now) => {
    for (const [k, ts] of recent) if (now - ts > windowMs) recent.delete(k);
  };
  return {
    check(key, now) {
      prune(now);
      const last = recent.get(key);
      if (last != null && now - last < windowMs) return { debounced: true, sinceMs: now - last };
      return { debounced: false };
    },
    set(key, now) { recent.set(key, now); },
    delete(key) { recent.delete(key); },
  };
}
export default createDebounce;
```

```javascript
// backend/src/3_applications/trigger/guards/authorize.mjs
/**
 * Authorize stage. Runs an ordered strategy list (first denial wins); default
 * (no strategies) approves. Gatekeeper strategies are wired in Plan 3.
 * Layer: APPLICATION.
 * @module applications/trigger/guards/authorize
 */
export async function authorize({ strategies = [], context = {} } = {}) {
  for (const strategy of strategies) {
    const result = await strategy.evaluate(context);
    if (result && result.approved === false) return { approved: false, reason: result.reason };
  }
  return { approved: true };
}
export default authorize;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/isolated/application/trigger/guards/`
Expected: PASS (8 tests across 3 files).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/trigger/guards tests/isolated/application/trigger/guards
git commit -m "feat(trigger): add authenticate/debounce/authorize guard stages"
```

---

## Task 6: Rewire `TriggerDispatchService` onto the new core

**Files:**
- Modify: `backend/src/3_applications/trigger/TriggerDispatchService.mjs`
- Test: `tests/isolated/application/trigger/TriggerDispatchService.test.mjs` (existing — must stay green; add cases)

**Context:** Replace the inline debounce `Map` with `createDebounce`, keep the inline `authenticate` check via the `authenticate` guard, and replace `dispatchAction(intent, deps)` with `mapIntentToResponse(intent)` → `dispatchResponse(response, deps)`. Preserve every existing return code and log event verbatim (`trigger.fired`, `trigger.debounced`, codes `AUTH_FAILED`/`LOCATION_NOT_FOUND`/`TRIGGER_NOT_REGISTERED`/`UNKNOWN_MODALITY`/`INVALID_INTENT`/`DISPATCH_FAILED`). Keep `#suppressGuardForTarget` and `#handleUnknownNfc` exactly as-is. Add `handleEvent(triggerEvent, options)`; make `handleTrigger(location, modality, value, options)` build a `TriggerEvent` and delegate.

**Interfaces:**
- Consumes: `mapIntentToResponse` (Task 3), `dispatchResponse` + `UnknownResponseKindError` (Task 4), `authenticate` (Task 5), `createDebounce` (Task 5), `TriggerEvent` (Task 1).
- Produces: unchanged public method `handleTrigger(location, modality, value, options)` (same return shapes); new `handleEvent(triggerEvent, options)` with identical semantics.

- [ ] **Step 1: Add characterization test cases for the rewire**

Append to `tests/isolated/application/trigger/TriggerDispatchService.test.mjs` (keep existing tests). These assert the new wiring calls `wakeAndLoadService.execute` and that `handleEvent` matches `handleTrigger`:

```javascript
// --- appended: unified-core wiring ---
import { TriggerEvent } from '#domains/trigger/TriggerEvent.mjs';

describe('TriggerDispatchService (unified core)', () => {
  function make(registry, wake) {
    const wakeAndLoadService = { execute: wake || (async () => ({ ok: true })) };
    return new TriggerDispatchService({
      config: registry,
      contentIdResolver: { resolve: () => true },
      wakeAndLoadService,
      haGateway: { callService: async () => 'ok' },
      deviceService: { get: () => ({ loadContent: async () => 'ok', clearContent: async () => 'ok' }) },
      broadcast: () => {},
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      clock: () => 1000,
    });
  }
  const registry = { nfc: { locations: { livingroom: { target: 'livingroom-tv', action: 'queue' } }, tags: { 'aa': { plex: '456598' } } }, state: { locations: {} } };

  it('dispatches an nfc content trigger via wakeAndLoad', async () => {
    const calls = [];
    const svc = make(registry, async (...a) => { calls.push(a); return { ok: true }; });
    const res = await svc.handleTrigger('livingroom', 'nfc', 'aa', {});
    expect(res.ok).toBe(true);
    expect(calls[0][0]).toBe('livingroom-tv');
    expect(calls[0][1]).toMatchObject({ queue: 'plex:456598' });
  });

  it('handleEvent(TriggerEvent) matches handleTrigger', async () => {
    const svc = make(registry);
    const viaEvent = await svc.handleEvent(TriggerEvent.create({ source: 'nfc', location: 'livingroom', value: 'aa' }), {});
    expect(viaEvent.ok).toBe(true);
    expect(viaEvent.action).toBe('queue');
  });
});
```

- [ ] **Step 2: Run the suite to see the new cases fail**

Run: `npx vitest run tests/isolated/application/trigger/TriggerDispatchService.test.mjs`
Expected: existing tests PASS; the two new cases FAIL (`handleEvent` is not a function / dispatch path not wired).

- [ ] **Step 3: Rewire the service**

Edit `backend/src/3_applications/trigger/TriggerDispatchService.mjs`:

Replace the import of `dispatchAction`:
```javascript
// remove:
import { dispatchAction, UnknownActionError } from './actionHandlers.mjs';
// add:
import { dispatchResponse, UnknownResponseKindError } from './responseHandlers.mjs';
import { mapIntentToResponse } from './mapIntentToResponse.mjs';
import { authenticate } from './guards/authenticate.mjs';
import { createDebounce } from './guards/debounce.mjs';
import { TriggerEvent } from '#domains/trigger/TriggerEvent.mjs';
```

In the constructor, replace the `#recentDispatches = new Map()` field usage with a debounce helper. Add a private field `#debounce` and initialize it:
```javascript
// in constructor, after reading debounceWindowMs:
this.#debounce = createDebounce({ windowMs: this.#debounceWindowMs });
```
Delete the `#recentDispatches` field and the `#pruneDispatches` method (the helper owns pruning).

Replace the auth check block:
```javascript
// old:
const authToken = this.#lookupAuthToken(modality, location);
if (authToken && authToken !== options.token) {
  this.#logger.warn?.('trigger.fired', { location, modality, value: normalizedValue, error: 'auth-failed' });
  return { ok: false, code: 'AUTH_FAILED', error: 'Authentication failed', location, modality, value: normalizedValue, dispatchId };
}
// new:
const auth = authenticate({ expectedToken: this.#lookupAuthToken(modality, location), providedToken: options.token });
if (!auth.ok) {
  this.#logger.warn?.('trigger.fired', { location, modality, value: normalizedValue, error: 'auth-failed' });
  return { ok: false, code: 'AUTH_FAILED', error: 'Authentication failed', location, modality, value: normalizedValue, dispatchId };
}
```

Replace the debounce block (the `this.#pruneDispatches(startedAt)` / `this.#recentDispatches.get/set` usage) with the helper:
```javascript
const debounceKey = `${location}:${modality}:${normalizedValue}`;
if (!options.dryRun) {
  const { debounced, sinceMs } = this.#debounce.check(debounceKey, startedAt);
  if (debounced) {
    this.#logger.info?.('trigger.debounced', { location, modality, value: normalizedValue, sinceMs, windowMs: this.#debounceWindowMs, dispatchId });
    return { ok: true, debounced: true, location, modality, value: normalizedValue, dispatchId, sinceMs };
  }
  this.#debounce.set(debounceKey, startedAt);
}
```
Update the three other `this.#recentDispatches.set/delete(...)` call sites (unknown-branch extend, success refresh, failure delete) to `this.#debounce.set(debounceKey, this.#clock())` / `this.#debounce.delete(debounceKey)`.

Replace the dispatch block:
```javascript
// old:
const dispatchResult = await dispatchAction(intent, this.#deps);
// new:
const response = { ...mapIntentToResponse(intent), dispatchId };
const dispatchResult = await dispatchResponse(response, this.#deps);
```
And in the surrounding `catch`, change the error-code check:
```javascript
const code = err instanceof UnknownResponseKindError ? 'UNKNOWN_ACTION' : 'DISPATCH_FAILED';
```

Finally, add `handleEvent` and make `handleTrigger` delegate. Rename the current body of `handleTrigger` to `handleEvent(event, options = {})`, reading `location`/`modality`/`value` from the event:
```javascript
async handleEvent(event, options = {}) {
  const location = event.location;
  const modality = event.source;
  const value = event.value;
  // ... (existing body, unchanged, already lowercases value defensively)
}

async handleTrigger(location, modality, value, options = {}) {
  return this.handleEvent(TriggerEvent.create({ source: modality, location, value }), options);
}
```

- [ ] **Step 4: Run the trigger suites to verify green**

Run: `npx vitest run tests/isolated/application/trigger/ tests/isolated/api/routers/trigger.test.mjs tests/isolated/api/routers/trigger.sideEffect.test.mjs`
Expected: PASS (all existing + the two new cases).

- [ ] **Step 5: Delete the now-unused `#lookupAuthToken`? No — keep it** (still used to source `expectedToken`). Confirm no references to `dispatchAction`/`UnknownActionError`/`#recentDispatches`/`#pruneDispatches` remain:

Run: `grep -n "dispatchAction\|UnknownActionError\|#recentDispatches\|#pruneDispatches" backend/src/3_applications/trigger/TriggerDispatchService.mjs`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/trigger/TriggerDispatchService.mjs tests/isolated/application/trigger/TriggerDispatchService.test.mjs
git commit -m "refactor(trigger): rewire TriggerDispatchService onto Response core + guards"
```

---

## Task 7: Full trigger + regression sweep

**Files:**
- Test: run the trigger/barcode/api suites together (no new files).

**Context:** Confirm the additive core changed no behavior across every touched suite before this plan is considered done.

- [ ] **Step 1: Run all trigger-adjacent isolated suites**

Run: `npx vitest run tests/isolated/domain/trigger tests/isolated/application/trigger tests/isolated/adapter/trigger tests/isolated/api/routers/trigger.test.mjs tests/isolated/api/routers/trigger.sideEffect.test.mjs`
Expected: PASS (all).

- [ ] **Step 2: Confirm the barcode suites are untouched (they must still pass — barcode is not migrated until Plan 3)**

Run: `npx vitest run tests/isolated/domain/barcode tests/isolated/assembly/barcode`
Expected: PASS (all).

- [ ] **Step 3: Run the full isolated suite to catch cross-cutting regressions**

Run: `npm run test:isolated`
Expected: PASS (no new failures attributable to this plan).

- [ ] **Step 4: Commit a checkpoint (if any incidental fixups were needed)**

```bash
git commit --allow-empty -m "test(trigger): Plan 1 additive core green across trigger + barcode + isolated suites"
```

---

## Self-Review

- **Spec coverage (Plan 1 slice):** `TriggerEvent` (Task 1) ✓; `Response` union `content`/`device`/`ha` (Task 2) ✓; resolver→Response convergence without touching resolvers (Task 3, honoring "only outputs converge") ✓; open `responseHandlers` + `dispatchResponse` (Task 4) ✓; content posture field + authoritative impl + optimistic-deferred fallback (Tasks 2, 4) ✓; named guard stages `authenticate`/`debounce`/`authorize` (Task 5) ✓; service rewired preserving codes/logs + `handleEvent` (Task 6) ✓; no-behavior-change verified (Task 7) ✓. Deferred to later plans (correctly out of this slice): `transport` handler + barcode fold-in (Plan 3), config restructure (Plan 2), `script`/`endpointGateway` (Plan 5), unified logging vocabulary (Plan 6).
- **Type consistency:** `Response.content` shape `{ kind, target, expression:{action,contentId,options}, posture, end, endLocation }` is produced by `mapIntentToResponse` (Task 3) and consumed by `responseHandlers.content` (Task 4) — matches. `dispatchResponse(response, deps)` / `UnknownResponseKindError` names match between Tasks 4 and 6. `createDebounce().{check,set,delete}` match between Tasks 5 and 6. `TriggerEvent.create({source,location,value,meta})` matches between Tasks 1 and 6.
- **Placeholder scan:** none — every code/test step carries complete code; the one "optimistic" deferral is a real fallback to authoritative, not a stub.

---

## Roadmap — the remaining plans (written as we reach each)

| Plan | Scope | Ships |
|---|---|---|
| **1 (this)** | Additive core: `TriggerEvent`, `Response`, guards, `responseHandlers`, service rewire | NFC/state on the unified core, zero behavior change |
| **2** | Config restructure: ECA layout (`sources.yml`/`responses.yml`/`endpoints.yml`/`bindings/`), config↔state split (NFC observed → `history/`), one-time migration script, `buildTriggerRegistry` + `YamlTriggerConfigRepository` updates, derived target registry | New config format live; placeholders written to `history/`, not `config/` |
| **3** | Fold in barcode: `BarcodeResolver` (wraps `BarcodePayload`), `transport` handler (from `BarcodeCommandMap`), barcode ingress adapter (retarget `barcodeRelay.mjs` → `TriggerEvent`), gatekeeper→`authorize`, add barcode debounce, `content` optimistic posture (ack/broadcast/fallback), parity tests | Barcode on the unified core |
| **4** | Retire `2_domains/barcode` + `BarcodeScanService` + `actionHandlers.mjs`; delete dead MQTT adapter | Old barcode pipeline gone |
| **5** | `script` response kind + `endpointGateway` port/adapter + `endpoints.yml`; (optional) `playback-hub` kind reusing `IPlaybackHubGateway` | Net-new capability |
| **6** | Unify logging vocabulary (`trigger.event.ingested/resolved/dispatched` with `source`) + WS event shape; retire split `trigger.fired`/`barcode.*` namespaces | One observability surface |
