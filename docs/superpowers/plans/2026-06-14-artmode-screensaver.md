# ArtMode Screensaver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a museum-style "ArtMode" screensaver — a random framed classic painting shown on the home (living-room) screen at boot and after inactivity, dismissed by any input to reveal the live home menu.

**Architecture:** A backend endpoint (`GET /api/v1/art/featured`) selects a random artwork folder, reads its `metadata.yaml`, and returns the image path + metadata. A frontend `art` widget composes the painting, the `frame.png` overlay, and an optional placard. A generic, config-driven screensaver controller in the screen-framework shows any configured widget as a lowest-priority fullscreen overlay on idle/boot and dismisses it (swallowing the first input) on any activity. The home screen YAML opts in via a `screensaver:` block.

**Tech Stack:** Node/Express (backend, ESM `.mjs`), `js-yaml`, React (frontend `.jsx`), Jest (backend tests), Vitest + @testing-library/react (frontend tests), supertest (router tests).

---

## File Structure

**Create:**
- `backend/src/1_adapters/content/art/ArtAdapter.mjs` — fs/yaml logic: list art folders, pick one, read metadata + image filename, return `{ image, meta }`.
- `backend/src/4_api/v1/routers/art.mjs` — thin Express router `createArtRouter({ artAdapter, logger })` exposing `GET /featured`.
- `frontend/src/screen-framework/widgets/ArtMode.jsx` — the `art` widget (painting + frame + placard).
- `frontend/src/screen-framework/widgets/ArtMode.css` — widget styles.
- `frontend/src/screen-framework/ScreenScreensaver.jsx` — renderless screensaver controller.
- `tests/unit/art/ArtAdapter.test.mjs` — adapter tests (Jest).
- `tests/unit/api/routers/art.test.mjs` — router tests (Jest + supertest).
- `frontend/src/screen-framework/widgets/ArtMode.test.jsx` — widget tests (Vitest).
- `frontend/src/screen-framework/ScreenScreensaver.test.jsx` — controller tests (Vitest).

**Modify:**
- `backend/src/4_api/v1/routers/index.mjs` — export `createArtRouter`.
- `backend/src/4_api/v1/routers/api.mjs` — add `'/art': 'art'` to `routeMap`.
- `backend/src/app.mjs` — construct the adapter + router and register `v1Routers.art`.
- `frontend/src/screen-framework/widgets/builtins.js` — register `art` widget.
- `frontend/src/screen-framework/ScreenRenderer.jsx` — mount `<ScreenScreensaver>`.
- `data/household/screens/living-room.yml` — add `screensaver:` block (edited inside the container).

**Conventions verified in this codebase:**
- Frontend `media/img/...` paths are rewritten to `/api/v1/static/img/...` by `DaylightMediaPath` (`frontend/src/lib/api.mjs`). The static router (`backend/src/4_api/v1/routers/static.mjs`) serves `GET /api/v1/static/img/*` from `imgBasePath`.
- Widget props flow from YAML straight into the component: `PanelRenderer` renders `<Component {...node.props} />`. The screensaver passes props the same way via `showOverlay(Component, props, ...)`.
- Overlay API (`useScreenOverlay`): `showOverlay(Component, props, { mode: 'fullscreen' })`, `dismissOverlay('fullscreen')`, `hasOverlay` (true only when a fullscreen overlay is active).
- Menu reset: `useMenuNavigationContext().reset()` clears the stack to root (stable `useCallback`).
- Backend tests run under Jest (`testEnvironment: 'node'`); use **relative imports** (not `#` aliases) to stay runner-agnostic. Frontend tests run under Vitest (jsdom env, `vi` global, auto JSX runtime — no `import React` needed).

---

## Task 1: Backend ArtAdapter

**Files:**
- Create: `backend/src/1_adapters/content/art/ArtAdapter.mjs`
- Test: `tests/unit/art/ArtAdapter.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/art/ArtAdapter.test.mjs`:

