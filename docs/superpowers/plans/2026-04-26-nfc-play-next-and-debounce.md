# NFC play-next Wiring + Per-Tag Debounce Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop NFC scans from restarting/reloading the currently playing item. Use the existing `play-next` pipeline (which already aliases to `play` when the player is idle and pushes to on-deck when it's active), and add a backend per-tag debounce so multi-fire HA `tag_scanned` events don't spawn duplicate wake-and-load cycles.

**Architecture:**
1. Flip `nfc.yml` location-default `action` from `play` to `play-next` (closes deferred Task 12 from `2026-04-25-on-deck-implementation.md`). The frontend `ScreenActionHandler.handleMediaQueueOp` already routes `play-next` correctly: idle player → fresh playback (alias for `play`, with 3 s `MEDIA_DEDUP_WINDOW_MS` guard); active player → `player:queue-op` DOM event → on-deck push with same-content dedup.
2. Add a per-(location, modality, value) debounce window inside `TriggerDispatchService.handleTrigger` so rapid duplicate scans (HA fires `tag_scanned` 2-3 times per physical tap, observed elapsedMs pairs of 35 s + 12 s in prod logs) get dropped server-side before they reach `dispatchAction`. New short-circuit returns `{ ok: true, debounced: true, ... }` so callers see success.

**Tech Stack:** Node 20 ES modules, Jest. Backend service in `backend/src/3_applications/trigger/`. Config under `data/household/config/`. No frontend changes (already implemented under `2026-04-25-on-deck-implementation.md`).

---

## File Structure

| File | Responsibility |
|---|---|
| `data/household/config/nfc.yml` | Location config: switch default `action` to `play-next` |
| `backend/src/3_applications/trigger/TriggerDispatchService.mjs` | Add debounce Map + window check at top of `handleTrigger`; emit `trigger.debounced` log; return `{ ok: true, debounced: true }` |
| `tests/isolated/application/trigger/TriggerDispatchService.test.mjs` | Add tests for debounce behavior (new file or extend existing) |

The debounce belongs in `TriggerDispatchService` (not the API router) because it's a domain rule — "the same trigger fired within N ms is conceptually one event" — and applies regardless of which transport (HTTP, WS, in-process) submitted it.

---

## Task 1: Backend — debounce in TriggerDispatchService

**Files:**
- Modify: `backend/src/3_applications/trigger/TriggerDispatchService.mjs`
- Test: `tests/isolated/application/trigger/TriggerDispatchService.test.mjs` (create if absent)

