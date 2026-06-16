# Triggered ArtMode Scene (via `display`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trigger an ArtMode preset (with music) onto the living-room screen via `GET /device/:id/load?display=art:<preset>`, engaging the screensaver scene — distinct from the silent passive screensaver.

**Architecture:** A backend endpoint resolves `art:<preset>` → ArtMode props (reusing the sub-project-2 preset resolver). The frontend `ScreenScreensaver` subscribes to the (currently-unhandled) `display:content` action; for an `art:<preset>` id it fetches the props and engages the screensaver scene as a `priority:'high'` fullscreen overlay (one-shot — idle afterward resumes the default `gallery-silent`). The device load API needs no change — `display=` already forwards to the screen URL.

**Tech Stack:** Node ESM (`.mjs`), Express, js-yaml, React, Vitest.

**Test runner:** `./node_modules/.bin/vitest run --config vitest.config.mjs <file>`.

---

## File Structure

- `backend/src/4_api/v1/routers/art.mjs` (modify) — add `GET /preset/:key`.
- `backend/src/app.mjs` (modify) — pass `dataPath: dataBasePath` to `createArtRouter`.
- `frontend/src/screen-framework/ScreenScreensaver.jsx` (modify) — `display:content` art-scene handler + `showScene` engagement.
- Tests: `tests/unit/art/artPreset.test.mjs`, `frontend/src/screen-framework/ScreenScreensaver.scene.test.jsx`.

---

### Task 1: Backend — `GET /api/v1/art/preset/:key`

**Files:**
- Modify: `backend/src/4_api/v1/routers/art.mjs`
- Modify: `backend/src/app.mjs`
- Test: `tests/unit/art/artPreset.test.mjs`

- [ ] **Step 1: Write the failing test** — create `tests/unit/art/artPreset.test.mjs`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createArtRouter } from '../../../backend/src/4_api/v1/routers/art.mjs';

let dataPath;
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const artAdapter = { selectFeatured: async () => ({ mode: 'single', panels: [], matte: {} }) };

function presetHandler(router) {
  const layer = router.stack.find((l) => l.route?.path === '/preset/:key' && l.route.methods.get);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
const res = () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const call = async (key) => {
  const r = res();
  await presetHandler(createArtRouter({ artAdapter, dataPath, logger }))({ params: { key } }, r, (e) => { if (e) throw e; });
  return r;
};

beforeEach(async () => {
  dataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'artpreset-'));
  await fs.mkdir(path.join(dataPath, 'household', 'config'), { recursive: true });
  await fs.writeFile(path.join(dataPath, 'household', 'config', 'artmode.yml'),
    'presets:\n  classical-evening:\n    collection: all\n    music: { queue: "plex:1" }\n    matMargin: 4\n');
});
afterEach(async () => { await fs.rm(dataPath, { recursive: true, force: true }); });

