# Dance Party Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fullscreen "Party Mode" Fitness widget that plays a looping muted disco video + a shuffled music playlist while the garage Hue strips run a DJ-mix lighting pattern (colorloop + rate-capped strobe accents) and the white lights drop — all config-driven with graceful fallbacks.

**Architecture:** Backend gets a new `DanceLightingController` (reuses the existing `IHomeAutomationGateway`, leaves the zone `AmbientLedAdapter` untouched) exposed via `POST /api/v1/fitness/dance/{start,accent,stop}`. Frontend gets a `DancePartyWidget` (registered like CycleGame) that composes two shared `<Player>` instances (video + audio), a now-playing bar, and a `useDanceLighting` hook that calls the API on mount/unmount and on track change.

**Tech Stack:** Node ESM backend (`.mjs`), React (`.jsx`/`.js`), vitest for all unit tests, Home Assistant via the HA gateway, Plex playlists via the shared `Player`.

**Spec:** `docs/superpowers/specs/2026-06-09-dance-party-design.md`.

---

## File Structure

| File | Responsibility | New/Modify |
|------|----------------|------------|
| `backend/src/1_adapters/fitness/danceLightingConfig.mjs` | Pure: resolve `dance_party.lighting` config with fallbacks | Create |
| `backend/src/1_adapters/fitness/DanceLightingController.mjs` | HA lighting control: start / accent (throttled) / stop | Create |
| `tests/unit/adapters/fitness/danceLightingConfig.test.mjs` | Config-resolver unit tests | Create |
| `tests/unit/adapters/fitness/DanceLightingController.test.mjs` | Controller unit tests (mock gateway) | Create |
| `backend/src/0_system/bootstrap.mjs` | Instantiate controller, expose it, inject into router | Modify |
| `backend/src/4_api/v1/routers/fitness.mjs` | `/dance/{start,accent,stop}` endpoints | Modify |
| `backend/src/4_api/v1/routers/fitness.dance.test.mjs` | Router endpoint tests (mock controller) | Create |
| `frontend/src/modules/Fitness/widgets/DancePartyWidget/useDanceLighting.js` | Hook: POST start/stop/accent lifecycle | Create |
| `frontend/src/modules/Fitness/widgets/DancePartyWidget/useDanceLighting.test.js` | Hook unit tests (mock api) | Create |
| `frontend/src/modules/Fitness/widgets/DancePartyWidget/DanceNowPlayingBar.jsx` | Now-playing bar + Next + exit ✕ | Create |
| `frontend/src/modules/Fitness/widgets/DancePartyWidget/DanceNowPlayingBar.test.jsx` | Bar render/interaction tests | Create |
| `frontend/src/modules/Fitness/widgets/DancePartyWidget/resolveDancePlaylists.js` | Pure: resolve audio/video playlist ids with fallbacks | Create |
| `frontend/src/modules/Fitness/widgets/DancePartyWidget/resolveDancePlaylists.test.js` | Playlist-resolver tests | Create |
| `frontend/src/modules/Fitness/widgets/DancePartyWidget/DancePartyWidget.jsx` | Fullscreen orchestrator (video + audio + bar + lighting) | Create |
| `frontend/src/modules/Fitness/widgets/DancePartyWidget/DancePartyWidget.scss` | Styles incl. CSS disco fallback | Create |
| `frontend/src/modules/Fitness/widgets/DancePartyWidget/manifest.js` | Widget manifest | Create |
| `frontend/src/modules/Fitness/widgets/DancePartyWidget/index.jsx` | Re-export default + manifest | Create |
| `frontend/src/modules/Fitness/index.js` | Register `fitness:dance-party` | Modify |
| `data/household/config/fitness.yml` | `dance_party:` section (in-container, not git-tracked) | Modify |

**Test commands:** all unit tests run with `./node_modules/.bin/vitest run --config vitest.config.mjs <path>` (backend node specs start with `// @vitest-environment node`).

---

## Task 1: Lighting config resolver (pure, with fallbacks)

**Files:**
- Create: `backend/src/1_adapters/fitness/danceLightingConfig.mjs`
- Create: `tests/unit/adapters/fitness/danceLightingConfig.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolveDanceLightingConfig } from '#adapters/fitness/danceLightingConfig.mjs';

describe('resolveDanceLightingConfig', () => {
  it('applies all defaults when dance_party is absent', () => {
    expect(resolveDanceLightingConfig({})).toEqual({
      enabled: true, colorStrips: [], whiteLights: [], baseEffect: 'colorloop',
      accent: { mode: 'flash', onTrackChange: true, intervalMs: 20000, minIntervalMs: 4000 }
    });
  });

  it('reads configured values', () => {
    const cfg = resolveDanceLightingConfig({ dance_party: { lighting: {
      color_strips: ['light.a', 'light.b'], white_lights: ['light.w'], base_effect: 'colorloop',
      accent: { mode: 'breathe', on_track_change: false, interval_ms: 10000, min_interval_ms: 2000 }
    } } });
    expect(cfg.colorStrips).toEqual(['light.a', 'light.b']);
    expect(cfg.whiteLights).toEqual(['light.w']);
    expect(cfg.accent).toEqual({ mode: 'breathe', onTrackChange: false, intervalMs: 10000, minIntervalMs: 2000 });
  });

  it('enabled=false is honored; unknown accent mode falls back to flash', () => {
    expect(resolveDanceLightingConfig({ dance_party: { enabled: false } }).enabled).toBe(false);
    expect(resolveDanceLightingConfig({ dance_party: { lighting: { accent: { mode: 'nope' } } } }).accent.mode).toBe('flash');
  });

  it('non-array strip config degrades to empty arrays', () => {
    const cfg = resolveDanceLightingConfig({ dance_party: { lighting: { color_strips: 'x', white_lights: null } } });
    expect(cfg.colorStrips).toEqual([]);
    expect(cfg.whiteLights).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/adapters/fitness/danceLightingConfig.test.mjs`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Implement the resolver**

