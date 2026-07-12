# Trigger Unification — Plan 3 of 6: Fold In Barcode

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Checkbox (`- [ ]`) steps.

**Goal:** Route barcode scans through the unified trigger pipeline (ingress → `TriggerEvent` → guards → `BarcodeResolver` → `Response` → handlers), at behavior parity with today's `BarcodeScanService`, adding the `transport` response kind, the optimistic content posture, and the wired `authorize` guard stage.

**Architecture:** Barcode becomes a trigger modality. A `BarcodeResolver` (domain) wraps the existing `BarcodePayload` parse and emits a `Response` (content-optimistic or transport). A `ContentDispatcher` (application) encapsulates the optimistic broadcast→ack→wake-and-load-fallback path lifted from `BarcodeScanService.#handleContent`. The `transport` handler broadcasts a `BarcodeCommandMap` payload to the target screen. `TriggerDispatchService` gains `contentDispatcher` + `screenBroadcast` deps and wires the `authorize` stage (gatekeeper strategies). `barcodeRelay.mjs`'s `onScan` builds a `TriggerEvent` and calls `handleEvent` instead of `BarcodeScanService.handle`. `BarcodeScanService` itself is NOT deleted here (Plan 4 retires it) — it is simply no longer fed.

**Tech Stack:** Node ESM, vitest, `#`-subpath imports. No new deps. Reuses `BarcodePayload`, `BarcodeCommandMap.resolveCommand`/`KNOWN_COMMANDS`, `BarcodeGatekeeper` strategies (`autoApprove`).

## Global Constraints

- **Parity with `BarcodeScanService` behavior:** a barcode content scan must, for the same input, produce the same target screen + query and the same optimistic dispatch (broadcast to screen → wait `content-ack` 2000ms → on timeout, wake-and-load fallback). A command barcode must broadcast the same `resolveCommand(command, arg)` payload to the same screen. Denials/unknown-device/unknown-command must be handled equivalently.
- **NFC/state unchanged:** the changes to `TriggerDispatchService` (new deps, authorize wiring) must not alter NFC/state behavior — authorize defaults to approve when a source has no strategies, and NFC/state sources have none.
- **Barcode registry slice:** `config.barcode.locations[location]` must exist (else `LOCATION_NOT_FOUND`). Barcode sources live in `sources.yml` with `modality: barcode`. `buildTriggerRegistry` produces a `barcode` slice `{ locations: { [loc]: { target, default_action, actions } } }`.
- **`TriggerEvent` for barcode:** `{ source: 'barcode', location: <scannerLocation>, value: <code>, meta: { device, timestamp } }`. `location` is the scanner's logical id (keys the barcode source); the barcode STRING may still name an explicit screen which overrides the source default target.
- **Response kinds after this plan:** content, transport, device, ha. (`script` is Plan 5.)
- **Content posture:** barcode content → `optimistic`; the content handler calls `deps.contentDispatcher.optimistic(target, query, loadOptions)`.
- Test runner vitest; TDD; commit per task. Branch `trigger-unification`.

---

## File Structure

**Create:**
- `backend/src/2_domains/trigger/services/BarcodeResolver.mjs`
- `backend/src/3_applications/trigger/ContentDispatcher.mjs`
- `backend/src/3_applications/trigger/guards/gatekeeperStrategies.mjs` — resolve a source's authorize policy → strategy list.

**Modify:**
- `backend/src/3_applications/trigger/responseHandlers.mjs` — add the `transport` handler.
- `backend/src/2_domains/trigger/services/ResolverRegistry.mjs` — register `barcode`.
- `backend/src/1_adapters/trigger/parsers/sourcesParser.mjs` — accept `modality: barcode`.
- `backend/src/1_adapters/trigger/parsers/buildTriggerRegistry.mjs` — add the `barcode` slice.
- `backend/src/3_applications/trigger/TriggerDispatchService.mjs` — add `contentDispatcher`/`screenBroadcast` deps; wire `authorize`.
- `backend/src/5_composition/modules/triggerApi.mjs` — accept + pass `contentDispatcher`/`screenBroadcast`.
- `backend/src/app.mjs` — build `ContentDispatcher`; retarget `barcodeRelay` onScan → `TriggerEvent` → `handleEvent`; pass barcode deps into the trigger pipeline.
- `scripts/migrate-trigger-config.mjs` — emit barcode sources from `barcode.yml` + devices.

**Tests (create):** one per new/changed unit under `tests/isolated/{domain,application,adapter}/trigger/…`.

---

## Task 1: `transport` response handler

