# Identity Event Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two competing fingerprint-reader consumers (per-request `/unlock` scan + always-armed backend emergency detector) with a single continuous garage broadcaster, a backend relay/enricher, and a frontend IdentityManager that routes scans by UI context — eliminating reader contention by construction.

**Architecture:** Three layers. (1) Garage owns the reader with one continuous full-store `identify` loop and broadcasts dumb `biometric.scan` events; enroll and manage-auth preempt it through a generalized `readerArbiter`. (2) Backend relays `biometric.scan` → enriches `uuid → {userId, finger, authz}` → broadcasts `fitness.identity.detected`, and stamps a short-lived pending-detection consumed by `/emergency/{commit,abort,release}`. (3) Frontend `IdentityProvider` subscribes to `fitness.identity.detected` and routes by context: modal open → unlock that lock; no modal + emergency-authorized → run shutdown ceremony; triggering → abort; locked → release.

**Tech Stack:** Node ESM backend (`vitest`), Python `fingerprint_helper.py` + Node garage server (`node --test`), React frontend (jest + React Testing Library), WebSocket event bus.

---

## Deviations from the spec (discovered during planning — already recorded in the spec)

1. **`fitness.unlock.request` survives narrowly for manage-auth.** The FingerprintManager enroll/delete admin gate (`gateManageAccess` → `manage:<username>`) still needs a request/response identify. It is NOT removed; it is rerouted through the generalized `readerArbiter` as a preempting `manage` kind. Only the *contextual* unlock uses (`dance_party`, `governance_bypass`, `skip_content`) and the emergency detector are removed.
2. **`useUnlock` has three real consumers** — `FitnessShow`, `FitnessModuleMenu`, `FitnessPlayer` — all migrate to the new `IdentityProvider`. (`useFingerprintManager` only mentions `useUnlock` in a comment; it is not a consumer.)

## File Structure

**Garage (`_extensions/fitness/`):**
- `src/fingerprint_helper.py` — make `identify --uuids` optional (full-store glob); distinguish `cancelled` from `no-match`.
- `src/readerArbiter.mjs` — generalize from `submit({kind,uuids})` to `run({kind, exec, preempts})`.
- `src/server.mjs` — continuous scan loop broadcasting `biometric.scan`; route enroll + manage-auth through arbiter; reduce `fitness.unlock.request` to manage-only.
- `test/readerArbiter.test.mjs` — rewrite for the generalized arbiter.
- `test/continuousScan.test.mjs` — new: loop emit/settle/backoff behavior.

**Backend (`backend/src/`):**
- `3_applications/fitness/identityRelay.mjs` — NEW relay/enricher + pending guard + `EMERGENCY_LOCK`.
- `3_applications/fitness/identityRelay.test.mjs` — NEW.
- `3_applications/fitness/unlockService.mjs` — remove foreground bracketing; keep manage-auth `requestUnlock`.
- `4_api/v1/routers/fitness.mjs` — delete `/unlock` route + `scanEmergency`; `/emergency/{commit,abort,release}` consume pending from relay; keep `gateManageAccess`.
- `app.mjs` — replace `createEmergencyDetector` wiring with `createIdentityRelay`.
- `0_system/bootstrap.mjs` — pass `identityRelay` instead of `emergencyDetector`.
- DELETE: `emergencyDetector.mjs`(+test), `unlockPolicy.mjs`(+test), `emergencyPolicy.mjs`(+test), `fitness.unlock.test.mjs`.

**Frontend (`frontend/src/modules/Fitness/`):**
- `identity/IdentityProvider.jsx` — NEW context router + `useIdentity`.
- `identity/IdentityProvider.test.jsx` — NEW routing matrix.
- `hooks/useEmergencyLockdown.js` — drop `fitness.emergency.detected` subscription; add `triggerCeremony()`.
- `player/overlays/EmergencyLockdownOverlay.jsx` — consume emergency state from `useIdentity()`.
- `player/FitnessShow.jsx`, `nav/FitnessModuleMenu.jsx`, `player/FitnessPlayer.jsx` — swap `useUnlock` → `useIdentity`.
- `Apps/FitnessApp.jsx` — mount `<IdentityProvider>`.
- DELETE: `hooks/useUnlock.js`(+test) and the two `*.unlock.test.jsx` component tests once migrated.

---

# Group A — Garage (dumb continuous broadcaster)

### Task A1: `fingerprint_helper.py` — optional `--uuids` (full-store) + cancelled-vs-no-match

**Files:**
- Modify: `_extensions/fitness/src/fingerprint_helper.py` (`cmd_identify`, argparse for `identify`)
- Test: manual (`node --test` covers the Node side; Python is exercised live). No Python test harness exists — verify by invocation.

- [ ] **Step 1: Make `--uuids` optional and glob the full store when omitted**

In `cmd_identify(args)`, replace the gallery-loading preamble so that when `--uuids` is absent or empty it loads every `<store>/*.tpl`:

```python
def cmd_identify(args):
    store = args.store
    if args.uuids:
        uuids = [u for u in args.uuids.split(',') if u]
    else:
        uuids = [os.path.splitext(os.path.basename(p))[0]
                 for p in glob.glob(os.path.join(store, '*.tpl'))]
    if not uuids:
        print(json.dumps({'matched': False, 'reason': 'no-templates'}))
        return 0
```

Ensure `import glob` and `import os` are present at the top of the file (add `import glob` if missing).

- [ ] **Step 2: Distinguish cancellation from no-match**

Wrap the `dev.identify_sync(...)` call so a GLib cancellation (SIGTERM/SIGINT from the arbiter) reports `cancelled`, not `no-match`:

```python
    try:
        matched, _img = dev.identify_sync(gallery, cancellable, None, None)
    except GLib.Error as e:
        if cancellable.is_cancelled():
            print(json.dumps({'matched': False, 'reason': 'cancelled'}))
            return 0
        print(json.dumps({'matched': False, 'reason': 'identify-error', 'error': str(e)}))
        return 0
    if matched is None:
        print(json.dumps({'matched': False, 'reason': 'no-match'}))
        return 0
    print(json.dumps({'matched': True, 'uuid': matched.get_username()}))
    return 0
```

(Keep the existing `dev.identify_sync` signature/variable names already used in the file; only the surrounding try/except and the no-match/cancelled branching are new. If the file already destructures the return differently, preserve that — only add the `try/except GLib.Error` and the `cancelled` branch.)

- [ ] **Step 3: Make the argparse `--uuids` optional**

For the `identify` subparser, change `p_id.add_argument('--uuids', required=True)` to:

```python
    p_id.add_argument('--uuids', required=False, default=None)
```

- [ ] **Step 4: Verify the helper runs with no `--uuids` against an empty store**

Run (garage, or any box with the helper but no templates):
```bash
python3 _extensions/fitness/src/fingerprint_helper.py --store /tmp/empty-store identify --timeout 1
```
Expected: prints `{"matched": false, "reason": "no-templates"}` and exits 0 (no traceback, no `required: --uuids` argparse error).

- [ ] **Step 5: Commit**

```bash
git add _extensions/fitness/src/fingerprint_helper.py
git commit -m "feat(fitness-helper): full-store identify + cancelled-vs-no-match reason"
```

---

### Task A2: Generalize `readerArbiter` to `run({kind, exec, preempts})`

**Files:**
- Modify: `_extensions/fitness/src/readerArbiter.mjs`
- Test: `_extensions/fitness/test/readerArbiter.test.mjs` (rewrite)

- [ ] **Step 1: Rewrite the failing test for the generalized arbiter**

