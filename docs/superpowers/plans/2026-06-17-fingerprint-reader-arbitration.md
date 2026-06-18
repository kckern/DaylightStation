# Fingerprint Reader Arbitration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the garage box the single owner of the one physical fingerprint reader so an always-armed emergency scan and on-demand foreground unlocks (dance_party etc.) never collide.

**Architecture:** The garage `daylight-fitness` box owns the reader. A small `readerArbiter` runs at most one identify scan at a time; a foreground unlock **preempts** an in-flight emergency scan (cancels it, then runs the foreground scan). The libfprint helper learns to cancel cleanly on `SIGTERM` so a preempt releases the reader instead of leaving it claimed. On the backend, the `/unlock` handler brackets its scan with `beginForeground`/`endForeground` so the emergency detector stops re-arming for the duration.

**Tech Stack:** Node.js (`node:test`) on the garage box; Python 3 + libfprint (`gi` / `FPrint` 2.0) for the on-box helper; vitest for the backend router; Docker for both deploys (`daylight-station` + `daylight-fitness`).

**Prerequisite already landed:** commit `71a1bf550` raised the backend emergency arm timeout to 18s (`DEFAULT_ARM_TIMEOUT_MS = 18000`) so the broker no longer times out before the garage's 15s capture completes. This plan builds on that; do not revert it.

**Out of scope (separate plan):** the browser **ceremony not firing** after `fitness.emergency.detected` broadcasts — that is a frontend/commit-path bug, independent of reader contention. Track it separately.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `_extensions/fitness/src/readerArbiter.mjs` | Single-flight reader owner with foreground-preempts-emergency policy. Transport/hardware-agnostic (injected `runScan`). | **Create** |
| `_extensions/fitness/test/readerArbiter.test.mjs` | Unit tests for the arbiter (fake `runScan`, no hardware). | **Create** |
| `_extensions/fitness/src/fingerprint_helper.py` | On-box libfprint helper. Add graceful `SIGTERM`/`SIGINT` cancellation of an in-flight `identify_sync`. | **Modify** (`cmd_identify`, lines 101–128) |
| `_extensions/fitness/src/server.mjs` | Garage WS server. Add abort support to `runFingerprintHelper`; route unlock requests through the arbiter. | **Modify** (`runFingerprintHelper` 34–67; unlock handler 200–229) |
| `backend/src/4_api/v1/routers/fitness.mjs` | Backend `/unlock` route. Bracket the scan with `beginForeground`/`endForeground`. | **Modify** (handler 1331–1384, scan at 1365) |
| `backend/src/4_api/v1/routers/fitness.unlock.test.mjs` | Backend `/unlock` tests. Add bracket assertion. | **Modify** |

---

### Task 1: Reader arbiter module (single-flight + preemption)

**Files:**
- Create: `_extensions/fitness/src/readerArbiter.mjs`
- Test: `_extensions/fitness/test/readerArbiter.test.mjs`

Behaviour contract:
- At most one scan runs at a time.
- `submit({ kind:'foreground' })` while an `emergency` scan is in flight → abort the emergency scan, wait for it to release, then run the foreground scan.
- `submit({ kind:'emergency' })` or a second `foreground` while ANY scan is in flight → immediately resolve `{ matched:false, reason:'reader-busy' }` (no preemption; the backend re-arms emergency later).
- `runScan(uuids, { signal })` is injected; it MUST resolve when `signal` aborts.

- [ ] **Step 1: Write the failing tests**

