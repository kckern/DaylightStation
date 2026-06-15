# ArtMode Presets + Config Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract ArtMode config into named presets in `artmode.yml`; have the screens API expand a `screensaver.preset` reference into resolved `screensaver.props`, and have the frontend ArtMode request its configured collection.

**Architecture:** A pure `resolvePreset(presets, key, inlineProps)` merges a named preset (base) with inline overrides. The `/api/v1/screens/:id` router reads `artmode.yml` and expands `screensaver.preset` into `screensaver.props` before returning the config. The frontend `ArtMode` gains a `collection` prop it passes to `/art/featured`. The living-room screensaver migrates to the silent `gallery-silent` preset.

**Tech Stack:** Node ESM (`.mjs`), js-yaml, Vitest, React.

**Test runner:** `./node_modules/.bin/vitest run --config vitest.config.mjs <file>` (resolves backend + frontend modules).

---

## File Structure

- `backend/src/1_adapters/content/art/presetResolver.mjs` (new, pure) — `resolvePreset`.
- `backend/src/4_api/v1/routers/screens.mjs` (modify) — expand `screensaver.preset`.
- `frontend/src/screen-framework/widgets/ArtMode.jsx` (modify) — `collection` prop → API query.
- `data/household/config/artmode.yml` (new, data volume) — `gallery-silent` + `classical-evening` presets.
- `data/household/screens/living-room.yml` (modify, data volume) — reference `gallery-silent`.
- Tests: `tests/unit/art/presetResolver.test.mjs`, `tests/unit/art/screensPreset.test.mjs`, additions to `frontend/src/screen-framework/widgets/ArtMode.test.jsx`.

---

### Task 1: `presetResolver.mjs` — pure preset merge

**Files:**
- Create: `backend/src/1_adapters/content/art/presetResolver.mjs`
- Test: `tests/unit/art/presetResolver.test.mjs`

- [ ] **Step 1: Write the failing test** — create `tests/unit/art/presetResolver.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { resolvePreset } from '../../../backend/src/1_adapters/content/art/presetResolver.mjs';

const presets = {
  'gallery-silent': { collection: 'all', music: null, matMargin: 4 },
  'classical-evening': { collection: 'all', music: { queue: 'plex:1' }, matMargin: 4 },
};

describe('resolvePreset', () => {
  it('returns the named preset when no inline props', () => {
    expect(resolvePreset(presets, 'gallery-silent')).toEqual({ collection: 'all', music: null, matMargin: 4 });
  });
  it('inline props override the preset per key (shallow)', () => {
    expect(resolvePreset(presets, 'gallery-silent', { matMargin: 6 }))
      .toEqual({ collection: 'all', music: null, matMargin: 6 });
  });
  it('unknown key → inline props only', () => {
    expect(resolvePreset(presets, 'nope', { matMargin: 6 })).toEqual({ matMargin: 6 });
  });
  it('no key → inline props only', () => {
    expect(resolvePreset(presets, undefined, { matMargin: 6 })).toEqual({ matMargin: 6 });
    expect(resolvePreset(presets, null)).toEqual({});
  });
  it('does not mutate the stored preset', () => {
    resolvePreset(presets, 'gallery-silent', { matMargin: 9 });
    expect(presets['gallery-silent'].matMargin).toBe(4);
  });
});
```

- [ ] **Step 2: Run to confirm FAIL** — `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/presetResolver.test.mjs` → cannot resolve module.

- [ ] **Step 3: Create `backend/src/1_adapters/content/art/presetResolver.mjs`:**

```js
// presetResolver.mjs — pure. Resolve a screensaver preset reference into ArtMode
// props: the named preset is the base, inline props shallow-merge on top.
export function resolvePreset(presets = {}, key, inlineProps = {}) {
  if (key && Object.prototype.hasOwnProperty.call(presets, key)) {
    return { ...presets[key], ...inlineProps };
  }
  return { ...inlineProps };
}

export default resolvePreset;
```

- [ ] **Step 4: Run to confirm PASS.**

- [ ] **Step 5: Commit**
```bash
git add backend/src/1_adapters/content/art/presetResolver.mjs tests/unit/art/presetResolver.test.mjs
git commit -m "feat(artmode): pure preset resolver (preset base + inline overrides)"
```

---

### Task 2: Screens router expands `screensaver.preset`

**Files:**
- Modify: `backend/src/4_api/v1/routers/screens.mjs`
- Test: `tests/unit/art/screensPreset.test.mjs`

