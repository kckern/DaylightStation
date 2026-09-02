# Printer Job Tracking Implementation Plan (Physical Events, Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Learn whether a print job actually printed, instead of reporting
spooler acceptance as success.

**Architecture:** Extend the existing IPP adapter with `Get-Job-Attributes`,
poll a submitted job to a terminal state, and record that outcome. No new
entities, no migration, no persistence changes, no behaviour change for
callers that ignore the new return field.

**Tech Stack:** Node ESM (`.mjs`), vitest, raw IPP over `fetch`
(`1_adapters/hardware/laser-printer/`).

## Global Constraints

- Backend modules are ESM `.mjs`. Tests live beside source as `*.test.mjs`,
  run under **vitest**. Gate: `npm run test:unit:vitest`; your change must add
  no new failing files to its baseline.
- Never use raw `console.*` — use the injected logger.
- `decodeResponse` returns **every** attribute as an array
  (`(attrs[name] ||= []).push(value)`, `ipp.mjs:219`). `attrs['job-state']` is
  `[9]`, never `9`. Every read of it in this plan indexes `[0]`.
- IPP job states (RFC 8011 §5.3.7): `3` pending, `4` pending-held,
  `5` processing, `6` processing-stopped, `7` canceled, `8` aborted,
  `9` completed. **Terminal: 7, 8, 9.**
- Polling must never make a print fail. A polling error yields
  `indeterminate`; it never throws into the print path.
- `indeterminate` is NOT `failed`. The spec is explicit: "Recording a guess as
  a fact is the defect this whole design exists to end."
- Do NOT deploy. `./scripts/deploy-gate.sh` must pass and a human decides.

## Dependency

**This plan assumes `docs/superpowers/plans/2026-09-01-parked-fixes.md` Task 3
(IPP job-id retention) has landed.** That task makes `#sendIpp` return
`{ok, bytes, copies, jobId}`. If it has not, do Task 3 there first — every task
below needs a job id to poll.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `backend/src/1_adapters/hardware/laser-printer/ipp.mjs` | Add `GET_JOB_ATTRIBUTES` op and the job-request attribute encoder | 1 |
| `backend/src/1_adapters/hardware/laser-printer/ipp.jobAttrs.test.mjs` | Wire-format encoding | 1 |
| `backend/src/1_adapters/hardware/laser-printer/jobState.mjs` | Pure: classify an IPP job-state integer | 2 |
| `backend/src/1_adapters/hardware/laser-printer/jobState.test.mjs` | Classification table | 2 |
| `backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.mjs` | `getJobState`, `awaitJobOutcome`, and wiring into `printPdf` | 3, 4 |
| `backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.jobPolling.test.mjs` | Polling behaviour incl. the indeterminate path | 3, 4 |
| `scripts/probe-printer-jobstate.mjs` | One-shot hardware probe; the Phase 2 gate | 5 |

---

### Task 1: Ask the printer about a job

`OPS` currently defines only `PRINT_JOB`, `VALIDATE_JOB` and
`GET_PRINTER_ATTRIBUTES` (`ipp.mjs:15-19`). There is no operation with which to
ask what became of a job, which is why the last observable event is spooler
acceptance.

`Get-Job-Attributes` (0x0009) needs `printer-uri` plus an integer `job-id` —
`baseAttrs` supplies the first three attributes, and `job-id` is appended.

**Files:**
- Modify: `backend/src/1_adapters/hardware/laser-printer/ipp.mjs:15-19` (OPS), and append one exported function
- Test: `backend/src/1_adapters/hardware/laser-printer/ipp.jobAttrs.test.mjs` (create)

**Interfaces:**
- Consumes: `baseAttrs(printerUri, user)`, `encodeRequest(op, attrs, doc, id)`, `TAGS` (module-private).
- Produces:
  - `OPS.GET_JOB_ATTRIBUTES === 0x0009`
  - `jobAttrsRequest(printerUri, { user, jobId }) -> Array<{tag, name, value}>`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, expect, it } from 'vitest';
import { OPS, baseAttrs, encodeRequest, jobAttrsRequest } from './ipp.mjs';

