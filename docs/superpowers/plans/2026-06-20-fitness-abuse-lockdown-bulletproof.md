# Bulletproof Scanner-Abuse Lockdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee that a scanner-abuse trip (3 failed scans / 30s) ALWAYS engages the emergency lockdown, instead of fizzling when the browser ceremony outlives the server's pending-detection TTL.

**Architecture:** Make the lockdown commit **server-authoritative for abuse trips**. When abuse trips, the identity relay *arms a single-use commit token* and schedules a server-side fallback commit; if the browser ceremony does not finalize first, the relay locks down itself. The browser `/commit` becomes an idempotent fast-path that can never regress an already-engaged lock. An admin abort disarms the token and cancels the fallback. Un-locking (`/abort`, `/release`) stays tightly gated on a fresh admin scan (short TTL unchanged).

**Tech Stack:** Node ES modules (backend, vitest + supertest), React hook (frontend, vitest + @testing-library/react). No new dependencies.

---

## Background — the bug (verified from prod logs 2026-06-20)

Two abuse trips fired today (16:34, 19:11). Both broadcast `fitness.emergency.ceremony` and `identity.abuse_tripped {count:3, windowSec:30}` correctly — **but the lock never engaged.** Both ended in `emergency.commit_rejected {reason:"no-pending-detection"}` (HTTP 409). **Zero `emergency.locked` events all day.** The garage was never shut down.

**Root cause:** `tripAbuse()` stamps `pending = { userId: 'abuse-protection', at: now() }` with a **30s TTL** (`DEFAULT_PENDING_TTL_MS`). The browser DEFCON ceremony (`EmergencyLockdownOverlay.jsx`) only POSTs `/emergency/commit` when its on-screen window elapses — and that window is **paused while the abort modal is open** (`pauseAccumRef`), so the wall-clock gap from trip→commit is **unbounded** (observed 36s and 122s). By the time `/commit` lands, `consumePendingDetection` finds the pending expired → 409 → `useEmergencyLockdown.commit()` catches and calls `enterNormal('commit-failed')` → screen returns to normal. No fixed server TTL can cover an indefinitely-paused ceremony, so the fix must not depend on the browser committing in time.

## File map

- `backend/src/3_applications/fitness/identityRelay.mjs` — **MODIFY.** Add armed-commit token + server-side fallback commit; `tripAbuse` arms instead of stamping pending; `consumePendingDetection` gains a per-call max-age.
- `backend/src/3_applications/fitness/identityRelay.test.mjs` — **MODIFY.** Update abuse tests; add armed-token / server-fallback / disarm tests.
- `backend/src/app.mjs` — **MODIFY.** Inject `triggerEmergencyLockdown` + `serverCommitDelayMs` into the relay.
- `backend/src/4_api/v1/routers/fitness.mjs` — **MODIFY.** `/commit` idempotent + consume armed-or-pending (generous age); `/abort` disarms.
- `backend/src/4_api/v1/routers/fitness.emergency.test.mjs` — **MODIFY.** Add idempotency / armed-token / disarm tests.
- `frontend/src/modules/Fitness/hooks/useEmergencyLockdown.js` — **MODIFY.** `commit()` failure path reconciles against server state instead of blindly dropping to normal.
- `frontend/src/modules/Fitness/hooks/useEmergencyLockdown.test.jsx` — **MODIFY.** Add commit-failure reconcile tests.
- `docs/runbooks/fitness-emergency-lockdown.md` — **MODIFY.** Document server-authoritative commit + new config knobs.

## How to run the tests

```bash
# Backend relay + router (vitest):
./node_modules/.bin/vitest run --config vitest.config.mjs \
  backend/src/3_applications/fitness/identityRelay.test.mjs \
  backend/src/4_api/v1/routers/fitness.emergency.test.mjs

# Frontend hook (vitest, excluding the .claire worktree copy):
./node_modules/.bin/vitest run --config vitest.config.mjs \
  --exclude '**/.claire/**' \
  frontend/src/modules/Fitness/hooks/useEmergencyLockdown.test.jsx
```

> If `vitest.config.mjs` is not the right config name in this repo, list configs with `ls vitest*.mjs` and use the one that resolves these paths. Do NOT route these vitest specs through jest.

**Do not deploy.** Per the user's instruction, stop after the final commit and wait for their signal before building/deploying.

---

### Task 1: Relay — per-call max-age on `consumePendingDetection`

