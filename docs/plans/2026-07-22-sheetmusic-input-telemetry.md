# SheetMusic Input Telemetry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Capture every MIDI input, tap, touch, and UI intent in the sheet-music player at full fidelity, buffered so it costs no frames on the SM-T590, and persist it to a compact per-session `.events` file that can be replayed frame-by-frame.

**Architecture:** A zero-allocation ring-buffer recorder (`inputRecorder.js`) collects raw inputs into preallocated typed arrays on the hot path; a 1s idle-time drain encodes batches and ships them over a `channel:'input'` WS frame to a new backend `sessionEventsFile.mjs` transport that stream-writes them, bypassing the semantic `.jsonl` dispatcher. Tap points: MIDI via `subscribeRaw`, touch/UI via passive listeners in `ScorePlayer`, renders via existing `reportRender`.

**Tech Stack:** Vanilla JS typed arrays (`Float64Array`/`Uint8Array`/`Int32Array`), the existing DaylightLogger WS transport (`frontend/src/lib/logging/index.js`), Node `fs.createWriteStream`, Vitest for tests.

**Design doc:** `docs/_wip/plans/2026-07-22-sheetmusic-input-telemetry.md`

**How to run a single test:** `npx vitest run <path-to-test> --reporter=dot`

**Commit discipline:** This is an isolated feature branch (`feature/sheetmusic-input-telemetry`) — commit after each task's tests pass. Per-task auto-commits are fine here (see memory `feedback_commit_policy_feature_branches`).

---

## Task 1: Ring-buffer core — `record()` writes numeric slots, wraps, counts drops

**Files:**
- Create: `frontend/src/lib/logging/inputRecorder.js`
- Test: `frontend/src/lib/logging/inputRecorder.test.js`

The recorder is a module singleton holding preallocated typed arrays. `record(kind, a, b, c, d)` writes 6 slots and bumps a head. At capacity it wraps (overwriting oldest) and increments `dropped`. No allocation, no `JSON`, no `Date`, no `console` on this path.

**Step 1: Write the failing test**

```js
// frontend/src/lib/logging/inputRecorder.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { __resetRecorder, record, __snapshotForTest, CAPACITY } from './inputRecorder.js';

describe('inputRecorder ring buffer', () => {
  beforeEach(() => __resetRecorder());

  it('records a single event into the ring', () => {
    record(1, 72, 88, 112, 0); // MIDI_ON note=72 vel=88 step=112
    const snap = __snapshotForTest();
    expect(snap.count).toBe(1);
    expect(snap.dropped).toBe(0);
    expect(snap.records[0]).toMatchObject({ kind: 1, a: 72, b: 88, c: 112, d: 0 });
    expect(typeof snap.records[0].t).toBe('number');
  });

  it('wraps at CAPACITY and counts drops without throwing', () => {
    for (let i = 0; i < CAPACITY + 5; i++) record(5, i, 0, 0, 0);
    const snap = __snapshotForTest();
    expect(snap.dropped).toBe(5);
    // oldest 5 were overwritten; newest record's `a` is CAPACITY+4
    expect(snap.records[snap.records.length - 1].a).toBe(CAPACITY + 4);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/lib/logging/inputRecorder.test.js --reporter=dot`
Expected: FAIL — "Failed to resolve import ./inputRecorder.js" / functions undefined.

**Step 3: Write minimal implementation**

```js
// frontend/src/lib/logging/inputRecorder.js
export const CAPACITY = 16384;

const t = new Float64Array(CAPACITY);
const kind = new Uint8Array(CAPACITY);
const a = new Int32Array(CAPACITY);
const b = new Int32Array(CAPACITY);
const c = new Int32Array(CAPACITY);
const d = new Int32Array(CAPACITY);

let head = 0;      // next write index
let count = 0;     // valid records (<= CAPACITY)
let dropped = 0;   // records overwritten before a drain read them

const now = () =>
  (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

// Hot path: 6 array writes + index math. No allocation.
export function record(k, s0 = 0, s1 = 0, s2 = 0, s3 = 0) {
  const i = head;
  t[i] = now();
  kind[i] = k;
  a[i] = s0 | 0; b[i] = s1 | 0; c[i] = s2 | 0; d[i] = s3 | 0;
  head = (head + 1) % CAPACITY;
  if (count < CAPACITY) count += 1;
  else dropped += 1; // buffer full: we just overwrote an undrained record
}

export function __resetRecorder() {
  head = 0; count = 0; dropped = 0;
}

// Test-only linearized view, oldest-first.
export function __snapshotForTest() {
  const records = [];
  const start = count < CAPACITY ? 0 : head;
  for (let n = 0; n < count; n++) {
    const i = (start + n) % CAPACITY;
    records.push({ t: t[i], kind: kind[i], a: a[i], b: b[i], c: c[i], d: d[i] });
  }
  return { count, dropped, records };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/lib/logging/inputRecorder.test.js --reporter=dot`
