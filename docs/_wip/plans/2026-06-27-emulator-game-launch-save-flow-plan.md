# Emulator Game Launch & Save Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the emulator's fingerprint-up-front launch with an admin-gated session where games boot fresh+anonymous and saving is opt-in post-launch (load a saver's avatar, or claim the running game), with continuous autosave for identified players.

**Architecture:** Browsing is open; the first launch needs an admin fingerprint that unlocks the arcade for the session (idle/exit re-locks). All games boot fresh+anonymous. Save-enabled games show a transient "Continue as… / Save my game" surface; loading remounts the console with the user's blob, claiming flips persistence on in place. Battery games persist BOTH a state snapshot and the `.srm`; resume prefers the newer snapshot. Autosave runs every ~15s (configurable) once a player is set.

**Tech Stack:** React (vitest + @testing-library/react), Node/Express backend, EmulatorJS engine wrapper, YAML config on the media mount.

**Design spec:** `docs/_wip/plans/2026-06-27-emulator-game-launch-save-flow-design.md`

**Test runner (all tasks):** `npx vitest run --config vitest.config.mjs <path>` (verified working for both `frontend/**` and `backend/**` specs).

---

## File map

| File | Responsibility | Change |
|------|----------------|--------|
| `backend/src/4_api/v1/routers/lib/emulatorFs.mjs` | FS helpers | Add `listSaveUsers`, `makeReadSettingsConfig` |
| `backend/src/4_api/v1/routers/lib/emulatorFs.test.mjs` | FS tests | Add cases |
| `backend/src/4_api/v1/routers/emulator.mjs` | Router | Add `GET /saves/:system/:gameId`; `settings` in `/library`; `listSaveUsers` dep |
| `backend/src/4_api/v1/routers/emulator.test.mjs` | Router tests | Add cases |
| `backend/src/3_applications/emulator/loadEmulatorConfig.mjs` | Config normalize | Add `readSettings` → `cfg.settings` |
| `backend/src/3_applications/emulator/loadEmulatorConfig.test.mjs` | Config tests | Add case |
| `backend/src/app.mjs` | Wiring | Pass `readSettings` + `listSaveUsers` |
| `frontend/src/modules/Emulator/core/launchModel.js` | Pure launch decisions | Add `supportsSave/freshLaunch/loadLaunch/claimLaunch`; remove old API in Task 9 |
| `frontend/src/modules/Emulator/core/launchModel.test.js` | Tests | Add/replace cases |
| `frontend/src/modules/Emulator/core/saveClient.js` | Save HTTP client | Add `persistResume/clearResume`; kind-aware `loadResume` |
| `frontend/src/modules/Emulator/core/saveClient.test.js` | Tests | Add/replace cases |
| `frontend/src/modules/Fitness/identity/IdentityProvider.jsx` | Identity | Add `adminOnly`/`registerAdmin` |
| `frontend/src/modules/Fitness/identity/IdentityProvider.test.jsx` | Tests | Add case |
| `frontend/src/modules/Emulator/ui/PlayerSelect.jsx` | Identity surface | **Create** |
| `frontend/src/modules/Emulator/ui/PlayerSelect.scss` | Styles | **Create** |
| `frontend/src/modules/Emulator/ui/PlayerSelect.test.jsx` | Tests | **Create** |
| `frontend/src/modules/Emulator/EmulatorConsole.jsx` | Console | Autosave; post-mount persistence; kind-aware load; capture-both |
| `frontend/src/modules/Emulator/EmulatorConsole.test.jsx` | Tests | Add autosave case |
| `frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.jsx` | Orchestration | Rewrite |
| `frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.test.jsx` | Tests | Rewrite save-flow cases |

---

## Task 1: Backend — enumerate users with a save for a game

**Files:**
- Modify: `backend/src/4_api/v1/routers/lib/emulatorFs.mjs`
- Test: `backend/src/4_api/v1/routers/lib/emulatorFs.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `emulatorFs.test.mjs` (it already imports from `./emulatorFs.mjs`, `os`, `path`, `fs`):

```js
import { listSaveUsers } from './emulatorFs.mjs';