This lets `/commit` honor a generous freshness window (covering the admin-press ceremony) while `/abort` and `/release` keep the tight 30s default (un-locking stays gated on a fresh scan).

**Files:**
- Modify: `backend/src/3_applications/fitness/identityRelay.mjs` (the `consumePendingDetection` method, ~line 179-185)
- Test: `backend/src/3_applications/fitness/identityRelay.test.mjs`

- [ ] **Step 1: Write the failing tests**

Add inside the existing `describe('createIdentityRelay', ...)` block (after the `pending detection expires after TTL` test, ~line 133):

```javascript
  it('consumePendingDetection honors a generous per-call maxAge override', () => {
    const d = deps(() => 1000);
    const relay = createIdentityRelay({ ...d, pendingTtlMs: 30000 });
    d.eventBus.deliver({ topic: 'biometric.scan', matched: true, uuid: 'uuid-kc' }); // admin → stamps pending at 1000
    // Past the default 30s TTL but within the override → still consumable (commit path).
    expect(relay.consumePendingDetection(1000 + 90000, 120000)).toEqual({ userId: 'kc', at: 1000 });
  });

  it('consumePendingDetection still expires at the default TTL when no override is given', () => {
    const d = deps(() => 1000);
    const relay = createIdentityRelay({ ...d, pendingTtlMs: 30000 });
    d.eventBus.deliver({ topic: 'biometric.scan', matched: true, uuid: 'uuid-kc' });
    expect(relay.consumePendingDetection(1000 + 30001)).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/3_applications/fitness/identityRelay.test.mjs`
Expected: the new `maxAge override` test FAILS (returns `null` because the 2nd arg is ignored).

- [ ] **Step 3: Implement the per-call max-age**

Replace the `consumePendingDetection` method (currently ~line 179-185):

