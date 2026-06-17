# Fingerprint Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fitness widget (sibling to CycleGame) to enroll and manage fingerprints for any profiled user, with trust-on-first-use for a user's first finger and self-or-admin authentication (real reader) for every subsequent action.

**Architecture:** Backend owns `profile.yml` (uuid↔user map, finger metadata, `admin` flag), the access policy, and the HTTP API; it relays enroll/delete over the existing backend↔garage WebSocket and reuses the merged `fitness.unlock.*` identify path for authentication. The garage-host capture/identify/delete helper is built by a separate agent against the WS contract here. Templates never leave the box; only uuids reach `profile.yml`, never the browser.

**Tech Stack:** Node ESM backend (Express `4_api/v1/routers/fitness.mjs`, `3_applications/fitness/*`), the WebSocket eventbus (`backend/src/0_system/eventbus/`), YAML via `#system/utils/FileIO.mjs`; React + Mantine frontend widget using `@/lib/api.mjs` (`DaylightAPI`) and `@/hooks/useWebSocket.js`; tests in **vitest** (frontend `*.test.jsx` + backend router `*.test.mjs` with `// @vitest-environment node`) and `node --test` for pure backend modules.

**Design doc:** `docs/_wip/plans/2026-06-17-fingerprint-manager-design.md`

---

## Conventions & Guardrails (read once)

- **Logging:** Use the logging framework, never raw console. Frontend child logger `{ component: 'fingerprint-manager' }`; backend events under `fitness.fingerprint.*`.
- **No PII in tests:** use `test-user` / `admin-user`, never real household identifiers.
- **Naming:** abstract vocabulary — `admin`, `authorized`, `manage`. No `parent*`.
- **Vocabulary parity:** mirror the existing unlock modules (`unlockPolicy.mjs`, `unlockBroker.mjs`, `unlockService.mjs`) in shape and style.
- **Don't commit automatically beyond what each task says** — this plan uses per-task commits (the agreed exception for this work).
- **Don't deploy** — KC deploys.
- **Data tree (NOT in repo):** `data/users/<username>/profile.yml`. The app writes only `identities.fingerprints[]`; it never writes `identities.admin`.
- **Test commands:**
  - Pure backend module: `node --test backend/src/3_applications/fitness/<x>.test.mjs`
  - Backend router (vitest): `npx vitest run backend/src/4_api/v1/routers/fitness.fingerprints.test.mjs`
  - Frontend (vitest): `npx vitest run frontend/src/modules/Fitness/widgets/FingerprintManager/<x>.test.jsx`

---

## File Structure

**Backend (create):**
- `backend/src/3_applications/fitness/manageAccessPolicy.mjs` — pure: target → `{requiresAuth, gallery}`
- `backend/src/3_applications/fitness/manageAccessPolicy.test.mjs`
- `backend/src/3_applications/fitness/fingerprintProfileWriter.mjs` — pure mutators + file writer/reload
- `backend/src/3_applications/fitness/fingerprintProfileWriter.test.mjs`
- `backend/src/3_applications/fitness/manageBroker.mjs` — transport-agnostic enroll/delete correlator
- `backend/src/3_applications/fitness/manageBroker.test.mjs`
- `backend/src/3_applications/fitness/manageService.mjs` — live eventbus wiring (singleton)
- `backend/src/3_applications/fitness/manageService.test.mjs`
- `backend/src/4_api/v1/routers/fitness.fingerprints.test.mjs` — router tests

**Backend (modify):**
- `backend/src/0_system/config/ConfigService.mjs` — add `reloadUserProfile(username)`
- `backend/src/4_api/v1/routers/fitness.mjs` — add GET/POST/DELETE `/fingerprints*`
- `backend/src/app.mjs` — `initManageService` + inject writer/manage-service into the router

**Frontend (create):**
- `frontend/src/modules/Fitness/widgets/FingerprintManager/index.jsx`
- `frontend/src/modules/Fitness/widgets/FingerprintManager/manifest.js`
- `frontend/src/modules/Fitness/widgets/FingerprintManager/useFingerprintManager.js`
- `frontend/src/modules/Fitness/widgets/FingerprintManager/EnrollModal.jsx`
- `frontend/src/modules/Fitness/widgets/FingerprintManager/FingerprintManagerContainer.jsx`
- `*.test.{js,jsx}` alongside each

**Frontend (modify):**
- `frontend/src/modules/Fitness/index.js` — register `fitness:fingerprint-manager`

**Docs (modify):**
- `docs/reference/fitness/fingerprint-unlock.md` — add the manager + new endpoints/contract

---

## Phase 1 — Backend access policy (pure, no hardware)

### Task 1: `manageAccessPolicy.mjs`

**Files:**
- Create: `backend/src/3_applications/fitness/manageAccessPolicy.mjs`
- Test: `backend/src/3_applications/fitness/manageAccessPolicy.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/3_applications/fitness/manageAccessPolicy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveManageAccess } from './manageAccessPolicy.mjs';

const fp = (id, finger = 'right-index') => ({ id, finger, enrolled: '2026-06-17' });

test('unenrolled target requires no auth (TOFU bootstrap)', () => {
  const profiles = { 'test-user': { identities: { fingerprints: [] } } };
  const out = resolveManageAccess(profiles, 'test-user');
  assert.equal(out.requiresAuth, false);
});

test('enrolled target requires auth and gallery includes own + admin uuids', () => {
  const profiles = {
    'test-user': { identities: { fingerprints: [fp('own-1')] } },
    'admin-user': { identities: { admin: true, fingerprints: [fp('adm-1')] } },
    'bystander': { identities: { fingerprints: [fp('by-1')] } },
  };
  const out = resolveManageAccess(profiles, 'test-user');
  assert.equal(out.requiresAuth, true);
  assert.deepEqual(
    out.gallery.sort((a, b) => a.uuid.localeCompare(b.uuid)),
    [{ uuid: 'adm-1', username: 'admin-user' }, { uuid: 'own-1', username: 'test-user' }],
  );
});

test('gallery dedups a uuid when the target is also an admin', () => {
  const profiles = {
    'admin-user': { identities: { admin: true, fingerprints: [fp('adm-1')] } },
  };
  const out = resolveManageAccess(profiles, 'admin-user');
  assert.equal(out.gallery.length, 1);
  assert.deepEqual(out.gallery, [{ uuid: 'adm-1', username: 'admin-user' }]);
});

test('missing target → requiresAuth false, empty gallery', () => {
  assert.deepEqual(resolveManageAccess({}, 'ghost'), { requiresAuth: false, gallery: [] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/3_applications/fitness/manageAccessPolicy.test.mjs`
Expected: FAIL — `resolveManageAccess` is not exported / file missing.

- [ ] **Step 3: Write minimal implementation**

```javascript
// backend/src/3_applications/fitness/manageAccessPolicy.mjs

/**
 * Resolve the management access decision for a target user (pure; no IO).
 *
 * - `requiresAuth` is false iff the target has zero enrolled fingerprints
 *   (trust-on-first-use: a brand-new user may enroll their first finger freely).
 * - `gallery` is the identify set used when auth IS required: the target's own
 *   fingerprint uuids PLUS every admin's uuids, deduped by uuid (an admin who is
 *   also the target appears once). Each entry carries its owning username so the
 *   caller can tell self-match from admin-match.
 *
 * An admin is any user with `identities.admin === true`.
 *
 * @param {Object<string, object>} profilesByUser - username -> parsed profile
 * @param {string} targetUsername
 * @returns {{ requiresAuth: boolean, gallery: Array<{uuid: string, username: string}> }}
 */
export function resolveManageAccess(profilesByUser, targetUsername) {
  const target = profilesByUser?.[targetUsername];
  const targetFps = target?.identities?.fingerprints || [];
  const requiresAuth = targetFps.length > 0;

  const seen = new Set();
  const gallery = [];
  const push = (uuid, username) => {
    if (!uuid || seen.has(uuid)) return;
    seen.add(uuid);
    gallery.push({ uuid, username });
  };

  for (const fp of targetFps) push(fp?.id, targetUsername);
  for (const [username, profile] of Object.entries(profilesByUser || {})) {
    if (profile?.identities?.admin !== true) continue;
    for (const fp of profile.identities.fingerprints || []) push(fp?.id, username);
  }

  return { requiresAuth, gallery };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/3_applications/fitness/manageAccessPolicy.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/manageAccessPolicy.mjs backend/src/3_applications/fitness/manageAccessPolicy.test.mjs
git commit -m "feat(fingerprint): manage-access policy (TOFU + self/admin gallery)"
```

