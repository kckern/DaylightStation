# Fitness Emergency Lockdown Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task.

**Goal:** Let an admin trigger a dramatic, reversible, reboot-persistent "emergency shutoff" of the garage by pressing their fingerprint on the garage reader in any normal context (no unlock modal open), shutting down all garage devices via Home Assistant after a short on-screen "DEFCON" ceremony.

**Architecture:** Backend-driven detection keeps an `emergency` fingerprint scan armed against the garage box; an admin match broadcasts `fitness.emergency.detected` over the existing websocket. The FitnessApp (Firefox kiosk) runs the audio ceremony with a cancel window, then POSTs `commit`, at which point the backend fires the `garage_deactivate` HA script and persists a server-side lockdown record (default 30 min, survives reboot). A deliberate press-and-hold gesture summons an admin unlock-scan to release early. All backend logic respects the DDD layering (domain value object → ports → adapters → use cases → API).

**Tech Stack:** Node ESM backend (`node:test`), React 18 frontend (Mantine), existing WebSocket eventbus, FileIO YAML persistence, Home Assistant gateway, structured logging framework.

**Reference docs:**
- Design: `docs/_wip/plans/2026-06-17-fitness-emergency-lockdown-design.md`
- DDD: `docs/reference/core/layers-of-abstraction/ddd-reference.md`
- Logging: `CLAUDE.md` → Logging section (frontend uses `getLogger().child(...)`)

**Key existing files to model after:**
- Unlock service singleton: `backend/src/3_applications/fitness/unlockService.mjs` + test `unlockService.test.mjs`
- Candidate resolution: `backend/src/3_applications/fitness/unlockPolicy.mjs` (`resolveCandidateUuids`)
- Unlock endpoint + router deps: `backend/src/4_api/v1/routers/fitness.mjs` (`createFitnessRouter`, lines ~1325–1380; test seam `resolveUnlockService`)
- Router test pattern: `backend/src/4_api/v1/routers/fitness.unlock.test.mjs`
- Bootstrap wiring: `backend/src/app.mjs:442` (`initUnlockService`), `backend/src/0_system/bootstrap.mjs:1113` (`createFitnessRouter({...})`)
- HA call: `backend/src/app.mjs:1466` (`haGateway.callService('script','turn_on',{ entity_id })`)
- Frontend unlock hook: `frontend/src/modules/Fitness/hooks/useUnlock.js`
- Frontend WS: `frontend/src/services/WebSocketService.js` (`wsService.subscribe(filter, cb)`)
- Cue audio: `frontend/src/modules/Fitness/player/hooks/audioCuePlayer.js`, `useGovernanceAudioDuck.js` (`primeCueAudio`, `playCueOnce`)
- An existing yaml datastore to copy structure from: `backend/src/1_adapters/persistence/yaml/YamlUserProfileDatastore.mjs`

**Commit policy:** This is feature work; per `feedback_commit_policy_feature_branches`, per-task commits are fine **on a feature branch/worktree**. Do NOT push or merge to main without explicit user approval.

---

## Pre-flight (do once, do not skip)

1. Confirm you are on a feature branch or worktree, not `main`:
   ```bash
   git branch --show-current
   ```
2. Confirm backend tests run:
   ```bash
   node --test backend/src/3_applications/fitness/unlockService.test.mjs
   ```
   Expected: existing unlock tests PASS. If the runner differs, check `package.json` scripts (`npm test`, `node --test`).
3. **Live-garage caveat (integration checkpoint, not a code task):** the backend detector keeps a fingerprint scan continuously re-armed against the garage bridge (`_extensions/fitness/src/server.mjs`). Unit tests use a fake bus, so they don't exercise this. Before relying on it in production, verify with the user that the garage bridge tolerates continuous re-arming and that a normal unlock still wins the reader (see Task 6 arbiter). Flag this explicitly when handing back.

---

## Task 1: `LockdownState` value object (domain, pure)

**Files:**
- Create: `backend/src/2_domains/fitness/value-objects/LockdownState.mjs`
- Test: `backend/src/2_domains/fitness/value-objects/LockdownState.test.mjs`

**Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LockdownState } from './LockdownState.mjs';

test('isActive is true before lockedUntil and false at/after it', () => {
  const s = LockdownState.create({ lockedBy: 'alice', durationSec: 1800, now: 1000 });
  assert.equal(s.lockedAt, 1000);
  assert.equal(s.lockedUntil, 1000 + 1800);
  assert.equal(s.isActive(1000), true);
  assert.equal(s.isActive(1000 + 1799), true);
  assert.equal(s.isActive(1000 + 1800), false);
  assert.equal(s.isActive(1000 + 5000), false);
});

