# Admin Preview Player — Screen Fidelity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `AdminPreviewPlayer` render content at the CSS-pixel scale of a real screen, so rem-sized type in the Player occupies the same fraction of the frame in preview as it does on the kiosk — then fix the hymn centring bug the honest preview makes obvious.

**Architecture:** Every dimension in the Player/ContentScroller chain is `rem`-based against an unmodified 16px root, so apparent type size is purely a function of how many CSS pixels wide the box is. `ScreenRenderer` gives `.screen-root` a fixed px box from each screen's declared `resolution` (960×540, 1280×720, 1280×800) with no scaling. The preview hardcodes a 1920×1080 box at `zoom: 0.5` — right *visual* size, wrong *layout* size, so type renders 2× small against living-room and 1.5× small against office/portal. The fix: extend the screens list API to carry `resolution`, then size the preview's inner box to the selected screen's exact resolution and set `zoom = 960 / resolution.width`.

**Tech Stack:** Express + js-yaml (backend), React + Mantine + SCSS (frontend), Vitest (colocated `.test.jsx`), Playwright (live flow).

---

## Background: the measurements this plan is built on

Verified before writing this plan — do not re-derive:

**`zoom` semantics** (probed on Chromium 147, headless, a standalone replica of the current preview box):

| Read | Returns |
|---|---|
| computed `font-size` inside `zoom: 0.5` | `32px` (unscaled) — the *rendered* size is 16px |
| `offsetWidth` / `clientHeight` | **unzoomed layout px** (1920) |
| `getBoundingClientRect().width` | **zoomed visual px** (960) |

So `zoom` scales the used value at paint time while `offsetWidth` stays in layout space. `useCenterByWidest` reads only `offsetWidth`, so it is internally consistent under zoom — no compounding bug there.

**Declared screen resolutions** (`data/household/screens/*.yml`, consumed at `frontend/src/screen-framework/ScreenRenderer.jsx:392-397`):

| Screen | CSS px |
|---|---|
| living-room (Shield) | 960 × 540 |
| office | 1280 × 720 |
| portal | 1280 × 800 (−80px TouchChrome lane → 1280×720 content) |
| **admin preview (today)** | **1920 × 1080 @ `zoom: 0.5`** |

**Resulting type-to-box ratio** for `.singalong-text` (`font-size: 2rem` = 32px):

| Context | box width | ratio |
|---|---|---|
| living-room | 960 | 3.33% |
| office / portal | 1280 | 2.50% |
| admin preview | 1920 | **1.67%** |

Preview is exactly **2.0×** too small vs living-room, **1.5×** vs office/portal.

**Root font-size is never overridden** — no `html`/`:root` `font-size` rule in any SCSS/CSS, and nothing sets `documentElement.style.fontSize`. `1rem === 16px` everywhere. Do not "fix" this by scaling the root; that would move every other surface in the app.

---

## Task 1: Screens list API carries `resolution`

Today `GET /api/v1/screens` returns bare id strings, so a caller that needs resolutions must issue N follow-up config fetches. **Verified: nothing consumes the list endpoint today** (the only `/api/v1/screens` consumer is `ScreenRenderer.jsx:285`, which hits the `/:screenId` detail route). Changing the element shape from `string` to `object` is therefore safe.

**Files:**
- Modify: `backend/src/4_api/v1/routers/screens.mjs:29-53`
- Test: `tests/unit/art/screensList.test.mjs` (new — colocated with the existing `screensPreset.test.mjs` router test)

**Step 1: Write the failing test**

Create `tests/unit/art/screensList.test.mjs`:

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createScreensRouter } from '../../../backend/src/4_api/v1/routers/screens.mjs';

let dataPath;
const logger = { debug() {}, info() {}, warn() {}, error() {} };

const writeScreen = (id, yamlStr) =>
  fs.writeFile(path.join(dataPath, 'household', 'screens', `${id}.yml`), yamlStr);

function getListHandler(router) {
  const layer = router.stack.find((l) => l.route?.path === '/' && l.route.methods.get);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

const callList = async () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  const router = createScreensRouter({ householdDir: path.join(dataPath, 'household'), logger });
  await getListHandler(router)({}, r, (e) => { if (e) throw e; });
  return r;
};

beforeEach(async () => {
  dataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'screens-list-'));
  await fs.mkdir(path.join(dataPath, 'household', 'screens'), { recursive: true });
});
afterEach(async () => { await fs.rm(dataPath, { recursive: true, force: true }); });

describe('screens list endpoint', () => {
  it('carries each screen declared CSS-pixel resolution', async () => {
    await writeScreen('living-room', 'screen: living-room\nname: Living Room\nresolution:\n  width: 960\n  height: 540\n');
    await writeScreen('office', 'screen: office\nresolution:\n  width: 1280\n  height: 720\n');

    const r = await callList();

    expect(r.body.screens).toEqual(expect.arrayContaining([
      { id: 'living-room', name: 'Living Room', resolution: { width: 960, height: 540 } },
      { id: 'office', name: 'office', resolution: { width: 1280, height: 720 } },
    ]));
  });

  it('reports a null resolution for a screen that declares none', async () => {
    await writeScreen('kitchen-eink', 'screen: kitchen-eink\n');

    const r = await callList();

    expect(r.body.screens).toEqual([{ id: 'kitchen-eink', name: 'kitchen-eink', resolution: null }]);
  });

  it('degrades an unparsable screen file to id-only instead of failing the list', async () => {
    await writeScreen('good', 'screen: good\nresolution:\n  width: 960\n  height: 540\n');
    await writeScreen('broken', 'screen: [unclosed\n');

    const r = await callList();

    expect(r.body.screens).toHaveLength(2);
    expect(r.body.screens.find((s) => s.id === 'broken')).toEqual({ id: 'broken', name: 'broken', resolution: null });
  });

  it('still returns an empty list when the screens directory is absent', async () => {
    await fs.rm(path.join(dataPath, 'household', 'screens'), { recursive: true, force: true });

    const r = await callList();

    expect(r.body).toEqual({ screens: [] });
  });
});
```

**Step 2: Run the test to verify it fails**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/screensList.test.mjs
```

Expected: FAIL — the first three cases get bare strings (`'living-room'`) where objects are expected. The fourth (empty dir) already passes.

