# Media Queue Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the remaining open gaps from the architecture audit: input validation on `position` and `step` endpoints, and atomicity of the `add`/`next` WebSocket command handlers.

**Architecture:** Two independent changes. (1) Input validation lives in the router layer — `PATCH /queue/position` and `POST /queue/advance` reject malformed values before they reach the service. (2) The `add` and `next` actions in the `media:command` WS handler are restructured from load-addItems-load-broadcast to load-mutate-replace-broadcast, eliminating the second load call and the race window between them. Auth on household endpoints is NOT in scope — it is a deliberate v1 deferral consistent with every other endpoint in the codebase.

**Tech Stack:** Express, Jest/supertest (router tests at `tests/isolated/api/routers/mediaRouter.test.mjs`), no new dependencies.

---

## Background: The Two Issues

### Issue 1 — No input validation on position/step

`PATCH /queue/position` passes `position` straight to `queue.position = position`. A client can send `position: -1`, `position: 1.5`, or `position: "hello"` and it silently corrupts the queue state.

`POST /queue/advance` passes `step` straight to `queue.advance(step, ...)`. A client can send `step: 0.5` or `step: null`.

### Issue 2 — `add` and `next` WS handlers do two service calls

```js
// CURRENT (two round-trips, race window between save and reload):
await mediaQueueService.addItems([{ contentId }], 'end', householdId);  // load→mutate→save
const queue = await mediaQueueService.load(householdId);                 // load again
eventBus.broadcast('media:queue', queue.toJSON());

// CORRECT (one round-trip, atomic):
const queue = await mediaQueueService.load(householdId);
queue.addItems([{ contentId }], 'end');
await mediaQueueService.replace(queue, householdId);
eventBus.broadcast('media:queue', queue.toJSON());
```

The `play` and `queue` handlers were already fixed to follow the atomic pattern. `add` and `next` were missed.

---

## Task 1: Failing Tests — Input Validation

**Files:**
- Modify: `tests/isolated/api/routers/mediaRouter.test.mjs`

Read the test file first (364 lines). The pattern to follow:
- `supertest` sends HTTP requests to the Express app
- Service methods are `jest.fn()` mocks — check they are or aren't called
- The `beforeEach` block (lines 36-71) sets up the app and mocks

**Step 1: Read the test file**

Open `tests/isolated/api/routers/mediaRouter.test.mjs` and confirm:
- The `fakeQueue` object (lines 20-34)
- The `beforeEach` setup (lines 36-71)
- The existing `PATCH /media/queue/position` describe block (around line 160)
- The existing `POST /media/queue/advance` describe block (around line 212)

**Step 2: Add failing validation tests for PATCH /queue/position**

Add these tests inside the existing `describe('PATCH /media/queue/position', ...)` block, after the existing tests:

```js
it('returns 400 when position is missing', async () => {
  const res = await request(app)
    .patch('/media/queue/position')
    .send({ mutationId: 'abc' });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/position/i);
  expect(mockMediaQueueService.setPosition).not.toHaveBeenCalled();
});

it('returns 400 when position is negative', async () => {
  const res = await request(app)
    .patch('/media/queue/position')
    .send({ position: -1, mutationId: 'abc' });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/position/i);
  expect(mockMediaQueueService.setPosition).not.toHaveBeenCalled();
});

it('returns 400 when position is a float', async () => {
  const res = await request(app)
    .patch('/media/queue/position')
    .send({ position: 1.5, mutationId: 'abc' });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/position/i);
  expect(mockMediaQueueService.setPosition).not.toHaveBeenCalled();
});

it('returns 400 when position is not a number', async () => {
  const res = await request(app)
    .patch('/media/queue/position')
    .send({ position: 'first', mutationId: 'abc' });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/position/i);
  expect(mockMediaQueueService.setPosition).not.toHaveBeenCalled();
});

it('accepts position: 0 as valid', async () => {
  const res = await request(app)
    .patch('/media/queue/position')
    .send({ position: 0, mutationId: 'abc' });
  expect(res.status).toBe(200);
  expect(mockMediaQueueService.setPosition).toHaveBeenCalledWith(0, undefined);
});
```

**Step 3: Add failing validation tests for POST /queue/advance**

Add these inside the existing `describe('POST /media/queue/advance', ...)` block, after the existing tests:

```js
it('returns 400 when step is a float', async () => {
  const res = await request(app)
    .post('/media/queue/advance')
    .send({ step: 1.5, auto: false });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/step/i);
  expect(mockMediaQueueService.advance).not.toHaveBeenCalled();
});

it('returns 400 when step is not a number', async () => {
  const res = await request(app)
    .post('/media/queue/advance')
    .send({ step: 'next', auto: false });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/step/i);
  expect(mockMediaQueueService.advance).not.toHaveBeenCalled();
});

it('accepts step: -1 for previous', async () => {
  const res = await request(app)
    .post('/media/queue/advance')
    .send({ step: -1, auto: false });
  expect(res.status).toBe(200);
  expect(mockMediaQueueService.advance).toHaveBeenCalledWith(-1, { auto: false }, undefined);
});
```

**Step 4: Run tests to confirm they FAIL**

```bash
npx jest tests/isolated/api/routers/mediaRouter.test.mjs --verbose 2>&1 | tail -30
```

Expected: the 8 new tests FAIL (400s not returned because no validation exists yet). All existing tests must still PASS. If any existing test fails, stop and investigate.

**Step 5: Commit failing tests**

```bash
git add tests/isolated/api/routers/mediaRouter.test.mjs
git commit -m "test(media): add failing validation tests for position and step inputs"
```

---

## Task 2: Implement Input Validation in the Router

**Files:**
- Modify: `backend/src/4_api/v1/routers/media.mjs`

Read the router file. The two routes to modify are:
- `PATCH /queue/position` (around line 130) — validate `position`
- `POST /queue/advance` (around line 118) — validate `step`

**Step 1: Add validation helper near the top of the factory function**

After the `broadcast` helper (around line 56), add:

```js
/**
 * Returns true if value is a non-negative integer (0, 1, 2, ...).
 * Rejects floats, negatives, strings, null, undefined.
 */
function isNonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Returns true if value is an integer (includes negatives, for step).
 */
function isInt(value) {
  return Number.isInteger(value);
}
```

**Step 2: Guard `PATCH /queue/position`**

Current (around line 130-136):
```js
router.patch('/queue/position', asyncHandler(async (req, res) => {
  const hid = resolveHid(req);
  const { position, mutationId } = req.body;
  const queue = await mediaQueueService.setPosition(position, hid);
  broadcast(queue, mutationId);
  res.json(queue.toJSON());
}));
```

Change to:
```js
router.patch('/queue/position', asyncHandler(async (req, res) => {
  const hid = resolveHid(req);
  const { position, mutationId } = req.body;

  if (!isNonNegativeInt(position)) {
    return res.status(400).json({ error: 'position must be a non-negative integer' });
  }

  const queue = await mediaQueueService.setPosition(position, hid);
  broadcast(queue, mutationId);
  res.json(queue.toJSON());
}));
```

**Step 3: Guard `POST /queue/advance`**

Current (around line 118-124):
```js
router.post('/queue/advance', asyncHandler(async (req, res) => {
  const hid = resolveHid(req);
  const { step = 1, auto = false, mutationId } = req.body;
  const queue = await mediaQueueService.advance(step, { auto }, hid);
  broadcast(queue, mutationId);
  res.json(queue.toJSON());
}));
```

Change to:
```js
router.post('/queue/advance', asyncHandler(async (req, res) => {
  const hid = resolveHid(req);
  const { step = 1, auto = false, mutationId } = req.body;

  if (!isInt(step)) {
    return res.status(400).json({ error: 'step must be an integer' });
  }

  const queue = await mediaQueueService.advance(step, { auto }, hid);
  broadcast(queue, mutationId);
  res.json(queue.toJSON());
}));
```

**Step 4: Run the tests to confirm they all PASS**

```bash
npx jest tests/isolated/api/routers/mediaRouter.test.mjs --verbose 2>&1 | tail -30
```

