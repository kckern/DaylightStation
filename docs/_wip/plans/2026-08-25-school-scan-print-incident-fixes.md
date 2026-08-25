# School Scan-and-Print Incident Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the defects behind the 2026-08-25 morning incident, where one NFC card tap produced five print jobs, two blank auto-cut receipts, four duplicate ungraded sessions, a scripture course that silently offered nothing — and, discovered later the same morning, a learner who scored 100% and still could not unlock his piano games.

> ### ⚠️ Read this before picking a task
>
> **Task 4 (publish the scripture units) is now the highest-priority item, and it is not log noise.** At 09:31 a learner scored 100% on his only assigned work. `GET /api/v1/school/lifecycle/learners/<id>/completion` still returns:
>
> ```json
> { "state": "indeterminate", "faults": [{ "subject": null, "reason": "plan_error" }] }
> ```
>
> That `plan_error` **is** the draft-units defect. `useSchoolGameAccess.js:6` unlocks games only on `complete` or `no_work_today`, so `indeterminate` keeps them locked. The same fault also blocks the portal from ever showing a "done for the day" state. **One data change closes the 141 warns/day, the completion signal, and the games lock.**

**Architecture:** Five independent fixes at four layers. A dedup guard moves to the *broadcast* path in the OMR relay (application); the thermal printer adapter gains an abort flag so a timed-out job cannot resurrect (adapter); a per-learner mutex makes the agenda cooldown concurrency-safe (application); 85 curriculum units get promoted past a silent publish gate (data); and a teacher-UI card stops rendering three controls for one URL (frontend). Each task is independently revertible.

**Tech Stack:** Node ESM (`.mjs`), React (`.jsx`), **two test runners split by location** — vitest for colocated `backend/src/**/*.test.mjs`, jest for `tests/unit/**`. YAML data in a Docker volume.

**Source of truth for this work:** `docs/_wip/bugs/2026-08-25-school-morning-scan-and-print-incident.md` (revision 2).

## Global Constraints

- **Do NOT `rm` anything under the data tree.** Move to `data/_deleteme/` instead. `docker exec` runs as root, so `rm` always "succeeds" — that is the trap, not the safeguard.
- **Do NOT use `sed -i` on YAML inside the container.** It mangles multi-line structure. Write complete files, or do a line-wise replace verified by `diff`.
- **Never use raw `console.*`** for diagnostics. Use the structured logger already imported in each file.
- **Log new diagnostics at `info` or above, never `debug`.** Debug events are not shipped to the log store, so a `debug` line is invisible in production and proves nothing.
- **Thermal printer tests MUST inject the transport** via `options.createTransport`. `escpos-network` is CJS; module-mocking it silently opens a **real socket to 10.0.0.50 and wastes paper**. This is documented at the top of `ThermalPrinterAdapter.flush.test.mjs` and was learned the hard way.
- **Deploy gate:** before `sudo deploy-daylight`, confirm no active fitness session and no playing video, per `CLAUDE.local.md`. School is in active morning use — prefer landing Tasks 1–3 together and deploying once.
- Work happens in the worktree `/opt/Code/DaylightStation/.claude/worktrees/household-data-reorg`. Do **not** `cd` to the main repo.

### Verified test commands (both confirmed working from this worktree)

```bash
# vitest — for colocated backend/src/**/*.test.mjs
node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run <file> --config ./vitest.config.mjs

# jest — for tests/unit/**  (NODE_OPTIONS is required; without it, parse errors are faked)
NODE_OPTIONS=--experimental-vm-modules node /opt/Code/DaylightStation/node_modules/jest/bin/jest.js <file>
```

Do **not** add `--reporter=basic` to the vitest command; this vitest version rejects it with an opaque `ERR_LOAD_URL`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `backend/src/3_applications/hardware/omrRelay.mjs` | Add per-reader+UID dedup on the **broadcast** path | 1 |
| `backend/src/3_applications/hardware/omrRelay.test.mjs` | Extend (vitest, 30 tests currently pass) | 1 |
| `backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs` | Abort flag + socket destroy on timeout; raise connect timeout | 2, 3 |
| `tests/unit/adapters/hardware/thermal-printer/ThermalPrinterAdapter.abort.test.mjs` | **Create** (jest) | 2 |
| Data: `data/content/school/scripture/come-follow-me-ot-2026/**` | `reviewState: draft` → `approved` | 4 |
| Data: `data/household/school/records/sessions/2026-08/` | Move 3 ghost sessions to `_deleteme` | 5 |
| `backend/src/3_applications/school/usecases/ResolvePersonalCard.mjs` | Per-learner mutex; revoke token on suppression | 6 |
| `backend/src/3_applications/school/usecases/ResolvePersonalCard.test.mjs` | **Create** (vitest) | 6 |
| `frontend/src/modules/School/teacher/panels/IssuedArtifactCard.jsx` | One control per destination | 7 |
| `frontend/src/modules/School/teacher/tabs/TodayTab.test.jsx` | Update expectations | 7 |
| `backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs` | `getStatus` read fix + pre/post-job status gating | 8 |
| `tests/unit/adapters/hardware/thermal-printer/ThermalPrinterAdapter.status.test.mjs` | **Create** (jest) | 8 |
| `backend/src/3_applications/school/usecases/ResolvePersonalCard.mjs` | Third-tap cooldown override | 9 |
| `frontend/src/modules/School/selfService/scanCeremonySound.js` | Add the `perfect` tone pattern | 10 |
| `frontend/src/modules/School/selfService/useScanCeremony.js` | Route a clean sweep to `perfect` | 10 |
| `frontend/src/modules/School/home/` (learner card) + `School.scss` | Green "done" state on the portal | 11 |
| `frontend/src/modules/Piano/PianoKiosk/useSchoolGameAccess.js` | Subscribe to pushed completion; poll → 3 min | 12 |
| `backend/src/3_applications/school/SchoolCompletionBridge.mjs` | `publish` → `broadcast` (the component already exists and computes transitions) | 12 |
| `backend/src/1_adapters/persistence/yaml/YamlAgendaCooldownStore.mjs` | Add `suppressedTaps` to BOTH field whitelists | 9 |
| `backend/src/2_domains/school/documents/receipts.mjs` | `dayComplete` card in `resultDocument` | 13 |
| `backend/src/3_applications/school/usecases/CloseSessionOutcome.mjs` | Thread `dayComplete` (line 349); synchronous completion recompute | 13 |

**Task order matters.** Task 3 (raise the timeout) MUST land after Task 2 (abort). Raising the timeout without the abort flag only widens the window in which abandoned sockets accumulate.

---

## Task 1: Dedupe NFC taps on the broadcast path (RC-1)

The relay already has a 2000 ms per-UID dedup, but it lives in `onPayload` — the **persist** subscriber — which runs *after* the unconditional broadcast. Every consumer that *acts* on a tap (printing an agenda, opening a session) subscribes to the broadcast, so the existing guard only ever protected the day-log. One bouncing card produced five ingests in 103 ms.

**Files:**
- Modify: `backend/src/3_applications/hardware/omrRelay.mjs` (declare state near line 94; guard inside the `nfc` branch at lines 164–184)
- Test: `backend/src/3_applications/hardware/omrRelay.test.mjs`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: a new log event `omr.ingest.nfc_debounced` with `{ clientId, id, uid, sinceMs }`. No signature changes — `createOmrRelay` keeps its existing shape.

- [ ] **Step 1: Write the failing test**

Append inside the existing top-level `describe('createOmrRelay', …)` in `backend/src/3_applications/hardware/omrRelay.test.mjs`, alongside the other `it(...)` blocks. Use the file's existing `wire({ timezone, config })` helper (defined at line 85) — it builds the bus, the temp `dataDir` and the `YamlDayLogDatastore` and returns the bus. Frames are injected with `bus.emit(message)`; broadcasts are inspected via `bus.broadcasts`, an array of `{ topic, payload }`.

```js
  it('broadcasts one nfc event for a bouncing card, not five', async () => {
    const bus = wire();

    // One physical tap that the reader reported five times in ~100ms —
    // the 2026-08-25 incident, replayed.
    for (let i = 0; i < 5; i += 1) {
      bus.emit({
        source: 'omr-relay', type: 'nfc', id: READER_ID,
        uid: '04DB930CCB2A81', piccType: 'NTAG 215',
      });
    }

    const nfcBroadcasts = bus.broadcasts.filter((b) => b.payload?.event === 'nfc');
    expect(nfcBroadcasts).toHaveLength(1);
    expect(nfcBroadcasts[0].payload.uid).toBe('04DB930CCB2A81');
  });

  it('does not suppress a DIFFERENT card tapped immediately after', async () => {
    const bus = wire();

    bus.emit({ source: 'omr-relay', type: 'nfc', id: READER_ID, uid: '04DB930CCB2A81' });
    bus.emit({ source: 'omr-relay', type: 'nfc', id: READER_ID, uid: '048BA600CC2A81' });

    const uids = bus.broadcasts
      .filter((b) => b.payload?.event === 'nfc')
      .map((b) => b.payload.uid);
    expect(uids).toEqual(['04DB930CCB2A81', '048BA600CC2A81']);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run \
  backend/src/3_applications/hardware/omrRelay.test.mjs --config ./vitest.config.mjs
```

Expected: the bouncing-card test FAILS with `expected length 1, received 5`. The different-card test should already PASS (it guards against over-suppression).

- [ ] **Step 3: Declare the broadcast dedup state**

In `omrRelay.mjs`, immediately after the `topics` line (~line 97), add:

```js
  // Dedup for the BROADCAST path. The persist-path guard further down
  // (`lastNfc`) runs in `onPayload`, i.e. AFTER this broadcast has already gone
  // out — so it only ever protected the day-log. Everything that ACTS on a tap
  // (printing an agenda, opening a session) subscribes to the broadcast, which
  // is how one bouncing card produced five receipts and four sessions on
  // 2026-08-25. Keyed per reader AND uid so two different cards presented back
  // to back both get through; only a repeat of the SAME card is suppressed.
  const lastBroadcastNfc = new Map(); // `${id}::${uid}` -> atMs
```

- [ ] **Step 4: Guard the nfc branch**

In the `if (message.type === 'nfc') {` block, after the UID regex validation and **before** the existing `logger.info?.('omr.ingest.nfc', …)` call, insert:

```js
      const dedupKey = `${id}::${uid}`;
      const prevBroadcastMs = lastBroadcastNfc.get(dedupKey);
      const nfcNowMs = Date.now();
      if (prevBroadcastMs !== undefined && nfcNowMs - prevBroadcastMs < dedupWindowMs) {
        // `info`, not `debug`: debug events are never shipped to the log store,
        // and a suppressed tap must remain visible in production.
        logger.info?.('omr.ingest.nfc_debounced', {
          clientId, id, uid, sinceMs: nfcNowMs - prevBroadcastMs,
        });
        return;
      }
      lastBroadcastNfc.set(dedupKey, nfcNowMs);
```

Then correct the now-false comment at lines 162–163. Replace:

```js
    // relay already debounces in hardware (it HLTAs the card, so one physical tap
    // produces exactly one message), so anything arriving here is a real tap.
```

with:

```js
    // The relay was ASSUMED to debounce in hardware (it HLTAs the card, so one
    // physical tap should produce one message). On 2026-08-25 a single tap
    // produced five messages in 103ms, so that assumption is not load-bearing
    // any more — the window below is.
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run \
  backend/src/3_applications/hardware/omrRelay.test.mjs --config ./vitest.config.mjs
```