test('is immutable and round-trips through toData/fromData', () => {
  const s = LockdownState.create({ lockedBy: 'bob', durationSec: 60, now: 500 });
  assert.throws(() => { s.lockedBy = 'mallory'; });
  const again = LockdownState.fromData(s.toData());
  assert.deepEqual(again.toData(), s.toData());
});

test('create rejects bad input', () => {
  assert.throws(() => LockdownState.create({ lockedBy: '', durationSec: 60, now: 1 }));
  assert.throws(() => LockdownState.create({ lockedBy: 'a', durationSec: 0, now: 1 }));
});
```

**Step 2: Run it, confirm it fails** (`node --test backend/src/2_domains/fitness/value-objects/LockdownState.test.mjs`) — Expected: FAIL (module not found).

**Step 3: Implement**

```javascript
// backend/src/2_domains/fitness/value-objects/LockdownState.mjs

/**
 * Emergency lockdown state. Times are UNIX epoch SECONDS.
 * Pure value object: immutable, no I/O.
 */
export class LockdownState {
  #lockedUntil;
  #lockedBy;
  #lockedAt;

  constructor({ lockedUntil, lockedBy, lockedAt }) {
    if (!lockedBy || typeof lockedBy !== 'string') {
      throw new Error('LockdownState: lockedBy (string) required');
    }
    if (!Number.isFinite(lockedUntil) || !Number.isFinite(lockedAt) || lockedUntil <= lockedAt) {
      throw new Error('LockdownState: lockedUntil must be a finite epoch after lockedAt');
    }
    this.#lockedUntil = lockedUntil;
    this.#lockedBy = lockedBy;
    this.#lockedAt = lockedAt;
    Object.freeze(this);
  }