describe('listSaveUsers', () => {
  function tmpEmu() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'emu-saves-'));
  }

  it('returns [] when nothing exists', () => {
    const dir = tmpEmu();
    expect(listSaveUsers(dir, 'gb', 'pokemon-red')).toEqual([]);
  });

  it('finds users with a .srm and users with a state dir, sorted + deduped', () => {
    const dir = tmpEmu();
    // battery: {system}/saves/{user}/{gameId}.srm
    fs.mkdirSync(path.join(dir, 'gb', 'saves', 'soren'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'gb', 'saves', 'soren', 'pokemon-red.srm'), 'x');
    fs.mkdirSync(path.join(dir, 'gb', 'saves', 'milo'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'gb', 'saves', 'milo', 'other-game.srm'), 'x'); // different game
    // state: {system}/states/{user}/{gameId}/{slot}.state
    fs.mkdirSync(path.join(dir, 'gb', 'states', 'alan', 'pokemon-red'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'gb', 'states', 'alan', 'pokemon-red', 'auto.state'), 'x');
    fs.mkdirSync(path.join(dir, 'gb', 'states', 'soren', 'pokemon-red'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'gb', 'states', 'soren', 'pokemon-red', 'auto.state'), 'x'); // dup of soren
    expect(listSaveUsers(dir, 'gb', 'pokemon-red')).toEqual(['alan', 'soren']);
  });

  it('rejects unsafe segments', () => {
    const dir = tmpEmu();
    expect(() => listSaveUsers(dir, '..', 'x')).toThrow('unsafe path segment');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/lib/emulatorFs.test.mjs`
Expected: FAIL — `listSaveUsers is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `emulatorFs.mjs`, add near the other resolvers (after `resolveStatePath`):

```js
/**
 * Directory names (only) under `dir`, or [] if it doesn't exist.
 */
function userDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * List user slugs that have a save for {system}/{gameId} — either a battery
 * `.srm` under saves/{user}/ or a non-empty state dir under states/{user}/.
 * Sorted + deduped. Used by GET /saves to populate the "Continue as…" row.
 */
export function listSaveUsers(emulationDir, system, gameId) {
  safeSegment(system);
  safeSegment(gameId);
  const users = new Set();

  const savesRoot = path.join(emulationDir, system, 'saves');
  for (const user of userDirs(savesRoot)) {
    if (fs.existsSync(path.join(savesRoot, user, `${gameId}.srm`))) users.add(user);
  }

  const statesRoot = path.join(emulationDir, system, 'states');
  for (const user of userDirs(statesRoot)) {
    const gameDir = path.join(statesRoot, user, gameId);
    try {
      if (fs.statSync(gameDir).isDirectory() && fs.readdirSync(gameDir).length > 0) users.add(user);
    } catch { /* absent */ }
  }

  return Array.from(users).sort();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/lib/emulatorFs.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/lib/emulatorFs.mjs backend/src/4_api/v1/routers/lib/emulatorFs.test.mjs
git commit -m "feat(emulator): listSaveUsers — enumerate users with a save for a game"
```

---

## Task 2: Backend — GET /saves/:system/:gameId route

**Files:**
- Modify: `backend/src/4_api/v1/routers/emulator.mjs` (deps block ~line 96; routes after the states block ~line 357)
- Modify: `backend/src/app.mjs:1322` (router construction)
- Test: `backend/src/4_api/v1/routers/emulator.test.mjs`

- [ ] **Step 1: Write the failing test**

Add to `emulator.test.mjs`. First extend `makeApp`'s `deps` with a `listSaveUsers` stub (add this line inside the `deps` object, next to `resolveStatePath`):

```js
    listSaveUsers: vi.fn((system, gameId) => (gameId === 'pokemon-red' ? ['soren', 'alan'] : [])),
```

Then add the describe block below. `resolveGameRules` reads the **normalized** `game.saveMode` field, so the save-enabled case supplies it via a `loadConfig` override — do NOT edit the shared `makeCfg()` (its `pokemon-red` game has no save mode on purpose; the existing "default none" library test depends on that). `request` from `supertest` is already imported at the top of the file — do not re-import.

```js
describe('GET /saves/:system/:gameId', () => {
  const batteryCfg = () => ({ ...makeCfg(), games: [{ ...makeCfg().games[0], saveMode: 'battery' }] });

  it('returns the saver list for a save-enabled game', async () => {
    const { app } = makeApp({ loadConfig: batteryCfg });
    const res = await request(app).get('/api/v1/emulator/saves/gb/pokemon-red');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ users: ['soren', 'alan'] });
  });

  it('returns [] for a none-save game without scanning', async () => {
    const { app, deps } = makeApp({
      loadConfig: () => ({ ...makeCfg(), games: [{ id: 'tetris', system: 'gb', title: 'Tetris', saveMode: 'none' }] }),
    });
    const res = await request(app).get('/api/v1/emulator/saves/gb/tetris');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ users: [] });
    expect(deps.listSaveUsers).not.toHaveBeenCalled();
  });

  it('400s on an unsafe segment', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/emulator/saves/gb/..%2Fetc');
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/emulator.test.mjs`
Expected: FAIL — 404 (route missing) on the first case.

- [ ] **Step 3: Write minimal implementation**

In `emulator.mjs`, add `listSaveUsers` to the destructured deps (in `createEmulatorRouter({ ... })`, alongside `resolveStatePath`):

```js
  resolveStatePath,
  listSaveUsers,
```

Add the route just before the final `return router;`:

```js
  // ---- GET /saves/:system/:gameId -----------------------------------------
  // Users who have a save for this game (drives the "Continue as…" row).
  // Returns [] for none-save games without touching the FS.
  router.get('/saves/:system/:gameId', (req, res) => {
    let system, gameId;
    try {
      system = safeSegment(req.params.system);
      gameId = safeSegment(req.params.gameId);
    } catch {
      return res.status(400).json({ error: 'bad request' });
    }
    if (typeof listSaveUsers !== 'function') return res.json({ users: [] });
    try {
      const cfg = loadConfig();
      const rules = resolveGameRules(cfg, gameId, null) ?? {};
      const saveMode = rules.saveMode ?? 'none';
      if (saveMode === 'none') return res.json({ users: [] });
      res.json({ users: listSaveUsers(system, gameId) });
    } catch (err) {
      logger.error('emulator.saves.error', { system, gameId, error: err.message });
      res.status(500).json({ error: 'internal error' });
    }
  });
```

In `backend/src/app.mjs`, add to the `createEmulatorRouter({ ... })` call (next to the `resolveStatePath` line ~1338):

```js
      listSaveUsers: (system, gameId) => emuFs.listSaveUsers(emulationDir, system, gameId),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/emulator.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/emulator.mjs backend/src/4_api/v1/routers/emulator.test.mjs backend/src/app.mjs
git commit -m "feat(emulator): GET /saves/:system/:gameId — saver list for the identity surface"
```

---

## Task 3: Backend — emulator settings (autosave / idle-relock / admin-gate)

**Files:**
- Modify: `backend/src/4_api/v1/routers/lib/emulatorFs.mjs`
- Modify: `backend/src/3_applications/emulator/loadEmulatorConfig.mjs`
- Modify: `backend/src/4_api/v1/routers/emulator.mjs` (`/library` response)
- Modify: `backend/src/app.mjs:1322` (pass `readSettings`)
- Test: `backend/src/3_applications/emulator/loadEmulatorConfig.test.mjs`, `backend/src/4_api/v1/routers/emulator.test.mjs`

- [ ] **Step 1: Write the failing test (config normalize)**

Add to `loadEmulatorConfig.test.mjs` (mirror the existing call style — it injects `readManifests`/`readInputConfig`/`readConsoles`):

```js
describe('settings', () => {
  it('defaults when readSettings returns null', () => {
    const cfg = loadEmulatorConfig({ emulationDir: '/x', readManifests: () => [], readSettings: () => null });
    expect(cfg.settings).toEqual({ autosaveSeconds: 15, idleRelockMinutes: 10, adminGate: true });
  });

  it('takes provided values and coerces adminGate:false', () => {
    const cfg = loadEmulatorConfig({
      emulationDir: '/x',
      readManifests: () => [],
      readSettings: () => ({ autosaveSeconds: 30, idleRelockMinutes: 5, adminGate: false }),
    });
    expect(cfg.settings).toEqual({ autosaveSeconds: 30, idleRelockMinutes: 5, adminGate: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.mjs backend/src/3_applications/emulator/loadEmulatorConfig.test.mjs`
Expected: FAIL — `cfg.settings` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `loadEmulatorConfig.mjs`, add `readSettings` to the destructured params:

```js
export function loadEmulatorConfig({ emulationDir, readManifests, readInputConfig, readConsoles, readSettings, logger = NOOP_LOGGER }) {
```

Just before the function's `return { ... }`, build settings:

```js
  const rawSettings = (typeof readSettings === 'function' ? readSettings() : null) ?? {};
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const settings = {
    autosaveSeconds: num(rawSettings.autosaveSeconds, 15),
    idleRelockMinutes: num(rawSettings.idleRelockMinutes, 10),
    adminGate: rawSettings.adminGate !== false,
  };
```

Add `settings` to the returned object (alongside `input`, `consoles`):

```js
    settings,
```

In `emulatorFs.mjs`, add (next to `makeReadConsolesConfig`):

```js
/**
 * Reader for emulationDir/settings.yml — autosaveSeconds / idleRelockMinutes /
 * adminGate. Returns null when absent/unparseable; loadEmulatorConfig defaults.
 */
export function makeReadSettingsConfig(emulationDir) {
  const settingsPath = path.join(emulationDir, 'settings.yml');
  return function readSettings() {
    let raw;
    try {
      raw = fs.readFileSync(settingsPath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
    try {
      return yaml.load(raw) ?? null;
    } catch {
      return null;
    }
  };
}
```

In `emulator.mjs`, the `/library` handler — add `settings` to the JSON (the `res.json({ systems, consoles, games, input: cfg.input ?? null });` line becomes):

```js
      res.json({ systems, consoles, games, input: cfg.input ?? null, settings: cfg.settings ?? null });
```

In `app.mjs`, add to the `loadEmulatorConfig({ ... })` call (next to `readConsoles`):

```js
        readSettings: emuFs.makeReadSettingsConfig(emulationDir),
```

- [ ] **Step 4: Write + run the /library settings test**

Add to `emulator.test.mjs` inside the existing `GET /library` describe (the `makeCfg`/`loadConfig` stub returns a plain cfg — extend it to include `settings`). Add this case:

```js
  it('includes settings in the library payload', async () => {
    const { app } = makeApp({
      loadConfig: () => ({ ...makeCfg(), settings: { autosaveSeconds: 15, idleRelockMinutes: 10, adminGate: true } }),
    });
    const res = await request(app).get('/api/v1/emulator/library');
    expect(res.body.settings).toEqual({ autosaveSeconds: 15, idleRelockMinutes: 10, adminGate: true });
  });
```

Run both:
```
npx vitest run --config vitest.config.mjs backend/src/3_applications/emulator/loadEmulatorConfig.test.mjs backend/src/4_api/v1/routers/emulator.test.mjs
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/emulator/loadEmulatorConfig.mjs backend/src/3_applications/emulator/loadEmulatorConfig.test.mjs backend/src/4_api/v1/routers/lib/emulatorFs.mjs backend/src/4_api/v1/routers/emulator.mjs backend/src/4_api/v1/routers/emulator.test.mjs backend/src/app.mjs
git commit -m "feat(emulator): settings.yml (autosave/idle-relock/admin-gate) surfaced in /library"
```

---

## Task 4: Frontend — invert launchModel (additive)

**Files:**
- Modify: `frontend/src/modules/Emulator/core/launchModel.js`
- Test: `frontend/src/modules/Emulator/core/launchModel.test.js`

> Additive: keep the old `requiresIdentity`/`resolveLaunch` exports (still imported by the not-yet-rewritten widget) so this commit stays green. They are removed in Task 9.

- [ ] **Step 1: Write the failing test**

Add to `launchModel.test.js`:

```js
import { supportsSave, freshLaunch, loadLaunch, claimLaunch } from './launchModel.js';

describe('new launch model', () => {
  it('supportsSave is true for state/battery, false otherwise', () => {
    expect(supportsSave('state')).toBe(true);
    expect(supportsSave('battery')).toBe(true);
    expect(supportsSave('none')).toBe(false);
    expect(supportsSave(undefined)).toBe(false);
  });

  it('freshLaunch is anonymous + non-persisting', () => {
    expect(freshLaunch()).toEqual({ action: 'fresh', persist: false, userId: null });
  });

  it('loadLaunch resumes + persists for the user', () => {
    expect(loadLaunch('soren')).toEqual({ action: 'resume', persist: true, userId: 'soren' });
  });

  it('claimLaunch keeps the fresh game + persists for the user', () => {
    expect(claimLaunch('milo')).toEqual({ action: 'fresh', persist: true, userId: 'milo' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Emulator/core/launchModel.test.js`
Expected: FAIL — `supportsSave is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `launchModel.js` (keep the existing exports for now):

```js
/** True when the saveMode supports persistence (state or battery). */
export function supportsSave(saveMode) {
  return saveMode === 'state' || saveMode === 'battery';
}

/** Boot fresh + anonymous. Identity/saving is opt-in post-launch. */
export function freshLaunch() {
  return { action: 'fresh', persist: false, userId: null };
}

/** Load an identified user's existing save → resume + persist. */
export function loadLaunch(userId) {
  return { action: 'resume', persist: true, userId };
}

/** Claim the running fresh game for an identified user → keep playing + persist. */
export function claimLaunch(userId) {
  return { action: 'fresh', persist: true, userId };
}
```

And extend the default export object:

```js
export default { SAVE_MODES, requiresIdentity, resolveLaunch, supportsSave, freshLaunch, loadLaunch, claimLaunch };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Emulator/core/launchModel.test.js`
Expected: PASS (old + new cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Emulator/core/launchModel.js frontend/src/modules/Emulator/core/launchModel.test.js
git commit -m "feat(emulator): add fresh/load/claim launch model (additive inversion)"
```

---

## Task 5: Frontend — saveClient battery-both (snapshot-preferred)

**Files:**
- Modify: `frontend/src/modules/Emulator/core/saveClient.js`
- Test: `frontend/src/modules/Emulator/core/saveClient.test.js`

> `loadResume` becomes kind-aware and battery becomes snapshot-preferred; `persistResume`/`clearResume` are new and handle battery's two blobs. The old `persist`/`clear` stay until the widget switches (Task 9).

- [ ] **Step 1: Write the failing test**

Add to `saveClient.test.js`:

```js
describe('battery-both resume', () => {
  it('loadResume(battery) prefers the snapshot, falls back to .srm', async () => {
    // snapshot present → kind:state
    let fetchImpl = vi.fn(async (url) =>
      url.includes('/state/') ? res({ status: 200, buffer: new ArrayBuffer(4) }) : res({ status: 404 }));
    let r = await clientWith(fetchImpl).loadResume({ system: 'gb', gameId: 'g', user: 'soren', saveMode: 'battery' });
    expect(r.status).toBe('ok');
    expect(r.kind).toBe('state');

    // snapshot absent, .srm present → kind:battery
    fetchImpl = vi.fn(async (url) =>
      url.includes('/state/') ? res({ status: 404 }) : res({ status: 200, buffer: new ArrayBuffer(4) }));
    r = await clientWith(fetchImpl).loadResume({ system: 'gb', gameId: 'g', user: 'soren', saveMode: 'battery' });
    expect(r.status).toBe('ok');
    expect(r.kind).toBe('battery');

    // neither → absent
    fetchImpl = vi.fn(async () => res({ status: 404 }));
    r = await clientWith(fetchImpl).loadResume({ system: 'gb', gameId: 'g', user: 'soren', saveMode: 'battery' });
    expect(r.status).toBe('absent');
  });

  it('persistResume(battery) writes BOTH state + save', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => { calls.push([url, init?.method]); return res({ status: 200 }); });
    const r = await clientWith(fetchImpl).persistResume({
      system: 'gb', gameId: 'g', user: 'soren', saveMode: 'battery',
      captured: { state: new Uint8Array([1]), battery: new Uint8Array([2]) },
    });
    expect(r.status).toBe('ok');
    expect(calls.some(([u, m]) => u.includes('/state/') && m === 'PUT')).toBe(true);
    expect(calls.some(([u, m]) => u.includes('/save/') && m === 'PUT')).toBe(true);
  });

  it('persistResume(state) writes only the snapshot', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => { calls.push([url, init?.method]); return res({ status: 200 }); });
    await clientWith(fetchImpl).persistResume({
      system: 'gb', gameId: 'g', user: 'soren', saveMode: 'state', captured: { state: new Uint8Array([1]) },
    });
    expect(calls.every(([u]) => u.includes('/state/'))).toBe(true);
  });

  it('clearResume(battery) deletes BOTH', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => { calls.push([url, init?.method]); return res({ status: 200 }); });
    const r = await clientWith(fetchImpl).clearResume({ system: 'gb', gameId: 'g', user: 'soren', saveMode: 'battery' });
    expect(r.status).toBe('ok');
    expect(calls.filter(([, m]) => m === 'DELETE').length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Emulator/core/saveClient.test.js`
Expected: FAIL — `persistResume is not a function` (and `loadResume` has no `kind`).

- [ ] **Step 3: Write minimal implementation**

In `saveClient.js`, replace the existing `loadResume` convenience method and add `persistResume`/`clearResume` in the returned object (keep `persist`/`clear` for now):

```js
    /**
     * Load the resume blob, snapshot-preferred for battery. Returns a
     * discriminated result with `kind` ('state'|'battery') on success so the
     * caller injects via the matching engine path.
     */
    async loadResume({ system, gameId, user, saveMode, slot = DEFAULT_SLOT }) {
      if (saveMode === 'state') {
        const r = await getBlob(stateUrl(system, gameId, slot, user));
        return r.status === 'ok' ? { ...r, kind: 'state' } : r;
      }
      if (saveMode === 'battery') {
        const s = await getBlob(stateUrl(system, gameId, slot, user));
        if (s.status === 'ok') return { ...s, kind: 'state' };
        const b = await getBlob(saveUrl(system, gameId, user));
        if (b.status === 'ok') return { ...b, kind: 'battery' };
        return s.status === 'error' ? s : b; // surface an error over a plain absent
      }
      return absent();
    },
    /**
     * Persist the resume blob(s) for the mode. `captured` is { state?, battery? };
     * battery writes both. Returns ok only if every write succeeds.
     */
    async persistResume({ system, gameId, user, saveMode, captured, slot = DEFAULT_SLOT }) {
      if (saveMode === 'state') {
        if (!captured?.state) return errorResult(null, 'no state bytes');
        return putBlob(stateUrl(system, gameId, slot, user), captured.state);
      }
      if (saveMode === 'battery') {
        const results = [];
        if (captured?.state) results.push(await putBlob(stateUrl(system, gameId, slot, user), captured.state));
        if (captured?.battery) results.push(await putBlob(saveUrl(system, gameId, user), captured.battery));
        if (!results.length) return errorResult(null, 'no bytes');
        return results.every((r) => r.status === 'ok') ? ok() : errorResult(null, 'partial persist');
      }
      return errorResult(null, `unsupported saveMode: ${saveMode}`);
    },
    /** Erase all resume blobs for the mode (reset / overwrite). */
    async clearResume({ system, gameId, user, saveMode, slot = DEFAULT_SLOT }) {
      if (saveMode === 'state') return deleteBlob(stateUrl(system, gameId, slot, user));
      if (saveMode === 'battery') {
        const a = await deleteBlob(stateUrl(system, gameId, slot, user));
        const b = await deleteBlob(saveUrl(system, gameId, user));
        return a.status === 'ok' && b.status === 'ok' ? ok() : errorResult(null, 'partial clear');
      }
      return errorResult(null, `unsupported saveMode: ${saveMode}`);
    },
```

> If the old `loadResume` method still exists below, delete it (there must be exactly one `loadResume`). Leave the old `persist` and `clear` methods in place — Task 9 removes them.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Emulator/core/saveClient.test.js`
Expected: PASS. (If a pre-existing `loadResume(battery)→/save/` test now fails, update it to expect snapshot-preferred behavior — it is intentionally changed.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Emulator/core/saveClient.js frontend/src/modules/Emulator/core/saveClient.test.js
git commit -m "feat(emulator): saveClient persistResume/clearResume + snapshot-preferred battery loadResume"
```

---

## Task 6: Frontend — IdentityProvider admin gate

**Files:**
- Modify: `frontend/src/modules/Fitness/identity/IdentityProvider.jsx`
- Test: `frontend/src/modules/Fitness/identity/IdentityProvider.test.jsx`

- [ ] **Step 1: Write the failing test**

Add to `IdentityProvider.test.jsx`, using the file's existing harness: `render(<IdentityProvider><Probe onReady={...}/></IdentityProvider>)` to capture the context, `emit(payload)` to inject a `fitness.identity.detected` event (it wraps `act` + sets the topic), and the file's `test`/`waitFor` imports. The roster mock only contains user `kc`, so use `kc`:

```js
test('registerAdmin resolves only for an admin finger', async () => {
  let api;
  render(<IdentityProvider><Probe onReady={(x) => { api = x; }} /></IdentityProvider>);
  let verdict;
  act(() => { api.registerAdmin('emulator').then((v) => { verdict = v; }); });

  // Recognized but non-admin → not granted; promise stays pending.
  emit({ matched: true, userId: 'kc', authz: { admin: false, locks: [] } });
  await waitFor(() => expect(api.unlockState).toBe('unauthorized'));
  expect(verdict).toBeUndefined();

  // Admin finger → granted.
  emit({ matched: true, userId: 'kc', authz: { admin: true } });
  await waitFor(() => expect(verdict).toMatchObject({ matched: true, userId: 'kc' }));
});
```

> The file already mocks the chime (`playCueOnce`) to resolve immediately and imports `act`/`render`/`waitFor` — no new imports needed.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/identity/IdentityProvider.test.jsx`
Expected: FAIL — `ctx.registerAdmin is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `IdentityProvider.jsx`:

Add a ref near `identifyOnlyRef`:

```js
  const adminOnlyRef = useRef(false);
```

In `handleIdentity`, change the `authorized` computation (the modal-open branch) to honor admin-only:

```js
      const authorized = recognized
        && (identifyOnlyRef.current
          || (adminOnlyRef.current
            ? msg.authz?.admin === true
            : (Array.isArray(msg.authz?.locks) && msg.authz.locks.includes(lock))));
```

In `registerUnlock`, accept and store `adminOnly`:

```js
  const registerUnlock = useCallback((lock, { identifyOnly = false, adminOnly = false } = {}) => {
    primeCueAudio('unlock-request');
    activeLockRef.current = lock;
    identifyOnlyRef.current = !!identifyOnly;
    adminOnlyRef.current = !!adminOnly;
    pendingGrantRef.current = null;
    setActiveLock(lock);
    setUnlockState('scanning');
    setUnlockedUser(null);
    logger().info('unlock-registered', { lock, identifyOnly: !!identifyOnly, adminOnly: !!adminOnly });
    return new Promise((resolve) => { verdictResolverRef.current = resolve; });
  }, []);
```

Add the sugar next to `registerIdentify`:

```js
  // Sugar for "require an admin finger" — authorizes on authz.admin regardless of
  // per-lock permissions. Used by the emulator arcade unlock gate.
  const registerAdmin = useCallback(
    (lock = 'admin') => registerUnlock(lock, { adminOnly: true }),
    [registerUnlock],
  );
```

In `clearUnlock`, reset the ref:

```js
    adminOnlyRef.current = false;
```

Add `registerAdmin` to the context `value` object and its dependency array (next to `registerIdentify`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/identity/IdentityProvider.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/identity/IdentityProvider.jsx frontend/src/modules/Fitness/identity/IdentityProvider.test.jsx
git commit -m "feat(identity): registerAdmin / adminOnly authorization gate"
```

---

## Task 7: Frontend — PlayerSelect identity surface

**Files:**
- Create: `frontend/src/modules/Emulator/ui/PlayerSelect.jsx`
- Create: `frontend/src/modules/Emulator/ui/PlayerSelect.scss`
- Test: `frontend/src/modules/Emulator/ui/PlayerSelect.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlayerSelect } from './PlayerSelect.jsx';

const savers = [
  { userId: 'soren', name: 'Soren', avatarSrc: '/s.png' },
  { userId: 'milo', name: 'Milo', avatarSrc: '/m.png' },
];

describe('PlayerSelect', () => {
  it('hidden state shows only a re-open toggle', () => {
    const onReopen = vi.fn();
    render(<PlayerSelect visible={false} savers={savers} onReopen={onReopen} />);
    expect(screen.queryByText('Continue as…')).toBeNull();
    fireEvent.pointerDown(screen.getByLabelText('Players'));
    expect(onReopen).toHaveBeenCalled();
  });

  it('lists savers and fires onLoad / onClaim / onDismiss', () => {
    const onLoad = vi.fn(); const onClaim = vi.fn(); const onDismiss = vi.fn();
    render(<PlayerSelect visible savers={savers} onLoad={onLoad} onClaim={onClaim} onDismiss={onDismiss} />);
    fireEvent.pointerDown(screen.getByLabelText('Continue as Soren'));
    expect(onLoad).toHaveBeenCalledWith('soren');
    fireEvent.pointerDown(screen.getByText('Save my game'));
    expect(onClaim).toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('shows a message and an empty-saver hint', () => {
    render(<PlayerSelect visible savers={[]} message="That's not Soren." onLoad={() => {}} onClaim={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText("That's not Soren.")).toBeTruthy();
    expect(screen.getByText('No saved games yet')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Emulator/ui/PlayerSelect.test.jsx`
Expected: FAIL — cannot resolve `./PlayerSelect.jsx`.

- [ ] **Step 3: Write minimal implementation**

`PlayerSelect.jsx`:

```jsx
/**
 * PlayerSelect — the transient post-launch identity surface for save-enabled
 * games. Presentation-only: the host wires load/claim/dismiss. When hidden it
 * collapses to a corner "Players" toggle so an anonymous player can re-open it.
 */
import React from 'react';
import './PlayerSelect.scss';

export function PlayerSelect({
  visible,
  savers = [],
  message = null,
  onLoad = () => {},
  onClaim = () => {},
  onDismiss = () => {},
  onReopen = () => {},
}) {
  if (!visible) {
    return (
      <button
        type="button"
        className="emu-player-select__reopen"
        aria-label="Players"
        onPointerDown={onReopen}
      >
        👥
      </button>
    );
  }

  return (
    <div className="emu-player-select" role="dialog" aria-label="Choose a player">
      <button type="button" className="emu-player-select__dismiss" aria-label="Dismiss" onPointerDown={onDismiss}>✕</button>
      <div className="emu-player-select__title">Continue as…</div>
      {message && <div className="emu-player-select__message">{message}</div>}
      <div className="emu-player-select__savers">
        {savers.length === 0 && <div className="emu-player-select__empty">No saved games yet</div>}
        {savers.map((s) => (
          <button
            key={s.userId}
            type="button"
            className="emu-player-select__saver"
            aria-label={`Continue as ${s.name}`}
            onPointerDown={() => onLoad(s.userId)}
          >
            <img src={s.avatarSrc} alt="" className="emu-player-select__avatar" />
            <span>{s.name}</span>
          </button>
        ))}
      </div>
      <button type="button" className="emu-player-select__claim" onPointerDown={onClaim}>Save my game</button>
    </div>
  );
}

export default PlayerSelect;
```

`PlayerSelect.scss`:

```scss
.emu-player-select {
  position: absolute;
  top: 1.5rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 40;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-radius: 1rem;
  background: rgba(12, 16, 24, 0.92);
  color: #fff;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);

  &__title { font-weight: 600; }
  &__message { color: #ffd27a; font-size: 0.9rem; }
  &__savers { display: flex; gap: 0.75rem; flex-wrap: wrap; }
  &__empty { opacity: 0.6; font-size: 0.9rem; }
  &__saver {
    display: flex; flex-direction: column; align-items: center; gap: 0.25rem;
    background: none; border: 0; color: inherit; cursor: pointer;
  }
  &__avatar { width: 56px; height: 56px; border-radius: 50%; object-fit: cover; background: #333; }
  &__claim {
    align-self: center; padding: 0.5rem 1.25rem; border: 0; border-radius: 999px;
    background: #2f7; color: #042; font-weight: 700; cursor: pointer;
  }
  &__dismiss { position: absolute; top: 0.5rem; right: 0.75rem; background: none; border: 0; color: #aaa; cursor: pointer; }
}
.emu-player-select__reopen {
  position: absolute; top: 1.5rem; left: 50%; transform: translateX(-50%); z-index: 40;
  width: 48px; height: 48px; border-radius: 50%; border: 0; cursor: pointer;
  background: rgba(12, 16, 24, 0.85); font-size: 1.25rem;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Emulator/ui/PlayerSelect.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Emulator/ui/PlayerSelect.jsx frontend/src/modules/Emulator/ui/PlayerSelect.scss frontend/src/modules/Emulator/ui/PlayerSelect.test.jsx
git commit -m "feat(emulator): PlayerSelect identity surface (continue-as / save-my-game)"
```

---

## Task 8: Frontend — EmulatorConsole autosave + post-mount persistence + capture-both

**Files:**
- Modify: `frontend/src/modules/Emulator/EmulatorConsole.jsx`
- Test: `frontend/src/modules/Emulator/EmulatorConsole.test.jsx`

> The persistence contract's `saveResume` now takes a captured object `{ state?, battery? }` (not raw bytes), and `loadResume` returns `{ ..., kind }`. This task makes the console produce/consume that shape and adds the autosave interval. The widget supplies the matching contract in Task 9.

- [ ] **Step 1: Write the failing test**

Add to `EmulatorConsole.test.jsx`. Extend the fake `engine` in `makeFactories()` with capture/load-by-kind methods:

```js
    captureState: vi.fn(() => new Uint8Array([9, 9])),
    captureSave: vi.fn(() => new Uint8Array([7])),
    loadState: vi.fn(() => true),
    loadSave: vi.fn(() => true),
    isReady: vi.fn(() => true),
```

Then add the test (uses fake timers + a persistence contract spy):

```js
describe('autosave', () => {
  it('persists captured state on the configured interval for a save-enabled session', async () => {
    vi.useFakeTimers();
    const { factories, engine } = makeFactories();
    const saveResume = vi.fn(() => Promise.resolve({ status: 'ok' }));
    const persistence = {
      saveMode: 'battery', persist: true, userId: 'soren',
      loadResume: () => Promise.resolve({ status: 'absent' }),
      saveResume,
      clearResume: () => Promise.resolve({ status: 'ok' }),
    };
    await act(async () => {
      render(
        <EmulatorConsole
          game={baseGame}
          engineConfig={{ core: 'gb', controls: {} }}
          governanceGate={makeGate()}
          identity={{ getActivePlayerId: () => 'soren' }}
          persistence={persistence}
          autosaveSeconds={15}
          factories={factories}
        />,
      );
      await Promise.resolve(); // let session.start() settle
    });
    await act(async () => { vi.advanceTimersByTime(15000); await Promise.resolve(); });
    expect(saveResume).toHaveBeenCalled();
    const captured = saveResume.mock.calls[0][0];
    expect(captured).toHaveProperty('state');
    expect(captured).toHaveProperty('battery'); // battery captures both
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Emulator/EmulatorConsole.test.jsx`
Expected: FAIL — `saveResume` not called (no autosave; prop unused).

- [ ] **Step 3: Write minimal implementation**

In `EmulatorConsole.jsx`:

Add `autosaveSeconds = 15` to the destructured props (next to `persistence`).

Add a module-level helper near the top (after the imports / constants):

```js
/**
 * Capture the resume blob(s) for a save mode. Battery captures BOTH a state
 * snapshot and the .srm; state captures only the snapshot. Returns
 * { state?, battery? } or null when nothing was captured.
 */
function captureForMode(engine, saveMode) {
  if (saveMode === 'state') {
    const state = engine.captureState?.();
    return state ? { state } : null;
  }
  if (saveMode === 'battery') {
    const captured = {};
    const state = engine.captureState?.();
    if (state) captured.state = state;
    const battery = engine.captureSave?.();
    if (battery) captured.battery = battery;
    return Object.keys(captured).length ? captured : null;
  }
  return null;
}
```

Change the **boot-time resume injection** (inside the boot `.then`, where it currently does `engine.loadResume(p.saveMode, result.data)`):

```js
            if (result?.status === 'ok' && result.data) {
              const ok = engine.loadResume(result.kind || p.saveMode, result.data);
              logger.info('emulator.console.resume-loaded', { ok, kind: result.kind || p.saveMode });
            } else if (result?.status === 'error') {
```

Change the **on-exit persist** (in the cleanup, where it currently does `eng.captureResume(p.saveMode)` → `p.saveResume(bytes)`):

```js
        if (p?.persist && p?.saveResume) {
          const captured = captureForMode(eng, p.saveMode);
          if (captured) {
            logger.info('emulator.console.persist-start', { saveMode: p.saveMode });
            Promise.resolve(p.saveResume(captured))
              .then((result) => {
                if (result?.status === 'ok') logger.info('emulator.console.persisted', { saveMode: p.saveMode });
                else logger.warn('emulator.console.persist-failed', { saveMode: p.saveMode, status: result?.status ?? 'unknown', httpStatus: result?.httpStatus ?? null });
              })
              .catch((err) => logger.warn('emulator.console.persist-failed', { saveMode: p.saveMode, error: err && err.message }));
          } else {
            logger.warn('emulator.console.persist-skipped', { saveMode: p.saveMode, reason: 'no-bytes' });
          }
        }
```

Add an **autosave interval effect** (a new top-level `useEffect`, e.g. right after the elapsed-timer effect). It reads `persistence` reactively so a post-mount claim starts it:

```js
  // Continuous autosave: once the session is save-enabled AND user-scoped,
  // capture + persist the resume blob(s) every autosaveSeconds. Re-runs when
  // persistence flips active (the claim path), so saving starts without remount.
  useEffect(() => {
    if (!autosaveSeconds || !persistence?.persist || !persistence?.userId) return undefined;
    const id = setInterval(() => {
      const cur = persistenceRef.current;
      const eng = runtimeRef.current?.engine;
      if (!eng || !cur?.persist || !cur?.userId || !cur?.saveResume) return;
      const captured = captureForMode(eng, cur.saveMode);
      if (!captured) return;
      Promise.resolve(cur.saveResume(captured))
        .then((result) => {
          if (result?.status === 'ok') logger.debug('emulator.console.autosaved', { saveMode: cur.saveMode });
          else if (result?.status !== 'skipped') logger.warn('emulator.console.autosave-failed', { saveMode: cur.saveMode, status: result?.status ?? 'unknown' });
        })
        .catch((err) => logger.warn('emulator.console.autosave-failed', { error: err && err.message }));
    }, autosaveSeconds * 1000);
    return () => clearInterval(id);
  }, [autosaveSeconds, persistence?.persist, persistence?.userId, persistence?.saveMode, logger]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Emulator/EmulatorConsole.test.jsx`
Expected: PASS. (If a pre-existing test asserted the old `captureResume`/raw-bytes `saveResume` exit path, update it to the captured-object shape.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Emulator/EmulatorConsole.jsx frontend/src/modules/Emulator/EmulatorConsole.test.jsx
git commit -m "feat(emulator): console autosave interval + capture-both + post-mount persistence"
```

---

## Task 9: Frontend — EmulatorGameWidget orchestration rewrite

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.jsx` (full rewrite)
- Modify: `frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.test.jsx` (rewrite save-flow cases)
- Modify: `frontend/src/modules/Emulator/core/launchModel.js` (remove old `requiresIdentity`/`resolveLaunch`)
- Modify: `frontend/src/modules/Emulator/core/launchModel.test.js` (remove old cases)
- Modify: `frontend/src/modules/Emulator/core/saveClient.js` (remove old `persist`/`clear`)

- [ ] **Step 1: Write the failing tests**

Replace the OLD save-enabled up-front cases in `EmulatorGameWidget.test.jsx` (the ones around the old `registerIdentify`-up-front flow) with these. Also add `registerAdmin` to the identity mock object and reset it in `beforeEach`:

```js
// in the identity mock object:
const identity = { registerIdentify: vi.fn(), registerAdmin: vi.fn(), clearUnlock: vi.fn(), unlockState: 'idle', unlockedUser: null };
// in beforeEach:
identity.registerAdmin.mockReset();
// stub the new saveClient surface:
const saveClient = { loadResume: vi.fn(), persistResume: vi.fn(), clearResume: vi.fn() };
vi.mock('../../../Emulator/core/saveClient.js', () => ({ createSaveClient: () => saveClient }));
// add a PlayerSelect stub so the test can drive load/claim:
vi.mock('../../../Emulator/ui/PlayerSelect.jsx', () => ({
  PlayerSelect: ({ visible, savers, onLoad, onClaim }) => (visible ? (
    <div data-testid="player-select">
      {savers.map((s) => (
        <button key={s.userId} data-testid={`saver-${s.userId}`} onClick={() => onLoad(s.userId)}>{s.name}</button>
      ))}
      <button data-testid="claim" onClick={onClaim}>Save my game</button>
    </div>
  ) : null),
}));
```

New cases:

```js
describe('EmulatorGameWidget save flow', () => {
  it('save-enabled kiosk launch: admin gate first, then boots fresh + opens PlayerSelect', async () => {
    kiosk.value = true;
    api.mockImplementation((p) => {
      if (p === 'api/v1/emulator/library') return Promise.resolve(libraryWith('battery'));
      if (p.startsWith('api/v1/emulator/saves/')) return Promise.resolve({ users: ['soren'] });
      return Promise.resolve({});
    });
    identity.registerAdmin.mockResolvedValue({ matched: true, userId: 'dad', authz: { admin: true } });
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Pokémon Red')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Pokémon Red'));
    await waitFor(() => expect(identity.registerAdmin).toHaveBeenCalled());
    const el = await screen.findByTestId('console');
    expect(el.getAttribute('data-persist')).toBe('0'); // fresh + anonymous
    await screen.findByTestId('player-select');
    expect(screen.getByTestId('saver-soren')).toBeTruthy();
  });

  it('second launch in the same session skips the admin gate', async () => {
    kiosk.value = true;
    api.mockImplementation((p) => p === 'api/v1/emulator/library'
      ? Promise.resolve(libraryWith('none'))
      : Promise.resolve({ users: [] }));
    identity.registerAdmin.mockResolvedValue({ matched: true, authz: { admin: true } });
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Pokémon Red')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Pokémon Red'));
    await screen.findByTestId('console');
    fireEvent.click(screen.getByTestId('console')); // not a real exit; instead simulate exit via onExit below
    // Re-launch path: exit then relaunch
    // (drive exit through the console stub's onExit if exposed; otherwise assert registerAdmin called once)
    expect(identity.registerAdmin).toHaveBeenCalledTimes(1);
  });

  it('loading a saver verifies identity then remounts persisting under them', async () => {
    kiosk.value = true;
    api.mockImplementation((p) => p === 'api/v1/emulator/library'
      ? Promise.resolve(libraryWith('battery'))
      : Promise.resolve({ users: ['soren'] }));
    identity.registerAdmin.mockResolvedValue({ matched: true, authz: { admin: true } });
    identity.registerIdentify.mockResolvedValue({ matched: true, userId: 'soren' });
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Pokémon Red')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Pokémon Red'));
    await screen.findByTestId('player-select');
    fireEvent.click(screen.getByTestId('saver-soren'));
    await waitFor(() => {
      const el = screen.getByTestId('console');
      expect(el.getAttribute('data-persist')).toBe('1');
      expect(el.getAttribute('data-user')).toBe('soren');
    });
  });
});
```

> The "second launch skips admin gate" case is awkward without an exit hook on the console stub. Extend the console mock to expose `onExit` via a button so the test can exit and relaunch:
> ```js
> // in the EmulatorConsole mock JSX, add:
> // <button data-testid="exit" onClick={() => props.onExit?.()}>exit</button>
> ```
> Then in the test: after first launch, `fireEvent.click(screen.getByTestId('exit'))`, await the grid, relaunch the game, and assert `registerAdmin` was still called only once.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.test.jsx`
Expected: FAIL — widget still does the old up-front flow / no `registerAdmin`.

- [ ] **Step 3: Write the implementation (full file rewrite)**

Replace `EmulatorGameWidget.jsx` entirely with:

```jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DaylightAPI, DaylightMediaPath } from '../../../../lib/api.mjs';
import getLogger from '../../../../lib/logging/Logger.js';
import { isKioskEnv } from '@/lib/kioskEnv.js';
import { EmulatorConsole } from '../../../Emulator/EmulatorConsole.jsx';
import { ArcadeShell } from '../../../Emulator/ui/ArcadeShell.jsx';
import { PlayerSelect } from '../../../Emulator/ui/PlayerSelect.jsx';
import { buildEjsControls } from '../../../Emulator/input/buildEjsControls.js';
import { createSaveClient } from '../../../Emulator/core/saveClient.js';
import { supportsSave, freshLaunch, loadLaunch, claimLaunch } from '../../../Emulator/core/launchModel.js';
import { buildFitnessGameGate } from './fitnessGameGate.js';
import { useIdentity } from '../../identity/IdentityProvider';
import UnlockPrompt from '../../player/overlays/UnlockPrompt.jsx';

const ENGINE_PATH = '/api/v1/emulator/engine/';
const DEFAULT_AUTOSAVE_SECONDS = 15;
const DEFAULT_IDLE_RELOCK_MINUTES = 10;

function resolveControllerGamepad(controllers) {
  const list = Array.isArray(controllers) ? controllers : [];
  const pads = (typeof navigator !== 'undefined' && navigator.getGamepads)
    ? Array.from(navigator.getGamepads()).filter(Boolean)
    : [];
  for (const c of list) {
    if (!c?.gamepad) continue;
    let re = null;
    try { re = c.match ? new RegExp(c.match, 'i') : null; } catch { re = null; }
    if (re && pads.some((p) => re.test(p.id))) return c.gamepad;
  }
  return list.find((c) => c?.gamepad)?.gamepad || {};
}

/**
 * EmulatorGameWidget — the "Video Games" arcade shell host.
 *
 * Browse (open) → admin-gate the FIRST launch of a session → boot fresh +
 * anonymous → optional post-launch identity (load a saver, or claim to save).
 * The console + engine lifecycle lives in EmulatorConsole; this widget owns
 * the session unlock, identity surface, and save decisions.
 */
export default function EmulatorGameWidget({ fitnessContext, onClose, config, onMount }) {
  const logger = useMemo(() => getLogger().child({ component: 'fitness-emulator' }), []);
  const { registerIdentify, registerAdmin, clearUnlock, unlockState, unlockedUser } = useIdentity();

  const [library, setLibrary] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState('arcade'); // 'arcade' | 'admin' | 'identify' | 'playing'
  const [arcadeUnlocked, setArcadeUnlocked] = useState(false);
  const [pendingGame, setPendingGame] = useState(null);
  const [launch, setLaunch] = useState(null);
  const [savers, setSavers] = useState([]);
  const [playerSelectOpen, setPlayerSelectOpen] = useState(false);
  const [selectMessage, setSelectMessage] = useState(null);
  const [claimConflict, setClaimConflict] = useState(null);

  const saveClient = useMemo(() => createSaveClient(), []);
  const zonesOrder = useMemo(() => Object.keys(fitnessContext?.zones || {}), [fitnessContext]);
  const getActivePlayerId = fitnessContext?.getActivePlayerId
    || (() => fitnessContext?.fitnessSessionInstance?.roster?.[0]?.userId ?? null);
  const getUserVitals = fitnessContext?.getUserVitals || (() => null);

  const settings = library?.settings || {};
  const autosaveSeconds = Number.isFinite(Number(settings.autosaveSeconds)) ? Number(settings.autosaveSeconds) : DEFAULT_AUTOSAVE_SECONDS;
  const idleRelockMinutes = Number.isFinite(Number(settings.idleRelockMinutes)) ? Number(settings.idleRelockMinutes) : DEFAULT_IDLE_RELOCK_MINUTES;
  const adminGate = settings.adminGate !== false;

  // --- Load the library once ---
  useEffect(() => {
    let alive = true;
    DaylightAPI('api/v1/emulator/library').then((lib) => {
      if (!alive) return;
      setLibrary({
        games: lib?.games || [],
        consoles: lib?.consoles || [],
        systems: lib?.systems || {},
        input: lib?.input || {},
        settings: lib?.settings || {},
      });
      logger.info('fitness-emulator.library-loaded', { games: (lib?.games || []).length, consoles: (lib?.consoles || []).length });
      onMount?.();
    }).catch((e) => {
      if (!alive) return;
      setError(e.message);
      logger.error('fitness-emulator.load-failed', { error: e.message });
      onMount?.();
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hand the gamepad to EmulatorJS only while a game is up.
  useEffect(() => {
    window.__emulatorCapturingGamepad = view === 'playing';
    return () => { window.__emulatorCapturingGamepad = false; };
  }, [view]);

  // Idle re-lock: while sitting at the unlocked grid, re-lock after N minutes.
  useEffect(() => {
    if (!arcadeUnlocked || view !== 'arcade' || !idleRelockMinutes) return undefined;
    const id = setTimeout(() => {
      setArcadeUnlocked(false);
      logger.info('fitness-emulator.relock', {});
    }, idleRelockMinutes * 60 * 1000);
    return () => clearTimeout(id);
  }, [arcadeUnlocked, view, idleRelockMinutes, logger]);

  // Resolve a person card (name + avatar) for a userId.
  const resolvePersonCard = useCallback((userId) => {
    if (!userId) return null;
    const roster = fitnessContext?.userCollections?.all || [];
    const match = roster.find((u) => [u?.id, u?.slug, u?.name].filter(Boolean)
      .map((s) => String(s).toLowerCase()).includes(String(userId).toLowerCase()));
    return {
      userId,
      name: match?.displayName || match?.name || match?.title || userId,
      avatarSrc: DaylightMediaPath(`/static/img/users/${userId}`),
    };
  }, [fitnessContext]);

  // Build the per-user save/resume contract (snapshot-preferred via saveClient).
  const buildPersistence = useCallback((game, { userId, persist }) => {
    const ctx = { system: game.system, gameId: game.id, user: userId, saveMode: game.saveMode };
    return {
      saveMode: game.saveMode,
      persist: !!persist,
      userId: userId || null,
      loadResume: () => (userId ? saveClient.loadResume(ctx) : Promise.resolve({ status: 'absent' })),
      saveResume: (captured) => (persist && userId ? saveClient.persistResume({ ...ctx, captured }) : Promise.resolve({ status: 'skipped' })),
      clearResume: () => (userId ? saveClient.clearResume(ctx) : Promise.resolve({ status: 'skipped' })),
    };
  }, [saveClient]);

  const buildLaunchContext = useCallback((game, { userId, persist }) => {
    const controls = buildEjsControls(library?.input?.keyboard || {}, resolveControllerGamepad(library?.input?.controllers));
    const gate = buildFitnessGameGate({ game, zonesOrder, getActivePlayerId, getUserVitals });
    const engineConfig = {
      pathtodata: ENGINE_PATH,
      core: game.core || library?.systems?.[game.system]?.core || game.system || 'gb',
      controls,
    };
    return { game, engineConfig, gate, persistence: buildPersistence(game, { userId, persist }) };
  }, [library, zonesOrder, getActivePlayerId, getUserVitals, buildPersistence]);

  // Commit a launch. `remountKey` forces a fresh console mount (the load path).
  const startGame = useCallback((game, decision, { remountKey } = {}) => {
    const ctx = buildLaunchContext(game, decision);
    setLaunch({
      ...ctx,
      userId: decision.userId,
      person: resolvePersonCard(decision.userId),
      startedAt: Date.now(),
      key: remountKey ?? `${game.id}:${decision.userId || 'anon'}:${Date.now()}`,
    });
    setView('playing');
    logger.info('fitness-emulator.launch', { game: game.id, action: decision.action, persist: decision.persist, user: decision.userId || null });
  }, [buildLaunchContext, resolvePersonCard, logger]);

  // Fetch savers + open the transient identity surface (save-enabled, kiosk only).
  const openIdentitySurface = useCallback((game) => {
    if (!supportsSave(game.saveMode) || !isKioskEnv()) return;
    DaylightAPI(`api/v1/emulator/saves/${game.system}/${game.id}`).then((r) => {
      const users = Array.isArray(r?.users) ? r.users : [];
      setSavers(users.map((uid) => resolvePersonCard(uid)).filter(Boolean));
      setPlayerSelectOpen(true);
      logger.info('fitness-emulator.savers-loaded', { game: game.id, count: users.length });
    }).catch((e) => {
      setSavers([]);
      setPlayerSelectOpen(true);
      logger.warn('fitness-emulator.savers-failed', { error: e.message });
    });
  }, [resolvePersonCard, logger]);

  // Launch a game fresh + anonymous, then surface identity for save games.
  const launchFresh = useCallback((game) => {
    setSelectMessage(null);
    setClaimConflict(null);
    startGame(game, freshLaunch());
    openIdentitySurface(game);
  }, [startGame, openIdentitySurface]);

  // Game tapped → admin gate ONCE per session, then launch.
  const handleSelectGame = useCallback((game) => {
    if (arcadeUnlocked || !adminGate || !isKioskEnv()) { launchFresh(game); return; }
    setPendingGame(game);
    setView('admin');
    registerAdmin('emulator').then((verdict) => {
      setPendingGame(null);
      if (verdict?.matched) {
        setArcadeUnlocked(true);
        launchFresh(game);
      } else {
        setView('arcade');
      }
    });
  }, [arcadeUnlocked, adminGate, registerAdmin, launchFresh]);

  const cancelGate = useCallback(() => {
    setView(launch ? 'playing' : 'arcade');
    clearUnlock();
  }, [clearUnlock, launch]);

  // Flip the running session to persist under userId (post-mount; no remount).
  const activateSave = useCallback((userId) => {
    setClaimConflict(null);
    setPlayerSelectOpen(false);
    setSelectMessage(null);
    setLaunch((prev) => (prev
      ? { ...prev, userId, person: resolvePersonCard(userId), persistence: buildPersistence(prev.game, { userId, persist: true }) }
      : prev));
    logger.info('fitness-emulator.claim', { user: userId });
  }, [buildPersistence, resolvePersonCard, logger]);

  // Load a saver's existing save: verify it IS them, then remount as that user.
  const handleLoadSaver = useCallback((userId) => {
    const game = launch?.game;
    if (!game) return;
    const name = resolvePersonCard(userId)?.name || userId;
    setPendingGame(game);
    setView('identify');
    registerIdentify(`Continue as ${name}`).then((verdict) => {
      setPendingGame(null);
      setView('playing');
      if (verdict?.matched && String(verdict.userId).toLowerCase() === String(userId).toLowerCase()) {
        setPlayerSelectOpen(false);
        setSelectMessage(null);
        startGame(game, loadLaunch(userId), { remountKey: `${game.id}:${userId}:${Date.now()}` });
      } else if (verdict?.matched) {
        setSelectMessage(`That's not ${name}.`);
      }
    });
  }, [launch, registerIdentify, resolvePersonCard, startGame]);

  // "Save my game": identify whoever scans → claim (warn if they already have a save).
  const handleClaim = useCallback(() => {
    const game = launch?.game;
    if (!game) return;
    setPendingGame(game);
    setView('identify');
    registerIdentify('Save my game').then((verdict) => {
      setPendingGame(null);
      setView('playing');
      if (!verdict?.matched) return;
      const uid = verdict.userId;
      if (savers.some((s) => String(s.userId).toLowerCase() === String(uid).toLowerCase())) {
        setClaimConflict(resolvePersonCard(uid));
      } else {
        activateSave(uid);
      }
    });
  }, [launch, registerIdentify, savers, resolvePersonCard, activateSave]);

  const handleExitGame = useCallback(() => {
    setLaunch(null);
    setView('arcade');
    setPlayerSelectOpen(false);
    setSavers([]);
    setSelectMessage(null);
    setClaimConflict(null);
  }, []);

  if (error) return <div className="fitness-emulator__error">Video games unavailable: {error}</div>;
  if (!library) return <div className="fitness-emulator__loading">Loading…</div>;

  const anonymousSaveGame = view === 'playing' && launch && supportsSave(launch.game.saveMode) && !launch.userId;

  return (
    <>
      <ArcadeShell
        consoles={library.consoles}
        games={library.games}
        onSelectGame={handleSelectGame}
        onExit={onClose}
        resolveMediaUrl={(p) => DaylightMediaPath(p)}
        inputEnabled={view === 'arcade'}
      />
      <UnlockPrompt
        open={view === 'admin' || view === 'identify'}
        state={unlockState}
        lockLabel={pendingGame
          ? (view === 'admin' ? `Admin unlock — ${pendingGame.title || pendingGame.id}` : `Verify — ${pendingGame.title || pendingGame.id}`)
          : null}
        unlockedUser={unlockedUser}
        onCancel={cancelGate}
      />
      {view !== 'arcade' && launch && createPortal(
        <div className="fitness-emulator-fullscreen">
          <EmulatorConsole
            key={launch.key}
            game={launch.game}
            engineConfig={launch.engineConfig}
            governanceGate={launch.gate}
            identity={{ getActivePlayerId: () => launch.userId }}
            persistence={launch.persistence}
            autosaveSeconds={autosaveSeconds}
            nowPlaying={launch.person}
            playStartedAt={launch.startedAt}
            resolveMediaUrl={(p) => DaylightMediaPath(p)}
            onExit={handleExitGame}
          />
          {anonymousSaveGame && (
            <PlayerSelect
              visible={playerSelectOpen}
              savers={savers}
              message={selectMessage}
              onLoad={handleLoadSaver}
              onClaim={handleClaim}
              onDismiss={() => setPlayerSelectOpen(false)}
              onReopen={() => setPlayerSelectOpen(true)}
            />
          )}
          {claimConflict && (
            <div className="fitness-emulator-claim-conflict" role="alertdialog" aria-label="Overwrite save">
              <div className="fitness-emulator-claim-conflict__card">
                <p>This replaces {claimConflict.name}&apos;s saved game. Continue?</p>
                <div className="fitness-emulator-claim-conflict__actions">
                  <button type="button" onPointerDown={() => setClaimConflict(null)}>Cancel</button>
                  <button type="button" onPointerDown={() => activateSave(claimConflict.userId)}>Overwrite</button>
                </div>
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
```

> Note: the console is rendered for `view !== 'arcade'` (so it stays mounted during the `admin`/`identify` overlay sub-states once a game is up). The admin gate fires before any game is launched, so during `admin` with no `launch` yet, the portal simply doesn't render — `UnlockPrompt` carries the UI.

Now remove the deprecated APIs:

- In `launchModel.js`, delete `requiresIdentity` and `resolveLaunch` and drop them from the default export (keep `SAVE_MODES`, `supportsSave`, `freshLaunch`, `loadLaunch`, `claimLaunch`).
- In `launchModel.test.js`, delete the old `describe('requiresIdentity')` and `describe('resolveLaunch')` blocks.
- In `saveClient.js`, delete the old `persist` and `clear` convenience methods (the low-level `getSave/putSave/deleteSave/getState/putState/deleteState` stay). Update `saveClient.test.js` to drop any `persist`/`clear` cases (the new `persistResume`/`clearResume` cases from Task 5 cover this).

- [ ] **Step 4: Run the full affected suite to verify it passes**

Run:
```
npx vitest run --config vitest.config.mjs \
  frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.test.jsx \
  frontend/src/modules/Emulator/core/launchModel.test.js \
  frontend/src/modules/Emulator/core/saveClient.test.js \
  frontend/src/modules/Emulator/EmulatorConsole.test.jsx
```
Expected: PASS (all four files).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.jsx frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.test.jsx frontend/src/modules/Emulator/core/launchModel.js frontend/src/modules/Emulator/core/launchModel.test.js frontend/src/modules/Emulator/core/saveClient.js frontend/src/modules/Emulator/core/saveClient.test.js
git commit -m "feat(emulator): admin-gated session + post-launch load/claim save flow"
```

---

## Task 10: Full regression, build, deploy, manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full emulator + identity test surface**

Run:
```
npx vitest run --config vitest.config.mjs \
  frontend/src/modules/Emulator \
  frontend/src/modules/Fitness/widgets/EmulatorGame \
  frontend/src/modules/Fitness/identity \
  backend/src/4_api/v1/routers/emulator.test.mjs \
  backend/src/4_api/v1/routers/lib/emulatorFs.test.mjs \
  backend/src/3_applications/emulator/loadEmulatorConfig.test.mjs
```
Expected: all PASS. Capture the final `Test Files … passed` / `Tests … passed` line (do not trust a piped exit code — read the summary line).

- [ ] **Step 2: Seed the live settings file (optional tuning)**

Defaults work with no file. To override, write `emulation/settings.yml` on the media mount (inside the container, per CLAUDE.local heredoc rule — never `sed -i`):

```bash
sudo docker exec daylight-station sh -c "cat > media/emulation/settings.yml << 'EOF'
autosaveSeconds: 15
idleRelockMinutes: 10
adminGate: true
EOF"
```
Then verify the live payload includes settings:
```bash
curl -s http://localhost:3111/api/v1/emulator/library | head -c 400
```
Expected: JSON containing `"settings":{"autosaveSeconds":15,...}`.

- [ ] **Step 3: Confirm the garage is clear, then build + deploy**

Per CLAUDE.local deploy gate (HALT if active). Check BOTH gates first:
```bash
sudo docker logs --since 75s daylight-station 2>&1 | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
```
Only if clear (zero render lines, `sessionActive:false`, `rosterSize:0`), build + deploy:
```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 4: Reload the garage fitness display**

```bash
ssh garage 'DISPLAY=:0 XAUTHORITY=/home/kckern/.Xauthority \
  xdotool search --onlyvisible --class firefox windowactivate --sync key ctrl+shift+r'
```

- [ ] **Step 5: Manual verification matrix (on the garage display)**

Walk the permutations and confirm each against the spec:
1. Open Games → grid shows (no admin prompt to browse).
2. Tap any game (incl. a `none`-save one) → admin fingerprint prompt; cancel returns to grid.
3. Admin scan → game boots fresh; tap a SECOND game → no admin prompt (session unlocked).
4. Save-enabled game → "Continue as…" surface appears with savers + "Save my game"; dismiss → corner toggle re-opens it.
5. Tap a saver → its owner's finger loads + resumes; a different recognized finger shows "That's not …".
6. "Save my game" as a NEW user → autosave begins (watch logs for `emulator.console.autosaved` ~every 15s).
7. "Save my game" as an EXISTING saver → overwrite warning → Overwrite proceeds, Cancel keeps anonymous.
8. Battery game: confirm BOTH a `.srm` and a state snapshot are written under `media/emulation/{system}/{saves,states}/{user}/…`, and that resume returns you to the snapshot point.
9. Leave the unlocked grid idle past `idleRelockMinutes` → next launch re-prompts admin.

Verify save files landed (read-only host path is fine):
```bash
ls -R /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media/emulation/*/states 2>/dev/null | head
```

- [ ] **Step 6: Update docs marker**

```bash
git rev-parse HEAD > docs/docs-last-updated.txt
git add docs/docs-last-updated.txt
git commit -m "docs: mark emulator save-flow as deployed"
```

---

## Notes for the implementer

- **Logging only via the framework** — every new log call uses the child logger already created in each module. No raw `console.*`.
- **Ordering matters for green commits:** Tasks 4/5/8 are additive or contract-forward; the widget (Task 9) is the switch point that removes the old `requiresIdentity`/`resolveLaunch`/`persist`/`clear` and adopts the captured-object `saveResume` shape. Don't reorder 9 before 8.
- **Battery resume priority is snapshot-first** — if you ever see a battery game resume to an in-game-save point instead of the exact snapshot, check `loadResume`'s state-before-save ordering.
- **The fitness gate stays open** — `fitnessGameGate.js` is unchanged; do not reintroduce HR/credit gating here.