```javascript
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createArtAdapter } from '../../../backend/src/1_adapters/content/art/ArtAdapter.mjs';

let tmp;
let imgBasePath;

const writeArt = (folder, imageName, metaYaml) => {
  const dir = path.join(imgBasePath, 'art', 'classic', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, imageName), 'fake-image-bytes');
  if (metaYaml != null) fs.writeFileSync(path.join(dir, 'metadata.yaml'), metaYaml);
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'art-'));
  imgBasePath = path.join(tmp, 'img');
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('ArtAdapter', () => {
  it('returns image path + metadata for the picked folder', async () => {
    writeArt(
      'Adriaen van Ostade - 1674 - Merrymakers in an Inn',
      'Merrymakers in an Inn.jpg',
      "title: Merrymakers in an Inn\nartist: Adriaen van Ostade\ndate: '1674'\norigin: Holland\nmedium: Oil on panel\n"
    );
    const adapter = createArtAdapter({ imgBasePath });
    const result = await adapter.selectFeatured({ pick: (arr) => arr[0] });

    expect(result.image).toBe(
      '/media/img/art/classic/Adriaen%20van%20Ostade%20-%201674%20-%20Merrymakers%20in%20an%20Inn/Merrymakers%20in%20an%20Inn.jpg'
    );
    expect(result.meta).toEqual({
      title: 'Merrymakers in an Inn',
      artist: 'Adriaen van Ostade',
      date: '1674',
      origin: 'Holland',
      medium: 'Oil on panel',
    });
  });

  it('returns null metadata fields when metadata.yaml is missing', async () => {
    writeArt('Unknown - 0000 - Untitled', 'art.png', null);
    const adapter = createArtAdapter({ imgBasePath });
    const result = await adapter.selectFeatured({ pick: (arr) => arr[0] });
    expect(result.image).toBe('/media/img/art/classic/Unknown%20-%200000%20-%20Untitled/art.png');
    expect(result.meta).toEqual({ title: null, artist: null, date: null, origin: null, medium: null });
  });

  it('throws when no artwork folders exist', async () => {
    fs.mkdirSync(path.join(imgBasePath, 'art', 'classic'), { recursive: true });
    const adapter = createArtAdapter({ imgBasePath });
    await expect(adapter.selectFeatured({ pick: (arr) => arr[0] })).rejects.toThrow('No artwork available');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/art/ArtAdapter.test.mjs`
Expected: FAIL — `Cannot find module '.../ArtAdapter.mjs'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/1_adapters/content/art/ArtAdapter.mjs`:

```javascript
/**
 * ArtAdapter — selects a classic artwork from media/img/art/classic.
 *
 * Each artwork lives in its own subfolder containing one image file plus a
 * metadata.yaml. Selection is currently RANDOM; this `pick` seam is where a
 * date-seeded "one painting per day" policy would later plug in.
 */
import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const randomPick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function createArtAdapter({ imgBasePath, logger = console }) {
  const artDir = path.join(imgBasePath, 'art', 'classic');

  async function selectFeatured({ pick = randomPick } = {}) {
    let entries;
    try {
      entries = await fs.readdir(artDir, { withFileTypes: true });
    } catch (err) {
      throw new Error(`No artwork available: ${err.message}`);
    }
    const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    if (folders.length === 0) throw new Error('No artwork available');

    const folder = pick(folders);
    const folderPath = path.join(artDir, folder);
    const files = await fs.readdir(folderPath);
    const imageFile = files.find((f) => IMAGE_EXTS.includes(path.extname(f).toLowerCase()));
    if (!imageFile) throw new Error(`No image file in art folder: ${folder}`);

    let meta = { title: null, artist: null, date: null, origin: null, medium: null };
    try {
      const raw = await fs.readFile(path.join(folderPath, 'metadata.yaml'), 'utf-8');
      const parsed = yaml.load(raw) || {};
      meta = {
        title: parsed.title ?? null,
        artist: parsed.artist ?? null,
        date: parsed.date != null ? String(parsed.date) : null,
        origin: parsed.origin ?? null,
        medium: parsed.medium ?? null,
      };
    } catch (err) {
      logger.warn?.('art.metadata.missing', { folder, error: err.message });
    }

    const image =
      `/media/img/art/classic/${encodeURIComponent(folder)}/${encodeURIComponent(imageFile)}`;
    return { image, meta };
  }

  return { selectFeatured };
}

export default createArtAdapter;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/art/ArtAdapter.test.mjs`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/content/art/ArtAdapter.mjs tests/unit/art/ArtAdapter.test.mjs
git commit -m "feat(art): add ArtAdapter for random artwork selection

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Backend art router + wiring