  get lockedUntil() { return this.#lockedUntil; }
  get lockedBy() { return this.#lockedBy; }
  get lockedAt() { return this.#lockedAt; }

  /** @param {number} now epoch seconds */
  isActive(now) { return now < this.#lockedUntil; }

  toData() {
    return { lockedUntil: this.#lockedUntil, lockedBy: this.#lockedBy, lockedAt: this.#lockedAt };
  }

  static fromData(data) { return new LockdownState(data); }

  static create({ lockedBy, durationSec, now }) {
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      throw new Error('LockdownState.create: durationSec must be > 0');
    }
    return new LockdownState({ lockedBy, lockedAt: now, lockedUntil: now + durationSec });
  }
}
```

**Step 4: Run, confirm PASS. Step 5: Commit** (`feat(fitness): LockdownState value object`).

---

## Task 2: `IEmergencyLockRepository` port

**Files:**
- Create: `backend/src/3_applications/fitness/ports/IEmergencyLockRepository.mjs`

No test (interface stub). Implement:

```javascript
// backend/src/3_applications/fitness/ports/IEmergencyLockRepository.mjs

/**
 * @interface IEmergencyLockRepository
 * Persists the single current emergency LockdownState (or null when unlocked).
 */
export class IEmergencyLockRepository {
  /** @returns {Promise<import('#domains/fitness/value-objects/LockdownState.mjs').LockdownState|null>} */
  async load() { throw new Error('IEmergencyLockRepository.load must be implemented'); }
  /** @param {object} state LockdownState */
  async save(state) { throw new Error('IEmergencyLockRepository.save must be implemented'); }
  async clear() { throw new Error('IEmergencyLockRepository.clear must be implemented'); }
}
```

> Use the `#domains/...` / `#apps/...` import aliases used elsewhere in the repo (check `package.json` `imports`). If aliases differ, match the surrounding files.

**Commit** (`feat(fitness): IEmergencyLockRepository port`).

---

## Task 3: `YamlEmergencyLockDatastore` adapter

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlEmergencyLockDatastore.mjs`
- Test: `backend/src/1_adapters/persistence/yaml/YamlEmergencyLockDatastore.test.mjs`

**First read** `backend/src/1_adapters/persistence/yaml/YamlUserProfileDatastore.mjs` to copy its FileIO/config conventions (how it resolves the household data dir and reads/writes YAML). Mirror that exact style — do not invent a new IO path.

**Behavior:**
- File path: `<dataDir>/household[-{hid}]/history/fitness/emergency_lock.yml` (use the same household-path helper the profile datastore uses; default household when none).
- `load()` → reads YAML; returns `LockdownState.fromData(...)` or `null` if file missing/empty.
- `save(state)` → writes `state.toData()` as YAML (ensure dir exists).
- `clear()` → deletes the file (or writes empty); `load()` must then return `null`.

**Test** with a temp dir + injected FileIO/config (follow the profile datastore test if one exists; otherwise inject a fake `fileIO` with in-memory read/write). Assert save→load round-trips a `LockdownState`, and clear→load returns `null`.

**Run, confirm PASS. Commit** (`feat(fitness): YamlEmergencyLockDatastore`).

---

## Task 4: Use cases (application layer)

**Files:**
- Create: `backend/src/3_applications/fitness/usecases/TriggerEmergencyLockdown.mjs`
- Create: `backend/src/3_applications/fitness/usecases/ReleaseEmergencyLockdown.mjs`
- Create: `backend/src/3_applications/fitness/usecases/GetLockdownState.mjs`
- Test: `backend/src/3_applications/fitness/usecases/EmergencyLockdown.test.mjs`

**Step 1: Failing test** (fakes for repo + haGateway + eventBus + clock):

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TriggerEmergencyLockdown } from './TriggerEmergencyLockdown.mjs';
import { ReleaseEmergencyLockdown } from './ReleaseEmergencyLockdown.mjs';
import { GetLockdownState } from './GetLockdownState.mjs';

function makeFakes() {
  let stored = null;
  const repo = {
    async load() { return stored; },
    async save(s) { stored = s; },
    async clear() { stored = null; },
  };
  const haCalls = [];
  const haGateway = { async callService(d, s, data) { haCalls.push({ d, s, data }); return { ok: true }; } };
  const broadcasts = [];
  const eventBus = { broadcast: (topic, payload) => broadcasts.push({ topic, payload }) };
  return { repo, haGateway, haCalls, eventBus, broadcasts };
}

test('trigger persists state, fires HA script, broadcasts locked', async () => {
  const { repo, haGateway, haCalls, eventBus, broadcasts } = makeFakes();
  const uc = new TriggerEmergencyLockdown({ repo, haGateway, eventBus, scriptId: 'garage_deactivate', defaultDurationSec: 1800 });
  const state = await uc.execute({ lockedBy: 'alice', now: 1000 });
  assert.equal(state.lockedUntil, 2800);
  assert.deepEqual(haCalls[0], { d: 'script', s: 'turn_on', data: { entity_id: 'script.garage_deactivate' } });
  assert.equal(broadcasts.at(-1).topic, 'fitness.emergency.locked');
  assert.equal((await repo.load()).lockedBy, 'alice');
});

test('release clears state and broadcasts released', async () => {
  const { repo, haGateway, eventBus, broadcasts } = makeFakes();
  await new TriggerEmergencyLockdown({ repo, haGateway, eventBus, scriptId: 'garage_deactivate', defaultDurationSec: 1800 }).execute({ lockedBy: 'alice', now: 1000 });
  await new ReleaseEmergencyLockdown({ repo, eventBus }).execute({ by: 'admin', now: 1500 });
  assert.equal(await repo.load(), null);
  assert.equal(broadcasts.at(-1).topic, 'fitness.emergency.released');
});

test('GetLockdownState returns null and self-clears once expired', async () => {
  const { repo, haGateway, eventBus } = makeFakes();
  await new TriggerEmergencyLockdown({ repo, haGateway, eventBus, scriptId: 'garage_deactivate', defaultDurationSec: 100 }).execute({ lockedBy: 'alice', now: 1000 });
  const get = new GetLockdownState({ repo });
  assert.equal((await get.execute({ now: 1050 }))?.lockedBy, 'alice'); // still active
  assert.equal(await get.execute({ now: 1100 }), null);                // expired → null
  assert.equal(await repo.load(), null);                               // self-cleared
});
```

**Step 3: Implement.** Each use case takes abstract deps (no concrete adapters), coordinates, returns the domain entity (or null). Example:

```javascript
// TriggerEmergencyLockdown.mjs
import { LockdownState } from '#domains/fitness/value-objects/LockdownState.mjs';

export class TriggerEmergencyLockdown {
  #repo; #haGateway; #eventBus; #scriptId; #defaultDurationSec; #logger;
  constructor({ repo, haGateway, eventBus, scriptId, defaultDurationSec = 1800, logger } = {}) {
    if (!repo || !haGateway || !eventBus) throw new Error('TriggerEmergencyLockdown: repo, haGateway, eventBus required');
    this.#repo = repo; this.#haGateway = haGateway; this.#eventBus = eventBus;
    this.#scriptId = scriptId; this.#defaultDurationSec = defaultDurationSec; this.#logger = logger || console;
  }
  async execute({ lockedBy, durationSec, now }) {
    const state = LockdownState.create({ lockedBy, durationSec: durationSec ?? this.#defaultDurationSec, now });
    await this.#repo.save(state);
    const entity = this.#scriptId.startsWith('script.') ? this.#scriptId : `script.${this.#scriptId}`;
    await this.#haGateway.callService('script', 'turn_on', { entity_id: entity });
    this.#logger.info?.('emergency.ha_fired', { entity });
    this.#eventBus.broadcast('fitness.emergency.locked', { lockedUntil: state.lockedUntil, lockedBy: state.lockedBy, lockedAt: state.lockedAt });
    this.#logger.info?.('emergency.locked', { lockedBy, until: state.lockedUntil });
    return state;
  }
}
```

`ReleaseEmergencyLockdown.execute({ by, now })` → `repo.clear()`, broadcast `fitness.emergency.released` `{ by }`, log `emergency.released`.
`GetLockdownState.execute({ now })` → `const s = await repo.load(); if (!s) return null; if (!s.isActive(now)) { await repo.clear(); return null; } return s;`

**Step 4: Run, confirm PASS. Step 5: Commit** (`feat(fitness): emergency lockdown use cases`).

---

## Task 5: Emergency candidate resolution helper

The detector and the release/abort scans need the admin candidate UUIDs for the `emergency` lock. Reuse `resolveCandidateUuids`.

**Files:**
- Create: `backend/src/3_applications/fitness/emergencyPolicy.mjs`
- Test: `backend/src/3_applications/fitness/emergencyPolicy.test.mjs`

```javascript
// emergencyPolicy.mjs
import { resolveCandidateUuids } from './unlockPolicy.mjs';

export const EMERGENCY_LOCK = 'emergency';

/**
 * Build the candidate fingerprint UUIDs for the emergency lock from config + profiles.
 * @returns {Array<{uuid:string, username:string}>}
 */
export function resolveEmergencyCandidates({ fitnessConfig, userService }) {
  const authorized = fitnessConfig?.locks?.[EMERGENCY_LOCK];
  if (!Array.isArray(authorized) || authorized.length === 0) return [];
  const profilesByUser = {};
  for (const username of authorized) {
    const profile = userService?.getProfile?.(username);
    if (profile) profilesByUser[username] = profile;
  }
  return resolveCandidateUuids(fitnessConfig, profilesByUser, EMERGENCY_LOCK);
}
```

Test with a fake `userService.getProfile` returning a profile carrying `identities.fingerprints` and a config with `locks.emergency: ['alice']`; assert it returns alice's UUIDs. (Read `unlockPolicy.mjs` first to match the exact profile shape it expects.)

**Run, confirm PASS. Commit** (`feat(fitness): emergency candidate resolution`).

---

## Task 6: Reader-contention arbiter in `unlockService`

The background detector must not hold the reader armed while a normal (foreground) unlock runs. Add a tiny single-flight gate to `unlockService.mjs`.

**Files:**
- Modify: `backend/src/3_applications/fitness/unlockService.mjs`
- Test: add cases to `backend/src/3_applications/fitness/unlockService.test.mjs`

**Add to the singleton object** (alongside `requestUnlock`):

```javascript
// module-scoped, above initUnlockService:
let foregroundActive = 0;

// inside the singleton object:
beginForeground() { foregroundActive++; },
endForeground() { foregroundActive = Math.max(0, foregroundActive - 1); },
isForegroundActive() { return foregroundActive > 0; },
```

Export a helper used by the detector:
```javascript
export function isUnlockForegroundActive() { return getUnlockService()?.isForegroundActive?.() === true; }
```

**Test:** `beginForeground()` makes `isForegroundActive()` true; `endForeground()` returns to false; never goes negative. Reset between tests via `_resetUnlockServiceForTests`.

**Run, confirm PASS. Commit** (`feat(fitness): foreground-unlock arbiter for reader contention`).

---

## Task 7: Backend emergency detector loop

A long-running service: while no foreground unlock is active and not already locked, keep the `emergency` scan armed; on an admin match, broadcast `fitness.emergency.detected` and record a short-lived pending detection (so `commit` can validate it). Uses a **short re-arm timeout** so a foreground unlock waits at most a few seconds.

**Files:**
- Create: `backend/src/3_applications/fitness/emergencyDetector.mjs`
- Test: `backend/src/3_applications/fitness/emergencyDetector.test.mjs`

**Design:**
```javascript
// emergencyDetector.mjs
import { resolveEmergencyCandidates } from './emergencyPolicy.mjs';

const DEFAULT_ARM_TIMEOUT_MS = 8000;
const PENDING_TTL_MS = 30000;

export function createEmergencyDetector({
  unlockService,          // { requestUnlock, isForegroundActive }
  eventBus,               // { broadcast }
  loadFitnessConfig,      // () => fitnessConfig (raw, for default household)
  userService,            // { getProfile }
  isLocked,               // async () => boolean (true while a lockdown is committed)
  clock = () => Date.now(),
  armTimeoutMs = DEFAULT_ARM_TIMEOUT_MS,
  logger = console,
} = {}) {
  let running = false;
  let pending = null; // { userId, at }

  async function loop() {
    while (running) {
      try {
        if (unlockService.isForegroundActive?.() || await isLocked()) {
          await delay(500); continue;
        }
        const fitnessConfig = loadFitnessConfig() || {};
        const candidates = resolveEmergencyCandidates({ fitnessConfig, userService });
        if (candidates.length === 0) { await delay(2000); continue; }
        logger.debug?.('emergency.armed', { candidates: candidates.length });
        const result = await unlockService.requestUnlock('emergency', candidates, { timeoutMs: armTimeoutMs });
        if (result?.matched) {
          pending = { userId: result.userId, at: clock() };
          logger.info?.('emergency.detected', { userId: result.userId });
          eventBus.broadcast('fitness.emergency.detected', { userId: result.userId, at: pending.at });
          // brief settle so we don't immediately re-arm and capture the same finger
          await delay(1500);
        }
      } catch (err) {
        logger.warn?.('emergency.detector_error', { error: err?.message });
        await delay(1000);
      }
    }
  }

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  return {
    start() { if (running) return; running = true; loop(); logger.info?.('emergency.detector_started'); },
    stop() { running = false; },
    consumePendingDetection(now = clock()) {
      if (pending && (now - pending.at) <= PENDING_TTL_MS) { const p = pending; pending = null; return p; }
      pending = null; return null;
    },
  };
}
```

> **`requestUnlock` timeout arg:** the current `requestUnlock(lockName, candidates)` has no per-call timeout — it uses the broker's default (15s). Add an optional 3rd arg `{ timeoutMs }` to `broker.requestUnlock`/`unlockService.requestUnlock` so the detector can use a short arm window. Update `unlockBroker.mjs` + `unlockService.mjs` and their tests. Keep the default behavior unchanged when the arg is omitted. (Read `unlockBroker.mjs` first.)

**Test (fakes, fake timers or tiny real delays):**
- A fake `unlockService.requestUnlock` that returns `{matched:true, userId:'alice'}` once → assert `fitness.emergency.detected` broadcast with `userId:'alice'` and `consumePendingDetection()` returns it; a second immediate call returns `null`.
- When `isForegroundActive()` is true, `requestUnlock` is NOT called.
- When `isLocked()` resolves true, `requestUnlock` is NOT called.
- `consumePendingDetection` returns `null` after `PENDING_TTL_MS`.

Keep tests fast: inject `armTimeoutMs` small and `clock`; have `start()` then `stop()` after assertions; await a microtask/short delay to let the loop run once.

**Run, confirm PASS. Commit** (`feat(fitness): backend emergency detector loop`).

---

## Task 8: Wire detector + repo at bootstrap

**Files:**
- Modify: `backend/src/app.mjs` (near line 442, after `initUnlockService`)
- Modify: `backend/src/0_system/bootstrap.mjs` (near 1113, `createFitnessRouter({...})`)

**In `app.mjs`** after `initUnlockService(...)`:
- Construct `const emergencyLockRepo = new YamlEmergencyLockDatastore({ configService, fileIO: /* same as profile datastore */ });`
- Resolve `const haGateway = householdAdapters?.has?.('home_automation') ? householdAdapters.get('home_automation') : null;` (pattern already used at line 1436/1697).
- Build the use cases (`TriggerEmergencyLockdown`, `ReleaseEmergencyLockdown`, `GetLockdownState`) with `defaultDurationSec`/`scriptId` from config (see Task 11).
- Construct and `.start()` the detector:
  ```javascript
  const emergencyDetector = createEmergencyDetector({
    unlockService: getUnlockService(),
    eventBus,
    loadFitnessConfig: () => fitnessConfigService?.loadRawConfig?.(configService.getDefaultHouseholdId()) || {},
    userService,
    isLocked: async () => !!(await getLockdownState.execute({ now: Math.floor(Date.now()/1000) })),
    logger: rootLogger.child({ module: 'fitness-emergency' }),
  });
  emergencyDetector.start();
  ```
- Export/pass the use cases + `emergencyDetector` into the fitness router deps. The cleanest seam: have the fitness-services/bootstrap layer assemble these and pass them to `createFitnessRouter` (mirror how `generateSessionTimelapse` is built in `bootstrap.mjs` and injected). If `app.mjs` builds them, thread them through to `bootstrap.mjs`'s `createFitnessRouter({...})` call.

> Match the existing dependency-injection seams. Do NOT have the router import these as module singletons except via a test-seam resolver (mirror `resolveUnlockService`).

**Manual verify:** `node backend/index.js` (or the dev server) starts without throwing and logs `emergency.detector_started`. (Detector will idle-loop harmlessly if no garage bridge is connected — `requestUnlock` just times out and re-arms.)

**Commit** (`feat(fitness): wire emergency detector + repo at bootstrap`).

---

## Task 9: API endpoints in fitness router

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs` (add deps + 4 routes)
- Test: `backend/src/4_api/v1/routers/fitness.emergency.test.mjs`

**Add router deps** (in the `createFitnessRouter` destructure, with test-seam defaults like `resolveUnlockService`):
```javascript
triggerEmergencyLockdown,   // use case instance
releaseEmergencyLockdown,
getLockdownState,
emergencyDetector,          // for consumePendingDetection()
resolveEmergencyCandidates: resolveEmergencyCandidatesFn = resolveEmergencyCandidates, // from emergencyPolicy
```

**Routes** (all under the existing fitness mount; `now = Math.floor(Date.now()/1000)`):

1. `GET /emergency` → 
   ```javascript
   const state = await getLockdownState.execute({ now });
   res.json(state ? { locked: true, lockedUntil: state.lockedUntil, lockedBy: state.lockedBy } : { locked: false });
   ```

2. `POST /emergency/commit` → finalize after the browser ceremony.
   ```javascript
   const pending = emergencyDetector?.consumePendingDetection?.(Date.now());
   if (!pending) return res.status(409).json({ error: 'no-pending-detection' });
   const state = await triggerEmergencyLockdown.execute({ lockedBy: pending.userId, now });
   res.json({ locked: true, lockedUntil: state.lockedUntil, lockedBy: state.lockedBy });
   ```
   (Tying commit to a recent detection prevents arbitrary clients from triggering a shutdown.)

3. `POST /emergency/abort` → confirm a cancel with an admin scan.
   ```javascript
   const verdict = await scanEmergency(req); // helper below
   if (verdict.matched) logger.info?.('emergency.cancelled', { userId: verdict.userId });
   res.json({ confirmed: !!verdict.matched });
   ```

4. `POST /emergency/release` → release an active lockdown with an admin scan.
   ```javascript
   const verdict = await scanEmergency(req);
   if (!verdict.matched) return res.json({ released: false });
   await releaseEmergencyLockdown.execute({ by: verdict.userId, now });
   res.json({ released: true });
   ```

**`scanEmergency(req)` helper** (server-side admin scan, with the arbiter so the detector yields the reader):
```javascript
async function scanEmergency(req) {
  const householdId = req.query.household || configService.getDefaultHouseholdId();
  const fitnessConfig = fitnessConfigService?.loadRawConfig?.(householdId) || {};
  const candidates = resolveEmergencyCandidatesFn({ fitnessConfig, userService });
  const unlockService = resolveUnlockService?.();
  if (!unlockService || candidates.length === 0) return { matched: false, reason: 'unavailable' };
  unlockService.beginForeground?.();
  try {
    return await unlockService.requestUnlock('emergency', candidates);
  } finally {
    unlockService.endForeground?.();
  }
}
```

**Test** (`fitness.emergency.test.mjs`, model after `fitness.unlock.test.mjs`): build the router with fake use cases + a fake `emergencyDetector` + a fake `resolveUnlockService`. Assert:
- `GET /emergency` reflects `getLockdownState` (locked + unlocked cases).
- `POST /emergency/commit` 409s when no pending detection; succeeds + returns lockedUntil when `consumePendingDetection` yields a user.
- `POST /emergency/release` calls `releaseEmergencyLockdown` only when the fake scan matches; `{released:false}` otherwise.
- `POST /emergency/abort` returns `{confirmed:true}` on match.

**Run, confirm PASS. Commit** (`feat(fitness): emergency lockdown API endpoints`).

---

## Task 10: Wire router deps end-to-end

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs` (`createFitnessRouter({...})` call) and/or `app.mjs` to pass the Task 8 instances (`triggerEmergencyLockdown`, `releaseEmergencyLockdown`, `getLockdownState`, `emergencyDetector`).

Confirm the running server answers `GET /api/v1/fitness/emergency` with `{ locked: false }`:
```bash
curl -s localhost:3112/api/v1/fitness/emergency   # backend port on kckern-macbook; confirm via settings.local.json
```
Expected: `{"locked":false}`.

**Commit** (`feat(fitness): inject emergency use cases into router`).

---

## Task 11: Config knobs

**Files:**
- Modify: the household fitness config `data/household/apps/fitness/config.yml` (the file `fitnessConfigService.loadRawConfig` reads). Add:
  ```yaml
  locks:
    emergency: [ <admin-username>, ... ]   # admins authorized to trigger/release
  emergency:
    duration_sec: 1800
    ha_script: garage_deactivate
    audio: apps/fitness/ux/powerdown.mp3
  ```
- Modify bootstrap/app wiring to read `emergency.duration_sec` and `emergency.ha_script` into the `TriggerEmergencyLockdown` deps (fallback to `1800` / `garage_deactivate`).
- The frontend reads `emergency.audio` from the already-unified config (add `'emergency'` to the `unifyKeys` array in `FitnessApp.jsx` line ~989 so `fitness.emergency` is visible to the context).

> Use a real admin username from the existing profiles (NOT a hardcoded PII value in any committed test — per `feedback_no_pii_in_test_fixtures`, tests use `test-user`). The config edit is environment data, not a test fixture.

**Commit** (`feat(fitness): emergency lockdown config knobs`).

---

## Task 12: Download the power-off SVG asset

**Files:**
- Create: `frontend/src/modules/Fitness/player/overlays/assets/power-off.svg` (or the nearest existing SVG-asset location — search for how other fitness SVGs are imported).

```bash
curl -sL https://www.svgrepo.com/download/352368/power-off.svg \
  -o frontend/src/modules/Fitness/player/overlays/assets/power-off.svg
# Verify it's SVG, not an HTML error page:
head -c 80 frontend/src/modules/Fitness/player/overlays/assets/power-off.svg
```
Expected: starts with `<?xml` or `<svg`. If it's HTML, use the `svgrepo-icons` skill instead.

**Commit** (`chore(fitness): power-off glyph asset`).

---

## Task 13: `useEmergencyLockdown` hook (frontend state machine)

**Files:**
- Create: `frontend/src/modules/Fitness/hooks/useEmergencyLockdown.js`
- Test: `frontend/src/modules/Fitness/hooks/useEmergencyLockdown.test.jsx` (if the frontend has a test runner; otherwise rely on Task 15 Playwright + manual verify and note it)

**Responsibilities:**
- On mount: `GET /api/v1/fitness/emergency`; if `locked`, enter `locked` with `lockedUntil`.
- Subscribe via `wsService.subscribe(['fitness.emergency.detected','fitness.emergency.locked','fitness.emergency.released'], handler)`.
  - `detected` → enter `triggering` (start audio ceremony).
  - `locked` → enter `locked` with `lockedUntil` (covers the commit echo + cross-device).
  - `released` → return to `normal`.
- Expose: `{ phase: 'normal'|'triggering'|'locked', lockedUntil, lockedBy, commit(), abort(), release(), audioRef }`.
- `commit()` → `POST /api/v1/fitness/emergency/commit` (called by the overlay when the mp3 ends, if not cancelled).
- `abort()` → `POST /api/v1/fitness/emergency/abort`; on `{confirmed:true}` → `normal`.
- `release()` → `POST /api/v1/fitness/emergency/release`; on `{released:true}` → `normal`.
- While `locked`, set a timer for `(lockedUntil - now)`; on expiry re-`GET /emergency` and drop to `normal` if cleared.
- **Logging:** child logger `component:'emergency'`; emit `emergency.detected`, `emergency.triggering`, `emergency.committed`, `emergency.cancelled`, `emergency.locked`, `emergency.released` at transitions.

Use `DaylightAPI` for POSTs (see `useUnlock.js`). Keep all timers cleaned up on unmount.

**Commit** (`feat(fitness): useEmergencyLockdown hook`).

---

## Task 14: `EmergencyLockdownOverlay` component + styles

**Files:**
- Create: `frontend/src/modules/Fitness/player/overlays/EmergencyLockdownOverlay.jsx`
- Create: `frontend/src/modules/Fitness/player/overlays/EmergencyLockdownOverlay.scss`
- Modify: `frontend/src/Apps/FitnessApp.jsx` — render `<EmergencyLockdownOverlay />` inside `FitnessProvider` (near `<GlobalOverlays />`), passing the `emergency.audio` media path.

**`triggering` screen:**
- Full-viewport fixed overlay, very high `zIndex` (above the player's 1000). Black bg, deep-red radial vignette.
- `power-off.svg` centered, large, red glow: `filter: drop-shadow(0 0 40px #ff1a1a)` + a breathing `@keyframes emergencyPulse` (scale/opacity). This overlay is NOT inside `.menu-items-container`, so CSS animation runs (see design note + memory `Menu Animation Kill`).
- Status text "SYSTEM LOCKDOWN INITIATED" (Roboto Condensed — the canon font, per `feedback_roboto_condensed_is_canon`; get drama from color/glow, not a new typeface).
- Thin progress bar bound to audio `currentTime/duration`.
- Low-contrast **Cancel** button bottom corner, visible only while audio plays. Tap → swap label to "SCAN TO CONFIRM CANCEL", call `abort()`. On confirmed abort → overlay returns to normal.
- **Audio:** play `emergency.audio` through the shared cue-audio element so the garage Firefox autoplay gate doesn't swallow it (`primeCueAudio` was already called on a prior gesture; reuse `playCueOnce` plumbing OR an explicit `<audio>` element you `prime` on first app gesture). Attach an `ended` handler → if not cancelled, call `commit()`. (Fallback if no `ended` available: a timer set to the audio duration.)

**`locked` screen:**
- Same aesthetic, calmer: glyph dimmed (no pulse, lower opacity), message "LOCKED" + "Back at H:MM" (format `lockedUntil`).
- Captures all pointer/key events (inert): a full-screen catcher that `preventDefault`s normal interaction.
- **Press-and-hold anywhere 3s** → call `release()` (which runs the server-side admin scan); show a subtle "scanning…" affordance while the POST is in flight. On `{released:true}` → normal.

**Manual verification (per `feedback_dont_ask_check_yourself` — verify yourself, don't ask the user to look):** use a vision-capable check. Drive the overlay locally by temporarily forcing `phase='triggering'`/`'locked'` (or fire a fake `fitness.emergency.*` ws message) and screenshot via the existing session-chart screenshot harness pattern (`tests/_scratch/shoot-session-chart.mjs` — see memory `Fitness Chart Viz Verify`). Confirm: black/red DEFCON look, glyph glow, cancel button, and the locked screen's release time. Iterate on the SCSS until it reads as "DEFCON 1."

**Commit** (`feat(fitness): emergency lockdown overlay + DEFCON styling`).

---

## Task 15: End-to-end happy-path test (Playwright)

**Files:**
- Create: `tests/live/flow/fitness/emergency-lockdown.runtime.test.mjs`

Model after existing fitness flow tests (`tests/live/flow/fitness/`). Because the real garage reader isn't present in CI, drive the flow by **injecting websocket messages** / mocking the scan:
- Stub `GET /api/v1/fitness/emergency` and the `commit`/`release` endpoints, OR run against a backend with a fake unlock service that auto-matches.
- Simulate `fitness.emergency.detected` → assert the DEFCON overlay appears and audio element is present.
- Assert Cancel → confirmed abort returns to normal.
- Simulate a full ceremony → `commit` → assert `locked` screen with a release time.
- Assert press-and-hold 3s → release → normal.

Follow `CLAUDE.md` test discipline: no skipped assertions, fail fast if the harness can't set up the scenario. Wait on selectors, not `networkidle`.

**Run:**
```bash
npx playwright test tests/live/flow/fitness/emergency-lockdown.runtime.test.mjs --reporter=line
```

**Commit** (`test(fitness): emergency lockdown e2e happy path`).

---

## Task 16: Docs + handback

**Files:**
- Modify: `docs/_wip/plans/2026-06-17-fitness-emergency-lockdown-design.md` — mark Status: Implemented, note any deviations.
- Create: `docs/runbooks/fitness-emergency-lockdown.md` — operator notes: what it does, how to trigger (admin fingerprint), how to release (press-and-hold 3s + admin scan, or wait out the timer), config knobs, where state persists (`history/fitness/emergency_lock.yml`), and the live-garage re-arm caveat from Pre-flight #3.
- Update `docs/docs-last-updated.txt` per CLAUDE.md if you touch reference docs.

**Handback checklist (report to user, do NOT auto-merge/deploy):**
- All unit + e2e tests green (show output).
- The **live-garage integration checkpoint** (Pre-flight #3 / Task 6 arbiter) is unverified in this environment — call it out explicitly.
- Config `locks.emergency` must list real admin usernames before it works.
- Container restart needed for `devices.yml`/config-load changes (per memory `Device Config API`); confirm whether fitness config hot-reloads (memory `Plex Queue Shuffle + Memory` says menu configs hot-reload via mtime — verify for fitness).

**Commit** (`docs(fitness): emergency lockdown runbook + design status`).

---

## Notes / deferred (YAGNI for v1)
- Ceremony minimum duration = natural mp3 length (~7s); no separate floor.
- No multi-device fan-out beyond what the `fitness.emergency.locked`/`released` broadcasts already give (other FitnessApp instances will react if connected).
- Reader-contention is handled by the foreground arbiter + short detector arm timeout; if live testing shows the bridge can't be safely re-armed continuously, fall back to a frontend-driven armed loop only while idle (design Option A) — but do not build both.
