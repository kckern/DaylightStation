# Trigger Unification — Plan 5 of 6: Script / Endpoint Response Kind

> **For agentic workers:** superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Add the net-new `script` response kind — a trigger can call a *named* internal/external endpoint declared in `endpoints.yml`, via an injected `endpointGateway` port. This is the "custom triggers for scripts/endpoints" capability.

**Architecture:** `Response.script({ ref, params })` → `responseHandlers.script` → `deps.endpointGateway.call(ref, params)`. `HttpEndpointGateway` (adapter) resolves the named endpoint from the registry's `endpoints` slice and makes an HTTP call (global `fetch`). NFC bindings produce a script response via `action: script` + `endpoint: <name>`. No secrets or URLs in tag data — only the endpoint *name*; the URL/headers live in `endpoints.yml`.

**Tech Stack:** Node ESM, vitest, global `fetch` (Node 18+, container-available). No new deps.

## Global Constraints

- **Named endpoints only.** A `script` response carries `ref` (endpoint name) + `params`, never a raw URL. `endpoints.yml`: `{ [name]: { method, url, headers? } }` (already parsed into `registry.endpoints` by `parseNamedMap`).
- **Port/adapter split (DDD):** `IEndpointGateway` port in `3_applications/trigger/ports/`; `HttpEndpointGateway` concrete in `1_adapters/`. The dispatch core depends on the port; bootstrap injects the concrete.
- **Response kinds after this plan:** content, transport, device, ha, script.
- **No behavior change to existing kinds.** Purely additive.
- **Unknown endpoint ref** → the gateway logs `trigger.script.unknown_endpoint` and no-ops (does not throw a dispatch failure).
- Test runner vitest; TDD; commit per task. Branch `trigger-unification`.

## File Structure

**Create:**
- `backend/src/3_applications/trigger/ports/IEndpointGateway.mjs`
- `backend/src/1_adapters/trigger/HttpEndpointGateway.mjs`

**Modify:**
- `backend/src/2_domains/trigger/Response.mjs` — add `Response.script`.
- `backend/src/3_applications/trigger/responseHandlers.mjs` — add `script` handler.
- `backend/src/2_domains/trigger/services/NfcResolver.mjs` — recognize `endpoint` field.
- `backend/src/3_applications/trigger/mapIntentToResponse.mjs` — `script` action → `Response.script`.
- `backend/src/5_composition/modules/triggerApi.mjs` — build + inject `endpointGateway`.

---

## Task 1: `Response.script` + `script` handler

**Files:**
- Modify: `backend/src/2_domains/trigger/Response.mjs`
- Modify: `backend/src/3_applications/trigger/responseHandlers.mjs`
- Test: `tests/isolated/domain/trigger/Response.script.test.mjs`, `tests/isolated/application/trigger/responseHandlers.script.test.mjs`

**Interfaces:**
- `Response.script({ ref, params })` → `{ kind:'script', ref, params }` (frozen); throws `ValidationError` (code `RESPONSE_SCRIPT_REF`) if `ref` missing.
- `responseHandlers.script(response, deps)` → `deps.endpointGateway.call(response.ref, response.params)`.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/isolated/domain/trigger/Response.script.test.mjs
import { describe, it, expect } from 'vitest';
import { Response } from '#domains/trigger/Response.mjs';
describe('Response.script', () => {
  it('builds a script response', () => {
    expect(Response.script({ ref: 'bedtime', params: { x: 1 } })).toEqual({ kind: 'script', ref: 'bedtime', params: { x: 1 } });
  });
  it('requires ref', () => { expect(() => Response.script({})).toThrow(); });
});
```

```javascript
// tests/isolated/application/trigger/responseHandlers.script.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { dispatchResponse } from '#apps/trigger/responseHandlers.mjs';
describe('script handler', () => {
  it('calls endpointGateway.call(ref, params)', async () => {
    const endpointGateway = { call: vi.fn().mockResolvedValue('ok') };
    await dispatchResponse({ kind: 'script', ref: 'bedtime', params: { x: 1 } }, { endpointGateway });
    expect(endpointGateway.call).toHaveBeenCalledWith('bedtime', { x: 1 });
  });
});
```

- [ ] **Step 2: Run → fail** (`RESPONSE_SCRIPT_REF` missing / `UnknownResponseKindError: script`).

Run: `npx vitest run tests/isolated/domain/trigger/Response.script.test.mjs tests/isolated/application/trigger/responseHandlers.script.test.mjs`

- [ ] **Step 3: Implement**

In `Response.mjs`, add to the `Response` object:
```javascript
  /** @param {{ref:string, params?:Object}} a */
  script({ ref, params } = {}) {
    if (!ref) throw new ValidationError('Response.script ref required', { code: 'RESPONSE_SCRIPT_REF' });
    return Object.freeze({ kind: 'script', ref, params });
  },
```

In `responseHandlers.mjs`, add to `responseHandlers`:
```javascript
  script: async (response, deps) => {
    if (!deps.endpointGateway?.call) {
      deps.logger?.warn?.('trigger.script.no_gateway', { ref: response.ref });
      return;
    }
    return deps.endpointGateway.call(response.ref, response.params);
  },