Replace the contents of `_extensions/fitness/test/readerArbiter.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReaderArbiter } from '../src/readerArbiter.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('runs work when idle and returns {ok:true, value}', async () => {
  const arb = createReaderArbiter({ logger: { log() {} } });
  const r = await arb.run({ kind: 'scan', preempts: [], exec: async () => ({ matched: false }) });
  assert.deepEqual(r, { ok: true, value: { matched: false } });
  assert.equal(arb.currentKind(), null);
});

test('refuses a non-preempting kind while busy', async () => {
  const arb = createReaderArbiter({ logger: { log() {} } });
  const d = deferred();
  const running = arb.run({ kind: 'scan', preempts: [], exec: () => d.promise });
  // scan does not preempt scan
  const refused = await arb.run({ kind: 'scan', preempts: [], exec: async () => ({ matched: true }) });
  assert.deepEqual(refused, { ok: false, reason: 'reader-busy' });
  d.resolve({ matched: false });
  await running;
});

test('a preempting kind cancels the in-flight work via signal and then runs', async () => {
  const arb = createReaderArbiter({ logger: { log() {} } });
  let scanAborted = false;
  const scanStarted = deferred();
  const scanFinished = deferred();
  const running = arb.run({
    kind: 'scan', preempts: [],
    exec: ({ signal }) => {
      scanStarted.resolve();
      return new Promise((resolve) => {
        signal.addEventListener('abort', () => { scanAborted = true; resolve({ matched: false, reason: 'cancelled' }); });
      });
    },
  });
  await scanStarted.promise;
  const r = await arb.run({ kind: 'enroll', preempts: ['scan'], exec: async () => ({ enrolled: true }) });
  assert.equal(scanAborted, true);
  assert.deepEqual(r, { ok: true, value: { enrolled: true } });
  await running;
  assert.equal(arb.currentKind(), null);
});

test('currentKind reflects the in-flight kind', async () => {
  const arb = createReaderArbiter({ logger: { log() {} } });
  const d = deferred();
  const running = arb.run({ kind: 'manage', preempts: ['scan'], exec: () => d.promise });
  assert.equal(arb.currentKind(), 'manage');
  d.resolve({ matched: true });
  await running;
  assert.equal(arb.currentKind(), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd _extensions/fitness && node --test test/readerArbiter.test.mjs`
Expected: FAIL — `arb.run is not a function` (current arbiter exposes `submit`, not `run`).

- [ ] **Step 3: Rewrite `readerArbiter.mjs`**

Replace the contents of `_extensions/fitness/src/readerArbiter.mjs`:

```javascript
// Single-reader arbiter. One physical fingerprint reader, several would-be consumers.
// The continuous scan loop is the default owner (kind 'scan'); 'enroll' and 'manage'
// preempt it by aborting the in-flight work via an AbortSignal, then take the reader.
//
// run({ kind, exec, preempts }) -> { ok: true, value } | { ok: false, reason: 'reader-busy' }
//   exec({ signal }) does the actual reader work and resolves with its result.
//   preempts: list of in-flight kinds this kind is allowed to cancel.
export function createReaderArbiter({ logger = console } = {}) {
  let current = null; // { kind, controller, done }

  async function run({ kind, exec, preempts = [] }) {
    if (current) {
      if (!preempts.includes(current.kind)) {
        logger.log?.(`🔐 reader busy (have ${current.kind}, refused ${kind})`);
        return { ok: false, reason: 'reader-busy' };
      }
      const inflight = current;
      logger.log?.(`🔐 ${kind} preempts in-flight ${inflight.kind}`);
      inflight.controller.abort();
      await inflight.done; // wait for the cancelled work to unwind before re-acquiring
    }

    const controller = new AbortController();
    const work = Promise.resolve().then(() => exec({ signal: controller.signal }));
    const done = work.then(() => {}, () => {}); // settled marker, never throws
    current = { kind, controller, done };
    try {
      const value = await work;
      return { ok: true, value };
    } finally {
      current = null;
    }
  }

  return {
    run,
    currentKind() { return current ? current.kind : null; },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd _extensions/fitness && node --test test/readerArbiter.test.mjs`
Expected: PASS — 4/4 tests.

- [ ] **Step 5: Commit**

```bash
git add _extensions/fitness/src/readerArbiter.mjs _extensions/fitness/test/readerArbiter.test.mjs
git commit -m "refactor(fitness): generalize readerArbiter to run({kind,exec,preempts})"
```

---

### Task A3: Guard `runFingerprintHelper` timeout for blocking scans

**Files:**
- Modify: `_extensions/fitness/src/server.mjs` (`runFingerprintHelper`)

- [ ] **Step 1: Only arm the kill-timer when `timeoutMs > 0`**

In `runFingerprintHelper(args, { timeoutMs = 30000, onStderr, signal } = {})`, change the timer setup and both clear sites so a continuous (`timeoutMs: 0`) scan is never SIGTERM-killed by the wrapper:

```javascript
  const timer = timeoutMs > 0 ? setTimeout(() => child.kill('SIGTERM'), timeoutMs) : null;
```

And at every place the existing code calls `clearTimeout(timer)` (in the `error` and `close` handlers, and the abort handler if present), guard it:

```javascript
    if (timer) clearTimeout(timer);
```

Leave the `signal` abort handling (SIGTERM on abort) intact — that is how the arbiter cancels a blocking scan.

- [ ] **Step 2: Verify nothing else broke (syntax + existing tests)**

Run: `cd _extensions/fitness && node --check src/server.mjs && node --test test/readerArbiter.test.mjs`
Expected: no syntax error; arbiter tests still PASS.

- [ ] **Step 3: Commit**

```bash
git add _extensions/fitness/src/server.mjs
git commit -m "fix(fitness): don't arm kill-timer for blocking (timeoutMs:0) reader scans"
```

---

### Task A4: Continuous scan loop broadcasting `biometric.scan`

**Files:**
- Modify: `_extensions/fitness/src/server.mjs` (add `runContinuousIdentify`, `runContinuousScanLoop`; start it in `startServer`)
- Test: `_extensions/fitness/test/continuousScan.test.mjs` (new)

- [ ] **Step 1: Write the failing test**

Create `_extensions/fitness/test/continuousScan.test.mjs`. This tests the *loop policy* in isolation by injecting fakes (the loop function is exported for testing):

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContinuousScanLoop } from '../src/continuousScanLoop.mjs';

const tick = () => new Promise((r) => setImmediate(r));

test('broadcasts matched scans then settles', async () => {
  const sent = [];
  let calls = 0;
  const loop = createContinuousScanLoop({
    runScan: async () => {
      calls += 1;
      if (calls === 1) return { ok: true, value: { matched: true, uuid: 'uuid-1' } };
      return { ok: true, value: { matched: false, reason: 'no-match' } };
    },
    sendBus: (topic, payload) => sent.push({ topic, payload }),
    delay: async () => {},
    logger: { log() {}, error() {} },
    maxIterations: 2,
  });
  await loop.run();
  assert.deepEqual(sent[0], { topic: 'biometric.scan', payload: { modality: 'fingerprint', matched: true, uuid: 'uuid-1' } });
  assert.deepEqual(sent[1], { topic: 'biometric.scan', payload: { modality: 'fingerprint', matched: false } });
});

test('reader-busy and cancelled do not broadcast', async () => {
  const sent = [];
  const seq = [
    { ok: false, reason: 'reader-busy' },
    { ok: true, value: { matched: false, reason: 'cancelled' } },
  ];
  let i = 0;
  const loop = createContinuousScanLoop({
    runScan: async () => seq[i++],
    sendBus: (topic, payload) => sent.push({ topic, payload }),
    delay: async () => {},
    logger: { log() {}, error() {} },
    maxIterations: 2,
  });
  await loop.run();
  assert.equal(sent.length, 0);
});