Expected: PASS (2 tests).

**Step 5: Commit**

```bash
git add frontend/src/lib/logging/inputRecorder.js frontend/src/lib/logging/inputRecorder.test.js
git commit -m "feat(piano): input-recorder ring buffer core"
```

---

## Task 2: String-intern table — non-numeric values become integer ids

**Files:**
- Modify: `frontend/src/lib/logging/inputRecorder.js`
- Test: `frontend/src/lib/logging/inputRecorder.test.js`

Control names ("loop-toggle") and score ids must not touch the hot path as strings. `intern(str)` returns a stable integer; the id→string map ships once in the drain header.

**Step 1: Write the failing test**

```js
// append to inputRecorder.test.js
import { intern, __internTableForTest } from './inputRecorder.js';

describe('string intern table', () => {
  beforeEach(() => __resetRecorder());

  it('returns stable ids and is idempotent', () => {
    const a1 = intern('loop-toggle');
    const a2 = intern('loop-toggle');
    const b1 = intern('tempo-');
    expect(a1).toBe(a2);
    expect(b1).not.toBe(a1);
    expect(__internTableForTest()[a1]).toBe('loop-toggle');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/lib/logging/inputRecorder.test.js --reporter=dot`
Expected: FAIL — `intern` is not exported.

**Step 3: Write minimal implementation**

```js
// add to inputRecorder.js
const internMap = new Map(); // string -> id
const internList = [];       // id -> string

export function intern(str) {
  let id = internMap.get(str);
  if (id === undefined) {
    id = internList.length;
    internList.push(str);
    internMap.set(str, id);
  }
  return id;
}

export function __internTableForTest() {
  return internList.slice();
}

// extend __resetRecorder():
//   internMap.clear(); internList.length = 0;
```

Update `__resetRecorder` to also clear the intern table.

**Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/lib/logging/inputRecorder.test.js --reporter=dot`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add frontend/src/lib/logging/inputRecorder.js frontend/src/lib/logging/inputRecorder.test.js
git commit -m "feat(piano): string-intern table for input recorder"
```

---

## Task 3: Kind registry + encode — numeric records → named-event header + batch

**Files:**
- Modify: `frontend/src/lib/logging/inputRecorder.js`
- Test: `frontend/src/lib/logging/inputRecorder.test.js`

Define the `KIND` enum and an `encodeBatch()` that drains records since the last read into `{ b: [[t,kind,a,b,c,d],...], dropped }`, and a `buildHeader()` that emits the `kinds` + `strings` maps. `encodeBatch` resets `count`/`dropped` for the drained span.

**Step 1: Write the failing test**

```js
// append to inputRecorder.test.js
import { KIND, encodeBatch, buildHeader } from './inputRecorder.js';

describe('encode', () => {
  beforeEach(() => __resetRecorder());

  it('drains records into a numeric batch and clears drop count', () => {
    record(KIND.MIDI_ON, 72, 88, 112, 0);
    record(KIND.MIDI_OFF, 72, 0, 0, 0);
    const batch = encodeBatch();
    expect(batch.b).toHaveLength(2);
    expect(batch.b[0].slice(1)).toEqual([KIND.MIDI_ON, 72, 88, 112, 0]);
    expect(batch.dropped).toBe(0);
    // second drain is empty
    expect(encodeBatch().b).toHaveLength(0);
  });

  it('header maps kind ids to names and includes interned strings', () => {
    intern('loop-toggle');
    const h = buildHeader({ session: 's1', score: 'x.mxl', ctx: {} });
    expect(h.kinds[String(KIND.MIDI_ON)]).toBe('midi.on');
    expect(h.strings).toContain('loop-toggle');
    expect(h.h).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/lib/logging/inputRecorder.test.js --reporter=dot`
Expected: FAIL — `KIND`/`encodeBatch`/`buildHeader` undefined.

**Step 3: Write minimal implementation**