**Step 3: Write the implementation**

In `backend/src/4_api/v1/routers/screens.mjs`, replace the body of the `router.get('/', ...)` handler's `try` block (currently lines 34-48) with:

```javascript
        const files = await fs.readdir(screensDir);
        // Keep the real filename — `.yaml` screens exist and re-appending
        // `.yml` to a stripped id would read the wrong path.
        const entries = files
          .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
          .map(f => ({ id: f.replace(/\.ya?ml$/, ''), file: f }));

        // Each entry carries the screen's declared CSS-pixel `resolution` so a
        // caller that must render AT a screen's scale (the admin preview) sizes
        // itself from one request instead of N detail fetches. A file that fails
        // to parse degrades to id-only rather than failing the whole list.
        const screens = await Promise.all(entries.map(async ({ id, file }) => {
          try {
            const raw = await fs.readFile(path.join(screensDir, file), 'utf-8');
            const cfg = yaml.load(raw) || {};
            const r = cfg.resolution;
            const resolution = (Number.isFinite(r?.width) && Number.isFinite(r?.height))
              ? { width: r.width, height: r.height }
              : null;
            return { id, name: cfg.name || cfg.screen || id, resolution };
          } catch (err) {
            logger.warn?.('screens.list.unreadable', { id, error: err.message });
            return { id, name: id, resolution: null };
          }
        }));

        logger.debug?.('screens.list.success', { count: screens.length });
        res.json({ screens });
```

Leave the `catch (err)` block below it exactly as-is (it handles the missing-directory case).

**Step 4: Run the test to verify it passes**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/screensList.test.mjs
```

Expected: PASS, 4 tests.

**Step 5: Confirm nothing else consumed the old shape**

```bash
grep -rn "api/v1/screens'" frontend/src backend/src cli tests | grep -v node_modules
```

Expected: no hits for the bare list URL (only `api/v1/screens/${screenId}` in `ScreenRenderer.jsx`).

**Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/screens.mjs tests/unit/art/screensList.test.mjs
git commit -m "feat(screens-api): list endpoint carries each screen's declared resolution"
```

---

## Task 2: Pure frame-geometry module

Isolating the arithmetic makes it testable without a DOM and keeps the component thin.

**Files:**
- Create: `frontend/src/modules/Admin/Preview/previewFrame.js`
- Test: `frontend/src/modules/Admin/Preview/previewFrame.test.js`

**Step 1: Write the failing test**

Create `frontend/src/modules/Admin/Preview/previewFrame.test.js`:

```javascript
// previewFrame.test.js — the arithmetic that makes the admin preview honest.
//
// The Player is sized entirely in rem against an unmodified 16px root, so
// apparent type size is a pure function of how many CSS px wide its box is.
// The preview therefore has to lay out at the target screen's EXACT resolution
// and zoom that box down to fit, rather than pick a convenient 1920x1080.
import { describe, it, expect } from 'vitest';
import { PREVIEW_WIDTH, previewFrameVars } from './previewFrame.js';

describe('previewFrameVars', () => {
  it('lays out at the screen resolution and zooms to the preview width', () => {
    expect(previewFrameVars({ width: 1280, height: 720 })).toEqual({
      '--preview-width': '960px',
      '--preview-screen-width': '1280px',
      '--preview-screen-height': '720px',
      '--preview-scale': '0.75',
      '--preview-box-height': '540px',
    });
  });

  it('renders a screen already at the preview width 1:1 — no zoom at all', () => {
    const vars = previewFrameVars({ width: 960, height: 540 });
    expect(vars['--preview-scale']).toBe('1');
    expect(vars['--preview-screen-width']).toBe('960px');
    expect(vars['--preview-box-height']).toBe('540px');
  });

  it('keeps a non-16:9 screen at its own aspect instead of forcing 16:9', () => {
    // portal is 1280x800 (16:10). A forced 540px-tall box would crop or letterbox.
    expect(previewFrameVars({ width: 1280, height: 800 })['--preview-box-height']).toBe('600px');
  });

  it('returns null for a screen with no usable resolution', () => {
    expect(previewFrameVars(null)).toBeNull();
    expect(previewFrameVars({})).toBeNull();
    expect(previewFrameVars({ width: 0, height: 540 })).toBeNull();
    expect(previewFrameVars({ width: '1280', height: 'wide' })).toBeNull();
  });

  it('exports the preview surface width the SCSS is written against', () => {
    expect(PREVIEW_WIDTH).toBe(960);
  });
});
```

**Step 2: Run the test to verify it fails**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Admin/Preview/previewFrame.test.js
```

Expected: FAIL — `Failed to resolve import "./previewFrame.js"`.

**Step 3: Write the implementation**

Create `frontend/src/modules/Admin/Preview/previewFrame.js`:

```javascript
/**
 * previewFrame
 * ------------
 * Geometry for the admin preview surface.
 *
 * Every dimension in the Player / ContentScroller chain is `rem` against an
 * unmodified 16px root, so how large type LOOKS depends only on how many CSS
 * pixels wide its box is. `ScreenRenderer` gives `.screen-root` a fixed px box
 * straight from the screen's declared `resolution` and never scales it, so a
 * faithful preview has to do the same: lay out at the screen's exact CSS-pixel
 * resolution, then `zoom` that box down to fit the preview surface.
 *
 * The preview used to hardcode 1920x1080 @ zoom 0.5 — the right visual size but
 * the wrong layout size, which rendered every rem-sized glyph 2x small against a
 * 960x540 screen and 1.5x small against a 1280-wide one.
 */

/** Width of the visible preview surface, in real CSS px. */
export const PREVIEW_WIDTH = 960;

/**
 * Build the CSS custom properties that drive AdminPreviewPlayer.scss.
 *
 * @param {{width: number, height: number}|null|undefined} resolution
 * @returns {Object<string,string>|null} null when the screen declares no usable resolution
 */
export function previewFrameVars(resolution) {
  const w = resolution?.width;
  const h = resolution?.height;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;

  const scale = PREVIEW_WIDTH / w;
  return {
    '--preview-width': `${PREVIEW_WIDTH}px`,
    '--preview-screen-width': `${w}px`,
    '--preview-screen-height': `${h}px`,
    '--preview-scale': String(scale),
    '--preview-box-height': `${Math.round(h * scale)}px`,
  };
}
```

**Step 4: Run the test to verify it passes**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Admin/Preview/previewFrame.test.js
```