```javascript
    consumePendingDetection(nowMs = now(), maxAgeMs = pendingTtlMs) {
      if (!pending) return null;
      if (nowMs - pending.at > maxAgeMs) { pending = null; return null; }
      const consumed = pending;
      pending = null;
      return consumed;
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/3_applications/fitness/identityRelay.test.mjs`
Expected: PASS (all relay tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/identityRelay.mjs backend/src/3_applications/fitness/identityRelay.test.mjs
git commit -m "feat(fitness): per-call maxAge on pending-detection consume

Lets /commit use a generous freshness window without loosening
/abort and /release, which keep the tight default TTL."
```

---

### Task 2: Relay — armed-commit token + server-authoritative fallback

Abuse trips now **arm a single-use commit token** and schedule a server-side fallback that locks down even if the browser never commits. `tripAbuse` stops stamping a `pending` (the thing that expired).

**Files:**
- Modify: `backend/src/3_applications/fitness/identityRelay.mjs`
- Test: `backend/src/3_applications/fitness/identityRelay.test.mjs`

- [ ] **Step 1: Write the failing tests**

First, add a fake-scheduler helper near the top of the test file (after the `makeBus()` helper, ~line 25):

```javascript
// A deterministic scheduler: setTimeout records the callback; fire() runs all
// non-cancelled callbacks so tests can simulate the server-commit delay elapsing.
function makeScheduler() {
  const timers = [];
  return {
    timers,
    setTimeout(fn) { const h = { fn, cancelled: false }; timers.push(h); return h; },
    clearTimeout(h) { if (h) h.cancelled = true; },
    async fire() { for (const t of timers) { if (!t.cancelled) await t.fn(); } },
  };
}
```

Then, in `describe('scanner-abuse auto-lockdown', ...)`, **replace** the existing test `'trips the ceremony after N unrecognized scans within the window'` (lines ~160-173) with this updated version (it now asserts an armed token, not a pending):

```javascript
  it('trips the ceremony after N unrecognized scans within the window', () => {
    let t = 1000;
    const d = abuseDeps(() => t);
    const relay = createIdentityRelay(d);
    t = 1000; fail(d.eventBus);
    t = 2000; fail(d.eventBus);
    expect(d.eventBus.broadcasts.find((b) => b.topic === 'fitness.emergency.ceremony')).toBeUndefined();
    t = 3000; fail(d.eventBus);
    const evt = d.eventBus.broadcasts.find((b) => b.topic === 'fitness.emergency.ceremony');
    expect(evt).toBeDefined();
    expect(evt.payload).toMatchObject({ reason: 'abuse', count: 3, windowSec: 30 });
    // A trip ARMS a commit token (not a short-lived pending) so the lock survives
    // a long/paused browser ceremony.
    expect(relay.consumePendingDetection(3000)).toBeNull();
    expect(relay.consumeArmedCommit(3000)).toEqual({ userId: 'abuse-protection', at: 3000 });
  });
```

Then add these new tests at the end of the `scanner-abuse auto-lockdown` describe block (before its closing `});`):

```javascript
  it('server fallback commits the lockdown itself if the browser never does', async () => {
    let t = 3000;
    const sched = makeScheduler();
    const trigger = { execute: vi.fn().mockResolvedValue({ lockedUntil: 9 }) };
    const d = abuseDeps(() => t, { scheduler: sched, triggerEmergencyLockdown: trigger });
    createIdentityRelay(d);
    t = 1000; fail(d.eventBus);
    t = 2000; fail(d.eventBus);
    t = 3000; fail(d.eventBus);
    await sched.fire(); // simulate serverCommitDelayMs elapsing with no browser commit
    expect(trigger.execute).toHaveBeenCalledWith(
      expect.objectContaining({ lockedBy: 'abuse-protection' }),
    );
  });

  it('a browser commit before the fallback cancels the server commit (no double lock)', async () => {
    let t = 3000;
    const sched = makeScheduler();
    const trigger = { execute: vi.fn().mockResolvedValue({ lockedUntil: 9 }) };
    const d = abuseDeps(() => t, { scheduler: sched, triggerEmergencyLockdown: trigger });
    const relay = createIdentityRelay(d);
    t = 1000; fail(d.eventBus);
    t = 2000; fail(d.eventBus);
    t = 3000; fail(d.eventBus);
    expect(relay.consumeArmedCommit(3000)).toEqual({ userId: 'abuse-protection', at: 3000 });
    await sched.fire(); // timer was cancelled when the token was consumed
    expect(trigger.execute).not.toHaveBeenCalled();
  });

  it('disarmCommit cancels a pending server commit (admin abort) and clears the token', async () => {
    let t = 3000;
    const sched = makeScheduler();
    const trigger = { execute: vi.fn() };
    const d = abuseDeps(() => t, { scheduler: sched, triggerEmergencyLockdown: trigger });
    const relay = createIdentityRelay(d);
    t = 1000; fail(d.eventBus);
    t = 2000; fail(d.eventBus);
    t = 3000; fail(d.eventBus);
    relay.disarmCommit();
    await sched.fire();
    expect(trigger.execute).not.toHaveBeenCalled();
    expect(relay.consumeArmedCommit(3000)).toBeNull();
  });

  it('server fallback does not double-lock when a lock became active first', async () => {
    let t = 3000;
    let lockState = null; // null at trip (so it arms), locked by the time the fallback fires
    const sched = makeScheduler();
    const trigger = { execute: vi.fn() };
    const d = abuseDeps(() => t, {
      scheduler: sched,
      triggerEmergencyLockdown: trigger,
      getLockdownState: { execute: async () => lockState },
    });
    createIdentityRelay(d);
    t = 1000; fail(d.eventBus);
    t = 2000; fail(d.eventBus);
    t = 3000; fail(d.eventBus);
    await new Promise((r) => setTimeout(r, 0)); // let tripAbuse's async lock-check settle (it sees null → arms)
    lockState = { lockedUntil: 9999999999 };
    await sched.fire();
    expect(trigger.execute).not.toHaveBeenCalled();
  });
```

Finally, update the two fail-closed tests so they also assert no armed token. In `'fails closed: a lockdown-state lookup error does NOT trip or stamp a pending'` add after the existing `consumePendingDetection` assertion (~line 246):

```javascript
    expect(relay.consumeArmedCommit(3000)).toBeNull();
```

And in `'does not trip (or stamp a synthetic pending) while a lockdown is already active'` add after its `consumePendingDetection` assertion (~line 258):

```javascript
    expect(relay.consumeArmedCommit(3000)).toBeNull();