Create `_extensions/fitness/test/readerArbiter.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReaderArbiter } from '../src/readerArbiter.mjs';

const silent = { log() {} };

// A controllable fake scan: resolves when you call its `finish`, or resolves
// { matched:false, reason:'aborted' } when its AbortSignal fires.
function deferredScan() {
  const calls = [];
  function runScan(uuids, { signal }) {
    return new Promise((resolve) => {
      const rec = { uuids, resolve, aborted: false };
      calls.push(rec);
      signal.addEventListener('abort', () => {
        rec.aborted = true;
        resolve({ matched: false, reason: 'aborted' });
      }, { once: true });
      rec.finish = (result) => resolve(result);
    });
  }
  return { runScan, calls };
}

test('runs a single scan and returns its result', async () => {
  const { runScan, calls } = deferredScan();
  const arb = createReaderArbiter({ runScan, logger: silent });
  const p = arb.submit({ kind: 'emergency', uuids: ['a'] });
  assert.equal(arb.currentKind(), 'emergency');
  calls[0].finish({ matched: true, uuid: 'a' });
  assert.deepEqual(await p, { matched: true, uuid: 'a' });
  assert.equal(arb.currentKind(), null);
});

test('foreground preempts an in-flight emergency scan', async () => {
  const { runScan, calls } = deferredScan();
  const arb = createReaderArbiter({ runScan, logger: silent });

  const emergency = arb.submit({ kind: 'emergency', uuids: ['admin'] });
  assert.equal(arb.currentKind(), 'emergency');

  // Foreground arrives — must abort the emergency scan and start its own.
  const foreground = arb.submit({ kind: 'foreground', uuids: ['dance'] });

  // The aborted emergency scan resolves reader-busy/aborted to its caller.
  const emResult = await emergency;
  assert.equal(emResult.matched, false);
  assert.equal(calls[0].aborted, true);

  // The foreground scan is now the in-flight one.
  assert.equal(arb.currentKind(), 'foreground');
  assert.equal(calls[1].uuids[0], 'dance');
  calls[1].finish({ matched: true, uuid: 'dance' });
  assert.deepEqual(await foreground, { matched: true, uuid: 'dance' });
});

test('emergency does NOT preempt a foreground scan (reader-busy)', async () => {
  const { runScan, calls } = deferredScan();
  const arb = createReaderArbiter({ runScan, logger: silent });

  const foreground = arb.submit({ kind: 'foreground', uuids: ['dance'] });
  const emergency = await arb.submit({ kind: 'emergency', uuids: ['admin'] });

  assert.deepEqual(emergency, { matched: false, reason: 'reader-busy' });
  assert.equal(calls.length, 1, 'emergency must not start a second scan');
  calls[0].finish({ matched: false, reason: 'no-match' });
  await foreground;
});

test('a second foreground while one is in flight is refused', async () => {
  const { runScan, calls } = deferredScan();
  const arb = createReaderArbiter({ runScan, logger: silent });
  const first = arb.submit({ kind: 'foreground', uuids: ['a'] });
  const second = await arb.submit({ kind: 'foreground', uuids: ['b'] });
  assert.deepEqual(second, { matched: false, reason: 'reader-busy' });
  assert.equal(calls.length, 1);
  calls[0].finish({ matched: false, reason: 'no-match' });
  await first;
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd _extensions/fitness && node --test test/readerArbiter.test.mjs`
Expected: FAIL — `Cannot find module '../src/readerArbiter.mjs'`.

- [ ] **Step 3: Implement the arbiter**

Create `_extensions/fitness/src/readerArbiter.mjs`:

```js
/**
 * Single-owner arbiter for the one physical fingerprint reader.
 *
 * The U.are.U reader is claimed exclusively by libfprint, so the garage box can
 * run only ONE identify scan at a time. Two callers compete for it: the
 * always-armed EMERGENCY scan (re-armed continuously by the backend) and
 * on-demand FOREGROUND unlocks (dance_party etc.). Without arbitration the box
 * spawned a rival helper per request; the loser failed instantly (reader busy)
 * so foreground unlocks died before the user could press.
 *
 * Policy: at most one scan runs. A FOREGROUND request PREEMPTS an in-flight
 * EMERGENCY scan (abort it, wait for the reader to release, then run). Anything
 * else that arrives while a scan is in flight gets { matched:false,
 * reason:'reader-busy' } — the backend re-arms emergency on its own loop.
 *
 * @param {object} deps
 * @param {(uuids: string[], opts: { signal: AbortSignal }) => Promise<{matched:boolean, uuid?:string, reason?:string}>} deps.runScan
 *   Runs ONE identify against the uuids. MUST resolve when `signal` aborts.
 * @param {{ log?: Function }} [deps.logger]
 */
export function createReaderArbiter({ runScan, logger = console }) {
  // The in-flight scan, or null when the reader is idle.
  // { kind:'emergency'|'foreground', controller:AbortController, done:Promise }
  let current = null;

  async function submit({ kind, uuids }) {
    if (current) {
      const preemptable = kind === 'foreground' && current.kind === 'emergency';
      if (!preemptable) {
        logger.log?.(`🔐 reader busy (have ${current.kind}, refused ${kind})`);
        return { matched: false, reason: 'reader-busy' };
      }
      // Preempt the in-flight emergency scan and wait for it to fully release the
      // reader before claiming it — reopening while still claimed fails.
      const inflight = current;
      logger.log?.(`🔐 ${kind} preempts in-flight ${inflight.kind} scan`);
      inflight.controller.abort();
      await inflight.done;
    }

    const controller = new AbortController();
    const scan = Promise.resolve().then(() => runScan(uuids, { signal: controller.signal }));
    // `done` settles when the scan finishes (success/abort/error) so a later
    // preempt can await release; swallow rejection so it never escapes unhandled.
    const done = scan.then(() => {}, () => {});
    current = { kind, controller, done };
    try {
      return await scan;
    } finally {
      current = null;
    }
  }

  return {
    submit,
    /** @returns {string|null} kind of the in-flight scan, or null when idle. */
    currentKind() { return current?.kind ?? null; },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd _extensions/fitness && node --test test/readerArbiter.test.mjs`