```

- [ ] **Step 4: Run → pass** (both). Also run `responseHandlers.test.mjs` (unchanged, green).
- [ ] **Step 5: Commit** `feat(trigger): add script response kind + handler`.

---

## Task 2: `IEndpointGateway` port + `HttpEndpointGateway` adapter

**Files:**
- Create: `backend/src/3_applications/trigger/ports/IEndpointGateway.mjs`
- Create: `backend/src/1_adapters/trigger/HttpEndpointGateway.mjs`
- Test: `tests/isolated/adapter/trigger/HttpEndpointGateway.test.mjs`

**Context:** The adapter holds the endpoints map (`{ [name]: { method, url, headers } }`) and a `fetchFn` (injectable; defaults to global `fetch`). `call(ref, params)` looks up the endpoint; unknown → log + no-op (return null); known → `fetchFn(url, { method, headers, body: JSON.stringify(params) })` for non-GET, or append no body for GET.

**Interfaces:**
- `IEndpointGateway` = `{ async call(ref, params) {} }` (shape doc + `isEndpointGateway`).
- `HttpEndpointGateway` `constructor({ endpoints, fetchFn = fetch, logger })`; `call(ref, params)` → `Promise<any|null>`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/adapter/trigger/HttpEndpointGateway.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { HttpEndpointGateway } from '#adapters/trigger/HttpEndpointGateway.mjs';

describe('HttpEndpointGateway', () => {
  const endpoints = { bedtime: { method: 'POST', url: 'http://x/api', headers: { 'X-A': '1' } } };
  it('POSTs to the named endpoint with JSON body', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    const gw = new HttpEndpointGateway({ endpoints, fetchFn });
    await gw.call('bedtime', { a: 1 });
    expect(fetchFn).toHaveBeenCalledWith('http://x/api', expect.objectContaining({ method: 'POST', headers: { 'X-A': '1' }, body: JSON.stringify({ a: 1 }) }));
  });
  it('no-ops (returns null) on an unknown endpoint', async () => {
    const fetchFn = vi.fn();
    const logger = { warn: vi.fn() };
    const gw = new HttpEndpointGateway({ endpoints, fetchFn, logger });
    const r = await gw.call('nope', {});
    expect(r).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('trigger.script.unknown_endpoint', expect.objectContaining({ ref: 'nope' }));
  });
  it('GET sends no body', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    const gw = new HttpEndpointGateway({ endpoints: { ping: { method: 'GET', url: 'http://x/ping' } }, fetchFn });
    await gw.call('ping', { a: 1 });
    const opts = fetchFn.mock.calls[0][1];
    expect(opts.method).toBe('GET');
    expect(opts.body).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run → fail** (module missing).
- [ ] **Step 3: Implement**

```javascript
// backend/src/3_applications/trigger/ports/IEndpointGateway.mjs
/**
 * Port: what the trigger app needs to call a named endpoint/script.
 * @module applications/trigger/ports/IEndpointGateway
 */
export const IEndpointGateway = { async call(_ref, _params) {} };
export function isEndpointGateway(o) { return !!o && typeof o.call === 'function'; }
export default IEndpointGateway;
```

```javascript
// backend/src/1_adapters/trigger/HttpEndpointGateway.mjs
/**
 * HTTP implementation of IEndpointGateway. Resolves a named endpoint from config
 * and makes the call. Never accepts a raw URL from a caller — only the name.
 * Layer: ADAPTER (1_adapters/trigger).
 * @module adapters/trigger/HttpEndpointGateway
 */
