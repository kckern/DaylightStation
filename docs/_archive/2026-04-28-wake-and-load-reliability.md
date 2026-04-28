# Wake-and-Load Reliability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the two failure modes hit by `GET /api/v1/device/:id/load` — silent prewarm degradation when content is unresolvable, and 4 s WS-first ack-timeouts when the screen has subscribers but no live command handler — and clean up the raw `console.*` logging in `PlexAdapter` that hides the failure mode in production logs.

**Architecture:**
1. Wire the structured logger into `PlexAdapter` and replace ~14 raw `console.*` calls. This makes the existing `plex.loadMediaUrl.*` events filterable.
2. Differentiate **permanent** (content unresolvable) vs **transient** (network/exception) failures in `PlexAdapter.loadMediaUrl` and `TranscodePrewarmService`. Surface permanent prewarm failures as `failedStep: 'prewarm'` with HTTP 422, instead of silently falling through to a doomed FKB URL navigation.
3. Add a `CommandHandlerLivenessService` that tracks per-device handler-presence freshness from two signals: incoming `device-ack` messages and a periodic presence beacon emitted by `useCommandAckPublisher`. Replace the `subscriberCount > 0` gate in `WakeAndLoadService` with `livenessService.isFresh(deviceId)`. A subscriber count of 1 with a 90-second-stale handler currently produces the warm-path ack-timeout.

**Tech Stack:** Node ESM (backend), React (frontend), `vitest` test runner (the existing `tests/isolated/application/devices/` files import from `vitest` and run via `npx vitest run`), structured logging via `frontend/src/lib/logging/Logger.js` (frontend) and the backend logger injected through bootstrap.

**Save target:** `docs/_wip/plans/2026-04-28-wake-and-load-reliability.md` (this file).

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs` | Modify | Replace raw `console.*` with `this.logger.*`. Change `loadMediaUrl` return type from `string \| null` to `{ url: string \| null, reason?: 'metadata-missing' \| 'non-playable-type' \| 'audio-key-missing' \| 'transient' }` so callers can distinguish permanent vs transient failures. |
| `backend/src/0_system/bootstrap.mjs` | Modify | Inject component logger into `PlexAdapter`. Instantiate and start `CommandHandlerLivenessService`; pass it to `WakeAndLoadService`. |
| `backend/src/3_applications/devices/services/TranscodePrewarmService.mjs` | Modify | Adapt to new `loadMediaUrl` return shape. Propagate `reason` field. Set `permanent: true` when reason is non-transient. |
| `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` | Modify | Short-circuit (return `failedStep: 'prewarm'`) when prewarm reports `permanent: true`. Replace WS-first `subscriberCount > 0` gate with `commandHandlerLivenessService.isFresh(deviceId)`. |
| `backend/src/3_applications/devices/services/CommandHandlerLivenessService.mjs` | Create | New service. Subscribe to `device-ack` and `command-handler-presence` topics on the EventBus, track per-device `lastSeenAt`, expose `isFresh(deviceId, withinMs = 30_000)`. |
| `backend/src/3_applications/devices/services/index.mjs` | Modify | Export `CommandHandlerLivenessService`. |
| `backend/src/4_api/v1/routers/device.mjs` | Modify | Map `result.failedStep === 'prewarm' && result.permanent === true` to HTTP 422 with `code: 'CONTENT_NOT_FOUND'`. |
| `shared/contracts/media/topics.mjs` | Modify | Add `COMMAND_HANDLER_PRESENCE_TOPIC` constant. |
| `frontend/src/screen-framework/publishers/useCommandAckPublisher.js` | Modify | Emit a `command-handler-presence` beacon every 10 s on mount, and one final beacon with `online: false` on unmount. |
| `tests/isolated/application/devices/CommandHandlerLivenessService.test.mjs` | Create | Cover ack ingestion, presence ingestion, `isFresh` freshness window, cleanup. |
| `tests/isolated/application/devices/TranscodePrewarmService.test.mjs` | Modify | Cover new `permanent` flag + reason propagation. |
| `tests/isolated/application/devices/WakeAndLoadService.op.test.mjs` | Modify | Replace `getTopicSubscriberCount` mock with a `livenessService` mock; add a stale-handler test. |
| `tests/isolated/application/devices/WakeAndLoadService.prewarm-permanent.test.mjs` | Create | Cover the new short-circuit path. |
| `tests/isolated/api/device/router-load-prewarm-422.test.mjs` | Create | Cover the 422 mapping. |

---

## Task 1: Wire structured logger into PlexAdapter

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs:462-472` (inject logger)
- Modify: `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs:48` (constructor) and the 14 raw `console.*` call sites listed below

Raw call sites to replace (all currently bypass the structured logger):
- Line 157: `console.error('[PlexAdapter] getMetadata error:', err.message)`
- Line 182: `console.error('[PlexAdapter] loadImgFromKey error:', err.message)`
- Line 203: `console.error('[PlexAdapter] getThumbnail error:', err.message)`
- Line 247: `console.debug('[PlexAdapter] Failed to fetch show labels:', err.message)`
- Line 350: `console.error('[PlexAdapter] getList error:', err.message)`
- Line 857: `console.error('[PlexAdapter] requestTranscodeDecision error:', error.message)`
- Line 990: `console.error('[PlexAdapter] loadMediaUrl error:', error.message)`
- Line 1064: `console.error('[PlexAdapter] getContainerInfo error:', err.message)`
- Line 1104: `console.error('[PlexAdapter] Error loading history from mediaProgressMemory:', e.message)`
- Line 1572: `console.error('[PlexAdapter] requestTranscodeDecision error:', error.message)`
- Line 1909: `console.error('[PlexAdapter] search error:', err.message)`
- Line 1975: `console.error('[PlexAdapter] _searchPlaylists error:', err.message)`
- Line 2028: `console.error('[PlexAdapter] _searchCollections error:', err.message)`
- Line 2162: `console.error('[PlexAdapter] getItemsByLabel error:', err.message)`
- Line 2222: `console.error('[PlexAdapter] _findSmallestCollection error:', err.message)`

- [ ] **Step 1: Inject logger from bootstrap**

In `backend/src/0_system/bootstrap.mjs`, replace lines 462-472:

```js
  // Register Plex adapter if configured
  if (config.plex?.host && httpClient) {
    registry.register(
      new PlexAdapter({
        host: config.plex.host,
        token: config.plex.token,
        mediaProgressMemory,
        mediaKeyResolver,
        logger: deps.logger?.child?.({ component: 'plex-adapter' }) || deps.logger || console,
      }, { httpClient }),
      { category: plexManifest.capability, provider: plexManifest.provider }
    );
  }
```