Create `backend/src/1_adapters/fitness/danceLightingConfig.mjs`:

```javascript
/**
 * Resolve the dance_party.lighting config into a normalized shape with fallbacks.
 * Config-driven with graceful degradation: absent config never throws, and a
 * missing capability (e.g. no color_strips) degrades to a no-op downstream.
 */
const ACCENT_MODES = ['flash', 'breathe', 'blink'];

export function resolveDanceLightingConfig(fitnessConfig) {
  const dp = fitnessConfig?.dance_party || {};
  const lighting = dp.lighting || {};
  const accent = lighting.accent || {};
  return {
    enabled: dp.enabled !== false,
    colorStrips: Array.isArray(lighting.color_strips) ? lighting.color_strips : [],
    whiteLights: Array.isArray(lighting.white_lights) ? lighting.white_lights : [],
    baseEffect: typeof lighting.base_effect === 'string' && lighting.base_effect ? lighting.base_effect : 'colorloop',
    accent: {
      mode: ACCENT_MODES.includes(accent.mode) ? accent.mode : 'flash',
      onTrackChange: accent.on_track_change !== false,
      intervalMs: Number.isFinite(accent.interval_ms) ? accent.interval_ms : 20000,
      minIntervalMs: Number.isFinite(accent.min_interval_ms) ? accent.min_interval_ms : 4000
    }
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/adapters/fitness/danceLightingConfig.test.mjs`
Expected: PASS — `Tests 4 passed`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/fitness/danceLightingConfig.mjs tests/unit/adapters/fitness/danceLightingConfig.test.mjs
git commit -m "feat(fitness): dance lighting config resolver with fallbacks"
```

---

## Task 2: DanceLightingController

**Files:**
- Create: `backend/src/1_adapters/fitness/DanceLightingController.mjs`
- Create: `tests/unit/adapters/fitness/DanceLightingController.test.mjs`

Gateway methods used (from `IHomeAutomationGateway`): `callService(domain, service, data)`.

- [ ] **Step 1: Write the failing test**

```javascript
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { DanceLightingController } from '#adapters/fitness/DanceLightingController.mjs';

const cfg = (over = {}) => ({ dance_party: { lighting: {
  color_strips: ['light.strip1', 'light.strip2'],
  white_lights: ['light.white'],
  base_effect: 'colorloop',
  accent: { mode: 'flash', min_interval_ms: 4000 },
  ...over
} } });

const make = (fitnessConfig = cfg()) => {
  const gateway = { callService: vi.fn().mockResolvedValue({ ok: true }) };
  const controller = new DanceLightingController({ gateway, loadFitnessConfig: () => fitnessConfig, logger: { info(){}, warn(){}, error(){}, debug(){} } });
  return { gateway, controller };
};