export class HttpEndpointGateway {
  #endpoints; #fetch; #logger;
  constructor({ endpoints = {}, fetchFn = fetch, logger = console } = {}) {
    this.#endpoints = endpoints;
    this.#fetch = fetchFn;
    this.#logger = logger;
  }
  async call(ref, params) {
    const ep = this.#endpoints[ref];
    if (!ep || !ep.url) {
      this.#logger.warn?.('trigger.script.unknown_endpoint', { ref });
      return null;
    }
    const method = (ep.method || 'POST').toUpperCase();
    const opts = { method, headers: ep.headers || {} };
    if (method !== 'GET' && method !== 'HEAD') opts.body = JSON.stringify(params ?? {});
    try {
      const res = await this.#fetch(ep.url, opts);
      this.#logger.info?.('trigger.script.called', { ref, method, ok: res?.ok !== false });
      return res;
    } catch (err) {
      this.#logger.warn?.('trigger.script.failed', { ref, error: err.message });
      return null;
    }
  }
}
export default HttpEndpointGateway;
```

- [ ] **Step 4: Run → pass** (3 tests).
- [ ] **Step 5: Commit** `feat(trigger): add IEndpointGateway port + HttpEndpointGateway adapter`.

---

## Task 3: NfcResolver `endpoint` field + `script` action mapping

**Files:**
- Modify: `backend/src/2_domains/trigger/services/NfcResolver.mjs`
- Modify: `backend/src/3_applications/trigger/mapIntentToResponse.mjs`
- Test: `tests/isolated/domain/trigger/services/NfcResolver.script.test.mjs`, add a case to `mapIntentToResponse.test.mjs`

**Context:** An NFC binding `{ action: script, endpoint: bedtime, ...params }` should resolve to a script intent then a script Response. In `NfcResolver`: add `endpoint` to `RESERVED_KEYS` (so it doesn't leak into params/shorthand), carry it as `intent.endpoint` when present, and include `intent.endpoint !== undefined` in the `hasDispatchable` check. In `mapIntentToResponse`: `action === 'script'` → `Response.script({ ref: intent.endpoint, params: intent.params })`.

**Interfaces:**
- NfcResolver intent gains optional `endpoint`.
- `mapIntentToResponse` handles `action:'script'`.

- [ ] **Step 1: Write failing tests**

```javascript
// tests/isolated/domain/trigger/services/NfcResolver.script.test.mjs
import { describe, it, expect } from 'vitest';
import { NfcResolver } from '#domains/trigger/services/NfcResolver.mjs';
describe('NfcResolver script', () => {
  it('resolves an endpoint tag to a script intent (endpoint not leaked to params)', () => {
    const registry = { locations: { lr: { target: 'x', defaults: {} } }, tags: { aa: { global: { action: 'script', endpoint: 'bedtime', foo: 'bar' }, overrides: {} } } };
    const intent = NfcResolver.resolve({ location: 'lr', value: 'aa', registry, contentIdResolver: { resolve: () => false } });
    expect(intent.action).toBe('script');
    expect(intent.endpoint).toBe('bedtime');
    expect(intent.params.foo).toBe('bar');
    expect(intent.params.endpoint).toBeUndefined();
  });
});
```

Add to `mapIntentToResponse.test.mjs`:
```javascript
it('maps script action to a script Response', () => {
  expect(mapIntentToResponse({ action: 'script', endpoint: 'bedtime', params: { a: 1 } }))
    .toEqual({ kind: 'script', ref: 'bedtime', params: { a: 1 } });
});
```

- [ ] **Step 2: Run → fail** (endpoint leaks to params / unknown action 'script').
- [ ] **Step 3: Implement**

In `NfcResolver.mjs`:
- Add `'endpoint'` to the `RESERVED_KEYS` set.
- After the other `if (merged.X !== undefined) intent.X = ...` lines, add: `if (merged.endpoint !== undefined) intent.endpoint = merged.endpoint;`
- In `hasDispatchable`, add `|| intent.endpoint !== undefined`.

In `mapIntentToResponse.mjs`, add before the final throw:
```javascript
  if (action === 'script') {
    return Response.script({ ref: intent.endpoint, params: intent.params });
  }
```

- [ ] **Step 4: Run → pass** + existing NfcResolver/mapIntentToResponse suites green.
- [ ] **Step 5: Commit** `feat(trigger): NFC endpoint field -> script response`.

---

## Task 4: Wire `endpointGateway` into the pipeline

**Files:**
- Modify: `backend/src/5_composition/modules/triggerApi.mjs`
- Test: node --check + trigger sweep.

**Context:** Build `HttpEndpointGateway` from `registry.endpoints` and inject it into `TriggerDispatchService` as `endpointGateway` (added to `#deps`). `TriggerDispatchService` must accept `endpointGateway` in its constructor and include it in `#deps`.

- [ ] **Step 1:** In `TriggerDispatchService.mjs`, add `endpointGateway = null` to the constructor params and `endpointGateway` to `this.#deps`.
- [ ] **Step 2:** In `triggerApi.mjs`, after `loadRegistry`, build `const endpointGateway = new HttpEndpointGateway({ endpoints: registry.endpoints || {}, logger });` (import it from `#adapters/trigger/HttpEndpointGateway.mjs`; `registry` is the object returned by `loadRegistry`) and pass `endpointGateway` into `createTriggerApiRouter`'s `TriggerDispatchService` construction.
- [ ] **Step 3:** `node --check backend/src/5_composition/modules/triggerApi.mjs backend/src/3_applications/trigger/TriggerDispatchService.mjs`.
- [ ] **Step 4:** Sweep: `npx vitest run tests/isolated/domain/trigger tests/isolated/application/trigger tests/isolated/adapter/trigger tests/isolated/api/routers/trigger.test.mjs` — green.
- [ ] **Step 5:** Commit `feat(trigger): wire endpointGateway into trigger pipeline`.

---

## Self-Review
- **Spec coverage:** `script` kind + named-endpoint safety (ref not URL) — Tasks 1,2 ✓; port/adapter split — Task 2 ✓; NFC can produce a script response — Task 3 ✓; wired — Task 4 ✓. playback-hub kind is DEFERRED (illustrative/non-core per spec; needs the target registry).
- **Type consistency:** `Response.script({ref, params})` (Task 1) matches `mapIntentToResponse` output (Task 3) and the handler's `endpointGateway.call(ref, params)` (Task 1) matches `HttpEndpointGateway.call` (Task 2) and the injected dep (Task 4).