Expected: PASS — 4/4 tests.

- [ ] **Step 5: Run the whole extension suite to confirm no regressions**

Run: `cd _extensions/fitness && npm test`
Expected: PASS — existing `unlockSim`, `cadenceGate`, `profileStore` suites plus the new `readerArbiter` suite.

- [ ] **Step 6: Commit**

```bash
git add _extensions/fitness/src/readerArbiter.mjs _extensions/fitness/test/readerArbiter.test.mjs
git commit -m "feat(fitness-garage): single-owner reader arbiter (foreground preempts emergency)"
```

---

### Task 2: Graceful SIGTERM cancellation in the libfprint helper

**Files:**
- Modify: `_extensions/fitness/src/fingerprint_helper.py` (`cmd_identify`, lines 101–128)

**Why:** Preemption works by killing the in-flight helper. A raw kill mid-`identify_sync` skips the `finally: dev.close_sync()`, leaving the reader claimed so the next scan fails to open. The helper must catch the signal, cancel the libfprint `Cancellable` (which lets `identify_sync` return), and run its `finally`. `GLib.unix_signal_add` integrates the signal into the GLib main loop that `identify_sync` iterates, which is what actually interrupts the blocking call (a bare `signal.signal` handler may not run until the C call returns).

> **No Python test harness exists** for this helper (it needs the physical reader). This task is verified manually on garage in Task 5. Keep the change minimal and self-contained.

- [ ] **Step 1: Add the `signal` import**

At the top of `_extensions/fitness/src/fingerprint_helper.py`, alongside the existing `import os` / `import json` / `import argparse` imports, add:

```python
import signal
```

- [ ] **Step 2: Rewrite `cmd_identify` to install signal-driven cancellation**

Replace the body of `cmd_identify` (currently lines 101–128) with:

```python
def cmd_identify(args):
    uuids = [u.strip() for u in (args.uuids or '').split(',') if u.strip()]
    gallery = []
    for u in uuids:
        path = os.path.join(args.store, u + '.tpl')
        if not os.path.exists(path):
            continue
        with open(path, 'rb') as fh:
            gallery.append(FPrint.Print.deserialize(fh.read()))
    if not gallery:
        print(json.dumps({'matched': False, 'reason': 'no-templates'}))
        return

    ctx, dev = open_device()  # noqa: F841 — keep ctx referenced (GC guard)

    # One Cancellable drives BOTH the optional capture timeout AND preemption.
    # A foreground unlock preempts an in-flight emergency scan by SIGTERM-killing
    # this process; we integrate the signal into GLib's main loop (the loop
    # identify_sync iterates) so the cancel interrupts the blocking scan and the
    # `finally` below closes the device cleanly. Without this, a kill leaves the
    # reader claimed and the next open fails.
    cancellable = Gio_new_cancellable()
    if args.timeout and args.timeout > 0:
        GLib.timeout_add_seconds(int(args.timeout), lambda: (cancellable.cancel(), False)[1])
    for sig in (signal.SIGTERM, signal.SIGINT):
        GLib.unix_signal_add(GLib.PRIORITY_HIGH, sig,
                             lambda *_: (cancellable.cancel(), False)[1])

    log('Place a finger on the reader …')
    try:
        matched, _scanned = dev.identify_sync(gallery, cancellable, None, None)
    finally:
        dev.close_sync()

    if matched is None:
        print(json.dumps({'matched': False, 'reason': 'no-match'}))
        return
    # The uuid was stored as the print username at enroll time.
    print(json.dumps({'matched': True, 'uuid': matched.get_username()}))
```