Expected: PASS, and **all 30 pre-existing tests still pass** (32 total). If any pre-existing persist-path test now fails, the guard was placed in `onPayload` by mistake — it belongs in the ingest handler.

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/hardware/omrRelay.mjs \
        backend/src/3_applications/hardware/omrRelay.test.mjs
git commit -m "fix(omr): dedupe NFC taps on the broadcast path, not just persist

One physical tap reported five times in 103ms produced five agenda prints
and four duplicate sessions on 2026-08-25. The existing per-UID dedup ran
in the persist subscriber, after the broadcast every acting consumer
subscribes to.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Abort timed-out print jobs instead of abandoning them (RC-4)

The 5 s guard is **connect-only** — `clearTimeout` is the first statement in the `device.open` callback. On timeout it calls `resolve(false)` but never destroys the socket. `escpos-network`'s `open()` is a bare `net.Socket.connect` with no connect timeout of its own, so the callback still fires whenever TCP eventually completes — and runs the whole job body against a scratch PNG that `ReceiptPrinting`'s `finally` already deleted. The printer receives headers + footer + cut and no raster: **blank paper, auto-cut, while the caller was told "refused"**.

**Files:**
- Modify: `backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs:650-664`
- Test: `tests/unit/adapters/hardware/thermal-printer/ThermalPrinterAdapter.abort.test.mjs` (create)

**Interfaces:**
- Consumes: `options.createTransport(host, port)` — the injectable transport added by `a89bf7bd8`. Transport contract: `open(cb)`, `write(data, cb)`, `close(cb?)`.
- Produces: a new log event `thermalPrinter.open.after-abort` with `{ target }`. `print()` keeps returning `Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/adapters/hardware/thermal-printer/ThermalPrinterAdapter.abort.test.mjs`:

```js
/**
 * A timed-out job must be ABANDONED, not merely reported (2026-08-25 incident).
 *
 * The timer used to call `resolve(false)` and nothing else. The pending
 * `device.open` stayed live, so when the connection finally landed the whole
 * job body ran — against a scratch PNG that ReceiptPrinting's `finally` had
 * already deleted. The printer got headers + footer + cut and no raster: blank
 * paper, auto-cut, while the caller had been told the print was refused.
 *
 * NOTE ON MOCKING: the transport is INJECTED via `options.createTransport`,
 * never module-mocked. `escpos-network` is CJS and a module mock is silently
 * bypassed — the adapter then opens a REAL socket and prints. See the header of
 * ThermalPrinterAdapter.flush.test.mjs.
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ThermalPrinterAdapter } from '#adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs';

/** A transport whose connect NEVER completes on its own — the test fires it. */
class LateNetwork {
  static instances = [];

  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.writes = [];
    this.closeCount = 0;
    this.openCb = null;
    LateNetwork.instances.push(this);
  }

  open(cb) { this.openCb = cb; return this; }            // deliberately never auto-fires
  write(data, cb) { this.writes.push(data); cb && cb(null); return this; }
  close(cb) { this.closeCount += 1; cb && cb(null, null); return this; }
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const quietLogger = () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() });

/** The adapter waits 500ms between queued jobs before it opens. */
const PAST_QUEUE_DELAY = 800;
const SHORT_TIMEOUT = 300;

function makeAdapter(logger) {
  return new ThermalPrinterAdapter(
    { host: '10.0.0.50', port: 9100, timeout: SHORT_TIMEOUT },
    { logger, createTransport: (host, port) => new LateNetwork(host, port) },
  );
}

const textJob = { items: [{ type: 'text', content: 'hello', align: 'left' }] };

describe('ThermalPrinterAdapter abort-on-timeout contract', () => {
  beforeEach(() => { LateNetwork.instances.length = 0; });

  it('destroys the socket when the connect times out', async () => {
    const adapter = makeAdapter(quietLogger());
    const printing = adapter.print(textJob);

    await expect(printing).resolves.toBe(false);

    const socket = LateNetwork.instances[0];
    expect(socket.closeCount).toBeGreaterThanOrEqual(1);
  });

  it('writes NOTHING if the connect lands after the timeout', async () => {
    const logger = quietLogger();
    const adapter = makeAdapter(logger);
    const printing = adapter.print(textJob);

    expect(await printing).toBe(false);

    // The connection finally lands, long after we gave up.
    const socket = LateNetwork.instances[0];
    socket.openCb(null);
    await settle(200);

    // THE BUG: previously this ran the whole job and cut blank paper.
    expect(socket.writes).toHaveLength(0);
    expect(logger.info).not.toHaveBeenCalledWith(
      'thermalPrinter.job.complete', expect.anything(),
    );
  });

  it('logs the late connect rather than swallowing it', async () => {
    const logger = quietLogger();
    const adapter = makeAdapter(logger);
    await adapter.print(textJob);

    LateNetwork.instances[0].openCb(null);
    await settle(200);

    expect(logger.warn).toHaveBeenCalledWith(
      'thermalPrinter.open.after-abort',
      expect.objectContaining({ target: '10.0.0.50:9100' }),
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
NODE_OPTIONS=--experimental-vm-modules node /opt/Code/DaylightStation/node_modules/jest/bin/jest.js \
  tests/unit/adapters/hardware/thermal-printer/ThermalPrinterAdapter.abort.test.mjs
```

Expected: test 1 FAILS (`closeCount` is 0 — nothing destroys the socket); test 2 FAILS (`writes` has 1 entry — the resurrection); test 3 FAILS (no such log event).

- [ ] **Step 3: Add the abort flag**

In `ThermalPrinterAdapter.mjs`, replace lines 650–664 (`return new Promise((resolve) => { … })` through the `if (error)` block) with:

```js
      return new Promise((resolve) => {
        // A timed-out job must be ABANDONED, not merely reported.
        //
        // This guard covers CONNECT only — `device.open`'s callback clears it.
        // `escpos-network`'s `open()` is a bare `net.Socket.connect` with no
        // connect timeout of its own, so before this flag existed the pending
        // connect stayed live after `resolve(false)`: when it finally landed,
        // the entire job body ran against a scratch PNG that ReceiptPrinting's
        // `finally` had already deleted. The printer got headers + footer + cut
        // and no raster — blank paper, auto-cut, while the caller had been told
        // the print was refused. 2026-08-25 incident.
        //
        // `close()` is a `socket.destroy()`, which also aborts a connect that
        // is still in progress. That is the point: it frees the printer's
        // single connection slot instead of leaving a zombie queued ahead of
        // the next legitimate job.
        let aborted = false;
        const timeoutId = setTimeout(() => {
          aborted = true;
          this.#needsResync = true;
          this.#logger.error?.('thermalPrinter.timeout', { timeout: config.timeout });
          try { device.close(); } catch { /* never connected — nothing to destroy */ }
          resolve(false);
        }, config.timeout);

        device.open(async (error) => {
          clearTimeout(timeoutId);

          if (aborted) {
            // The connect landed after we gave up. Named, not silently dropped:
            // this distinguishes a printer that is merely SLOW from one that is
            // unreachable, and it is the only signal that the timeout is tuned
            // too tight.
            this.#logger.warn?.('thermalPrinter.open.after-abort', {
              target: `${config.host}:${config.port}`,
            });
            try { device.close(); } catch { /* best effort */ }
            return;
          }

          if (error) {
            this.#logger.error?.('thermalPrinter.connect.failed', { error: error.message });
            resolve(false);
            return;
          }
```

Leave the rest of the callback body unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
NODE_OPTIONS=--experimental-vm-modules node /opt/Code/DaylightStation/node_modules/jest/bin/jest.js \
  tests/unit/adapters/hardware/thermal-printer/ThermalPrinterAdapter.abort.test.mjs
```

Expected: 3 passed.

- [ ] **Step 5: Run the whole thermal-printer suite for regressions**

```bash
NODE_OPTIONS=--experimental-vm-modules node /opt/Code/DaylightStation/node_modules/jest/bin/jest.js \
  tests/unit/adapters/hardware/thermal-printer/
```

Expected: all suites pass, including the 8 pre-existing `flush` tests. The flush suite's `MockNetwork.open` fires via `setImmediate`, well inside any timeout, so `aborted` stays false and those paths are untouched.

- [ ] **Step 6: Commit**

```bash
git add backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs \
        tests/unit/adapters/hardware/thermal-printer/ThermalPrinterAdapter.abort.test.mjs
git commit -m "fix(thermal): abort timed-out jobs instead of letting them resurrect

The connect timeout resolved false but never destroyed the socket, so a
late-landing connect ran the whole job against a temp PNG the caller had
already cleaned up — cutting blank paper while reporting a refusal.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Raise the connect timeout (RC-5)

**Do not start this before Task 2 is committed.** Without the abort flag, a longer timeout only widens the window in which abandoned sockets accumulate.

On 2026-08-25 the printer refused new connections for **~11.5 s** after an abrupt close, then accepted three pending connects within 1 ms of each other. A flat 5 s guard cannot survive that. The lockout duration was independent of job size, so the timeout must **not** be derived from payload size.

**Files:**
- Modify: `backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs:136`