Expected: ALL tests pass including the 8 new ones. Zero failures, zero regressions.

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/media.mjs
git commit -m "fix(media): validate position (non-negative int) and step (integer) in queue endpoints"
```

---

## Task 3: Fix `add` and `next` WebSocket Command Handlers

**Files:**
- Modify: `backend/src/app.mjs`

**Context:** The `media:command` event handler is inside the `(async () => { ... })()` IIFE starting around line 614. The `play` and `queue` actions already use the correct load-mutate-replace-once pattern. The `add` and `next` actions currently call `addItems()` (which internally loads, mutates, saves) and then call `load()` again just to get the queue for broadcasting. This is two I/O round-trips when one suffices.

There is no dedicated unit test for this handler in app.mjs — the fix is straightforward and the correct pattern is already present in the same block (`play` and `queue` actions). Manual verification: send a `media:command` with action=add via WebSocket and confirm the broadcast fires once.

**Step 1: Read the handler**

Find the `media:command` block in `app.mjs` (search for `media:command`). Read the full `if/else if` chain to understand the current structure.

**Step 2: Replace `add` action**

Current:
```js
} else if (action === 'add') {
  await mediaQueueService.addItems(
    [{ contentId, addedFrom: 'WEBSOCKET' }], 'end', householdId
  );
  const queue = await mediaQueueService.load(householdId);
  eventBus.broadcast('media:queue', queue.toJSON());
```

Change to:
```js
} else if (action === 'add') {
  // Load once → mutate in memory → save once (matches play/queue pattern)
  const queue = await mediaQueueService.load(householdId);
  queue.addItems([{ contentId, addedFrom: 'WEBSOCKET' }], 'end');
  await mediaQueueService.replace(queue, householdId);
  eventBus.broadcast('media:queue', queue.toJSON());
```

**Step 3: Replace `next` action**

Current:
```js
} else if (action === 'next') {
  await mediaQueueService.addItems(
    [{ contentId, addedFrom: 'WEBSOCKET' }], 'next', householdId
  );
  const queue = await mediaQueueService.load(householdId);
  eventBus.broadcast('media:queue', queue.toJSON());
```

Change to:
```js
} else if (action === 'next') {
  // Load once → mutate in memory → save once (matches play/queue pattern)
  const queue = await mediaQueueService.load(householdId);
  queue.addItems([{ contentId, addedFrom: 'WEBSOCKET' }], 'next');
  await mediaQueueService.replace(queue, householdId);
  eventBus.broadcast('media:queue', queue.toJSON());
```

**Step 4: Run the router tests to confirm no regressions**

```bash
npx jest tests/isolated/api/routers/mediaRouter.test.mjs --verbose 2>&1 | tail -10
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add backend/src/app.mjs
git commit -m "fix(media): make add and next WS command handlers atomic (load-mutate-replace-once)"
```

---

## Task 4: Update Audit Scorecard

**Files:**
- Modify: `docs/_wip/audits/2026-02-27-media-app-implementation-audit.md`

**Step 1: Read the audit doc**

Find the **Resolution Log** section. It currently has Commit 1, Commit 2, and Commit 3. Add a Commit 4 entry:

```markdown
### Commit 4 — *(current commits)* — `fix(media): input validation + WS handler atomicity`

| Finding | Resolution |
|---|---|
| **Input validation gap** `PATCH /queue/position` and `POST /queue/advance` accepted floats, negatives, and non-numbers | Added `isNonNegativeInt` guard to `PATCH /queue/position` (rejects missing, negative, float, non-number). Added `isInt` guard to `POST /queue/advance` (rejects floats and non-numbers; negative integers allowed for prev). 8 new tests in `mediaRouter.test.mjs` — TDD red → green. |
| **D-2 / WS atomicity gap** `add` and `next` `media:command` handlers did two I/O round-trips (addItems → load) | Restructured both to follow the established load-once → mutate-in-memory → replace-once pattern, consistent with `play` and `queue` handlers. Race window eliminated. |
```

**Step 2: Update the Security score in the Updated Scorecard table**

Find the line:
```
| Security / Input Validation | 7/10 | 7/10 | Unchanged — household ID auth and position validation remain future work |
```

Change to:
```
| Security / Input Validation | 7/10 | 9/10 | position and step validation added; household ID auth remains v1 deferral |
```

**Step 3: Commit**

```bash
git add docs/_wip/audits/2026-02-27-media-app-implementation-audit.md
git commit -m "docs(media): update audit scorecard — security/validation 7/10 → 9/10"
```

---

## Files Changed Summary

| File | Task | Change |
|---|---|---|
| `tests/isolated/api/routers/mediaRouter.test.mjs` | 1 | 8 new validation tests (TDD) |
| `backend/src/4_api/v1/routers/media.mjs` | 2 | `isNonNegativeInt` + `isInt` helpers; guards on position and step |
| `backend/src/app.mjs` | 3 | `add` and `next` WS handlers — load-mutate-replace-once |
| `docs/_wip/audits/2026-02-27-media-app-implementation-audit.md` | 4 | Commit 4 entry; security score 7/10 → 9/10 |

## Note on Auth (Not In Scope)

Household ID auth on `/media/queue` endpoints remains a documented v1 deferral. Every other endpoint in the codebase (fitness, device, display, etc.) uses the same `req.query.household || defaultHouseholdId` pattern with no per-request auth. Adding auth infrastructure for media alone would be inconsistent and is out of scope for this hardening pass.