The router is constructed `createScreensRouter({ dataPath, logger })` and the `GET /:screenId` handler reads `dataPath/household/screens/<id>.yml`. Add preset expansion: read `dataPath/household/config/artmode.yml`, and if the screen's `screensaver.preset` is set, set `screensaver.props = resolvePreset(presets, key, existingProps)`.

- [ ] **Step 1: Write the failing test** — create `tests/unit/art/screensPreset.test.mjs`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createScreensRouter } from '../../../backend/src/4_api/v1/routers/screens.mjs';

let dataPath;
const logger = { debug() {}, info() {}, warn() {}, error() {} };

const writeScreen = (id, yamlStr) =>
  fs.writeFile(path.join(dataPath, 'household', 'screens', `${id}.yml`), yamlStr);
const writeArtmode = (yamlStr) =>
  fs.writeFile(path.join(dataPath, 'household', 'config', 'artmode.yml'), yamlStr);

function getHandler(router) {
  const layer = router.stack.find((l) => l.route?.path === '/:screenId' && l.route.methods.get);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
const res = () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const call = async (id) => {
  const r = res();
  await getHandler(createScreensRouter({ dataPath, logger }))({ params: { screenId: id } }, r, (e) => { if (e) throw e; });
  return r;
};

beforeEach(async () => {
  dataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'screens-'));
  await fs.mkdir(path.join(dataPath, 'household', 'screens'), { recursive: true });
  await fs.mkdir(path.join(dataPath, 'household', 'config'), { recursive: true });
  await writeArtmode([
    'presets:',
    '  gallery-silent:',
    '    collection: all',
    '    music: null',
    '    matMargin: 4',
  ].join('\n') + '\n');
});
afterEach(async () => { await fs.rm(dataPath, { recursive: true, force: true }); });

describe('screens router preset expansion', () => {
  it('expands a preset reference into screensaver.props', async () => {
    await writeScreen('room', 'screen: room\nscreensaver:\n  widget: art\n  preset: gallery-silent\n');
    const r = await call('room');
    expect(r.body.screensaver.props).toEqual({ collection: 'all', music: null, matMargin: 4 });
  });

  it('inline props override the preset', async () => {
    await writeScreen('room', 'screen: room\nscreensaver:\n  widget: art\n  preset: gallery-silent\n  props:\n    matMargin: 6\n');
    const r = await call('room');
    expect(r.body.screensaver.props.matMargin).toBe(6);
    expect(r.body.screensaver.props.collection).toBe('all');
  });

  it('unknown preset → inline props only', async () => {
    await writeScreen('room', 'screen: room\nscreensaver:\n  widget: art\n  preset: nope\n  props:\n    matMargin: 7\n');
    const r = await call('room');
    expect(r.body.screensaver.props).toEqual({ matMargin: 7 });
  });

  it('no preset → config returned unchanged', async () => {
    await writeScreen('room', 'screen: room\nscreensaver:\n  widget: art\n  props:\n    matMargin: 8\n');
    const r = await call('room');
    expect(r.body.screensaver.props).toEqual({ matMargin: 8 });
  });

  it('missing artmode.yml → preset ref falls back to inline props', async () => {
    await fs.rm(path.join(dataPath, 'household', 'config', 'artmode.yml'));
    await writeScreen('room', 'screen: room\nscreensaver:\n  widget: art\n  preset: gallery-silent\n  props:\n    matMargin: 5\n');
    const r = await call('room');
    expect(r.body.screensaver.props).toEqual({ matMargin: 5 });
  });
});
```

- [ ] **Step 2: Run to confirm FAIL** — `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/screensPreset.test.mjs`. If the route-finding helper doesn't match the real router shape, read `backend/src/4_api/v1/routers/screens.mjs` and adjust ONLY `getHandler` — keep the assertions.

- [ ] **Step 3: Add the import + expansion to `backend/src/4_api/v1/routers/screens.mjs`.**

Add the import near the top (after the existing imports, e.g. after the `asyncHandler` import):
```js
import { resolvePreset } from '../../../1_adapters/content/art/presetResolver.mjs';
```

In the `GET /:screenId` handler, AFTER the `if (!config.screen) { ... }` validation block and BEFORE `logger.debug?.('screens.get.success', ...)`, insert:
```js
        // Expand an ArtMode screensaver preset reference into resolved props.
        if (config.screensaver?.preset) {
          let presets = {};
          try {
            const raw = await fs.readFile(
              path.join(dataPath, 'household', 'config', 'artmode.yml'), 'utf-8');
            presets = (yaml.load(raw) || {}).presets || {};
          } catch (err) {
            if (err.code !== 'ENOENT') {
              logger.warn?.('screens.presets.read_failed', { screenId, error: err.message });
            }
          }
          const presetKey = config.screensaver.preset;
          if (!Object.prototype.hasOwnProperty.call(presets, presetKey)) {
            logger.warn?.('screens.preset.unknown', { screenId, preset: presetKey });
          }
          config.screensaver.props = resolvePreset(presets, presetKey, config.screensaver.props || {});
        }