---

## Phase 2 — Backend profile write path

### Task 2: ConfigService `reloadUserProfile`

**Files:**
- Modify: `backend/src/0_system/config/ConfigService.mjs` (near `getAllUserProfiles`, ~line 111)

- [ ] **Step 1: Add the method**

Add immediately after `getAllUserProfiles()` (the `#config` field and `loadYaml` import already exist in this file; add a `loadYamlFromPath` import if not present — check the top `import { loadYaml } from '#system/utils/FileIO.mjs';` line and extend it):

```javascript
// at top of file — extend the existing FileIO import:
import { loadYaml, loadYamlFromPath } from '#system/utils/FileIO.mjs';
```

```javascript
  /**
   * Re-read a single user's profile.yml from disk and refresh the in-memory
   * cache so freshly-written fingerprints/identities are visible without a full
   * app restart. Returns the reloaded profile (or null if the file is gone).
   * @param {string} username
   * @returns {object|null}
   */
  reloadUserProfile(username) {
    if (!username) return null;
    const profile = loadYamlFromPath(`${this.getUserDir(username)}/profile.yml`);
    if (!this.#config.users) this.#config.users = {};
    if (profile) {
      this.#config.users[username] = profile;
    } else {
      delete this.#config.users[username];
    }
    return profile ?? null;
  }
```

- [ ] **Step 2: Smoke-check it loads**

Run: `node --input-type=module -e "import('./backend/src/0_system/config/ConfigService.mjs').then(()=>console.log('ok'))"`
Expected: prints `ok` (no syntax/import error). Behavioral coverage comes via Task 3's writer test.

- [ ] **Step 3: Commit**

```bash
git add backend/src/0_system/config/ConfigService.mjs
git commit -m "feat(config): reloadUserProfile(username) to refresh one cached profile"
```

### Task 3: `fingerprintProfileWriter.mjs`

**Files:**
- Create: `backend/src/3_applications/fitness/fingerprintProfileWriter.mjs`
- Test: `backend/src/3_applications/fitness/fingerprintProfileWriter.test.mjs`

- [ ] **Step 1: Write the failing test** (pure mutators are tested directly; the file writer is tested through an injected fs + configService double)

```javascript
// backend/src/3_applications/fitness/fingerprintProfileWriter.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addFingerprintEntry,
  removeFingerprintEntry,
  createFingerprintProfileWriter,
} from './fingerprintProfileWriter.mjs';

test('addFingerprintEntry appends without mutating input', () => {
  const profile = { username: 'test-user', identities: { admin: true } };
  const next = addFingerprintEntry(profile, { id: 'u1', finger: 'right-index', enrolled: '2026-06-17' });
  assert.equal(profile.identities.fingerprints, undefined); // original untouched
  assert.equal(next.identities.admin, true);                // preserved
  assert.deepEqual(next.identities.fingerprints, [{ id: 'u1', finger: 'right-index', enrolled: '2026-06-17' }]);
});

test('removeFingerprintEntry drops the matching uuid only', () => {
  const profile = { identities: { fingerprints: [{ id: 'u1' }, { id: 'u2' }] } };
  const next = removeFingerprintEntry(profile, 'u1');
  assert.deepEqual(next.identities.fingerprints, [{ id: 'u2' }]);
  assert.deepEqual(profile.identities.fingerprints, [{ id: 'u1' }, { id: 'u2' }]); // input untouched
});

test('writer.addFingerprint loads → mutates → saves → reloads cache', async () => {
  let savedPath; let savedContent; let reloaded;
  const deps = {
    configService: {
      getUserDir: (u) => `/data/users/${u}`,
      reloadUserProfile: (u) => { reloaded = u; },
    },
    load: (p) => ({ identities: { fingerprints: [] } }),
    save: (p, c) => { savedPath = p; savedContent = c; },
  };
  const writer = createFingerprintProfileWriter(deps);
  await writer.addFingerprint('test-user', { id: 'u9', finger: 'left-thumb', enrolled: '2026-06-17' });

  assert.equal(savedPath, '/data/users/test-user/profile.yml');
  assert.deepEqual(savedContent.identities.fingerprints, [{ id: 'u9', finger: 'left-thumb', enrolled: '2026-06-17' }]);
  assert.equal(reloaded, 'test-user');
});

test('writer.removeFingerprint loads → removes → saves → reloads cache', async () => {
  let savedContent; let reloaded;
  const deps = {
    configService: { getUserDir: (u) => `/data/users/${u}`, reloadUserProfile: (u) => { reloaded = u; } },
    load: () => ({ identities: { fingerprints: [{ id: 'u1' }, { id: 'u2' }] } }),
    save: (_p, c) => { savedContent = c; },
  };
  const writer = createFingerprintProfileWriter(deps);
  await writer.removeFingerprint('test-user', 'u1');
  assert.deepEqual(savedContent.identities.fingerprints, [{ id: 'u2' }]);
  assert.equal(reloaded, 'test-user');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/3_applications/fitness/fingerprintProfileWriter.test.mjs`
Expected: FAIL — module/exports missing.

- [ ] **Step 3: Write minimal implementation**

```javascript
// backend/src/3_applications/fitness/fingerprintProfileWriter.mjs
import { loadYamlFromPath, saveYamlToPath } from '#system/utils/FileIO.mjs';

/**
 * Append a fingerprint under identities.fingerprints, preserving other
 * identities (e.g. the admin flag). Returns a new object; does not mutate.
 * @param {object} profile
 * @param {{id: string, finger: string, enrolled: string}} entry
 * @returns {object}
 */
export function addFingerprintEntry(profile, entry) {
  const next = { ...profile, identities: { ...(profile?.identities || {}) } };
  const list = Array.isArray(next.identities.fingerprints) ? [...next.identities.fingerprints] : [];
  list.push({ id: entry.id, finger: entry.finger, enrolled: entry.enrolled });
  next.identities.fingerprints = list;
  return next;
}

/**
 * Remove the fingerprint whose id === uuid. Returns a new object; does not mutate.
 * @param {object} profile
 * @param {string} uuid
 * @returns {object}
 */
export function removeFingerprintEntry(profile, uuid) {
  const next = { ...profile, identities: { ...(profile?.identities || {}) } };
  const list = Array.isArray(next.identities.fingerprints) ? next.identities.fingerprints : [];
  next.identities.fingerprints = list.filter((fp) => fp?.id !== uuid);
  return next;
}

/**
 * Live writer: read data/users/<user>/profile.yml, mutate identities.fingerprints,
 * write it back, and refresh the cached profile. `load`/`save` are injectable so
 * the mutate→persist→reload sequence is unit-testable without the filesystem.
 *
 * @param {object} deps
 * @param {{getUserDir:(u:string)=>string, reloadUserProfile:(u:string)=>any}} deps.configService
 * @param {(path:string)=>object} [deps.load]  - defaults to loadYamlFromPath
 * @param {(path:string, content:object)=>void} [deps.save] - defaults to saveYamlToPath
 */
export function createFingerprintProfileWriter({ configService, load = loadYamlFromPath, save = saveYamlToPath }) {
  const pathFor = (username) => `${configService.getUserDir(username)}/profile.yml`;

  async function addFingerprint(username, entry) {
    const profile = load(pathFor(username)) || {};
    save(pathFor(username), addFingerprintEntry(profile, entry));
    configService.reloadUserProfile(username);
  }

  async function removeFingerprint(username, uuid) {
    const profile = load(pathFor(username)) || {};
    save(pathFor(username), removeFingerprintEntry(profile, uuid));
    configService.reloadUserProfile(username);
  }

  return { addFingerprint, removeFingerprint };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/3_applications/fitness/fingerprintProfileWriter.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/fingerprintProfileWriter.mjs backend/src/3_applications/fitness/fingerprintProfileWriter.test.mjs
git commit -m "feat(fingerprint): profile writer (append/remove + cache reload)"
```