(`deps.logger` already exists higher in the bootstrap closure; it's the same instance other adapters receive.)

- [ ] **Step 2: Replace each raw `console.*` call with `this.logger.*`**

Use `replace_all` only after auditing each call. Recommended structured replacement template:

| Original | Replacement |
|----------|-------------|
| `console.error('[PlexAdapter] X error:', err.message)` | `this.logger.error?.('plex.X.exception', { error: err.message })` |
| `console.debug('[PlexAdapter] X:', err.message)` | `this.logger.debug?.('plex.X', { error: err.message })` |

Concrete examples — line 990:

```js
// Before
console.error('[PlexAdapter] loadMediaUrl error:', error.message);
// After
this.logger.error?.('plex.loadMediaUrl.exception', {
  error: error.message,
  stack: error.stack,
});
```

Line 247:

```js
// Before
console.debug('[PlexAdapter] Failed to fetch show labels:', err.message);
// After
this.logger.debug?.('plex.show-labels.fetch-failed', { error: err.message });
```

Apply the same shape to all 15 call sites listed above.

- [ ] **Step 3: Run isolated Plex tests to verify no regression**

```bash
npx vitest run tests/isolated/adapter/content/media/plex/ 2>&1 | tail -10
```

Expected: existing test counts unchanged, all pass. (If the directory does not exist, run all isolated adapter tests: `npx vitest run tests/isolated/adapter/ 2>&1 | tail -10`.)

- [ ] **Step 4: Manual log-format check**

Trigger a real Plex error path through the running container — the simplest is a metadata fetch for a non-existent ID:

```bash
sudo docker exec daylight-station node -e "
const { default: PlexAdapter } = await import('./backend/src/1_adapters/content/media/plex/PlexAdapter.mjs');
" 2>&1 | head -5
```

(If the inline test is awkward, instead grep recent logs after the next cron-driven Plex request.)

```bash
sudo docker logs daylight-station --since 5m 2>&1 | grep '"event":"plex\.' | head -3
```

Expected: each log line is JSON with `"event":"plex.<verb>.<outcome>"` — no plain-text `[PlexAdapter] X error:` lines.

- [ ] **Step 5: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs backend/src/1_adapters/content/media/plex/PlexAdapter.mjs
git commit -m "$(cat <<'EOF'
fix(plex): route adapter logs through structured logger

Replace raw console.* calls with this.logger.* and inject the
component logger from bootstrap so plex.* events become filterable
in production log streams.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Differentiate permanent vs transient failures in `loadMediaUrl`

**Files:**
- Modify: `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs:1637-1750` (the second `loadMediaUrl` override — the one called by `TranscodePrewarmService`)
- Test: `tests/isolated/adapter/content/media/plex/PlexAdapter.loadMediaUrl.test.mjs` (create or extend if it exists)

The current method returns `string | null`. Callers cannot tell "Plex returned no metadata" (permanent) apart from "the network blew up" (transient). Change it to return a structured object.

- [ ] **Step 1: Write the failing test**

Create `tests/isolated/adapter/content/media/plex/PlexAdapter.loadMediaUrl.test.mjs` with:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlexAdapter } from '#adapters/content/media/plex/PlexAdapter.mjs';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('PlexAdapter.loadMediaUrl — failure shape', () => {
  let adapter;
  let client;

  beforeEach(() => {
    client = { getMetadata: vi.fn() };
    adapter = new PlexAdapter(
      { host: 'plex.local', token: 't', logger: makeLogger() },
      { httpClient: { request: vi.fn() } },
    );
    // Inject the mocked client (PlexAdapter constructs its own; override the field)
    adapter.client = client;
  });

  it('returns reason="metadata-missing" when Plex has no metadata for the rating key', async () => {
    client.getMetadata.mockResolvedValue({ MediaContainer: { Metadata: [] } });
    const result = await adapter.loadMediaUrl('999999', 0, {});
    expect(result).toEqual({ url: null, reason: 'metadata-missing' });
  });

  it('returns reason="non-playable-type" for shows/seasons/albums', async () => {
    client.getMetadata.mockResolvedValue({
      MediaContainer: { Metadata: [{ ratingKey: '487146', type: 'show' }] },
    });
    const result = await adapter.loadMediaUrl('487146', 0, {});
    expect(result).toEqual({ url: null, reason: 'non-playable-type' });
  });

  it('returns reason="transient" when getMetadata throws', async () => {
    client.getMetadata.mockRejectedValue(new Error('ECONNRESET'));
    const result = await adapter.loadMediaUrl('1', 0, {});
    expect(result).toEqual({ url: null, reason: 'transient' });
  });

  it('returns { url } on success with no reason field', async () => {
    client.getMetadata.mockResolvedValue({
      MediaContainer: { Metadata: [{
        ratingKey: '1', type: 'movie',
        Media: [{ Part: [{ key: '/parts/1.mkv' }] }],
      }] },
    });
    // Stub the decision API path to a deterministic transcode URL
    vi.spyOn(adapter, 'requestTranscodeDecision').mockResolvedValue({
      success: false,
      sessionIdentifier: 's',
      clientIdentifier: 'c',
    });
    vi.spyOn(adapter, '_buildTranscodeUrl').mockReturnValue('https://plex/transcode');

    const result = await adapter.loadMediaUrl('1', 0, {});
    expect(result.url).toBe('https://plex/transcode');
    expect(result.reason).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/isolated/adapter/content/media/plex/PlexAdapter.loadMediaUrl.test.mjs 2>&1 | tail -15
```

Expected: 4 failures — the current method returns `string | null` so `expect(result).toEqual({ url: null, reason: ... })` fails on the assertion that `result` is an object.

- [ ] **Step 3: Update `loadMediaUrl` return shape**

In `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs:1637-1750`, change every `return null` to `return { url: null, reason: '<reason>' }` and every `return '<url-string>'` to `return { url: '<url-string>' }`. The five branches and their reasons:

```js
async loadMediaUrl(itemOrKey, attempt = 0, opts = {}) {
  try {
    let itemData;
    let ratingKey;

    if (typeof itemOrKey === 'string' || typeof itemOrKey === 'number') {
      ratingKey = String(itemOrKey).replace(/^plex:/, '');
      const data = await this.client.getMetadata(ratingKey);
      itemData = data?.MediaContainer?.Metadata?.[0];
      if (!itemData) {
        this.logger.warn?.('plex.loadMediaUrl.metadataMissing', { ratingKey });
        return { url: null, reason: 'metadata-missing' };
      }
    } else {
      itemData = itemOrKey;
      ratingKey = itemData?.ratingKey || itemData?.plex;
    }

    if (!itemData || !ratingKey) {
      this.logger.warn?.('plex.loadMediaUrl.metadataMissing', { ratingKey });
      return { url: null, reason: 'metadata-missing' };
    }

    const { type } = itemData;
    const mediaType = this._determineMediaType(type);

    if (!['movie', 'episode', 'track', 'clip'].includes(type)) {
      this.logger.warn?.('plex.loadMediaUrl.nonPlayableType', { ratingKey, type });
      return { url: null, reason: 'non-playable-type' };
    }

    const {
      maxVideoBitrate = null,
      maxResolution = null,
      maxVideoResolution = null,
      session = null,
      startOffset = 0,
    } = opts;
    const resolvedMaxResolution = maxResolution ?? maxVideoResolution;

    if (mediaType === 'audio') {
      const { clientIdentifier, sessionIdentifier } = this._generateSessionIds(
        session ? `${session}-audio` : null,
      );
      const mediaKey = itemData?.Media?.[0]?.Part?.[0]?.key;
      if (!mediaKey) {
        this.logger.warn?.('plex.loadMediaUrl.audioMediaKeyMissing', { ratingKey });
        return { url: null, reason: 'audio-key-missing' };
      }
      const separator = mediaKey.includes('?') ? '&' : '?';
      return {
        url: `${this.proxyPath}${mediaKey}${separator}X-Plex-Client-Identifier=${clientIdentifier}&X-Plex-Session-Identifier=${sessionIdentifier}`,
      };
    }

    const decisionResult = await this.requestTranscodeDecision(ratingKey, {
      maxVideoBitrate, maxResolution: resolvedMaxResolution, session, startOffset,
    });

    if (!decisionResult.success) {
      this.logger.warn?.('plex.loadMediaUrl.decisionFailed', {
        ratingKey, reason: decisionResult.error || 'unknown',
      });
      const { sessionIdentifier, clientIdentifier } = decisionResult;
      return {
        url: this._buildTranscodeUrl(
          ratingKey, clientIdentifier, sessionIdentifier,
          maxVideoBitrate, resolvedMaxResolution, startOffset,
        ),
      };
    }

    const { sessionIdentifier, clientIdentifier, decision } = decisionResult;
    if (decision.canDirectPlay && decision.directStreamPath) {
      const directPath = decision.directStreamPath;
      const separator = directPath.includes('?') ? '&' : '?';
      return {
        url: `${this.proxyPath}${directPath}${separator}X-Plex-Client-Identifier=${clientIdentifier}&X-Plex-Session-Identifier=${sessionIdentifier}`,
      };
    }

    return {
      url: this._buildTranscodeUrl(
        ratingKey, clientIdentifier, sessionIdentifier,
        maxVideoBitrate, resolvedMaxResolution, startOffset,
      ),
    };
  } catch (error) {
    this.logger.error?.('plex.loadMediaUrl.exception', {
      ratingKey: typeof itemOrKey === 'string' || typeof itemOrKey === 'number'
        ? String(itemOrKey).replace(/^plex:/, '')
        : itemOrKey?.ratingKey,
      error: error.message,
      stack: error.stack,
    });
    return { url: null, reason: 'transient' };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/isolated/adapter/content/media/plex/PlexAdapter.loadMediaUrl.test.mjs 2>&1 | tail -10
```

Expected: 4 passes.

- [ ] **Step 5: Audit the other `loadMediaUrl` consumers and adapt or document**

Search for non-prewarm consumers:

```bash
grep -rn "loadMediaUrl" backend/ frontend/ --include="*.mjs" --include="*.js" --include="*.jsx" | grep -v test | grep -v PlexAdapter.mjs
```

The only non-test consumer is `TranscodePrewarmService` (handled in Task 3). If new consumers appear, update them to read `result.url` instead of treating the return as a string. There is also the **first** `loadMediaUrl` override at `PlexAdapter.mjs:913` (legacy, single-arg signature). Leave it untouched — it has different callers (legacy code paths and search results) and is out of scope.

- [ ] **Step 6: Commit**

```bash
git add backend/src/1_adapters/content/media/plex/PlexAdapter.mjs tests/isolated/adapter/content/media/plex/PlexAdapter.loadMediaUrl.test.mjs
git commit -m "$(cat <<'EOF'
feat(plex): differentiate permanent vs transient loadMediaUrl failures

Return { url, reason } from the prewarm-facing loadMediaUrl variant
so callers can short-circuit on metadata-missing / non-playable-type
instead of falling through to a doomed FKB URL navigation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Propagate failure reason through `TranscodePrewarmService`

**Files:**
- Modify: `backend/src/3_applications/devices/services/TranscodePrewarmService.mjs:47-51` (consume new return shape)
- Test: `tests/isolated/application/devices/TranscodePrewarmService.test.mjs` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/isolated/application/devices/TranscodePrewarmService.test.mjs`:

```js
describe('TranscodePrewarmService — permanent vs transient failure', () => {
  it('marks permanent: true when adapter returns reason="metadata-missing"', async () => {
    const adapter = {
      resolvePlayables: vi.fn().mockResolvedValue([{ contentId: 'plex:1', ratingKey: '1', source: 'plex' }]),
      loadMediaUrl: vi.fn().mockResolvedValue({ url: null, reason: 'metadata-missing' }),
    };
    const svc = new TranscodePrewarmService({
      contentIdResolver: { resolve: () => ({ adapter, source: 'plex', localId: '1' }) },
      queueService: { resolveQueue: async (p) => p },
      httpClient: { request: vi.fn() },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const result = await svc.prewarm('plex:1');
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('metadata-missing');
    expect(result.permanent).toBe(true);
  });

  it('marks permanent: false when adapter returns reason="transient"', async () => {
    const adapter = {
      resolvePlayables: vi.fn().mockResolvedValue([{ contentId: 'plex:1', ratingKey: '1', source: 'plex' }]),
      loadMediaUrl: vi.fn().mockResolvedValue({ url: null, reason: 'transient' }),
    };
    const svc = new TranscodePrewarmService({
      contentIdResolver: { resolve: () => ({ adapter, source: 'plex', localId: '1' }) },
      queueService: { resolveQueue: async (p) => p },
      httpClient: { request: vi.fn() },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const result = await svc.prewarm('plex:1');
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('transient');
    expect(result.permanent).toBe(false);
  });
});
```

(If the file already imports `TranscodePrewarmService` and `vi`, reuse those imports — don't add duplicates.)

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/isolated/application/devices/TranscodePrewarmService.test.mjs 2>&1 | tail -10
```

Expected: both new tests fail. The current code does `if (!dashUrl)` against an object (always truthy) so it never enters the failure branch.

- [ ] **Step 3: Update prewarm to consume the new shape**

In `backend/src/3_applications/devices/services/TranscodePrewarmService.mjs`, replace lines 47-51:

```js
const PERMANENT_REASONS = new Set(['metadata-missing', 'non-playable-type', 'audio-key-missing']);
```

(Add this constant at module scope, near `TOKEN_TTL_MS`.)

Then replace lines 47-51:

```js
      const startOffset = first.resumePosition || first.playhead || 0;
      const ratingKey = first.ratingKey || first.contentId?.replace(/^plex:/, '');
      const mediaResult = await resolved.adapter.loadMediaUrl(ratingKey, 0, { startOffset });
      const dashUrl = mediaResult?.url ?? null;
      const failureReason = mediaResult?.reason ?? null;
      if (!dashUrl) {
        const reason = failureReason || 'loadMediaUrl returned null';
        const permanent = !!failureReason && PERMANENT_REASONS.has(failureReason);
        this.#logger.warn?.('prewarm.failed', { contentRef, reason, permanent });
        return { status: 'failed', reason, permanent };
      }
```

(`status: 'ok'` and `status: 'skipped'` branches keep their existing return shapes.)

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/isolated/application/devices/TranscodePrewarmService.test.mjs 2>&1 | tail -10
```

Expected: all tests pass (including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/devices/services/TranscodePrewarmService.mjs tests/isolated/application/devices/TranscodePrewarmService.test.mjs
git commit -m "$(cat <<'EOF'
feat(prewarm): propagate permanent flag from PlexAdapter

Mark prewarm failures as permanent when the underlying loadMediaUrl
reports metadata-missing / non-playable-type / audio-key-missing.
Wake-and-load uses this flag in the next commit to short-circuit
instead of attempting a doomed FKB URL fallback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Short-circuit wake-and-load on permanent prewarm failure

**Files:**
- Modify: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs:299-345` (prewarm branch handling)
- Test: `tests/isolated/application/devices/WakeAndLoadService.prewarm-permanent.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/isolated/application/devices/WakeAndLoadService.prewarm-permanent.test.mjs`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeDevice() {
  return {
    id: 'tv',
    screenPath: '/screen/tv',
    defaultVolume: null,
    hasCapability: vi.fn().mockReturnValue(false),
    powerOn: vi.fn().mockResolvedValue({ ok: true, verified: true, elapsedMs: 5 }),
    setVolume: vi.fn(),
    prepareForContent: vi.fn().mockResolvedValue({ ok: true, coldRestart: false, cameraAvailable: true }),
    loadContent: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe('WakeAndLoadService — prewarm permanent failure', () => {
  let svc;
  let device;
  let prewarmService;
  let broadcast;

  beforeEach(() => {
    broadcast = vi.fn();
    device = makeDevice();
    prewarmService = {
      prewarm: vi.fn().mockResolvedValue({
        status: 'failed', reason: 'non-playable-type', permanent: true,
      }),
    };
    svc = new WakeAndLoadService({
      deviceService: { get: () => device },
      readinessPolicy: { isReady: vi.fn() },
      broadcast,
      prewarmService,
      logger: makeLogger(),
    });
  });

  it('returns failedStep="prewarm" with permanent=true and skips load', async () => {
    const result = await svc.execute('tv', { queue: 'plex:487146', shuffle: '1' });

    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe('prewarm');
    expect(result.permanent).toBe(true);
    expect(result.error).toMatch(/non-playable-type/);
    expect(device.loadContent).not.toHaveBeenCalled();
  });

  it('does NOT short-circuit when prewarm fails transiently', async () => {
    prewarmService.prewarm.mockResolvedValue({
      status: 'failed', reason: 'transient', permanent: false,
    });

    const result = await svc.execute('tv', { queue: 'plex:1' });

    expect(result.ok).toBe(true);
    expect(device.loadContent).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/isolated/application/devices/WakeAndLoadService.prewarm-permanent.test.mjs 2>&1 | tail -10
```

Expected: first test fails (`result.ok` is currently `true` and `device.loadContent` is currently called).

- [ ] **Step 3: Add the short-circuit in WakeAndLoadService**

In `backend/src/3_applications/devices/services/WakeAndLoadService.mjs`, replace lines 318-322 (the `prewarmResult?.status === 'failed'` branch):

```js
        } else if (prewarmResult?.status === 'failed') {
          result.steps.prewarm = {
            ok: false,
            reason: prewarmResult.reason,
            permanent: !!prewarmResult.permanent,
            error: prewarmResult.error,
          };
          this.#logger.warn?.('wake-and-load.prewarm.failed', {
            deviceId, dispatchId,
            reason: prewarmResult.reason,
            permanent: !!prewarmResult.permanent,
            error: prewarmResult.error,
          });

          if (prewarmResult.permanent) {
            this.#emitProgress(topic, dispatchId, 'prewarm', 'failed', {
              reason: prewarmResult.reason,
              permanent: true,
            });
            result.error = `Content unresolvable: ${prewarmResult.reason}`;
            result.failedStep = 'prewarm';
            result.permanent = true;
            result.totalElapsedMs = Date.now() - startTime;
            return result;
          }
        }
```

(The existing `'ok'`, `'skipped'`, and unknown-status branches are unchanged.)

Also delete the trailing `this.#emitProgress(topic, dispatchId, 'prewarm', 'done')` at line 339 — that line emits `done` even when the failure path ran; replace it with a guarded version:

```js
      if (result.steps.prewarm?.ok !== false) {
        this.#emitProgress(topic, dispatchId, 'prewarm', 'done');
      }
```

- [ ] **Step 4: Run new test to verify it passes**

```bash
npx vitest run tests/isolated/application/devices/WakeAndLoadService.prewarm-permanent.test.mjs 2>&1 | tail -10
```

Expected: 2 passes.

- [ ] **Step 5: Run the full WakeAndLoadService isolated suite**

```bash
npx vitest run tests/isolated/application/devices/WakeAndLoadService.*.test.mjs 2>&1 | tail -10
```

Expected: every previous test still passes (we did not change the success or transient paths).

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/devices/services/WakeAndLoadService.mjs tests/isolated/application/devices/WakeAndLoadService.prewarm-permanent.test.mjs
git commit -m "$(cat <<'EOF'
feat(wake-and-load): short-circuit on permanent prewarm failure

When the prewarm step reports permanent: true (Plex says the
content is unresolvable / non-playable), stop the orchestration
and surface failedStep='prewarm', permanent=true. The previous
behavior fell through to a doomed FKB URL navigation that would
also fail downstream and waste 30+ seconds of TV state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Map permanent prewarm failure to HTTP 422 in the device router

**Files:**
- Modify: `backend/src/4_api/v1/routers/device.mjs:702-709` (GET /:deviceId/load)
- Modify: `shared/contracts/media/errors.mjs` (no new code needed — `CONTENT_NOT_FOUND` already exists at line 2)
- Test: `tests/isolated/api/device/router-load-prewarm-422.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/isolated/api/device/router-load-prewarm-422.test.mjs`:

```js
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createDeviceRouter } from '#api/v1/routers/device.mjs';

function makeApp(wakeResult) {
  const app = express();
  const router = createDeviceRouter({
    wakeAndLoadService: {
      execute: vi.fn().mockResolvedValue(wakeResult),
    },
    deviceService: { get: () => ({ id: 'tv' }) },
    // Bypass the input precondition guard
    inputDeviceRegistry: null,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  app.use('/api/v1/device', router);
  return app;
}

describe('GET /api/v1/device/:id/load — failure mapping', () => {
  it('returns 422 with code=CONTENT_NOT_FOUND on permanent prewarm failure', async () => {
    const app = makeApp({
      ok: false,
      deviceId: 'tv',
      failedStep: 'prewarm',
      permanent: true,
      error: 'Content unresolvable: non-playable-type',
      steps: { prewarm: { ok: false, reason: 'non-playable-type', permanent: true } },
    });

    const res = await request(app).get('/api/v1/device/tv/load?queue=plex:487146');
    expect(res.status).toBe(422);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('CONTENT_NOT_FOUND');
    expect(res.body.error).toMatch(/non-playable-type/);
  });

  it('still returns 200 for transient prewarm failures (existing fall-through)', async () => {
    const app = makeApp({
      ok: true,
      deviceId: 'tv',
      steps: { prewarm: { ok: false, reason: 'transient', permanent: false } },
    });

    const res = await request(app).get('/api/v1/device/tv/load?queue=plex:1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
```

(If the project does not yet have `supertest` in devDependencies, install it: `npm install --save-dev supertest`. Verify before adding by running `node -e "require('supertest')"` — exit code 0 means it exists.)

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/isolated/api/device/router-load-prewarm-422.test.mjs 2>&1 | tail -10
```

Expected: first test fails — current router returns 200 for any non-`Device not found` result.

- [ ] **Step 3: Add the 422 mapping**

In `backend/src/4_api/v1/routers/device.mjs`, replace lines 702-709 (the `result = await wakeAndLoadService.execute(...)` block):

```js
    const result = await wakeAndLoadService.execute(deviceId, query);

    let status = 200;
    if (result.error === 'Device not found') {
      status = 404;
    } else if (result.failedStep === 'prewarm' && result.permanent === true) {
      status = 422;
      // Tag with a code so callers can branch deterministically
      result.code = ERROR_CODES.CONTENT_NOT_FOUND;
    }

    logger.info?.('device.router.load.complete', {
      deviceId, ok: result.ok, failedStep: result.failedStep, totalElapsedMs: result.totalElapsedMs,
    });

    res.status(status).json(result);
```

(`ERROR_CODES` is already imported at line 19.)

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/isolated/api/device/router-load-prewarm-422.test.mjs 2>&1 | tail -10
```

Expected: 2 passes.

- [ ] **Step 5: Live smoke check (after deploy)**

After deploying (Task 9), retry the original failing call:

```bash
curl -sS -w '\nHTTP %{http_code}\n' \
  "https://daylightstation.kckern.net/api/v1/device/livingroom-tv/load?queue=plex:487146&shuffle=1" \
  | tail -10
```

Expected: HTTP 422, body contains `"code": "CONTENT_NOT_FOUND"` and `"failedStep": "prewarm"`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/device.mjs tests/isolated/api/device/router-load-prewarm-422.test.mjs
git commit -m "$(cat <<'EOF'
feat(device-api): return 422 on permanent prewarm failure

Map result.failedStep='prewarm' + permanent=true to HTTP 422 with
code=CONTENT_NOT_FOUND. Transient prewarm failures continue to fall
through to FKB URL fallback and return 200. Triggers and other
callers see the failure deterministically instead of a 200 with
silent degradation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Create `CommandHandlerLivenessService`

**Files:**
- Create: `backend/src/3_applications/devices/services/CommandHandlerLivenessService.mjs`
- Modify: `backend/src/3_applications/devices/services/index.mjs` (export)
- Modify: `shared/contracts/media/topics.mjs` (add presence topic constant)
- Test: `tests/isolated/application/devices/CommandHandlerLivenessService.test.mjs`

- [ ] **Step 1: Add the presence topic constant**

Open `shared/contracts/media/topics.mjs` and find where existing topic constants live (`DEVICE_STATE_TOPIC`, `parseDeviceTopic`, etc.). Add:

```js
export const COMMAND_HANDLER_PRESENCE_TOPIC_PREFIX = 'command-handler-presence';
export function commandHandlerPresenceTopic(deviceId) {
  return `${COMMAND_HANDLER_PRESENCE_TOPIC_PREFIX}:${deviceId}`;
}
```

If the file already exports `parseDeviceTopic` that handles arbitrary `<kind>:<deviceId>` topics, also add a `command-handler-presence` case so it parses to `{ kind: 'command-handler-presence', deviceId }`.

- [ ] **Step 2: Write the failing test**

Create `tests/isolated/application/devices/CommandHandlerLivenessService.test.mjs`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandHandlerLivenessService } from '#apps/devices/services/CommandHandlerLivenessService.mjs';

function makeBus() {
  const handlers = new Map();
  return {
    handlers,
    subscribe(topic, fn) {
      const list = handlers.get(topic) || [];
      list.push(fn);
      handlers.set(topic, list);
      return () => {};
    },
    subscribePattern(predicate, fn) {
      handlers.set('__pattern__', { predicate, fn });
      return () => {};
    },
    publish(topic, payload) {
      const list = handlers.get(topic) || [];
      list.forEach((fn) => fn(payload, topic));
      const pattern = handlers.get('__pattern__');
      if (pattern && pattern.predicate(topic)) pattern.fn(payload, topic);
    },
  };
}

describe('CommandHandlerLivenessService', () => {
  let bus;
  let svc;
  let now;

  beforeEach(() => {
    bus = makeBus();
    now = 1_000_000;
    svc = new CommandHandlerLivenessService({
      eventBus: bus,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      clock: { now: () => now },
      freshnessMs: 30_000,
    });
    svc.start();
  });

  it('isFresh returns false for unknown device', () => {
    expect(svc.isFresh('tv')).toBe(false);
  });

  it('records lastSeenAt on device-ack', () => {
    bus.publish('device-ack', { deviceId: 'tv', commandId: 'c1', ok: true });
    expect(svc.isFresh('tv')).toBe(true);
  });

  it('records lastSeenAt on command-handler-presence', () => {
    bus.publish('command-handler-presence:tv', { deviceId: 'tv', online: true });
    expect(svc.isFresh('tv')).toBe(true);
  });

  it('isFresh returns false once the freshness window expires', () => {
    bus.publish('device-ack', { deviceId: 'tv', commandId: 'c1', ok: true });
    expect(svc.isFresh('tv')).toBe(true);
    now += 30_001;
    expect(svc.isFresh('tv')).toBe(false);
  });

  it('isFresh respects an explicit windowMs argument', () => {
    bus.publish('device-ack', { deviceId: 'tv', commandId: 'c1', ok: true });
    now += 5_000;
    expect(svc.isFresh('tv', 1_000)).toBe(false);
    expect(svc.isFresh('tv', 10_000)).toBe(true);
  });

  it('immediately downgrades on offline presence beacon', () => {
    bus.publish('command-handler-presence:tv', { deviceId: 'tv', online: true });
    expect(svc.isFresh('tv')).toBe(true);
    bus.publish('command-handler-presence:tv', { deviceId: 'tv', online: false });
    expect(svc.isFresh('tv')).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run tests/isolated/application/devices/CommandHandlerLivenessService.test.mjs 2>&1 | tail -10
```

Expected: import error — module does not exist.

- [ ] **Step 4: Implement the service**

Create `backend/src/3_applications/devices/services/CommandHandlerLivenessService.mjs`:

```js
/**
 * CommandHandlerLivenessService — tracks per-device freshness of
 * frontend command handlers (the `useCommandAckPublisher` mount).
 *
 * Two ingest signals:
 *   1. `device-ack` messages — definitive proof a handler ran.
 *   2. `command-handler-presence:<deviceId>` beacons — periodic
 *      heartbeat from the publisher. `online: false` immediately
 *      marks the device stale (page unmount).
 *
 * Used by WakeAndLoadService to gate the WS-first warm-switch path.
 * A subscriber count of 1 with no recent ack/presence is the canonical
 * "stale subscriber" — the WS connection is alive but no handler is
 * mounted, so dispatching a queue command produces an ack-timeout.
 *
 * @module applications/devices/services
 */

const DEFAULT_FRESHNESS_MS = 30_000;
const PRESENCE_TOPIC_PREFIX = 'command-handler-presence:';

export class CommandHandlerLivenessService {
  #eventBus;
  #logger;
  #clock;
  #freshnessMs;
  #lastSeenAt = new Map(); // deviceId -> epoch ms
  #unsubAck = null;
  #unsubPresence = null;
  #started = false;

  constructor(deps = {}) {
    if (!deps.eventBus) {
      throw new TypeError('CommandHandlerLivenessService requires eventBus');
    }
    this.#eventBus = deps.eventBus;
    this.#logger = deps.logger || console;
    this.#clock = deps.clock || Date;
    this.#freshnessMs = typeof deps.freshnessMs === 'number' && deps.freshnessMs > 0
      ? deps.freshnessMs
      : DEFAULT_FRESHNESS_MS;
  }

  start() {
    if (this.#started) return;
    this.#started = true;

    this.#unsubAck = this.#eventBus.subscribe('device-ack', (payload) => {
      const deviceId = payload?.deviceId;
      if (!deviceId) return;
      this.#lastSeenAt.set(deviceId, this.#clock.now());
      this.#logger.debug?.('command-handler-liveness.ack', { deviceId });
    });

    if (typeof this.#eventBus.subscribePattern === 'function') {
      this.#unsubPresence = this.#eventBus.subscribePattern(
        (topic) => typeof topic === 'string' && topic.startsWith(PRESENCE_TOPIC_PREFIX),
        (payload, topic) => {
          const deviceId = payload?.deviceId || topic.slice(PRESENCE_TOPIC_PREFIX.length);
          if (!deviceId) return;
          if (payload?.online === false) {
            this.#lastSeenAt.delete(deviceId);
            this.#logger.debug?.('command-handler-liveness.offline', { deviceId });
          } else {
            this.#lastSeenAt.set(deviceId, this.#clock.now());
            this.#logger.debug?.('command-handler-liveness.presence', { deviceId });
          }
        },
      );
    } else {
      this.#logger.warn?.('command-handler-liveness.no_subscribe_pattern', {
        note: 'event bus lacks subscribePattern — presence beacons ignored',
      });
    }

    this.#logger.info?.('command-handler-liveness.start', { freshnessMs: this.#freshnessMs });
  }

  stop() {
    if (!this.#started) return;
    this.#started = false;
    try { this.#unsubAck?.(); } catch (e) { /* swallow */ }
    try { this.#unsubPresence?.(); } catch (e) { /* swallow */ }
    this.#unsubAck = null;
    this.#unsubPresence = null;
    this.#lastSeenAt.clear();
    this.#logger.info?.('command-handler-liveness.stop');
  }

  isFresh(deviceId, windowMs) {
    const ts = this.#lastSeenAt.get(deviceId);
    if (!ts) return false;
    const limit = typeof windowMs === 'number' && windowMs > 0 ? windowMs : this.#freshnessMs;
    return (this.#clock.now() - ts) < limit;
  }

  /** Diagnostic — returns the lastSeenAt map (frozen). */
  snapshot() {
    return Object.freeze(Object.fromEntries(this.#lastSeenAt));
  }
}

export default CommandHandlerLivenessService;
```

- [ ] **Step 5: Export from the services index**

Open `backend/src/3_applications/devices/services/index.mjs` and add:

```js
export { CommandHandlerLivenessService } from './CommandHandlerLivenessService.mjs';
```

(Match the existing export style in the file — if it re-exports defaults, follow that convention instead.)

- [ ] **Step 6: Run the test**

```bash
npx vitest run tests/isolated/application/devices/CommandHandlerLivenessService.test.mjs 2>&1 | tail -10
```

Expected: 6 passes.

- [ ] **Step 7: Commit**

```bash
git add backend/src/3_applications/devices/services/CommandHandlerLivenessService.mjs backend/src/3_applications/devices/services/index.mjs shared/contracts/media/topics.mjs tests/isolated/application/devices/CommandHandlerLivenessService.test.mjs
git commit -m "$(cat <<'EOF'
feat(devices): add CommandHandlerLivenessService

Track per-device handler-presence freshness from device-ack and a
new command-handler-presence:<deviceId> beacon. Wake-and-load gates
the WS-first warm path on this service in the next commit, replacing
the bare subscriberCount check that mistakes stale WS connections
for live command handlers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Emit presence beacons from `useCommandAckPublisher`

**Files:**
- Modify: `frontend/src/screen-framework/publishers/useCommandAckPublisher.js` (add beacon)
- Modify: `frontend/src/screen-framework/publishers/useCommandAckPublisher.test.jsx` (extend)

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/screen-framework/publishers/useCommandAckPublisher.test.jsx`:

```jsx
describe('useCommandAckPublisher — presence beacon', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends an online presence beacon on mount', () => {
    const sendSpy = vi.spyOn(wsService, 'send');
    const bus = makeBus();
    renderHook(() => useCommandAckPublisher({ deviceId: 'tv-1', actionBus: bus }));
    const beacon = sendSpy.mock.calls.find(
      ([m]) => m?.topic === 'command-handler-presence:tv-1',
    );
    expect(beacon).toBeDefined();
    expect(beacon[0].deviceId).toBe('tv-1');
    expect(beacon[0].online).toBe(true);
  });

  it('repeats the beacon every 10 s', () => {
    const sendSpy = vi.spyOn(wsService, 'send');
    const bus = makeBus();
    renderHook(() => useCommandAckPublisher({ deviceId: 'tv-1', actionBus: bus }));
    sendSpy.mockClear();
    vi.advanceTimersByTime(10_000);
    const calls = sendSpy.mock.calls.filter(([m]) => m?.topic === 'command-handler-presence:tv-1');
    expect(calls.length).toBe(1);
  });

  it('sends an offline beacon on unmount', () => {
    const sendSpy = vi.spyOn(wsService, 'send');
    const bus = makeBus();
    const { unmount } = renderHook(() => useCommandAckPublisher({ deviceId: 'tv-1', actionBus: bus }));
    sendSpy.mockClear();
    unmount();
    const offlineBeacon = sendSpy.mock.calls.find(
      ([m]) => m?.topic === 'command-handler-presence:tv-1' && m?.online === false,
    );
    expect(offlineBeacon).toBeDefined();
  });
});
```

(Reuse the existing `makeBus` helper from this file. If the file does not yet import `wsService` or use fake timers, copy the pattern from the top of the file.)

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run frontend/src/screen-framework/publishers/useCommandAckPublisher.test.jsx 2>&1 | tail -15
```

Expected: 3 new failures — no presence message ever sent.

- [ ] **Step 3: Add the beacon to `useCommandAckPublisher`**

In `frontend/src/screen-framework/publishers/useCommandAckPublisher.js`, inside the `useEffect` that already exists, after the `unsubs.push(...)` loop and before `logger().info('mounted', ...)`:

```js
    const PRESENCE_INTERVAL_MS = 10_000;
    const presenceTopic = `command-handler-presence:${deviceId}`;
    const sendPresence = (online) => {
      try {
        wsService.send({ topic: presenceTopic, deviceId, online, ts: new Date().toISOString() });
      } catch (err) {
        logger().warn('presence-send-failed', { error: String(err?.message ?? err) });
      }
    };

    sendPresence(true);
    const presenceTimer = setInterval(() => sendPresence(true), PRESENCE_INTERVAL_MS);
```

Then in the cleanup return inside the same `useEffect`:

```js
    return () => {
      clearInterval(presenceTimer);
      sendPresence(false);
      for (const u of unsubs) {
        try { u?.(); } catch (err) {
          logger().warn('unsubscribe-failed', { error: String(err?.message ?? err) });
        }
      }
      recent.clear();
      logger().info('unmounted', { deviceId });
    };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run frontend/src/screen-framework/publishers/useCommandAckPublisher.test.jsx 2>&1 | tail -10
```

Expected: all 3 new tests pass; existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screen-framework/publishers/useCommandAckPublisher.js frontend/src/screen-framework/publishers/useCommandAckPublisher.test.jsx
git commit -m "$(cat <<'EOF'
feat(screen): emit command-handler-presence beacons

useCommandAckPublisher now sends a presence beacon on mount, every
10 s, and a final online:false beacon on unmount. The backend
CommandHandlerLivenessService consumes these so wake-and-load can
gate WS-first delivery on positive evidence that a handler is alive,
not just that some WS subscriber is on the topic.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Replace `subscriberCount` gate with liveness gate in WakeAndLoadService

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs` (instantiate liveness service, inject into WakeAndLoadService)
- Modify: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs:35-65` (constructor) and `:407-466` (WS-first gate)
- Modify: `tests/isolated/application/devices/WakeAndLoadService.op.test.mjs` (mock liveness service)

- [ ] **Step 1: Write the new gate test**

Append to `tests/isolated/application/devices/WakeAndLoadService.op.test.mjs`:

```js
describe('WakeAndLoadService — WS-first liveness gate', () => {
  let svc;
  let device;
  let broadcast;
  let eventBus;
  let livenessService;

  beforeEach(() => {
    broadcast = vi.fn();
    eventBus = {
      getTopicSubscriberCount: vi.fn().mockReturnValue(1),
      waitForMessage: vi.fn().mockResolvedValue({
        topic: 'device-ack', deviceId: 'tv', commandId: 'd', ok: true,
      }),
      subscribe: vi.fn().mockReturnValue(() => {}),
    };
    livenessService = { isFresh: vi.fn() };
    device = makeDevice();
    svc = new WakeAndLoadService({
      deviceService: { get: () => device },
      readinessPolicy: { isReady: vi.fn().mockResolvedValue({ ready: true }) },
      broadcast,
      eventBus,
      commandHandlerLivenessService: livenessService,
      logger: makeLogger(),
    });
  });

  it('skips WS-first when liveness reports stale, falls back to FKB URL', async () => {
    livenessService.isFresh.mockReturnValue(false);
    const result = await svc.execute('tv', { queue: 'plex:1' });

    expect(eventBus.waitForMessage).not.toHaveBeenCalled();
    expect(device.loadContent).toHaveBeenCalled();
    expect(result.steps.load.method).toBe('fkb-fallback');
    expect(result.steps.load.wsSkipped).toBe('handler-stale');
  });

  it('uses WS-first when liveness reports fresh', async () => {
    livenessService.isFresh.mockReturnValue(true);
    const result = await svc.execute('tv', { queue: 'plex:1' });

    expect(eventBus.waitForMessage).toHaveBeenCalled();
    expect(result.steps.load.method).toBe('websocket');
  });
});
```

(`makeDevice` and `makeLogger` are existing helpers in this file.)

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/isolated/application/devices/WakeAndLoadService.op.test.mjs 2>&1 | tail -10
```

Expected: both new tests fail (liveness service is currently ignored; WS-first gate is on `subscriberCount`).

- [ ] **Step 3: Update WakeAndLoadService constructor**

In `backend/src/3_applications/devices/services/WakeAndLoadService.mjs`, modify the private fields and constructor:

```js
  #deviceService;
  #readinessPolicy;
  #broadcast;
  #eventBus;
  #prewarmService;
  #sessionControlService;
  #commandHandlerLivenessService;
  #logger;

  // ...

  constructor(deps) {
    this.#deviceService = deps.deviceService;
    this.#readinessPolicy = deps.readinessPolicy;
    this.#broadcast = deps.broadcast;
    this.#eventBus = deps.eventBus || null;
    this.#prewarmService = deps.prewarmService || null;
    this.#sessionControlService = deps.sessionControlService || null;
    this.#commandHandlerLivenessService = deps.commandHandlerLivenessService || null;
    this.#logger = deps.logger || console;
  }
```

- [ ] **Step 4: Replace the WS-first gate**

In `backend/src/3_applications/devices/services/WakeAndLoadService.mjs:407-466`, replace the WS-first block:

```js
    const liveness = this.#commandHandlerLivenessService;
    const handlerFresh = liveness ? liveness.isFresh(deviceId) : false;
    const warmPrepare = !coldWake && hasContentQuery && !!this.#eventBus;
    const subscriberCount = warmPrepare ? this.#eventBus.getTopicSubscriberCount(topic) : 0;
    let wsDelivered = false;
    let wsSkipReason = null;

    if (warmPrepare) {
      this.#logger.info?.('wake-and-load.load.ws-check', {
        deviceId, dispatchId, topic, subscriberCount, handlerFresh,
      });

      if (subscriberCount === 0) {
        wsSkipReason = 'no-subscribers';
      } else if (!handlerFresh) {
        wsSkipReason = 'handler-stale';
      }

      if (!wsSkipReason) {
        try {
          const resolved = resolveContentId(contentQuery);
          if (!resolved) throw new Error('ws-first.no-contentId');
          const { contentId: resolvedContentId, resolvedKey } = resolved;
          const requestedOp = isLoadContentQueueOp(contentQuery.op) ? contentQuery.op : 'play-now';
          const passThroughOpts = { ...contentQuery };
          delete passThroughOpts[resolvedKey];
          delete passThroughOpts.op;

          const envelope = buildCommandEnvelope({
            targetDevice: deviceId,
            command: 'queue',
            commandId: dispatchId,
            params: { ...passThroughOpts, op: requestedOp, contentId: resolvedContentId },
          });
          this.#broadcast({ topic, ...envelope });

          const ackStart = Date.now();
          await this.#eventBus.waitForMessage(
            (msg) =>
              msg?.topic === 'device-ack' &&
              msg?.deviceId === deviceId &&
              msg?.commandId === dispatchId,
            4000,
          );
          const ackMs = Date.now() - ackStart;
          this.#logger.info?.('wake-and-load.load.ws-ack', { deviceId, dispatchId, ackMs });

          result.steps.load = { ok: true, method: 'websocket', ackMs };
          wsDelivered = true;
          this.#emitProgress(topic, dispatchId, 'load', 'done', { method: 'websocket' });
        } catch (err) {
          this.#logger.warn?.('wake-and-load.load.ws-failed', { deviceId, dispatchId, error: err.message });
          wsSkipReason = 'ws-error';
        }
      } else {
        this.#logger.info?.('wake-and-load.load.ws-skipped', {
          deviceId, dispatchId, reason: wsSkipReason,
        });
      }
    } else {
      wsSkipReason = coldWake ? 'cold-restart' : (!hasContentQuery ? 'no-content' : 'no-event-bus');
    }
```

Then update the FKB-fallback success branch (the `if (loadResult.ok)` block at what was line 480) to record `wsSkipReason`:

```js
      if (loadResult.ok) {
        result.steps.load = {
          ...loadResult,
          ...(wsSkipReason ? { method: 'fkb-fallback', wsSkipped: wsSkipReason } : {}),
        };
        this.#emitProgress(topic, dispatchId, 'load', 'done');
      }
```

- [ ] **Step 5: Run the test**

```bash
npx vitest run tests/isolated/application/devices/WakeAndLoadService.op.test.mjs 2>&1 | tail -10
```

Expected: all tests pass (existing + 2 new).

- [ ] **Step 6: Run the full WakeAndLoadService suite**

```bash
npx vitest run tests/isolated/application/devices/WakeAndLoadService.*.test.mjs 2>&1 | tail -10
```

Expected: every test still passes. Existing tests that don't pass `commandHandlerLivenessService` will hit the `liveness ? ... : false` branch — meaning the WS-first path is never taken for those tests. Verify by reading any failures: tests that were previously asserting `method: 'websocket'` without injecting liveness need to be updated to inject `livenessService: { isFresh: () => true }`. Update them in place, in this same task.

- [ ] **Step 7: Wire bootstrap**

In `backend/src/0_system/bootstrap.mjs`, find the `WakeAndLoadService` instantiation (search `new WakeAndLoadService`). Above it, instantiate liveness:

```js
const commandHandlerLivenessService = new CommandHandlerLivenessService({
  eventBus,
  logger: deps.logger?.child?.({ component: 'command-handler-liveness' }) || deps.logger,
});
commandHandlerLivenessService.start();
```

Then add the parameter to the existing constructor call:

```js
const wakeAndLoadService = new WakeAndLoadService({
  // ... existing deps
  commandHandlerLivenessService,
});
```

Also import the class at the top of `bootstrap.mjs`:

```js
import { CommandHandlerLivenessService } from '#apps/devices/services/CommandHandlerLivenessService.mjs';
```

- [ ] **Step 8: Commit**

```bash
git add backend/src/3_applications/devices/services/WakeAndLoadService.mjs backend/src/0_system/bootstrap.mjs tests/isolated/application/devices/WakeAndLoadService.op.test.mjs
git commit -m "$(cat <<'EOF'
feat(wake-and-load): gate WS-first on handler liveness, not subscriber count

WS-first warm-switch now requires a fresh device-ack or
command-handler-presence beacon (≤30 s old) in addition to a
non-zero subscriber count. The previous gate trusted any WS
subscriber, which caused 4 s ack-timeouts when a stale or
non-screen-framework subscriber was attached. Falls through to
FKB URL fallback with wsSkipped='handler-stale' when liveness
reports stale.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Verify in dev, then deploy and verify in prod

**Files:** None (operational task)

- [ ] **Step 1: Run the full isolated suite**

```bash
npm run test:isolated 2>&1 | tail -20
```

Expected: all tests pass. If failures appear, re-read `MEMORY.md` — there are known-dead vitest tests under `backend/tests/unit/suite/` that may produce noise; non-noise failures must be fixed.

- [ ] **Step 2: Start dev server (if not running)**

```bash
ss -tlnp | grep 3112 || nohup node backend/index.js > /tmp/backend-dev.log 2>&1 &
```

- [ ] **Step 3: Reproduce the failing case against dev**

```bash
curl -sS -w '\nHTTP %{http_code}\n' \
  "http://localhost:3112/api/v1/device/livingroom-tv/load?queue=plex:487146&shuffle=1" \
  | head -30
```

Expected:
- HTTP 422
- Body: `"failedStep": "prewarm"`, `"permanent": true`, `"code": "CONTENT_NOT_FOUND"`
- `dev.log` shows JSON-formatted `plex.loadMediaUrl.nonPlayableType` event (not the old plain-text `[PlexAdapter]` line).

- [ ] **Step 4: Reproduce a known-good queue against dev**

Pick any registered NFC tag's Plex ID — for example `plex:642120` from the canonical example in `docs/reference/trigger/events.md:129`. (Confirm it's still registered: `sudo docker exec daylight-station sh -c 'cat data/household/config/triggers/nfc/tags.yml | head -40'`.)

```bash
curl -sS -w '\nHTTP %{http_code}\n' \
  "http://localhost:3112/api/v1/device/livingroom-tv/load?queue=plex:642120&shuffle=1" \
  | head -30
```

Expected:
- HTTP 200, `ok: true`
- If TV was already on with the screen-framework loaded: `result.steps.load.method === 'websocket'` (the new liveness gate let WS-first run).
- If TV was off: `coldWake: true`, `result.steps.load.method` is the FKB URL load.

- [ ] **Step 5: Deploy to prod**

(Per `CLAUDE.local.md`'s "deploy at will on prod host" rule, no further confirmation needed on this host.)

```bash
sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 6: Verify in prod with the original failing call**

```bash
curl -sS -w '\nHTTP %{http_code}\n' \
  "https://daylightstation.kckern.net/api/v1/device/livingroom-tv/load?queue=plex:487146&shuffle=1" \
  | head -30
sleep 3
sudo docker logs daylight-station --since 10s 2>&1 \
  | grep -E '"event":"(wake-and-load|prewarm|plex\.loadMediaUrl|command-handler-liveness)\.' \
  | tail -20
```

Expected:
- HTTP 422
- Logs include structured (JSON) `plex.loadMediaUrl.nonPlayableType` and `wake-and-load.prewarm.failed { permanent: true }`.
- No plain-text `[PlexAdapter]` lines.

- [ ] **Step 7: Verify warm WS-first against a known-good queue in prod**

Tap a real registered NFC tag at the living-room reader (or curl with that tag's content). After it lands, immediately re-trigger via the device API:

```bash
curl -sS \
  "https://daylightstation.kckern.net/api/v1/device/livingroom-tv/load?queue=plex:642120" \
  | head -30
```

Expected: `result.steps.load.method === 'websocket'`, `ackMs < 1000`, no `wsError`.

If it instead reports `wsSkipped: 'handler-stale'`, that's the correct new behavior — but the screen really should have a fresh handler. Investigate: is `useCommandAckPublisher` mounted on the screen route? Check the frontend logs in the container's stdout for `CommandAckPublisher mounted` events.

---

## Self-Review

**Spec coverage:**
- Idea 1 (heartbeat-based handler liveness gate) → Tasks 6, 7, 8 ✓
- Idea 2 (surface prewarm failures as 4xx) → Tasks 2, 3, 4, 5 ✓
- Idea 3 (fix raw console logging in PlexAdapter) → Task 1 ✓

**Placeholder scan:** No "TBD", "implement later", or "add appropriate error handling" instructions. Each step includes the exact code to paste.

**Type consistency:**
- `loadMediaUrl` returns `{ url, reason? }` consistently (Task 2) — `TranscodePrewarmService` reads `mediaResult.url` (Task 3).
- `prewarm` return shape: `{ status: 'ok' | 'failed' | 'skipped', reason?, permanent?, token?, contentId? }` — Task 4 reads `prewarmResult.permanent`.
- `wakeAndLoadService.execute` result adds `permanent: boolean` only when `failedStep === 'prewarm'` — Task 5 reads it.
- `CommandHandlerLivenessService.isFresh(deviceId, windowMs?)` — Task 8 calls `liveness.isFresh(deviceId)` with default window.
- Topic name `command-handler-presence:<deviceId>` is consistent across Tasks 6 (subscribe), 7 (publish), and 8 (no direct use; goes through liveness service).
- `wsSkipped` reason values: `'no-subscribers' | 'handler-stale' | 'ws-error' | 'cold-restart' | 'no-content' | 'no-event-bus'` — used consistently in Task 8.

---

## See Also

- `docs/reference/trigger/events.md` — explains why trigger flows hit the same `wakeAndLoadService.execute` code path; the "trigger is more reliable" perception is content-curation + cold-wake bias, not a different delivery mechanism.
- `backend/src/3_applications/devices/services/DeviceLivenessService.mjs` — companion service that tracks device-state heartbeats. The new `CommandHandlerLivenessService` is intentionally separate: it tracks **frontend command-handler presence**, which is a stricter signal than "device has a session publisher".