**Files:**
- Create: `backend/src/4_api/v1/routers/art.mjs`
- Test: `tests/unit/api/routers/art.test.mjs`
- Modify: `backend/src/4_api/v1/routers/index.mjs`, `backend/src/4_api/v1/routers/api.mjs`, `backend/src/app.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/api/routers/art.test.mjs`:

```javascript
import request from 'supertest';
import express from 'express';
import { createArtRouter } from '../../../backend/src/4_api/v1/routers/art.mjs';

const makeApp = (artAdapter) => {
  const app = express();
  app.use('/art', createArtRouter({ artAdapter }));
  return app;
};

describe('Art Router', () => {
  it('GET /art/featured returns image + meta from the adapter', async () => {
    const artAdapter = {
      selectFeatured: async () => ({
        image: '/media/img/art/classic/Folder/Painting.jpg',
        meta: { title: 'Painting', artist: 'Someone', date: '1674', origin: 'Holland', medium: 'Oil' },
      }),
    };
    const res = await request(makeApp(artAdapter)).get('/art/featured');
    expect(res.status).toBe(200);
    expect(res.body.image).toBe('/media/img/art/classic/Folder/Painting.jpg');
    expect(res.body.meta.artist).toBe('Someone');
  });

  it('GET /art/featured returns 503 when no artwork is available', async () => {
    const artAdapter = {
      selectFeatured: async () => { throw new Error('No artwork available'); },
    };
    const res = await request(makeApp(artAdapter)).get('/art/featured');
    expect(res.status).toBe(503);
    expect(res.body.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/api/routers/art.test.mjs`
Expected: FAIL — `Cannot find module '.../art.mjs'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/4_api/v1/routers/art.mjs`:

```javascript
/**
 * Art API Router
 * Serves a selected classic artwork (image path + metadata) for ArtMode.
 *
 * @module api/v1/routers/art
 */
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Create Art API router
 *
 * @param {Object} config
 * @param {Object} config.artAdapter - Adapter with selectFeatured()
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createArtRouter(config = {}) {
  const { artAdapter, logger = console } = config;
  const router = express.Router();

  /**
   * GET /featured
   * Returns a selected artwork: { image, meta }.
   */
  router.get(
    '/featured',
    asyncHandler(async (req, res) => {
      try {
        const result = await artAdapter.selectFeatured();
        logger.debug?.('art.featured.served', { title: result?.meta?.title ?? null });
        res.json(result);
      } catch (err) {
        logger.warn?.('art.featured.unavailable', { error: err.message });
        res.status(503).json({ error: 'No artwork available', message: err.message });
      }
    })
  );

  return router;
}

export default createArtRouter;
```