```

Also import `vi` at the top of the test file — change line 1 from:

```javascript
import { describe, it, expect } from 'vitest';
```
to:
```javascript
import { describe, it, expect, vi } from 'vitest';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/3_applications/fitness/identityRelay.test.mjs`
Expected: FAIL — `relay.consumeArmedCommit is not a function`, and the updated trip test fails because `tripAbuse` still stamps a pending.

- [ ] **Step 3: Implement the armed-commit token + server fallback**

In `identityRelay.mjs`, add two constants alongside the existing `DEFAULT_*` consts (after `const ABUSE_USER = 'abuse-protection';`, ~line 25):

```javascript
// Server-side fallback: if the browser ceremony never POSTs /commit, the relay
// commits the abuse lockdown itself this long after the trip. Longer than the
// browser's MIN_CEREMONY_MS (10s) so a live kiosk normally commits first and the
// server is only a safety net. Overridable via fitness.yml emergency.abuse.
const DEFAULT_SERVER_COMMIT_DELAY_MS = 25000;
// How long an armed token may still be consumed by a (late/paused) browser
// commit. The safe direction (locking), single-use, so a generous window is fine.
const DEFAULT_ARMED_MAX_AGE_MS = 600000; // 10 min
```

Extend the constructor destructure (currently ~line 64-73) to inject the lockdown use case + a scheduler + the delay:

```javascript
export function createIdentityRelay({
  eventBus,
  userService,
  loadFitnessConfig,
  getLockdownState = null,
  triggerEmergencyLockdown = null,
  scheduler = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h) },
  serverCommitDelayMs = DEFAULT_SERVER_COMMIT_DELAY_MS,
  now = () => Date.now(),
  pendingTtlMs = DEFAULT_PENDING_TTL_MS,
  adminSessionTtlMs = DEFAULT_ADMIN_SESSION_TTL_MS,
  logger = console,
}) {
```

Add armed-token state next to the existing `let pending`/`let failedTimes` declarations (~line 78-81):

```javascript
  let armed = null;     // { userId, at } — abuse lockdown armed for commit
  let armTimer = null;  // scheduler handle for the server-side fallback commit
```

Add the arm / server-commit machinery (place it just above `function recordScanOutcome`, ~line 115):

```javascript
  function cancelArmTimer() {
    if (armTimer != null) {
      try { scheduler.clearTimeout(armTimer); } catch { /* noop */ }
      armTimer = null;
    }
  }

  // Server-authoritative commit: if the browser ceremony never finalized, the
  // relay locks down itself so an abuse trip ALWAYS engages. Single-use token —
  // whoever commits first (browser via consumeArmedCommit, or this) wins.
  async function runServerCommit() {
    armTimer = null;
    const token = armed;
    if (!token) return;            // already consumed (browser beat us) or disarmed (aborted)
    armed = null;
    if (!triggerEmergencyLockdown) return;
    try {
      if (getLockdownState) {
        const state = await getLockdownState.execute({ now: Math.floor(now() / 1000) });
        if (state) return;         // a lock already became active — nothing to do
      }
      await triggerEmergencyLockdown.execute({ lockedBy: token.userId, now: Math.floor(now() / 1000) });
      logger.warn?.('identity.abuse_server_committed', { lockedBy: token.userId });
    } catch (err) {
      logger.warn?.('identity.abuse_server_commit_failed', { message: err?.message ?? null });
    }
  }

  // Arm an abuse lockdown for commit and schedule the server-side fallback.
  function armCommit(userId, at) {
    armed = { userId, at };
    cancelArmTimer();
    if (triggerEmergencyLockdown) {
      armTimer = scheduler.setTimeout(() => { runServerCommit(); }, serverCommitDelayMs);
    }
  }
```

In `tripAbuse` (~line 108), replace the pending-stamp line:

```javascript
    pending = { userId: ABUSE_USER, at: now() };
```
with:
```javascript
    armCommit(ABUSE_USER, at);
```

Add the three new methods to the returned object (after `consumePendingDetection`, ~line 185):

```javascript
    // Consume the armed abuse-commit token (the safe, single-use lock authorization).
    consumeArmedCommit(nowMs = now(), maxAgeMs = DEFAULT_ARMED_MAX_AGE_MS) {
      if (!armed) return null;
      cancelArmTimer();
      if (nowMs - armed.at > maxAgeMs) { armed = null; return null; }
      const consumed = armed;
      armed = null;
      return consumed;
    },
    // Disarm a pending abuse commit (admin confirmed a cancel during the ceremony).
    disarmCommit() {
      armed = null;
      cancelArmTimer();
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/3_applications/fitness/identityRelay.test.mjs`
Expected: PASS (all relay tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/identityRelay.mjs backend/src/3_applications/fitness/identityRelay.test.mjs
git commit -m "feat(fitness): server-authoritative abuse lockdown commit

Abuse trips now arm a single-use commit token and schedule a
server-side fallback that locks down even if the browser ceremony
never commits. Fixes the no-pending-detection race that let trips
fizzle without engaging the lock."
```

---

### Task 3: Wire the relay's new deps in `app.mjs`

**Files:**
- Modify: `backend/src/app.mjs` (the `createIdentityRelay({ ... })` call, ~line 1715-1721)

- [ ] **Step 1: Inject `triggerEmergencyLockdown` + `serverCommitDelayMs`**

Replace the `createIdentityRelay({ ... })` call (~line 1715-1721) with:

```javascript
  const identityRelay = createIdentityRelay({
    eventBus,
    userService,
    loadFitnessConfig: () => loadFitnessConfig(householdId) || {},
    getLockdownState,
    triggerEmergencyLockdown,
    serverCommitDelayMs: Number(emergencyConfig?.abuse?.server_commit_delay_ms) > 0
      ? Number(emergencyConfig.abuse.server_commit_delay_ms)
      : undefined,
    logger: emergencyLogger,
  });
```

(`triggerEmergencyLockdown`, `getLockdownState`, and `emergencyConfig` are all already defined above this call — see ~lines 1701-1711. `undefined` lets the relay fall back to `DEFAULT_SERVER_COMMIT_DELAY_MS`.)

- [ ] **Step 2: Verify the backend boots (syntax / wiring check)**

Run: `node --check backend/src/app.mjs`
Expected: no output (exit 0). If `node --check` cannot resolve the `#apps/...` import map, instead run the relay test suite again as a smoke check:
`./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/3_applications/fitness/identityRelay.test.mjs` → PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat(fitness): wire triggerEmergencyLockdown into the identity relay

Enables the server-authoritative abuse commit + the optional
emergency.abuse.server_commit_delay_ms config knob."
```

---

### Task 4: Router — idempotent `/commit` that consumes armed-or-pending

`/commit` no longer 409s after the server already locked (the late browser commit that caused the "unlocked itself" symptom), and it consumes the armed abuse token first, then a generously-aged admin pending.

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs` (`/emergency/commit` handler, ~line 1339-1381; add one module constant)
- Test: `backend/src/4_api/v1/routers/fitness.emergency.test.mjs`

- [ ] **Step 1: Write the failing tests**

In `fitness.emergency.test.mjs`, add inside `describe('fitness router — POST /emergency/commit', ...)`:

```javascript
  it('is idempotent: returns the current lock state without re-triggering when already locked', async () => {
    const getLockdownState = { execute: vi.fn().mockResolvedValue({ lockedUntil: 5000, lockedBy: 'abuse-protection' }) };
    const triggerEmergencyLockdown = { execute: vi.fn() };
    const identityRelay = { consumeArmedCommit: vi.fn(), consumePendingDetection: vi.fn() };
    const { app } = appWith({ getLockdownState, triggerEmergencyLockdown, identityRelay });

    const res = await request(app).post('/emergency/commit').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ locked: true, lockedUntil: 5000, lockedBy: 'abuse-protection' });
    expect(triggerEmergencyLockdown.execute).not.toHaveBeenCalled();
    expect(identityRelay.consumeArmedCommit).not.toHaveBeenCalled();
  });

  it('commits an armed abuse token when present (does not touch pending)', async () => {
    const getLockdownState = { execute: vi.fn().mockResolvedValue(null) };
    const triggerEmergencyLockdown = { execute: vi.fn().mockResolvedValue({ lockedUntil: 3600, lockedBy: 'abuse-protection' }) };
    const identityRelay = {
      consumeArmedCommit: vi.fn(() => ({ userId: 'abuse-protection', at: 1 })),
      consumePendingDetection: vi.fn(),
    };
    const { app } = appWith({ getLockdownState, triggerEmergencyLockdown, identityRelay });

    const res = await request(app).post('/emergency/commit').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ locked: true, lockedUntil: 3600, lockedBy: 'abuse-protection' });
    expect(triggerEmergencyLockdown.execute).toHaveBeenCalledWith(expect.objectContaining({ lockedBy: 'abuse-protection' }));
    expect(identityRelay.consumePendingDetection).not.toHaveBeenCalled();
  });

  it('falls back to a generously-aged pending detection (admin press)', async () => {
    const getLockdownState = { execute: vi.fn().mockResolvedValue(null) };
    const triggerEmergencyLockdown = { execute: vi.fn().mockResolvedValue({ lockedUntil: 3600, lockedBy: 'alice' }) };
    const identityRelay = {
      consumeArmedCommit: vi.fn(() => null),
      consumePendingDetection: vi.fn(() => ({ userId: 'alice', at: 1 })),
    };
    const { app } = appWith({ getLockdownState, triggerEmergencyLockdown, identityRelay });

    const res = await request(app).post('/emergency/commit').send({});

    expect(res.status).toBe(200);
    expect(identityRelay.consumePendingDetection).toHaveBeenCalledWith(expect.any(Number), 120000);
    expect(triggerEmergencyLockdown.execute).toHaveBeenCalledWith(expect.objectContaining({ lockedBy: 'alice' }));
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/fitness.emergency.test.mjs`
Expected: FAIL — the idempotent test gets 409 (no early return), the armed-token test gets 409 (handler doesn't call `consumeArmedCommit`).

- [ ] **Step 3: Add the commit-pending max-age constant**

In `fitness.mjs`, add a module-level constant immediately after the `buildFingerprintIdentityIndex` import (line 45):

```javascript
// Commit (locking down) is the safe direction, so the admin-press pending may be
// consumed within a generous window that covers the on-screen ceremony. Un-locking
// (/abort, /release) keeps the tight default TTL.
const COMMIT_PENDING_MAX_AGE_MS = 120000; // 2 min
```

- [ ] **Step 4: Rewrite the `/commit` handler**

Replace the handler body up to and including the `consumePendingDetection`/`!pending`/`!triggerEmergencyLockdown` guards (currently ~line 1339-1349) with:

```javascript
  router.post('/emergency/commit', asyncHandler(async (req, res) => {
    const now = Math.floor(Date.now() / 1000);
    // Idempotent: if a lockdown is already active (e.g. the server-side abuse
    // fallback already committed), return the current state instead of 409 — so a
    // late browser commit never trips the client's failure path and unlocks.
    const existing = getLockdownState ? await getLockdownState.execute({ now }) : null;
    if (existing) {
      logger?.info?.('emergency.commit_idempotent', { lockedBy: existing.lockedBy });
      return res.json({ locked: true, lockedUntil: existing.lockedUntil, lockedBy: existing.lockedBy });
    }
    // Abuse trips arm a server-authoritative commit token; admin presses stamp a
    // (generously-aged) pending detection. Either authorizes this commit.
    const pending = identityRelay?.consumeArmedCommit?.(Date.now())
      || identityRelay?.consumePendingDetection?.(Date.now(), COMMIT_PENDING_MAX_AGE_MS);
    if (!pending) {
      logger?.warn?.('emergency.commit_rejected', { reason: 'no-pending-detection' });
      return res.status(409).json({ error: 'no-pending-detection' });
    }
    if (!triggerEmergencyLockdown) {
      logger?.warn?.('emergency.commit_rejected', { reason: 'unavailable', lockedBy: pending.userId });
      return res.status(503).json({ error: 'emergency-unavailable' });
    }
```

Everything below that point (the `logger.info('emergency.commit_accepted', ...)`, `triggerEmergencyLockdown.execute(...)`, session-finalize block, and final `res.json(...)`) stays exactly as-is.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/fitness.emergency.test.mjs`
Expected: PASS — including the three pre-existing `/commit` tests (the `relayWith(null)` / `relayWith({userId})` fakes lack `consumeArmedCommit`, so `?.` short-circuits to `consumePendingDetection`, and `getLockdownState` defaults to `null` → no early return).

- [ ] **Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/fitness.mjs backend/src/4_api/v1/routers/fitness.emergency.test.mjs
git commit -m "feat(fitness): idempotent /emergency/commit + armed-token consume

Already-locked → return current state (a late browser commit can no
longer 409 and bounce the kiosk out of LOCKED). Consume the armed
abuse token first, then a generously-aged admin pending."
```

---

### Task 5: Router — `/abort` disarms the armed abuse commit

When an admin confirms a cancel during an abuse ceremony, also cancel the server-side fallback so it can't lock after the abort.

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs` (`/emergency/abort` handler, ~line 1388-1393)
- Test: `backend/src/4_api/v1/routers/fitness.emergency.test.mjs`

- [ ] **Step 1: Write the failing tests**

In `describe('fitness router — POST /emergency/abort', ...)`, add:

```javascript
  it('disarms the armed abuse commit when an admin confirms the cancel', async () => {
    const identityRelay = {
      consumePendingDetection: vi.fn(() => ({ userId: 'alice', at: 1 })),
      disarmCommit: vi.fn(),
    };
    const { app } = appWith({ identityRelay });

    const res = await request(app).post('/emergency/abort').send({});

    expect(res.body).toEqual({ confirmed: true });
    expect(identityRelay.disarmCommit).toHaveBeenCalledTimes(1);
  });

  it('does not disarm when no detection is pending', async () => {
    const identityRelay = {
      consumePendingDetection: vi.fn(() => null),
      disarmCommit: vi.fn(),
    };
    const { app } = appWith({ identityRelay });

    const res = await request(app).post('/emergency/abort').send({});

    expect(res.body).toEqual({ confirmed: false });
    expect(identityRelay.disarmCommit).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/fitness.emergency.test.mjs`
Expected: FAIL — `disarmCommit` is never called (handler doesn't call it yet).

- [ ] **Step 3: Implement the disarm**

Replace the `/emergency/abort` handler (~line 1388-1393) with:

```javascript
  router.post('/emergency/abort', asyncHandler(async (req, res) => {
    const pending = identityRelay?.consumePendingDetection?.(Date.now());
    if (pending) {
      identityRelay?.disarmCommit?.(); // cancel any armed abuse server-commit
      logger?.info?.('emergency.cancelled', { userId: pending.userId });
    } else {
      logger?.info?.('emergency.cancel_denied', { reason: 'no-pending-detection' });
    }
    res.json({ confirmed: !!pending });
  }));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/fitness.emergency.test.mjs`
Expected: PASS (all emergency router tests, including the two pre-existing abort tests — `relayWith` fakes lack `disarmCommit`, so `?.` no-ops).

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/fitness.mjs backend/src/4_api/v1/routers/fitness.emergency.test.mjs
git commit -m "feat(fitness): /emergency/abort disarms the armed abuse commit

A confirmed admin cancel now also cancels the server-side fallback
so it can't lock the gym after the ceremony was aborted."
```

---

### Task 6: Frontend — `commit()` reconciles against server state on failure

Closes the last gap: if a `/commit` POST throws (e.g. network) AFTER the server already locked, don't blindly drop to normal — re-read authoritative state and adopt LOCKED if so.

**Files:**
- Modify: `frontend/src/modules/Fitness/hooks/useEmergencyLockdown.js` (`commit` callback, ~line 177-193)
- Test: `frontend/src/modules/Fitness/hooks/useEmergencyLockdown.test.jsx`

- [ ] **Step 1: Write the failing tests**

In `useEmergencyLockdown.test.jsx`, add inside the top-level `describe('useEmergencyLockdown', ...)`:

```javascript
  it('commit failure reconciles to LOCKED when the server already locked (abuse fallback)', async () => {
    setSearch('?emergency=triggering'); // skip mount GET; start in triggering
    DaylightAPI
      .mockRejectedValueOnce(new Error('HTTP 409: Conflict')) // commit POST
      .mockResolvedValueOnce({ locked: true, lockedUntil: 8888, lockedBy: 'abuse-protection' }); // reconcile GET
    const { result } = renderHook(() => useEmergencyLockdown());
    expect(result.current.phase).toBe('triggering');
    await act(async () => { await result.current.commit(); });
    expect(result.current.phase).toBe('locked');
    expect(result.current.lockedBy).toBe('abuse-protection');
    expect(result.current.lockedUntil).toBe(8888);
  });

  it('commit failure drops to normal when the server is NOT locked', async () => {
    setSearch('?emergency=triggering');
    DaylightAPI
      .mockRejectedValueOnce(new Error('HTTP 409: Conflict')) // commit POST
      .mockResolvedValueOnce({ locked: false }); // reconcile GET
    const { result } = renderHook(() => useEmergencyLockdown());
    await act(async () => { await result.current.commit(); });
    expect(result.current.phase).toBe('normal');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs --exclude '**/.claire/**' frontend/src/modules/Fitness/hooks/useEmergencyLockdown.test.jsx`
Expected: FAIL — the reconcile test ends in `normal` (current catch always calls `enterNormal`).

- [ ] **Step 3: Implement the reconcile**

Replace the `commit` callback's `catch` block (currently ~line 187-192) — change from:

```javascript
    } catch (err) {
      // 409 no-pending-detection (or any failure) → fall back to normal.
      logger().warn('emergency.commit_failed', { message: err?.message ?? null });
      enterNormal('commit-failed');
      return { locked: false };
    }
```
to:
```javascript
    } catch (err) {
      // Don't blindly drop to normal: the server-side abuse fallback may have
      // already locked. Reconcile against authoritative server state first.
      logger().warn('emergency.commit_failed', { message: err?.message ?? null });
      try {
        const st = await DaylightAPI(EMERGENCY_PATH);
        if (st && st.locked) {
          enterLocked(st.lockedUntil ?? null, st.lockedBy ?? null);
          return { locked: true };
        }
      } catch (reconcileErr) {
        logger().warn('emergency.commit_reconcile_failed', { message: reconcileErr?.message ?? null });
      }
      enterNormal('commit-failed');
      return { locked: false };
    }
```

(`enterLocked` is already in the `commit` callback's dependency array — no dep-array change needed.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs --exclude '**/.claire/**' frontend/src/modules/Fitness/hooks/useEmergencyLockdown.test.jsx`
Expected: PASS (all hook tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/hooks/useEmergencyLockdown.js frontend/src/modules/Fitness/hooks/useEmergencyLockdown.test.jsx
git commit -m "fix(fitness): commit() reconciles to LOCKED on failure

A failed /commit no longer bounces the kiosk out of LOCKED when the
server-side abuse fallback already engaged the lock — it re-reads
authoritative state and adopts it."
```

---

### Task 7: Docs — update the emergency-lockdown runbook

**Files:**
- Modify: `docs/runbooks/fitness-emergency-lockdown.md`

- [ ] **Step 1: Rewrite the "Automatic trip on scanner abuse" section**

Replace the paragraph describing how the trip locks (the sentence ending "…then broadcast as `fitness.emergency.ceremony` to start the overlay.") with:

```markdown
On `emergency.abuse.threshold` failures within `emergency.abuse.window_sec` the
relay **arms a server-authoritative commit** and broadcasts
`fitness.emergency.ceremony` to start the DEFCON overlay. The lock no longer
depends on the browser finishing its ceremony: if the kiosk commits first
(normal case) it locks immediately; otherwise the relay commits the lockdown
itself `emergency.abuse.server_commit_delay_ms` after the trip (default 25s).
An **admin scan during the ceremony still aborts it** — the abort disarms the
server commit. The lock records `lockedBy: abuse-protection`. `/emergency/commit`
is idempotent (an already-active lock returns the current state, never a 409),
so a late or duplicate browser commit can never bounce the kiosk out of LOCKED.
```

- [ ] **Step 2: Document the new config knob**

In the `### Configuration` YAML block, under `abuse:`, add the `server_commit_delay_ms` line so it reads:

```yaml
  abuse:                             # scanner-abuse auto-lockdown (default ON)
    enabled: true                    # set false to disable entirely
    threshold: 3                     # failed scans to trip
    window_sec: 30                   # sliding window for the count
    server_commit_delay_ms: 25000    # server-side fallback commit delay after a trip
```

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/fitness-emergency-lockdown.md
git commit -m "docs(fitness): document server-authoritative abuse lockdown commit"
```

---

## Final verification (run before handing back)

- [ ] **Run all touched suites together:**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  backend/src/3_applications/fitness/identityRelay.test.mjs \
  backend/src/4_api/v1/routers/fitness.emergency.test.mjs && \
./node_modules/.bin/vitest run --config vitest.config.mjs --exclude '**/.claire/**' \
  frontend/src/modules/Fitness/hooks/useEmergencyLockdown.test.jsx
```
Expected: all PASS. Grep the summary line for `failed` to confirm a real green (a piped tail can mask the runner's exit code).

- [ ] **Do NOT build or deploy.** Report the green suites and the commit list, then wait for the user's deploy signal.

---

## Self-review notes (author)

- **Spec coverage:** server-authoritative commit (Task 2) + wiring (Task 3) is the core guarantee; idempotent commit (Task 4) + reconcile (Task 6) prevent the "locked then unlocked" regression; disarm (Task 5) preserves the abort affordance; per-call max-age (Task 1) fixes the parallel admin-press race while keeping un-lock tight. Runbook (Task 7) documents it.
- **Token shape:** the armed token is `{ userId, at }` — same shape the router reads as `pending.userId` and that `consumePendingDetection` returns — so `/commit` treats armed and pending uniformly.
- **Naming consistency:** `consumeArmedCommit` / `disarmCommit` / `armCommit` used identically across relay, relay tests, router, and router tests.
- **Backward compat:** existing router tests use `relayWith(...)` fakes without the new methods; optional chaining (`?.`) makes those calls no-op/short-circuit, and `getLockdownState` defaults to `null` (no early return), so the pre-existing `/commit` and `/abort` tests stay green.