describe('DanceLightingController', () => {
  it('start: turns off white lights and starts colorloop on the strips', async () => {
    const { gateway, controller } = make();
    const res = await controller.start('h1');
    expect(res.ok).toBe(true);
    expect(gateway.callService).toHaveBeenCalledWith('light', 'turn_off', { entity_id: ['light.white'] });
    expect(gateway.callService).toHaveBeenCalledWith('light', 'turn_on', { entity_id: ['light.strip1', 'light.strip2'], effect: 'colorloop' });
  });

  it('stop: turns white back on and strips off', async () => {
    const { gateway, controller } = make();
    await controller.stop('h1');
    expect(gateway.callService).toHaveBeenCalledWith('light', 'turn_on', { entity_id: ['light.white'] });
    expect(gateway.callService).toHaveBeenCalledWith('light', 'turn_off', { entity_id: ['light.strip1', 'light.strip2'] });
  });

  it('accent: fires a flash then re-asserts the base effect', async () => {
    const { gateway, controller } = make();
    await controller.accent('h1', 1000);
    expect(gateway.callService).toHaveBeenCalledWith('light', 'turn_on', { entity_id: ['light.strip1', 'light.strip2'], flash: 'short' });
    expect(gateway.callService).toHaveBeenCalledWith('light', 'turn_on', { entity_id: ['light.strip1', 'light.strip2'], effect: 'colorloop' });
  });

  it('accent: a second accent within min_interval_ms is rate-limited (no gateway calls)', async () => {
    const { gateway, controller } = make();
    await controller.accent('h1', 1000);
    gateway.callService.mockClear();
    const res = await controller.accent('h1', 1500); // 500ms < 4000ms
    expect(res.skipped).toBe(true);
    expect(gateway.callService).not.toHaveBeenCalled();
  });

  it('accent: breathe mode uses effect instead of flash', async () => {
    const { gateway, controller } = make(cfg({ accent: { mode: 'breathe', min_interval_ms: 0 } }));
    await controller.accent('h1', 1000);
    expect(gateway.callService).toHaveBeenCalledWith('light', 'turn_on', { entity_id: ['light.strip1', 'light.strip2'], effect: 'breathe' });
  });

  it('skips entirely when lighting is unconfigured', async () => {
    const { gateway, controller } = make({});
    const res = await controller.start('h1');
    expect(res.skipped).toBe(true);
    expect(gateway.callService).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/adapters/fitness/DanceLightingController.test.mjs`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Implement the controller**

Create `backend/src/1_adapters/fitness/DanceLightingController.mjs`:

```javascript
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { resolveDanceLightingConfig } from './danceLightingConfig.mjs';

/**
 * DanceLightingController — drives the garage Hue strips for "Party Mode":
 * white lights off + colorloop base, rate-capped strobe accents, simple restore.
 * Reuses IHomeAutomationGateway. Leaves the zone-driven AmbientLedAdapter alone.
 */
export class DanceLightingController {
  #gateway;
  #loadFitnessConfig;
  #logger;
  #lastAccentAt = 0;

  constructor({ gateway, loadFitnessConfig, logger } = {}) {
    if (!gateway) throw new InfrastructureError('DanceLightingController requires gateway', { code: 'MISSING_DEPENDENCY', dependency: 'gateway' });
    if (!loadFitnessConfig) throw new InfrastructureError('DanceLightingController requires loadFitnessConfig', { code: 'MISSING_DEPENDENCY', dependency: 'loadFitnessConfig' });
    this.#gateway = gateway;
    this.#loadFitnessConfig = loadFitnessConfig;
    this.#logger = logger || console;
  }

  #config(householdId) {
    return resolveDanceLightingConfig(this.#loadFitnessConfig(householdId));
  }

  async start(householdId) {
    const cfg = this.#config(householdId);
    if (!cfg.enabled || cfg.colorStrips.length === 0) {
      return { ok: true, skipped: true, reason: 'lighting_not_configured' };
    }
    try {
      if (cfg.whiteLights.length) {
        await this.#gateway.callService('light', 'turn_off', { entity_id: cfg.whiteLights });
      }
      await this.#gateway.callService('light', 'turn_on', { entity_id: cfg.colorStrips, effect: cfg.baseEffect });
      this.#lastAccentAt = 0;
      this.#logger.info?.('fitness.dance.lighting.start', { strips: cfg.colorStrips.length, effect: cfg.baseEffect });
      return { ok: true, started: true };
    } catch (error) {
      this.#logger.error?.('fitness.dance.lighting.start_failed', { error: error.message });
      return { ok: false, error: error.message };
    }
  }

  async accent(householdId, now = Date.now()) {
    const cfg = this.#config(householdId);
    if (!cfg.enabled || cfg.colorStrips.length === 0) {
      return { ok: true, skipped: true, reason: 'lighting_not_configured' };
    }
    if (now - this.#lastAccentAt < cfg.accent.minIntervalMs) {
      return { ok: true, skipped: true, reason: 'rate_limited' };
    }
    this.#lastAccentAt = now;
    try {
      const pop = cfg.accent.mode === 'flash'
        ? { entity_id: cfg.colorStrips, flash: 'short' }
        : { entity_id: cfg.colorStrips, effect: cfg.accent.mode };
      await this.#gateway.callService('light', 'turn_on', pop);
      // Re-assert the base effect so colorloop resumes after the pop.
      await this.#gateway.callService('light', 'turn_on', { entity_id: cfg.colorStrips, effect: cfg.baseEffect });
      return { ok: true, accented: true };
    } catch (error) {
      this.#logger.error?.('fitness.dance.lighting.accent_failed', { error: error.message });
      return { ok: false, error: error.message };
    }
  }

  async stop(householdId) {
    const cfg = this.#config(householdId);
    try {
      if (cfg.whiteLights.length) {
        await this.#gateway.callService('light', 'turn_on', { entity_id: cfg.whiteLights });
      }
      if (cfg.colorStrips.length) {
        await this.#gateway.callService('light', 'turn_off', { entity_id: cfg.colorStrips });
      }
      this.#logger.info?.('fitness.dance.lighting.stop', {});
      return { ok: true, stopped: true };
    } catch (error) {
      this.#logger.error?.('fitness.dance.lighting.stop_failed', { error: error.message });
      return { ok: false, error: error.message };
    }
  }
}

export default DanceLightingController;
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/adapters/fitness/DanceLightingController.test.mjs`
Expected: PASS — `Tests 6 passed`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/fitness/DanceLightingController.mjs tests/unit/adapters/fitness/DanceLightingController.test.mjs
git commit -m "feat(fitness): DanceLightingController (colorloop + throttled strobe accents)"
```

---

## Task 3: Dance API endpoints in the fitness router

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs` (factory `createFitnessRouter` at `:73`; mirror the `/zone_led` block at `:868-917`)
- Create: `backend/src/4_api/v1/routers/fitness.dance.test.mjs`

- [ ] **Step 1: Write the failing router test**

Create `backend/src/4_api/v1/routers/fitness.dance.test.mjs`:

```javascript
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFitnessRouter } from './fitness.mjs';

const silentLogger = { info(){}, warn(){}, error(){}, debug(){} };

function appWith(danceLightingController) {
  const app = express();
  app.use(express.json());
  app.use('/', createFitnessRouter({ danceLightingController, logger: silentLogger }));
  return app;
}

describe('fitness router — dance endpoints', () => {
  it('POST /dance/start delegates to the controller', async () => {
    const ctrl = { start: vi.fn().mockResolvedValue({ ok: true, started: true }), accent: vi.fn(), stop: vi.fn() };
    const res = await request(appWith(ctrl)).post('/dance/start').send({});
    expect(res.status).toBe(200);
    expect(ctrl.start).toHaveBeenCalled();
    expect(res.body).toMatchObject({ ok: true });
  });

  it('POST /dance/accent and /dance/stop delegate', async () => {
    const ctrl = { start: vi.fn(), accent: vi.fn().mockResolvedValue({ ok: true }), stop: vi.fn().mockResolvedValue({ ok: true }) };
    await request(appWith(ctrl)).post('/dance/accent').send({});
    await request(appWith(ctrl)).post('/dance/stop').send({});
    expect(ctrl.accent).toHaveBeenCalled();
    expect(ctrl.stop).toHaveBeenCalled();
  });

  it('returns a graceful skip when no controller is wired', async () => {
    const res = await request(appWith(undefined)).post('/dance/start').send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, skipped: true });
  });
});
```

> NOTE: confirm `supertest` is available (`ls node_modules/supertest`). If it is not, write the test against the handler using a minimal `req`/`res` stub object instead (call the registered handler directly), asserting the same controller delegation. Do not add a new dependency.

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/fitness.dance.test.mjs`
Expected: FAIL — `/dance/start` returns 404 (route not defined).

- [ ] **Step 3: Wire the controller param and add the routes**

In `createFitnessRouter`'s destructure (the `const { ... } = config;` block right after `:73`), add:

```javascript
    danceLightingController,
```

Add a JSDoc line near the other `@param` entries (~`:57`):

```javascript
   * @param {Object} [config.danceLightingController] - DanceLightingController instance
```

Add the routes next to the `/zone_led` block (after the handler ending near `:920`). Use a shared helper so the three endpoints stay DRY:

```javascript
  /**
   * Dance Party lighting — POST /dance/{start,accent,stop}
   * Gracefully no-ops when no controller is wired (HA disabled / not configured).
   */
  const danceAction = (action) => async (req, res) => {
    try {
      if (!danceLightingController || typeof danceLightingController[action] !== 'function') {
        return res.json({ ok: true, skipped: true, reason: 'dance_lighting_unavailable' });
      }
      const householdId = req.query.householdId || req.body?.householdId;
      const result = await danceLightingController[action](householdId);
      return res.json(result);
    } catch (error) {
      logger.error?.('fitness.dance.error', { action, error: error.message });
      return res.status(500).json({ ok: false, error: error.message });
    }
  };
  router.post('/dance/start', danceAction('start'));
  router.post('/dance/accent', danceAction('accent'));
  router.post('/dance/stop', danceAction('stop'));
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/fitness.dance.test.mjs`
Expected: PASS — `Tests 3 passed`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/fitness.mjs backend/src/4_api/v1/routers/fitness.dance.test.mjs
git commit -m "feat(fitness): POST /dance/{start,accent,stop} endpoints"
```

---

## Task 4: Wire the controller in the composition root

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs` (instantiation near `:904`, return object near `:940`, router call near `:1051`)

This task has no unit test of its own (it is composition wiring); it is verified by the existing build/boot and the router test from Task 3. Keep the change minimal and mirror `ambientLedController`.

- [ ] **Step 1: Add the import**

Near the other fitness adapter imports at the top of `bootstrap.mjs` (where `AmbientLedAdapter` is imported), add:

```javascript
import { DanceLightingController } from '#adapters/fitness/DanceLightingController.mjs';
```

- [ ] **Step 2: Instantiate it (guarded by haGateway), right after the `ambientLedController` block (~`:914`)**

```javascript
  // Dance Party lighting controller (reuses the same HA gateway)
  let danceLightingController = null;
  if (haGateway) {
    danceLightingController = new DanceLightingController({
      gateway: haGateway,
      loadFitnessConfig,
      logger
    });
  }
```

- [ ] **Step 3: Expose it on the returned services object (near `:940`, beside `ambientLedController`)**

```javascript
    ambientLedController,
    danceLightingController,
    equipmentFanController,
```

- [ ] **Step 4: Inject into `createFitnessRouter` (near `:1051`, beside `zoneLedController`)**

```javascript
    zoneLedController: fitnessServices.ambientLedController,
    danceLightingController: fitnessServices.danceLightingController,
    equipmentFanController: fitnessServices.equipmentFanController,
```

- [ ] **Step 5: Verify the backend boots / module graph resolves**

Run: `node --check backend/src/0_system/bootstrap.mjs && node --check backend/src/1_adapters/fitness/DanceLightingController.mjs`
Expected: no output (syntax OK). Then re-run the Task 3 router test to confirm nothing broke:
`./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/fitness.dance.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "feat(fitness): wire DanceLightingController into composition root"
```

---

## Task 5: Frontend — playlist resolver (pure, with fallbacks)

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/DancePartyWidget/resolveDancePlaylists.js`
- Create: `frontend/src/modules/Fitness/widgets/DancePartyWidget/resolveDancePlaylists.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { resolveDancePlaylists } from './resolveDancePlaylists.js';

describe('resolveDancePlaylists', () => {
  it('uses configured audio + video ids', () => {
    const r = resolveDancePlaylists({ dance_party: { audio_playlist_id: 463801, video_playlist_id: 99, shuffle: true } }, []);
    expect(r).toEqual({ audioPlaylistId: 463801, videoPlaylistId: 99, shuffle: true, hasVideo: true });
  });

  it('falls back to the first music_playlists entry when no audio id', () => {
    const r = resolveDancePlaylists({ dance_party: {} }, [{ name: 'EDM', id: 463801 }, { name: 'X', id: 1 }]);
    expect(r.audioPlaylistId).toBe(463801);
  });

  it('no video id → hasVideo false (CSS backdrop fallback)', () => {
    const r = resolveDancePlaylists({ dance_party: { audio_playlist_id: 1 } }, []);
    expect(r.hasVideo).toBe(false);
    expect(r.videoPlaylistId).toBeNull();
  });

  it('defaults shuffle to true', () => {
    expect(resolveDancePlaylists({ dance_party: { audio_playlist_id: 1 } }, []).shuffle).toBe(true);
    expect(resolveDancePlaylists({ dance_party: { audio_playlist_id: 1, shuffle: false } }, []).shuffle).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/DancePartyWidget/resolveDancePlaylists.test.js`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Implement the resolver**

```javascript
/**
 * Resolve the dance_party audio/video playlists with fallbacks.
 * - audio: configured id, else first music_playlists entry, else null.
 * - video: configured id, else null (caller renders a CSS disco backdrop).
 * @param {object} fitnessConfig
 * @param {Array<{name:string,id:number}>} musicPlaylists
 */
export function resolveDancePlaylists(fitnessConfig, musicPlaylists = []) {
  const dp = fitnessConfig?.dance_party || {};
  const audioPlaylistId = dp.audio_playlist_id
    ?? (Array.isArray(musicPlaylists) && musicPlaylists[0]?.id) ?? null;
  const rawVideo = dp.video_playlist_id;
  const videoPlaylistId = Number.isFinite(rawVideo) && rawVideo > 0 ? rawVideo : null;
  return {
    audioPlaylistId,
    videoPlaylistId,
    shuffle: dp.shuffle !== false,
    hasVideo: videoPlaylistId != null
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/DancePartyWidget/resolveDancePlaylists.test.js`
Expected: PASS — `Tests 4 passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/DancePartyWidget/resolveDancePlaylists.js frontend/src/modules/Fitness/widgets/DancePartyWidget/resolveDancePlaylists.test.js
git commit -m "feat(fitness): dance playlist resolver with fallbacks"
```

---

## Task 6: Frontend — `useDanceLighting` hook

Posts `start` on mount, `stop` on unmount, and exposes `accent()`.

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/DancePartyWidget/useDanceLighting.js`
- Create: `frontend/src/modules/Fitness/widgets/DancePartyWidget/useDanceLighting.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const post = vi.fn().mockResolvedValue({ ok: true });
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: (...args) => post(...args) }));

import { useDanceLighting } from './useDanceLighting.js';

describe('useDanceLighting', () => {
  beforeEach(() => post.mockClear());

  it('posts start on mount and stop on unmount', () => {
    const { unmount } = renderHook(() => useDanceLighting({ enabled: true }));
    expect(post).toHaveBeenCalledWith('api/v1/fitness/dance/start', {}, 'POST');
    post.mockClear();
    unmount();
    expect(post).toHaveBeenCalledWith('api/v1/fitness/dance/stop', {}, 'POST');
  });

  it('accent() posts an accent', () => {
    const { result } = renderHook(() => useDanceLighting({ enabled: true }));
    post.mockClear();
    act(() => result.current.accent());
    expect(post).toHaveBeenCalledWith('api/v1/fitness/dance/accent', {}, 'POST');
  });

  it('does nothing when disabled', () => {
    const { result, unmount } = renderHook(() => useDanceLighting({ enabled: false }));
    act(() => result.current.accent());
    unmount();
    expect(post).not.toHaveBeenCalled();
  });
});
```

> NOTE: confirm the `DaylightAPI` POST signature in `frontend/src/lib/api.mjs` before implementing — read it and match the real argument order. The test above assumes `DaylightAPI(path, body, method)`. If the real signature differs (e.g. an options object), update BOTH the test and the implementation to match it. Do not invent a signature.

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/DancePartyWidget/useDanceLighting.test.js`
Expected: FAIL — cannot resolve the hook module.

- [ ] **Step 3: Implement the hook**

```javascript
import { useEffect, useCallback } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'dance-lighting' });
  return _logger;
}

const post = (action) =>
  DaylightAPI(`api/v1/fitness/dance/${action}`, {}, 'POST')
    .catch((err) => logger().warn('fitness.dance.lighting.post_failed', { action, message: err?.message ?? null }));

/**
 * Drives the backend dance lighting: start on mount, stop on unmount (so any
 * exit path restores the lights), and accent() on demand (e.g. track change).
 */
export function useDanceLighting({ enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return undefined;
    logger().info('fitness.dance.lighting.start_request', {});
    post('start');
    return () => { logger().info('fitness.dance.lighting.stop_request', {}); post('stop'); };
  }, [enabled]);

  const accent = useCallback(() => { if (enabled) post('accent'); }, [enabled]);
  return { accent };
}

export default useDanceLighting;
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/DancePartyWidget/useDanceLighting.test.js`
Expected: PASS — `Tests 3 passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/DancePartyWidget/useDanceLighting.js frontend/src/modules/Fitness/widgets/DancePartyWidget/useDanceLighting.test.js
git commit -m "feat(fitness): useDanceLighting hook (start/stop/accent lifecycle)"
```

---

## Task 7: Frontend — `DanceNowPlayingBar`

The persistent bottom bar (album art + title/artist + transport), a **Next** button, and the **exit ✕** (top-right of the screen).

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/DancePartyWidget/DanceNowPlayingBar.jsx`
- Create: `frontend/src/modules/Fitness/widgets/DancePartyWidget/DanceNowPlayingBar.test.jsx`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DanceNowPlayingBar from './DanceNowPlayingBar.jsx';

describe('DanceNowPlayingBar', () => {
  const track = { title: 'Get Lucky', artist: 'Daft Punk', coverUrl: '/cover.jpg' };

  it('shows the current track title and artist', () => {
    render(<DanceNowPlayingBar track={track} isPlaying onPlayPause={()=>{}} onNext={()=>{}} onExit={()=>{}} />);
    expect(screen.getByText('Get Lucky')).toBeInTheDocument();
    expect(screen.getByText('Daft Punk')).toBeInTheDocument();
  });

  it('fires onNext and onExit', () => {
    const onNext = vi.fn(); const onExit = vi.fn();
    render(<DanceNowPlayingBar track={track} isPlaying onPlayPause={()=>{}} onNext={onNext} onExit={onExit} />);
    fireEvent.click(screen.getByLabelText('Next'));
    fireEvent.click(screen.getByLabelText('Exit dance party'));
    expect(onNext).toHaveBeenCalled();
    expect(onExit).toHaveBeenCalled();
  });

  it('renders a placeholder when there is no track', () => {
    render(<DanceNowPlayingBar track={null} isPlaying={false} onPlayPause={()=>{}} onNext={()=>{}} onExit={()=>{}} />);
    expect(screen.getByText(/no track|—/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/DancePartyWidget/DanceNowPlayingBar.test.jsx`
Expected: FAIL — cannot resolve the component.

- [ ] **Step 3: Implement the bar**

```jsx
import PropTypes from 'prop-types';
import './DancePartyWidget.scss';

export default function DanceNowPlayingBar({ track, isPlaying, onPlayPause, onNext, onExit }) {
  return (
    <>
      <button type="button" className="dance-exit" aria-label="Exit dance party" onClick={onExit}>✕</button>
      <div className="dance-nowplaying">
        <div className="dance-cover">
          {track?.coverUrl ? <img src={track.coverUrl} alt="" /> : <span className="dance-cover__ph">♪</span>}
        </div>
        <div className="dance-meta">
          <div className="dance-title">{track?.title || '— No Track —'}</div>
          <div className="dance-artist">{track?.artist || ''}</div>
        </div>
        <div className="dance-controls">
          <button type="button" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={onPlayPause}>{isPlaying ? '⏸' : '▶'}</button>
          <button type="button" aria-label="Next" onClick={onNext}>⏭</button>
        </div>
      </div>
    </>
  );
}

DanceNowPlayingBar.propTypes = {
  track: PropTypes.shape({ title: PropTypes.string, artist: PropTypes.string, coverUrl: PropTypes.string }),
  isPlaying: PropTypes.bool,
  onPlayPause: PropTypes.func.isRequired,
  onNext: PropTypes.func.isRequired,
  onExit: PropTypes.func.isRequired
};
```

Create `DancePartyWidget.scss` with at least these classes (extend with disco-fallback styles in Task 8):

```scss
.dance-exit { position: absolute; top: 14px; right: 16px; z-index: 5; width: 40px; height: 40px;
  border-radius: 50%; border: none; background: rgba(0,0,0,.5); color: #fff; font-size: 18px; cursor: pointer; }
.dance-nowplaying { position: absolute; left: 0; right: 0; bottom: 0; z-index: 5;
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  background: linear-gradient(0deg, rgba(0,0,0,.78), transparent); color: #fff; }
.dance-cover { width: 44px; height: 44px; border-radius: 6px; overflow: hidden; flex: 0 0 auto;
  background: linear-gradient(135deg,#ff8a00,#ff2d95); display: flex; align-items: center; justify-content: center; }
.dance-cover img { width: 100%; height: 100%; object-fit: cover; }
.dance-meta { flex: 1; min-width: 0; }
.dance-title { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dance-artist { font-size: 12px; opacity: .8; }
.dance-controls { display: flex; gap: 14px; }
.dance-controls button { background: none; border: none; color: #fff; font-size: 22px; cursor: pointer; }
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/DancePartyWidget/DanceNowPlayingBar.test.jsx`
Expected: PASS — `Tests 3 passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/DancePartyWidget/DanceNowPlayingBar.jsx \
        frontend/src/modules/Fitness/widgets/DancePartyWidget/DanceNowPlayingBar.test.jsx \
        frontend/src/modules/Fitness/widgets/DancePartyWidget/DancePartyWidget.scss
git commit -m "feat(fitness): DanceNowPlayingBar (track + transport + Next + exit)"
```

---

## Task 8: Frontend — `DancePartyWidget` orchestrator + registration

Composes the video layer, the audio layer, the now-playing bar, and the lighting hook. This is the integration task: the two `<Player>` instances mirror existing call sites (no new player API).

**Read first (do not guess the Player API):**
- `frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx` — the memoized `playerQueueProp` (`{ contentId: 'plex:<id>', shuffle: true, ... }`) and the `<Player queue={playerQueueProp} playerRef={audioPlayerRef} ... />` render (~lines 233–245 and ~725–745), plus how it derives the current track from the player's media-change callback. **Mirror this for the audio layer.**
- The video play-queue render in `frontend/src/Apps/FitnessApp.jsx` (the `<Player>`/queue block around the `fitnessPlayQueue` usage) — **mirror this for the video layer**, adding muted + loop-the-playlist behavior.

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/DancePartyWidget/DancePartyWidget.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/DancePartyWidget/DancePartyWidget.scss` (add disco fallback + layout)
- Create: `frontend/src/modules/Fitness/widgets/DancePartyWidget/manifest.js`
- Create: `frontend/src/modules/Fitness/widgets/DancePartyWidget/index.jsx`
- Modify: `frontend/src/modules/Fitness/index.js` (register the widget)

- [ ] **Step 1: Create the manifest**

`manifest.js`:

```javascript
export default {
  id: 'dance_party',
  name: 'Dance Party',
  version: '1.0.0',
  icon: '🪩',
  description: 'Fullscreen disco video + music playlist with dancing ambient lights',
  modes: { standalone: true, overlay: false, sidebar: false, mini: false },
  requires: { sessionActive: false },
  category: 'games'
};
```

- [ ] **Step 2: Create the index**

`index.jsx`:

```javascript
export { default } from './DancePartyWidget.jsx';
export { default as manifest } from './manifest.js';
```

- [ ] **Step 3: Create the orchestrator**

`DancePartyWidget.jsx`. The component receives `{ onClose, config }` (the widget launch contract — see `JumpingJackGame.jsx`). It:
1. resolves playlists via `resolveDancePlaylists(config, config?.plex?.music_playlists || musicPlaylistsFromContext)`,
2. starts the lighting via `useDanceLighting({ enabled: true })`,
3. renders the fullscreen video `<Player>` (muted, shuffled, loops the playlist) OR the CSS disco backdrop when `!hasVideo`,
4. renders the audio `<Player>` (shuffled) and tracks the current track + play state,
5. on each audio track change calls `accent()` and updates the now-playing bar,
6. renders `<DanceNowPlayingBar onExit={onClose} onNext={…} onPlayPause={…} />`.

```jsx
import { useMemo, useState, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import Player from '@/modules/Player/Player.jsx';
import { useFitnessContext } from '@/context/FitnessContext.jsx';
import { resolveDancePlaylists } from './resolveDancePlaylists.js';
import { useDanceLighting } from './useDanceLighting.js';
import DanceNowPlayingBar from './DanceNowPlayingBar.jsx';
import getLogger from '@/lib/logging/Logger.js';
import './DancePartyWidget.scss';

export default function DancePartyWidget({ onClose, config }) {
  const logger = useMemo(() => getLogger().child({ component: 'dance-party' }), []);
  const fitnessContext = useFitnessContext();
  const musicPlaylists = config?.plex?.music_playlists || fitnessContext?.plexConfig?.music_playlists || [];
  const { audioPlaylistId, videoPlaylistId, shuffle, hasVideo } =
    useMemo(() => resolveDancePlaylists(config, musicPlaylists), [config, musicPlaylists]);

  const { accent } = useDanceLighting({ enabled: true });

  const audioRef = useRef(null);
  const [track, setTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(true);

  // Mirror FitnessMusicPlayer: the queue prop is a memoized object so the inner
  // Player's queue controller does not re-init every render.
  const audioQueue = useMemo(
    () => (audioPlaylistId ? { contentId: `plex:${audioPlaylistId}`, shuffle } : null),
    [audioPlaylistId, shuffle]
  );
  const videoQueue = useMemo(
    () => (videoPlaylistId ? { contentId: `plex:${videoPlaylistId}`, shuffle, loop: true } : null),
    [videoPlaylistId, shuffle]
  );

  // Fire a lighting accent + update the bar when the audio track changes.
  const handleAudioMedia = useCallback((media) => {
    const next = media ? {
      title: media.title || media.parentTitle || null,
      artist: media.grandparentTitle || media.artist || null,
      coverUrl: media.thumbUrl || media.image || null
    } : null;
    setTrack(next);
    accent();
    logger.info('fitness.dance.track_change', { title: next?.title || null });
  }, [accent, logger]);

  const togglePlay = useCallback(() => {
    const api = audioRef.current;
    if (!api) return;
    const media = api.getMediaElement?.();
    if (media) { media.paused ? api.play?.() : api.pause?.(); setIsPlaying(media.paused); }
  }, []);
  const next = useCallback(() => { audioRef.current?.next?.(); }, []);

  return (
    <div className="dance-party">
      <div className="dance-video">
        {hasVideo && videoQueue ? (
          <Player queue={videoQueue} muted playerRef={null} />
        ) : (
          <div className="dance-backdrop" aria-hidden="true" />
        )}
      </div>

      {audioQueue && (
        <div className="dance-audio-host">
          <Player queue={audioQueue} playerRef={audioRef} onMediaChange={handleAudioMedia} />
        </div>
      )}

      <DanceNowPlayingBar
        track={track}
        isPlaying={isPlaying}
        onPlayPause={togglePlay}
        onNext={next}
        onExit={onClose}
      />
    </div>
  );
}

DancePartyWidget.propTypes = {
  onClose: PropTypes.func,
  config: PropTypes.object
};
```

> IMPORTANT — verify the `<Player>` prop names against the two read-first call sites before finalizing: the exact `queue` shape, the ref prop name (`playerRef`), the media-change callback name (it may be `onMediaChange`, `onTrackChange`, or similar in `FitnessMusicPlayer.jsx`), and how to mute the video + loop the playlist. Match the real props exactly; adjust this code to whatever the working call sites use. The audio `<Player>` must render with **no visible video surface** (audio-only) — mirror how `FitnessMusicPlayer` hides/sizes it (`dance-audio-host` is styled `display:none`-friendly below).

- [ ] **Step 4: Add the remaining SCSS (append to `DancePartyWidget.scss`)**

```scss
.dance-party { position: absolute; inset: 0; background: #000; overflow: hidden; }
.dance-video, .dance-video :is(video, .dash-video, .player) { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.dance-audio-host { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
@keyframes danceHue { from { filter: hue-rotate(0deg); } to { filter: hue-rotate(360deg); } }
.dance-backdrop { position: absolute; inset: 0;
  background: radial-gradient(circle at 50% 35%, #ff2d95 0%, #7a1fff 38%, #0a0a2a 78%);
  animation: danceHue 8s linear infinite; }
```

> If the audio `<Player>` still paints a visible surface despite `.dance-audio-host`, follow whatever technique `FitnessMusicPlayer`/`FitnessSidebar.scss` uses to keep the audio player invisible.

- [ ] **Step 5: Register the widget**

In `frontend/src/modules/Fitness/index.js`:
- Add the import beside the other widget namespace imports (~`:13`):

```javascript
import * as DancePartyWidget from './widgets/DancePartyWidget/index.jsx';
```

- Add to `REGISTRY_KEYS` (~`:26`):

```javascript
  'fitness:dance-party': DancePartyWidget,
```

- Add to `LEGACY_ID_MAP`:

```javascript
  'dance_party': 'fitness:dance-party',
```

- [ ] **Step 6: Build + manual verification**

Run the build to confirm the JSX/SCSS/registration compile:
`cd /opt/Code/DaylightStation/frontend && npx vite build --mode development 2>&1 | tail -8`
Expected: build completes; no errors referencing `DancePartyWidget` or `Fitness/index.js`.

Manual (deferred to deploy — cannot drive the garage display here): launch `fitness:dance-party` from the menu and confirm fullscreen muted looping disco video (or the animated backdrop with no video configured), music playing/shuffling with the now-playing bar updating, the white lights dropping + strips running colorloop with strobe accents on track change, and that the exit ✕ restores the lights.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/DancePartyWidget/ frontend/src/modules/Fitness/index.js
git commit -m "feat(fitness): DancePartyWidget fullscreen party mode (video + music + dancing lights)"
```

---

## Task 9: Config — `dance_party:` in fitness.yml

**Files:**
- Modify (in the Docker container): `data/household/config/fitness.yml`

- [ ] **Step 1: Read the current top of fitness.yml to choose an insertion point**

```bash
sudo docker exec daylight-station sh -c "grep -nE '^[a-z_]+:' data/household/config/fitness.yml | head"
```
Expected: top-level keys (`screens`, `plex`, `ambient_led`, `governance`, `selectors`, `cycle_game`, …).

- [ ] **Step 2: Append the `dance_party:` block (write the complete file back — never `sed -i`; see CLAUDE.local.md)**

Add this top-level block (use your real disco-video Plex playlist id for `video_playlist_id`; `0` keeps the CSS backdrop fallback until you create it):

```yaml
dance_party:
  enabled: true
  audio_playlist_id: 463801          # EDM Classical (an existing music playlist)
  video_playlist_id: 0               # set to your disco-visual Plex playlist id; 0 = CSS backdrop
  shuffle: true
  lighting:
    color_strips:
      - light.garage_ceiling_led_strip
      - light.garage_front_led_strip
      - light.garage_north_night_light
      - light.garage_south_night_light
    white_lights:
      - light.garage_light_switch
    base_effect: colorloop
    accent: { mode: flash, on_track_change: true, interval_ms: 20000, min_interval_ms: 4000 }
```

Validate it parses (reuse the in-container js-yaml approach with `NODE_PATH=/usr/src/app/node_modules node`): load the file and confirm `doc.dance_party.lighting.color_strips.length === 4` before considering it done.

- [ ] **Step 3: Verify the widget sees it**

After a frontend reload, confirm no parse errors in `sudo docker logs daylight-station` and that launching Dance Party drives the lights. (Config files live in the data volume and are not git-tracked — note the change in your deploy log.)

---

## Final Verification

- [ ] Run every new unit suite together:

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  tests/unit/adapters/fitness/danceLightingConfig.test.mjs \
  tests/unit/adapters/fitness/DanceLightingController.test.mjs \
  backend/src/4_api/v1/routers/fitness.dance.test.mjs \
  frontend/src/modules/Fitness/widgets/DancePartyWidget/resolveDancePlaylists.test.js \
  frontend/src/modules/Fitness/widgets/DancePartyWidget/useDanceLighting.test.js \
  frontend/src/modules/Fitness/widgets/DancePartyWidget/DanceNowPlayingBar.test.jsx
```
Expected: all files pass, 0 failed.

- [ ] Full frontend build clean: `cd frontend && npx vite build --mode development` (no DancePartyWidget errors).
- [ ] Deploy, set the real `video_playlist_id`, and verify on the garage display: fullscreen disco video + shuffled music + dancing Hue lights (white off, colorloop, strobe accents on track change) + exit ✕ restores the lights.