Expected: PASS, 5 tests.

**Step 5: Commit**

```bash
git add frontend/src/modules/Admin/Preview/previewFrame.js frontend/src/modules/Admin/Preview/previewFrame.test.js
git commit -m "feat(admin-preview): add screen-resolution frame geometry"
```

---

## Task 3: `usePreviewScreens` hook

**Files:**
- Create: `frontend/src/modules/Admin/Preview/usePreviewScreens.js`
- Test: `frontend/src/modules/Admin/Preview/usePreviewScreens.test.jsx`

**Step 1: Write the failing test**

Create `frontend/src/modules/Admin/Preview/usePreviewScreens.test.jsx`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const daylightAPI = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => daylightAPI(...args) }));
vi.mock('../../../lib/logging/Logger.js', () => {
  const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => logger };
  return { default: () => logger };
});

import { usePreviewScreens, FALLBACK_SCREEN } from './usePreviewScreens.js';

describe('usePreviewScreens', () => {
  beforeEach(() => { daylightAPI.mockReset(); });

  it('returns only screens that declare a usable resolution', async () => {
    daylightAPI.mockResolvedValue({ screens: [
      { id: 'living-room', name: 'Living Room', resolution: { width: 960, height: 540 } },
      { id: 'kitchen-eink', name: 'Kitchen', resolution: null },
      { id: 'office', name: 'Office', resolution: { width: 1280, height: 720 } },
    ] });

    const { result } = renderHook(() => usePreviewScreens());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.screens.map((s) => s.id)).toEqual(['living-room', 'office']);
  });

  it('falls back to a generic screen when the API returns nothing sized', async () => {
    daylightAPI.mockResolvedValue({ screens: [{ id: 'kitchen-eink', name: 'Kitchen', resolution: null }] });

    const { result } = renderHook(() => usePreviewScreens());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.screens).toEqual([FALLBACK_SCREEN]);
  });

  it('falls back rather than throwing when the request fails', async () => {
    daylightAPI.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => usePreviewScreens());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.screens).toEqual([FALLBACK_SCREEN]);
  });

  it('ships a fallback that is generic, never a household screen id', () => {
    expect(FALLBACK_SCREEN.resolution).toEqual({ width: 1280, height: 720 });
    expect(FALLBACK_SCREEN.id.startsWith('__')).toBe(true);
  });
});
```

**Step 2: Run the test to verify it fails**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Admin/Preview/usePreviewScreens.test.jsx
```

Expected: FAIL — `Failed to resolve import "./usePreviewScreens.js"`.

**Step 3: Write the implementation**

Create `frontend/src/modules/Admin/Preview/usePreviewScreens.js`:

```javascript
import { useState, useEffect } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'preview-screens' });
  return _logger;
}

/**
 * Used until (or unless) the screens API answers with something sized.
 * Deliberately generic — the preview must never hardcode a household screen id.
 */
export const FALLBACK_SCREEN = Object.freeze({
  id: '__fallback',
  name: '1280 x 720',
  resolution: { width: 1280, height: 720 },
});

/**
 * usePreviewScreens
 * -----------------
 * Loads the screens that can be previewed — i.e. those that declare a
 * CSS-pixel `resolution`. An e-ink panel with no `resolution` has no scale to
 * imitate, so it is filtered out rather than previewed at a guessed size.
 *
 * @returns {{screens: Array<{id: string, name: string, resolution: {width: number, height: number}}>, loading: boolean}}
 */
export function usePreviewScreens() {
  const [screens, setScreens] = useState([FALLBACK_SCREEN]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    DaylightAPI('api/v1/screens')
      .then((data) => {
        if (cancelled) return;
        const sized = (data?.screens || []).filter(
          (s) => Number.isFinite(s?.resolution?.width) && Number.isFinite(s?.resolution?.height)
        );
        logger().debug('screens-loaded', { total: data?.screens?.length || 0, sized: sized.length });
        setScreens(sized.length ? sized : [FALLBACK_SCREEN]);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        logger().warn('screens-load-failed', { message: err?.message });
        setScreens([FALLBACK_SCREEN]);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return { screens, loading };
}

export default usePreviewScreens;
```