test('no-templates backs off without broadcasting', async () => {
  const sent = [];
  const loop = createContinuousScanLoop({
    runScan: async () => ({ ok: true, value: { matched: false, reason: 'no-templates' } }),
    sendBus: (topic, payload) => sent.push({ topic, payload }),
    delay: async () => {},
    logger: { log() {}, error() {} },
    maxIterations: 1,
  });
  await loop.run();
  assert.equal(sent.length, 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd _extensions/fitness && node --test test/continuousScan.test.mjs`
Expected: FAIL — cannot find module `../src/continuousScanLoop.mjs`.

- [ ] **Step 3: Implement the loop policy module**

Create `_extensions/fitness/src/continuousScanLoop.mjs`:

```javascript
// Pure loop policy for the continuous biometric scanner. Side-effect functions
// (runScan / sendBus / delay) are injected so the policy is testable without a reader.
const SCAN_SETTLE_MS = 1500;        // after a real touch, pause so one press isn't re-emitted
const SCAN_REARM_BACKOFF_MS = 800;  // after busy/cancelled/error, quiet re-arm
const NO_TEMPLATES_BACKOFF_MS = 5000; // nothing enrolled yet — check back occasionally

export function createContinuousScanLoop({
  runScan,
  sendBus,
  delay,
  logger = console,
  maxIterations = Infinity,
}) {
  let active = false;

  async function run() {
    active = true;
    let n = 0;
    while (active && n < maxIterations) {
      n += 1;
      let r;
      try {
        r = await runScan();
      } catch (err) {
        logger.error?.(`❌ continuous scan error: ${err.message}`);
        await delay(SCAN_REARM_BACKOFF_MS);
        continue;
      }
      if (!r || !r.ok) { await delay(SCAN_REARM_BACKOFF_MS); continue; } // reader-busy: enroll/manage owns it
      const result = r.value || {};
      if (result.matched && result.uuid) {
        sendBus('biometric.scan', { modality: 'fingerprint', matched: true, uuid: result.uuid });
        logger.log?.(`🔐 biometric.scan → matched (uuid=${result.uuid})`);
        await delay(SCAN_SETTLE_MS);
      } else if (result.reason === 'no-match') {
        sendBus('biometric.scan', { modality: 'fingerprint', matched: false });
        logger.log?.('🔐 biometric.scan → sensed, unrecognized');
        await delay(SCAN_SETTLE_MS);
      } else if (result.reason === 'no-templates') {
        await delay(NO_TEMPLATES_BACKOFF_MS);
      } else {
        // 'cancelled' (preempted by enroll/manage) or 'identify-error' → quiet re-arm
        await delay(SCAN_REARM_BACKOFF_MS);
      }
    }
  }

  function stop() { active = false; }

  return { run, stop };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd _extensions/fitness && node --test test/continuousScan.test.mjs`
Expected: PASS — 3/3.

- [ ] **Step 5: Wire the loop into `server.mjs`**

In `_extensions/fitness/src/server.mjs`:

(a) Add imports near the other `src/` imports:
```javascript
import { createContinuousScanLoop } from './continuousScanLoop.mjs';
```

(b) Add `runContinuousIdentify` near `runIdentifyScan`:
```javascript
// Blocking full-store identify for the continuous loop. No --uuids (full store),
// no helper timeout (--timeout 0); the arbiter cancels it via signal when preempted.
function runContinuousIdentify({ signal }) {
  return runFingerprintHelper(['identify', '--timeout', '0'], { timeoutMs: 0, signal })
    .then((r) => (r && r.matched && r.uuid)
      ? { matched: true, uuid: r.uuid }
      : { matched: false, reason: (r && r.reason) || 'no-match' })
    .catch((err) => (signal && signal.aborted)
      ? { matched: false, reason: 'cancelled' }
      : { matched: false, reason: 'identify-error', error: err.message });
}
```

(c) Construct the loop after `readerArbiter` is created:
```javascript
const continuousScan = createContinuousScanLoop({
  runScan: () => readerArbiter.run({ kind: 'scan', preempts: [], exec: runContinuousIdentify }),
  sendBus,
  delay: (ms) => new Promise((r) => setTimeout(r, ms)),
  logger: console,
});
```

(d) In `startServer()`, after `connectWebSocket()` has been invoked, start the loop unless simulation is active:
```javascript
  if (process.env.FINGERPRINT_SIM) {
    console.log('🔐 Continuous scan loop disabled (FINGERPRINT_SIM active)');
  } else {
    continuousScan.run().catch((err) => console.error(`❌ continuous scan loop exited: ${err.message}`));
    console.log('🔐 Continuous biometric scan loop started (full-store identify)');
  }
```

(e) In the existing `SIGTERM`/`SIGINT` shutdown handler(s), call `continuousScan.stop()` before exiting.

- [ ] **Step 6: Verify syntax + tests**

Run: `cd _extensions/fitness && node --check src/server.mjs && node --test test/`
Expected: no syntax error; all garage tests PASS.

- [ ] **Step 7: Commit**

```bash
git add _extensions/fitness/src/continuousScanLoop.mjs _extensions/fitness/src/server.mjs _extensions/fitness/test/continuousScan.test.mjs
git commit -m "feat(fitness): continuous full-store scan loop broadcasting biometric.scan"
```

---

### Task A5: Reduce `fitness.unlock.request` to manage-auth; route enroll + manage through arbiter

**Files:**
- Modify: `_extensions/fitness/src/server.mjs` (`fitness.unlock.request` handler, `fitness.enroll.request` handler)

- [ ] **Step 1: Route enroll through the arbiter (preempts scan)**

In the `fitness.enroll.request` handler, wrap the existing `runFingerprintHelper(['enroll', …])` call so it goes through the arbiter. Replace the direct helper call with:

```javascript
    const arb = await readerArbiter.run({
      kind: 'enroll',
      preempts: ['scan'],
      exec: ({ signal }) => runFingerprintHelper(
        ['enroll', '--uuid', uuid, '--finger', finger],
        { timeoutMs: 120000, signal, onStderr: handleEnrollStderr },
      ),
    });
    if (!arb.ok) {
      sendBus('fitness.enroll.result', { requestId, success: false, error: 'reader-busy' });
      return;
    }
    const result = arb.value;
```

(Keep the existing `onStderr` progress-streaming logic — bind it to the name `handleEnrollStderr` or inline the existing function; keep the existing `fitness.enroll.progress` emits and the existing success/failure handling that follows, operating on `result`.)

- [ ] **Step 2: Reduce the `fitness.unlock.request` handler to manage-auth only**

The unlock request is now used by exactly one caller: the backend manage-auth gate, which sends a lock like `manage:<username>`. Simulation modes (`auto-match`/`auto-deny`/`interactive`) remain for dev. Replace the real-path branch so it always routes through the arbiter as kind `manage` (preempting scan), and drop the old `emergency`/`foreground` kind selection:

```javascript
      // Real reader path — only manage-auth uses fitness.unlock.request now.
      const arb = await readerArbiter.run({
        kind: 'manage',
        preempts: ['scan'],
        exec: ({ signal }) => runIdentifyScan(uuids, { signal }),
      });
      if (!arb.ok) {
        sendUnlockResult({ requestId, lock: lockName, matched: false, reason: 'reader-busy' });
        return;
      }
      const result = arb.value;
      sendUnlockResult({ requestId, lock: lockName, matched: !!result.matched, uuid: result.uuid || null });
```

(Use whatever the existing handler already calls to emit the result — the summary calls it the `fitness.unlock.result` send. Keep that exact topic/shape; the snippet's `sendUnlockResult` is shorthand for the existing emit. Keep the simulation branches above this unchanged.)

- [ ] **Step 3: Verify syntax + tests**

Run: `cd _extensions/fitness && node --check src/server.mjs && node --test test/`
Expected: no syntax error; all garage tests PASS.

- [ ] **Step 4: Commit**

```bash
git add _extensions/fitness/src/server.mjs
git commit -m "feat(fitness): route enroll + manage-auth through arbiter; unlock.request is manage-only"
```

---

# Group B — Backend (relay + enricher + pending guard)

### Task B1: `identityRelay` module — enrich + broadcast + pending guard

**Files:**
- Create: `backend/src/3_applications/fitness/identityRelay.mjs`
- Test: `backend/src/3_applications/fitness/identityRelay.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `backend/src/3_applications/fitness/identityRelay.test.mjs`:

```javascript
import { describe, it, expect, vi } from 'vitest';
import {
  createIdentityRelay,
  buildFingerprintIdentityIndex,
  buildAuthz,
  EMERGENCY_LOCK,
} from './identityRelay.mjs';

const profiles = () => new Map([
  ['kc', { identities: { fingerprints: [{ id: 'uuid-kc', finger: 'right-index' }] } }],
  ['guest', { identities: { fingerprints: [{ id: 'uuid-guest', finger: 'left-thumb' }] } }],
]);
const fitnessConfig = () => ({ locks: { emergency: ['kc'], dance_party: ['kc', 'guest'] } });

function makeBus() {
  let handler = null;
  return {
    broadcasts: [],
    broadcast(topic, payload) { this.broadcasts.push({ topic, payload }); },
    onClientMessage(fn) { handler = fn; },
    deliver(message) { handler('client-1', message); },
  };
}

describe('buildFingerprintIdentityIndex', () => {
  it('maps every enrolled uuid to its user + finger', () => {
    const idx = buildFingerprintIdentityIndex(profiles());
    expect(idx['uuid-kc']).toEqual({ userId: 'kc', finger: 'right-index' });
    expect(idx['uuid-guest']).toEqual({ userId: 'guest', finger: 'left-thumb' });
  });
});

describe('buildAuthz', () => {
  it('collects all lock memberships and flags emergency', () => {
    expect(buildAuthz('kc', fitnessConfig())).toEqual({ emergency: true, locks: ['emergency', 'dance_party'] });
    expect(buildAuthz('guest', fitnessConfig())).toEqual({ emergency: false, locks: ['dance_party'] });
  });
  it('EMERGENCY_LOCK is the canonical emergency lock id', () => {
    expect(EMERGENCY_LOCK).toBe('emergency');
  });
});

describe('createIdentityRelay', () => {
  const deps = (now) => ({
    eventBus: makeBus(),
    userService: { getAllProfiles: () => profiles() },
    loadFitnessConfig: () => fitnessConfig(),
    now,
    logger: { debug() {}, info() {}, warn() {} },
  });

  it('enriches a matched scan into fitness.identity.detected', () => {
    const d = deps(() => 1000);
    const relay = createIdentityRelay(d);
    d.eventBus.deliver({ topic: 'biometric.scan', modality: 'fingerprint', matched: true, uuid: 'uuid-guest' });
    const evt = d.eventBus.broadcasts.find((b) => b.topic === 'fitness.identity.detected');
    expect(evt.payload).toEqual({
      modality: 'fingerprint', matched: true, userId: 'guest', finger: 'left-thumb',
      authz: { emergency: false, locks: ['dance_party'] }, at: 1000,
    });
    expect(relay.consumePendingDetection(1000)).toBeNull(); // guest is not emergency-authorized
  });

  it('unknown uuid → matched:false null identity', () => {
    const d = deps(() => 1);
    createIdentityRelay(d);
    d.eventBus.deliver({ topic: 'biometric.scan', matched: true, uuid: 'nope' });
    const evt = d.eventBus.broadcasts.find((b) => b.topic === 'fitness.identity.detected');
    expect(evt.payload.matched).toBe(false);
    expect(evt.payload.userId).toBeNull();
  });

  it('sensed-but-unrecognized scan → matched:false', () => {
    const d = deps(() => 1);
    createIdentityRelay(d);
    d.eventBus.deliver({ topic: 'biometric.scan', matched: false });
    const evt = d.eventBus.broadcasts.find((b) => b.topic === 'fitness.identity.detected');
    expect(evt.payload.matched).toBe(false);
  });

  it('stamps a pending detection for an emergency-authorized identity, consumable once within TTL', () => {
    let t = 1000;
    const d = deps(() => t);
    const relay = createIdentityRelay({ ...d, pendingTtlMs: 30000 });
    d.eventBus.deliver({ topic: 'biometric.scan', matched: true, uuid: 'uuid-kc' });
    expect(relay.consumePendingDetection(5000)).toEqual({ userId: 'kc', at: 1000 });
    expect(relay.consumePendingDetection(5000)).toBeNull(); // consumed once
  });

  it('pending detection expires after TTL', () => {
    const d = deps(() => 1000);
    const relay = createIdentityRelay({ ...d, pendingTtlMs: 30000 });
    d.eventBus.deliver({ topic: 'biometric.scan', matched: true, uuid: 'uuid-kc' });
    expect(relay.consumePendingDetection(1000 + 30001)).toBeNull();
  });

  it('ignores non-biometric.scan messages', () => {
    const d = deps(() => 1);
    createIdentityRelay(d);
    d.eventBus.deliver({ topic: 'something.else', matched: true, uuid: 'uuid-kc' });
    expect(d.eventBus.broadcasts).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/3_applications/fitness/identityRelay.test.mjs`
Expected: FAIL — cannot resolve `./identityRelay.mjs`.

- [ ] **Step 3: Implement `identityRelay.mjs`**

Create `backend/src/3_applications/fitness/identityRelay.mjs`:

```javascript
// Backend relay: subscribes to the garage's dumb `biometric.scan`, enriches it with
// identity + authorization facts, and rebroadcasts `fitness.identity.detected` for the
// frontend IdentityManager. Also maintains the short-lived pending-detection that the
// /emergency/{commit,abort,release} endpoints consume (the guard the old detector gave).
export const EMERGENCY_LOCK = 'emergency';

const SCAN_TOPIC = 'biometric.scan';
const IDENTITY_TOPIC = 'fitness.identity.detected';
const DEFAULT_PENDING_TTL_MS = 30000;

export function buildFingerprintIdentityIndex(profiles) {
  const index = {};
  const entries = profiles instanceof Map ? [...profiles.entries()] : Object.entries(profiles || {});
  for (const [username, profile] of entries) {
    const fingerprints = profile?.identities?.fingerprints || [];
    for (const fp of fingerprints) {
      if (fp && fp.id) index[fp.id] = { userId: username, finger: fp.finger || null };
    }
  }
  return index;
}

export function buildAuthz(username, fitnessConfig) {
  const locks = [];
  let emergency = false;
  const locksMap = fitnessConfig?.locks || {};
  for (const [lockId, users] of Object.entries(locksMap)) {
    if (Array.isArray(users) && users.includes(username)) {
      locks.push(lockId);
      if (lockId === EMERGENCY_LOCK) emergency = true;
    }
  }
  return { emergency, locks };
}

export function createIdentityRelay({
  eventBus,
  userService,
  loadFitnessConfig,
  now = () => Date.now(),
  pendingTtlMs = DEFAULT_PENDING_TTL_MS,
  logger = console,
}) {
  if (!eventBus || typeof eventBus.broadcast !== 'function' || typeof eventBus.onClientMessage !== 'function') {
    throw new Error('createIdentityRelay: eventBus with broadcast() and onClientMessage() is required');
  }

  let pending = null; // { userId, at }

  function emitUnrecognized(modality, at) {
    eventBus.broadcast(IDENTITY_TOPIC, {
      modality, matched: false, userId: null, finger: null,
      authz: { emergency: false, locks: [] }, at,
    });
  }

  function handleScan(message) {
    const at = now();
    const modality = message.modality || 'fingerprint';
    if (!message.matched || !message.uuid) {
      emitUnrecognized(modality, at);
      logger.debug?.('identity.unrecognized', { modality });
      return;
    }
    const index = buildFingerprintIdentityIndex(userService?.getAllProfiles?.() || {});
    const entry = index[message.uuid];
    if (!entry) {
      emitUnrecognized(modality, at);
      logger.warn?.('identity.unknown_uuid', { modality });
      return;
    }
    const fitnessConfig = loadFitnessConfig?.() || {};
    const authz = buildAuthz(entry.userId, fitnessConfig);
    if (authz.emergency) {
      pending = { userId: entry.userId, at };
      logger.info?.('identity.pending_stamped', { userId: entry.userId });
    }
    eventBus.broadcast(IDENTITY_TOPIC, {
      modality, matched: true, userId: entry.userId, finger: entry.finger, authz, at,
    });
    logger.info?.('identity.detected', {
      userId: entry.userId, finger: entry.finger, emergency: authz.emergency, locks: authz.locks.length,
    });
  }

  eventBus.onClientMessage((_clientId, message) => {
    if (!message || message.topic !== SCAN_TOPIC) return;
    handleScan(message);
  });

  return {
    consumePendingDetection(nowMs = now()) {
      if (!pending) return null;
      if (nowMs - pending.at > pendingTtlMs) { pending = null; return null; }
      const consumed = pending;
      pending = null;
      return consumed;
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/3_applications/fitness/identityRelay.test.mjs`
Expected: PASS — all tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/identityRelay.mjs backend/src/3_applications/fitness/identityRelay.test.mjs
git commit -m "feat(fitness): identityRelay enriches biometric.scan + pending-detection guard"
```

---

### Task B2: Wire `identityRelay` into `app.mjs`; remove `createEmergencyDetector`

**Files:**
- Modify: `backend/src/app.mjs` (emergency detector block ~1678–1750; the `createFitnessApiRouter` call)

- [ ] **Step 1: Swap the construction**

In `backend/src/app.mjs`:

(a) Remove the import of `createEmergencyDetector` and add:
```javascript
import { createIdentityRelay } from './3_applications/fitness/identityRelay.mjs';
```

(b) Keep the `triggerEmergencyLockdown` / `releaseEmergencyLockdown` / `getLockdownState` construction (the lockdown state machine is unchanged). Replace the `const emergencyDetector = createEmergencyDetector({ … }); emergencyDetector.start();` block with:

```javascript
  const identityRelay = createIdentityRelay({
    eventBus,
    userService,
    loadFitnessConfig,
    logger,
  });
```

(Drop the `unlockService: getUnlockService()`, `interArmIdleMs`, `armTimeoutMs`, `activeHours`, `isLocked` arguments — they belonged to the detector loop, which no longer exists. `userService` and `loadFitnessConfig` are the same references the detector used.)

(c) In the `createFitnessApiRouter({ … })` call, replace `emergencyDetector,` with `identityRelay,`. Leave `triggerEmergencyLockdown`, `releaseEmergencyLockdown`, `getLockdownState` in place.

- [ ] **Step 2: Verify the app boots / imports resolve**

Run: `node --check backend/src/app.mjs`
Expected: no syntax error. (Full boot is verified in the integration task; here just confirm the module parses and the removed import is gone.)

- [ ] **Step 3: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat(fitness): wire identityRelay into app; remove emergency detector construction"
```

---

### Task B3: `/emergency/{commit,abort,release}` consume pending from relay; delete `/unlock` + `scanEmergency`

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs`

- [ ] **Step 1: Update the router dependency seam**

In `createFitnessRouter(config)` destructuring, replace `emergencyDetector = null,` with `identityRelay = null,` and remove `resolveEmergencyCandidates` from the deps. Keep `resolveUnlockService = getUnlockService` (manage-auth still uses it), `triggerEmergencyLockdown`, `releaseEmergencyLockdown`, `getLockdownState`.

- [ ] **Step 2: Delete the `/unlock` route and `scanEmergency`**

Remove the entire `POST /unlock` route handler and the `scanEmergency(req)` helper. Remove the now-unused imports at the top of the file:
- `resolveCandidateUuids` from `unlockPolicy.mjs`
- `resolveEmergencyCandidates, EMERGENCY_LOCK` from `emergencyPolicy.mjs`

(`getUnlockService` import stays — `gateManageAccess` uses it.)

- [ ] **Step 3: Rewrite commit/abort/release to consume the relay's pending detection**

```javascript
  // POST /emergency/commit — finalize the shutdown ceremony.
  router.post('/emergency/commit', async (req, res) => {
    const pending = identityRelay?.consumePendingDetection?.(Date.now());
    if (!pending) return res.status(409).json({ ok: false, error: 'no-pending-detection' });
    try {
      const result = await triggerEmergencyLockdown.execute({ by: pending.userId, now: Date.now() });
      return res.json({ ok: true, ...result });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /emergency/abort — admin re-scanned during the ceremony to cancel it.
  router.post('/emergency/abort', (req, res) => {
    const pending = identityRelay?.consumePendingDetection?.(Date.now());
    return res.json({ ok: true, confirmed: !!pending });
  });

  // POST /emergency/release — admin re-scanned (then press-and-hold) to lift lockdown.
  router.post('/emergency/release', async (req, res) => {
    const pending = identityRelay?.consumePendingDetection?.(Date.now());
    if (!pending) return res.status(409).json({ ok: false, error: 'no-pending-detection' });
    try {
      const result = await releaseEmergencyLockdown.execute({ by: pending.userId, now: Date.now() });
      return res.json({ ok: true, released: true, ...result });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
```

(Preserve the existing `GET /emergency` state endpoint unchanged. Match the exact `triggerEmergencyLockdown.execute` / `releaseEmergencyLockdown.execute` argument shape the current code uses — read those use-case `execute` signatures and adapt the `{ by, now }` keys to match what they accept.)

- [ ] **Step 4: Delete the obsolete unlock route test**

```bash
git rm backend/src/4_api/v1/routers/fitness.unlock.test.mjs
```

- [ ] **Step 5: Verify**

Run: `node --check backend/src/4_api/v1/routers/fitness.mjs`
Expected: no syntax error, no references to `resolveCandidateUuids` / `resolveEmergencyCandidates` / `scanEmergency` / `emergencyDetector` remain. Confirm with:
```bash
grep -nE 'resolveCandidateUuids|resolveEmergencyCandidates|scanEmergency|emergencyDetector' backend/src/4_api/v1/routers/fitness.mjs
```
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/fitness.mjs
git commit -m "feat(fitness): emergency endpoints consume relay pending; remove /unlock + scanEmergency"
```

---

### Task B4: Update `bootstrap.mjs` to pass `identityRelay`

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs` (~1021, ~1142)

- [ ] **Step 1: Rename the passthrough**

Change the `emergencyDetector = null` parameter/default and the `emergencyDetector,` passthrough in the `createFitnessRouter`/router-construction call to `identityRelay`. If `bootstrap.mjs` receives the dependency from `app.mjs`, thread `identityRelay` through with the same shape it used for `emergencyDetector`.

- [ ] **Step 2: Verify**

Run: `node --check backend/src/0_system/bootstrap.mjs && grep -n emergencyDetector backend/src/0_system/bootstrap.mjs`
Expected: no syntax error; no `emergencyDetector` references remain.

- [ ] **Step 3: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "refactor(fitness): bootstrap passes identityRelay instead of emergencyDetector"
```

---

### Task B5: Remove `unlockService` foreground bracketing (keep manage-auth)

**Files:**
- Modify: `backend/src/3_applications/fitness/unlockService.mjs`
- Modify: its test file if it exercises the foreground methods.

- [ ] **Step 1: Remove the foreground arbiter methods**

Delete `beginForeground`, `endForeground`, `isForegroundActive` from the returned service object and any module-level `isUnlockForegroundActive` export, plus the internal foreground-active flag they manipulate. Keep `requestUnlock(lockName, candidateUuids, opts)` and the inbound `fitness.unlock.result` resolution (`broker.resolveResult`) — these power `gateManageAccess`.

- [ ] **Step 2: Update the unlockService test**

Open the unlockService test. Remove any test referencing `beginForeground`/`endForeground`/`isForegroundActive`/`isUnlockForegroundActive`. Keep/verify the `requestUnlock` round-trip test (request emitted on `fitness.unlock.request`, resolved by an inbound `fitness.unlock.result`).

- [ ] **Step 3: Run the unlockService test**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/3_applications/fitness/unlockService.test.mjs`
Expected: PASS (or the file's actual name — locate it first).

- [ ] **Step 4: Commit**

```bash
git add backend/src/3_applications/fitness/unlockService.mjs backend/src/3_applications/fitness/unlockService.test.mjs
git commit -m "refactor(fitness): drop unlockService foreground bracketing; keep manage-auth requestUnlock"
```

---

### Task B6: Delete dead backend modules

**Files:**
- Delete: `backend/src/3_applications/fitness/emergencyDetector.mjs` (+ its test)
- Delete: `backend/src/3_applications/fitness/unlockPolicy.mjs` (+ its test)
- Delete: `backend/src/3_applications/fitness/emergencyPolicy.mjs` (+ its test)

- [ ] **Step 1: Confirm no remaining importers**

Run:
```bash
grep -rnE "emergencyDetector|unlockPolicy|emergencyPolicy|resolveCandidateUuids|resolveEmergencyCandidates" backend/src --include=*.mjs | grep -v '\.test\.mjs' | grep -vE 'emergencyDetector\.mjs|unlockPolicy\.mjs|emergencyPolicy\.mjs'
```
Expected: no output (the only references should be inside the files about to be deleted). If `EMERGENCY_LOCK` is imported anywhere from `emergencyPolicy`, repoint that import to `identityRelay.mjs` first.

- [ ] **Step 2: Delete the files**

```bash
git rm backend/src/3_applications/fitness/emergencyDetector.mjs \
       backend/src/3_applications/fitness/emergencyDetector.test.mjs \
       backend/src/3_applications/fitness/unlockPolicy.mjs \
       backend/src/3_applications/fitness/unlockPolicy.test.mjs \
       backend/src/3_applications/fitness/emergencyPolicy.mjs \
       backend/src/3_applications/fitness/emergencyPolicy.test.mjs
```
(If any `.test.mjs` partner does not exist, drop it from the command — `git rm` errors on missing paths.)

- [ ] **Step 3: Verify backend fitness tests are green**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/3_applications/fitness/ backend/src/4_api/v1/routers/`
Expected: PASS (no missing-module import errors).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(fitness): delete dead emergencyDetector + policy modules"
```

---

# Group C — Frontend (IdentityManager router)

### Task C1: `useEmergencyLockdown` — drop `detected` subscription; add `triggerCeremony()`

**Files:**
- Modify: `frontend/src/modules/Fitness/hooks/useEmergencyLockdown.js`
- Test: its existing test (update) — locate `useEmergencyLockdown.test.*`.

- [ ] **Step 1: Update/extend the test**

In the existing test, remove the case asserting that a `fitness.emergency.detected` WS event drives `phase` → triggering. Add a test that calling the returned `triggerCeremony()` moves `phase` from normal → triggering (idempotent — calling it again while triggering stays triggering). Keep the `locked` / `released` subscription tests.

Sketch (adapt to the file's existing harness/mocks):
```javascript
it('triggerCeremony() moves normal → triggering and is idempotent', () => {
  const { result } = renderHook(() => useEmergencyLockdown());
  expect(result.current.phase).toBe('normal');
  act(() => result.current.triggerCeremony());
  expect(result.current.phase).toBe('triggering');
  act(() => result.current.triggerCeremony());
  expect(result.current.phase).toBe('triggering');
});
```

- [ ] **Step 2: Run to verify the new test fails**

Run: `npx jest frontend/src/modules/Fitness/hooks/useEmergencyLockdown.test.js`
Expected: FAIL — `result.current.triggerCeremony is not a function`.

- [ ] **Step 3: Implement**

In `useEmergencyLockdown.js`:
- Change `TOPICS` from `['fitness.emergency.detected', 'fitness.emergency.locked', 'fitness.emergency.released']` to `['fitness.emergency.locked', 'fitness.emergency.released']`.
- Remove the WS handler branch for `fitness.emergency.detected`.
- Add a `triggerCeremony` callback that performs the normal → triggering transition (the same `setPhase(PHASE_TRIGGERING)` guarded by `phase === PHASE_NORMAL`) and include it in the returned object:

```javascript
  const triggerCeremony = useCallback(() => {
    setPhase((prev) => (prev === PHASE_NORMAL ? PHASE_TRIGGERING : prev));
  }, []);
  // …
  return { phase, lockedUntil, lockedBy, commit, abort, release, triggerCeremony };
```

(Keep `commit`/`abort`/`release` and the `?emergency=` URL hydration unchanged. Use the functional `setPhase` form so it doesn't capture a stale `phase`.)

- [ ] **Step 4: Run to verify pass**

Run: `npx jest frontend/src/modules/Fitness/hooks/useEmergencyLockdown.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/hooks/useEmergencyLockdown.js frontend/src/modules/Fitness/hooks/useEmergencyLockdown.test.js
git commit -m "refactor(fitness): emergency hook is triggered by IdentityManager, not a detected event"
```

---

### Task C2: `IdentityProvider` — context router for `fitness.identity.detected`

**Files:**
- Create: `frontend/src/modules/Fitness/identity/IdentityProvider.jsx`
- Test: `frontend/src/modules/Fitness/identity/IdentityProvider.test.jsx`

- [ ] **Step 1: Write the failing test (routing matrix)**

Create `frontend/src/modules/Fitness/identity/IdentityProvider.test.jsx`:

```javascript
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { IdentityProvider, useIdentity } from './IdentityProvider';

// Controllable fakes
const emergency = {
  phase: 'normal', lockedUntil: null, lockedBy: null,
  commit: jest.fn(), abort: jest.fn(), release: jest.fn(), triggerCeremony: jest.fn(),
};
jest.mock('../hooks/useEmergencyLockdown', () => ({
  __esModule: true,
  default: () => emergency,
  PHASE_NORMAL: 'normal', PHASE_TRIGGERING: 'triggering', PHASE_LOCKED: 'locked',
}));

let wsHandler = null;
jest.mock('../../../services/WebSocketService', () => ({
  __esModule: true,
  default: { subscribe: (_f, cb) => { wsHandler = cb; return () => { wsHandler = null; }; } },
}));

jest.mock('../context/FitnessContext', () => ({
  useFitness: () => ({ userCollections: { all: [{ id: 'kc', name: 'KC' }] } }),
}));

function emit(payload) {
  act(() => { wsHandler({ topic: 'fitness.identity.detected', ...payload }); });
}

function Probe({ onReady }) {
  const id = useIdentity();
  onReady(id);
  return <div data-testid="state">{id.unlockState}</div>;
}

beforeEach(() => { emergency.phase = 'normal'; jest.clearAllMocks(); });

test('no modal + emergency-authorized → starts ceremony', () => {
  let api;
  render(<IdentityProvider><Probe onReady={(x) => { api = x; }} /></IdentityProvider>);
  emit({ matched: true, userId: 'kc', finger: 'right-index', authz: { emergency: true, locks: ['emergency'] } });
  expect(emergency.triggerCeremony).toHaveBeenCalledTimes(1);
});

test('triggering + emergency-authorized → abort', () => {
  emergency.phase = 'triggering';
  render(<IdentityProvider><Probe onReady={() => {}} /></IdentityProvider>);
  emit({ matched: true, userId: 'kc', authz: { emergency: true, locks: ['emergency'] } });
  expect(emergency.abort).toHaveBeenCalledTimes(1);
});

test('modal open + authorized for that lock → granted verdict resolves', async () => {
  let api;
  render(<IdentityProvider><Probe onReady={(x) => { api = x; }} /></IdentityProvider>);
  let verdict;
  act(() => { api.registerUnlock('dance_party').then((v) => { verdict = v; }); });
  emit({ matched: true, userId: 'kc', authz: { emergency: false, locks: ['dance_party'] } });
  await waitFor(() => expect(verdict).toEqual({ matched: true, userId: 'kc' }));
});

test('modal open + NOT authorized for that lock → denied, no resolve', async () => {
  let api;
  render(<IdentityProvider><Probe onReady={(x) => { api = x; }} /></IdentityProvider>);
  let verdict;
  act(() => { api.registerUnlock('dance_party').then((v) => { verdict = v; }); });
  emit({ matched: true, userId: 'guest', authz: { emergency: false, locks: ['skip_content'] } });
  await waitFor(() => expect(api.unlockState).toBe('denied'));
  expect(verdict).toBeUndefined();
  act(() => { api.clearUnlock(); });
  await waitFor(() => expect(verdict).toEqual({ matched: false, reason: 'cancelled' }));
});

test('no modal + non-emergency scan → ignored', () => {
  render(<IdentityProvider><Probe onReady={() => {}} /></IdentityProvider>);
  emit({ matched: true, userId: 'guest', authz: { emergency: false, locks: ['dance_party'] } });
  expect(emergency.triggerCeremony).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest frontend/src/modules/Fitness/identity/IdentityProvider.test.jsx`
Expected: FAIL — cannot find module `./IdentityProvider`.

- [ ] **Step 3: Implement `IdentityProvider.jsx`**

Create `frontend/src/modules/Fitness/identity/IdentityProvider.jsx`. Use the logging framework (no raw console).

```jsx
import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useEmergencyLockdown, { PHASE_NORMAL, PHASE_TRIGGERING } from '../hooks/useEmergencyLockdown';
import wsService from '../../../services/WebSocketService';
import { useFitness } from '../context/FitnessContext';
import getLogger from '../../../lib/logging/Logger.js';

const IDENTITY_TOPIC = 'fitness.identity.detected';
const IdentityContext = createContext(null);

export function IdentityProvider({ children }) {
  const logger = useMemo(() => getLogger().child({ component: 'identity-manager' }), []);
  const emergency = useEmergencyLockdown();

  const phaseRef = useRef(emergency.phase);
  useEffect(() => { phaseRef.current = emergency.phase; }, [emergency.phase]);

  const { userCollections } = useFitness();
  const rosterRef = useRef([]);
  rosterRef.current = Array.isArray(userCollections?.all) ? userCollections.all : [];

  const [activeLock, setActiveLock] = useState(null);
  const activeLockRef = useRef(null);
  const [unlockState, setUnlockState] = useState('idle'); // idle | scanning | granted | denied
  const [unlockedUser, setUnlockedUser] = useState(null);
  const verdictResolverRef = useRef(null);

  const resolveVerdict = useCallback((verdict) => {
    const resolve = verdictResolverRef.current;
    verdictResolverRef.current = null;
    if (resolve) resolve(verdict);
  }, []);

  const registerUnlock = useCallback((lock) => {
    activeLockRef.current = lock;
    setActiveLock(lock);
    setUnlockState('scanning');
    setUnlockedUser(null);
    logger.info('unlock-registered', { lock });
    return new Promise((resolve) => { verdictResolverRef.current = resolve; });
  }, [logger]);

  const clearUnlock = useCallback(() => {
    activeLockRef.current = null;
    setActiveLock(null);
    setUnlockState('idle');
    setUnlockedUser(null);
    resolveVerdict({ matched: false, reason: 'cancelled' });
  }, [resolveVerdict]);

  const resolveName = useCallback((userId) => {
    const hit = rosterRef.current.find((u) => u.id === userId || u.slug === userId || u.userId === userId);
    return hit ? (hit.name || hit.title || userId) : userId;
  }, []);

  useEffect(() => {
    const unsub = wsService.subscribe([IDENTITY_TOPIC], (msg) => {
      if (!msg || msg.topic !== IDENTITY_TOPIC) return;
      const lock = activeLockRef.current;

      if (lock) {
        const authorized = !!msg.matched
          && Array.isArray(msg.authz?.locks)
          && msg.authz.locks.includes(lock);
        if (authorized) {
          setUnlockedUser({ userId: msg.userId, name: resolveName(msg.userId) });
          setUnlockState('granted');
          logger.info('unlock-granted', { lock, userId: msg.userId });
          resolveVerdict({ matched: true, userId: msg.userId });
        } else {
          setUnlockState('denied');
          logger.warn('unlock-denied', { lock, userId: msg.userId || null });
        }
        return;
      }

      // No modal: only emergency-authorized identities matter.
      if (!msg.matched || !msg.authz?.emergency) return;
      const phase = phaseRef.current;
      if (phase === PHASE_NORMAL) {
        logger.info('emergency-ceremony-start', { userId: msg.userId });
        emergency.triggerCeremony();
      } else if (phase === PHASE_TRIGGERING) {
        logger.info('emergency-ceremony-abort', { userId: msg.userId });
        emergency.abort();
      }
      // PHASE_LOCKED: release is driven by the press-and-hold UI, not a scan.
    });
    return () => { try { unsub(); } catch (_e) { /* noop */ } };
  }, [emergency, logger, resolveName, resolveVerdict]);

  const value = useMemo(() => ({
    // emergency surface (single owner)
    phase: emergency.phase,
    lockedUntil: emergency.lockedUntil,
    lockedBy: emergency.lockedBy,
    commit: emergency.commit,
    abort: emergency.abort,
    release: emergency.release,
    // unlock surface
    registerUnlock,
    clearUnlock,
    activeLock,
    unlockState,
    unlockedUser,
  }), [emergency, registerUnlock, clearUnlock, activeLock, unlockState, unlockedUser]);

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity() {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error('useIdentity must be used within an IdentityProvider');
  return ctx;
}

export default IdentityProvider;
```

(Verify the real import paths: `useEmergencyLockdown` default export + `PHASE_*` named exports; `WebSocketService` default export; `useFitness` from the FitnessContext module; `Logger.js` relative depth. Adjust the relative `../` counts to the actual file location. If `useEmergencyLockdown` is a *named* export, import it accordingly and update the test mock to match.)

- [ ] **Step 4: Run to verify pass**

Run: `npx jest frontend/src/modules/Fitness/identity/IdentityProvider.test.jsx`
Expected: PASS — all routing cases.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/identity/IdentityProvider.jsx frontend/src/modules/Fitness/identity/IdentityProvider.test.jsx
git commit -m "feat(fitness): IdentityProvider routes fitness.identity.detected by context"
```

---

### Task C3: Mount `IdentityProvider` and route `EmergencyLockdownOverlay` through it

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx` (wrap content; the `<EmergencyLockdownOverlay>` mount)
- Modify: `frontend/src/modules/Fitness/player/overlays/EmergencyLockdownOverlay.jsx`

- [ ] **Step 1: Mount the provider**

In `FitnessApp.jsx`, wrap the app content (inside `FitnessProvider`, so `useFitness` is available to `IdentityProvider`) with `<IdentityProvider>…</IdentityProvider>`. Import it:
```jsx
import { IdentityProvider } from '../modules/Fitness/identity/IdentityProvider';
```
Ensure `<EmergencyLockdownOverlay audioPath={emergencyAudioPath} />` and all unlock-consuming screens render *inside* `IdentityProvider`.

- [ ] **Step 2: Make `EmergencyLockdownOverlay` consume context instead of its own hook**

In `EmergencyLockdownOverlay.jsx`, replace:
```jsx
const { phase, lockedUntil, commit, abort, release } = useEmergencyLockdown();
```
with:
```jsx
import { useIdentity } from '../../identity/IdentityProvider';
// …
const { phase, lockedUntil, commit, abort, release } = useIdentity();
```
Remove the now-unused `useEmergencyLockdown` import. The `TriggeringScreen` (audio-ended → `commit`; second-admin-scan cancel is now driven by IdentityManager calling `abort`, so the overlay's own cancel path stays as a UI affordance) and `LockedScreen` (press-and-hold → `release`) keep their existing props/behavior — they just read state from `useIdentity()`.

(Confirm the relative import depth from `player/overlays/` to `identity/` — likely `../../identity/IdentityProvider`.)

- [ ] **Step 3: Run the overlay + app tests**

Run: `npx jest frontend/src/modules/Fitness/player/overlays/EmergencyLockdownOverlay.test.jsx frontend/src/Apps/FitnessApp.test.jsx`
Expected: PASS. If a test renders `EmergencyLockdownOverlay` without an `IdentityProvider`, wrap it in one (or mock `useIdentity`) — update those tests accordingly.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/Apps/FitnessApp.jsx frontend/src/modules/Fitness/player/overlays/EmergencyLockdownOverlay.jsx
git commit -m "feat(fitness): mount IdentityProvider; emergency overlay consumes shared identity context"
```

---

### Task C4: Migrate `FitnessShow` from `useUnlock` to `useIdentity`

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessShow.jsx`

- [ ] **Step 1: Swap the hook**

Replace `const { requestUnlock, state, unlockedUser, reset } = useUnlock();` with:
```jsx
const { registerUnlock, clearUnlock, unlockState, unlockedUser } = useIdentity();
```
Update the import: remove `useUnlock`, add `import { useIdentity } from '../identity/IdentityProvider';` (verify depth from `player/` → `identity/` is `../identity/`).

- [ ] **Step 2: Repoint the two unlock taps**

`handleGovernanceUnlockTap` (lock `governance_bypass`) and `handleLockedEpisodeUnlockTap` (lock `skip_content`): change `requestUnlock('<lock>').then((result) => { … })` to `registerUnlock('<lock>').then((result) => { … })`. The `result` shape is `{ matched, userId }` (granted) or `{ matched: false, reason: 'cancelled' }` (dismissed) — branch on `result.matched` exactly as before.

- [ ] **Step 3: Repoint `UnlockPrompt` props**

In the `<UnlockPrompt … />` render, map `state` → `unlockState`, `onCancel`/`reset` → `clearUnlock`, keep `unlockedUser`, `lockLabel`, `open` derived from the existing `pendingUnlock` state. Replace any `reset()` calls with `clearUnlock()`.

- [ ] **Step 4: Run FitnessShow tests**

Run: `npx jest frontend/src/modules/Fitness/player/FitnessShow`
Expected: PASS. Wrap any render-without-provider in `<IdentityProvider>` or mock `useIdentity`. If `FitnessShow.unlock.test.jsx` asserts the old `POST /unlock` request/response flow, rewrite those assertions to drive a `fitness.identity.detected` event through a mocked `useIdentity` (the routing itself is covered by `IdentityProvider.test.jsx`, so here just assert the component reacts to `unlockState`/verdict).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/FitnessShow.jsx frontend/src/modules/Fitness/player/FitnessShow.unlock.test.jsx
git commit -m "feat(fitness): FitnessShow unlock via IdentityManager"
```

---

### Task C5: Migrate `FitnessModuleMenu` from `useUnlock` to `useIdentity`

**Files:**
- Modify: `frontend/src/modules/Fitness/nav/FitnessModuleMenu.jsx`

- [ ] **Step 1: Swap the hook + tap**

Replace `useUnlock()` usage with `useIdentity()` (`registerUnlock`/`clearUnlock`/`unlockState`/`unlockedUser`). Import from `../identity/IdentityProvider` (verify depth from `nav/` → `identity/` is `../identity/`). Change `requestUnlock(mod.id)` → `registerUnlock(mod.id)`; the `.then((result) => …)` branches on `result.matched` as before.

- [ ] **Step 2: Repoint `UnlockPrompt` props** (`state` → `unlockState`, cancel → `clearUnlock`), same as Task C4 Step 3.

- [ ] **Step 3: Run tests**

Run: `npx jest frontend/src/modules/Fitness/nav/FitnessModuleMenu`
Expected: PASS (wrap/mock provider as in C4; rewrite the `*.unlock.test.jsx` request/response assertions to the identity-event model).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/nav/FitnessModuleMenu.jsx frontend/src/modules/Fitness/nav/FitnessModuleMenu.unlock.test.jsx
git commit -m "feat(fitness): FitnessModuleMenu unlock via IdentityManager"
```

---

### Task C6: Migrate `FitnessPlayer` from `useUnlock` to `useIdentity`

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx`

- [ ] **Step 1: Swap the hook + tap**

Replace `useUnlock()` with `useIdentity()`; `requestUnlock('governance_bypass')` → `registerUnlock('governance_bypass')`; `unlockPromptOpen` and the `.then` branch unchanged in logic. Import from `../identity/IdentityProvider`.

- [ ] **Step 2: Repoint `UnlockPrompt` props** (`state` → `unlockState`, cancel → `clearUnlock`).

- [ ] **Step 3: Run tests**

Run: `npx jest frontend/src/modules/Fitness/player/FitnessPlayer`
Expected: PASS (wrap/mock provider).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/player/FitnessPlayer.jsx
git commit -m "feat(fitness): FitnessPlayer unlock via IdentityManager"
```

---

### Task C7: Retire `useUnlock`

**Files:**
- Delete: `frontend/src/modules/Fitness/hooks/useUnlock.js` (+ `useUnlock.test.js`)

- [ ] **Step 1: Confirm no remaining importers**

Run:
```bash
grep -rn "useUnlock" frontend/src --include=*.js --include=*.jsx | grep -v 'useFingerprintManager'
```
Expected: only the about-to-be-deleted `useUnlock.js`/`useUnlock.test.js` lines (the `useFingerprintManager` reference is a doc comment — leave or tidy it). If any real consumer remains, migrate it (mirror Task C4) before deleting.

- [ ] **Step 2: Delete**

```bash
git rm frontend/src/modules/Fitness/hooks/useUnlock.js frontend/src/modules/Fitness/hooks/useUnlock.test.js
```
(Drop the test path if it doesn't exist.)

- [ ] **Step 3: Verify frontend fitness suite is green**

Run: `npx jest frontend/src/modules/Fitness`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(fitness): retire useUnlock; IdentityManager owns all unlock flows"
```

---

# Group D — Integration & deploy

### Task D1: Full backend + frontend test sweep

**Files:** none (verification)

- [ ] **Step 1: Backend fitness suite**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/3_applications/fitness/ backend/src/4_api/v1/routers/`
Expected: PASS, no missing-module errors.

- [ ] **Step 2: Garage suite**

Run: `cd _extensions/fitness && node --test test/`
Expected: PASS.

- [ ] **Step 3: Frontend fitness suite**

Run: `npx jest frontend/src/modules/Fitness frontend/src/Apps/FitnessApp.test.jsx`
Expected: PASS.

- [ ] **Step 4: App boots locally**

Start the backend dev server (per CLAUDE.md multi-env rules — check the port first), confirm it boots with no `createEmergencyDetector`/`createIdentityRelay` errors in `dev.log`, then stop it.
```bash
node --check backend/src/app.mjs && node --check backend/src/0_system/bootstrap.mjs
```
Expected: clean.

- [ ] **Step 5: Commit any test fixups made during the sweep** (if none, skip).

---

### Task D2: Deploy garage + daylight-station and verify the live shutdown sequence

**Files:** none (deploy + live verification). This is the failure the whole effort fixes — verify it end-to-end via logs (do not speculate).

- [ ] **Step 1: Build + deploy the garage fitness image (on garage, root, no sudo)**

```bash
ssh root@garage 'cd /opt/Code/DaylightStation 2>/dev/null || true'
# Build on garage from the repo (per CLAUDE.local.md fitness build):
sudo docker build -f _extensions/fitness/Dockerfile -t kckern/daylight-station-fitness:latest _extensions/fitness/
sudo docker save kckern/daylight-station-fitness:latest | ssh root@garage 'docker load'
ssh root@garage 'cd /opt/fitness-controller && docker compose up -d'
```
(If `sudo docker save` is blocked by NOPASSWD, build directly on garage: `ssh root@garage 'cd <repo-on-garage> && docker build -f _extensions/fitness/Dockerfile -t kckern/daylight-station-fitness:latest _extensions/fitness/ && cd /opt/fitness-controller && docker compose up -d'`.)

- [ ] **Step 2: Confirm the continuous scan loop started (garage logs)**

```bash
ssh root@garage 'docker logs --tail 50 daylight-fitness 2>&1 | grep -E "Continuous biometric scan|biometric.scan|readerArbiter"'
```
Expected: a "Continuous biometric scan loop started" line; no crash loop.

- [ ] **Step 3: Build + deploy daylight-station (kckern-server)**

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 4: Confirm the relay is live (daylight-station logs)**

```bash
sudo docker logs --tail 80 daylight-station 2>&1 | grep -iE "identity|biometric|emergency|fitness"
```
Expected: no `createEmergencyDetector` reference; relay constructed without error.

- [ ] **Step 5: Live verify the shutdown sequence (the original bug)**

With no modal open, present an emergency-authorized finger on the garage reader. Then watch both logs:
```bash
# garage emits the dumb event:
ssh root@garage 'docker logs --tail 20 daylight-fitness 2>&1 | grep biometric.scan'
# backend enriches + frontend should drive the ceremony → /emergency/commit → HA garage shutdown:
sudo docker logs --tail 60 daylight-station 2>&1 | grep -iE "identity.detected|pending_stamped|emergency/commit|TriggerEmergencyLockdown|garage"
```
Expected: `biometric.scan` (matched) on garage → `identity.detected` + `pending_stamped` on backend → ceremony audio → `/emergency/commit` consumes pending → HA garage shutdown fires. This is the path that previously never reached `/emergency/commit`.

- [ ] **Step 6: Verify a modal-open unlock still works (no contention)**

Open a `dance_party` (or governance) unlock modal in the fitness UI, present an authorized finger. Confirm the modal grants and the emergency ceremony does NOT trigger (the IdentityManager routes to the modal because a lock is active).

- [ ] **Step 7: Report results from the logs** (pass/fail with the actual log lines). If anything fails, debug the real path — do not dismiss.

---

## Self-Review

**Spec coverage:**
- Garage dumb broadcaster (full-store identify, settle, busy/cancel backoff, no-spam) → A1, A3, A4. ✓
- Enroll preempts via arbiter + SIGTERM → A2, A5. ✓
- `fitness.unlock.request` kept narrowly for manage-auth (deviation) → A5; spec deviation note. ✓
- Backend relay enrich `uuid→{userId,finger,authz}` + `fitness.identity.detected` + pending guard → B1, B2. ✓
- `/emergency/{commit,abort,release}` consume pending; remove `/unlock`+`scanEmergency`; remove foreground bracketing; delete detector → B3, B5, B6. ✓
- `EMERGENCY_LOCK` relocated to `identityRelay` → B1 (+ B3/B6 repoint). ✓
- Frontend IdentityManager router (modal→unlock; no-modal+admin→ceremony; triggering→abort; locked→release via hold) → C2, C3. ✓
- `useEmergencyLockdown` drops `detected` sub, adds `triggerCeremony` → C1. ✓
- All three `useUnlock` consumers migrated; `useUnlock` retired → C4, C5, C6, C7. ✓
- Lockdown state machine + commit→HA shutdown + enroll/delete kept → unchanged (verified D1/D2). ✓
- Testing across garage/backend/frontend → tasks include tests; D1 sweeps. ✓

**Placeholder scan:** No TBD/TODO; every code step shows code; commands show expected output. Where exact line content can drift (router internals, import depths), tasks instruct the implementer to read the file and match existing signatures rather than guess — this is direction, not a placeholder.

**Type consistency:**
- Arbiter: `run({kind, exec, preempts})` → `{ok:true,value}|{ok:false,reason}` used identically in A2/A4/A5. ✓
- Relay: `createIdentityRelay`, `buildFingerprintIdentityIndex`, `buildAuthz`, `EMERGENCY_LOCK`, `consumePendingDetection(nowMs)` consistent B1↔B3. ✓
- `fitness.identity.detected` payload `{modality, matched, userId|null, finger|null, authz:{emergency,locks}, at}` consistent B1↔C2. ✓
- `biometric.scan` payload `{modality, matched, uuid?}` consistent A4↔B1. ✓
- IdentityManager surface: `registerUnlock`, `clearUnlock`, `unlockState`, `unlockedUser`, `phase`, `commit/abort/release`, `triggerCeremony` consistent C2↔C3↔C4↔C5↔C6. ✓
- Emergency hook return adds `triggerCeremony`, drops nothing the overlay needs C1↔C3. ✓