- [ ] **Step 3: Replace the timeout-only Cancellable helper with a plain factory**

Replace `Gio_cancellable_with_timeout` (currently lines 131–137) with a factory that just loads Gio and returns a fresh `Cancellable` (the timeout is now wired in `cmd_identify`):

```python
def Gio_new_cancellable():
    # Lazy import so paths that don't scan (enroll/list) need no Gio.
    gi.require_version('Gio', '2.0')
    from gi.repository import Gio
    return Gio.Cancellable()
```

- [ ] **Step 4: Syntax-check the helper**

Run: `python3 -m py_compile _extensions/fitness/src/fingerprint_helper.py && echo OK`
Expected: `OK` (no syntax errors). Hardware behaviour is verified on garage in Task 5.

- [ ] **Step 5: Commit**

```bash
git add _extensions/fitness/src/fingerprint_helper.py
git commit -m "feat(fitness-garage): cancel identify_sync cleanly on SIGTERM (preempt-safe)"
```

---

### Task 3: Abort support in `runFingerprintHelper` + route unlock through the arbiter

**Files:**
- Modify: `_extensions/fitness/src/server.mjs` (`runFingerprintHelper` 34–67; unlock handler real path 200–229)

- [ ] **Step 1: Add `signal` support to `runFingerprintHelper`**

In `_extensions/fitness/src/server.mjs`, change the `runFingerprintHelper` signature and add abort wiring. Replace the opening of the function (line 34) and the `child.on('close', ...)` handler so it looks like:

```js
function runFingerprintHelper(args, { timeoutMs = 30000, onStderr, signal } = {}) {
  return new Promise((resolve, reject) => {
    const fullArgs = [FINGERPRINT_HELPER, '--store', FINGERPRINT_STORE, ...args];
    const child = spawn('python3', fullArgs);
    let stdout = '';
    let stderr = '';
    let stderrLineBuf = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);

    // Preemption: aborting kills the helper with SIGTERM. The helper catches it,
    // cancels the libfprint scan, closes the reader cleanly, and exits non-zero
    // (no JSON) → this promise rejects; the caller maps an aborted signal to a
    // clean 'preempted' result.
    const onAbort = () => child.kill('SIGTERM');
    if (signal) {
      if (signal.aborted) child.kill('SIGTERM');
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => {
      const text = d.toString();
      stderr += text;
      if (onStderr) {
        stderrLineBuf += text;
        const lines = stderrLineBuf.split('\n');
        stderrLineBuf = lines.pop();
        for (const line of lines) if (line.trim()) onStderr(line.trim());
      }
    });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      const out = stdout.trim();
      let parsed = null;
      if (out) {
        const lastLine = out.split('\n').filter(Boolean).pop();
        try { parsed = JSON.parse(lastLine); } catch { /* not JSON */ }
      }
      if (parsed) return resolve(parsed);
      reject(new Error(`helper exited ${code}${stderr ? `: ${stderr.trim().split('\n').pop()}` : ''}`));
    });
  });
}
```

- [ ] **Step 2: Add a `runIdentifyScan` adapter and construct the arbiter**

Near the top of `server.mjs`, after the `import { selectSimCandidate } from './unlockSim.mjs';` line, add the import:

```js
import { createReaderArbiter } from './readerArbiter.mjs';
```

Then, just after `runFingerprintHelper` is defined (after line 67), add the scan adapter and the singleton arbiter:

```js
// Adapt the python identify helper to the arbiter's runScan contract. Resolves
// to a uniform { matched, uuid?, reason? }; a preempt (aborted signal) maps to a
// clean 'preempted' rather than a hard error.
function runIdentifyScan(uuids, { signal }) {
  return runFingerprintHelper(
    ['identify', '--uuids', uuids.join(','), '--timeout', '15'],
    { timeoutMs: 20000, signal },
  )
    .then((result) =>
      result?.matched && result.uuid
        ? { matched: true, uuid: result.uuid }
        : { matched: false, reason: result?.reason || 'no-match' })
    .catch((err) => (signal?.aborted
      ? { matched: false, reason: 'preempted' }
      : { matched: false, reason: 'identify-error', error: err.message }));
}

// The single owner of the physical reader. ALL real identify scans go through it.
const readerArbiter = createReaderArbiter({ runScan: runIdentifyScan, logger: console });
```