**Step 4: Run the test to verify it passes**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Admin/Preview/usePreviewScreens.test.jsx
```

Expected: PASS, 4 tests.

**Step 5: Commit**

```bash
git add frontend/src/modules/Admin/Preview/usePreviewScreens.js frontend/src/modules/Admin/Preview/usePreviewScreens.test.jsx
git commit -m "feat(admin-preview): load previewable screens and their resolutions"
```

---

## Task 4: Drive the preview frame from CSS custom properties

**Files:**
- Modify: `frontend/src/modules/Admin/Preview/AdminPreviewPlayer.scss:1-21`

**Step 1: Rewrite the frame rules**

Replace lines 1-21 of `frontend/src/modules/Admin/Preview/AdminPreviewPlayer.scss` with:

```scss
.admin-preview-player {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* The VISIBLE box: fixed width, height derived from the target screen's own
   aspect ratio. A hardcoded 540px forced every screen to 16:9 and cropped the
   16:10 portal panel. */
.admin-preview-player__video {
  width: var(--preview-width, 960px);
  height: var(--preview-box-height, 540px);
  position: relative;
  background: #000;
  overflow: hidden;
  border-radius: var(--mantine-radius-sm);
}

/* The LAYOUT box is the target screen's CSS-pixel resolution exactly, then
   zoomed to fit the visible box. This is what makes the preview honest: the
   Player is sized entirely in rem against an unmodified 16px root, so type
   only occupies the right fraction of the frame when the frame has the same
   number of CSS px the kiosk has. The old hardcoded 1920x1080 @ zoom 0.5 was
   the right visual size at the wrong layout size, which rendered every glyph
   2x small against a 960x540 screen. See previewFrame.js. */
.admin-preview-player__video-inner {
  width: var(--preview-screen-width, 1280px);
  height: var(--preview-screen-height, 720px);
  zoom: var(--preview-scale, 0.75);
  transform-origin: 0 0;
}
```

Leave the rest of the file (`__queue-bar` and below) untouched.

**Step 2: Verify the SCSS compiles**

```bash
npx sass --no-source-map frontend/src/modules/Admin/Preview/AdminPreviewPlayer.scss /dev/null
```

Expected: no output (success). If `sass` is unavailable, skip — Task 5's build/dev-server run will surface any syntax error.

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/Preview/AdminPreviewPlayer.scss
git commit -m "refactor(admin-preview): drive the preview frame from CSS custom properties"
```

---

## Task 5: Wire the screen selection into `AdminPreviewPlayer`

**Files:**
- Modify: `frontend/src/modules/Admin/Preview/AdminPreviewPlayer.jsx`
- Test: `frontend/src/modules/Admin/Preview/AdminPreviewPlayer.test.jsx` (new)

**Step 1: Write the failing test**

Create `frontend/src/modules/Admin/Preview/AdminPreviewPlayer.test.jsx`:

```javascript
// AdminPreviewPlayer.test.jsx — pins the frame geometry, not the media stack.
// The Player is stubbed: what matters here is that the preview surface adopts
// the SELECTED screen's CSS-pixel resolution as its layout size.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const daylightAPI = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...args) => daylightAPI(...args),
  DaylightMediaPath: (p) => p,
}));
vi.mock('../../../lib/logging/Logger.js', () => {
  const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => logger };
  return { default: () => logger };
});
vi.mock('../../Player/Player.jsx', () => ({ default: () => <div data-testid="player-stub" /> }));

import AdminPreviewPlayer from './AdminPreviewPlayer.jsx';

const SCREENS = { screens: [
  { id: 'living-room', name: 'Living Room', resolution: { width: 960, height: 540 } },
  { id: 'portal', name: 'Portal', resolution: { width: 1280, height: 800 } },
] };

function renderPreview() {
  return render(
    <MantineProvider>
      <AdminPreviewPlayer contentId="singalong:hymn/277" action="Play" onClose={vi.fn()} />
    </MantineProvider>
  );
}

describe('AdminPreviewPlayer frame', () => {
  beforeEach(() => {
    daylightAPI.mockReset();
    daylightAPI.mockResolvedValue(SCREENS);
    window.localStorage.clear();
  });

  it('lays the preview out at the first screen resolution, not a hardcoded 1920', async () => {
    const { container } = renderPreview();

    await waitFor(() => {
      const inner = container.querySelector('.admin-preview-player__video-inner');
      expect(inner).toBeTruthy();
    });
    const root = container.querySelector('.admin-preview-player');
    expect(root.style.getPropertyValue('--preview-screen-width')).toBe('960px');
    expect(root.style.getPropertyValue('--preview-scale')).toBe('1');
    expect(root.style.getPropertyValue('--preview-box-height')).toBe('540px');
  });

  it('re-scales when a different screen is chosen', async () => {
    const { container } = renderPreview();
    await waitFor(() => expect(screen.getByLabelText('Preview at screen')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Preview at screen'), { target: { value: 'portal' } });

    await waitFor(() => {
      const root = container.querySelector('.admin-preview-player');
      expect(root.style.getPropertyValue('--preview-screen-width')).toBe('1280px');
      expect(root.style.getPropertyValue('--preview-scale')).toBe('0.75');
      expect(root.style.getPropertyValue('--preview-box-height')).toBe('600px');
    });
  });

  it('remembers the chosen screen across mounts', async () => {
    const first = renderPreview();
    await waitFor(() => expect(screen.getByLabelText('Preview at screen')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Preview at screen'), { target: { value: 'portal' } });
    await waitFor(() => expect(window.localStorage.getItem('daylight.adminPreview.screenId')).toBe('portal'));
    first.unmount();

    const { container } = renderPreview();

    await waitFor(() => {
      const root = container.querySelector('.admin-preview-player');
      expect(root.style.getPropertyValue('--preview-screen-width')).toBe('1280px');
    });
  });
});
```

**Step 2: Run the test to verify it fails**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Admin/Preview/AdminPreviewPlayer.test.jsx
```

Expected: FAIL — no `--preview-screen-width` on the root, and no "Preview at screen" control.

**Step 3: Write the implementation**

In `frontend/src/modules/Admin/Preview/AdminPreviewPlayer.jsx`:

Add to the imports at the top:

```javascript
import { NativeSelect } from '@mantine/core';
import { previewFrameVars } from './previewFrame.js';
import { usePreviewScreens, FALLBACK_SCREEN } from './usePreviewScreens.js';
```

Add above the component:

```javascript
const STORAGE_KEY = 'daylight.adminPreview.screenId';

function readStoredScreenId() {
  try { return window.localStorage.getItem(STORAGE_KEY) || null; } catch { return null; }
}
function writeStoredScreenId(id) {
  try { window.localStorage.setItem(STORAGE_KEY, id); } catch { /* private mode — selection just won't persist */ }
}
```

Inside the component, immediately after the existing `const activeRef = useRef(null);`:

```javascript
  // Which real screen this preview is imitating. The Player is sized entirely
  // in rem, so the ONLY thing that makes the preview match the kiosk is laying
  // out in the same number of CSS px the kiosk has.
  const { screens } = usePreviewScreens();
  const [screenId, setScreenId] = useState(readStoredScreenId);

  const activeScreen = useMemo(
    () => screens.find((s) => s.id === screenId) || screens[0] || FALLBACK_SCREEN,
    [screens, screenId]
  );
  const frameVars = useMemo(
    () => previewFrameVars(activeScreen.resolution) || previewFrameVars(FALLBACK_SCREEN.resolution),
    [activeScreen]
  );

  const handleScreenChange = useCallback((event) => {
    const id = event.currentTarget.value;
    setScreenId(id);
    writeStoredScreenId(id);
  }, []);

  const screenPicker = (
    <NativeSelect
      size="xs"
      label="Preview at screen"
      value={activeScreen.id}
      onChange={handleScreenChange}
      data={screens.map((s) => ({
        value: s.id,
        label: `${s.name} — ${s.resolution.width}x${s.resolution.height}`,
      }))}
    />
  );
```

Then apply `frameVars` and the picker in both render paths.

Play mode (currently lines 54-66) becomes:

```javascript
    return (
      <div className="admin-preview-player" style={frameVars}>
        {screenPicker}
        <div className="admin-preview-player__video">
          <div className="admin-preview-player__video-inner">
            <Player
              play={mediaConfig}
              clear={onClose}
              playerType="preview"
            />
          </div>
        </div>
      </div>
    );
```

Queue mode (currently line 84) — change the opening element to:

```javascript
    <div className="admin-preview-player" style={frameVars}>
      {screenPicker}
      <div className="admin-preview-player__video">
```

leaving the rest of that JSX unchanged.

> The three early returns above (`error`, loading, empty queue) render bare `<div>`s and need no frame — leave them.

**Step 4: Run the test to verify it passes**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Admin/Preview/AdminPreviewPlayer.test.jsx
```

Expected: PASS, 3 tests.

**Step 5: Run the whole colocated frontend suite for regressions**

```bash
npm run test:isolated -- --only=frontend
```

Expected: PASS, no new failures.

**Step 6: Commit**

```bash
git add frontend/src/modules/Admin/Preview/AdminPreviewPlayer.jsx frontend/src/modules/Admin/Preview/AdminPreviewPlayer.test.jsx
git commit -m "fix(admin-preview): render at the target screen's CSS-pixel scale

The preview hardcoded a 1920x1080 layout box at zoom 0.5. Because every
dimension in the Player is rem against an unmodified 16px root, that rendered
type at half the fraction of the frame a 960x540 screen shows and two thirds
of a 1280-wide one. Lay out at the selected screen's exact resolution instead
and zoom to fit."
```

---

## Task 6: Live geometry verification

Proves the invariant end-to-end in a real browser: **layout width equals the screen resolution, visual width equals the preview surface.**

**Files:**
- Create: `tests/live/flow/admin/preview-player-scale.runtime.test.mjs`

**Step 1: Check the dev server is up before writing anything**

```bash
lsof -i :3111
```

If nothing is listening, start it: `npm run dev` (see CLAUDE.md → Dev Workflow). Do not proceed without it.

**Step 2: Write the spec**

Create `tests/live/flow/admin/preview-player-scale.runtime.test.mjs`:

```javascript
// preview-player-scale.runtime.test.mjs
//
// The admin preview must lay out at the SELECTED screen's CSS-pixel resolution
// and zoom that box down to the 960px surface. Verified as two reads that
// disagree by exactly the zoom factor:
//   offsetWidth            -> unzoomed layout px  (== resolution.width)
//   getBoundingClientRect  -> zoomed visual px    (== 960)
// Confirmed Chromium behaviour, not an assumption.
import { test, expect } from '@playwright/test';

test('preview lays out at the selected screen resolution and zooms to 960px', async ({ page }) => {
  await page.goto('/admin/content/lists/menus/fhe', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForSelector('.item-row:not(.empty-row)', { timeout: 10000 });

  await page.locator('.col-preview .mantine-ActionIcon-root').first().click();
  await expect(page.locator('.mantine-Modal-overlay:visible')).toBeVisible({ timeout: 5000 });

  const picker = page.getByLabel('Preview at screen');
  await expect(picker).toBeVisible({ timeout: 5000 });

  // Every previewable screen must hold the invariant, not just the default.
  const optionValues = await picker.locator('option').evaluateAll((opts) => opts.map((o) => o.value));
  expect(optionValues.length).toBeGreaterThan(0);

  for (const value of optionValues) {
    await picker.selectOption(value);

    const geometry = await page.evaluate(() => {
      const inner = document.querySelector('.admin-preview-player__video-inner');
      const box = document.querySelector('.admin-preview-player__video');
      const cs = getComputedStyle(document.querySelector('.admin-preview-player'));
      return {
        layoutWidth: inner.offsetWidth,
        layoutHeight: inner.offsetHeight,
        visualWidth: Math.round(inner.getBoundingClientRect().width),
        boxWidth: Math.round(box.getBoundingClientRect().width),
        declaredWidth: parseFloat(cs.getPropertyValue('--preview-screen-width')),
        declaredHeight: parseFloat(cs.getPropertyValue('--preview-screen-height')),
      };
    });

    // Layout box IS the screen's resolution — this is what fixes rem-sized type.
    expect(geometry.layoutWidth).toBe(geometry.declaredWidth);
    expect(geometry.layoutHeight).toBe(geometry.declaredHeight);
    // ...rendered down to the 960px surface.
    expect(geometry.visualWidth).toBe(960);
    expect(geometry.boxWidth).toBe(960);
  }

  await page.screenshot({ path: 'test-results/preview-player-scale.png' });
});
```

**Step 3: Run it**

```bash
npx playwright test tests/live/flow/admin/preview-player-scale.runtime.test.mjs --reporter=line
```

Expected: PASS. If the `/admin/content/lists/menus/fhe` route or the first preview button does not exist in this household's data, substitute a list route that does — do **not** weaken the assertions or wrap them in a conditional.

**Step 4: Eyeball the screenshot against production**

Open `test-results/preview-player-scale.png` and compare the hymn body type to the kiosk. At the living-room selection the rendered `.singalong-text` should measure 32px, not 16px:

```bash
npx playwright test tests/live/flow/admin/preview-player-scale.runtime.test.mjs --headed --reporter=line
```

**Step 5: Commit**

```bash
git add tests/live/flow/admin/preview-player-scale.runtime.test.mjs
git commit -m "test(admin-preview): pin the layout-vs-visual scale invariant"
```

---

## Task 7: Delete the dead duplicate ContentScroller stylesheet

`frontend/src/modules/Player/ContentScroller.scss` is imported by nothing — the live sheet is `frontend/src/modules/Player/styles/ContentScroller.scss` (imported at `renderers/ContentScroller.jsx:10`). The dead copy carries `font-size: 3rem` for `.hymn-text` where the live one has `2rem`, so editing the wrong file produces a change that never takes effect.

**Files:**
- Delete: `frontend/src/modules/Player/ContentScroller.scss`

**Step 1: Confirm it is unreferenced**

```bash
grep -rn "Player/ContentScroller.scss\|'\./ContentScroller.scss'\|\"\./ContentScroller.scss\"" frontend/src backend/src | grep -v node_modules
```

Expected: **zero hits.** If anything references it, stop and re-scope this task.

**Step 2: Delete it**

```bash
git rm frontend/src/modules/Player/ContentScroller.scss
```

If `git rm` is permission-blocked, per CLAUDE.md move it instead:

```bash
mkdir -p _deleteme && mv frontend/src/modules/Player/ContentScroller.scss _deleteme/
```

**Step 3: Verify the frontend still builds**

```bash
cd frontend && npx vite build --logLevel error
```

Expected: build succeeds.

**Step 4: Commit**

```bash
git add -A frontend/src/modules/Player
git commit -m "chore(player): drop the unreferenced duplicate ContentScroller stylesheet"
```

---

## Task 8: Correct two misleading comments

Both are comment-only. Neither changes rendering — that is the point: the code is right (or harmlessly inert) and the comments send readers down blind alleys.

**Files:**
- Modify: `frontend/src/modules/Player/renderers/SingalongScroller.jsx:78`
- Modify: `frontend/src/modules/Player/renderers/ReadalongScroller.jsx:126`
- Modify: `frontend/src/modules/Player/styles/ContentScroller.scss:237`

**Step 1: Mark the inert style variables**

`--font-size` and `--font-family` are consumed by **no** CSS rule anywhere; `--color`, `--text-align` and `--background` are read only by `.poetry-text`. So on a singalong, `data.style.fontSize` has no effect — and `SingalongAdapter._getDefaultStyle()` hardcodes `'1.4rem'` with no per-item override path, so wiring it up would silently shrink every hymn from 2rem to 1.4rem. Leave the behaviour alone; label the trap.

In `SingalongScroller.jsx`, replace the comment on line 78 (`// Apply style as CSS variables`) with:

```javascript
  // Apply style as CSS variables.
  //
  // NOTE: for singalong these are inert. No rule reads --font-size or
  // --font-family, and only `.poetry-text` reads --color/--text-align/
  // --background. Hymn size comes from `.hymn-text, .singalong-text
  // { font-size: 2rem }` in styles/ContentScroller.scss. Do not "fix" this by
  // wiring --font-size through: SingalongAdapter._getDefaultStyle() hardcodes
  // 1.4rem with no per-item override, so every hymn would shrink 30%.
```

Apply the same note (adjusted to `readalong`) above the `cssVars` block at `ReadalongScroller.jsx:126`.

**Step 2: Correct the padding comment**

In `styles/ContentScroller.scss`, line 237 currently reads:

```scss
    padding-bottom: calc(0.2 * var(--textpanel-height)); // 60% of .textpanel height
```

The value is fine — it scales proportionally with the frame, which is why the preview fix does not disturb it. The comment is wrong twice: it is 20%, not 60%, and percentage padding resolves against the container's **inline size (width)**, never its height. Replace the trailing comment:

```scss
    // 20% of this block's WIDTH — percentage padding always resolves against
    // inline size, never height, despite the --textpanel-height name. It is the
    // run-out space the scroller needs past the last stanza; it scales with the
    // frame, so it is correct at every screen resolution.
    padding-bottom: calc(0.2 * var(--textpanel-height));
```

**Step 3: Verify nothing rendered changed**

```bash
npm run test:isolated -- --only=frontend
```

Expected: PASS, identical counts to Task 5 Step 5.

**Step 4: Commit**

```bash
git add frontend/src/modules/Player/renderers/SingalongScroller.jsx frontend/src/modules/Player/renderers/ReadalongScroller.jsx frontend/src/modules/Player/styles/ContentScroller.scss
git commit -m "docs(player): label the inert style vars and fix the padding comment"
```

---

## Task 9: Centre hymn and singalong text

> **Production-visible.** This is not part of the preview mismatch — it reproduces identically on the kiosk, and fixing it changes what the living room sees on every hymn. KC has approved folding it in; still verify on the actual screen before merging.

`useCenterByWidest` measures each `.stanza` with `offsetWidth` and centres the block on the widest one. `.stanza` is a plain block `div`, so it always measures the **full container width** — `maxWidth` comes back equal to the panel width, `marginLeft` collapses to ~16px, and every hymn renders flush left. Poetry works only because `.poetry-text > div { display: inline-block; }` (`styles/ContentScroller.scss:285-288`) shrink-wraps its stanzas; hymn and singalong never got an equivalent rule.

Two parts: shrink-wrap the stanzas so the measurement is real, and stop the hook losing half of `.scrolled-content`'s `padding-left` off the centre.

**Files:**
- Modify: `frontend/src/modules/Player/styles/ContentScroller.scss:235-251`
- Modify: `frontend/src/lib/Player/useCenterByWidest.js:64-67`
- Test: `frontend/src/lib/Player/useCenterByWidest.test.jsx` (new)
- Test: `tests/live/flow/admin/preview-player-centering.runtime.test.mjs` (new)

**Step 1: Write the failing unit test for the padding offset**

jsdom has no layout engine, so `offsetWidth` is always 0 — the test stubs it. This pins the hook's *arithmetic*; the CSS half of the fix is proven in Step 6 by a real browser.

Create `frontend/src/lib/Player/useCenterByWidest.test.jsx`:

```javascript
// useCenterByWidest.test.jsx — the centring arithmetic, with layout stubbed.
//
// jsdom reports offsetWidth 0 for everything, so each element gets a defined
// getter. What is under test is the margin the hook computes, not the browser's
// layout: the panel is the full frame, but the content sits inside
// `.scrolled-content`'s padding-left, so centring on the raw panel width parks
// the text half a padding to the left of true centre.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { useCenterByWidest } from './useCenterByWidest.js';

function stubWidth(el, width) {
  Object.defineProperty(el, 'offsetWidth', { value: width, configurable: true });
}

function Harness({ panelWidth, paddingLeft, stanzaWidth, onReady }) {
  const ref = (node) => {
    if (!node || node.dataset.stubbed) return;
    node.dataset.stubbed = '1';
    stubWidth(node, stanzaWidth);
    node.querySelectorAll('.stanza').forEach((s) => stubWidth(s, stanzaWidth));
    const panel = node.closest('.textpanel');
    stubWidth(panel, panelWidth);
    const scrolled = node.closest('.scrolled-content');
    scrolled.style.paddingLeft = `${paddingLeft}px`;
    onReady(node);
  };
  return (
    <div className="textpanel">
      <div className="scrolled-content">
        <Centred innerRef={ref} />
      </div>
    </div>
  );
}

function Centred({ innerRef }) {
  const ref = { current: null };
  const attach = (node) => { ref.current = node; if (node) innerRef(node); };
  useCenterByWidest(ref, [], { observeResize: false });
  return (
    <div className="singalong-text" ref={attach}>
      <div className="stanza"><p>As I search the holy scriptures,</p></div>
    </div>
  );
}

describe('useCenterByWidest', () => {
  it('centres on the content box, not the raw panel width', () => {
    let el = null;
    render(<Harness panelWidth={960} paddingLeft={32} stanzaWidth={400} onReady={(n) => { el = n; }} />);

    // Content box is 960 - 32 = 928 wide. Centring a 400px block in it leaves
    // 264px each side. Centring on the raw 960 would give 280 and push the
    // text 16px (half the padding) left of centre.
    expect(el.style.marginLeft).toBe('264px');
  });

  it('never computes a negative margin when the text overflows the panel', () => {
    let el = null;
    render(<Harness panelWidth={400} paddingLeft={32} stanzaWidth={900} onReady={(n) => { el = n; }} />);

    expect(el.style.marginLeft).toBe('0px');
  });
});
```

**Step 2: Run the test to verify it fails**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/lib/Player/useCenterByWidest.test.jsx
```

Expected: FAIL on the first case — `marginLeft` is `280px`, not `264px`.

**Step 3: Subtract the scroller padding in the hook**

In `frontend/src/lib/Player/useCenterByWidest.js`, replace lines 64-67:

```javascript
        const panelWidth = panel.offsetWidth;
        const diff = panelWidth - maxWidth;
        const marginLeft = Math.max(0, diff / 2);
        currentEl.style.marginLeft = `${marginLeft}px`;
```

with:

```javascript
        // Centre on the CONTENT box, not the panel. `.scrolled-content` carries
        // a padding-left the text already starts after, so centring on the raw
        // panel width parks every block half a padding left of true centre.
        const scrolled = currentEl.closest('.scrolled-content');
        const padLeft = scrolled ? parseFloat(getComputedStyle(scrolled).paddingLeft) || 0 : 0;
        const panelWidth = panel.offsetWidth - padLeft;
        const diff = panelWidth - maxWidth;
        const marginLeft = Math.max(0, diff / 2);
        currentEl.style.marginLeft = `${marginLeft}px`;
```

Also update the `log('recalc', ...)` call two lines below to carry the new value:

```javascript
        log('recalc', { phase, maxWidth, panelWidth, padLeft, marginLeft });
```

**Step 4: Run the test to verify it passes**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/lib/Player/useCenterByWidest.test.jsx
```

Expected: PASS, 2 tests.

**Step 5: Shrink-wrap the stanzas**

In `frontend/src/modules/Player/styles/ContentScroller.scss`, inside the `.content-scroller.hymn, .content-scroller.singalong` block, add to the `.hymn-text, .singalong-text` rule (alongside the existing `.stanza { margin-bottom: 1.5rem; ... }`):

```scss
    .stanza {
      // Shrink-wrap so useCenterByWidest measures the natural line width rather
      // than the full container — a block-level stanza always reports the
      // container width, which made the centring a no-op and left every hymn
      // flush left. Deliberately NOT `display: inline-block`, which is what
      // `.poetry-text > div` uses: inline-block stanzas flow side by side
      // whenever two fit on a row. A shrink-wrapped block still stacks.
      width: fit-content;
      margin-bottom: 1.5rem;
      p { ... }        // leave the existing p rules untouched
    }
```

i.e. add the comment and the single `width: fit-content;` line to the existing `.stanza` rule. Change nothing else.

**Step 6: Verify centring in a real browser**

jsdom cannot prove the CSS half. Create `tests/live/flow/admin/preview-player-centering.runtime.test.mjs`:

```javascript
// preview-player-centering.runtime.test.mjs
//
// `.stanza` was a block div, so useCenterByWidest measured the full container
// width and every hymn rendered flush left. Proves the shrink-wrap: the text
// block's centre must land on the content box's centre.
import { test, expect } from '@playwright/test';

test('singalong stanzas centre in the text panel', async ({ page }) => {
  await page.goto('/admin/content/lists/menus/fhe', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForSelector('.item-row:not(.empty-row)', { timeout: 10000 });

  // Find a singalong/hymn row by its input, not by index. If this household's
  // list has none, the test FAILS — point it at a list that does rather than
  // weakening the assertion.
  const row = page.locator('.item-row', { hasText: /^\s*(singalong|hymn):/ }).first();
  await expect(row).toBeVisible({ timeout: 5000 });
  await row.locator('.col-preview .mantine-ActionIcon-root').click();

  await expect(page.locator('.mantine-Modal-overlay:visible')).toBeVisible({ timeout: 5000 });
  await page.waitForSelector('.singalong-text .stanza', { timeout: 15000 });
  // Let the rAF re-measure and any font load settle.
  await page.waitForTimeout(1000);

  const offset = await page.evaluate(() => {
    const text = document.querySelector('.singalong-text');
    const panel = text.closest('.textpanel');
    const scrolled = text.closest('.scrolled-content');
    const padLeft = parseFloat(getComputedStyle(scrolled).paddingLeft) || 0;

    const t = text.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const contentLeft = p.left + padLeft;
    const contentCentre = contentLeft + (p.width - padLeft) / 2;
    return {
      delta: Math.abs((t.left + t.width / 2) - contentCentre),
      textWidth: t.width,
      panelWidth: p.width,
    };
  });

  // The block must be narrower than the panel — if it still spans the full
  // width, the shrink-wrap did not take and "centred" would be vacuously true.
  expect(offset.textWidth).toBeLessThan(offset.panelWidth * 0.95);
  expect(offset.delta).toBeLessThanOrEqual(2);

  await page.screenshot({ path: 'test-results/preview-player-centering.png' });
});
```

Run it:

```bash
npx playwright test tests/live/flow/admin/preview-player-centering.runtime.test.mjs --reporter=line
```

Expected: PASS.

**Step 7: Check nothing else regressed**

`useCenterByWidest` is shared with poetry via `ReadalongScroller`. Confirm poetry still centres:

```bash
npm run test:isolated -- --only=frontend
npx playwright test tests/live/flow/admin/ --reporter=line
```

Expected: PASS, no new failures.

**Step 8: Verify on the actual kiosk**

Play a hymn on the living-room screen and confirm the text is centred and unwrapped. Report what you saw — this step is not optional and cannot be satisfied by the preview.

**Step 9: Commit**

```bash
git add frontend/src/modules/Player/styles/ContentScroller.scss frontend/src/lib/Player/useCenterByWidest.js frontend/src/lib/Player/useCenterByWidest.test.jsx tests/live/flow/admin/preview-player-centering.runtime.test.mjs
git commit -m "fix(player): centre hymn and singalong text

useCenterByWidest measured block-level stanzas, which always report the full
container width, so the centring was a no-op and every hymn rendered flush
left. Shrink-wrap the stanzas so the measurement is real, and centre on the
content box so the scroller's padding-left does not pull the block off centre."
```

---

## Task 10: Document the resolution contract

**Files:**
- Modify: `docs/reference/screen-configs.md`
- Modify: `docs/reference/admin-components.md`

**Step 1: Add a resolution section to `screen-configs.md`**

Append a section:

```markdown
## `resolution` — the screen's CSS-pixel box

```yaml
resolution:
  width: 960
  height: 540
```

`ScreenRenderer` gives `.screen-root` this size in **CSS pixels** and never
scales it — the box is centred in the viewport and clipped. So `resolution` must
match the device's real CSS viewport, not its physical panel: a 1080p kiosk at
`devicePixelRatio: 2` reports a 960x540 CSS viewport and must declare 960x540.

This value is load-bearing for type size. Everything in the Player and
ContentScroller is sized in `rem` against an unmodified 16px root, so how large
text *looks* is a pure function of how many CSS px wide the box is — 2rem type
is 3.33% of a 960px frame and 2.5% of a 1280px one. Get `resolution` wrong and
every glyph on that screen is proportionally wrong.

Confirm a screen's real viewport from the `screen.viewport` log event, which
`ScreenRenderer` emits once per mount with `cssWidth`, `cssHeight` and `dpr`.

`GET /api/v1/screens` returns `{ screens: [{ id, name, resolution }] }`;
`resolution` is `null` for a screen that declares none (e-ink panels), and such
screens are not offered in the admin preview.
```

**Step 2: Add a preview note to `admin-components.md`**

Append under a new `## Preview Player` heading:

```markdown
## Preview Player

`AdminPreviewPlayer` (`frontend/src/modules/Admin/Preview/`) mounts the real
`Player` inside the admin UI so a list entry can be checked without walking to
the kiosk.

Its frame imitates a chosen screen rather than picking a convenient size. The
inner box is laid out at that screen's exact `resolution` in CSS px and then
`zoom`ed down to the 960px preview surface (`previewFrame.js`). That is the only
way the preview can be trusted for type size: the Player is sized entirely in
`rem` against an unmodified 16px root, so it renders honestly only inside a box
with the same CSS-pixel count the kiosk has.

Note the two coordinate spaces when debugging: under `zoom`, `offsetWidth` and
`clientHeight` report **unzoomed layout px** while `getBoundingClientRect()`
reports **zoomed visual px**. `tests/live/flow/admin/preview-player-scale.runtime.test.mjs`
pins that relationship.

The selected screen persists in `localStorage` under
`daylight.adminPreview.screenId`.
```

**Step 3: Record the two gotchas in the player lessons doc**

Append to `docs/reference/player/lessons-and-gotchas.md`:

```markdown
## Type size is a function of the frame's CSS-pixel width

Nothing in the Player or ContentScroller uses a viewport-relative unit — it is
`rem` throughout, against a root font-size no stylesheet overrides. So 2rem type
is 3.33% of a 960px frame and 1.67% of a 1920px one. Any surface that hosts the
Player has to give it the same CSS-pixel box the kiosk has, or every glyph is
proportionally wrong. `zoom` on an outer wrapper fixes the *visual* size while
leaving the *layout* size wrong, which is exactly the trap the admin preview fell
into.

When debugging under `zoom`, note the two coordinate spaces: `offsetWidth` and
`clientHeight` report unzoomed layout px, `getBoundingClientRect()` reports zoomed
visual px.

## `useCenterByWidest` needs shrink-wrapped stanzas

The hook centres a text block on its widest `.stanza`, measured with
`offsetWidth`. A block-level stanza always reports the full container width, so
the measurement returns the container and the centring is a silent no-op — which
is what left every hymn flush left until `width: fit-content` was added. Use
`width: fit-content`, not `display: inline-block`: inline-block stanzas flow side
by side whenever two fit on a row.
```

**Step 4: Update the docs freshness marker**

```bash
git rev-parse HEAD > docs/docs-last-updated.txt
```

**Step 5: Commit**

```bash
git add docs/reference/screen-configs.md docs/reference/admin-components.md docs/reference/player/lessons-and-gotchas.md docs/docs-last-updated.txt
git commit -m "docs: record the screen resolution contract and preview scaling"
```

---

## What is deliberately NOT in this plan

- **Wiring `--font-size` through to the CSS.** `SingalongAdapter._getDefaultStyle()` hardcodes `'1.4rem'` with no per-item override path, so making `.singalong-text` read `var(--font-size)` would shrink every hymn from 2rem to 1.4rem. Task 8 labels the trap instead of building a feature nobody asked for.
- **Scaling the root font-size.** Nothing overrides `html { font-size }` anywhere in the app, and adding a viewport-relative root would move every other surface. The frame is the right lever.
- **Changing the `padding-bottom: calc(0.2 * ...)` value.** It scales proportionally with the frame, so it is already correct at every resolution. Only its comment was wrong (Task 8).

---

## Verification checklist

Run before declaring done, with output shown — not summarised:

```bash
npm run test:isolated -- --only=frontend
frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/screensList.test.mjs
npx playwright test tests/live/flow/admin/ --reporter=line
```

Plus the one check no harness can make: **play a hymn on the living-room screen** and confirm the text is centred, unwrapped, and the same size it was before Task 9. Report what you saw.