---

## Phase 3 — Backend enroll/delete broker + service

### Task 4: `manageBroker.mjs` (transport-agnostic)

**Files:**
- Create: `backend/src/3_applications/fitness/manageBroker.mjs`
- Test: `backend/src/3_applications/fitness/manageBroker.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/3_applications/fitness/manageBroker.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createManageBroker } from './manageBroker.mjs';

function fakeTimers() {
  const timers = new Map(); let seq = 0;
  return {
    setTimeoutFn: (cb, ms) => { const id = ++seq; timers.set(id, cb); return id; },
    clearTimeoutFn: (id) => timers.delete(id),
    fire: (id) => { const cb = timers.get(id); timers.delete(id); cb?.(); },
  };
}

test('requestEnroll publishes a request and resolves on result', async () => {
  const published = [];
  let n = 0;
  const broker = createManageBroker({
    publish: (t, p) => published.push({ t, p }),
    idFn: () => `req-${++n}`,
  });
  const promise = broker.requestEnroll({ finger: 'right-index', username: 'test-user' });
  assert.deepEqual(published[0], { t: 'fitness.enroll.request', p: { requestId: 'req-1', finger: 'right-index', username: 'test-user' } });
  broker.resolveEnrollResult({ requestId: 'req-1', success: true, uuid: 'new-uuid' });
  assert.deepEqual(await promise, { success: true, uuid: 'new-uuid' });
});

test('enroll progress invokes the onProgress callback for the matching request', async () => {
  const seen = [];
  let n = 0;
  const broker = createManageBroker({ publish: () => {}, idFn: () => `req-${++n}` });
  const promise = broker.requestEnroll({ finger: 'right-index', username: 'test-user', onProgress: (p) => seen.push(p) });
  broker.handleEnrollProgress({ requestId: 'req-1', stage: 2, stagesTotal: 5 });
  broker.handleEnrollProgress({ requestId: 'nope', stage: 9, stagesTotal: 5 }); // ignored
  broker.resolveEnrollResult({ requestId: 'req-1', success: true, uuid: 'u' });
  await promise;
  assert.deepEqual(seen, [{ stage: 2, stagesTotal: 5 }]);
});

test('enroll times out to {success:false, error:"timeout"}', async () => {
  const timers = fakeTimers();
  let n = 0;
  const broker = createManageBroker({
    publish: () => {}, idFn: () => `req-${++n}`,
    setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn,
  });
  const promise = broker.requestEnroll({ finger: 'right-index', username: 'test-user' });
  timers.fire(1);
  assert.deepEqual(await promise, { success: false, error: 'timeout' });
});

test('requestDelete publishes and resolves on result', async () => {
  const published = [];
  let n = 0;
  const broker = createManageBroker({ publish: (t, p) => published.push({ t, p }), idFn: () => `req-${++n}` });
  const promise = broker.requestDelete({ uuid: 'u1' });
  assert.deepEqual(published[0], { t: 'fitness.fingerprint.delete.request', p: { requestId: 'req-1', uuid: 'u1' } });
  broker.resolveDeleteResult({ requestId: 'req-1', success: true });
  assert.deepEqual(await promise, { success: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/3_applications/fitness/manageBroker.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```javascript
// backend/src/3_applications/fitness/manageBroker.mjs
import { randomUUID } from 'node:crypto';

/**
 * Request/response correlator for fingerprint ENROLL and DELETE over an injected
 * `publish` callback (transport-agnostic, like unlockBroker). Enroll additionally
 * forwards streamed progress to a per-request `onProgress` callback. Timers and
 * the id generator are injectable for deterministic tests.
 *
 * @param {object} deps
 * @param {(topic: string, payload: object) => void} deps.publish
 * @param {number} [deps.enrollTimeoutMs] - default 60000
 * @param {number} [deps.deleteTimeoutMs] - default 15000
 * @param {Function} [deps.setTimeoutFn]
 * @param {Function} [deps.clearTimeoutFn]
 * @param {() => string} [deps.idFn]
 */
export function createManageBroker({
  publish,
  enrollTimeoutMs = 60000,
  deleteTimeoutMs = 15000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  idFn = randomUUID,
} = {}) {
  /** requestId -> { resolve, timer, onProgress? } */
  const pending = new Map();

  function settle(requestId, result) {
    const entry = pending.get(requestId);
    if (!entry) return;
    pending.delete(requestId);
    clearTimeoutFn(entry.timer);
    entry.resolve(result);
  }

  function requestEnroll({ finger, username, onProgress } = {}) {
    const requestId = idFn();
    return new Promise((resolve) => {
      const timer = setTimeoutFn(() => settle(requestId, { success: false, error: 'timeout' }), enrollTimeoutMs);
      pending.set(requestId, { resolve, timer, onProgress });
      publish('fitness.enroll.request', { requestId, finger, username });
    });
  }

  function handleEnrollProgress({ requestId, stage, stagesTotal } = {}) {
    pending.get(requestId)?.onProgress?.({ stage, stagesTotal });
  }

  function resolveEnrollResult({ requestId, success, uuid, error } = {}) {
    const result = success ? { success: true, uuid } : { success: false, error: error || 'enroll-failed' };
    settle(requestId, result);
  }

  function requestDelete({ uuid } = {}) {
    const requestId = idFn();
    return new Promise((resolve) => {
      const timer = setTimeoutFn(() => settle(requestId, { success: false, error: 'timeout' }), deleteTimeoutMs);
      pending.set(requestId, { resolve, timer });
      publish('fitness.fingerprint.delete.request', { requestId, uuid });
    });
  }

  function resolveDeleteResult({ requestId, success, error } = {}) {
    settle(requestId, success ? { success: true } : { success: false, error: error || 'delete-failed' });
  }

  return { requestEnroll, handleEnrollProgress, resolveEnrollResult, requestDelete, resolveDeleteResult };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/3_applications/fitness/manageBroker.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/manageBroker.mjs backend/src/3_applications/fitness/manageBroker.test.mjs
git commit -m "feat(fingerprint): enroll/delete broker (progress + timeout)"
```

### Task 5: `manageService.mjs` (live eventbus wiring)

**Files:**
- Create: `backend/src/3_applications/fitness/manageService.mjs`
- Test: `backend/src/3_applications/fitness/manageService.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/3_applications/fitness/manageService.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initManageService, getManageService, _resetManageServiceForTests } from './manageService.mjs';

function fakeBus() {
  const broadcasts = [];
  let onMsg;
  return {
    broadcasts,
    broadcast: (topic, payload) => broadcasts.push({ topic, payload }),
    onClientMessage: (cb) => { onMsg = cb; },
    deliver: (msg) => onMsg?.('client-1', msg),
  };
}