```js
// add to inputRecorder.js
export const KIND = Object.freeze({
  MIDI_ON: 1, MIDI_OFF: 2, SUSTAIN: 3, CC: 4,
  TAP: 5, TOUCH_START: 6, TOUCH_MOVE: 7, TOUCH_END: 8,
  UI_INTENT: 9, RENDER: 10,
});
const KIND_NAME = {
  1: 'midi.on', 2: 'midi.off', 3: 'sustain', 4: 'cc',
  5: 'tap', 6: 'touch.start', 7: 'touch.move', 8: 'touch.end',
  9: 'ui.intent', 10: 'render',
};

// Drain everything currently buffered, oldest-first, and reset. t is left as
// absolute performance.now(); the drain caller subtracts t0 when writing.
export function encodeBatch() {
  const out = [];
  const start = count < CAPACITY ? 0 : head;
  for (let n = 0; n < count; n++) {
    const i = (start + n) % CAPACITY;
    out.push([t[i], kind[i], a[i], b[i], c[i], d[i]]);
  }
  const drained = { b: out, dropped };
  head = 0; count = 0; dropped = 0;
  return drained;
}

export function buildHeader({ session, score, ctx }) {
  return { h: 1, session, score, ctx, kinds: { ...KIND_NAME }, strings: internList.slice() };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/lib/logging/inputRecorder.test.js --reporter=dot`
Expected: PASS (5 tests).

**Step 5: Commit**

```bash
git add frontend/src/lib/logging/inputRecorder.js frontend/src/lib/logging/inputRecorder.test.js
git commit -m "feat(piano): kind registry + batch encoder for input recorder"
```

---

## Task 4: Hot-path allocation guard

**Files:**
- Test: `frontend/src/lib/logging/inputRecorder.test.js`

A regression guard so a future edit can't reintroduce object allocation / `JSON.stringify` into `record()`. We can't count GC directly in JSDOM, so assert the source of `record` contains no `JSON`, no `new `, no `.push(`, no object/array literal.

**Step 1: Write the failing test** (write it to actually pass against Task-1 code, but first make it fail by asserting a stricter condition, then relax — here we write it green since the impl already complies; treat "run and see it green proves the guard works" as the check).

```js
// append to inputRecorder.test.js
import { record as recordFn } from './inputRecorder.js';

describe('hot-path allocation guard', () => {
  it('record() source contains no allocating constructs', () => {
    const src = recordFn.toString();
    expect(src).not.toMatch(/JSON\./);
    expect(src).not.toMatch(/\bnew\s/);
    expect(src).not.toMatch(/\.push\(/);
    expect(src).not.toMatch(/[[{]\s*[a-zA-Z0-9'"]/); // object/array literal
  });
});
```

**Step 2: Run to verify it fails first** — temporarily add `const x = {};` to `record()`, run, confirm FAIL, then remove it.

Run: `npx vitest run frontend/src/lib/logging/inputRecorder.test.js --reporter=dot`
Expected: FAIL while the temporary literal is present; PASS after removing it. This proves the guard has teeth.

**Step 3:** Remove the temporary literal (impl already compliant).

**Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/lib/logging/inputRecorder.test.js --reporter=dot`
Expected: PASS (6 tests).

**Step 5: Commit**

```bash
git add frontend/src/lib/logging/inputRecorder.test.js
git commit -m "test(piano): guard input-recorder hot path against allocation"
```

---

## Task 5: Gesture coalescing helper — moves ≤1 sample/frame into a polyline

**Files:**
- Create: `frontend/src/lib/logging/gestureCoalescer.js`
- Test: `frontend/src/lib/logging/gestureCoalescer.test.js`

Pure (DOM-free) helper. Given a stream of `{t,x,y}` move samples, `coalesce(samples, {frameMs=16})` keeps at most one per `frameMs` window and preserves first + last. Kept pure so it's unit-testable off the DOM; `ScorePlayer` feeds it real pointer events later.

**Step 1: Write the failing test**

```js
// frontend/src/lib/logging/gestureCoalescer.test.js
import { describe, it, expect } from 'vitest';
import { coalesce } from './gestureCoalescer.js';