**Interfaces:**
- Consumes: the `aborted` flag from Task 2.
- Produces: exported constant `DEFAULT_CONNECT_TIMEOUT_MS = 20000`. Explicit `config.timeout` still wins.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/adapters/hardware/thermal-printer/ThermalPrinterAdapter.abort.test.mjs`:

Test the **behaviour**, not the constant's spelling. `expect(DEFAULT_CONNECT_TIMEOUT_MS).toBe(20000)` is a tautology — export the constant, forget the wiring edit at line 136, and it still passes while the adapter keeps its 5 s default.

```js
describe('connect timeout default', () => {
  it('a default-constructed adapter is still waiting at 10s and has given up by 25s', async () => {
    jest.useFakeTimers();
    try {
      const adapter = new ThermalPrinterAdapter(
        { host: '10.0.0.50', port: 9100 },              // NO explicit timeout
        { logger: quietLogger(), createTransport: (h, p) => new LateNetwork(h, p) },
      );
      const settled = jest.fn();
      const printing = adapter.print(textJob).then(settled);

      await jest.advanceTimersByTimeAsync(10000);
      // Would already have resolved false under the old 5s default.
      expect(settled).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(15000);
      await printing;
      expect(settled).toHaveBeenCalledWith(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('still honours an explicit timeout from config', async () => {
    jest.useFakeTimers();
    try {
      const adapter = new ThermalPrinterAdapter(
        { host: '10.0.0.50', port: 9100, timeout: 250 },
        { logger: quietLogger(), createTransport: (h, p) => new LateNetwork(h, p) },
      );
      const settled = jest.fn();
      const printing = adapter.print(textJob).then(settled);
      await jest.advanceTimersByTimeAsync(1000);   // past the 500ms queue delay + 250ms
      await printing;
      expect(settled).toHaveBeenCalledWith(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
```

> Fake timers, not wall-clock waits: a real 20 s wait per test would put this suite past jest's default timeout, and wall-clock assertions on a host running the whole Docker fleet are flaky by construction.

- [ ] **Step 2: Run to verify it fails**

```bash
NODE_OPTIONS=--experimental-vm-modules node /opt/Code/DaylightStation/node_modules/jest/bin/jest.js \
  tests/unit/adapters/hardware/thermal-printer/ThermalPrinterAdapter.abort.test.mjs
```

Expected: FAIL — `DEFAULT_CONNECT_TIMEOUT_MS` is not exported.

- [ ] **Step 3: Add and use the constant**

Near the other module-level constants at the top of `ThermalPrinterAdapter.mjs`:

```js
/**
 * Connect timeout. 20s, not the old 5s: on 2026-08-25 the printer refused new
 * connections for ~11.5s after an abrupt close, and every job queued behind
 * that window timed out and (before the abort flag) resurrected as blank paper.
 *
 * Deliberately NOT derived from payload size — the observed lockout had nothing
 * to do with how big the job was. This guards CONNECT only; `device.open`'s
 * callback clears it, so a large job's own transfer and drain time is never
 * charged against it.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 20000;
```

Then change line 136 from:

```js
    this.#timeout = config.timeout || 5000;
```

to:

```js
    this.#timeout = config.timeout || DEFAULT_CONNECT_TIMEOUT_MS;
```

- [ ] **Step 4: Run to verify it passes**

```bash
NODE_OPTIONS=--experimental-vm-modules node /opt/Code/DaylightStation/node_modules/jest/bin/jest.js \
  tests/unit/adapters/hardware/thermal-printer/
```

Expected: all pass. Note the `flush` and `raster` suites construct the adapter with an explicit `timeout: 5000`, so they are unaffected.

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs \
        tests/unit/adapters/hardware/thermal-printer/ThermalPrinterAdapter.abort.test.mjs
git commit -m "fix(thermal): raise default connect timeout 5s -> 20s

The printer went unreachable for ~11.5s after an abrupt close on
2026-08-25. Flat, not size-derived: the lockout was independent of job
size. Safe only because timed-out jobs now abort.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Publish the scripture units (O-2)

⚠️ **This task opens with a decision only the user can make. Do not skip it.**

`CurriculumAccess.mjs:108` gates every unit through `isPublishable`, and `curriculum/unitValidation.mjs:414-416` requires `provenance.reviewState === 'approved'`. **All 86 `reviewState` values in the course are `draft`.** Drafts are dropped **silently** ("a draft is not an error"), so the only symptom is the misleading `planner.mjs:98` error `come-follow-me-ot-2026: assigned but no published units belong to it` — 141 warns/day. The units load and validate fine; production's own `invalid-units` event contains zero errors for this course.

**Files:**
- Modify (data, in container): `data/content/school/scripture/come-follow-me-ot-2026/**/*.yml`

**Interfaces:** none — pure data.

- [ ] **Step 1: STOP and confirm the editorial decision**

Ask the user to choose, and do not proceed until they answer:

- **(a) Approve all 86 units** — the course is assigned to two learners and is erroring daily. Choose this if the content has in fact been reviewed.
- **(b) Approve only the near-term weeks** (`35-w35-aug24`, `36-w36-aug31`) and leave the rest draft.
- **(c) Unassign the course** from both learner plans and leave everything draft.

Note for the user: `HANDOFF.md` in the course directory states *"Days 2–5 of week 37 onward are `reviewState: draft`"*, which suggests drafting was **intentional** for later weeks — so **(b)** may match the original authoring intent. This is a content-quality judgement, not an engineering one.

- [ ] **Step 2: Capture the before-state**

```bash
sudo docker exec daylight-station sh -c \
  'grep -rh "reviewState:" data/content/school/scripture/come-follow-me-ot-2026/ | sort | uniq -c'
```

Expected before: `86  reviewState: draft` (85 indented under `provenance:` in lesson files, 1 in a course/module index).

- [ ] **Step 3: Flip reviewState with a line-wise replace**

**Do not YAML-round-trip these files** — a load/dump rewrite reformats the whole document and destroys authoring comments. Targeted line replace only.

⚠️ **The container's `grep` is BusyBox v1.36.1 and does NOT support `--include`** (verified: `grep: unrecognized option: include=*.yml`). A `for f in $(grep -rl … --include=…)` loop silently iterates over **nothing** and the whole step becomes a no-op that reports success. Use `find … -exec grep -l` instead.

⚠️ **Do not back up to flat `/tmp/$(basename $f).bak`** — this course contains **18 files named `_index.yml`**, which would overwrite the same backup 17 times and make any later diff meaningless. Mirror the directory tree.

Scope selection: for option (a) leave `WEEKS` empty to take the whole course; for option (b) set it to the chosen week directories.

```bash
sudo docker exec daylight-station sh -c '
set -e
cd data/content/school/scripture/come-follow-me-ot-2026
# Option (a): WEEKS="."   Option (b): WEEKS="35-w35-aug24 36-w36-aug31"
WEEKS="."
BK=/tmp/cfm-backup
rm -rf "$BK"; mkdir -p "$BK"
find $WEEKS -name "*.yml" -exec grep -l "reviewState: draft" {} + | while read -r f; do
  mkdir -p "$BK/$(dirname "$f")"
  cp "$f" "$BK/$f"
  perl -pi -e "s/^(\s*reviewState:\s*)draft\s*$/\${1}approved\n/" "$f"
  echo "changed: $f"
done
echo "--- files changed: $(find "$BK" -name "*.yml" | wc -l) ---"'
```

- [ ] **Step 4: Verify the change and that nothing else moved**

```bash
# Every reviewState in the chosen scope should now read approved.
sudo docker exec daylight-station sh -c \
  'find data/content/school/scripture/come-follow-me-ot-2026 -name "*.yml" \
     -exec grep -h "reviewState:" {} + | sort | uniq -c'

# Structural sanity: each file must differ from its backup ONLY on reviewState lines.
sudo docker exec daylight-station sh -c '
cd data/content/school/scripture/come-follow-me-ot-2026
BK=/tmp/cfm-backup
find "$BK" -name "*.yml" | while read -r b; do
  f="${b#$BK/}"
  if [ "$(wc -l < "$f")" != "$(wc -l < "$b")" ]; then echo "LINE COUNT CHANGED: $f"; fi
  # Any changed line that is not a reviewState line is a problem.
  diff "$b" "$f" | grep "^[<>]" | grep -v "reviewState:" && echo "UNEXPECTED EDIT: $f"
done; echo "structure check done"'
```

Expected: `approved` across the chosen scope, and **no** `LINE COUNT CHANGED` / `UNEXPECTED EDIT` lines. If anything unexpected appears, restore from `/tmp/cfm-backup` before going further.

- [ ] **Step 5: Restart to clear the config/content cache, then confirm the warning stops**

Household app config and the curriculum catalog are cached in memory at startup, so the change is inert until the container restarts. **Check the deploy gate first** (no active fitness session, no playing video).

```bash
sudo docker restart daylight-station
sleep 45
# Should return ZERO rows for the chosen weeks once units are publishable.
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query=_msg:"school.agenda.plan-errors" AND _time:5m' -d 'limit=10'
```

Expected: no `come-follow-me-ot-2026` plan errors. If they persist, the units are publishable but something else drops them — re-open O-2 rather than flipping more flags.

- [ ] **Step 6: Record the data change**

No `git commit` — this is data-volume content, not repo content. Append a dated line to `docs/_wip/bugs/2026-08-25-school-morning-scan-and-print-incident.md` under O-2 noting which weeks were approved and by whose decision.

---

## Task 5: Quarantine the ghost sessions (RC-3)

Four sessions exist for one learner and one unit; three are phantoms from the concurrent taps and show on the teacher board as ungraded lessons with no linked worksheet.

**Files:**
- Move (data, in container): `data/household/school/records/sessions/2026-08/ses_{AWo4wMn6,jB8pbjSu,kGFmpOVh}.yml`

**Interfaces:** none.

- [ ] **Step 1: Identify which session to KEEP**

`ses_eveClAKh` is the real one — it is the session the learner's panel code resolved against at 08:13:56, and the only one with an issued worksheet (`school-atlas-us-p086-north-dakota-…-ws-ses-eveclakh` in the laser job name at 08:14:00). Confirm before moving anything:

```bash
sudo docker exec daylight-station sh -c \
  'for s in ses_AWo4wMn6 ses_eveClAKh ses_jB8pbjSu ses_kGFmpOVh; do
     echo "=== $s"; cat data/household/school/records/sessions/2026-08/$s.yml; done'
```

Expected: only `ses_eveClAKh` carries issued-document/artifact references. **If more than one does, stop** — the wrong one may have been graded, and this needs a human decision.

- [ ] **Step 2: Move the three phantoms to `_deleteme`**

Never `rm` — `docker exec` runs as root, so a mistake is unrecoverable.

```bash
sudo docker exec daylight-station sh -c '
mkdir -p data/_deleteme/2026-08-25-ghost-sessions
for s in ses_AWo4wMn6 ses_jB8pbjSu ses_kGFmpOVh; do
  mv "data/household/school/records/sessions/2026-08/$s.yml" \
     "data/_deleteme/2026-08-25-ghost-sessions/$s.yml" && echo "moved $s"
done'
```

- [ ] **Step 3: Verify the teacher board**

Reload `/school/teacher` and confirm the learner shows **one** "North Dakota" session, not four.

A session index or roll-up cache may hold the stale count, so do this check **after** Task 4 Step 5's restart — Group A performs both tasks' edits first and then restarts once. Do not add a second restart here.

---

## Task 6: Make the cooldown concurrency-safe and stop suppressed taps minting tokens (RC-2 + L-5)

Two defects in one file. **RC-2:** `execute()` is check-then-act with two `await`s between the cooldown read and the arm, and `nfcTapIngress.mjs:138` dispatches taps without awaiting — so concurrent taps all pass the gate. **L-5:** every *suppressed* tap still mints a live token, because the cooldown check necessarily runs after `buildAgenda.execute` (the fingerprint needs the built agenda).

Fixing only RC-1 leaves this live: `ResolveScanAction.mjs:68-83` also holds `resolvePersonalCard`, so a QR/barcode scan can race an NFC tap for the same learner even with a perfect relay dedup.

**Files:**
- Modify: `backend/src/3_applications/school/usecases/BuildAgenda.mjs` (expose the minted tokens — Step 1)
- Modify: `backend/src/3_applications/school/usecases/ResolvePersonalCard.mjs`
- Modify: `backend/src/5_composition/modules/schoolLifecycle.mjs:789` (wire `tokens`)
- Test: `backend/src/3_applications/school/usecases/ResolvePersonalCard.test.mjs` (create)

**Interfaces:**
- Consumes: `tokens.revoke(token, opts)` from `ITokenRegistry.mjs:96`.
- Produces: `BuildAgenda.execute()` gains a `mintedTokens: string[]` field on its return value (it currently returns `{ learnerId, plan, sections, offers, createdSessions, document }` — verified, there is no token list today). `ResolvePersonalCard.execute({ learnerId })` keeps its signature. New log event `school.card.suppressed-token-revoked` with `{ learnerId, token }`.

- [ ] **Step 1: Expose the minted tokens from BuildAgenda**

`BuildAgenda` mints tokens but never reports which — `accessCodesByToken` is a local that is folded into the document. Revocation needs the list, so return it.

In `BuildAgenda.mjs`, beside the existing `const mintedCodes = new Set();` (line 263), add:

```js
    // The tokens this build actually minted a live access code for. Returned so
    // a caller that ends up NOT printing (a cooldown-suppressed tap) can hand
    // the codes back instead of leaving them live for a receipt nobody holds.
    const mintedTokens = [];
```

Then immediately after the existing line 350:

```js
      if (record.accessCode) accessCodesByToken[record.token] = record.accessCode;
```

add:

```js
      if (record.accessCode) mintedTokens.push(record.token);
```

Finally add `mintedTokens,` to the returned object (beside `createdSessions,` around line 410).

- [ ] **Step 2: Write the failing tests**

Create `backend/src/3_applications/school/usecases/ResolvePersonalCard.test.mjs`:

```js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { ResolvePersonalCard } from './ResolvePersonalCard.mjs';

const NOOP_LOGGER = { warn() {}, info() {}, debug() {}, error() {} };

/** An agenda double whose print is deliberately slow, to open the race window. */
function makeDeps({ printDelayMs = 50 } = {}) {
  const cooldownStore = new Map();
  const printed = [];
  return {
    printed,
    deps: {
      buildAgenda: {
        execute: async ({ learnerId }) => ({
          offers: [{ subject: 'civilization', unitId: 'u1', sessionId: 's1', label: 'L' }],
          createdSessions: [],
          document: { id: `agenda-${learnerId}` },
        }),
      },
      receipts: {
        print: async (doc) => {
          await new Promise((r) => setTimeout(r, printDelayMs));
          printed.push(doc.id);
          return { printed: true, reason: null };
        },
      },
      roster: { displayName: () => 'Learner' },
      cooldown: {
        get: async (id) => cooldownStore.get(id) ?? null,
        put: async (rec) => { cooldownStore.set(rec.learnerId, rec); },
      },
      cooldownMinutes: 15,
      clock: () => new Date('2026-08-25T15:12:30.000Z'),
      logger: NOOP_LOGGER,
    },
  };
}

describe('ResolvePersonalCard concurrency', () => {
  it('prints ONCE when five taps arrive concurrently', async () => {
    const { deps, printed } = makeDeps();
    const card = new ResolvePersonalCard(deps);

    // The 2026-08-25 incident: five unawaited taps for one learner.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => card.execute({ learnerId: 'lrn' })),
    );

    expect(printed).toHaveLength(1);
    expect(results.filter((r) => r.status === 'agenda_printed')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'agenda_suppressed')).toHaveLength(4);
  });

  it('does not serialise DIFFERENT learners against each other', async () => {
    // Concurrency asserted by OVERLAP, not by elapsed wall-clock: a
    // `Date.now() < 120` bound over two 40ms sleeps has ~30ms of headroom on a
    // host running the whole Docker fleet, and would flake for reasons that
    // have nothing to do with this lock.
    let inFlight = 0;
    let maxConcurrent = 0;
    const { deps, printed } = makeDeps();
    deps.receipts.print = async (doc) => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      printed.push(doc.id);
      return { printed: true, reason: null };
    };
    const card = new ResolvePersonalCard(deps);

    await Promise.all([
      card.execute({ learnerId: 'a' }),
      card.execute({ learnerId: 'b' }),
    ]);

    expect(printed).toHaveLength(2);
    expect(maxConcurrent).toBe(2); // genuinely overlapped
  });
});
```

- [ ] **Step 3: Run to verify they fail**

```bash
node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run \
  backend/src/3_applications/school/usecases/ResolvePersonalCard.test.mjs --config ./vitest.config.mjs
```

Expected: the first test FAILS with `printed` length 5 — the exact production defect.

- [ ] **Step 4: Add a per-learner mutex**

**Scope note:** make this an **instance** field (`#inFlightByLearner = new Map();` declared alongside the other private fields), *not* a module-level `const`. A module-scope map is shared by every adapter instance in the process and leaks across test files inside a vitest worker, which makes failures depend on file ordering. One composition root builds one `ResolvePersonalCard`, so an instance field gives the identical production guarantee without the cross-test coupling.

```js
  /**
   * One in-flight resolution per learner.
   *
   * `execute` is check-then-act — it reads the cooldown, then awaits a build
   * and a print, and only then arms the cooldown. Callers do not await it
   * (`nfcTapIngress.mjs:138` dispatches with a bare `Promise.resolve`), so on
   * 2026-08-25 five concurrent taps all passed the gate before any armed it:
   * five prints, four duplicate sessions.
   *
   * Keyed by learner so two children scanning at once still run in parallel.
   */
  #inFlightByLearner = new Map(); // learnerId -> Promise
```

Then wrap the body. Rename the existing `async execute({ learnerId } = {})` to `async #executeInner({ learnerId })`, leaving its body untouched, and add:

```js
  async execute({ learnerId } = {}) {
    if (typeof learnerId !== 'string' || !learnerId.trim()) {
      return this.#executeInner({ learnerId });   // invalid-input path needs no lock
    }
    const prior = this.#inFlightByLearner.get(learnerId) ?? Promise.resolve();
    // Chain rather than reject: a second tap must WAIT and then see the armed
    // cooldown, so it reports `agenda_suppressed` — the honest answer the panel
    // already knows how to acknowledge — instead of failing.
    //
    // The waiter runs #executeInner AFTER the first call completes, so it
    // builds a FRESH agenda and re-reads the now-armed cooldown. That is the
    // whole point: a queued caller must not reuse state captured before the
    // print it was waiting on.
    const run = prior.catch(() => {}).then(() => this.#executeInner({ learnerId }));
    this.#inFlightByLearner.set(learnerId, run);
    try {
      return await run;
    } finally {
      if (this.#inFlightByLearner.get(learnerId) === run) this.#inFlightByLearner.delete(learnerId);
    }
  }
```

- [ ] **Step 5: Run to verify they pass**

```bash
node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run \
  backend/src/3_applications/school/usecases/ResolvePersonalCard.test.mjs --config ./vitest.config.mjs
```

Expected: both PASS.

- [ ] **Step 6: Write the failing test for suppressed-tap token revocation (L-5)**

Append to the same test file.

```js
describe('suppressed taps do not leak live tokens', () => {
  it('revokes the token minted by a suppressed tap', async () => {
    const { deps } = makeDeps();
    const revoked = [];
    deps.tokens = { revoke: async (token) => { revoked.push(token); } };
    // Replace the buildAgenda double so it reports a minted token.
    const base = deps.buildAgenda.execute;
    deps.buildAgenda.execute = async (args) => ({
      ...(await base(args)),
      mintedTokens: ['sch:TESTTOKEN'],
    });

    const card = new ResolvePersonalCard(deps);
    await card.execute({ learnerId: 'lrn' });   // prints, arms cooldown
    await card.execute({ learnerId: 'lrn' });   // suppressed

    expect(revoked).toEqual(['sch:TESTTOKEN']);
  });
});
```

- [ ] **Step 7: Run to verify it fails, then implement**

Run the same vitest command; expect FAIL (`revoked` is empty).

In `#checkCooldown`, immediately before the `return { status: 'agenda_suppressed', … }`, add:

```js
    // A suppressed tap still BUILT an agenda, and building mints a live access
    // code — the check has to run after the build because the fingerprint needs
    // it. Left alone that quietly inflates the pool of live codes for a receipt
    // that never printed (three such tokens on 2026-08-25). Hand them back.
    for (const token of agenda.mintedTokens ?? []) {
      try {
        // `revoke(token, opts)`'s documented option is `{ at }` — an injected
        // ISO time, because the port reads no clock of its own
        // (ITokenRegistry.mjs:99). Do not invent a `reason` field here.
        await this.#tokens?.revoke?.(token, { at: this.#clock().toISOString() });
        this.#logger.info?.('school.card.suppressed-token-revoked', { learnerId, token });
      } catch (err) {
        this.#logger.warn?.('school.card.token-revoke-failed', { learnerId, token, error: err?.message });
      }
    }
```

Add `tokens` to the constructor's destructured deps and store it as `this.#tokens` (declare the private field alongside the others), then wire it in `backend/src/5_composition/modules/schoolLifecycle.mjs` near line 789 where `cooldown: stores.agendaCooldown` is passed.

- [ ] **Step 8: Run the full school application suite**

```bash
node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run \
  backend/src/3_applications/school/ --config ./vitest.config.mjs
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add backend/src/3_applications/school/usecases/ResolvePersonalCard.mjs \
        backend/src/3_applications/school/usecases/ResolvePersonalCard.test.mjs \
        backend/src/5_composition/modules/schoolLifecycle.mjs
git commit -m "fix(school): serialise card resolution per learner; revoke suppressed tokens

execute() was check-then-act with awaits between the cooldown read and
the arm, and callers never await it — so five concurrent taps all passed
the gate. Also hands back the access code minted by a tap that was then
suppressed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: One control per destination in the issued-artifact card (L-2)

`IssuedArtifactCard.jsx` renders **three** controls — the thumbnail (line 27), "Open worksheet" (38) and "Download PDF" (39) — all pointing at the same `url`. The URL is same-origin, so `download` does work; the problem is plain redundancy, not a broken attribute.

**Files:**
- Modify: `frontend/src/modules/School/teacher/panels/IssuedArtifactCard.jsx:37-40`
- Test: `frontend/src/modules/School/teacher/tabs/TodayTab.test.jsx:93-94`

**Interfaces:**
- Consumes: `artifact.originalUrl` / `artifact.originalPdfUrl` / `artifact.thumbnailUrl`.
- Produces: the "Download PDF" / "Download image" link is **removed**. Any test asserting on it must be updated (Step 3).

- [ ] **Step 1: Update the test to the intended contract**

In `frontend/src/modules/School/teacher/tabs/TodayTab.test.jsx`, replace lines 93–94:

```js
    expect(screen.getByRole('link', { name: 'Open worksheet' }).getAttribute('href')).toBe('/issued/illinois.pdf');
    expect(screen.getByRole('link', { name: 'Download PDF' }).getAttribute('download')).toBe('');
```

with:

```js
    // One control per destination: the thumbnail and the text link share a
    // target, and a separate "Download" link pointing at the same URL was pure
    // redundancy (2026-08-25 review).
    expect(screen.getByRole('link', { name: 'Open worksheet' }).getAttribute('href')).toBe('/issued/illinois.pdf');
    expect(screen.queryByRole('link', { name: 'Download PDF' })).toBeNull();
```

- [ ] **Step 2: Run to verify it fails**

```bash
node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run \
  frontend/src/modules/School/teacher/tabs/TodayTab.test.jsx --config ./vitest.config.mjs
```

Expected: FAIL — the Download link still exists.

- [ ] **Step 3: Remove the redundant link**

In `IssuedArtifactCard.jsx`, replace lines 37–40:

```jsx
      <div className="teacher-issued-artifact__actions">
        <a href={url} target="_blank" rel="noreferrer">Open {receipt ? 'receipt' : 'worksheet'}</a>
        <a href={url} download>Download {receipt ? 'image' : 'PDF'}</a>
      </div>
```

with:

```jsx
      <div className="teacher-issued-artifact__actions">
        <a href={url} target="_blank" rel="noreferrer">Open {receipt ? 'receipt' : 'worksheet'}</a>
      </div>
```

The thumbnail anchor above already links to the same `url`, so the destination remains reachable two ways (image and text), which is the intended affordance.

- [ ] **Step 4: Run to verify it passes**

```bash
node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run \
  frontend/src/modules/School/teacher/ --config ./vitest.config.mjs
```

Expected: all pass.

> **Note:** jsdom cannot see layout. If removing the link leaves a visual gap in `.teacher-issued-artifact__actions`, these tests will still pass. Check the rendered board in a browser before considering this done.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/School/teacher/panels/IssuedArtifactCard.jsx \
        frontend/src/modules/School/teacher/tabs/TodayTab.test.jsx
git commit -m "fix(school): drop duplicate Download link from issued-artifact card

Three controls pointed at one URL. The thumbnail and Open link already
cover it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Make `printed: true` mean something (verified print)

Today `#executePrintJob` resolves `true` when our socket buffer flushed and a **drain timer** elapsed (`500 + KB×20` ms). That is a claim about our buffer and a stopwatch — not about paper. Paper-out, cover-open, a jam and a cut failure all yield `printed: true`, and `ResolvePersonalCard` then arms a 15-minute cooldown, so the next scan says "Already printed" when nothing came out.

**Hardware probe results (live printer, 2026-08-25, read-only — no print data sent):**

| Query | Bytes | Reply | Meaning |
|---|---|---|---|
| `DLE EOT 1` printer status | `10 04 01` | `0x16` = `00010110` | bit3=0 → **online**; bit2=1 → **drawer pin**, NOT cover |
| `DLE EOT 2` offline status | `10 04 02` | `0x12` = `00010010` | bit2=0 → cover closed |
| `DLE EOT 3` error status | `10 04 03` | `0x12` | no cutter / unrecoverable / auto-recoverable error |
| `DLE EOT 4` paper sensor | `10 04 04` | `0x12` | bits5,6=0 → **paper present** |
| `GS r 1` buffered paper | `1D 72 01` | **no reply** | unsupported |
| `ESC v` buffered paper | `1B 76` | **no reply** | unsupported |

**Two design consequences, both load-bearing:**

1. The printer supports **neither** buffered status command, so a true end-of-job barrier (a queued query whose reply proves the raster was consumed) **does not exist on this hardware**. This task detects *"the printer cannot print"* — never *"this raster rendered"*. Task 9 exists because of that gap; do not oversell this one.
2. **`#parseStatusResponses` misdecodes `coverOpen` and the healthy printer trips it.** At `ThermalPrinterAdapter.mjs:1085`, case 0 reads `DLE EOT 1` bit 2 (`0x04`) as cover-open. In ESC/POS that bit is the **cash-drawer kick-out pin**; cover-open is `DLE EOT 2` bit 2 only. The live reply `0x16` has bit 2 **set**, so `coverOpen` currently computes to `true` on a perfectly healthy printer. **Gating a pre-flight on the decoder as it stands would refuse every job and stop all printing.** Step 1 fixes this first, and nothing else in this task may land before it.

**Why status reads return nothing today:** `getStatus()` listens with `device.on('data', …)` (line 285) on the `Network` **wrapper**. `escpos-network`'s `open()` attaches a private no-op `'data'` handler to the inner `net.Socket` and never re-emits, so the bytes are swallowed. The library's real reply API is `Network.prototype.read(cb)`. Live proof: `/api/v1/printer/status` returns `rawResponses: []` while a raw socket receives all four replies.

**Files:**
- Modify: `backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs` (`#parseStatusResponses` 1067–1103; `getStatus` 256–312; `#executePrintJob`)
- Modify: `tests/unit/adapters/hardware/thermal-printer/ThermalPrinterAdapter.abort.test.mjs` (Task 2's file — the pre-flight adds a transport instance, so its fixtures must be updated here)
- Test: `tests/unit/adapters/hardware/thermal-printer/ThermalPrinterAdapter.status.test.mjs` (create)

**Interfaces:**
- Produces: `getStatus()` gains `responded: boolean`. `print()` still returns `Promise<boolean>`. New log events `thermalPrinter.status.unreadable`, `thermalPrinter.precheck.refused`.

- [ ] **Step 1: Fix the coverOpen misdecode (do this before anything else)**

In `#parseStatusResponses`, replace the `case 0:` block:

```js
          case 0:
            status.online = (byte & 0x08) === 0;
            status.coverOpen = (byte & 0x04) !== 0;
            break;
```

with:

```js
          case 0:
            status.online = (byte & 0x08) === 0;
            // Bit 2 of DLE EOT 1 is the CASH-DRAWER kick-out pin, not the
            // cover. Reading it as cover-open made a healthy printer report
            // coverOpen:true — the live reply is 0x16, bit 2 set — which would
            // make any pre-flight gate refuse every job. Cover state comes from
            // DLE EOT 2 (case 1) alone.
            break;
```

Case 1 already sets `coverOpen` from `DLE EOT 2`; leave it, but drop its now-pointless `status.coverOpen ||` self-reference:

```js
          case 1:
            status.coverOpen = (byte & 0x04) !== 0;
            break;
```

- [ ] **Step 2: Fix the read API and stop fabricating readings**

In `getStatus()` replace:

```js
          device.on('data', (data) => {
            responses.push(data);
          });
```

with:

```js
          // `Network` inherits EventEmitter but NEVER emits 'data' — its
          // `open()` attaches a private no-op handler to the inner net.Socket
          // and swallows the bytes. `read()` is the library's actual reply API.
          // Measured 2026-08-25: with `on('data')` the four DLE EOT replies are
          // lost and this method returns fabricated defaults.
          device.read((data) => { responses.push(data); });
```

Then, in `#parseStatusResponses`, add to the initial `status` object:

```js
      // Did the printer actually answer? Without this, "no reply" and "offline,
      // no paper" are the same object, and a caller gating on it fails closed
      // for entirely the wrong reason.
      responded: responses.length > 0,
```

- [ ] **Step 3: Route `getStatus` through the injectable transport**

At line 261 replace `const device = new Network(this.#host, this.#port);` with:

```js
    // Was `new Network(...)`, which bypassed the injected transport and made
    // this method untestable without opening a real socket to the printer.
    const device = this.#createTransport(this.#host, this.#port);
```

**This precedes any test run deliberately.** Until it lands, a `getStatus` test connects to the real printer at `10.0.0.50:9100`, violating the global constraint at the top of this plan.

- [ ] **Step 4: Give `getStatus` the same abort discipline as Task 2**

`getStatus`'s timeout (line 264) resolves without destroying the socket — the exact RC-4 defect Task 2 fixes for `print()`. Since this method is about to be called on every job, fix it here or it becomes a new zombie-socket source. Replace:

```js
      const timeoutId = setTimeout(() => {
        resolve({ success: false, error: 'Connection timeout' });
      }, this.#timeout);
```

with:

```js
      let aborted = false;
      const timeoutId = setTimeout(() => {
        aborted = true;
        try { device.close(); } catch { /* never connected */ }
        resolve({ success: false, error: 'Connection timeout', responded: false });
      }, this.#timeout);
```

and make the `device.open` callback return early when `aborted` is true, mirroring Task 2:

```js
      device.open(async (error) => {
        clearTimeout(timeoutId);
        if (aborted) { try { device.close(); } catch { /* best effort */ } return; }
```

- [ ] **Step 5: Write the status test**

Create `tests/unit/adapters/hardware/thermal-printer/ThermalPrinterAdapter.status.test.mjs`:

```js
import { describe, it, expect, jest } from '@jest/globals';
import { ThermalPrinterAdapter } from '#adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs';

/** Replies with the exact bytes the live printer returned on 2026-08-25. */
class StatusNetwork {
  constructor() { this.readCb = null; this.sent = []; }
  open(cb) { setImmediate(() => cb(null)); return this; }
  read(cb) { this.readCb = cb; return this; }
  write(data, cb) {
    this.sent.push([...data]);
    const replies = { 1: 0x16, 2: 0x12, 3: 0x12, 4: 0x12 };
    if (data[0] === 0x10 && data[1] === 0x04) {
      setImmediate(() => this.readCb?.(Buffer.from([replies[data[2]]])));
    }
    cb && cb(null);
    return this;
  }
  close(cb) { cb && cb(null, null); return this; }
}

/** A printer that answers nothing — today's production behaviour. */
class SilentNetwork extends StatusNetwork {
  write(data, cb) { this.sent.push([...data]); cb && cb(null); return this; }
}

const quietLogger = () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() });
const adapterWith = (Transport) => new ThermalPrinterAdapter(
  { host: '10.0.0.50', port: 9100, timeout: 2000 },
  { logger: quietLogger(), createTransport: () => new Transport() },
);

describe('getStatus reads real replies', () => {
  it('reports a HEALTHY printer for the live byte values', async () => {
    const status = await adapterWith(StatusNetwork).getStatus();

    expect(status.responded).toBe(true);
    expect(status.online).toBe(true);
    expect(status.paperPresent).toBe(true);
    // 0x16 has bit 2 SET — the drawer pin. Reading that as cover-open is what
    // would have refused every job on healthy hardware.
    expect(status.coverOpen).toBe(false);
    expect(status.errors).toEqual([]);
  });

  it('reports responded:false rather than inventing "offline, no paper"', async () => {
    const status = await adapterWith(SilentNetwork).getStatus();
    expect(status.responded).toBe(false);
    expect(status.rawResponses).toEqual([]);
  });
});
```

Run — all must pass now that Steps 1–4 have landed:

```bash
NODE_OPTIONS=--experimental-vm-modules node /opt/Code/DaylightStation/node_modules/jest/bin/jest.js \
  tests/unit/adapters/hardware/thermal-printer/ThermalPrinterAdapter.status.test.mjs
```

- [ ] **Step 6: Pre-flight the printer before a job**

In `#executePrintJob`, insert immediately **before** `const device = this.#createTransport(config.host, config.port);` (line 648). `config` is in scope here and the method is already `async`, so the `await` is legal — but note it runs **before** the `return new Promise(...)`, adding one round-trip to every job inside the serialized queue.

```js
      // A job sent to a printer with no paper is silently lost and the caller is
      // told it printed — which then arms a 15-minute "Already printed"
      // cooldown over a receipt nobody holds (2026-08-25).
      //
      // WHAT THIS DOES NOT PROVE: this hardware answers no buffered status
      // command (`GS r`/`ESC v` both silent — probed 2026-08-25), so there is
      // no end-of-job barrier. This detects "the printer CANNOT print", never
      // "this raster rendered". Task 9's override is the cover for the rest.
      const pre = await this.getStatus();
      if (!pre.responded) {
        // Silence is not consent, but it is not proof of failure either — the
        // printer answered every query on 2026-08-25. Warn and continue rather
        // than refusing every job the moment status reads regress.
        this.#logger.warn?.('thermalPrinter.status.unreadable', {
          target: `${config.host}:${config.port}`,
        });
      } else if (!pre.paperPresent || pre.coverOpen || pre.errors.length > 0) {
        this.#logger.error?.('thermalPrinter.precheck.refused', {
          paperPresent: pre.paperPresent, coverOpen: pre.coverOpen, errors: pre.errors,
        });
        return false;
      }
```

**There is no mid-job post-check.** An earlier draft of this plan put a second `getStatus()` inside the `device.open` callback — i.e. a **second concurrent connection** to a printer the diagnosis proved refuses overlapping connects for ~11.5 s. With Task 3's 20 s timeout that would stall every job by up to 20 s from inside the job. If a post-drain check is ever wanted it must come **after** `device.close()`, be advisory-only (log, never flip the result), and be verified on real hardware first.

- [ ] **Step 7: Update Task 2's abort fixtures for the extra transport instance**

The pre-flight consumes one transport before the print transport, so in `ThermalPrinterAdapter.abort.test.mjs` the print socket is now `LateNetwork.instances[1]`, not `[0]`. Left alone, all three Task 2 tests fail — the pre-flight's own socket is what they would be inspecting.

Give that file a status-capable transport so the pre-flight completes and the abort behaviour is still what is under test:

```js
/** Answers status queries; leaves the PRINT connect hanging for the test to fire. */
class LateNetwork {
  static instances = [];
  constructor(host, port) {
    this.host = host; this.port = port;
    this.writes = []; this.closeCount = 0; this.openCb = null; this.readCb = null;
    LateNetwork.instances.push(this);
  }
  open(cb) { this.openCb = cb; return this; }
  read(cb) { this.readCb = cb; return this; }
  write(data, cb) {
    this.writes.push(data);
    if (data[0] === 0x10 && data[1] === 0x04) {
      setImmediate(() => this.readCb?.(Buffer.from([{ 1: 0x16, 2: 0x12, 3: 0x12, 4: 0x12 }[data[2]]])));
    }
    cb && cb(null);
    return this;
  }
  close(cb) { this.closeCount += 1; cb && cb(null, null); return this; }
}

/** The status pre-flight's socket answers at once; the print socket hangs. */
const createTransport = (host, port) => {
  const net = new LateNetwork(host, port);
  if (LateNetwork.instances.length % 2 === 1) setImmediate(() => net.openCb?.(null)); // status
  return net;
};

/** The PRINT transport for the job under test. */
const printSocket = () => LateNetwork.instances[1];
```

Update the three assertions to use `printSocket()` instead of `instances[0]`, and assert on `writes` **excluding** the four DLE EOT query buffers.

- [ ] **Step 8: Run the whole thermal suite, then commit**

```bash
NODE_OPTIONS=--experimental-vm-modules node /opt/Code/DaylightStation/node_modules/jest/bin/jest.js \
  tests/unit/adapters/hardware/thermal-printer/
```

All four suites must pass — `flush`, `raster`, `abort`, `status`. If `flush` or `raster` fail, their mocks lack `read()`, so `getStatus` reports `responded: false` and takes the warn-and-continue branch; that is intended, and any failure there is a real regression, not a fixture artifact.

```bash
git add backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs \
        tests/unit/adapters/hardware/thermal-printer/
git commit -m "fix(thermal): read status replies, correct coverOpen bit, refuse unprintable jobs

getStatus listened on the Network wrapper, which never emits data, so the
printer's DLE EOT replies were swallowed and fabricated defaults returned.
DLE EOT 1 bit 2 is the drawer pin, not the cover — decoding it as cover-open
made a healthy printer look faulted. print() now pre-flights paper, cover
and error state.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
---

## Task 9: Let a repeat tap override the cooldown (the "it came out blank" escape hatch)

Detection is never complete — Task 8 establishes that this hardware cannot prove a raster rendered. So someone holding blank paper needs a way to say so. Today the only bypass is `agendaFingerprint` changing (`ResolvePersonalCard.mjs:175`, "new work bypasses the window"); identical content means a full 15-minute lockout with no recourse. The child's natural gesture is to tap again — which is exactly what happened on 2026-08-25.

⚠️ **The cooldown store silently drops unknown fields, in BOTH directions.** `YamlAgendaCooldownStore` whitelists exactly `learnerId`, `lastAgendaPrintedAt`, `contentHash` on `get` (lines ~71–74) **and** on `put` (lines ~86–88). A `suppressedTaps` counter added only in `ResolvePersonalCard` is stripped on write and again on read, so in production the counter is permanently `undefined` and **the override never fires** — while a unit test backed by a plain `Map` preserves the field and passes green. Step 1 fixes the store first. Without it this task ships a dead feature with a passing test.

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlAgendaCooldownStore.mjs` (both whitelists)
- Modify: `backend/src/3_applications/school/usecases/ResolvePersonalCard.mjs` (`#checkCooldown`, `#armCooldown`)
- Test: `backend/src/1_adapters/persistence/yaml/YamlAgendaCooldownStore.test.mjs` (extend if present, else create)
- Test: `backend/src/3_applications/school/usecases/ResolvePersonalCard.test.mjs` (extend Task 6's file)

**Interfaces:**
- Consumes: the cooldown record from Task 6.
- Produces: cooldown records gain `suppressedTaps: number`. New log event `school.card.cooldown-overridden` with `{ learnerId, tapCount }`.

**⚠️ Insertion order against Task 6.** Both tasks insert into `#checkCooldown` immediately before its `return { status: 'agenda_suppressed', … }`. **The override check must come FIRST.** If Task 6's revoke loop runs above it, an overridden tap revokes the tokens it is about to reprint, and the child gets a receipt carrying dead access codes. Whichever task lands second must place its block accordingly and re-run the other's tests.

- [ ] **Step 1: Persist the counter (store first, or the feature is dead)**

In `YamlAgendaCooldownStore`, add the field to the `get` projection:

```js
        contentHash: typeof raw.contentHash === 'string' ? raw.contentHash : null,
        // Counts taps SUPPRESSED since the last print. The whitelist here and
        // in `put` is deliberate (a hand-edited file must not inject fields),
        // which is exactly why a new field has to be added in both places —
        // omitting either silently discards it and the override never fires.
        suppressedTaps: Number.isFinite(raw.suppressedTaps) ? raw.suppressedTaps : 0,
```

and to the `put` projection:

```js
      contentHash: typeof record.contentHash === 'string' ? record.contentHash : null,
      suppressedTaps: Number.isFinite(record.suppressedTaps) ? record.suppressedTaps : 0,
```

- [ ] **Step 2: Write the failing store test**

This is the test that would have caught the dead feature. It must round-trip through the **real** store, not a `Map`.

```js
  it('round-trips suppressedTaps — a whitelist drop makes the override dead code', async () => {
    const store = new YamlAgendaCooldownStore({ /* same ctor args as sibling tests */ });
    await store.put({
      learnerId: 'lrn', lastAgendaPrintedAt: '2026-08-25T15:00:00.000Z',
      contentHash: 'abc', suppressedTaps: 2,
    });
    const back = await store.get('lrn');
    expect(back.suppressedTaps).toBe(2);
  });

  it('defaults suppressedTaps to 0 for a record written before the field existed', async () => {
    const store = new YamlAgendaCooldownStore({ /* … */ });
    await store.put({ learnerId: 'lrn2', lastAgendaPrintedAt: '2026-08-25T15:00:00.000Z', contentHash: 'abc' });
    const back = await store.get('lrn2');
    expect(back.suppressedTaps).toBe(0);
  });
```

Copy the constructor arguments from the sibling YAML-store tests (they use a `mkdtemp` root); do not invent them.

- [ ] **Step 3: Run to verify it fails**

```bash
node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run \
  backend/src/1_adapters/persistence/yaml/ --config ./vitest.config.mjs
```

Expected: FAIL — `suppressedTaps` comes back `undefined` before Step 1's edit, `0`/`2` after.

- [ ] **Step 4: Write the failing use-case test**

Append to Task 6's `ResolvePersonalCard.test.mjs`. **The `makeDeps` cooldown double must whitelist the same three-plus-one fields as the real store**, or this test can pass while production stays broken:

```js
      cooldown: {
        get: async (id) => cooldownStore.get(id) ?? null,
        put: async (rec) => {
          // Mirrors YamlAgendaCooldownStore's whitelist ON PURPOSE. A double
          // that preserves arbitrary fields is how a dropped field ships green.
          cooldownStore.set(rec.learnerId, {
            learnerId: rec.learnerId,
            lastAgendaPrintedAt: rec.lastAgendaPrintedAt ?? null,
            contentHash: rec.contentHash ?? null,
            suppressedTaps: Number.isFinite(rec.suppressedTaps) ? rec.suppressedTaps : 0,
          });
        },
      },
```

```js
  it('reprints on the third tap inside the window — blank paper needs recourse', async () => {
    const { deps, printed } = makeDeps();
    const card = new ResolvePersonalCard(deps);

    await card.execute({ learnerId: 'lrn' });   // prints, arms
    await card.execute({ learnerId: 'lrn' });   // suppressed (1)
    const third = await card.execute({ learnerId: 'lrn' });

    expect(third.status).toBe('agenda_printed');
    expect(printed).toHaveLength(2);
  });

  it('does not become a print-every-other-tap machine', async () => {
    const { deps, printed } = makeDeps();
    const card = new ResolvePersonalCard(deps);

    // Nine taps in one window: one initial print, one override reprint, and
    // NOTHING else. The window is a budget, not a metronome.
    for (let i = 0; i < 9; i += 1) await card.execute({ learnerId: 'lrn' });

    expect(printed).toHaveLength(2);
  });
```

- [ ] **Step 5: Run to verify it fails**

```bash
node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run \
  backend/src/3_applications/school/usecases/ResolvePersonalCard.test.mjs --config ./vitest.config.mjs
```

Expected: the third-tap test FAILS with `agenda_suppressed`.

- [ ] **Step 6: Implement — one override per window, not a metronome**

The counter must **keep counting past the override**, and `#armCooldown` must not reset it on an override reprint. Resetting to 0 turns the window into "tap twice, get paper," repeatable forever — the exact habit the cooldown exists to unteach.

In `#checkCooldown`, **before** Task 6's revoke block and before the suppressed return:

```js
    const suppressedTaps = (last.suppressedTaps ?? 0) + 1;
    // Exactly one override per window. Two suppressed taps after a print is a
    // person telling us the paper was blank — the one failure mode no status
    // query on this hardware can see (Task 8). A third, fourth, ninth tap is
    // not new information, so the window holds.
    if (suppressedTaps === 2) {
      this.#logger.info?.('school.card.cooldown-overridden', { learnerId, tapCount: suppressedTaps + 1 });
      // Record the spend BEFORE returning, or the reprint's own arm resets it
      // and every second tap prints for the rest of the window.
      await this.#cooldown.put({ ...last, suppressedTaps });
      return null; // fall through to a reprint
    }
    await this.#cooldown.put({ ...last, suppressedTaps });
```

Then in `#armCooldown`, carry the counter across an override reprint rather than zeroing it:

```js
  async #armCooldown(learnerId, agenda, { carrySuppressedTaps = 0 } = {}) {
    try {
      await this.#cooldown.put({
        learnerId,
        lastAgendaPrintedAt: this.#clock().toISOString(),
        contentHash: agendaFingerprint(agenda),
        suppressedTaps: carrySuppressedTaps,
      });
```

and at the call site (`ResolvePersonalCard.mjs:150`) pass the count through so an override-triggered reprint does not hand the learner a fresh budget. Read the current record before arming, or thread the value out of `#checkCooldown` — either is fine, but the second test in Step 4 is what proves you did it.

- [ ] **Step 7: Run both suites, then commit**

```bash
node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run \
  backend/src/3_applications/school/usecases/ResolvePersonalCard.test.mjs \
  backend/src/1_adapters/persistence/yaml/ --config ./vitest.config.mjs
```

```bash
git add backend/src/3_applications/school/usecases/ResolvePersonalCard.mjs \
        backend/src/1_adapters/persistence/yaml/YamlAgendaCooldownStore.mjs \
        backend/src/3_applications/school/usecases/ResolvePersonalCard.test.mjs \
        backend/src/1_adapters/persistence/yaml/YamlAgendaCooldownStore.test.mjs
git commit -m "feat(school): one cooldown override per window for blank paper

The printer cannot prove a raster rendered, so blank paper needs a human
escape hatch. Two suppressed taps means try again — once. Also persists
the counter, which the store's field whitelist would otherwise drop in
both directions, leaving the feature dead behind a green test.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
---

## Task 10: A distinct chime for a perfect score

**This is an unimplemented feature, not a regression.** `buildCeremony` (`useScanCeremony.js:63-77`) maps *every* `scan-graded` to `tone: 'success'` regardless of score, and `scanCeremonySound.js:42-46` defines exactly three patterns — `success`, `warn`, `error`. A 6/6 and a 3/6 are audibly identical. Production confirms it: `school.scan.scan-graded { tone: "success", title: "Scored!" }`. No Home Assistant automation references school, so nothing else was competing to make the sound.

**Files:**
- Modify: `frontend/src/modules/School/selfService/scanCeremonySound.js:42-46`
- Modify: `frontend/src/modules/School/selfService/useScanCeremony.js:63-77`
- Test: `frontend/src/modules/School/selfService/useScanCeremony.test.js` (extend, or create)

**Interfaces:**
- Produces: new tone family `'perfect'`. `buildCeremony` returns `tone: 'perfect'` when `correctCount === totalCount` and `totalCount > 0`. **`playScanCeremonyTone` returns `false` for an unknown tone**, so the pattern must be added or a perfect score plays silence.

- [ ] **Step 1: Write the failing test**

```js
  it('uses the perfect tone for a clean sweep', () => {
    const ceremony = buildCeremony({
      event: 'scan-graded', correctCount: 6, totalCount: 6, timestamp: 1,
    });
    expect(ceremony.tone).toBe('perfect');
    expect(ceremony.detail).toContain('6 of 6');
  });

  it('keeps the ordinary success tone for a partial score', () => {
    const ceremony = buildCeremony({
      event: 'scan-graded', correctCount: 4, totalCount: 6, timestamp: 1,
    });
    expect(ceremony.tone).toBe('success');
  });

  it('does not claim perfection when the score is unknown', () => {
    const ceremony = buildCeremony({ event: 'scan-graded', timestamp: 1 });
    expect(ceremony.tone).toBe('success');
  });
```

`buildCeremony` is currently module-private — export it (or test through the hook) before this will run.

- [ ] **Step 2: Run to verify it fails**

```bash
node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run \
  frontend/src/modules/School/selfService/ --config ./vitest.config.mjs
```

- [ ] **Step 3: Add the tone and the pattern**

In `scanCeremonySound.js`, add to `PATTERNS` (keep the existing three unchanged):

```js
  // perfect — a rising THREE-note arpeggio (660→880→1320). Deliberately an
  // extension of `success` rather than a different instrument: a child should
  // hear "that's the good sound, but more of it", not a new vocabulary item.
  perfect: {
    wave: 'triangle', peak: 0.24,
    notes: [[660, 0, 0.1], [880, 0.09, 0.1], [1320, 0.18, 0.22]],
  },
```

and update the doc comment above `PATTERNS` to list four families.

In `useScanCeremony.js`'s `scan-graded` branch, replace the `return { tone: 'success', … }` with:

```js
      const flawless = hasScore && totalCount > 0 && correctCount === totalCount;
      return {
        tone: flawless ? 'perfect' : 'success',
        title: flawless ? 'Perfect!' : 'Scored!',
        detail: hasScore
          ? `${correctCount} of ${totalCount} right — your sheet is printing.`
          : 'Your sheet is printing.',
        at,
      };
```

Also update the copy table in the header comment — it is the documented contract for this file.

- [ ] **Step 4: Run to verify it passes, then commit**

```bash
node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run \
  frontend/src/modules/School/selfService/ --config ./vitest.config.mjs
```

> jsdom cannot hear audio and will not catch a missing pattern. After deploying, scan a perfect sheet on the Portal and confirm the arpeggio actually plays — `playScanCeremonyTone` returns `false` silently for an unknown tone, and a muted master returns `false` too.

```bash
git add frontend/src/modules/School/selfService/scanCeremonySound.js \
        frontend/src/modules/School/selfService/useScanCeremony.js \
        frontend/src/modules/School/selfService/useScanCeremony.test.js
git commit -m "feat(school): distinct chime and title for a perfect score

Every graded scan played the same success tone regardless of score.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: Show "done for the day" on the portal

**Do Task 4 first and re-verify.** While completion reports `indeterminate`, there is no done-state to render and this task cannot be tested end to end.

**Files:**
- Modify: `frontend/src/modules/School/home/` (the learner card component — locate the card that renders per-learner status on the portal home surface)
- Modify: `frontend/src/modules/School/School.scss`
- Test: alongside the component

**Interfaces:**
- Consumes: `state` from `GET /api/v1/school/lifecycle/learners/{id}/completion` — the same endpoint `useSchoolGameAccess.js:40` already polls. Values seen in production: `complete`, `no_work_today`, `indeterminate`. **Enumerate the full set from `completion.mjs` before writing the test** rather than assuming these three.

- [ ] **Step 1: Confirm the state vocabulary**

Read `backend/src/2_domains/school/completion.mjs` and list every value `state` can take. The green treatment applies to the same set `completionAllowsGames` uses (`useSchoolGameAccess.js:6` — `complete`, `no_work_today`), so the two surfaces agree on what "done" means. If they must differ, say why in a comment.

- [ ] **Step 2: Write the failing test**

Assert the card carries a done modifier class when state is `complete`, and does not when state is `indeterminate`. Follow the existing test style in `frontend/src/modules/School/` — assert on rendered output, not implementation details.

- [ ] **Step 3: Run to verify it fails, implement, re-run**

Add a `--done` modifier class and a green background in `School.scss`, reusing an existing success token rather than a new hex literal.

> **Do not rely on jsdom for the visual result** — it cannot see layout or computed colour. Confirm on the portal after deploying.

- [ ] **Step 4: Commit**

---

## Task 12: Deliver completion changes over WebSocket; demote the poll to a fallback

Today `useSchoolGameAccess.js:5` polls `GET …/completion` every **15 seconds** for every mounted kiosk, forever — to answer a question that changes a few times a day, and still with up to 15 s of lag before games unlock.

⚠️ **Do not build a new signal. One already exists and is running.** `backend/src/3_applications/school/SchoolCompletionBridge.mjs` is constructed and `start()`ed at `schoolLifecycle.mjs:851-856`. It subscribes to `school.session.outcome-recorded`, serializes recomputation per learner (`#enqueue`, so two outcomes cannot land out of order), recomputes completion, and emits **only on a state transition** (`#handle` returns early when `previousState === state`). That is every requirement an earlier draft of this task proposed building from scratch.

**The actual gap is one method call.** The bridge ends with:

```js
this.#eventBus.publish('school.completion.state-observed', { learnerId, studyDate, state, previousState, initial });
```

and `WebSocketEventBus.publish` is documented "Publish event to internal subscribers only" (`WebSocketEventBus.mjs:219-223`) — it never reaches a browser. `broadcast(topic, payload)` (line 328) **calls `publish` first** and then sends to WS clients, so switching the call is strictly additive: every existing internal subscriber keeps working.

**Files:**
- Modify: `backend/src/3_applications/school/SchoolCompletionBridge.mjs` (the `publish` call in `#handle`)
- Modify: `frontend/src/modules/Piano/PianoKiosk/useSchoolGameAccess.js`
- Test: `backend/src/3_applications/school/SchoolCompletionBridge.test.mjs` (extend if present, else create)

**Interfaces:**
- Consumes: `useWebSocketSubscription(filter, callback, deps)` — exists at `frontend/src/hooks/useWebSocket.js:53`, shared and reachable from the Piano module. `filter` is a predicate over the received payload.
- Produces: `school.completion.state-observed` becomes a WS-visible topic. Payload shape is unchanged: `{ learnerId, studyDate, state, previousState, initial }`.

- [ ] **Step 1: Write the failing bridge test**

Assert the bridge reaches WS clients, not just internal subscribers. The existing test file (if present) already has an event-bus double — extend it with a `broadcast` spy rather than inventing a new harness.

```js
  it('broadcasts the transition to WS clients, not just internal subscribers', async () => {
    const broadcasts = [];
    const bus = {
      subscribe: (topic, fn) => { handlers[topic] = fn; return () => {}; },
      publish: () => {},
      broadcast: (topic, payload) => broadcasts.push({ topic, payload }),
    };
    // …construct the bridge with a getCompletion double returning state 'complete',
    // start it, and deliver one `school.session.outcome-recorded` payload…

    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].topic).toBe('school.completion.state-observed');
    expect(broadcasts[0].payload).toMatchObject({ learnerId: 'lrn', state: 'complete' });
  });

  it('still emits nothing when the state has not changed', async () => {
    // Deliver the SAME outcome twice; the second must produce no second emit.
    // This pins the bridge's existing transition-only guard, which the switch
    // to broadcast must not weaken into per-scan chatter on the wire.
  });
```

- [ ] **Step 2: Run to verify it fails**

```bash
node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run \
  backend/src/3_applications/school/ --config ./vitest.config.mjs
```

Expected: FAIL — `broadcasts` is empty; the bridge called `publish`.

- [ ] **Step 3: Switch the emit to broadcast**

In `SchoolCompletionBridge.mjs#handle`, replace `this.#eventBus.publish(` with:

```js
    // `broadcast` publishes internally FIRST and then sends to WS clients
    // (WebSocketEventBus.mjs:328-330), so every existing internal subscriber is
    // unaffected — this only widens the audience to the kiosks, which used to
    // discover the same transition by polling every 15s.
    this.#eventBus.broadcast('school.completion.state-observed', {
```

Also relax the constructor guard at line 27 if it requires only `subscribe`; the bridge now needs `broadcast` too, and a double missing it should fail loudly at construction rather than silently dropping every notification.

- [ ] **Step 4: Subscribe on the kiosk and slow the poll**

In `useSchoolGameAccess.js` change:

```js
const REFRESH_MS = 15000;
```

to:

```js
// The unlock now arrives as a pushed `school.completion.state-observed` event.
// This poll is only a safety net for a dropped frame or a kiosk that mounted
// mid-transition — 15s was a busy-wait for a value that changes a few times a day.
const REFRESH_MS = 180000; // 3 minutes
```

Add the subscription inside the hook, next to the existing effect:

```js
  // Ignore other learners' transitions: several kiosks share this bus, and a
  // sibling finishing their work must not re-fetch (or unlock) on this one.
  const wsFilter = useCallback(
    (data) => data?.topic === 'school.completion.state-observed'
      && data?.payload?.learnerId === learnerId,
    [learnerId],
  );
  useWebSocketSubscription(wsFilter, () => { refresh(); }, [refresh]);
```

**Confirm the received frame's shape before finalising the filter.** `WebSocketEventBus.broadcast` wraps the payload in an envelope (see `WebSocketEventBus.mjs:340`, `const message = {…}`); read those few lines and match the real field names rather than assuming `topic`/`payload`.

> Keep the `requestGeneration` guard (lines 22, 42) intact. A pushed refresh and a polled refresh can now race, and that ref is what stops a slow in-flight response from overwriting a newer one.

- [ ] **Step 5: Run both suites, then commit**

```bash
node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run \
  backend/src/3_applications/school/ frontend/src/modules/Piano/PianoKiosk/ --config ./vitest.config.mjs
```

```bash
git add backend/src/3_applications/school/SchoolCompletionBridge.mjs \
        frontend/src/modules/Piano/PianoKiosk/useSchoolGameAccess.js \
        backend/src/3_applications/school/SchoolCompletionBridge.test.mjs
git commit -m "feat(school): broadcast completion transitions to kiosks; poll 15s -> 3min

The completion bridge already computed transitions correctly but emitted
via publish(), which never leaves the backend. Kiosks discovered unlocks
by polling every 15 seconds.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
---

## Task 13: Print "done for the day" on the result receipt

When the score that just landed is the *last* outstanding work, the receipt should say so — a card below the "Next up" action, congratulating the learner and naming that games are unlocked.

**Do Task 4 and Task 12 first.** Until completion stops returning `indeterminate` there is no done-state to print, and Task 12's step 1 establishes where completion is recomputed after an outcome — which is exactly the value this card needs.

**Files:**
- Modify: `backend/src/2_domains/school/documents/receipts.mjs` — `resultDocument()` at line 446
- Modify: `backend/src/3_applications/school/usecases/CloseSessionOutcome.mjs:349` — the caller that builds the result receipt
- Test: `backend/src/2_domains/school/documents/receipts.test.mjs` (extend if present, else create)

**Interfaces:**
- Consumes: a new optional `dayComplete: boolean` on `resultDocument({ … })`. Default `false`, so every existing caller is unchanged.
- Produces: no new block type — reuse `text()`, as the surrounding code does.

⚠️ **Text blocks are `{ type: 'rich_text', md }`** — the field is **`md`**, not `value` (`receipts.mjs:40`: `const text = (md) => ({ type: 'rich_text', md });`). Asserting on `b.value` joins to empty strings, so a positive assertion fails against a *correct* implementation and the negative one passes vacuously.

⚠️ **There are two callers of `resultDocument`**, not one: `CloseSessionOutcome.mjs:349` and `IssueCorrectedResultReceipt.mjs:28`. Thread `dayComplete` from the first only; the corrected-receipt path is a teacher reprint of an earlier result and must keep the default `false` — re-congratulating someone on a day that has since moved on would be wrong.

- [ ] **Step 1: Write the failing test**

```js
  it('prints a done-for-the-day card when this score closes the day', () => {
    const doc = resultDocument({
      sessionId: 'ses_x', unitTitle: 'North Dakota', result: 'passed',
      percent: 100, actions: [], dayComplete: true,
    });
    // `md`, NOT `value` — text blocks are { type: 'rich_text', md }.
    const printed = doc.blocks.map((b) => b.md ?? '').join('\n');
    expect(printed).toContain("YOU'RE DONE FOR THE DAY");
    // The generic dead-end fallback must NOT also fire — that would read as
    // "you have more to do" directly under "you are finished".
    expect(printed).not.toContain('Scan your card to see what is next.');
  });

  it('does not claim the day is done when work remains', () => {
    const doc = resultDocument({
      sessionId: 'ses_x', unitTitle: 'North Dakota', result: 'passed',
      percent: 100, actions: [], dayComplete: false,
    });
    const printed = doc.blocks.map((b) => b.md ?? '').join('\n');
    expect(printed).not.toContain("YOU'RE DONE FOR THE DAY");
    // Guard the guard: if this ever joins to '' the positive test above would
    // pass for the wrong reason, so prove the projection actually reads text.
    expect(printed).toContain('North Dakota');
  });
```

- [ ] **Step 2: Run to verify it fails**

```bash
node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run \
  backend/src/2_domains/school/documents/ --config ./vitest.config.mjs
```

- [ ] **Step 3: Add the card**

Add `dayComplete = false` to `resultDocument`'s destructured arguments and document it in the JSDoc alongside `result` and `percent`.

Then, immediately **after** the `actions.forEach(…)` loop and **before** the existing `if (!blocks.some((b) => b.type === 'scan_action'))` invariant (~line 520), insert:

```js
  // The last thing on the list just landed. This is the only place the child
  // is holding when it happens, so it is where the day gets closed out —
  // ahead of the dead-end fallback below, which would otherwise tell someone
  // who is finished to go scan for more work.
  if (dayComplete) {
    blocks.push(text("## YOU'RE DONE FOR THE DAY"));
    blocks.push(text('Everything on your list is finished. Games are unlocked.'));
  }
```

Then change the invariant guard so a finished day is not a dead end:

```js
  if (!dayComplete && !blocks.some((b) => b.type === 'scan_action')) {
    blocks.push(text('Scan your card to see what is next.'));
  }
```

- [ ] **Step 4: Thread `dayComplete` from `CloseSessionOutcome` only**

At `CloseSessionOutcome.mjs:349`, pass the completion state through:

```js
      dayComplete: completion?.state === 'complete',
```

Only `complete` — **not** `no_work_today`. A result receipt exists because work was done, so "no work today" cannot honestly apply.

**Timing problem you must solve here, not assume away.** `SchoolCompletionBridge` recomputes completion *asynchronously*, triggered by the `school.session.outcome-recorded` event this very settle publishes — so at the moment the receipt is composed, the bridge's value does not exist yet. Call `getLearnerDayCompletion.execute({ learnerId })` **synchronously** in `CloseSessionOutcome` after the outcome is durably recorded and before building the document. Confirm the outcome is persisted first, or completion will be computed against pre-settle state and the card will never print on the run that earns it.

Leave `IssueCorrectedResultReceipt.mjs:28` at the default — no change, and add a one-line comment there saying why, so the omission reads as a decision rather than an oversight.

- [ ] **Step 5: Run to verify, then commit**

```bash
node /opt/Code/DaylightStation/node_modules/vitest/vitest.mjs run \
  backend/src/2_domains/school/documents/ backend/src/3_applications/school/ --config ./vitest.config.mjs
```

> Verify on real paper before calling this done. The receipt is 576 dots wide and upside-down; a two-line card at the bottom is cheap, but confirm it lands above the cut and is not the first thing torn off.

---

## Execution order

Tasks are numbered by the order they were written, **not** the order to do them. Work this table top to bottom.

Tasks are numbered by the order they were written, **not** the order to do them. Work the groups below in order; within a group, the listed order.

### Group A — data fixes (no build; one container restart at the end)

| Order | Task | Why here |
|---|---|---|
| 1 | **Task 4** — publish the scripture units | **Highest value in the plan.** One data change closes 141 warns/day, the `indeterminate` completion state, the piano games lock, and the portal done-state. A learner scored 100% and stayed locked out. |
| 2 | **Task 5** — quarantine the phantom sessions | Teacher board is wrong right now |

Do the file edits for **both** tasks, then perform **one** restart (Task 4 Step 5) and verify both. Task 5's "sequence these together to avoid a second restart" and Task 4's restart step refer to the *same* restart — that is why they are adjacent here.

**→ Deploy checkpoint A:** none needed. No repo code changed; a restart picks up data.

### Group B — incident fixes (code; ship together)

| Order | Task | Why here |
|---|---|---|
| 3 | **Task 1** — dedupe the NFC broadcast path | Smallest code change; kills the trigger for the whole print cascade |
| 4 | **Task 2** — abort timed-out print jobs | The entire blank-paper story; independent of Task 1 |
| 5 | **Task 3** — flat connect-timeout raise | **Must follow Task 2** |
| 6 | **Task 6** — atomic cooldown, revoke suppressed tokens | `ResolveScanAction` proves Task 1 alone is not enough |
| 7 | **Task 7** — dedupe the issued-artifact controls | User-visible, cheap; frontend, so it needs the same build |

**→ Deploy checkpoint B (required):** run the deploy gate, then build and deploy. Task 7 is a frontend change, so it exists only after a Docker build — a browser check before this step tests the old bundle.

```bash
# Gate FIRST — its own step, never chained to the build.
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
```

Clear means: zero recurring render lines, no `videoState:"playing"`, `sessionActive:false`, `rosterSize:0`. Then:

```bash
./scripts/build-daylight.sh && sudo deploy-daylight
```

Then run the live single-tap verification from the Post-merge section before starting Group C.

### Group C — print reliability (code; ship together)

| Order | Task | Why here |
|---|---|---|
| 8 | **Task 8** — verified print (bit-decode fix, status reads, pre-flight) | Makes `printed: true` mean something |
| 9 | **Task 9** — one cooldown override per window | The escape hatch this hardware's limits make mandatory |

**→ Deploy checkpoint C (required):** gate, build, deploy as in B. Then **print a real receipt** and confirm it still prints — Task 8 gates every job on a status read, and the failure mode if the bit-decode fix is wrong is *nothing prints at all*.

### Group D — completion and celebration (code; ship together)

| Order | Task | Why here |
|---|---|---|
| 10 | **Task 12** — broadcast completion, slow the poll to 3 min | Needs Group A so there is a real state to push |
| 11 | **Task 13** — receipt done-card | Consumes the completion state |
| 12 | **Task 11** — portal done-card | Consumes the same state |
| 13 | **Task 10** — perfect-score chime | Standalone; frontend, so it rides this build |

**→ Deploy checkpoint D (required):** gate, build, deploy. Then verify on the physical surfaces: scan a perfect sheet (chime + "Perfect!"), confirm the portal card turns green, confirm the games unlock **without** waiting 3 minutes, and read a printed receipt for the done-card.

### Hard dependencies

- **2 → 3** — abort before raising the timeout, or a longer timeout only widens the zombie-socket window.
- **Group A → Task 12 → Tasks 11/13** — completion must be real before it can be pushed or printed.
- **Task 8 Step 1 (bit-decode) → every other Task 8 step.** Gating on the current decoder refuses every job.
- **Task 9's override check must be inserted ABOVE Task 6's revoke block** in `#checkCooldown` — see the warning in Task 9.

### Notes on the environment

- No `npm install` is required: every dependency this plan touches (`vitest`, `jest`, `escpos-network`, `js-yaml`) is already installed. If a runner reports a missing module, the worktree's `node_modules` symlink is broken — fix that rather than installing into the worktree.
- Group A's restart happens **before** any code lands, so it cannot disturb in-progress code work. Do not restart mid-Group.

---

## Deferred — not in this plan

| Item | Why deferred |
|---|---|
| **L-4** — two learners have no plan file in `plans/learners/` | Needs curriculum decisions (which courses, which grade band) that only the user can make. Raise it separately; it is why one learner got a blank card. |
| **L-1** — `DOMMatrix is not defined` on worksheet thumbnails | Independent subsystem (PDF rasterisation in Node). Deserves its own plan; the likely fix is a polyfill or a canvas-backed renderer, which needs its own investigation. |
| **O-1** — access-code fingerprint logging | Demoted: ordinary expiry is now the probable cause (7 codes died at 04:00 local that morning, printed on receipts still in the room). Worth doing eventually for diagnosability, not for this incident. |
| **L-3** — portal cannot blank its screen (`fkb_unavailable` ×3) | A device/FullyKiosk reachability problem on the tablet, not a School code defect. Diagnose against the FKB REST endpoint separately; note FKB returns HTTP-200 error envelopes, so check `status:"Error"` rather than the status code. |
| **L-6** — collapse the every-5-minute warn spam | Task 4 removes the larger half. Re-measure before building anything. |

---

## Post-merge verification

- [ ] Deploy gate: confirm no active fitness session and no playing video, then build and `sudo deploy-daylight`.
- [ ] **Live single-tap test** — tap one card on the `study-omr` reader. Confirm in the log store:
  ```bash
  curl -s https://logs.kckern.net/select/logsql/query \
    -d 'query=_msg:"nfc.tap.school_card" OR _msg:"omr.ingest.nfc_debounced" AND _time:5m' -d 'limit=20'
  ```
  Expected: exactly one `nfc.tap.school_card`, one printed receipt, one new session. Any `nfc_debounced` rows confirm the guard is doing real work.
- [ ] Confirm zero `thermalPrinter.timeout` and zero `thermalPrinter.image.notFound` over the following day.
- [ ] Confirm `school.agenda.plan-errors` for `come-follow-me-ot-2026` has stopped.
- [ ] Teacher board shows one session per lesson.