```

(`fs`, `path`, `yaml` are already imported in this file.)

- [ ] **Step 4: Run to confirm PASS** — `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/screensPreset.test.mjs` → all green.

- [ ] **Step 5: Commit**
```bash
git add backend/src/4_api/v1/routers/screens.mjs tests/unit/art/screensPreset.test.mjs
git commit -m "feat(artmode): screens API expands screensaver.preset into props"
```

---

### Task 3: Frontend ArtMode requests its collection

**Files:**
- Modify: `frontend/src/screen-framework/widgets/ArtMode.jsx`
- Test: `frontend/src/screen-framework/widgets/ArtMode.test.jsx`

- [ ] **Step 1: Add failing tests** to `frontend/src/screen-framework/widgets/ArtMode.test.jsx` inside the existing `describe('ArtMode', ...)` block (before its closing `});`):

```js
  it('requests the configured collection from the art API', async () => {
    DaylightAPI.mockResolvedValue(single());
    render(<ArtMode collection="baroque" />);
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledWith('api/v1/art/featured?collection=baroque'));
  });

  it('requests the default endpoint when no collection is set', async () => {
    DaylightAPI.mockResolvedValue(single());
    render(<ArtMode />);
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledWith('api/v1/art/featured'));
  });
```

- [ ] **Step 2: Run to confirm FAIL** — `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/widgets/ArtMode.test.jsx` (the `collection` test fails — currently always calls the bare endpoint; the bare-endpoint test passes already).

- [ ] **Step 3: Add the `collection` prop + use it in `load()`.**

In the prop destructure, add `collection = null`. Change the line:
```jsx
  curtainMinMs = CURTAIN_MIN_MS, curtainMaxMs = CURTAIN_MAX_MS, music = null,
```
to:
```jsx
  curtainMinMs = CURTAIN_MIN_MS, curtainMaxMs = CURTAIN_MAX_MS, music = null, collection = null,
```

In `load()`, replace:
```jsx
    DaylightAPI('api/v1/art/featured')
```
with:
```jsx
    const featuredUrl = collection
      ? `api/v1/art/featured?collection=${encodeURIComponent(collection)}`
      : 'api/v1/art/featured';
    DaylightAPI(featuredUrl)
```

And add `collection` to the `load` useCallback dependency array — change:
```jsx
  }, [logger, clearCurtainTimers, openCurtain, curtainMaxMs]);
```
to:
```jsx
  }, [logger, clearCurtainTimers, openCurtain, curtainMaxMs, collection]);