- [ ] **Step 3: Route the unlock handler's real path through the arbiter**

In the `fitness.unlock.request` handler, replace the real-path block (currently lines 211–229, starting at `console.log(\`🔐 Identifying finger against ...\`)` through the `.catch(...)` and its trailing `return;`) with:

```js
        const kind = lockName === 'emergency' ? 'emergency' : 'foreground';
        console.log(`🔐 Submitting ${kind} identify against ${uuids.length} template(s) for requestId=${requestId} …`);
        readerArbiter.submit({ kind, uuids })
          .then((result) => {
            if (result.matched && result.uuid) {
              const chosen = candidateUuids.find((c) => c?.uuid === result.uuid);
              const userId = chosen?.username;
              sendUnlockResult({ requestId, matched: true, userId, uuid: result.uuid });
              console.log(`🔐 Unlock result sent (hardware match, user=${userId}, uuid=${result.uuid}) for requestId=${requestId}`);
            } else {
              const reason = result.reason || 'no-match';
              sendUnlockResult({ requestId, matched: false, reason });
              console.log(`🔐 Unlock result sent (hardware, matched=false, reason=${reason}) for requestId=${requestId}`);
            }
          })
          .catch((err) => {
            sendUnlockResult({ requestId, matched: false, reason: 'identify-error' });
            console.error(`❌ Unlock identify failed for requestId=${requestId}: ${err.message}`);
          });
        return;
```

(The `uuids` array and the `no-candidates` early return immediately above this block are unchanged.)

- [ ] **Step 4: Smoke-check the server module loads**

Run: `cd _extensions/fitness && node --check src/server.mjs && echo OK`
Expected: `OK` (parses; `node --check` does not execute).

- [ ] **Step 5: Re-run the extension suite**

Run: `cd _extensions/fitness && npm test`
Expected: PASS — all suites green (server is not started by the tests).

- [ ] **Step 6: Commit**

```bash
git add _extensions/fitness/src/server.mjs
git commit -m "feat(fitness-garage): route unlock identify through the reader arbiter"
```

---