(Note: the router file uses the `#system/...` alias, matching sibling routers like `screens.mjs`. The **test** mounts the router directly with an injected adapter and never imports `#system`, so it stays runner-agnostic.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/api/routers/art.test.mjs`
Expected: PASS (2 passing).

- [ ] **Step 5: Wire the export in `index.mjs`**

In `backend/src/4_api/v1/routers/index.mjs`, find the line:

```javascript
export { createStaticRouter } from './static.mjs';
```

Add directly below it:

```javascript
export { createArtRouter } from './art.mjs';
```

- [ ] **Step 6: Add the route to the routeMap in `api.mjs`**

In `backend/src/4_api/v1/routers/api.mjs`, find in `routeMap`:

```javascript
    '/static': 'static',
```

Add directly below it:

```javascript
    '/art': 'art',
```

- [ ] **Step 7: Construct adapter + router in `app.mjs`**

In `backend/src/app.mjs`, find the static-router block:

```javascript
  // Static assets router
  v1Routers.static = createStaticApiRouter({
    imgBasePath,
    dataBasePath,
    logger: rootLogger.child({ module: 'static-api' })
  });
```

Add directly below it:

```javascript
  // Art router — selects a classic artwork (image + metadata) for ArtMode
  v1Routers.art = createArtRouter({
    artAdapter: createArtAdapter({
      imgBasePath,
      logger: rootLogger.child({ module: 'art-adapter' })
    }),
    logger: rootLogger.child({ module: 'art-api' })
  });
```

Then add the two imports near the other router/adapter imports at the top of `app.mjs`. Find:

```javascript
import { createApiRouter } from './4_api/v1/routers/api.mjs';
```

Add directly below it:

```javascript
import { createArtRouter } from './4_api/v1/routers/art.mjs';
import { createArtAdapter } from './1_adapters/content/art/ArtAdapter.mjs';
```

- [ ] **Step 8: Verify backend boots and the route responds**

Confirm a dev server is running on the backend port (see `CLAUDE.md`; on kckern-server check `lsof -i :3111`). If running, hit the endpoint:

Run: `curl -s http://localhost:3111/api/v1/art/featured | head -c 400`
Expected: JSON like `{"image":"/media/img/art/classic/<folder>/<file>.jpg","meta":{"title":...}}`.

If the backend is not running, start it per `CLAUDE.md` (`node backend/index.js`) first.

- [ ] **Step 9: Commit**

```bash
git add backend/src/4_api/v1/routers/art.mjs tests/unit/api/routers/art.test.mjs \
        backend/src/4_api/v1/routers/index.mjs backend/src/4_api/v1/routers/api.mjs \
        backend/src/app.mjs
git commit -m "feat(art): expose GET /api/v1/art/featured

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: ArtMode widget

**Files:**
- Create: `frontend/src/screen-framework/widgets/ArtMode.jsx`
- Create: `frontend/src/screen-framework/widgets/ArtMode.css`
- Test: `frontend/src/screen-framework/widgets/ArtMode.test.jsx`
- Modify: `frontend/src/screen-framework/widgets/builtins.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/screen-framework/widgets/ArtMode.test.jsx`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { DaylightAPI } from '../../lib/api.mjs';
import ArtMode from './ArtMode.jsx';

vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(),
  DaylightMediaPath: (p) => String(p),
}));

describe('ArtMode', () => {
  beforeEach(() => {
    DaylightAPI.mockReset();
  });

  it('renders the painting and the frame overlay', async () => {
    DaylightAPI.mockResolvedValue({
      image: '/media/img/art/classic/Folder/Painting.jpg',
      meta: { title: 'Painting', artist: 'Someone', date: '1674', origin: 'Holland', medium: 'Oil' },
    });
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    expect(getByTestId('artmode-image').getAttribute('src')).toBe('/media/img/art/classic/Folder/Painting.jpg');
    expect(getByTestId('artmode-frame')).toBeTruthy();
  });

  it('shows the placard with title/artist/year by default', async () => {
    DaylightAPI.mockResolvedValue({
      image: '/x.jpg',
      meta: { title: 'Painting', artist: 'Someone', date: '1674', origin: null, medium: null },
    });
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-placard')).toBeTruthy());
    expect(getByTestId('artmode-placard').textContent).toContain('Painting');
    expect(getByTestId('artmode-placard').textContent).toContain('Someone');
    expect(getByTestId('artmode-placard').textContent).toContain('1674');
  });

  it('hides the placard when placard=false', async () => {
    DaylightAPI.mockResolvedValue({ image: '/x.jpg', meta: { title: 'T', artist: 'A', date: '1' } });
    const { queryByTestId, getByTestId } = render(<ArtMode placard={false} />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    expect(queryByTestId('artmode-placard')).toBeNull();
  });

  it('renders a black fallback (no image) when the fetch fails', async () => {
    DaylightAPI.mockRejectedValue(new Error('boom'));
    const { queryByTestId, getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode')).toBeTruthy());
    expect(queryByTestId('artmode-image')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/widgets/ArtMode.test.jsx`
Expected: FAIL — cannot resolve `./ArtMode.jsx`.

- [ ] **Step 3: Write the widget implementation**

Create `frontend/src/screen-framework/widgets/ArtMode.css`:

```css
.artmode {
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
  overflow: hidden;
}

.artmode__image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.artmode__frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
}

.artmode__placard {
  position: absolute;
  bottom: 15%;
  right: 9%;
  max-width: 40%;
  padding: 0.5rem 0.9rem;
  background: rgba(0, 0, 0, 0.55);
  border-radius: 6px;
  color: #f3ecdd;
  font-family: 'Roboto Condensed', sans-serif;
  text-align: right;
  line-height: 1.3;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}

.artmode__placard-title {
  font-style: italic;
  font-size: 1.4rem;
}

.artmode__placard-artist {
  font-size: 1.1rem;
  opacity: 0.85;
}
```

Create `frontend/src/screen-framework/widgets/ArtMode.jsx`:

```javascript
// frontend/src/screen-framework/widgets/ArtMode.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { DaylightAPI, DaylightMediaPath } from '../../lib/api.mjs';
import { getChildLogger } from '../../lib/logging/singleton.js';
import './ArtMode.css';

const FRAME_SRC = DaylightMediaPath('media/img/ui/frame.png');

/**
 * ArtMode — screensaver widget showing a framed classic painting.
 *
 * Layers (bottom → top): painting (object-fit cover) → frame.png overlay →
 * optional museum placard. Fetches a random artwork from /api/v1/art/featured.
 *
 * Props (from screen YAML / screensaver config):
 *   placard: boolean   show the title/artist/year placard (default true)
 */
function ArtMode({ placard = true }) {
  const [art, setArt] = useState(null);
  const [failed, setFailed] = useState(false);
  const logger = useMemo(() => getChildLogger({ widget: 'art' }), []);

  useEffect(() => {
    let cancelled = false;
    logger.info('artmode.mount', {});
    DaylightAPI('api/v1/art/featured')
      .then((data) => {
        if (cancelled) return;
        setArt(data);
        logger.info('artmode.loaded', { title: data?.meta?.title ?? null, artist: data?.meta?.artist ?? null });
      })
      .catch((err) => {
        if (cancelled) return;
        setFailed(true);
        logger.error('artmode.load-failed', { error: err.message });
      });
    return () => { cancelled = true; };
  }, [logger]);

  const caption = useMemo(() => {
    if (!art?.meta) return null;
    const { title, artist, date } = art.meta;
    return { title: title || null, artist: artist || null, date: date || null };
  }, [art]);

  return (
    <div className="artmode" data-testid="artmode">
      {art?.image && !failed && (
        <img
          className="artmode__image"
          data-testid="artmode-image"
          src={DaylightMediaPath(art.image)}
          alt={caption?.title || 'Artwork'}
        />
      )}
      <img className="artmode__frame" data-testid="artmode-frame" src={FRAME_SRC} alt="" />
      {placard && caption && (caption.title || caption.artist) && (
        <div className="artmode__placard" data-testid="artmode-placard">
          {caption.title && <div className="artmode__placard-title">{caption.title}</div>}
          <div className="artmode__placard-artist">
            {[caption.artist, caption.date].filter(Boolean).join(', ')}
          </div>
        </div>
      )}
    </div>
  );
}

export default ArtMode;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/widgets/ArtMode.test.jsx`
Expected: PASS (4 passing).

- [ ] **Step 5: Register the widget**

In `frontend/src/screen-framework/widgets/builtins.js`, add the import near the other widget imports:

```javascript
import ArtMode from './ArtMode.jsx';
```

And inside `registerBuiltinWidgets()`, after `registry.register('menu', MenuWidget);`, add:

```javascript
  registry.register('art', ArtMode);
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screen-framework/widgets/ArtMode.jsx \
        frontend/src/screen-framework/widgets/ArtMode.css \
        frontend/src/screen-framework/widgets/ArtMode.test.jsx \
        frontend/src/screen-framework/widgets/builtins.js
git commit -m "feat(art): add ArtMode widget (framed painting + placard)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Screensaver controller

**Files:**
- Create: `frontend/src/screen-framework/ScreenScreensaver.jsx`
- Test: `frontend/src/screen-framework/ScreenScreensaver.test.jsx`
- Modify: `frontend/src/screen-framework/ScreenRenderer.jsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/screen-framework/ScreenScreensaver.test.jsx`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { ScreenOverlayProvider } from './overlays/ScreenOverlayProvider.jsx';
import { MenuNavigationProvider } from '../context/MenuNavigationContext.jsx';
import { getWidgetRegistry, resetWidgetRegistry } from './widgets/registry.js';
import { ScreenScreensaver } from './ScreenScreensaver.jsx';

function DummyArt() {
  return <div data-testid="dummy-art">art</div>;
}

const renderWithProviders = (config) =>
  render(
    <MenuNavigationProvider>
      <ScreenOverlayProvider>
        <ScreenScreensaver config={config} />
      </ScreenOverlayProvider>
    </MenuNavigationProvider>
  );

describe('ScreenScreensaver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetWidgetRegistry();
    getWidgetRegistry().register('art', DummyArt);
  });
  afterEach(() => {
    vi.useRealTimers();
    resetWidgetRegistry();
  });

  it('shows the screensaver widget after the idle timeout', () => {
    const { queryByTestId } = renderWithProviders({ widget: 'art', idle: 2, showOnLoad: false });
    expect(queryByTestId('dummy-art')).toBeNull();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(queryByTestId('dummy-art')).toBeTruthy();
  });

  it('shows immediately when showOnLoad is true', () => {
    const { queryByTestId } = renderWithProviders({ widget: 'art', idle: 99, showOnLoad: true });
    expect(queryByTestId('dummy-art')).toBeTruthy();
  });

  it('dismisses on input and swallows the first event', () => {
    const { queryByTestId } = renderWithProviders({ widget: 'art', idle: 99, showOnLoad: true });
    expect(queryByTestId('dummy-art')).toBeTruthy();

    const evt = new KeyboardEvent('keydown', { bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(evt); });

    expect(queryByTestId('dummy-art')).toBeNull();
    expect(evt.defaultPrevented).toBe(true);
  });

  it('resets the idle timer on activity (does not show while active)', () => {
    const { queryByTestId } = renderWithProviders({ widget: 'art', idle: 4, showOnLoad: false });
    act(() => { vi.advanceTimersByTime(3000); });
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true })); });
    act(() => { vi.advanceTimersByTime(3000); }); // 6s total, but timer was reset at 3s
    expect(queryByTestId('dummy-art')).toBeNull();
    act(() => { vi.advanceTimersByTime(1000); }); // now 4s since reset
    expect(queryByTestId('dummy-art')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/ScreenScreensaver.test.jsx`
Expected: FAIL — cannot resolve `./ScreenScreensaver.jsx`.

- [ ] **Step 3: Write the controller implementation**

Create `frontend/src/screen-framework/ScreenScreensaver.jsx`:

```javascript
// frontend/src/screen-framework/ScreenScreensaver.jsx
import { useEffect, useRef } from 'react';
import { useScreenOverlay } from './overlays/ScreenOverlayProvider.jsx';
import { getWidgetRegistry } from './widgets/registry.js';
import { useMenuNavigationContext } from '../context/MenuNavigationContext.jsx';
import getLogger from '../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ScreenScreensaver' });
  return _logger;
}

const ACTIVITY_EVENTS = ['keydown', 'pointerdown', 'click'];

/**
 * ScreenScreensaver — renderless controller that shows a configured widget as a
 * lowest-priority fullscreen overlay on idle / at boot, and dismisses it on any
 * input (swallowing the first event so it doesn't leak into the menu).
 *
 * Suppressed while another fullscreen overlay (player/piano/camera) is active.
 *
 * Config (from screen YAML `screensaver:` block):
 *   widget: string      widget registry key to show (required)
 *   idle: number        seconds of inactivity before showing (default 120)
 *   showOnLoad: boolean show immediately at boot (default false)
 *   props: object       props passed to the widget
 */
export function ScreenScreensaver({ config }) {
  const { showOverlay, dismissOverlay, hasOverlay } = useScreenOverlay();
  const { reset } = useMenuNavigationContext();

  const widgetKey = config?.widget ?? null;
  const idleSeconds = config?.idle ?? 120;
  const showOnLoad = config?.showOnLoad ?? false;
  const propsJson = JSON.stringify(config?.props ?? {});

  // Read latest hasOverlay without re-running the effect.
  const hasOverlayRef = useRef(hasOverlay);
  hasOverlayRef.current = hasOverlay;

  useEffect(() => {
    if (!widgetKey) return undefined;
    const widgetProps = JSON.parse(propsJson);
    let shown = false;
    let timer = null;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(show, idleSeconds * 1000);
    };

    function wake(e) {
      if (!shown) return;
      if (e) { e.stopPropagation(); e.preventDefault(); }
      shown = false;
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, wake, true));
      dismissOverlay('fullscreen');
      logger().info('screensaver.wake', {});
      schedule();
    }

    function show() {
      if (shown) return;
      if (hasOverlayRef.current) { schedule(); return; } // suppressed by active overlay
      const Component = getWidgetRegistry().get(widgetKey);
      if (!Component) { logger().warn('screensaver.widget-not-found', { widget: widgetKey }); return; }
      reset?.();
      shown = true;
      showOverlay(Component, widgetProps, { mode: 'fullscreen' });
      logger().info('screensaver.show', { widget: widgetKey });
      ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, wake, true));
    }

    const onActivity = () => { if (!shown) schedule(); };
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, onActivity));

    if (showOnLoad) show(); else schedule();

    return () => {
      if (timer) clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, onActivity));
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, wake, true));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetKey, idleSeconds, showOnLoad, propsJson, showOverlay, dismissOverlay, reset]);

  return null;
}

export default ScreenScreensaver;
```

Note: `hasOverlayRef` is a `useRef` updated on every render, so `show()` (called from timers) always reads the live overlay state — the suppression check correctly skips showing the screensaver when a player/piano/camera overlay is already up when the timer fires. (`showOverlay`/`dismissOverlay`/`reset` are stable `useCallback`s, so the effect runs once per config change, not per render.)

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/ScreenScreensaver.test.jsx`
Expected: PASS (4 passing).

- [ ] **Step 5: Mount the controller in ScreenRenderer**

In `frontend/src/screen-framework/ScreenRenderer.jsx`, add the import after the existing `ScreenSessionPublishers` import:

```javascript
import { ScreenScreensaver } from './ScreenScreensaver.jsx';
```

Then, inside the provider tree, find:

```jsx
                  <ScreenSubscriptionHandler subscriptions={config.subscriptions} />
```

Add directly below it:

```jsx
                  <ScreenScreensaver config={config.screensaver} />
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screen-framework/ScreenScreensaver.jsx \
        frontend/src/screen-framework/ScreenScreensaver.test.jsx \
        frontend/src/screen-framework/ScreenRenderer.jsx
git commit -m "feat(art): add config-driven screensaver controller

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Enable screensaver on the home screen + verify end-to-end

**Files:**
- Modify: `data/household/screens/living-room.yml` (edited inside the running container)

- [ ] **Step 1: Read the current home screen config**

Run: `sudo docker exec daylight-station sh -c 'cat data/household/screens/living-room.yml'`
Expected: prints the YAML (note the existing top-level keys: `screen`, `route`, `input`, `layout`, `actions`, `subscriptions`, `volume`, …).

- [ ] **Step 2: Add the screensaver block**

Add a new top-level `screensaver:` block to `living-room.yml`. Per `CLAUDE.local.md`, **do not use `sed -i`** on container YAML — rewrite the whole file with a heredoc, or edit the Dropbox-synced copy. The block to add (top-level, sibling to `layout:`):

```yaml
screensaver:
  widget: art
  idle: 180
  showOnLoad: true
  props:
    placard: true
```

Apply by rewriting the file inside the container (paste the full, updated YAML — existing content plus the block above):

```bash
sudo docker exec daylight-station sh -c "cat > data/household/screens/living-room.yml << 'EOF'
<full updated living-room.yml content here>
EOF"
```

- [ ] **Step 3: Verify the config is served with the screensaver block**

Run: `curl -s http://localhost:3111/api/v1/screens/living-room | python3 -m json.tool | grep -A5 screensaver`
Expected: shows `widget: art`, `idle: 180`, `showOnLoad: true`, `placard: true`.

- [ ] **Step 4: Verify the art endpoint returns a real painting**

Run: `curl -s http://localhost:3111/api/v1/art/featured`
Expected: JSON with an `image` path under `/media/img/art/classic/...` and populated `meta`.

- [ ] **Step 5: Verify the image actually serves**

Run: `curl -s -o /dev/null -w "%{http_code} %{content_type}\n" "http://localhost:3111$(curl -s http://localhost:3111/api/v1/art/featured | python3 -c 'import sys,json; print(json.load(sys.stdin)["image"].replace("/media/img/","/api/v1/static/img/"))')"`
Expected: `200 image/jpeg` (or the painting's actual MIME type).

- [ ] **Step 6: Visual check**

Open `/screen/living-room` (the FKB kiosk, or a browser at `http://localhost:3111/screen/living-room`). Expected: a framed painting fills the screen on load with a placard in the lower-right; pressing any key / tapping clears it instantly and reveals the home menu; after 180s idle the painting returns.

- [ ] **Step 7: Run the full frontend screen-framework test suite to confirm no regressions**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/`
Expected: all screen-framework tests pass (including the new ArtMode and ScreenScreensaver tests).

- [ ] **Step 8: Commit any config captured in the repo (if applicable)**

The live `living-room.yml` lives in the data volume (not the git repo). If a sample/seed copy of screen configs is tracked in the repo, update that copy too and commit:

```bash
git add -A
git commit -m "feat(art): enable ArtMode screensaver on living-room home screen

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

If no screen configs are tracked in the repo, skip this commit (the change is data-volume-only).

---

## Self-Review Notes

- **Spec coverage:** backend endpoint (Task 1–2), `ArtMode` widget with frame + object-fit cover + optional placard + black fallback (Task 3), generic config-driven screensaver with idle/boot show, any-input dismiss with event-swallow, `hasOverlay` suppression, and menu reset-to-root (Task 4), `screensaver:` block on `living-room.yml` (Task 5). Random selection with the deferred-daily seam is in `ArtAdapter` (`pick`).
- **Deferred (not implemented, by design):** date-seeded daily selection + recent-pick memory, midnight rollover, screensaver on other screens.
- **Type/name consistency:** `createArtAdapter` → `{ selectFeatured({ pick }) }` → `{ image, meta }`; `createArtRouter({ artAdapter, logger })` exposes `GET /featured`; widget registry key `art`; `screensaver` config keys `widget`/`idle`/`showOnLoad`/`props` used identically in the controller, its test, and the YAML.