describe('gesture coalescing', () => {
  it('keeps at most one sample per frame window, preserving endpoints', () => {
    const samples = [
      { t: 0, x: 0, y: 0 },
      { t: 4, x: 1, y: 1 },   // same 16ms window as t=0 -> dropped
      { t: 8, x: 2, y: 2 },   // same window -> dropped
      { t: 20, x: 5, y: 5 },  // new window -> kept
      { t: 100, x: 9, y: 9 }, // last -> always kept
    ];
    const out = coalesce(samples, { frameMs: 16 });
    expect(out[0]).toEqual({ t: 0, x: 0, y: 0 });                 // first kept
    expect(out[out.length - 1]).toEqual({ t: 100, x: 9, y: 9 });  // last kept
    expect(out.length).toBe(3); // t=0, t=20, t=100
  });

  it('returns [] for empty input', () => {
    expect(coalesce([], {})).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/lib/logging/gestureCoalescer.test.js --reporter=dot`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

```js
// frontend/src/lib/logging/gestureCoalescer.js
export function coalesce(samples, { frameMs = 16 } = {}) {
  if (!samples || samples.length === 0) return [];
  if (samples.length === 1) return [samples[0]];
  const out = [samples[0]];
  let windowStart = samples[0].t;
  for (let i = 1; i < samples.length - 1; i++) {
    if (samples[i].t - windowStart >= frameMs) {
      out.push(samples[i]);
      windowStart = samples[i].t;
    }
  }
  out.push(samples[samples.length - 1]); // last always kept
  return out;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/lib/logging/gestureCoalescer.test.js --reporter=dot`
Expected: PASS (2 tests).

**Step 5: Commit**

```bash
git add frontend/src/lib/logging/gestureCoalescer.js frontend/src/lib/logging/gestureCoalescer.test.js
git commit -m "feat(piano): frame-rate gesture coalescer"
```

---

## Task 6: Drain lifecycle — start/stop, idle-time flush, ship over channel:'input'

**Files:**
- Modify: `frontend/src/lib/logging/inputRecorder.js`
- Test: `frontend/src/lib/logging/inputRecorder.test.js`

`startRecorder({ session, score, ctx, send })` sends the header once, then on a 1s timer (wrapped in `requestIdleCallback` when present) calls `encodeBatch()` and, if non-empty, `send({ ...batch, tOffset: t0 })`. `stopRecorder()` does a final flush and clears the timer. `send` is injected so the test needs no WS.

**Step 1: Write the failing test**

```js
// append to inputRecorder.test.js
import { startRecorder, stopRecorder } from './inputRecorder.js';
import { vi } from 'vitest';

describe('drain lifecycle', () => {
  beforeEach(() => __resetRecorder());

  it('sends header once, then flushes batches, then a final flush on stop', () => {
    vi.useFakeTimers();
    const sent = [];
    startRecorder({ session: 's1', score: 'x.mxl', ctx: {}, send: (m) => sent.push(m), flushMs: 1000 });
    expect(sent[0].h).toBe(1); // header first

    record(KIND.TAP, 1, 2, 0, 0);
    vi.advanceTimersByTime(1000);
    expect(sent[1].b).toHaveLength(1); // batch flushed

    record(KIND.TAP, 3, 4, 0, 0);
    stopRecorder();
    expect(sent[sent.length - 1].b).toHaveLength(1); // final flush
    vi.useRealTimers();
  });

  it('does not send an empty batch', () => {
    vi.useFakeTimers();
    const sent = [];
    startRecorder({ session: 's1', score: 'x.mxl', ctx: {}, send: (m) => sent.push(m), flushMs: 1000 });
    vi.advanceTimersByTime(3000);
    expect(sent.filter((m) => Array.isArray(m.b) && m.b.length === 0)).toHaveLength(0);
    stopRecorder();
    vi.useRealTimers();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/lib/logging/inputRecorder.test.js --reporter=dot`
Expected: FAIL — `startRecorder`/`stopRecorder` undefined.

**Step 3: Write minimal implementation**

```js
// add to inputRecorder.js
let drainTimer = null;
let sendFn = null;

export function startRecorder({ session, score, ctx = {}, send, flushMs = 1000 }) {
  __resetRecorder();
  sendFn = send;
  sendFn(buildHeader({ session, score, ctx }));
  const tick = () => {
    const batch = encodeBatch();
    if (batch.b.length > 0) sendFn(batch);
  };
  const scheduled = () => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(tick, { timeout: flushMs });
    else tick();
  };
  drainTimer = setInterval(scheduled, flushMs);
  if (drainTimer && typeof drainTimer.unref === 'function') drainTimer.unref();
}

export function stopRecorder() {
  if (drainTimer) { clearInterval(drainTimer); drainTimer = null; }
  if (sendFn) {
    const batch = encodeBatch();
    if (batch.b.length > 0) sendFn(batch);
  }
  sendFn = null;
}
```

Note for implementer: under fake timers `requestIdleCallback` may be undefined in JSDOM, so the `else tick()` path runs synchronously — matching the test. Keep that fallback.

**Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/lib/logging/inputRecorder.test.js --reporter=dot`
Expected: PASS (8 tests).

**Step 5: Commit**

```bash
git add frontend/src/lib/logging/inputRecorder.js frontend/src/lib/logging/inputRecorder.test.js
git commit -m "feat(piano): input-recorder drain lifecycle"
```

---

## Task 7: Backend — `channel:'input'` routing in ingestion

**Files:**
- Modify: `backend/src/0_system/logging/ingestion.mjs:34-47`
- Test: `tests/unit/system/logging/inputChannelRouting.test.mjs` (create; confirm dir convention with an existing `tests/unit/system/*` test first)

When a normalized event carries `context.channel === 'input'`, route it to the new events-file transport (Task 8) instead of the semantic session file, and do **not** dispatch it to the console/loggly dispatcher.

**Step 1: Write the failing test**

```js
// tests/unit/system/logging/inputChannelRouting.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The routing decision is a pure predicate we extract so it is testable without
// standing up the whole dispatcher.
import { isInputChannel } from '../../../../backend/src/0_system/logging/ingestion.mjs';

describe('input channel routing predicate', () => {
  it('detects the input channel', () => {
    expect(isInputChannel({ context: { channel: 'input' } })).toBe(true);
    expect(isInputChannel({ context: { channel: 'logging' } })).toBe(false);
    expect(isInputChannel({ context: {} })).toBe(false);
    expect(isInputChannel({})).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/system/logging/inputChannelRouting.test.mjs --reporter=dot`
Expected: FAIL — `isInputChannel` not exported.

**Step 3: Write minimal implementation**

In `ingestion.mjs` add and export the predicate, and branch in the loop:

```js
export function isInputChannel(event) {
  return event?.context?.channel === 'input';
}
```

In `ingestFrontendLogs`, inside the `for` loop, before the existing dispatch:

```js
if (isInputChannel(normalized)) {
  const eft = getSessionEventsFileTransport(); // imported from Task 8 module
  if (eft) eft.write(normalized);
  processed++;
  continue; // skip dispatcher + semantic session file
}
```

Add the import at top: `import { getSessionEventsFileTransport } from './transports/sessionEventsFile.mjs';`

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/system/logging/inputChannelRouting.test.mjs --reporter=dot`
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/src/0_system/logging/ingestion.mjs tests/unit/system/logging/inputChannelRouting.test.mjs
git commit -m "feat(logging): route channel:input events past the semantic pipeline"
```

---

## Task 8: Backend — `sessionEventsFile.mjs` stream-writing transport

**Files:**
- Create: `backend/src/0_system/logging/transports/sessionEventsFile.mjs`
- Test: `tests/unit/system/logging/sessionEventsFile.test.mjs`

Mirror `sessionFile.mjs`'s singleton shape, but hold a `fs.createWriteStream` (append) per app and write the header line on `h:1`, batch lines otherwise. No per-event `writeSync`. Files land in `{baseDir}/{app}/{session}.events`.

**Step 1: Write the failing test**

```js
// tests/unit/system/logging/sessionEventsFile.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  initSessionEventsFileTransport,
  getSessionEventsFileTransport,
  resetSessionEventsFileTransport,
} from '../../../../backend/src/0_system/logging/transports/sessionEventsFile.mjs';

let baseDir;
beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'events-'));
  initSessionEventsFileTransport({ baseDir, maxAgeDays: 30 });
});
afterEach(() => { resetSessionEventsFileTransport(); fs.rmSync(baseDir, { recursive: true, force: true }); });

describe('sessionEventsFile transport', () => {
  it('writes a .events file with header then batch lines', () => {
    const t = getSessionEventsFileTransport();
    const app = 'piano-sheetmusic';
    t.write({ event: 'input.header', context: { app, channel: 'input' },
      data: { h: 1, session: '2026-07-22T15-57-08', score: 'x.mxl', ctx: {}, kinds: {}, strings: [] } });
    t.write({ event: 'input.batch', context: { app, channel: 'input' },
      data: { b: [[10, 1, 72, 88, 0, 0]], dropped: 0 } });
    t.flush();

    const file = path.join(baseDir, app, '2026-07-22T15-57-08.events');
    expect(fs.existsSync(file)).toBe(true);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(JSON.parse(lines[0]).h).toBe(1);
    expect(JSON.parse(lines[1]).b[0][2]).toBe(72);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/system/logging/sessionEventsFile.test.mjs --reporter=dot`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

```js
// backend/src/0_system/logging/transports/sessionEventsFile.mjs
import fs from 'fs';
import path from 'path';

let instance = null;

export function initSessionEventsFileTransport({ baseDir, maxAgeDays = 30 }) {
  if (!baseDir) throw new Error('sessionEventsFile transport requires a baseDir');
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
  pruneOldEventFiles(baseDir, maxAgeDays);

  const streams = new Map(); // app -> { filePath, stream }

  const openStream = (app, session) => {
    const existing = streams.get(app);
    if (existing?.stream) existing.stream.end();
    const appDir = path.join(baseDir, app);
    if (!fs.existsSync(appDir)) fs.mkdirSync(appDir, { recursive: true });
    const safe = String(session).replace(/:/g, '-').replace(/\.\d+Z?$/, '');
    const filePath = path.join(appDir, `${safe}.events`);
    const stream = fs.createWriteStream(filePath, { flags: 'a' });
    streams.set(app, { filePath, stream });
    return streams.get(app);
  };

  instance = {
    write(event) {
      const app = event?.context?.app;
      if (!app || event?.context?.channel !== 'input') return;
      const data = event.data || {};
      if (data.h === 1) { // header opens a new session file
        const s = openStream(app, data.session);
        s.stream.write(JSON.stringify(data) + '\n');
        return;
      }
      let s = streams.get(app);
      if (!s) s = openStream(app, new Date().toISOString()); // batch before header (reconnect): salvage
      s.stream.write(JSON.stringify(data) + '\n');
    },
    flush() {
      for (const [, s] of streams) { if (s.stream) { s.stream.end(); s.stream = null; } }
      streams.clear();
    },
    getStatus() {
      const out = {};
      for (const [app, s] of streams) out[app] = { filePath: s.filePath, writable: !!s.stream };
      return { name: 'session-events-file', baseDir, sessions: out };
    },
  };
  return instance;
}

export function getSessionEventsFileTransport() { return instance; }
export function resetSessionEventsFileTransport() { if (instance) instance.flush(); instance = null; }

function pruneOldEventFiles(baseDir, maxAgeDays) {
  const cutoff = Date.now() - maxAgeDays * 864e5;
  let apps;
  try { apps = fs.readdirSync(baseDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch { return; }
  for (const app of apps) {
    const dir = path.join(baseDir, app);
    let files; try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.events')) continue;
      try { if (fs.statSync(path.join(dir, f)).mtimeMs < cutoff) fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
    }
  }
}

export default getSessionEventsFileTransport;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/system/logging/sessionEventsFile.test.mjs --reporter=dot`
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/src/0_system/logging/transports/sessionEventsFile.mjs tests/unit/system/logging/sessionEventsFile.test.mjs
git commit -m "feat(logging): stream-writing .events session transport"
```

---

## Task 9: Wire the transport into logging init

**Files:**
- Modify: the logging bootstrap that calls `initSessionFileTransport` (find with `grep -rn "initSessionFileTransport" backend/src`)
- Test: manual/integration (no new unit test — this is wiring)

Call `initSessionEventsFileTransport({ baseDir, maxAgeDays: 30 })` right after the existing `initSessionFileTransport(...)`, using the same `baseDir`.

**Step 1:** `grep -rn "initSessionFileTransport" backend/src` — locate the single init site.

**Step 2:** Add the import and the init call beside it. Confirm `baseDir` is the same `media/logs` path.

**Step 3:** Run the full backend unit gate to confirm nothing broke:
Run: `npx vitest run tests/unit/system/logging --reporter=dot`
Expected: PASS.

**Step 4: Commit**

```bash
git add backend/src/0_system/logging/
git commit -m "chore(logging): initialize .events transport alongside session file"
```

---

## Task 10: Fix the routing bug — merge ScorePlayer's orphaned logger

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx:56`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx` (assert the child logger context)

`ScorePlayer.jsx:56` creates `getLogger().child({ component: 'piano-score-player' })` **without** `app`/`sessionLog`, so ~20 `score.*` intent events never persist. Add `app: 'piano-sheetmusic', sessionLog: true` so they route to the session file — matching `useScoreTelemetry.js:20`.

**Step 1: Write the failing test** — spy on `getLogger().child` and assert the context passed. If the existing test file already mocks the logger, extend it; otherwise add a focused test.

```js
// in ScorePlayer.test.jsx — sketch; adapt to the file's existing mocks
it('creates its logger with session-log routing context', () => {
  // render ScorePlayer with a minimal score, capture the child() arg
  expect(childSpy).toHaveBeenCalledWith(
    expect.objectContaining({ component: 'piano-score-player', app: 'piano-sheetmusic', sessionLog: true })
  );
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx --reporter=dot`
Expected: FAIL — current context lacks `app`/`sessionLog`.

**Step 3: Implement** — change line 56:

```js
const logger = useMemo(() => getLogger().child({ component: 'piano-score-player', app: 'piano-sheetmusic', sessionLog: true }), []);
```

Caveat for implementer: `child({ sessionLog: true })` auto-emits `session-log.start` (`Logger.js:212`). `useScoreTelemetry` also opens the session via `startSession`. Verify this does not double-open the session file — if it does, drop the explicit `startSession` call in `ScorePlayer.jsx:955` OR keep `sessionLog` only on the telemetry logger and instead pass the shared child down. Resolve during review; the goal is exactly one session-open per run.

**Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx --reporter=dot`
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx
git commit -m "fix(piano): route ScorePlayer intent events to the session log"
```

---

## Task 11: MIDI tap — capture note-on/off/sustain via subscribeRaw

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx`
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/midiTap.js` (pure parse helper)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/midiTap.test.js`

`subscribeRaw(fn)` (`useWebMidiBLE.js:153`) delivers raw MIDI **bytes**. Extract a pure `midiToRecord(bytes)` → `{ kind, a, b } | null` so the byte parsing is unit-tested off the DOM; `ScorePlayer` subscribes and calls `record(...)`.

**Step 1: Write the failing test**

```js
// midiTap.test.js
import { describe, it, expect } from 'vitest';
import { midiToRecord } from './midiTap.js';
import { KIND } from '../../../../../lib/logging/inputRecorder.js';

describe('midiToRecord', () => {
  it('maps note-on with velocity', () => {
    expect(midiToRecord([0x90, 72, 88])).toEqual({ kind: KIND.MIDI_ON, a: 72, b: 88 });
  });
  it('treats note-on velocity 0 as note-off', () => {
    expect(midiToRecord([0x90, 72, 0])).toEqual({ kind: KIND.MIDI_OFF, a: 72, b: 0 });
  });
  it('maps note-off', () => {
    expect(midiToRecord([0x80, 72, 40])).toEqual({ kind: KIND.MIDI_OFF, a: 72, b: 0 });
  });
  it('maps sustain CC (64) to on/off by threshold', () => {
    expect(midiToRecord([0xB0, 64, 127])).toEqual({ kind: KIND.SUSTAIN, a: 1, b: 0 });
    expect(midiToRecord([0xB0, 64, 0])).toEqual({ kind: KIND.SUSTAIN, a: 0, b: 0 });
  });
  it('maps other CC generically', () => {
    expect(midiToRecord([0xB0, 7, 100])).toEqual({ kind: KIND.CC, a: 7, b: 100 });
  });
  it('ignores clock/active-sensing/unknown', () => {
    expect(midiToRecord([0xF8])).toBeNull();
    expect(midiToRecord([])).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/midiTap.test.js --reporter=dot`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

```js
// midiTap.js
import { KIND } from '../../../../../lib/logging/inputRecorder.js';
const SUSTAIN_CC = 64;

export function midiToRecord(bytes) {
  if (!bytes || bytes.length < 2) return null;
  const status = bytes[0] & 0xf0;
  if (status === 0x90) {
    const vel = bytes[2] | 0;
    return vel > 0 ? { kind: KIND.MIDI_ON, a: bytes[1], b: vel } : { kind: KIND.MIDI_OFF, a: bytes[1], b: 0 };
  }
  if (status === 0x80) return { kind: KIND.MIDI_OFF, a: bytes[1], b: 0 };
  if (status === 0xB0) {
    if (bytes[1] === SUSTAIN_CC) return { kind: KIND.SUSTAIN, a: bytes[2] >= 64 ? 1 : 0, b: 0 };
    return { kind: KIND.CC, a: bytes[1], b: bytes[2] | 0 };
  }
  return null;
}
```

Then in `ScorePlayer.jsx`, in an effect that already has `subscribeRaw`:

```js
useEffect(() => {
  const off = subscribeRaw((evt) => {
    const r = midiToRecord(evt.data ?? evt);
    if (r) record(r.kind, r.a, r.b, stepRef.current ?? 0, 0);
  });
  return off;
}, [subscribeRaw]);
```

(`subscribeRaw`'s listener receives whatever `emitRaw` passes — confirm it's the byte array `event.data`; adapt `evt.data ?? evt` accordingly during implementation.)

**Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/midiTap.test.js --reporter=dot`
Expected: PASS (6 tests).

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/midiTap.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/midiTap.test.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx
git commit -m "feat(piano): capture raw MIDI input into the recorder"
```

---

## Task 12: Touch/tap + UI-intent taps + render correlation

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx`
- Modify: `frontend/src/lib/logging/jankProbes.js:51` (`reportRender` also feeds recorder)
- Test: covered by the existing recorder tests + a small `ScorePlayer` interaction test

Add: (a) a passive delegated `pointerdown/move/up` listener pair on the score container that feeds the gesture coalescer and records `TOUCH_*`; (b) at each UI handler (transport play/pause, loop, hands, tempo, mode, focus, page-turn) a `record(KIND.UI_INTENT, intern(controlName), 0, step, 0)` plus a `requestAnimationFrame`-stamped `TAP` for input→paint latency; (c) `reportRender` calls `record(KIND.RENDER, intern(name), nodes, 0, 0)`.

**Step 1: Write the failing test** — assert that invoking the mode-change handler records a `UI_INTENT`:

```js
// in ScorePlayer.test.jsx (or a focused recorder-integration test)
it('records a UI_INTENT when the mode changes', () => {
  __resetRecorder();
  // trigger mode change through the component's handler
  const snap = __snapshotForTest();
  expect(snap.records.some(r => r.kind === KIND.UI_INTENT)).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx --reporter=dot`
Expected: FAIL — no UI_INTENT recorded.

**Step 3: Implement** the three taps. Key constraints:
- Touch listeners MUST be `{ passive: true }` — a non-passive touch listener blocks scroll compositing and would itself cause jank (design §3).
- `reportRender` stays dirt-cheap — one `intern` (cached) + one `record`. No new allocation.

**Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx frontend/src/lib/logging/inputRecorder.test.js --reporter=dot`
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx frontend/src/lib/logging/jankProbes.js
git commit -m "feat(piano): capture touch, UI-intent, and render events"
```

---

## Task 13: Start/stop the recorder on ScorePlayer mount, gated by config

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx`
- Reference: `piano.yml` household config; `usePianoKioskConfig()` (already used at `ScorePlayer.jsx:59`)

On mount (when a score is loaded), if `config.inputTelemetry?.enabled`, call `startRecorder({ session, score, ctx, send })` where `send` posts over the shared WS with `context.channel = 'input'`. On unmount, `stopRecorder()`. Expose `window.__INPUT_REC__ = { start, stop, status }` for a deploy-free kill switch (design §8).

**Step 1: Write the failing test** — assert that with the flag off, `startRecorder` is not called; with it on, it is. Inject a spy `startRecorder` via the module mock.

**Step 2: Run — FAIL** (recorder always on / never on).

**Step 3: Implement** the gated lifecycle effect + `window.__INPUT_REC__`. The `send` function wraps the batch/header in the event envelope the WS transport expects, with `context: { app: 'piano-sheetmusic', channel: 'input', user: <id> }`.

**Step 4: Run — PASS.**

**Step 5: Commit**

```bash
git commit -am "feat(piano): gate + lifecycle for input recorder in ScorePlayer"
```

---

## Task 14: End-to-end shape test + full gate

**Files:**
- Test: `frontend/src/lib/logging/inputRecorder.e2e.test.js` (round-trip)

Round-trip: feed a scripted sequence (header + MIDI + coalesced gesture + UI intent) through `record`/`encodeBatch`, decode with the header's `kinds`/`strings`, and assert the reconstructed named events match the input. This is the "can we actually replay it" proof.

**Step 1: Write the failing round-trip test** (decode helper lives in the test or a small `decodeEvents.js`).

**Step 2: Run — FAIL.**

**Step 3:** Add a `decodeEvents(header, batches)` helper (pure) that maps tuples back to `{ t, event, ...named fields }` using `kinds`/`strings`.

**Step 4: Run — PASS.** Then run the whole feature's tests:

Run: `npx vitest run frontend/src/lib/logging tests/unit/system/logging frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic --reporter=dot`
Expected: ALL PASS.

**Step 5: Commit**

```bash
git add frontend/src/lib/logging/
git commit -m "test(piano): end-to-end record→encode→decode round-trip"
```

---

## Deferred to a follow-up (NOT in this plan)

- **Replay viewer** (design §7) — a UI deliverable; build after real `.events` files exist to see what's worth surfacing.
- **On-tablet perf verification** (design "Verification") — must run on the real SM-T590 before claiming "no perf cost"; can't be done from a dev box. Do this before enabling the flag in prod `piano.yml`.
- **`score.playback.stall` threshold recalibration** — separate cleanup (94% of current disk).
- **`score.load.failed` wiring** — `logLoadFailed` exported but never called.

## Post-implementation

1. Run the full unit gate: `npm run test:isolated` (confirm the new tests are picked up by the harness, not just direct vitest — see memory `reference_ddd_remediation_ratchet`).
2. **Do NOT enable `inputTelemetry` in prod `piano.yml`** until on-tablet perf verification passes.
3. Use superpowers:finishing-a-development-branch to merge.