**Design notes (read before editing):**
- The debounce window key is `${location}:${modality}:${normalizedValue}`. It is INTENTIONALLY scoped per-tag so two different tags fired in quick succession are NOT debounced against each other.
- Default window: 3000 ms. Configurable via constructor option `debounceWindowMs`.
- The Map MUST be pruned periodically (or per-call) to avoid unbounded growth — prune entries older than `debounceWindowMs` on each call.
- `dryRun` requests bypass the debounce (debugging tool).
- Failed dispatches (TRIGGER_NOT_REGISTERED, INVALID_INTENT, dispatch errors) ALSO reset the debounce timer — we only want to suppress duplicate *successful* fires. Implementation: record the timestamp BEFORE dispatch; if dispatch fails, delete the entry so the user can retry immediately.
- The response shape for a debounced call mirrors a successful call but adds `debounced: true`. This way HTTP callers (e.g., HA's REST notify integration) see HTTP 200 and don't retry.

- [ ] **Step 1: Find the existing test file (if any) and read it**

Run:
```bash
find /opt/Code/DaylightStation/tests -name "TriggerDispatchService*" 2>/dev/null
```

Expected: a path or empty output. If a file exists, read it before adding tests. If not, you'll create one in Step 2.

- [ ] **Step 2: Write the failing tests**

Create or extend `tests/isolated/application/trigger/TriggerDispatchService.test.mjs` with these tests. If extending, add to the existing `describe` block. If creating, use this complete file:

```javascript
import { jest } from '@jest/globals';
import { TriggerDispatchService } from '#applications/trigger/TriggerDispatchService.mjs';

const baseConfig = {
  livingroom: {
    target: 'livingroom-tv',
    action: 'play-next',
    entries: {
      nfc: {
        '83_8e_68_06': { plex: '620707' },
      },
    },
  },
};

const makeContentIdResolver = () => ({
  resolve: (entry) => (entry?.plex ? `plex:${entry.plex}` : null),
});

const silentLogger = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
};

describe('TriggerDispatchService — debounce', () => {
  test('first scan dispatches; second scan within window is debounced', async () => {
    const wakeAndLoadService = { execute: jest.fn().mockResolvedValue({ ok: true }) };
    const service = new TriggerDispatchService({
      config: baseConfig,
      contentIdResolver: makeContentIdResolver(),
      wakeAndLoadService,
      logger: silentLogger,
      debounceWindowMs: 3000,
    });

    const first = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06');
    expect(first.ok).toBe(true);
    expect(first.debounced).toBeUndefined();
    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(1);

    const second = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06');
    expect(second.ok).toBe(true);
    expect(second.debounced).toBe(true);
    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(1); // unchanged
  });

  test('different tag in same window is NOT debounced', async () => {
    const wakeAndLoadService = { execute: jest.fn().mockResolvedValue({ ok: true }) };
    const config = {
      livingroom: {
        target: 'livingroom-tv',
        action: 'play-next',
        entries: {
          nfc: {
            '83_8e_68_06': { plex: '620707' },
            '8d_6d_2a_07': { plex: '620707' },
          },
        },
      },
    };
    const service = new TriggerDispatchService({
      config,
      contentIdResolver: makeContentIdResolver(),
      wakeAndLoadService,
      logger: silentLogger,
      debounceWindowMs: 3000,
    });

    await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06');
    await service.handleTrigger('livingroom', 'nfc', '8d_6d_2a_07');
    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(2);
  });

  test('scan after window elapses is dispatched normally', async () => {
    const wakeAndLoadService = { execute: jest.fn().mockResolvedValue({ ok: true }) };
    let now = 1_000_000;
    const service = new TriggerDispatchService({
      config: baseConfig,
      contentIdResolver: makeContentIdResolver(),
      wakeAndLoadService,
      logger: silentLogger,
      debounceWindowMs: 3000,
      clock: () => now,
    });

    await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06');
    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(1);

    now += 3500; // past window
    const result = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06');
    expect(result.debounced).toBeUndefined();
    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(2);
  });

  test('dryRun bypasses debounce', async () => {
    const wakeAndLoadService = { execute: jest.fn().mockResolvedValue({ ok: true }) };
    const service = new TriggerDispatchService({
      config: baseConfig,
      contentIdResolver: makeContentIdResolver(),
      wakeAndLoadService,
      logger: silentLogger,
      debounceWindowMs: 3000,
    });

    await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06');
    const dry = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06', { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.debounced).toBeUndefined();
  });

  test('failed dispatch clears debounce so user can retry immediately', async () => {
    const wakeAndLoadService = { execute: jest.fn().mockRejectedValueOnce(new Error('wake-fail')).mockResolvedValueOnce({ ok: true }) };
    const service = new TriggerDispatchService({
      config: baseConfig,
      contentIdResolver: makeContentIdResolver(),
      wakeAndLoadService,
      logger: silentLogger,
      debounceWindowMs: 3000,
    });

    const first = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06');
    expect(first.ok).toBe(false);

    const second = await service.handleTrigger('livingroom', 'nfc', '83_8e_68_06');
    expect(second.ok).toBe(true);
    expect(second.debounced).toBeUndefined();
    expect(wakeAndLoadService.execute).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run:
```bash
npx jest tests/isolated/application/trigger/TriggerDispatchService.test.mjs --no-coverage 2>&1 | tail -20
```

Expected: All 5 tests fail. The first two will fail because no debounce logic exists; the others may fail with errors about unknown `clock` / `debounceWindowMs` constructor options.

- [ ] **Step 4: Implement debounce in TriggerDispatchService**

Open `backend/src/3_applications/trigger/TriggerDispatchService.mjs` and modify the constructor and `handleTrigger`:

In the class fields/constructor area, add:
```javascript
  #recentDispatches;   // Map<key, timestampMs>
  #debounceWindowMs;
  #clock;
```

Update the constructor signature to accept `debounceWindowMs` and `clock`:
```javascript
  constructor({
    config,
    contentIdResolver,
    wakeAndLoadService,
    haGateway,
    deviceService,
    broadcast,
    logger = console,
    debounceWindowMs = 3000,
    clock = () => Date.now(),
  }) {
    this.#config = config || {};
    this.#contentIdResolver = contentIdResolver;
    this.#deps = { wakeAndLoadService, haGateway, deviceService };
    this.#broadcast = broadcast || (() => {});
    this.#logger = logger;
    this.#recentDispatches = new Map();
    this.#debounceWindowMs = debounceWindowMs;
    this.#clock = clock;
  }
```

Add a private helper (place above `handleTrigger`):
```javascript
  // Map cleanup avoids unbounded growth: every check prunes anything older
  // than the window. With a small number of triggers per location and a
  // 3 s window this is effectively O(N_active_keys) per call.
  #pruneDispatches(now) {
    for (const [key, ts] of this.#recentDispatches) {
      if (now - ts > this.#debounceWindowMs) this.#recentDispatches.delete(key);
    }
  }
```

In `handleTrigger`, replace the function body's opening (down through the location lookup) with:
```javascript
  async handleTrigger(location, modality, value, options = {}) {
    const startedAt = this.#clock();
    const dispatchId = randomUUID();
    const normalizedValue = String(value || '').toLowerCase();
    const locationConfig = this.#config[location];

    if (!locationConfig) {
      this.#logger.warn?.('trigger.fired', { location, modality, value: normalizedValue, registered: false, error: 'location-not-found' });
      return { ok: false, code: 'LOCATION_NOT_FOUND', error: `Unknown location: ${location}`, location, modality, value: normalizedValue, dispatchId };
    }

    if (locationConfig.auth_token && locationConfig.auth_token !== options.token) {
      this.#logger.warn?.('trigger.fired', { location, modality, value: normalizedValue, error: 'auth-failed' });
      return { ok: false, code: 'AUTH_FAILED', error: 'Authentication failed', location, modality, value: normalizedValue, dispatchId };
    }

    // Per-(location, modality, value) debounce. HA fires `tag_scanned` 2-3
    // times per physical tap; without this guard each one spawns a fresh
    // 22-35 s wake-and-load cycle. dryRun requests bypass to keep the
    // debugging path simple. Failed dispatches reset the entry below so
    // the user can immediately retry.
    const debounceKey = `${location}:${modality}:${normalizedValue}`;
    if (!options.dryRun) {
      this.#pruneDispatches(startedAt);
      const lastTs = this.#recentDispatches.get(debounceKey);
      if (lastTs != null && startedAt - lastTs < this.#debounceWindowMs) {
        const sinceMs = startedAt - lastTs;
        this.#logger.info?.('trigger.debounced', { location, modality, value: normalizedValue, sinceMs, windowMs: this.#debounceWindowMs, dispatchId });
        return { ok: true, debounced: true, location, modality, value: normalizedValue, dispatchId, sinceMs };
      }
    }
```

Continue with the existing `valueEntry`/intent-resolution flow — that code is unchanged.

In the success branch (where `dispatchAction` resolves), record the timestamp AFTER success:
```javascript
    try {
      const dispatchResult = await dispatchAction(intent, this.#deps);
      const elapsedMs = this.#clock() - startedAt;
      if (!options.dryRun) {
        this.#recentDispatches.set(debounceKey, this.#clock());
      }
      this.#logger.info?.('trigger.fired', { ...baseLog, action: intent.action, target: intent.target, ok: true, elapsedMs });
      this.#emit(location, modality, { ...summary, ok: true });
      return { ok: true, ...summary, dispatch: dispatchResult, elapsedMs };
    } catch (err) {
      const elapsedMs = this.#clock() - startedAt;
      // On failure, ensure no debounce entry persists — user should be
      // able to retry without waiting out the window.
      this.#recentDispatches.delete(debounceKey);
      const code = err instanceof UnknownActionError ? 'UNKNOWN_ACTION' : 'DISPATCH_FAILED';
      this.#logger.error?.('trigger.fired', { ...baseLog, action: intent.action, target: intent.target, ok: false, error: err.message, code, elapsedMs });
      this.#emit(location, modality, { ...summary, ok: false, error: err.message });
      return { ok: false, code, error: err.message, ...summary, elapsedMs };
    }
```

Also replace the two other `Date.now()` references in the function (the `startedAt` and `elapsedMs` calculations) with `this.#clock()` calls — already done in the snippets above.

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```bash
npx jest tests/isolated/application/trigger/TriggerDispatchService.test.mjs --no-coverage 2>&1 | tail -10
```

Expected: All 5 tests pass.

- [ ] **Step 6: Run the full trigger test suite to ensure no regressions**

Run:
```bash
npx jest tests/isolated/application/trigger --no-coverage 2>&1 | tail -10
```

Expected: All trigger tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/3_applications/trigger/TriggerDispatchService.mjs tests/isolated/application/trigger/TriggerDispatchService.test.mjs
git commit -m "$(cat <<'EOF'
feat(trigger): per-(location,modality,value) debounce window

HA fires tag_scanned 2-3 times per physical NFC tap; without a guard each
fires a fresh 22-35 s wake-and-load cycle. Default 3 s window short-circuits
duplicates, returns {ok: true, debounced: true}. Failed dispatches drop the
entry so the user can retry immediately. dryRun bypasses for debugging.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Config — flip nfc.yml default action to play-next

**Files:**
- Modify: `data/household/config/nfc.yml` (inside the daylight-station container's data volume — NOT in the repo working tree)

**Design notes:**
- This is a runtime config file in the data volume. The host `claude` user cannot read/write it directly (permission denied); use `sudo docker exec daylight-station sh -c '...'` per the standing memory.
- Use heredoc, NEVER `sed -i` — sed mangles multi-line YAML.
- The change is one word: `action: play` → `action: play-next` at the location-default level. Per-tag overrides remain valid (a tag can set `action: play` to bypass on-deck if ever needed).
- The container does NOT need to be restarted; the trigger service reads config at request time.

- [ ] **Step 1: Read the current nfc.yml**

Run:
```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/nfc.yml'
```

Expected output (verify before editing):
```yaml
# NFC Tag → Action mapping + state-change triggers
# Source: tag_scanned and tv-state events from HA
# Format: location-rooted; entries grouped by modality block
#   - tags:   modality "nfc"   (NFC tag UIDs)
#   - states: modality "state" (TV/display state changes)

livingroom:
  target: livingroom-tv
  action: play              # default for tags
  tags:
    83_8e_68_06:
      plex: 620707
    8d_6d_2a_07:
      plex: 620707
  states:
    off:
      action: clear         # navigate FKB to Start URL when TV turns off
```

- [ ] **Step 2: Write the updated nfc.yml**

Run (heredoc avoids sed issues with multi-line YAML):
```bash
sudo docker exec daylight-station sh -c "cat > data/household/config/nfc.yml << 'EOF'
# NFC Tag → Action mapping + state-change triggers
# Source: tag_scanned and tv-state events from HA
# Format: location-rooted; entries grouped by modality block
#   - tags:   modality \"nfc\"   (NFC tag UIDs)
#   - states: modality \"state\" (TV/display state changes)

livingroom:
  target: livingroom-tv
  action: play-next         # default for tags — alias for play if idle, otherwise on-deck push
  tags:
    83_8e_68_06:
      plex: 620707
    8d_6d_2a_07:
      plex: 620707
  states:
    off:
      action: clear         # navigate FKB to Start URL when TV turns off
EOF"
```

- [ ] **Step 3: Verify the file content**

Run:
```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/nfc.yml'
```

Expected: file matches exactly what was written; the only change vs. Step 1 is the single line `action: play-next         # ...` replacing `action: play              # default for tags`.

- [ ] **Step 4: Verify the running service picks up the change via dry-run**

Run:
```bash
curl -sS -m 10 'http://localhost:3111/api/v1/trigger/livingroom/nfc/83_8e_68_06?dryRun=true' 2>&1
```

Expected: a JSON response containing `"action":"play-next"` (and `"target":"livingroom-tv"`, `"dryRun":true`).

If the endpoint shape is different (e.g. `POST` body instead of query param), check the trigger router:
```bash
grep -n "router\." /opt/Code/DaylightStation/backend/src/4_api/v1/routers/trigger.mjs | head -10
```

…and adapt the curl accordingly. The point is: a dry-run should report the resolved action as `play-next`.

- [ ] **Step 5: No git commit needed**

`data/` is in `.gitignore` — the file lives in the data volume, not the repo. Document the change inline in this plan execution log (the commit message for Task 1 covers the design; the config flip is operational state).

---

## Task 3: End-to-end verification

**Files:** None modified — verification only.

**Why this task:** The implementation is split between a backend service change (Task 1) and a runtime config flip (Task 2). Neither produces visible effects alone. This task confirms the integrated behavior using the deployed container.

- [ ] **Step 1: Confirm dev container is running with the new code**

Build, deploy, and confirm the running container's commit:
```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" . 2>&1 | tail -5
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight 2>&1 | tail -3
sleep 5
sudo docker exec daylight-station cat /build.txt
```

Expected: build output shows the latest commit hash; container starts; `build.txt` shows the matching hash.

- [ ] **Step 2: Tail the logs in the background**

Start a background log tail filtered for trigger events:
```bash
# Use the Bash tool's run_in_background option, OR (if executing via subagent):
sudo docker logs -f --since 1s daylight-station 2>&1 | grep --line-buffered -E "trigger\.(fired|debounced)" > /tmp/trigger-log.txt &
echo $! > /tmp/trigger-tail.pid
```

- [ ] **Step 3: Fire two NFC scans rapidly and observe**

```bash
curl -sS -m 5 'http://localhost:3111/api/v1/trigger/livingroom/nfc/83_8e_68_06' &
sleep 0.2
curl -sS -m 5 'http://localhost:3111/api/v1/trigger/livingroom/nfc/83_8e_68_06' &
wait
sleep 2
cat /tmp/trigger-log.txt
```

Expected output (one fired, one debounced):
- exactly one `trigger.fired` with `"action":"play-next"`, `"ok":true`
- one `trigger.debounced` with `"sinceMs"` < 3000

- [ ] **Step 4: Wait past the window and re-fire to confirm window expiry**

```bash
sleep 4
> /tmp/trigger-log.txt
curl -sS -m 5 'http://localhost:3111/api/v1/trigger/livingroom/nfc/83_8e_68_06' &
wait
sleep 2
cat /tmp/trigger-log.txt
```

Expected: a fresh `trigger.fired` with `ok:true` (no debounced log — the window has elapsed).

- [ ] **Step 5: Stop the log tail**

```bash
kill $(cat /tmp/trigger-tail.pid) 2>/dev/null
rm -f /tmp/trigger-tail.pid /tmp/trigger-log.txt
```

- [ ] **Step 6: Final commit (only if anything else changed)**

Task 1 already committed the backend change. Task 2's config edit lives in the data volume (not committed). No additional commit unless verification surfaced a code bug — in which case fix and re-commit.

---

## Self-Review

**Spec coverage:**
- Section 4 of `2026-04-25-on-deck-design.md` (`nfc.yml` `action: play-next`) — covered by Task 2.
- Section 5.3 of design (idle player → fall back to play-now) — already implemented in `ScreenActionHandler.jsx:136-150`; no change needed.
- New scope (debounce) — covered by Task 1.

**Placeholder scan:** Each step contains exact code/commands. No "TBD", no "implement later". Test code is complete; YAML content is complete; commit message is complete.

**Type consistency:** `debounceWindowMs` (number, ms), `clock` (function returning ms), `debounceKey` (string `${location}:${modality}:${value}`), response shape `{ ok: true, debounced: true, location, modality, value, dispatchId, sinceMs }` — used identically in test expectations and implementation.

**Out of scope (explicit):**
- Frontend on-deck implementation — already complete per `2026-04-25-on-deck-implementation.md` Tasks 1-11.
- Player overlay refactor — already done.
- Voice/barcode trigger debounce — same code applies but not exercised here; live tests will confirm later.