### Task 4: Bracket the backend `/unlock` scan with begin/endForeground

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs` (handler 1331–1384, scan at 1365)
- Test: `backend/src/4_api/v1/routers/fitness.unlock.test.mjs`

**Why:** When a user taps dance_party, `/unlock` calls `requestUnlock(lock, candidates)` but does NOT mark a foreground unlock active. So the emergency detector keeps re-arming and holding the reader. Bracketing makes the detector stand down for the unlock's duration — the backend half of "one owner at a time" (the garage half is preemption from Tasks 1–3). Mirrors the existing `scanEmergency` bracket at lines 1408–1414.

- [ ] **Step 1: Write the failing test**

Add to `backend/src/4_api/v1/routers/fitness.unlock.test.mjs`, inside the `describe('fitness router — POST /unlock', ...)` block:

```js
  it('brackets the scan with beginForeground/endForeground so the detector yields', async () => {
    const order = [];
    const beginForeground = vi.fn(() => order.push('begin'));
    const endForeground = vi.fn(() => order.push('end'));
    const requestUnlock = vi.fn(() => { order.push('scan'); return Promise.resolve({ matched: true, userId: 'test-user' }); });
    const { app } = appWith({
      fitnessConfig: { locks: { dance_party: ['test-user'] } },
      profiles: { 'test-user': { identities: { fingerprints: [{ id: 'uuid-1' }] } } },
      unlockService: { requestUnlock, beginForeground, endForeground },
    });

    const res = await request(app).post('/unlock').send({ lock: 'dance_party' });

    expect(res.status).toBe(200);
    expect(beginForeground).toHaveBeenCalledTimes(1);
    expect(endForeground).toHaveBeenCalledTimes(1);
    // begin BEFORE the scan, end AFTER it.
    expect(order).toEqual(['begin', 'scan', 'end']);
  });

  it('still calls endForeground when the scan throws', async () => {
    const beginForeground = vi.fn();
    const endForeground = vi.fn();
    const requestUnlock = vi.fn().mockRejectedValue(new Error('bus-down'));
    const { app } = appWith({
      fitnessConfig: { locks: { dance_party: ['test-user'] } },
      profiles: { 'test-user': { identities: { fingerprints: [{ id: 'uuid-1' }] } } },
      unlockService: { requestUnlock, beginForeground, endForeground },
    });

    const res = await request(app).post('/unlock').send({ lock: 'dance_party' });

    expect(res.status).toBe(500);
    expect(beginForeground).toHaveBeenCalledTimes(1);
    expect(endForeground).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/fitness.unlock.test.mjs`
Expected: FAIL — `beginForeground`/`endForeground` not called (`order` is `['scan']`).

- [ ] **Step 3: Add the bracket to the handler**

In `backend/src/4_api/v1/routers/fitness.mjs`, replace the scan block (lines 1362–1372) — currently:

```js
    logger.info?.('fitness.unlock.request', { lock, candidates: candidates.length });
    let result;
    try {
      result = await unlockService.requestUnlock(lock, candidates);
    } catch (err) {
      // Parity with neighboring handlers: tag the domain error so an unlock
      // round-trip failure (bus down, garage offline) is debuggable, and fail
      // closed with a generic 500 rather than leaking internals.
      logger.error?.('fitness.unlock.error', { lock, error: err?.message });
      return res.status(500).json({ error: 'unlock-failed' });
    }
```

with (bracketing the scan so the emergency detector yields the reader for its duration — the garage box preempts the in-flight emergency scan; this stops the NEXT re-arm from racing):

```js
    logger.info?.('fitness.unlock.request', { lock, candidates: candidates.length });
    let result;
    unlockService.beginForeground?.();
    try {
      result = await unlockService.requestUnlock(lock, candidates);
    } catch (err) {
      // Parity with neighboring handlers: tag the domain error so an unlock
      // round-trip failure (bus down, garage offline) is debuggable, and fail
      // closed with a generic 500 rather than leaking internals.
      logger.error?.('fitness.unlock.error', { lock, error: err?.message });
      return res.status(500).json({ error: 'unlock-failed' });
    } finally {
      unlockService.endForeground?.();
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/fitness.unlock.test.mjs`
Expected: PASS — all `/unlock` tests including the two new bracket tests.

- [ ] **Step 5: Run the related backend suites for no regressions**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/fitness.unlock.test.mjs backend/src/4_api/v1/routers/fitness.emergency.test.mjs && node --test backend/src/3_applications/fitness/emergencyDetector.test.mjs backend/src/3_applications/fitness/unlockService.test.mjs backend/src/3_applications/fitness/unlockBroker.test.mjs`
Expected: PASS — router suites (vitest) and the application suites (node:test) all green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/fitness.mjs backend/src/4_api/v1/routers/fitness.unlock.test.mjs
git commit -m "fix(fitness): bracket /unlock with beginForeground/endForeground so the emergency detector yields"
```

---

### Task 5: Build, deploy both containers, and verify end-to-end

**Files:** none (deploy + live verification). Two images change: `daylight-station` (Task 4) and `daylight-fitness` (Tasks 1–3).

> Per CLAUDE.local.md, deploying on kckern-server is allowed once commits land. The user is often mid-session — confirm timing before redeploying, since this disconnects the WS and reloads the garage screen.

- [ ] **Step 1: Build & deploy the backend (`daylight-station`)**

Run (from repo root):

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

Expected: image builds; container reports `Up`. Verify: `curl -s -o /dev/null -w '%{http_code}' http://localhost:3111/` → `200`, and `sudo docker exec daylight-station sh -c 'cat /build.txt'` shows the current commit.

- [ ] **Step 2: Build, transfer, and deploy the garage box (`daylight-fitness`)**

Run:

```bash
sudo docker build -f _extensions/fitness/Dockerfile -t kckern/daylight-station-fitness:latest _extensions/fitness/
sudo docker save kckern/daylight-station-fitness:latest | ssh root@garage 'docker load'
ssh root@garage 'cd /path/to/fitness && docker compose up -d'   # confirm the compose dir on garage first
```

Expected: image loads on garage; `ssh garage 'docker ps | grep daylight-fitness'` shows it `Up`; `ssh garage 'docker logs --tail 20 daylight-fitness'` shows `🔐 Subscribed to unlock / enroll / delete request topics`.

- [ ] **Step 3: Verify preemption frees the reader (the core fix)**

With both deployed, tail both sides while you open dance_party and press your finger:

```bash
# Terminal A — backend
sudo docker logs -f --since 1s daylight-station 2>&1 | grep -iE "unlock|emergency"
# Terminal B — garage
ssh garage 'docker logs -f --since 1s daylight-fitness 2>&1 | grep -iE "unlock|preempt|identif|busy"'
```

Open dance_party on the garage screen and press your finger.

Expected garage log sequence:
- an in-flight `emergency` identify is running,
- `🔐 foreground preempts in-flight emergency scan`,
- a `foreground` identify starts and **waits** for your finger (does NOT instant-return),
- on press: `Unlock result sent (hardware match, user=kckern …)` for the dance_party requestId.

Expected backend: `fitness.unlock.result {lock: dance_party, matched: true}` — NOT an instant `matched:false`.

- [ ] **Step 4: Verify the reader is not left claimed after a preempt**

Confirm the device recovers after a preempt (the SIGTERM-cancel path from Task 2): immediately after the dance_party unlock in Step 3, let the emergency detector re-arm and press again for emergency. On garage:

```bash
ssh garage 'docker logs --since 60s daylight-fitness 2>&1 | grep -iE "identif|match|error|open|device"'
```

Expected: the post-preempt emergency `identify` opens the reader successfully and matches (NO `helper exited` / device-open errors). If you see repeated open/device errors after a preempt, the SIGTERM-cancel didn't release the reader — see Fallback below.

- [ ] **Step 5: Verify normal (non-preempt) unlock still works**

Open dance_party when NO emergency scan happens to be mid-flight (or simply confirm across a few tries). Expected: the modal waits for your finger and matches. No regression in the common path.

**Fallback (only if Step 4 shows the reader stuck after preempt):** if `GLib.unix_signal_add` does not interrupt `identify_sync` on this hardware, do NOT kill mid-scan. Instead shorten the emergency scan so the reader frees on its own: change the emergency arm to short windows by passing a small per-arm timeout — set `emergency.arming.arm_timeout_ms` low AND lower the garage emergency `--timeout` to match (e.g. 4s), so contention windows are ≤4s and a foreground unlock waits at most one short window. This trades instant preemption for bounded waiting and needs no signal handling. Capture this decision in a follow-up note under `docs/_wip/bugs/`.

---

## Self-Review

**1. Spec coverage** (against my last design message: "one owner of the reader instead of two fighting over it; foreground requests join/preempt the existing scan instead of spawning a rival"):
- Single owner → Task 1 arbiter + Task 3 routing all scans through it. ✓
- Foreground preempts emergency → Task 1 policy + Task 2 clean cancel + Task 3 abort wiring. ✓
- Backend stops re-arming during a foreground unlock → Task 4 bracket. ✓
- Reader not left claimed after preempt → Task 2 + verified Task 5 Step 4. ✓
- Deploy both affected containers → Task 5. ✓
- Ceremony-not-firing explicitly scoped OUT (separate subsystem). ✓

**2. Placeholder scan:** No TBD/TODO. One intentional `/path/to/fitness` in Task 5 Step 2 is flagged inline ("confirm the compose dir on garage first") — it is environment-specific per CLAUDE.local.md, not a content gap. The Fallback is a real, fully-specified contingency, not a placeholder.

**3. Type/name consistency:**
- `createReaderArbiter({ runScan, logger })` → `submit({ kind, uuids })` → `{ matched, uuid?, reason? }`; `currentKind()`. Used identically in tests (Task 1), in `runIdentifyScan`/`readerArbiter.submit` (Task 3). ✓
- `runScan(uuids, { signal })` contract matches `runIdentifyScan(uuids, { signal })` and the fake in tests. ✓
- `runFingerprintHelper(args, { timeoutMs, onStderr, signal })` — `signal` added (Task 3 Step 1), consumed by `runIdentifyScan` (Task 3 Step 2). ✓
- `beginForeground`/`endForeground` — names match `unlockService.mjs:116/118` and the existing `scanEmergency` usage. ✓
- `Gio_new_cancellable()` defined (Task 2 Step 3) and called in `cmd_identify` (Task 2 Step 2); old `Gio_cancellable_with_timeout` fully removed. ✓

No gaps found.