describe('Get-Job-Attributes request', () => {
  it('exposes the operation code', () => {
    expect(OPS.GET_JOB_ATTRIBUTES).toBe(0x0009);
  });

  it('appends an integer job-id after the standard preamble', () => {
    const attrs = jobAttrsRequest('ipp://p:631/ipp/print', { user: 'daylight', jobId: 42 });
    const base = baseAttrs('ipp://p:631/ipp/print', 'daylight');
    expect(attrs.slice(0, base.length)).toEqual(base);
    const last = attrs[attrs.length - 1];
    expect(last.name).toBe('job-id');
    expect(last.value).toBe(42);
    expect(last.tag).toBe(0x21); // INTEGER
  });

  it('encodes to a well-formed IPP request', () => {
    const body = encodeRequest(
      OPS.GET_JOB_ATTRIBUTES,
      jobAttrsRequest('ipp://p:631/ipp/print', { user: 'daylight', jobId: 42 }),
      null, 7,
    );
    expect(body.readUInt8(0)).toBe(1);              // IPP major
    expect(body.readUInt16BE(2)).toBe(0x0009);      // operation
    expect(body.readUInt32BE(4)).toBe(7);           // request id
    expect(body.includes(Buffer.from('job-id'))).toBe(true);
    expect(body[body.length - 1]).toBe(0x03);       // END tag
  });

  it('refuses a non-integer job id rather than encoding nonsense', () => {
    expect(() => jobAttrsRequest('ipp://p:631/ipp/print', { user: 'u', jobId: null }))
      .toThrow(/job-id/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run backend/src/1_adapters/hardware/laser-printer/ipp.jobAttrs.test.mjs
```

Expected: FAIL — `jobAttrsRequest` is not exported and `OPS.GET_JOB_ATTRIBUTES`
is undefined.

- [ ] **Step 3: Add the operation**

In `ipp.mjs`, extend `OPS`:

```javascript
export const OPS = {
  PRINT_JOB: 0x0002,
  VALIDATE_JOB: 0x0004,
  // RFC 8011 §4.3.4. Without this there is no operation with which to ask what
  // became of a job, so `job-sent` (spooler acceptance) was the last thing
  // anyone could observe.
  GET_JOB_ATTRIBUTES: 0x0009,
  GET_PRINTER_ATTRIBUTES: 0x000b,
};
```

- [ ] **Step 4: Add the request encoder**

Append to `ipp.mjs`, beside `printJobAttrs`:

```javascript
/**
 * Operation attributes for Get-Job-Attributes: the standard preamble plus the
 * job handle the printer assigned at Print-Job time.
 *
 * `job-id` is an INTEGER, so it must carry `TAGS.INTEGER` — `encodeRequest`
 * routes that tag to the int32 encoder and would otherwise write the number as
 * UTF-8 text and the printer would reject the request.
 *
 * @param {string} printerUri
 * @param {{user: string, jobId: number}} params
 * @returns {Array<{tag:number, name:string, value:*}>}
 */
export function jobAttrsRequest(printerUri, { user, jobId }) {
  if (!Number.isInteger(jobId)) {
    throw new Error(`jobAttrsRequest requires an integer job-id, got: ${jobId}`);
  }
  return [
    ...baseAttrs(printerUri, user),
    { tag: TAGS.INTEGER, name: 'job-id', value: jobId },
  ];
}
```

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run backend/src/1_adapters/hardware/laser-printer/ipp.jobAttrs.test.mjs
```

Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/1_adapters/hardware/laser-printer/ipp.mjs \
        backend/src/1_adapters/hardware/laser-printer/ipp.jobAttrs.test.mjs
git commit -m "feat(printer): add the Get-Job-Attributes operation

The adapter had no operation with which to ask what became of a job, so
spooler acceptance was the last observable event."
```

---

### Task 2: Classify a job state

A pure function, separated from the adapter so the state table can be tested
without a printer and so the `indeterminate`-is-not-`failed` rule lives in one
readable place.

**Files:**
- Create: `backend/src/1_adapters/hardware/laser-printer/jobState.mjs`
- Test: `backend/src/1_adapters/hardware/laser-printer/jobState.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `JOB_STATES` — frozen map of name → integer
  - `isTerminal(state: number) -> boolean`
  - `classifyJobState(state: number|null) -> 'completed' | 'failed' | 'pending' | 'unknown'`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, expect, it } from 'vitest';
import { JOB_STATES, isTerminal, classifyJobState } from './jobState.mjs';

describe('IPP job state classification', () => {
  it('names the RFC 8011 states', () => {
    expect(JOB_STATES).toMatchObject({
      pending: 3, pendingHeld: 4, processing: 5, processingStopped: 6,
      canceled: 7, aborted: 8, completed: 9,
    });
  });

  it('treats only canceled, aborted and completed as terminal', () => {
    expect([3, 4, 5, 6].map(isTerminal)).toEqual([false, false, false, false]);
    expect([7, 8, 9].map(isTerminal)).toEqual([true, true, true]);
  });

  it('classifies terminal states', () => {
    expect(classifyJobState(9)).toBe('completed');
    expect(classifyJobState(7)).toBe('failed');
    expect(classifyJobState(8)).toBe('failed');
  });

  it('classifies non-terminal states as pending, not failed', () => {
    expect(classifyJobState(3)).toBe('pending');
    expect(classifyJobState(5)).toBe('pending');
    expect(classifyJobState(6)).toBe('pending');
  });

  it('classifies an absent or unrecognised state as unknown, never failed', () => {
    expect(classifyJobState(null)).toBe('unknown');
    expect(classifyJobState(undefined)).toBe('unknown');
    expect(classifyJobState(99)).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run backend/src/1_adapters/hardware/laser-printer/jobState.test.mjs
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```javascript
/**
 * IPP job states (RFC 8011 §5.3.7) and what they mean to us.
 *
 * Pure and separate from the adapter so the table is testable without a
 * printer, and so ONE rule lives in one readable place: a state we could not
 * read is `unknown`, never `failed`. A printer that stops answering has not
 * told us the sheet failed to print — reporting that as failure is the same
 * class of mistake as reporting spooler acceptance as success.
 */
export const JOB_STATES = Object.freeze({
  pending: 3,
  pendingHeld: 4,
  processing: 5,
  processingStopped: 6,
  canceled: 7,
  aborted: 8,
  completed: 9,
});

const TERMINAL = Object.freeze(new Set([
  JOB_STATES.canceled, JOB_STATES.aborted, JOB_STATES.completed,
]));

/** @param {number} state */
export function isTerminal(state) {
  return TERMINAL.has(state);
}

/**
 * @param {number|null|undefined} state
 * @returns {'completed'|'failed'|'pending'|'unknown'}
 */
export function classifyJobState(state) {
  if (state === JOB_STATES.completed) return 'completed';
  if (state === JOB_STATES.canceled || state === JOB_STATES.aborted) return 'failed';
  if (state === JOB_STATES.pending || state === JOB_STATES.pendingHeld
      || state === JOB_STATES.processing || state === JOB_STATES.processingStopped) {
    return 'pending';
  }
  return 'unknown';
}

export default { JOB_STATES, isTerminal, classifyJobState };
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run backend/src/1_adapters/hardware/laser-printer/jobState.test.mjs
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/hardware/laser-printer/jobState.mjs \
        backend/src/1_adapters/hardware/laser-printer/jobState.test.mjs
git commit -m "feat(printer): classify IPP job states

One rule in one place: a state we could not read is unknown, never failed."
```

---

### Task 3: Read one job's state from the printer

**Files:**
- Modify: `backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.mjs` (add a public method; extend the `ipp.mjs` import to include `jobAttrsRequest`)
- Test: `backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.jobPolling.test.mjs` (create)

**Interfaces:**
- Consumes: `OPS.GET_JOB_ATTRIBUTES`, `jobAttrsRequest` (Task 1); `classifyJobState` (Task 2); the private `#ipp(operation, attrs, document, timeoutMs)`.
- Produces: `getJobState(jobId) -> Promise<{state: number|null, classification: string, stateReasons: string[], impressionsCompleted: number|null}>`

- [ ] **Step 1: Write the failing test**

Stub `fetch`, because `#ipp` posts through it (`LaserPrinterAdapter.mjs:187`).

```javascript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LaserPrinterAdapter } from './LaserPrinterAdapter.mjs';

/** Build an IPP response carrying one job-attributes group. */
function ippJobResponse({ state, reasons = ['none'], impressions = 1 }) {
  const parts = [Buffer.from([0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01])];
  parts.push(Buffer.from([0x02])); // job-attributes group
  const attr = (tag, name, valueBuf) => Buffer.concat([
    Buffer.from([tag]),
    (() => { const b = Buffer.alloc(2); b.writeUInt16BE(name.length); return b; })(),
    Buffer.from(name),
    (() => { const b = Buffer.alloc(2); b.writeUInt16BE(valueBuf.length); return b; })(),
    valueBuf,
  ]);
  const int32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
  parts.push(attr(0x23, 'job-state', int32(state)));                       // ENUM
  for (const r of reasons) parts.push(attr(0x44, 'job-state-reasons', Buffer.from(r)));
  parts.push(attr(0x21, 'job-impressions-completed', int32(impressions))); // INTEGER
  parts.push(Buffer.from([0x03]));
  return Buffer.concat(parts);
}

function stubFetch(buffer) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => buffer.buffer.slice(
      buffer.byteOffset, buffer.byteOffset + buffer.byteLength,
    ),
  }));
}

afterEach(() => { delete globalThis.fetch; });

describe('getJobState', () => {
  it('reads a completed job', async () => {
    stubFetch(ippJobResponse({ state: 9, reasons: ['job-completed-successfully'], impressions: 1 }));
    const adapter = new LaserPrinterAdapter({ host: '127.0.0.1', port: 631 });
    await expect(adapter.getJobState(42)).resolves.toEqual({
      state: 9,
      classification: 'completed',
      stateReasons: ['job-completed-successfully'],
      impressionsCompleted: 1,
    });
  });

  it('reads a still-processing job as pending', async () => {
    stubFetch(ippJobResponse({ state: 5, reasons: ['job-printing'], impressions: 0 }));
    const adapter = new LaserPrinterAdapter({ host: '127.0.0.1', port: 631 });
    const result = await adapter.getJobState(42);
    expect(result.classification).toBe('pending');
    expect(result.state).toBe(5);
  });
});
```

If `LaserPrinterAdapter`'s constructor requires more than `{host, port}`, read
it and supply the minimum it demands — do not change the constructor.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.jobPolling.test.mjs
```

Expected: FAIL — `adapter.getJobState is not a function`.

- [ ] **Step 3: Add the method**

Extend the existing `ipp.mjs` import to include `jobAttrsRequest`, add
`import { classifyJobState } from './jobState.mjs';`, then add:

```javascript
  /**
   * What the printer says about one job. Read-only; never throws into a print
   * path — an unreadable answer is `classification: 'unknown'`, because "the
   * printer stopped answering" is not "the sheet failed to print".
   *
   * @param {number} jobId
   */
  async getJobState(jobId) {
    const { ok, attrs } = await this.#ipp(
      OPS.GET_JOB_ATTRIBUTES,
      jobAttrsRequest(this.printerUri, { user: 'daylight', jobId }),
      null,
      this.#timeout,
    );
    // Every attribute decodes as an array (ipp.mjs:219).
    const state = ok && Number.isInteger(attrs?.['job-state']?.[0])
      ? attrs['job-state'][0]
      : null;
    return {
      state,
      classification: classifyJobState(state),
      stateReasons: attrs?.['job-state-reasons'] ?? [],
      impressionsCompleted: Number.isInteger(attrs?.['job-impressions-completed']?.[0])
        ? attrs['job-impressions-completed'][0]
        : null,
    };
  }
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.jobPolling.test.mjs
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.mjs \
        backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.jobPolling.test.mjs
git commit -m "feat(printer): read a job's state from the printer"
```

---

### Task 4: Poll to a terminal state, and report the outcome

**Files:**
- Modify: `backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.mjs`
- Test: `backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.jobPolling.test.mjs` (extend)

**Interfaces:**
- Consumes: `getJobState(jobId)` (Task 3); `isTerminal` (Task 2).
- Produces: `awaitJobOutcome(jobId, { deadlineMs = 30000, intervalMs = 1000, sleep }) -> Promise<{outcome: 'completed'|'failed'|'indeterminate', state, stateReasons, impressionsCompleted, polls}>`

- [ ] **Step 1: Write the failing tests**

Append to the same test file. Inject `sleep` so tests do not wait in real time.

```javascript
describe('awaitJobOutcome', () => {
  const noSleep = async () => {};

  it('returns completed once the printer reports a terminal success', async () => {
    const adapter = new LaserPrinterAdapter({ host: '127.0.0.1', port: 631 });
    const states = [5, 5, 9];
    adapter.getJobState = vi.fn(async () => {
      const state = states.shift();
      return {
        state,
        classification: state === 9 ? 'completed' : 'pending',
        stateReasons: [], impressionsCompleted: state === 9 ? 1 : 0,
      };
    });
    const result = await adapter.awaitJobOutcome(42, { deadlineMs: 10000, intervalMs: 1, sleep: noSleep });
    expect(result.outcome).toBe('completed');
    expect(result.polls).toBe(3);
  });

  it('returns failed on an aborted job', async () => {
    const adapter = new LaserPrinterAdapter({ host: '127.0.0.1', port: 631 });
    adapter.getJobState = vi.fn(async () => ({
      state: 8, classification: 'failed', stateReasons: ['job-canceled-by-system'], impressionsCompleted: 0,
    }));
    const result = await adapter.awaitJobOutcome(42, { deadlineMs: 10000, intervalMs: 1, sleep: noSleep });
    expect(result.outcome).toBe('failed');
    expect(result.stateReasons).toEqual(['job-canceled-by-system']);
  });

  it('returns INDETERMINATE, not failed, when the deadline passes without a terminal state', async () => {
    const adapter = new LaserPrinterAdapter({ host: '127.0.0.1', port: 631 });
    adapter.getJobState = vi.fn(async () => ({
      state: 5, classification: 'pending', stateReasons: ['job-printing'], impressionsCompleted: 0,
    }));
    let now = 0;
    const result = await adapter.awaitJobOutcome(42, {
      deadlineMs: 50, intervalMs: 10, sleep: noSleep, clock: () => { now += 10; return now; },
    });
    expect(result.outcome).toBe('indeterminate');
    expect(result.state).toBe(5);
  });

  it('returns INDETERMINATE, not failed, when the printer stops answering', async () => {
    const adapter = new LaserPrinterAdapter({ host: '127.0.0.1', port: 631 });
    adapter.getJobState = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    let now = 0;
    const result = await adapter.awaitJobOutcome(42, {
      deadlineMs: 30, intervalMs: 10, sleep: noSleep, clock: () => { now += 10; return now; },
    });
    expect(result.outcome).toBe('indeterminate');
  });

  it('is indeterminate for a null job id rather than pretending to poll', async () => {
    const adapter = new LaserPrinterAdapter({ host: '127.0.0.1', port: 631 });
    const result = await adapter.awaitJobOutcome(null, { sleep: noSleep });
    expect(result.outcome).toBe('indeterminate');
    expect(result.polls).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.jobPolling.test.mjs
```

Expected: FAIL — `adapter.awaitJobOutcome is not a function`.

- [ ] **Step 3: Implement the poll**

Add `import { classifyJobState, isTerminal } from './jobState.mjs';` (extend the
Task 3 import) and:

```javascript
  /**
   * Poll one job until the printer gives a terminal answer, or the deadline
   * passes.
   *
   * THREE OUTCOMES, DELIBERATELY. `indeterminate` is not `failed`: it means we
   * stopped asking, or the printer stopped answering, and we do not know
   * whether paper came out. Collapsing it into `failed` would prompt a reprint
   * of a sheet that printed — duplicate worksheets bound to different
   * answer-card rows, which is a worse mess than a missing sheet.
   *
   * Never throws. A print that succeeded must not be reported as failed
   * because a status query did.
   *
   * @param {number|null} jobId
   * @param {{deadlineMs?: number, intervalMs?: number, sleep?: Function, clock?: Function}} [options]
   */
  async awaitJobOutcome(jobId, options = {}) {
    const {
      deadlineMs = 30000,
      intervalMs = 1000,
      sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
      clock = () => Date.now(),
    } = options;

    const base = { state: null, stateReasons: [], impressionsCompleted: null, polls: 0 };
    // JetDirect has no job handle, and a dropped id is a bug elsewhere. Either
    // way, say we do not know rather than poll something meaningless.
    if (!Number.isInteger(jobId)) return { ...base, outcome: 'indeterminate' };

    const started = clock();
    let polls = 0;
    let last = base;
    while (clock() - started < deadlineMs) {
      polls += 1;
      try {
        const observed = await this.getJobState(jobId);
        last = { ...observed, polls };
        if (isTerminal(observed.state)) {
          return { ...last, outcome: observed.classification };
        }
      } catch {
        // Swallowed on purpose: an unreachable printer is an unknown outcome,
        // not a failed print.
        last = { ...last, polls };
      }
      await sleep(intervalMs);
    }
    return { ...last, polls, outcome: 'indeterminate' };
  }
```

- [ ] **Step 4: Run to verify they pass**

```bash
npx vitest run backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.jobPolling.test.mjs
```

Expected: PASS (7 tests total in the file).

- [ ] **Step 5: Record the outcome after every print**

Find `printPdf`'s return point (the one that awaits `#sendIpp`) and, after it
resolves, add:

```javascript
    // The point of Phase 1: say what the printer did, not merely that it took
    // the bytes. `job-sent` remains the acceptance record; this is the outcome.
    const outcome = await this.awaitJobOutcome(sent.jobId);
    this.#logger.info?.('laser-printer.job-outcome', {
      host: this.#host, jobName, jobId: sent.jobId,
      outcome: outcome.outcome, state: outcome.state,
      stateReasons: outcome.stateReasons, polls: outcome.polls,
      impressionsCompleted: outcome.impressionsCompleted,
    });
    return { ...sent, outcome: outcome.outcome, jobState: outcome.state };
```

Rename `sent` to whatever the existing local is called. Existing callers read
`{ok, bytes, copies}` and are unaffected by the added keys.

- [ ] **Step 6: Run the gate**

```bash
npm run test:unit:vitest 2>&1 | tail -5
```

Expected: no new failing files. If a `printPdf` test asserts a strict object
shape it will now fail — update it; the added fields are intended.

- [ ] **Step 7: Commit**

```bash
git add backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.mjs \
        backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.jobPolling.test.mjs
git commit -m "feat(printer): poll a job to a terminal state and record the outcome

Three outcomes, deliberately: completed, failed, and indeterminate. The last
means we stopped asking or the printer stopped answering -- not that the sheet
failed. Collapsing it into failure would prompt a reprint of a sheet that
printed."
```

---

### Task 5: Probe the real printer — the Phase 2 gate

The spec requires this before Phase 2 is designed in detail: *"this device has
three times demonstrated that its capability declarations do not bind its
behaviour... AirPrint-class printers often purge completed jobs quickly; if
`completed` proves unobservable, `indeterminate` becomes the steady state and
the Portal retry affordance in Phase 2 must be reconsidered."*

This costs one sheet of paper and answers the question.

**Files:**
- Create: `scripts/probe-printer-jobstate.mjs`

**Interfaces:**
- Consumes: `LaserPrinterAdapter` (Tasks 3–4).
- Produces: a printed report. No code depends on it.

- [ ] **Step 1: Write the probe**

```javascript
#!/usr/bin/env node
/**
 * One-shot hardware probe: print a single minimal page and report the job-state
 * sequence the printer actually exposes.
 *
 * Not a test — a question to the hardware. Phase 2 of the physical-events
 * design depends on the answer: if a terminal state is never observed, then
 * `indeterminate` is the steady state and the Portal retry affordance in that
 * phase must be reconsidered rather than built.
 *
 *   node scripts/probe-printer-jobstate.mjs <printer-host>
 */
import { LaserPrinterAdapter } from '../backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.mjs';

const host = process.argv[2];
if (!host) {
  console.error('usage: node scripts/probe-printer-jobstate.mjs <printer-host>');
  process.exit(2);
}

// Smallest legal one-page PDF, inline so the probe needs no fixture file.
const PDF = Buffer.from(
  '%PDF-1.4\n'
  + '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
  + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
  + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n'
  + 'trailer<</Root 1 0 R>>\n', 'utf8',
);

const adapter = new LaserPrinterAdapter({ host, port: 631 });
const sent = await adapter.printPdf(PDF, { jobName: 'daylight-jobstate-probe' });
process.stdout.write(`submitted: jobId=${sent.jobId}\n`);
if (!Number.isInteger(sent.jobId)) {
  process.stdout.write('VERDICT: printer returned no job-id. Polling is impossible.\n');
  process.exit(1);
}

const observed = [];
const started = Date.now();
while (Date.now() - started < 60000) {
  try {
    const s = await adapter.getJobState(sent.jobId);
    observed.push(`${Date.now() - started}ms state=${s.state} (${s.classification}) reasons=${s.stateReasons.join(',')}`);
    if (['completed', 'failed'].includes(s.classification)) break;
  } catch (err) {
    observed.push(`${Date.now() - started}ms QUERY FAILED: ${err.message}`);
  }
  await new Promise((r) => { setTimeout(r, 1000); });
}

process.stdout.write(`${observed.join('\n')}\n`);
const sawTerminal = observed.some((line) => /\((completed|failed)\)/.test(line));
process.stdout.write(sawTerminal
  ? 'VERDICT: terminal state observable. Phase 2 may rely on job outcomes.\n'
  : 'VERDICT: no terminal state within 60s. `indeterminate` is the steady state — '
    + 'Phase 2 retry affordance must be reconsidered before it is built.\n');
```

- [ ] **Step 2: Confirm nobody is mid-print, then run it**

```bash
./scripts/deploy-gate.sh    # not a deploy — it also tells you if a child is at the Portal
node scripts/probe-printer-jobstate.mjs <printer-host>
```

Take the printer host from `CLAUDE.local.md` / the school print config; do not
guess it and do not ARP-scan for it.

- [ ] **Step 3: Record the verdict in the spec**

Append the probe output verbatim under a new `## Phase 1 hardware finding`
heading in
`docs/superpowers/specs/2026-09-01-school-physical-events-design.md`, followed
by one sentence saying what it means for Phase 2. Verbatim matters: this is the
evidence a future reader will weigh, and a paraphrase of a printer's behaviour
is exactly the kind of second-hand claim that misled this project once already.

- [ ] **Step 4: Commit**

```bash
git add scripts/probe-printer-jobstate.mjs \
        docs/superpowers/specs/2026-09-01-school-physical-events-design.md
git commit -m "feat(printer): probe real job-state observability, record the verdict

Phase 2 depends on whether this printer exposes a terminal job state at all.
Asked it, rather than assuming."
```

---

## After all tasks

- [ ] Full gate, no new failures versus baseline:

```bash
npm run test:unit:vitest 2>&1 | grep -E "NEW failing|tests —"
```

- [ ] **Do not deploy.** Run `./scripts/deploy-gate.sh` and report the result; a
  human decides whether to build and swap. A redeploy takes the app down ~45s
  and the gate blocks while a child is at the Portal.

- [ ] Report the Task 5 verdict explicitly. It is the input to planning Phase 2.

## Not in this plan

- **Phase 2** — impressions, scans, the combined receipt, the migration,
  `deferReceiptTo`, the bulk partition. Deliberately unplanned until Task 5
  answers whether job outcomes are observable.
- **Phase 3** — card decision records. Its `markDelivered` half is Task 1 of
  `2026-09-01-parked-fixes.md`; the point-in-time decision record builds on the
  `cardOrigin` field that task introduces, so it should be planned after it
  lands.
- **Persisting outcomes.** Phase 1 records the outcome as a structured log
  event only. The durable home for it is the impression record in Phase 2;
  inventing a second one here would be the `jobs.yml` mistake again.