**Files:**
- Modify: `backend/src/3_applications/trigger/responseHandlers.mjs`
- Test: `tests/isolated/application/trigger/responseHandlers.transport.test.mjs`

**Context:** Adds the `transport` kind. `deps.screenBroadcast(target, payload)` broadcasts a command payload to a screen. The payload is built from `deps.commandResolver(command, arg)` (= `resolveCommand` from `BarcodeCommandMap`). If the command is unknown (`resolveCommand` → null), log `trigger.transport.unknown` and no-op.

**Interfaces:**
- Consumes: existing `responseHandlers`/`dispatchResponse`.
- Produces: `responseHandlers.transport(response, deps)` — `response = { kind:'transport', target, command, arg }`; deps needs `screenBroadcast(target, payload)` and `commandResolver(command, arg)`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/application/trigger/responseHandlers.transport.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { dispatchResponse } from '#apps/trigger/responseHandlers.mjs';

describe('transport handler', () => {
  it('broadcasts the resolved command payload to the target screen', async () => {
    const screenBroadcast = vi.fn();
    const commandResolver = vi.fn((cmd, arg) => (cmd === 'volume' ? { volume: Number(arg) } : null));
    await dispatchResponse({ kind: 'transport', target: 'living-room', command: 'volume', arg: '30' }, { screenBroadcast, commandResolver });
    expect(commandResolver).toHaveBeenCalledWith('volume', '30');
    expect(screenBroadcast).toHaveBeenCalledWith('living-room', { volume: 30 });
  });

  it('no-ops (no broadcast) on an unknown command', async () => {
    const screenBroadcast = vi.fn();
    const logger = { warn: vi.fn() };
    await dispatchResponse({ kind: 'transport', target: 't', command: 'nope' }, { screenBroadcast, commandResolver: () => null, logger });
    expect(screenBroadcast).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('trigger.transport.unknown', expect.objectContaining({ command: 'nope' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/application/trigger/responseHandlers.transport.test.mjs`
Expected: FAIL — `UnknownResponseKindError: transport`.

- [ ] **Step 3: Add the handler**

In `backend/src/3_applications/trigger/responseHandlers.mjs`, add to the `responseHandlers` object (after `content`):

```javascript
  transport: async (response, deps) => {
    const payload = deps.commandResolver?.(response.command, response.arg);
    if (!payload) {
      deps.logger?.warn?.('trigger.transport.unknown', { command: response.command, target: response.target });
      return;
    }
    return deps.screenBroadcast?.(response.target, payload);
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/application/trigger/responseHandlers.transport.test.mjs tests/isolated/application/trigger/responseHandlers.test.mjs`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/trigger/responseHandlers.mjs tests/isolated/application/trigger/responseHandlers.transport.test.mjs
git commit -m "feat(trigger): add transport response handler (screen command broadcast)"
```

---

## Task 2: `BarcodeResolver`

**Files:**
- Create: `backend/src/2_domains/trigger/services/BarcodeResolver.mjs`
- Test: `tests/isolated/domain/trigger/services/BarcodeResolver.test.mjs`

**Context:** Wraps `BarcodePayload.parse` (from `#domains/barcode/BarcodePayload.mjs`) and maps its result to a `Response`. Registry slice for barcode: `{ locations: { [loc]: { target, default_action, actions } } }`. Known commands come from `KNOWN_COMMANDS` (`#domains/barcode/BarcodeCommandMap.mjs`); known actions from `location.actions`. Mapping:
- `payload.type === 'command'` → `Response`-like `{ kind:'transport', target: payload.targetScreen || location.target, command: payload.command, arg: payload.commandArg }`.
- `payload.type === 'content'` → `Response.content({ target: payload.targetScreen || location.target, expression: { action: payload.action || location.default_action, contentId: payload.contentId, options: payload.options || {} }, posture: 'optimistic' })`.
- `parse` returns null (unparseable) → resolver returns null (→ `TRIGGER_NOT_REGISTERED`).

Because `transport` isn't a `Response` factory (Response only has content/device/ha), return a plain frozen object for transport; import `Response` for the content case.

**Interfaces:**
- Produces: `class BarcodeResolver` with static `resolve({ location, value, registry })` → `Response | { kind:'transport', ... } | null`. `registry` is the barcode slice; `location` selects `registry.locations[location]`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/domain/trigger/services/BarcodeResolver.test.mjs
import { describe, it, expect } from 'vitest';
import { BarcodeResolver } from '#domains/trigger/services/BarcodeResolver.mjs';

const registry = { locations: { 'ds2278': { target: 'living-room', default_action: 'queue', actions: ['queue', 'play', 'open'] } } };

describe('BarcodeResolver', () => {
  it('maps a bare content code to a content Response (optimistic, source default action + target)', () => {
    const r = BarcodeResolver.resolve({ location: 'ds2278', value: 'plex:595104', registry });
    expect(r.kind).toBe('content');
    expect(r.target).toBe('living-room');
    expect(r.posture).toBe('optimistic');
    expect(r.expression).toEqual({ action: 'queue', contentId: 'plex:595104', options: {} });
  });

  it('honors an explicit screen + action + options in the code', () => {
    const r = BarcodeResolver.resolve({ location: 'ds2278', value: 'office:play:plex:1+shuffle', registry });
    expect(r.target).toBe('office');
    expect(r.expression.action).toBe('play');
    expect(r.expression.contentId).toBe('plex:1');
    expect(r.expression.options).toEqual({ shuffle: true });
  });

  it('maps a command code to a transport response', () => {
    const r = BarcodeResolver.resolve({ location: 'ds2278', value: 'volume:30', registry });
    expect(r).toEqual({ kind: 'transport', target: 'living-room', command: 'volume', arg: '30' });
  });

  it('returns null for an unknown location or unparseable code', () => {
    expect(BarcodeResolver.resolve({ location: 'nope', value: 'plex:1', registry })).toBeNull();
    expect(BarcodeResolver.resolve({ location: 'ds2278', value: '', registry })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/domain/trigger/services/BarcodeResolver.test.mjs`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/2_domains/trigger/services/BarcodeResolver.mjs
/**
 * Barcode resolver: parses a self-describing barcode string into a Response.
 * Wraps BarcodePayload (grammar) — the value carries its own intent; the source
 * slice supplies defaults (target screen, default action, known actions).
 *
 * Layer: DOMAIN service (2_domains/trigger/services). Stateless.
 * @module domains/trigger/services/BarcodeResolver
 */
import { BarcodePayload } from '#domains/barcode/BarcodePayload.mjs';
import { KNOWN_COMMANDS } from '#domains/barcode/BarcodeCommandMap.mjs';
import { Response } from '#domains/trigger/Response.mjs';

export class BarcodeResolver {
  /**
   * @param {Object} args
   * @param {string} args.location  scanner location id (keys registry.locations)
   * @param {string} args.value     the raw barcode string
   * @param {Object} args.registry  the `barcode` slice: { locations }
   * @returns {Object|null} a Response (content) or a transport response, or null
   */
  static resolve({ location, value, registry }) {
    const loc = registry?.locations?.[location];
    if (!loc) return null;

    const knownActions = loc.actions || ['queue', 'play', 'open'];
    const payload = BarcodePayload.parse(
      { barcode: value, device: location, timestamp: null },
      knownActions,
      KNOWN_COMMANDS,
    );
    if (!payload) return null;

    const target = payload.targetScreen || loc.target;

    if (payload.type === 'command') {
      return Object.freeze({ kind: 'transport', target, command: payload.command, arg: payload.commandArg });
    }
    return Response.content({
      target,
      expression: { action: payload.action || loc.default_action, contentId: payload.contentId, options: payload.options || {} },
      posture: 'optimistic',
    });
  }
}

export default BarcodeResolver;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/domain/trigger/services/BarcodeResolver.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/trigger/services/BarcodeResolver.mjs tests/isolated/domain/trigger/services/BarcodeResolver.test.mjs
git commit -m "feat(trigger): add BarcodeResolver (self-describing barcode -> Response)"
```

---

## Task 3: Register barcode modality (ResolverRegistry + parsers)

**Files:**
- Modify: `backend/src/2_domains/trigger/services/ResolverRegistry.mjs`
- Modify: `backend/src/1_adapters/trigger/parsers/sourcesParser.mjs`
- Modify: `backend/src/1_adapters/trigger/parsers/buildTriggerRegistry.mjs`
- Test: `tests/isolated/domain/trigger/services/ResolverRegistry.barcode.test.mjs`, `tests/isolated/adapter/trigger/parsers/sourcesParser.barcode.test.mjs`

**Context:** `ResolverRegistry.resolvers.barcode = BarcodeResolver`; barcode's resolve is called with `registry = registry.barcode` (already how the facade slices). `sourcesParser` must accept `modality: 'barcode'` and collect a `barcode.locations[loc] = { target, default_action, actions }` (no delegation to nfc/state parsers — barcode needs no per-uid table). `buildTriggerRegistry` adds `barcode: parsedBarcodeSlice` to its output.

**Interfaces:**
- `ResolverRegistry.resolve({ modality:'barcode', location, value, registry })` → dispatches to `BarcodeResolver` with `registry.barcode`.
- `parseSources` output gains `barcode: { locations }`.
- `buildTriggerRegistry` output gains top-level `barcode`.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/isolated/domain/trigger/services/ResolverRegistry.barcode.test.mjs
import { describe, it, expect } from 'vitest';
import { ResolverRegistry } from '#domains/trigger/services/ResolverRegistry.mjs';

describe('ResolverRegistry barcode', () => {
  it('routes barcode to BarcodeResolver with the barcode slice', () => {
    const registry = { barcode: { locations: { ds2278: { target: 'living-room', default_action: 'queue', actions: ['queue'] } } } };
    const r = ResolverRegistry.resolve({ modality: 'barcode', location: 'ds2278', value: 'plex:1', registry });
    expect(r.kind).toBe('content');
    expect(r.target).toBe('living-room');
  });
});
```

```javascript
// tests/isolated/adapter/trigger/parsers/sourcesParser.barcode.test.mjs
import { describe, it, expect } from 'vitest';
import { parseSources } from '#adapters/trigger/parsers/sourcesParser.mjs';

describe('parseSources barcode', () => {
  it('collects a barcode slice', () => {
    const out = parseSources({ ds2278: { modality: 'barcode', location: 'ds2278', target: 'living-room', default_action: 'queue', actions: ['queue', 'play', 'open'] } });
    expect(out.barcode.locations.ds2278).toEqual({ target: 'living-room', default_action: 'queue', actions: ['queue', 'play', 'open'] });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/isolated/domain/trigger/services/ResolverRegistry.barcode.test.mjs tests/isolated/adapter/trigger/parsers/sourcesParser.barcode.test.mjs`
Expected: FAIL — barcode not registered / `out.barcode` undefined.

- [ ] **Step 3: Register + parse barcode**

In `ResolverRegistry.mjs`: import `BarcodeResolver` and add `barcode: BarcodeResolver` to the `resolvers` map.

In `sourcesParser.mjs`: initialize `const barcodeRaw = {}` alongside nfcRaw/stateRaw; in the modality switch add:
```javascript
else if (entry.modality === 'barcode') {
  const legacy = toLegacyEntry(entry);
  barcodeRaw[location] = {
    target: legacy.target,
    default_action: legacy.default_action || legacy.action || 'queue',
    actions: legacy.actions || ['queue', 'play', 'open'],
  };
}
```
(place this branch BEFORE the `else throw UNKNOWN_MODALITY`.) Return `{ nfc, state, barcode: { locations: barcodeRaw } }`.

In `buildTriggerRegistry.mjs`: destructure `const { nfc, state, barcode } = parseSources(blobs.sources);` and add `barcode` to the returned object.

- [ ] **Step 4: Run tests + the existing sources/registry suites**

Run: `npx vitest run tests/isolated/domain/trigger/services/ tests/isolated/adapter/trigger/parsers/`
Expected: PASS (all — new + existing).

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/trigger/services/ResolverRegistry.mjs backend/src/1_adapters/trigger/parsers/sourcesParser.mjs backend/src/1_adapters/trigger/parsers/buildTriggerRegistry.mjs tests/isolated/domain/trigger/services/ResolverRegistry.barcode.test.mjs tests/isolated/adapter/trigger/parsers/sourcesParser.barcode.test.mjs
git commit -m "feat(trigger): register barcode modality (resolver + sources/registry slice)"
```

---

## Task 4: `ContentDispatcher` (optimistic posture)

**Files:**
- Create: `backend/src/3_applications/trigger/ContentDispatcher.mjs`
- Test: `tests/isolated/application/trigger/ContentDispatcher.test.mjs`

**Context:** Ports `BarcodeScanService.#handleContent`'s optimistic path. `optimistic(target, query, loadOptions)`:
1. Fire-and-forget `onContentApproved(target)` (wake displays) if provided.
2. `screenBroadcast(target, { ...query, source: 'trigger' })` — broadcast content to the screen.
3. If `waitForAck` provided: await `waitForAck(msg => msg.type === 'content-ack' && msg.screen === target, ACK_TIMEOUT_MS)`; on resolve, done; on reject (timeout), call `loadFallback(target, query)`. If no `waitForAck`, call `loadFallback` immediately.
`ACK_TIMEOUT_MS = 2000`. `loadFallback(target, query)` wraps `wakeAndLoadService.execute(deviceId, query)` — the app.mjs wiring supplies the screen→device mapping (same as today).

**Interfaces:**
- Produces: `class ContentDispatcher` `constructor({ screenBroadcast, waitForAck, loadFallback, onContentApproved, logger })`; `optimistic(target, query, loadOptions)` → `Promise<void>`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/application/trigger/ContentDispatcher.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { ContentDispatcher } from '#apps/trigger/ContentDispatcher.mjs';

describe('ContentDispatcher.optimistic', () => {
  it('broadcasts to the screen and does NOT fall back when an ack arrives', async () => {
    const screenBroadcast = vi.fn();
    const loadFallback = vi.fn();
    const waitForAck = vi.fn().mockResolvedValue({ type: 'content-ack', screen: 'living-room' });
    const cd = new ContentDispatcher({ screenBroadcast, waitForAck, loadFallback });
    await cd.optimistic('living-room', { queue: 'plex:1' }, {});
    expect(screenBroadcast).toHaveBeenCalledWith('living-room', expect.objectContaining({ queue: 'plex:1' }));
    expect(loadFallback).not.toHaveBeenCalled();
  });

  it('falls back to loadFallback when the ack times out', async () => {
    const screenBroadcast = vi.fn();
    const loadFallback = vi.fn().mockResolvedValue();
    const waitForAck = vi.fn().mockRejectedValue(new Error('timeout'));
    const cd = new ContentDispatcher({ screenBroadcast, waitForAck, loadFallback });
    await cd.optimistic('living-room', { queue: 'plex:1' }, {});
    expect(loadFallback).toHaveBeenCalledWith('living-room', { queue: 'plex:1' });
  });

  it('falls back immediately when no waitForAck is available', async () => {
    const loadFallback = vi.fn().mockResolvedValue();
    const cd = new ContentDispatcher({ screenBroadcast: vi.fn(), loadFallback });
    await cd.optimistic('t', { play: 'plex:2' }, {});
    expect(loadFallback).toHaveBeenCalledWith('t', { play: 'plex:2' });
  });

  it('fires onContentApproved (fire-and-forget) before broadcasting', async () => {
    const calls = [];
    const onContentApproved = vi.fn(async () => { calls.push('wake'); });
    const screenBroadcast = vi.fn(() => calls.push('broadcast'));
    const cd = new ContentDispatcher({ screenBroadcast, onContentApproved, waitForAck: vi.fn().mockResolvedValue({ type: 'content-ack', screen: 't' }) });
    await cd.optimistic('t', { queue: 'x' }, {});
    expect(onContentApproved).toHaveBeenCalledWith('t');
    expect(calls).toContain('broadcast');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/application/trigger/ContentDispatcher.test.mjs`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/3_applications/trigger/ContentDispatcher.mjs
/**
 * ContentDispatcher — optimistic content posture: broadcast to the (likely-on)
 * screen, wait briefly for a content-ack, and fall back to the full wake-and-load
 * cycle only if the screen doesn't acknowledge. Ported from BarcodeScanService.
 *
 * Layer: APPLICATION (3_applications/trigger).
 * @module applications/trigger/ContentDispatcher
 */
const ACK_TIMEOUT_MS = 2000;

export class ContentDispatcher {
  #screenBroadcast; #waitForAck; #loadFallback; #onContentApproved; #logger;

  constructor({ screenBroadcast, waitForAck = null, loadFallback = null, onContentApproved = null, logger = console } = {}) {
    this.#screenBroadcast = screenBroadcast;
    this.#waitForAck = waitForAck;
    this.#loadFallback = loadFallback;
    this.#onContentApproved = onContentApproved;
    this.#logger = logger;
  }

  async optimistic(target, query, _loadOptions = {}) {
    if (this.#onContentApproved) {
      Promise.resolve(this.#onContentApproved(target)).catch(() => {});
    }
    this.#screenBroadcast?.(target, { ...query, source: 'trigger', targetScreen: target });

    if (!this.#loadFallback) return;

    if (this.#waitForAck) {
      try {
        await this.#waitForAck((msg) => msg.type === 'content-ack' && msg.screen === target, ACK_TIMEOUT_MS);
        this.#logger.info?.('trigger.content.ack', { target });
      } catch {
        this.#logger.info?.('trigger.content.ack_timeout', { target, timeoutMs: ACK_TIMEOUT_MS });
        await this.#tryFallback(target, query);
      }
    } else {
      this.#logger.info?.('trigger.content.no_ack_channel', { target });
      await this.#tryFallback(target, query);
    }
  }

  async #tryFallback(target, query) {
    try {
      await this.#loadFallback(target, query);
    } catch (err) {
      this.#logger.warn?.('trigger.content.fallback_failed', { target, error: err.message });
    }
  }
}

export default ContentDispatcher;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/application/trigger/ContentDispatcher.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/trigger/ContentDispatcher.mjs tests/isolated/application/trigger/ContentDispatcher.test.mjs
git commit -m "feat(trigger): add ContentDispatcher (optimistic broadcast+ack+fallback)"
```

---

## Task 5: Wire `authorize` + barcode deps into `TriggerDispatchService`

**Files:**
- Create: `backend/src/3_applications/trigger/guards/gatekeeperStrategies.mjs`
- Modify: `backend/src/3_applications/trigger/TriggerDispatchService.mjs`
- Test: `tests/isolated/application/trigger/gatekeeperStrategies.test.mjs`, and add cases to `tests/isolated/application/trigger/TriggerDispatchService.test.mjs`

**Context:** The `authorize` guard (built in Plan 1, unwired) is now run between debounce and resolve. Strategies come from the source's `authorize` policy: `gatekeeperStrategies(locationConfig)` → strategy array (default `[]` = approve; `auto-approve` → `[]` since autoApprove is a no-op; the seam supports future strategies). Denial → new result code `AUTHORIZE_DENIED` (404-mapped like TRIGGER_NOT_REGISTERED) + log `trigger.denied`. Add `contentDispatcher` + `screenBroadcast` + `commandResolver` to `this.#deps` so the content/transport handlers can use them. NFC/state have no authorize policy → approve (no behavior change).

**Interfaces:**
- `gatekeeperStrategies(locationConfig)` → `Array<{evaluate(ctx)}>`.
- `TriggerDispatchService` constructor gains `contentDispatcher`, `screenBroadcast`, `commandResolver`; `#deps` includes them.
- New result code `AUTHORIZE_DENIED`.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/isolated/application/trigger/gatekeeperStrategies.test.mjs
import { describe, it, expect } from 'vitest';
import { gatekeeperStrategies } from '#apps/trigger/guards/gatekeeperStrategies.mjs';

describe('gatekeeperStrategies', () => {
  it('returns [] (approve) when no policy configured', () => {
    expect(gatekeeperStrategies({})).toEqual([]);
    expect(gatekeeperStrategies({ authorize: { policy: 'auto-approve' } })).toEqual([]);
  });
});
```

Add to `TriggerDispatchService.test.mjs`:

```javascript
// --- appended: authorize + deps ---
describe('TriggerDispatchService authorize', () => {
  it('approves when the source has no strategies (nfc/state unchanged)', async () => {
    // reuse the existing make(...) helper + nfc registry; assert a normal content dispatch still occurs
    // (this documents that wiring authorize did not change nfc behavior)
  });
});
```
(Use the existing test file's `make`/registry helpers; assert an NFC dispatch still returns ok:true after authorize is wired.)

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/isolated/application/trigger/gatekeeperStrategies.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement + wire**

Create `backend/src/3_applications/trigger/guards/gatekeeperStrategies.mjs`:
```javascript
/**
 * Resolve a source's authorize policy into an ordered strategy list for the
 * `authorize` guard stage. Default (and 'auto-approve') → [] (approve). The seam
 * exists so future policies (rate-limit, allowlist) attach here.
 * @module applications/trigger/guards/gatekeeperStrategies
 */
export function gatekeeperStrategies(locationConfig = {}) {
  const policy = locationConfig?.authorize?.policy;
  if (!policy || policy === 'auto-approve') return [];
  return []; // unknown policies approve for now; concrete strategies added when needed
}
export default gatekeeperStrategies;
```

In `TriggerDispatchService.mjs`:
- import `{ authorize }` from `./guards/authorize.mjs` and `{ gatekeeperStrategies }` from `./guards/gatekeeperStrategies.mjs`.
- constructor: accept `contentDispatcher = null, screenBroadcast = null, commandResolver = null`; add them into `this.#deps = { wakeAndLoadService, haGateway, deviceService, contentDispatcher, screenBroadcast, commandResolver }`.
- In `handleEvent`, AFTER the debounce block and BEFORE `ResolverRegistry.resolve`, add the authorize stage:
```javascript
if (!options.dryRun) {
  const decision = await authorize({ strategies: gatekeeperStrategies(locationConfig), context: { location, modality, value: normalizedValue } });
  if (!decision.approved) {
    this.#debounce.delete(debounceKey);
    this.#logger.info?.('trigger.denied', { location, modality, value: normalizedValue, reason: decision.reason, dispatchId });
    return { ok: false, code: 'AUTHORIZE_DENIED', error: decision.reason || 'Denied', location, modality, value: normalizedValue, dispatchId };
  }
}
```

- [ ] **Step 4: Map the new code in the router**

In `backend/src/4_api/v1/routers/trigger.mjs`, add `AUTHORIZE_DENIED: 403` to `STATUS_BY_CODE`.

- [ ] **Step 5: Run the trigger suites**

Run: `npx vitest run tests/isolated/application/trigger/ tests/isolated/api/routers/trigger.test.mjs tests/isolated/api/routers/trigger.sideEffect.test.mjs`
Expected: PASS (all; NFC/state unaffected — authorize approves with empty strategies).

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/trigger/guards/gatekeeperStrategies.mjs backend/src/3_applications/trigger/TriggerDispatchService.mjs backend/src/4_api/v1/routers/trigger.mjs tests/isolated/application/trigger/gatekeeperStrategies.test.mjs tests/isolated/application/trigger/TriggerDispatchService.test.mjs
git commit -m "feat(trigger): wire authorize stage + barcode dispatch deps"
```

---

## Task 6: Barcode ingress + app.mjs/triggerApi wiring

**Files:**
- Modify: `backend/src/5_composition/modules/triggerApi.mjs`
- Modify: `backend/src/app.mjs`
- Test: manual + the parity sweep in Task 7 (this task is integration; guard it with `node --check` + boot-path reasoning).

**Context:** This is the integration step. Two coordinated changes:

**(a) `triggerApi.mjs`** — accept `contentDispatcher`, `screenBroadcast`, `commandResolver` and pass them to the `TriggerDispatchService` constructor. Read the file; add the three params to `createTriggerApiRouter({...})` and thread them through.

**(b) `app.mjs`** — in the barcode block (currently building `BarcodeScanService`): keep the scanner-config/gatekeeper/screenDisplayScripts/screen→device derivations, but instead of constructing `BarcodeScanService`, construct a `ContentDispatcher` and expose the barcode deps to the trigger pipeline, and retarget `onScan`:

Replace the `new BarcodeScanService({...})` construction and its `setLoadFallback` wiring with:
```javascript
import { ContentDispatcher } from '#apps/trigger/ContentDispatcher.mjs';
// ... inside the barcode block, after screenDisplayScripts + screenToDevice are built:
const screenBroadcast = (targetScreen, payload) => broadcastEvent({ topic: targetScreen, ...payload, source: 'barcode', targetScreen });
const contentDispatcher = new ContentDispatcher({
  screenBroadcast,
  waitForAck: (predicate, timeoutMs) => eventBus.waitForMessage(predicate, timeoutMs),
  loadFallback: async (targetScreen, query) => {
    const deviceId = screenToDevice[targetScreen];
    if (!deviceId) return;
    return wakeAndLoadService.execute(deviceId, query);
  },
  onContentApproved: async (targetScreen) => { /* the existing display-wake loop, verbatim */ },
  logger: barcodeLogger,
});
```
Build `screenToDevice` in this block (move the derivation currently at ~app.mjs:2138). Then retarget the relay:
```javascript
onScan: (relay) => {
  const event = TriggerEvent.create({ source: 'barcode', location: relay.device, value: relay.code, meta: { device: relay.device, timestamp: relay.ts, transport: 'ws' } });
  triggerDispatchService.handleEvent(event).catch((err) => barcodeLogger.warn?.('barcode.dispatch.failed', { error: err.message }));
},
```
This requires `triggerDispatchService`, `contentDispatcher`, `screenBroadcast`, `resolveCommand` to be in scope where the trigger pipeline is constructed. If the trigger pipeline is built AFTER the barcode block, move the `ContentDispatcher`/`screenBroadcast` construction to just before the `createTriggerApiRouter(...)` call and pass them in; the relay `onScan` needs the `triggerDispatchService` instance — capture it from the router-construction return (or restructure so the relay is wired after the pipeline exists, mirroring how `setLoadFallback` is wired late today). Delete the now-dead `barcodeScanServiceRef`/`setLoadFallback` block (~app.mjs:2136-2152).

Because this is delicate wiring in a large file, the implementer MUST read the surrounding app.mjs regions, preserve all existing derivations (scannerDeviceConfig, screenDisplayScripts, screenToDevice, barcodeKnownActions), and keep `createBarcodeRelay`'s persistence args intact. If the ordering makes `triggerDispatchService` unavailable at relay-wire time, report the specific ordering constraint before guessing.

- [ ] **Step 1:** Read `triggerApi.mjs` and add the three params, threading to `TriggerDispatchService`.
- [ ] **Step 2:** Read the app.mjs barcode block (~1581-1665) and the loadFallback block (~2136-2152) and the trigger-pipeline construction (~2170-2182). Restructure so `contentDispatcher`/`screenBroadcast`/`resolveCommand` are passed into `createTriggerApiRouter`, capture `triggerDispatchService`, and the relay `onScan` calls `handleEvent`. Remove the `BarcodeScanService` construction + `setLoadFallback` block.
- [ ] **Step 3:** `node --check backend/src/app.mjs` and `node --check backend/src/5_composition/modules/triggerApi.mjs` — no syntax errors.
- [ ] **Step 4:** Run the trigger + barcode suites: `npx vitest run tests/isolated/application/trigger tests/isolated/adapter/trigger tests/isolated/domain/trigger tests/isolated/api/routers/trigger.test.mjs` — green (unit-level; full boot verified in the deploy phase).
- [ ] **Step 5:** Commit `feat(trigger): route barcode scans through the unified pipeline (ingress + wiring)`.

---

## Task 7: Barcode config migration + parity sweep

**Files:**
- Modify: `scripts/migrate-trigger-config.mjs`
- Test: extend `tests/isolated/tooling/migrateTriggerConfig.test.mjs`; full sweep.

**Context:** Extend the migration to emit a barcode source from the old `barcode.yml` (+ the `barcode-scanner` device's `target_screen`). Add a `barcodeConfig` + `scannerDevices` input; for each `barcode-scanner` device id, emit `sources[<id>] = { modality:'barcode', location:<id>, target:<device.target_screen>, default_action:<barcodeConfig.default_action||'queue'>, actions:<barcodeConfig.actions||['queue','play','open']> }`.

- [ ] **Step 1:** Add a failing test case: given `barcodeConfig={default_action:'queue',actions:['queue','play','open']}` and `scannerDevices={ds2278:{type:'barcode-scanner',target_screen:'living-room'}}`, `migrateTriggerConfig` emits `sources.ds2278 = { modality:'barcode', location:'ds2278', target:'living-room', default_action:'queue', actions:['queue','play','open'] }`.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3:** Extend `migrateTriggerConfig` signature to accept `{ ...oldBlobs, barcodeConfig, scannerDevices }` and emit the barcode sources; extend the CLI to read `household/config/barcode.yml` + the `barcode-scanner` devices from `household/config/devices.yml`.
- [ ] **Step 4:** Run → pass. Then full sweep: `npx vitest run tests/isolated/domain/trigger tests/isolated/application/trigger tests/isolated/adapter/trigger tests/isolated/adapter/persistence tests/isolated/api/routers/trigger.test.mjs tests/isolated/tooling/migrateTriggerConfig.test.mjs tests/isolated/domain/barcode tests/isolated/assembly/barcode` — all green (barcode domain units still pass; they're consumed by BarcodeResolver now, not deleted).
- [ ] **Step 5:** Commit `feat(trigger): migrate barcode config into sources.yml`.

---

## Self-Review

- **Spec coverage:** BarcodeResolver wraps BarcodePayload (self-describing) → Response — Task 2 ✓; transport kind (from BarcodeCommandMap) — Task 1 ✓; optimistic content posture (broadcast+ack+fallback) — Task 4 ✓; gatekeeper → authorize stage — Task 5 ✓; barcode debounce — inherited (guard runs for barcode sources) ✓; ingress retarget (relay → TriggerEvent → handleEvent) — Task 6 ✓; barcode config in sources.yml — Tasks 3,7 ✓; BarcodeScanService no longer fed (retired in Plan 4) ✓.
- **Parity risk:** Task 7's sweep + a live smoke test (deploy phase) confirm a real barcode scan produces the same target/query/command + optimistic dispatch. The target registry (playback-hub kind) is correctly DEFERRED to Plan 5.
- **Type consistency:** `screenBroadcast(target, payload)` + `commandResolver(cmd,arg)` used by the transport handler (Task 1) match the deps threaded in Task 5/6. `contentDispatcher.optimistic(target, query, loadOptions)` (Task 4) matches the content handler's optimistic call (Plan 1) and the deps (Task 5/6). `parseSources` barcode slice (Task 3) matches `BarcodeResolver`'s expected `registry.locations[loc]` (Task 2).