```

- [ ] **Step 4: Run to confirm PASS** — `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/widgets/ArtMode.test.jsx` → all green (prior tests still pass; both new ones pass).

- [ ] **Step 5: Commit**
```bash
git add frontend/src/screen-framework/widgets/ArtMode.jsx frontend/src/screen-framework/widgets/ArtMode.test.jsx
git commit -m "feat(artmode): ArtMode requests its configured collection from the API"
```

---

### Task 4: Create `artmode.yml` + migrate the living-room screensaver

**Files:** (container data volume — not the git repo)
- Create: `data/household/config/artmode.yml`
- Modify: `data/household/screens/living-room.yml`

- [ ] **Step 1: Create `artmode.yml`** (heredoc inside `sh -c`, never sed):

```bash
sudo docker exec daylight-station sh -c "cat > data/household/config/artmode.yml << 'YAML'
# ArtMode presets — named presentation bundles (collection + music + display).
presets:
  # Passive screensaver / splash / lock — silent (no music) by design.
  gallery-silent:
    collection: all
    music: null
    placard: true
    matMargin: 4
    cropMaxPerSide: 8
    frame: { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 }
    ambient:
      defaultLux: 80
      curve:
        - { lux: 0, dim: 0.92 }
        - { lux: 5, dim: 0.85 }
        - { lux: 40, dim: 0.55 }
        - { lux: 150, dim: 0.32 }
        - { lux: 400, dim: 0.15 }

  # Triggered presentation with classical background music (used by sub-project 3).
  classical-evening:
    collection: all
    music: { queue: \"plex:622894\", shuffle: true, volume: 0.25 }
    placard: true
    matMargin: 4
    cropMaxPerSide: 8
    frame: { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 }
    ambient:
      defaultLux: 80
      curve:
        - { lux: 0, dim: 0.92 }
        - { lux: 5, dim: 0.85 }
        - { lux: 40, dim: 0.55 }
        - { lux: 150, dim: 0.32 }
        - { lux: 400, dim: 0.15 }
YAML"
sudo docker exec daylight-station node -e "const y=require('js-yaml');const p=y.load(require('fs').readFileSync('data/household/config/artmode.yml','utf8')).presets;console.log('presets:', Object.keys(p).join(', '), '| gallery-silent.music =', p['gallery-silent'].music)"
```
Expected: prints `presets: gallery-silent, classical-evening | gallery-silent.music = null`.

- [ ] **Step 2: Read the current living-room.yml** so the rewrite preserves everything except the screensaver props:
```bash
sudo docker exec daylight-station sh -c 'cat data/household/screens/living-room.yml'
```

- [ ] **Step 3: Rewrite `living-room.yml`** with the screensaver block referencing the preset (heredoc). Replace ONLY the `screensaver:` block's inline props with `preset: gallery-silent`; keep every other section (screen, route, input, websocket, pip, layout, actions, sleep, fkb, routes, subscriptions, volume) byte-identical to what Step 2 printed. The screensaver block becomes exactly:
```yaml
screensaver:
  widget: art
  idle: 180
  showOnLoad: true
  interactive: true
  preset: gallery-silent
```
Write the complete file via `sudo docker exec daylight-station sh -c "cat > data/household/screens/living-room.yml << 'YAML' ... YAML"` using the Step-2 content with that screensaver block swapped in.

- [ ] **Step 4: Validate** the rewritten YAML parses and the preset reference is present:
```bash
sudo docker exec daylight-station node -e "const y=require('js-yaml');const c=y.load(require('fs').readFileSync('data/household/screens/living-room.yml','utf8'));console.log('preset:', c.screensaver.preset, '| has inline props:', !!c.screensaver.props, '| volume.fixed:', c.volume.fixed)"
```
Expected: `preset: gallery-silent | has inline props: false | volume.fixed: true`.

- [ ] **Step 5: No commit** (data-volume files aren't tracked in git). This task is configuration only.

---

### Task 5: Deploy + live verification

**Files:** none.

- [ ] **Step 1: Run the full art + screens + ArtMode suite**
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  tests/unit/art/presetResolver.test.mjs \
  tests/unit/art/screensPreset.test.mjs \
  tests/unit/art/collections.test.mjs \
  tests/unit/art/artSource.test.mjs \
  tests/unit/art/immichSource.test.mjs \
  tests/unit/art/ArtAdapter.test.mjs \
  tests/unit/art/artRouter.test.mjs \
  tests/unit/adapters/art/ArtAdapter.test.mjs \
  frontend/src/screen-framework/widgets/ArtMode.test.jsx
```
Expected: all green.

- [ ] **Step 2: Build + deploy** (stash unrelated WIP first, restore after — see prior plans). Then verify the screens API expands the preset and the screensaver is silent:
```bash
curl -s "http://localhost:3111/api/v1/screens/living-room" | python3 -c "import sys,json;d=json.load(sys.stdin);s=d['screensaver'];print('preset:', s.get('preset'), '| props.collection:', s['props'].get('collection'), '| props.music:', s['props'].get('music'))"
```
Expected: `preset: gallery-silent | props.collection: all | props.music: None`.

- [ ] **Step 3: Reload the kiosk** (clearCache + loadStartURL). The living-room screensaver should now show framed art with ambient dimming and **no background music** (silent, per design). View modes / brightness / shuffle unchanged.

(Deploy is the operator's call; plan ends here.)

---

## Notes for the implementer
- Run all specs with `./node_modules/.bin/vitest run --config vitest.config.mjs <file>` (NOT `npm test`).
- `resolvePreset` is reused by the trigger path (sub-project 3); keep it pure.
- Task 4/5 touch the container data volume — use `sudo docker exec daylight-station sh -c "cat > ... << 'YAML' ... YAML"` (heredoc; never `sed` on YAML). Migrating the screensaver to `gallery-silent` intentionally silences the passive screensaver's music.
- Keep all existing ArtMode/screens tests green — the changes are additive.