describe('art router /preset/:key', () => {
  it('returns resolved props for a known preset', async () => {
    const r = await call('classical-evening');
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ collection: 'all', music: { queue: 'plex:1' }, matMargin: 4 });
  });
  it('404 for an unknown preset', async () => {
    const r = await call('nope');
    expect(r.statusCode).toBe(404);
  });
  it('404 when artmode.yml is absent', async () => {
    await fs.rm(path.join(dataPath, 'household', 'config', 'artmode.yml'));
    const r = await call('classical-evening');
    expect(r.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run to confirm FAIL** — `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/artPreset.test.mjs` (no `/preset/:key` route → `presetHandler` finds nothing → throws).

- [ ] **Step 3: Modify `backend/src/4_api/v1/routers/art.mjs`.**

(a) Replace the import block at the top:
```js
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
```
with:
```js
import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { resolvePreset } from '../../../1_adapters/content/art/presetResolver.mjs';
```

(b) Change the factory destructure:
```js
  const { artAdapter, logger = console } = config;
```
to:
```js
  const { artAdapter, dataPath, logger = console } = config;
```

(c) Add the route immediately AFTER the existing `router.get('/featured', ...)` block and BEFORE `return router;`:
```js
  /**
   * GET /preset/:key
   * Resolves a named ArtMode preset (artmode.yml) into props. 404 if unknown.
   */
  router.get(
    '/preset/:key',
    asyncHandler(async (req, res) => {
      const { key } = req.params;
      let presets = {};
      try {
        const raw = await fs.readFile(
          path.join(dataPath, 'household', 'config', 'artmode.yml'), 'utf-8');
        presets = (yaml.load(raw) || {}).presets || {};
      } catch (err) {
        if (err.code !== 'ENOENT') logger.warn?.('art.presets.read_failed', { error: err.message });
      }
      if (!Object.prototype.hasOwnProperty.call(presets, key)) {
        logger.debug?.('art.preset.unknown', { key });
        return res.status(404).json({ error: 'Unknown preset', key });
      }
      res.json(resolvePreset(presets, key));
    })
  );
```

- [ ] **Step 4: Run to confirm PASS** — `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/artPreset.test.mjs` → all green.

- [ ] **Step 5: Wire `dataPath` in `backend/src/app.mjs`.** Find the `v1Routers.art = createArtRouter({ ... })` call (search `createArtRouter`). Add `dataPath: dataBasePath,` to the options object (sibling of `artAdapter` and `logger`):
```js
  v1Routers.art = createArtRouter({
    artAdapter: createArtAdapter({
      imgBasePath,
      collections: artConfig.collections || {},
      immichSource: artImmichSource,
      logger: rootLogger.child({ module: 'art-adapter' })
    }),
    dataPath: dataBasePath,
    logger: rootLogger.child({ module: 'art-api' })
  });
```
(`dataBasePath` is the same value passed to `createScreensRouter`. Confirm it's in scope here.)

- [ ] **Step 6: Sanity-check app.mjs parses** — `node --check backend/src/app.mjs && echo "parse OK"`.

- [ ] **Step 7: Commit**
```bash
git add backend/src/4_api/v1/routers/art.mjs backend/src/app.mjs tests/unit/art/artPreset.test.mjs
git commit -m "feat(artmode): GET /art/preset/:key resolves a preset into props"
```

---

### Task 2: Frontend — `ScreenScreensaver` engages an `art:` scene

**Files:**
- Modify: `frontend/src/screen-framework/ScreenScreensaver.jsx`
- Test: `frontend/src/screen-framework/ScreenScreensaver.scene.test.jsx`

The screensaver controller subscribes to `display:content`; for an `art:<preset>` id it fetches the preset props and engages the scene as a `priority:'high'` fullscreen overlay (replacing whatever's showing). One-shot: the widget's `onExit` closes it and the idle timer resumes the default.

- [ ] **Step 1: Write the failing test** — create `frontend/src/screen-framework/ScreenScreensaver.scene.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { getActionBus } from './input/ActionBus.js';
import { ScreenScreensaver } from './ScreenScreensaver.jsx';

const showOverlay = vi.fn();
vi.mock('./overlays/ScreenOverlayProvider.jsx', () => ({
  useScreenOverlay: () => ({ showOverlay, dismissOverlay: () => {}, hasOverlay: false }),
}));
vi.mock('../context/MenuNavigationContext.jsx', () => ({
  useMenuNavigationContext: () => ({ reset: () => {} }),
}));
const Stub = () => null;
vi.mock('./widgets/registry.js', () => ({
  getWidgetRegistry: () => ({ get: () => Stub }),
}));
import { DaylightAPI } from '../lib/api.mjs';
vi.mock('../lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

const cfg = { widget: 'art', idle: 0, showOnLoad: false, interactive: true };

describe('ScreenScreensaver scene trigger', () => {
  beforeEach(() => { showOverlay.mockReset(); DaylightAPI.mockReset(); });

  it('engages the ArtMode scene from a display:content art: event', async () => {
    DaylightAPI.mockResolvedValue({ collection: 'all', music: { queue: 'plex:1' } });
    render(<ScreenScreensaver config={cfg} />);
    act(() => { getActionBus().emit('display:content', { id: 'art:classical-evening' }); });
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledWith('api/v1/art/preset/classical-evening'));
    await waitFor(() => expect(showOverlay).toHaveBeenCalled());
    const lastCall = showOverlay.mock.calls[showOverlay.mock.calls.length - 1];
    const [, props, opts] = lastCall;
    expect(props.collection).toBe('all');
    expect(props.music).toEqual({ queue: 'plex:1' });
    expect(typeof props.onExit).toBe('function');
    expect(opts).toMatchObject({ mode: 'fullscreen', priority: 'high' });
  });

  it('ignores non-art display:content ids', async () => {
    render(<ScreenScreensaver config={cfg} />);
    act(() => { getActionBus().emit('display:content', { id: 'immich:abc' }); });
    await Promise.resolve();
    expect(DaylightAPI).not.toHaveBeenCalled();
  });

  it('does not engage when the preset fetch fails (404)', async () => {
    DaylightAPI.mockRejectedValue(new Error('HTTP 404'));
    render(<ScreenScreensaver config={cfg} />);
    act(() => { getActionBus().emit('display:content', { id: 'art:nope' }); });
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalled());
    expect(showOverlay).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm FAIL** — `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/ScreenScreensaver.scene.test.jsx` (no scene handler yet → showOverlay never called for the scene).

- [ ] **Step 3: Edit `frontend/src/screen-framework/ScreenScreensaver.jsx`.**

(a) Replace the import block at the top:
```jsx
import { useEffect, useRef } from 'react';
import { useScreenOverlay } from './overlays/ScreenOverlayProvider.jsx';
import { getWidgetRegistry } from './widgets/registry.js';
import { useMenuNavigationContext } from '../context/MenuNavigationContext.jsx';
import getLogger from '../lib/logging/Logger.js';
```
with:
```jsx
import { useCallback, useEffect, useRef } from 'react';
import { useScreenOverlay } from './overlays/ScreenOverlayProvider.jsx';
import { getWidgetRegistry } from './widgets/registry.js';
import { useMenuNavigationContext } from '../context/MenuNavigationContext.jsx';
import { useScreenAction } from './input/useScreenAction.js';
import { DaylightAPI } from '../lib/api.mjs';
import getLogger from '../lib/logging/Logger.js';
```

(b) Add the scene-trigger subscription. Immediately AFTER this existing block:
```jsx
  // Read latest hasOverlay without re-running the effect.
  const hasOverlayRef = useRef(hasOverlay);
  hasOverlayRef.current = hasOverlay;
```
insert:
```jsx
  // Imperative scene engagement: a `display:content` art:<preset> dispatch fetches
  // the preset props and shows the ArtMode scene over the default (one-shot).
  const sceneRef = useRef(null);
  const onSceneContent = useCallback((payload) => {
    const id = payload?.id;
    if (!id || !String(id).startsWith('art:')) return;
    const preset = String(id).slice(4);
    DaylightAPI(`api/v1/art/preset/${encodeURIComponent(preset)}`)
      .then((props) => { if (props && sceneRef.current) sceneRef.current(props); })
      .catch((err) => logger().warn('artmode.scene.unknown', { preset, error: err?.message }));
  }, []);
  useScreenAction('display:content', onSceneContent);
```

(c) Inside the main `useEffect`, define `showScene` and publish it on the ref. Immediately AFTER the existing `function show() { ... }` block (the closing `}` of `show`) and BEFORE the `const onActivity = ...` line, insert:
```jsx
    // Engage immediately with override props (a dispatched scene). priority:'high'
    // replaces any current fullscreen overlay; onExit + idle resume the default.
    const showScene = (overrideProps) => {
      const Component = getWidgetRegistry().get(widgetKey);
      if (!Component) { logger().warn('screensaver.widget-not-found', { widget: widgetKey }); return; }
      reset?.();
      shown = true;
      showOverlay(Component, { ...overrideProps, onExit }, { mode: 'fullscreen', priority: 'high' });
      logger().info('screensaver.scene', { widget: widgetKey });
      if (!interactive) ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, wake, true));
    };
    sceneRef.current = showScene;
```

(d) In the effect's cleanup `return () => { ... }`, add `sceneRef.current = null;` as the first line of the cleanup:
```jsx
    return () => {
      sceneRef.current = null;
      if (timer) clearTimeout(timer);
```

- [ ] **Step 4: Run to confirm PASS** — `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/ScreenScreensaver.scene.test.jsx` → all 3 green.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/screen-framework/ScreenScreensaver.jsx frontend/src/screen-framework/ScreenScreensaver.scene.test.jsx
git commit -m "feat(artmode): ScreenScreensaver engages an art: scene from display:content"
```

---

### Task 3: Full suite + live dispatch verification

**Files:** none.

- [ ] **Step 1: Run the art + screensaver specs**
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  tests/unit/art/ tests/unit/adapters/art/ \
  frontend/src/screen-framework/ScreenScreensaver.scene.test.jsx \
  frontend/src/screen-framework/widgets/ArtMode.test.jsx
```
Expected: all green.

- [ ] **Step 2: Build + deploy** (stash unrelated WIP first, restore after — per prior plans). Then verify the preset endpoint:
```bash
curl -s "http://localhost:3111/api/v1/art/preset/classical-evening" | python3 -c "import sys,json;d=json.load(sys.stdin);print('collection:',d.get('collection'),'| music:',d.get('music'))"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3111/api/v1/art/preset/nope"   # expect 404
```
Expected: `collection: all | music: {'queue': 'plex:622894', ...}` and `404`.

- [ ] **Step 3: Live dispatch** — trigger the scene onto the living-room TV:
```bash
curl -s "http://localhost:3111/api/v1/device/livingroom-tv/load?display=art:classical-evening" | python3 -c "import sys,json;d=json.load(sys.stdin);print('ok:', d.get('ok'), '| failedStep:', d.get('failedStep'))"
```
Expected: `ok: True` (wake/load completes with only a `display=` param — no `queue` needed). After ~the wake cycle, the TV shows framed art **with** the classical music. Confirm the frontend engaged via logs:
```bash
sleep 20; sudo docker logs --since 2m daylight-station 2>&1 | grep -iE "screensaver.scene|art.preset|artmode.scene" | tail -5
```

- [ ] **Step 4: Confirm one-shot** — after dismissing (OK/Back on the remote, or it idles out), the next idle shows the **silent** `gallery-silent` screensaver (no music). This is behavioral; verify on the TV or note for the operator.

(Deploy is the operator's call; the plan ends at green tests + the dispatch verification.)

---

## Notes for the implementer
- Run specs with `./node_modules/.bin/vitest run --config vitest.config.mjs <file>` (NOT `npm test`).
- `DaylightAPI` throws on non-2xx, so the preset 404 lands in the handler's `.catch` → no scene engaged (correct).
- `showOverlay` only replaces an existing fullscreen overlay when `priority: 'high'` — that's why the scene path passes it. The passive `show()` path is unchanged.
- No device-load/backend dispatch code changes — `display=` already forwards to the screen URL via `FullyKioskContentAdapter`. Keep all existing screensaver behavior (idle/boot/interactive) intact; the scene path is additive.