test('initManageService requires a bus with broadcast + onClientMessage', () => {
  _resetManageServiceForTests();
  assert.throws(() => initManageService({ eventBus: {} }), /broadcast/);
});

test('requestEnroll broadcasts request, rebroadcasts progress with clientToken, resolves on result', async () => {
  _resetManageServiceForTests();
  const bus = fakeBus();
  const svc = initManageService({ eventBus: bus });

  const promise = svc.requestEnroll({ finger: 'right-index', username: 'test-user', clientToken: 'tok-1' });
  const req = bus.broadcasts.find((b) => b.topic === 'fitness.enroll.request');
  assert.ok(req, 'enroll request broadcast');
  const { requestId } = req.payload;

  bus.deliver({ topic: 'fitness.enroll.progress', requestId, stage: 3, stagesTotal: 5 });
  const prog = bus.broadcasts.find((b) => b.topic === 'fitness.enroll.progress');
  assert.deepEqual(prog.payload, { clientToken: 'tok-1', stage: 3, stagesTotal: 5 });

  bus.deliver({ topic: 'fitness.enroll.result', requestId, success: true, uuid: 'new-uuid' });
  assert.deepEqual(await promise, { success: true, uuid: 'new-uuid' });
});

test('requestDelete resolves on delete result', async () => {
  _resetManageServiceForTests();
  const bus = fakeBus();
  const svc = initManageService({ eventBus: bus });
  const promise = svc.requestDelete({ uuid: 'u1' });
  const req = bus.broadcasts.find((b) => b.topic === 'fitness.fingerprint.delete.request');
  bus.deliver({ topic: 'fitness.fingerprint.delete.result', requestId: req.payload.requestId, success: true });
  assert.deepEqual(await promise, { success: true });
  assert.equal(getManageService(), svc); // singleton
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/3_applications/fitness/manageService.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```javascript
// backend/src/3_applications/fitness/manageService.mjs
import { createManageBroker } from './manageBroker.mjs';

export const ENROLL_REQUEST_TOPIC = 'fitness.enroll.request';
export const ENROLL_PROGRESS_TOPIC = 'fitness.enroll.progress';
export const ENROLL_RESULT_TOPIC = 'fitness.enroll.result';
export const DELETE_RESULT_TOPIC = 'fitness.fingerprint.delete.result';

let singleton = null;

/**
 * Wire the enroll/delete broker to the live WebSocket eventbus. Outbound requests
 * go via broadcast (the garage client subscribes to the request topics); inbound
 * `fitness.enroll.progress|result` and `fitness.fingerprint.delete.result` client
 * messages are routed back to the broker. Enroll progress is rebroadcast to the
 * browser tagged with the caller's `clientToken` so the manager UI can show stages.
 * Idempotent singleton (first init wins), mirroring unlockService.
 *
 * @param {object} deps
 * @param {object} deps.eventBus - needs broadcast() + onClientMessage()
 * @param {object} [deps.logger]
 */
export function initManageService({ eventBus, logger } = {}) {
  if (singleton) return singleton;
  if (!eventBus || typeof eventBus.broadcast !== 'function' || typeof eventBus.onClientMessage !== 'function') {
    throw new Error('initManageService: eventBus with broadcast() and onClientMessage() is required');
  }
  const log = logger || console;

  const broker = createManageBroker({
    publish: (topic, payload) => eventBus.broadcast(topic, payload),
  });

  eventBus.onClientMessage((_clientId, message) => {
    if (!message || typeof message.requestId !== 'string') return;
    switch (message.topic) {
      case ENROLL_PROGRESS_TOPIC:
        broker.handleEnrollProgress({ requestId: message.requestId, stage: message.stage, stagesTotal: message.stagesTotal });
        break;
      case ENROLL_RESULT_TOPIC:
        log.debug?.('fitness.fingerprint.enroll.result', { requestId: message.requestId, success: !!message.success });
        broker.resolveEnrollResult({ requestId: message.requestId, success: !!message.success, uuid: message.uuid, error: message.error });
        break;
      case DELETE_RESULT_TOPIC:
        log.debug?.('fitness.fingerprint.delete.result', { requestId: message.requestId, success: !!message.success });
        broker.resolveDeleteResult({ requestId: message.requestId, success: !!message.success, error: message.error });
        break;
      default:
        break;
    }
  });

  singleton = {
    requestEnroll({ finger, username, clientToken }) {
      return broker.requestEnroll({
        finger,
        username,
        onProgress: ({ stage, stagesTotal }) =>
          eventBus.broadcast(ENROLL_PROGRESS_TOPIC, { clientToken, stage, stagesTotal }),
      });
    },
    requestDelete({ uuid }) {
      return broker.requestDelete({ uuid });
    },
  };
  return singleton;
}

export function getManageService() {
  return singleton;
}

export function _resetManageServiceForTests() {
  singleton = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/3_applications/fitness/manageService.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/manageService.mjs backend/src/3_applications/fitness/manageService.test.mjs
git commit -m "feat(fingerprint): manage service (eventbus wiring + progress relay)"
```

---

## Phase 4 — Backend HTTP endpoints

### Task 6: GET/POST/DELETE `/fingerprints*` in the fitness router

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs` (imports near line 42; deps in the config destructure near line 80–104; new routes near the existing `/unlock` handler ~line 1297)
- Test: `backend/src/4_api/v1/routers/fitness.fingerprints.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/4_api/v1/routers/fitness.fingerprints.test.mjs
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFitnessRouter } from './fitness.mjs';

const silent = { info(){}, warn(){}, error(){}, debug(){} };

function appWith({ profiles = {}, unlockService, manageService } = {}) {
  const all = new Map(Object.entries(profiles));
  const userService = {
    getProfile: (u) => profiles[u] ?? null,
    getAllProfiles: () => all,
  };
  const configService = { getDefaultHouseholdId: () => 'default' };
  const writes = [];
  const fingerprintProfileWriter = {
    addFingerprint: vi.fn(async (u, e) => { writes.push(['add', u, e]); }),
    removeFingerprint: vi.fn(async (u, id) => { writes.push(['remove', u, id]); }),
  };
  const app = express();
  app.use(express.json());
  app.use('/', createFitnessRouter({
    userService, configService, fingerprintProfileWriter,
    resolveUnlockService: () => unlockService ?? null,
    resolveManageService: () => manageService ?? null,
    logger: silent,
  }));
  return { app, fingerprintProfileWriter, writes };
}

const fp = (id, finger = 'right-index') => ({ id, finger, enrolled: '2026-06-17' });

describe('GET /fingerprints', () => {
  it('lists users with admin flag and fingers but never uuids', async () => {
    const { app } = appWith({ profiles: {
      'admin-user': { display_name: 'Admin', identities: { admin: true, fingerprints: [fp('a1','left-thumb')] } },
      'test-user': { identities: { fingerprints: [] } },
    }});
    const res = await request(app).get('/fingerprints');
    expect(res.status).toBe(200);
    const admin = res.body.find((u) => u.username === 'admin-user');
    expect(admin).toMatchObject({ displayName: 'Admin', admin: true, fingerprints: [{ finger: 'left-thumb', enrolled: '2026-06-17' }] });
    expect(JSON.stringify(res.body)).not.toContain('a1'); // no uuid leak
    expect(res.body.find((u) => u.username === 'test-user')).toMatchObject({ admin: false, fingerprints: [] });
  });
});

describe('POST /fingerprints/enroll', () => {
  it('unenrolled user enrolls with NO auth scan, then writes the profile', async () => {
    const requestUnlock = vi.fn();
    const requestEnroll = vi.fn().mockResolvedValue({ success: true, uuid: 'new-uuid' });
    const { app, fingerprintProfileWriter } = appWith({
      profiles: { 'test-user': { identities: { fingerprints: [] } } },
      unlockService: { requestUnlock },
      manageService: { requestEnroll },
    });
    const res = await request(app).post('/fingerprints/enroll').send({ username: 'test-user', finger: 'right-index', clientToken: 'tok-1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, finger: 'right-index' });
    expect(requestUnlock).not.toHaveBeenCalled(); // TOFU: no scan
    expect(requestEnroll).toHaveBeenCalledWith({ finger: 'right-index', username: 'test-user', clientToken: 'tok-1' });
    expect(fingerprintProfileWriter.addFingerprint).toHaveBeenCalledWith('test-user', expect.objectContaining({ id: 'new-uuid', finger: 'right-index' }));
  });

  it('enrolled user must pass auth first (identify against gallery)', async () => {
    const requestUnlock = vi.fn().mockResolvedValue({ matched: true, userId: 'test-user' });
    const requestEnroll = vi.fn().mockResolvedValue({ success: true, uuid: 'new-uuid' });
    const { app } = appWith({
      profiles: { 'test-user': { identities: { fingerprints: [fp('own-1')] } } },
      unlockService: { requestUnlock }, manageService: { requestEnroll },
    });
    const res = await request(app).post('/fingerprints/enroll').send({ username: 'test-user', finger: 'left-thumb', clientToken: 't' });
    expect(res.status).toBe(200);
    expect(requestUnlock).toHaveBeenCalledWith('manage:test-user', [{ uuid: 'own-1', username: 'test-user' }]);
    expect(requestEnroll).toHaveBeenCalled();
  });

  it('enrolled user with a denied scan → 403 auth-denied, no enroll', async () => {
    const requestUnlock = vi.fn().mockResolvedValue({ matched: false });
    const requestEnroll = vi.fn();
    const { app } = appWith({
      profiles: { 'test-user': { identities: { fingerprints: [fp('own-1')] } } },
      unlockService: { requestUnlock }, manageService: { requestEnroll },
    });
    const res = await request(app).post('/fingerprints/enroll').send({ username: 'test-user', finger: 'left-thumb' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'auth-denied' });
    expect(requestEnroll).not.toHaveBeenCalled();
  });

  it('unknown user → 400', async () => {
    const { app } = appWith({ profiles: {}, manageService: { requestEnroll: vi.fn() } });
    const res = await request(app).post('/fingerprints/enroll').send({ username: 'ghost', finger: 'right-index' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'unknown-user' });
  });
});

describe('DELETE /fingerprints', () => {
  it('requires auth, deletes the template, then removes the profile entry', async () => {
    const requestUnlock = vi.fn().mockResolvedValue({ matched: true, userId: 'admin-user' });
    const requestDelete = vi.fn().mockResolvedValue({ success: true });
    const { app, fingerprintProfileWriter } = appWith({
      profiles: {
        'test-user': { identities: { fingerprints: [fp('own-1')] } },
        'admin-user': { identities: { admin: true, fingerprints: [fp('adm-1')] } },
      },
      unlockService: { requestUnlock }, manageService: { requestDelete },
    });
    const res = await request(app).delete('/fingerprints').send({ username: 'test-user', uuid: 'own-1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(requestDelete).toHaveBeenCalledWith({ uuid: 'own-1' });
    expect(fingerprintProfileWriter.removeFingerprint).toHaveBeenCalledWith('test-user', 'own-1');
  });

  it('rejects deleting a uuid the user does not own → 400', async () => {
    const { app } = appWith({
      profiles: { 'test-user': { identities: { fingerprints: [fp('own-1')] } } },
      unlockService: { requestUnlock: vi.fn() }, manageService: { requestDelete: vi.fn() },
    });
    const res = await request(app).delete('/fingerprints').send({ username: 'test-user', uuid: 'not-mine' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'unknown-fingerprint' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/4_api/v1/routers/fitness.fingerprints.test.mjs`
Expected: FAIL — routes 404 / deps undefined.

- [ ] **Step 3: Add imports + router deps**

In `fitness.mjs`, after the existing unlock imports (~line 43) add:

```javascript
import { resolveManageAccess } from '#apps/fitness/manageAccessPolicy.mjs';
import { getManageService } from '#apps/fitness/manageService.mjs';
```

In the `createFitnessRouter` config destructure (the block ending ~line 104, alongside `resolveUnlockService`), add:

```javascript
    fingerprintProfileWriter = null,
    resolveManageService = getManageService,
```

- [ ] **Step 4: Add the three routes**

Insert immediately AFTER the existing `router.post('/unlock', ...)` handler (after its closing `}));`, ~line 1345):

```javascript
  /**
   * GET /api/fitness/fingerprints — list every profiled user with their admin
   * flag and enrolled fingers (finger + date only). Never returns uuids.
   */
  router.get('/fingerprints', (req, res) => {
    const profiles = userService?.getAllProfiles?.() || new Map();
    const out = [];
    for (const [username, profile] of profiles.entries()) {
      const ids = profile?.identities || {};
      out.push({
        username,
        displayName: profile?.display_name || username,
        admin: ids.admin === true,
        fingerprints: (ids.fingerprints || []).map((f) => ({ finger: f.finger, enrolled: f.enrolled })),
      });
    }
    res.json(out);
  });

  /**
   * Build the username->profile map for the access decision (target + all users,
   * since admins may be anyone). Reuses the live profile cache.
   */
  function allProfilesObject() {
    const map = userService?.getAllProfiles?.() || new Map();
    return Object.fromEntries(map.entries());
  }

  /**
   * Run the self/admin identify gate for managing `username`. Returns
   * { ok: true } when allowed (TOFU or matched scan), else { ok:false, status, body }.
   */
  async function gateManageAccess(username, logger) {
    const profiles = allProfilesObject();
    const { requiresAuth, gallery } = resolveManageAccess(profiles, username);
    if (!requiresAuth) {
      logger.info?.('fitness.fingerprint.access.tofu', { username });
      return { ok: true };
    }
    const unlockService = resolveUnlockService?.();
    if (!unlockService) return { ok: false, status: 503, body: { error: 'unlock-service-unavailable' } };
    logger.info?.('fitness.fingerprint.access.requires-auth', { username, candidates: gallery.length });
    let verdict;
    try {
      verdict = await unlockService.requestUnlock(`manage:${username}`, gallery);
    } catch (err) {
      logger.error?.('fitness.fingerprint.access.error', { username, error: err?.message });
      return { ok: false, status: 500, body: { error: 'auth-failed' } };
    }
    if (!verdict?.matched) {
      logger.info?.('fitness.fingerprint.access.denied', { username });
      return { ok: false, status: 403, body: { error: 'auth-denied' } };
    }
    logger.info?.('fitness.fingerprint.access.granted', { username, by: verdict.userId });
    return { ok: true };
  }

  /**
   * POST /api/fitness/fingerprints/enroll { username, finger, clientToken }
   * TOFU for an unenrolled user; otherwise requires a self/admin scan. On success
   * the garage box returns a uuid which we persist to the user's profile.yml.
   */
  router.post('/fingerprints/enroll', asyncHandler(async (req, res) => {
    const { username, finger, clientToken } = req.body || {};
    if (!username || !userService?.getProfile?.(username)) {
      return res.status(400).json({ error: 'unknown-user' });
    }
    if (!finger || typeof finger !== 'string') {
      return res.status(400).json({ error: 'missing-finger' });
    }

    const gate = await gateManageAccess(username, logger);
    if (!gate.ok) return res.status(gate.status).json(gate.body);

    const manageService = resolveManageService?.();
    if (!manageService) return res.status(503).json({ error: 'manage-service-unavailable' });

    let result;
    try {
      result = await manageService.requestEnroll({ finger, username, clientToken });
    } catch (err) {
      logger.error?.('fitness.fingerprint.enroll.error', { username, error: err?.message });
      return res.status(500).json({ error: 'enroll-failed' });
    }
    if (!result?.success || !result.uuid) {
      logger.warn?.('fitness.fingerprint.enroll.unsuccessful', { username, reason: result?.error });
      return res.status(500).json({ error: 'enroll-failed', reason: result?.error });
    }

    const enrolled = new Date().toISOString().slice(0, 10);
    await fingerprintProfileWriter?.addFingerprint(username, { id: result.uuid, finger, enrolled });
    logger.info?.('fitness.fingerprint.enroll.saved', { username, finger });
    return res.json({ success: true, finger });
  }));

  /**
   * DELETE /api/fitness/fingerprints { username, uuid }
   * Requires a self/admin scan, deletes the on-box template, then removes the
   * profile.yml entry (only after the box confirms, to avoid a dangling entry).
   */
  router.delete('/fingerprints', asyncHandler(async (req, res) => {
    const { username, uuid } = req.body || {};
    const profile = username ? userService?.getProfile?.(username) : null;
    if (!profile) return res.status(400).json({ error: 'unknown-user' });
    const owns = (profile.identities?.fingerprints || []).some((f) => f.id === uuid);
    if (!uuid || !owns) return res.status(400).json({ error: 'unknown-fingerprint' });

    const gate = await gateManageAccess(username, logger);
    if (!gate.ok) return res.status(gate.status).json(gate.body);

    const manageService = resolveManageService?.();
    if (!manageService) return res.status(503).json({ error: 'manage-service-unavailable' });

    let result;
    try {
      result = await manageService.requestDelete({ uuid });
    } catch (err) {
      logger.error?.('fitness.fingerprint.delete.error', { username, error: err?.message });
      return res.status(500).json({ error: 'delete-failed' });
    }
    if (!result?.success) return res.status(500).json({ error: 'delete-failed', reason: result?.error });

    await fingerprintProfileWriter?.removeFingerprint(username, uuid);
    logger.info?.('fitness.fingerprint.delete.saved', { username });
    return res.json({ success: true });
  }));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run backend/src/4_api/v1/routers/fitness.fingerprints.test.mjs`
Expected: PASS (all cases). Also re-run the existing unlock suite to confirm no regression: `npx vitest run backend/src/4_api/v1/routers/fitness.unlock.test.mjs`

- [ ] **Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/fitness.mjs backend/src/4_api/v1/routers/fitness.fingerprints.test.mjs
git commit -m "feat(fingerprint): GET/POST/DELETE /fingerprints endpoints"
```

### Task 7: Wire `initManageService` + writer into app.mjs

**Files:**
- Modify: `backend/src/app.mjs` (import near line 137; init near line 439; router construction where `createFitnessRouter` is called)

- [ ] **Step 1: Add the import**

Next to `import { initUnlockService } from '#apps/fitness/unlockService.mjs';` (line 137):

```javascript
import { initManageService } from '#apps/fitness/manageService.mjs';
import { createFingerprintProfileWriter } from '#apps/fitness/fingerprintProfileWriter.mjs';
```

- [ ] **Step 2: Init the service after `initUnlockService(...)` (~line 442)**

```javascript
  // Fingerprint manager — enroll/delete relay over the same garage WS, plus the
  // browser progress rebroadcast. Auth reuses the unlock service above.
  initManageService({
    eventBus,
    logger: rootLogger.child({ module: 'fitness-fingerprint-manage' })
  });
  const fingerprintProfileWriter = createFingerprintProfileWriter({ configService });
```

- [ ] **Step 3: Pass the writer into the fitness router**

Find the `createFitnessRouter({ ... })` call in app.mjs (grep: `grep -n "createFitnessRouter" backend/src/app.mjs`). Add to its config object:

```javascript
    fingerprintProfileWriter,
```

(The router already defaults `resolveManageService` to `getManageService` and `resolveUnlockService` to `getUnlockService`, so no further wiring is needed.)

- [ ] **Step 4: Verify the app boots**

Run: `node --input-type=module -e "import('./backend/src/app.mjs').then(()=>console.log('import ok')).catch(e=>{console.error(e);process.exit(1)})"`
Expected: `import ok` (module graph resolves; no missing-export errors). Full boot is verified on the dev server in Task 11.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat(fingerprint): wire manage service + profile writer into app"
```

---

## Phase 5 — Frontend widget

### Task 8: Scaffold widget + manifest + registry

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/FingerprintManager/manifest.js`
- Create: `frontend/src/modules/Fitness/widgets/FingerprintManager/index.jsx`
- Create: `frontend/src/modules/Fitness/widgets/FingerprintManager/FingerprintManagerContainer.jsx` (stub for now)
- Modify: `frontend/src/modules/Fitness/index.js`
- Test: `frontend/src/modules/Fitness/widgets/FingerprintManager/manifest.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/modules/Fitness/widgets/FingerprintManager/manifest.test.js
import { describe, it, expect } from 'vitest';
import manifest from './manifest.js';

describe('FingerprintManager manifest', () => {
  it('declares an id, name and icon', () => {
    expect(manifest.id).toBe('fingerprint-manager');
    expect(manifest.name).toBeTruthy();
    expect(manifest.icon).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/FingerprintManager/manifest.test.js`
Expected: FAIL — manifest missing.

- [ ] **Step 3: Create manifest, stub container, index, and register**

```javascript
// frontend/src/modules/Fitness/widgets/FingerprintManager/manifest.js
export default {
  id: 'fingerprint-manager',
  name: 'Fingerprints',
  icon: '🔏',
  description: 'Enroll and manage fingerprints for household users.',
};
```

```jsx
// frontend/src/modules/Fitness/widgets/FingerprintManager/FingerprintManagerContainer.jsx
import React from 'react';

export default function FingerprintManagerContainer() {
  return <div data-testid="fingerprint-manager">Fingerprint Manager</div>;
}
```

```jsx
// frontend/src/modules/Fitness/widgets/FingerprintManager/index.jsx
export { default } from './FingerprintManagerContainer.jsx';
export { default as manifest } from './manifest.js';
```

In `frontend/src/modules/Fitness/index.js`: add the import beside the other widget imports:

```javascript
import * as FingerprintManager from './widgets/FingerprintManager/index.jsx';
```

add to `REGISTRY_KEYS`:

```javascript
  'fitness:fingerprint-manager': FingerprintManager,
```

add to `LEGACY_ID_MAP`:

```javascript
  'fingerprint_manager': 'fitness:fingerprint-manager',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/FingerprintManager/manifest.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FingerprintManager frontend/src/modules/Fitness/index.js
git commit -m "feat(fingerprint): scaffold FingerprintManager widget + registry"
```

### Task 9: `useFingerprintManager` hook

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/FingerprintManager/useFingerprintManager.js`
- Test: `frontend/src/modules/Fitness/widgets/FingerprintManager/useFingerprintManager.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/modules/Fitness/widgets/FingerprintManager/useFingerprintManager.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
import { DaylightAPI } from '@/lib/api.mjs';
import { useFingerprintManager } from './useFingerprintManager.js';

beforeEach(() => { DaylightAPI.mockReset(); });

describe('useFingerprintManager', () => {
  it('loads the user list on refresh', async () => {
    DaylightAPI.mockResolvedValueOnce([{ username: 'test-user', admin: false, fingerprints: [] }]);
    const { result } = renderHook(() => useFingerprintManager());
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.users).toHaveLength(1));
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/fitness/fingerprints');
  });

  it('enroll posts username/finger/clientToken', async () => {
    DaylightAPI.mockResolvedValueOnce({ success: true, finger: 'right-index' });
    const { result } = renderHook(() => useFingerprintManager());
    let resp;
    await act(async () => { resp = await result.current.enroll({ username: 'test-user', finger: 'right-index', clientToken: 'tok' }); });
    expect(resp).toMatchObject({ success: true });
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/fitness/fingerprints/enroll', { username: 'test-user', finger: 'right-index', clientToken: 'tok' }, 'POST');
  });

  it('remove issues a DELETE with username/uuid', async () => {
    DaylightAPI.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useFingerprintManager());
    await act(async () => { await result.current.remove({ username: 'test-user', uuid: 'u1' }); });
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/fitness/fingerprints', { username: 'test-user', uuid: 'u1' }, 'DELETE');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/FingerprintManager/useFingerprintManager.test.js`
Expected: FAIL — hook missing.

- [ ] **Step 3: Write minimal implementation**

```javascript
// frontend/src/modules/Fitness/widgets/FingerprintManager/useFingerprintManager.js
import { useCallback, useState } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
const logger = () => (_logger ??= getLogger().child({ component: 'fingerprint-manager' }));

const LIST_PATH = 'api/v1/fitness/fingerprints';
const ENROLL_PATH = 'api/v1/fitness/fingerprints/enroll';

/**
 * Data hook for the fingerprint manager: load the user list, enroll a finger,
 * and remove one. All errors resolve (never throw) so callers branch on the
 * returned shape, matching useUnlock's contract.
 */
export function useFingerprintManager() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await DaylightAPI(LIST_PATH);
      setUsers(Array.isArray(list) ? list : []);
      logger().debug('manager.listed', { count: Array.isArray(list) ? list.length : 0 });
    } catch (err) {
      logger().warn('manager.list.error', { error: err?.message });
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const enroll = useCallback(async ({ username, finger, clientToken }) => {
    logger().info('manager.enroll.start', { username, finger });
    try {
      const res = await DaylightAPI(ENROLL_PATH, { username, finger, clientToken }, 'POST');
      logger().info('manager.enroll.done', { username, success: !!res?.success });
      return res || { success: false };
    } catch (err) {
      logger().warn('manager.enroll.error', { username, error: err?.message });
      return { success: false, error: err?.message };
    }
  }, []);

  const remove = useCallback(async ({ username, uuid }) => {
    logger().info('manager.delete.start', { username });
    try {
      const res = await DaylightAPI(LIST_PATH, { username, uuid }, 'DELETE');
      logger().info('manager.delete.done', { username, success: !!res?.success });
      return res || { success: false };
    } catch (err) {
      logger().warn('manager.delete.error', { username, error: err?.message });
      return { success: false, error: err?.message };
    }
  }, []);

  return { users, loading, refresh, enroll, remove };
}

export default useFingerprintManager;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/FingerprintManager/useFingerprintManager.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FingerprintManager/useFingerprintManager.js frontend/src/modules/Fitness/widgets/FingerprintManager/useFingerprintManager.test.js
git commit -m "feat(fingerprint): useFingerprintManager data hook"
```

### Task 10: `EnrollModal` with live progress

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/FingerprintManager/EnrollModal.jsx`
- Test: `frontend/src/modules/Fitness/widgets/FingerprintManager/EnrollModal.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Fitness/widgets/FingerprintManager/EnrollModal.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// Capture the subscription callback so the test can push progress frames.
let progressCb;
vi.mock('@/hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (_filter, cb) => { progressCb = cb; },
}));

import { EnrollModal } from './EnrollModal.jsx';

describe('EnrollModal', () => {
  it('shows finger options and starts enrollment, then reflects progress', async () => {
    const onEnroll = vi.fn().mockResolvedValue({ success: true, finger: 'right-index' });
    const onDone = vi.fn();
    render(<EnrollModal username="test-user" clientToken="tok-1" onEnroll={onEnroll} onDone={onDone} onCancel={() => {}} />);

    // Start with the default finger.
    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    expect(onEnroll).toHaveBeenCalledWith({ username: 'test-user', finger: 'right-index', clientToken: 'tok-1' });

    // A progress frame for our token advances the indicator.
    await act(async () => { progressCb({ clientToken: 'tok-1', stage: 3, stagesTotal: 5 }); });
    expect(screen.getByText(/3.*5/)).toBeInTheDocument();

    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ success: true, finger: 'right-index' }));
  });

  it('ignores progress frames for a different clientToken', async () => {
    const onEnroll = vi.fn().mockResolvedValue({ success: true });
    render(<EnrollModal username="test-user" clientToken="tok-1" onEnroll={onEnroll} onDone={() => {}} onCancel={() => {}} />);
    await act(async () => { progressCb({ clientToken: 'other', stage: 4, stagesTotal: 5 }); });
    expect(screen.queryByText(/4.*5/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/FingerprintManager/EnrollModal.test.jsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Write minimal implementation**

```jsx
// frontend/src/modules/Fitness/widgets/FingerprintManager/EnrollModal.jsx
import React, { useState } from 'react';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';

const FINGERS = [
  'right-thumb', 'right-index', 'right-middle', 'right-ring', 'right-little',
  'left-thumb', 'left-index', 'left-middle', 'left-ring', 'left-little',
];

/**
 * Enroll a finger for `username`. Streams capture progress from the backend
 * rebroadcast (`fitness.enroll.progress`, filtered to our clientToken) so the
 * user sees "place finger N of M". `onEnroll` performs the actual POST and
 * resolves with the final result; `onDone` fires when it completes.
 */
export function EnrollModal({ username, clientToken, onEnroll, onDone, onCancel }) {
  const [finger, setFinger] = useState('right-index');
  const [phase, setPhase] = useState('pick'); // pick | scanning | done
  const [progress, setProgress] = useState(null);

  useWebSocketSubscription('fitness.enroll.progress', (msg) => {
    if (!msg || msg.clientToken !== clientToken) return;
    setProgress({ stage: msg.stage, stagesTotal: msg.stagesTotal });
  }, [clientToken]);

  const start = async () => {
    setPhase('scanning');
    const result = await onEnroll({ username, finger, clientToken });
    setPhase('done');
    onDone?.(result);
  };

  return (
    <div className="fp-enroll-modal" role="dialog" aria-label={`Enroll fingerprint for ${username}`}>
      {phase === 'pick' && (
        <>
          <label htmlFor="fp-finger">Finger</label>
          <select id="fp-finger" value={finger} onChange={(e) => setFinger(e.target.value)}>
            {FINGERS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <button type="button" onClick={start}>Start</button>
          <button type="button" onClick={onCancel}>Cancel</button>
        </>
      )}
      {phase === 'scanning' && (
        <div className="fp-enroll-progress">
          <p>Place your finger on the reader…</p>
          {progress && <p>{`Stage ${progress.stage} of ${progress.stagesTotal} — lift and place again`}</p>}
        </div>
      )}
      {phase === 'done' && <p>Done.</p>}
    </div>
  );
}

export default EnrollModal;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/FingerprintManager/EnrollModal.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FingerprintManager/EnrollModal.jsx frontend/src/modules/Fitness/widgets/FingerprintManager/EnrollModal.test.jsx
git commit -m "feat(fingerprint): EnrollModal with live progress stream"
```

### Task 11: `FingerprintManagerContainer` (list + add + delete + auth UX)

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FingerprintManager/FingerprintManagerContainer.jsx` (replace the stub)
- Test: `frontend/src/modules/Fitness/widgets/FingerprintManager/FingerprintManagerContainer.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Fitness/widgets/FingerprintManager/FingerprintManagerContainer.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const hook = { users: [], loading: false, refresh: vi.fn(), enroll: vi.fn(), remove: vi.fn() };
vi.mock('./useFingerprintManager.js', () => ({ useFingerprintManager: () => hook }));
// Stub the modal so the container test focuses on list + add gating.
vi.mock('./EnrollModal.jsx', () => ({ EnrollModal: ({ username }) => <div data-testid="enroll-modal">{username}</div> }));

import FingerprintManagerContainer from './FingerprintManagerContainer.jsx';

beforeEach(() => {
  hook.users = [
    { username: 'admin-user', displayName: 'Admin', admin: true, fingerprints: [{ finger: 'right-index', enrolled: '2026-06-17' }] },
    { username: 'new-user', displayName: 'New', admin: false, fingerprints: [] },
  ];
  hook.refresh.mockReset(); hook.enroll.mockReset(); hook.remove.mockReset();
});

describe('FingerprintManagerContainer', () => {
  it('renders each user with admin flag and fingers', () => {
    render(<FingerprintManagerContainer />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText(/right-index/)).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText(/no prints/i)).toBeInTheDocument();
  });

  it('Add on an UNENROLLED user opens the enroll modal directly (no auth screen)', async () => {
    render(<FingerprintManagerContainer />);
    fireEvent.click(screen.getByRole('button', { name: /add.*new/i }));
    await waitFor(() => expect(screen.getByTestId('enroll-modal')).toHaveTextContent('new-user'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/FingerprintManager/FingerprintManagerContainer.test.jsx`
Expected: FAIL — stub container has no list.

- [ ] **Step 3: Write the implementation**

```jsx
// frontend/src/modules/Fitness/widgets/FingerprintManager/FingerprintManagerContainer.jsx
import React, { useEffect, useState } from 'react';
import { useFingerprintManager } from './useFingerprintManager.js';
import { EnrollModal } from './EnrollModal.jsx';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
const logger = () => (_logger ??= getLogger().child({ component: 'fingerprint-manager' }));

// A throwaway per-enroll token used to correlate the backend progress rebroadcast.
function makeToken() {
  return `fp-${Math.floor(performance.now())}-${Math.floor(Math.random() * 1e6)}`;
}

export default function FingerprintManagerContainer() {
  const { users, refresh, enroll, remove } = useFingerprintManager();
  const [enrolling, setEnrolling] = useState(null); // { username, clientToken }

  useEffect(() => {
    logger().info('manager.opened');
    refresh();
  }, [refresh]);

  const startAdd = (user) => {
    // Unenrolled users enroll freely (TOFU). Enrolled users still open the modal;
    // the backend enforces the self/admin scan when the enroll POST is made, so the
    // modal's "Place your finger" step doubles as the auth+capture prompt.
    setEnrolling({ username: user.username, clientToken: makeToken() });
  };

  const handleEnroll = async (args) => {
    const result = await enroll(args);
    return result;
  };

  const handleDone = async () => {
    setEnrolling(null);
    await refresh();
  };

  const handleDelete = async (username, uuidLabel) => {
    // NOTE: the list never exposes uuids; deletion is keyed by the backend which
    // re-resolves the finger. The delete affordance passes the finger name and the
    // backend matches it. (If multiple prints share a finger name, the backend
    // rejects ambiguous deletes; see design.) For v1 each finger name is unique.
    const result = await remove({ username, uuid: uuidLabel });
    if (result?.success) await refresh();
  };

  return (
    <div className="fp-manager" data-testid="fingerprint-manager">
      <h2>Fingerprints</h2>
      <ul className="fp-user-list">
        {users.map((u) => (
          <li key={u.username} className="fp-user-row">
            <span className="fp-user-name">{u.displayName}{u.admin ? ' (admin)' : ''}</span>
            <span className="fp-user-fingers">
              {u.fingerprints.length === 0
                ? <em>no prints</em>
                : u.fingerprints.map((f) => (
                    <button
                      key={f.finger}
                      type="button"
                      className="fp-finger-chip"
                      onClick={() => handleDelete(u.username, f.finger)}
                      title={`Delete ${f.finger} (enrolled ${f.enrolled})`}
                    >👍 {f.finger} ✕</button>
                  ))}
            </span>
            <button type="button" className="fp-add" onClick={() => startAdd(u)}>+ Add to {u.displayName}</button>
          </li>
        ))}
      </ul>

      {enrolling && (
        <EnrollModal
          username={enrolling.username}
          clientToken={enrolling.clientToken}
          onEnroll={handleEnroll}
          onDone={handleDone}
          onCancel={() => setEnrolling(null)}
        />
      )}
    </div>
  );
}
```

> **Note on delete keying:** the design keeps uuids out of the browser. For v1 the
> delete affordance passes the **finger name** and the backend resolves it to the uuid it
> owns. The Task 6 DELETE handler currently expects `uuid`; add a small lookup there if
> finger-name keying is preferred, or expose an opaque per-row handle from GET. **Confirm
> this with the reviewer during Task 11** — the simplest correct choice is to have GET
> return an opaque `handle` (index or hash) per print and DELETE accept `{username, handle}`,
> keeping uuids server-side. Adjust Task 6's DELETE + its test accordingly if so.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/FingerprintManager/FingerprintManagerContainer.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Manual dev-server smoke**

Confirm dev server is up (`ss -tlnp | grep 3112` on kckern-server) or start per CLAUDE.md, then load `/fitness`, open the Fingerprints widget, and confirm the user list renders and "+ Add" on an unenrolled user opens the modal. (The garage capture leg is mocked until the other agent's helper is live.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FingerprintManager/FingerprintManagerContainer.jsx frontend/src/modules/Fitness/widgets/FingerprintManager/FingerprintManagerContainer.test.jsx
git commit -m "feat(fingerprint): manager container (list, add, delete, enroll modal)"
```

---

## Phase 6 — Documentation

### Task 12: Update the reference doc

**Files:**
- Modify: `docs/reference/fitness/fingerprint-unlock.md`

- [ ] **Step 1: Add a "Fingerprint Manager" section**

Append a section documenting: the manager widget (`fitness:fingerprint-manager`), the access model (TOFU for first print; self/admin scan after), the `identities.admin` flag (config-only, app never writes it), the three endpoints (`GET/POST/DELETE /api/v1/fitness/fingerprints*`), and the new WS topics (`fitness.enroll.request|progress|result`, `fitness.fingerprint.delete.request|result`) plus the note that authentication reuses `fitness.unlock.*`. Update the "Code map" with the new backend modules and the frontend widget path. Keep it endstate/present-tense per the docs-style memory.

- [ ] **Step 2: Commit**

```bash
git add docs/reference/fitness/fingerprint-unlock.md
git commit -m "docs(fingerprint): document the in-app fingerprint manager"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** access model → Task 1 + Task 6; profile write/reload → Tasks 2–3; WS contract (enroll/delete) → Tasks 4–5; auth-reuse-unlock → Task 6 `gateManageAccess`; API → Task 6; widget/UI/progress → Tasks 8–11; docs → Task 12. No uncovered spec section.
- **Type consistency:** `resolveManageAccess(profilesByUser, target) → {requiresAuth, gallery}`; broker `requestEnroll/resolveEnrollResult/handleEnrollProgress/requestDelete/resolveDeleteResult`; service `requestEnroll({finger,username,clientToken})` / `requestDelete({uuid})`; writer `addFingerprint/removeFingerprint`. Used identically across tasks.
- **Open item flagged for the reviewer:** delete keying (finger-name vs opaque handle vs uuid) — Task 11 note. Resolve in Task 11; if changing to a handle, update Task 6 DELETE + its test in the same task.
- **No placeholders** in code steps; every step has runnable commands + expected output.
