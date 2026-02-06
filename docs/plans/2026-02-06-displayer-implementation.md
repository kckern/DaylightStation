# Displayer Component Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Art app with a generic Displayer module that renders any DisplayableItem content, supporting configurable display modes (default, art, poster, card).

**Architecture:** Displayer is a peer module to Player at `frontend/src/modules/Displayer/`. It receives a display prop (full data or `{ id }` to fetch), resolves config via cascade (item metadata -> URL params -> mode defaults), and delegates rendering to mode-specific sub-components. The Art app is fully removed.

**Tech Stack:** React (JSX), SCSS, Playwright (runtime tests)

**Design doc:** `docs/plans/2026-02-06-displayer-component-design.md`

---

### Task 1: Displayer Core Component

Create the main Displayer component that fetches data and delegates to mode renderers.

**Files:**
- Create: `frontend/src/modules/Displayer/Displayer.jsx`

**Step 1: Write the Displayer component**

```jsx
// frontend/src/modules/Displayer/Displayer.jsx
import { useState, useEffect, useCallback } from "react";
import { DaylightAPI } from "../../lib/api.mjs";
import "./Displayer.scss";

// Mode components (inline for now — extract to modes/ if they grow)
function DefaultMode({ data }) {
  return (
    <div className="displayer__default">
      <img src={data.imageUrl} alt={data.title || ''} />
    </div>
  );
}

function ArtMode({ data, frame }) {
  const [showOverlay, setShowOverlay] = useState(false);
  const frameClass = `displayer__frame displayer__frame--${frame || 'classic'}`;

  return (
    <div className={frameClass} onClick={() => setShowOverlay(prev => !prev)}>
      <div className="displayer__matte">
        <div className="displayer__inner-frame">
          <img src={data.imageUrl} alt={data.title || ''} />
        </div>
      </div>
      {showOverlay && (
        <div className="displayer__overlay">
          <h2 className="displayer__overlay-title">{data.title}</h2>
          {data.artist && <p className="displayer__overlay-artist">{data.artist}</p>}
          {data.year && <span className="displayer__overlay-year">{data.year}</span>}
        </div>
      )}
    </div>
  );
}

function PosterMode({ data }) {
  return (
    <div className="displayer__poster">
      <div className="displayer__poster-image">
        <img src={data.imageUrl} alt={data.title || ''} />
      </div>
      <div className="displayer__poster-info">
        <h2>{data.title}</h2>
        {data.artist && <p>{data.artist}</p>}
      </div>
    </div>
  );
}

function CardMode({ data }) {
  return (
    <div className="displayer__card">
      <div className="displayer__card-image">
        <img src={data.imageUrl} alt={data.title || ''} />
      </div>
      <div className="displayer__card-meta">
        <h2>{data.title}</h2>
        {data.artist && <p className="displayer__card-artist">{data.artist}</p>}
        {data.year && <span className="displayer__card-year">{data.year}</span>}
        {data.category && <span className="displayer__card-category">{data.category}</span>}
        {data.metadata?.location && <span className="displayer__card-location">{data.metadata.location}</span>}
        {data.metadata?.people?.length > 0 && (
          <span className="displayer__card-people">{data.metadata.people.join(', ')}</span>
        )}
      </div>
    </div>
  );
}

const MODE_COMPONENTS = {
  default: DefaultMode,
  art: ArtMode,
  poster: PosterMode,
  card: CardMode,
};

const MODE_FRAME_DEFAULTS = {
  default: 'none',
  art: 'classic',
  poster: 'none',
  card: 'none',
};

export default function Displayer({ display, onClose }) {
  const [data, setData] = useState(display?.imageUrl ? display : null);
  const [error, setError] = useState(null);

  // Resolve mode via cascade: display.mode -> mode default
  const mode = display?.mode || 'default';

  // Resolve frame via cascade: display.frame (URL) -> data.frameStyle (item) -> mode default
  const frame = display?.frame || data?.frameStyle || MODE_FRAME_DEFAULTS[mode] || 'none';

  // Fetch if only ID provided
  useEffect(() => {
    if (data?.imageUrl) return; // Already hydrated
    if (!display?.id) return;

    const fetchItem = async () => {
      try {
        const [source, ...rest] = display.id.split(':');
        const localId = rest.join(':');
        const result = await DaylightAPI(`/api/v1/info/${source}/${localId}`);
        setData(result);
      } catch (err) {
        setError(err.message);
      }
    };
    fetchItem();
  }, [display?.id, data?.imageUrl]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (error) return <div className="displayer displayer--error">{error}</div>;
  if (!data) return <div className="displayer displayer--loading">Loading...</div>;

  const ModeComponent = MODE_COMPONENTS[mode] || DefaultMode;

  return (
    <div className={`displayer displayer--${mode}`}>
      <ModeComponent data={data} frame={frame} />
    </div>
  );
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation && npx vite build --mode development 2>&1 | head -30`
Expected: No import errors for the new file (it's not imported anywhere yet, so build should pass unchanged)

**Step 3: Commit**

```bash
git add frontend/src/modules/Displayer/Displayer.jsx
git commit -m "feat: add Displayer component with mode support (default, art, poster, card)"
```

---

### Task 2: Displayer Styles

Migrate Art.scss styles into Displayer.scss with BEM naming under `.displayer` namespace.

**Files:**
- Create: `frontend/src/modules/Displayer/Displayer.scss`

**Step 1: Write the stylesheet**

Migrates all styles from `Art.scss` but renames `.art-*` classes to `.displayer__*` BEM convention. Adds base styles for default/poster/card modes.

```scss
// frontend/src/modules/Displayer/Displayer.scss

// ─── Base ──────────────────────────────────────────────────
.displayer {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1a1a;
  box-sizing: border-box;
  position: relative;
  cursor: pointer;
}

.displayer--loading,
.displayer--error {
  color: #666;
  font-size: 1.5rem;
}

// ─── Default Mode ──────────────────────────────────────────
.displayer__default {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;

  img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
}

// ─── Art Mode: Frame Variants ──────────────────────────────
.displayer__frame {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.displayer__frame--classic {
  background: linear-gradient(145deg, #3d3225, #2a2218);
  box-shadow:
    inset 2px 2px 4px rgba(255, 255, 255, 0.15),
    inset -2px -2px 4px rgba(0, 0, 0, 0.3);
  padding: 1%;

  .displayer__matte {
    background:
      url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E"),
      linear-gradient(165deg, #a89c84 0%, #998c74 50%, #8d7a6b 100%);
    background-blend-mode: soft-light, normal;
    box-shadow:
      inset 3px 3px 6px rgba(0, 0, 0, 0.15),
      inset -1px -1px 3px rgba(255, 255, 255, 0.8);
    padding: 5%;
  }

  .displayer__inner-frame {
    background: linear-gradient(145deg, #4a4035, #2d261f);
    padding: 0.4%;
    box-shadow:
      inset 1px 1px 2px rgba(255, 255, 255, 0.1),
      inset -1px -1px 2px rgba(0, 0, 0, 0.3),
      2px 2px 8px rgba(0, 0, 0, 0.2);
  }
}

.displayer__frame--minimal {
  background: #000;
  padding: 0.5%;

  .displayer__matte {
    background: #000;
    padding: 0;
  }

  .displayer__inner-frame {
    background: transparent;
    padding: 0;
    box-shadow: none;
  }
}

.displayer__frame--ornate {
  background: linear-gradient(145deg, #8b7355, #5c4a37);
  box-shadow:
    inset 3px 3px 6px rgba(255, 215, 0, 0.2),
    inset -3px -3px 6px rgba(0, 0, 0, 0.4),
    0 0 20px rgba(0, 0, 0, 0.5);
  padding: 2%;
  border: 4px solid #6b5344;

  .displayer__matte {
    background: linear-gradient(165deg, #f5f0e6 0%, #e8e0d0 100%);
    box-shadow:
      inset 4px 4px 8px rgba(0, 0, 0, 0.1),
      inset -2px -2px 4px rgba(255, 255, 255, 0.9);
    padding: 6%;
  }

  .displayer__inner-frame {
    background: linear-gradient(145deg, #8b7355, #5c4a37);
    padding: 0.5%;
    box-shadow:
      inset 2px 2px 4px rgba(255, 215, 0, 0.15),
      inset -2px -2px 4px rgba(0, 0, 0, 0.3);
  }
}

.displayer__frame--none {
  background: transparent;
  padding: 0;

  .displayer__matte {
    background: transparent;
    padding: 0;
    box-shadow: none;
  }

  .displayer__inner-frame {
    background: transparent;
    padding: 0;
    box-shadow: none;
  }
}

// ─── Art Mode: Common Elements ─────────────────────────────
.displayer__matte {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.displayer__inner-frame {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.displayer__frame img {
  height: 100%;
  width: auto;
  object-fit: contain;
  display: block;
  background: #2a2218;
}

// ─── Art Mode: Info Overlay ────────────────────────────────
.displayer__overlay {
  position: absolute;
  bottom: 10%;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.7);
  padding: 1rem 2rem;
  border-radius: 8px;
  text-align: center;
  animation: displayer-overlayFadeIn 0.3s ease-out;
}

.displayer__overlay-title {
  margin: 0;
  font-size: 1.5rem;
  color: #fff;
  font-weight: 300;
}

.displayer__overlay-artist {
  margin: 0.5rem 0 0;
  font-size: 1rem;
  color: #ccc;
  font-style: italic;
}

.displayer__overlay-year {
  display: inline-block;
  margin-top: 0.25rem;
  font-size: 0.875rem;
  color: #999;
}

@keyframes displayer-overlayFadeIn {
  from { opacity: 0; transform: translateX(-50%) translateY(10px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

// ─── Poster Mode ───────────────────────────────────────────
.displayer__poster {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.displayer__poster-image {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;

  img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
}

.displayer__poster-info {
  padding: 1rem 2rem;
  text-align: center;
  color: #fff;

  h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 300;
  }

  p {
    margin: 0.5rem 0 0;
    font-size: 1rem;
    color: #ccc;
  }
}

// ─── Card Mode ─────────────────────────────────────────────
.displayer__card {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2rem;
  padding: 2rem;
}

.displayer__card-image {
  flex: 0 1 60%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;

  img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
}

.displayer__card-meta {
  flex: 0 1 30%;
  color: #fff;

  h2 {
    margin: 0 0 1rem;
    font-size: 1.5rem;
    font-weight: 300;
  }
}

.displayer__card-artist,
.displayer__card-year,
.displayer__card-category,
.displayer__card-location,
.displayer__card-people {
  display: block;
  margin-top: 0.5rem;
  font-size: 0.9rem;
  color: #aaa;
}

.displayer__card-artist {
  font-style: italic;
  color: #ccc;
}
```

**Step 2: Verify build**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation && npx vite build --mode development 2>&1 | head -30`
Expected: Build passes (SCSS not yet imported by anything active)

**Step 3: Commit**

```bash
git add frontend/src/modules/Displayer/Displayer.scss
git commit -m "feat: add Displayer styles with art/poster/card mode variants"
```

---

### Task 3: Wire Displayer into MenuStack

Replace the ArtViewer lazy import and display case with Displayer.

**Files:**
- Modify: `frontend/src/modules/Menu/MenuStack.jsx:11` (ArtViewer import)
- Modify: `frontend/src/modules/Menu/MenuStack.jsx:185-190` (display case)

**Step 1: Update the import**

In `frontend/src/modules/Menu/MenuStack.jsx`, replace line 11:

```jsx
// BEFORE (line 11):
const ArtViewer = lazy(() => import('../AppContainer/Apps/Art/Art').then(m => ({ default: m.default })));

// AFTER:
const Displayer = lazy(() => import('../Displayer/Displayer').then(m => ({ default: m.default })));
```

**Step 2: Update the display case**

In `frontend/src/modules/Menu/MenuStack.jsx`, replace lines 185-190:

```jsx
// BEFORE:
case 'display':
  return (
    <Suspense fallback={<LoadingFallback />}>
      <ArtViewer item={props.display} onClose={clear} />
    </Suspense>
  );

// AFTER:
case 'display':
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Displayer display={props.display} onClose={clear} />
    </Suspense>
  );
```

**Step 3: Verify build compiles**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation && npx vite build --mode development 2>&1 | head -30`
Expected: Build passes. No references to Art.jsx remain in MenuStack.

**Step 4: Commit**

```bash
git add frontend/src/modules/Menu/MenuStack.jsx
git commit -m "feat: wire Displayer into MenuStack, replacing ArtViewer"
```

---

### Task 4: Extend TVApp Display Query Parsing

Add `mode` and `frame` to the config keys that TVApp extracts from URL params, so they flow into the display object.

**Files:**
- Modify: `frontend/src/Apps/TVApp.jsx:95` (configList array)

**Step 1: Add mode and frame to configList**

In `frontend/src/Apps/TVApp.jsx`, find the configList array (line 95):

```javascript
// BEFORE:
const configList = ["volume","shader","playbackRate","shuffle","continuous","repeat","loop","overlay","advance","interval"];

// AFTER:
const configList = ["volume","shader","playbackRate","shuffle","continuous","repeat","loop","overlay","advance","interval","mode","frame"];
```

This means `?display=canvas:sunset&mode=art&frame=ornate` produces:
```javascript
{ display: { id: 'canvas:sunset', mode: 'art', frame: 'ornate' } }
```

The `...config` spread in the display handler (line 192) already passes these through.

**Step 2: Verify build**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation && npx vite build --mode development 2>&1 | head -30`
Expected: Build passes.

**Step 3: Commit**

```bash
git add frontend/src/Apps/TVApp.jsx
git commit -m "feat: add mode and frame to TVApp display config params"
```

---

### Task 5: Remove Art App

Delete the Art app files and remove its registry entry.

**Files:**
- Delete: `frontend/src/modules/AppContainer/Apps/Art/Art.jsx`
- Delete: `frontend/src/modules/AppContainer/Apps/Art/Art.scss`
- Modify: `frontend/src/lib/appRegistry.js:10` (remove artIcon import)
- Modify: `frontend/src/lib/appRegistry.js:21` (remove art entry)

**Step 1: Delete Art app files**

```bash
rm frontend/src/modules/AppContainer/Apps/Art/Art.jsx
rm frontend/src/modules/AppContainer/Apps/Art/Art.scss
rmdir frontend/src/modules/AppContainer/Apps/Art
```

**Step 2: Remove art from appRegistry.js**

In `frontend/src/lib/appRegistry.js`, remove line 10 (artIcon import):

```javascript
// DELETE this line:
import artIcon from '../assets/app-icons/art.svg';
```

And remove line 21 (art entry from the registry object):

```javascript
// DELETE this line:
'art':             { label: 'Art',              icon: artIcon,            param: { name: 'path' }, component: () => import('../modules/AppContainer/Apps/Art/Art.jsx') },
```

**Step 3: Search for remaining Art references**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation && grep -r "Art\.jsx\|ArtViewer\|art-app\|Apps/Art" frontend/src/ --include="*.jsx" --include="*.js" --include="*.scss"`
Expected: No results (MenuStack was already updated in Task 3)

**Step 4: Verify build**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation && npx vite build --mode development 2>&1 | head -30`
Expected: Build passes with no Art references.

**Step 5: Commit**

```bash
git add -u frontend/src/modules/AppContainer/Apps/Art/ frontend/src/lib/appRegistry.js
git commit -m "refactor: remove Art app, replaced by Displayer module"
```

---

### Task 6: Update Canvas Art Display Test

Update the Playwright test to verify Displayer renders instead of Art app.

**Files:**
- Modify: `tests/live/flow/canvas/canvas-art-display.runtime.test.mjs`

**Step 1: Update CSS selectors in the test**

The test currently looks for `.art-app` (line 94) and `.art-app img` (line 100). Update to match Displayer's class names.

In `tests/live/flow/canvas/canvas-art-display.runtime.test.mjs`:

Replace the TV app display test (lines 76-105):

```javascript
  test('TV app displays art via display= param', async () => {
    if (!discoveredArtId) {
      test.skip(true, 'No art discovered in previous test');
      return;
    }

    const displayUrl = `${BASE_URL}/tv?display=${discoveredArtId}&mode=art`;
    console.log(`\n🖼️  Opening TV app: ${displayUrl}`);

    await sharedPage.goto(displayUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Wait for displayer component to mount
    await sharedPage.waitForTimeout(3000);

    // Check for displayer class
    const displayer = await sharedPage.locator('.displayer').count();
    console.log(`\n🎨 Displayer elements found: ${displayer}`);

    expect(displayer).toBeGreaterThan(0);

    // Check for image element within displayer
    const img = sharedPage.locator('.displayer img').first();
    const imgSrc = await img.getAttribute('src');
    console.log(`   Image src: ${imgSrc}`);

    expect(imgSrc).toContain('/api/v1/canvas/image/');
  });
```

Replace the image load test (lines 110-130):

```javascript
  test('Image loads from proxy', async () => {
    if (!discoveredArtId) {
      test.skip(true, 'No art discovered');
      return;
    }

    const img = sharedPage.locator('.displayer img').first();

    // Wait for image to load
    await sharedPage.waitForTimeout(2000);

    const naturalWidth = await img.evaluate(el => el.naturalWidth);
    const naturalHeight = await img.evaluate(el => el.naturalHeight);

    console.log(`\n📐 Image dimensions: ${naturalWidth}x${naturalHeight}`);

    expect(naturalWidth).toBeGreaterThan(0);
    expect(naturalHeight).toBeGreaterThan(0);

    console.log('\n✅ Canvas art display test completed successfully');
  });
```

**Step 2: Verify test file syntax**

Run: `node -c tests/live/flow/canvas/canvas-art-display.runtime.test.mjs`
Expected: No syntax errors

**Step 3: Commit**

```bash
git add tests/live/flow/canvas/canvas-art-display.runtime.test.mjs
git commit -m "test: update canvas art display test for Displayer component"
```

---

### Task 7: Add Displayer Mode Runtime Test

Add a new Playwright test that verifies display mode params work correctly.

**Files:**
- Create: `tests/live/flow/displayer/displayer-modes.runtime.test.mjs`

**Step 1: Write the test**

```javascript
/**
 * Displayer Mode Test
 *
 * Verifies:
 * 1. ?display=<id> renders Displayer in default mode
 * 2. ?display=<id>&mode=art renders art mode with frame
 * 3. ?display=<id>&mode=art&frame=ornate uses specified frame style
 *
 * Prerequisites:
 * - Backend running at BACKEND_URL
 * - At least one displayable content source configured (canvas or immich)
 */

import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;

let sharedPage;
let sharedContext;
let displayableId;

test.describe.configure({ mode: 'serial' });

test.describe('Displayer Modes', () => {

  test.beforeAll(async ({ browser }) => {
    sharedContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });
    sharedPage = await sharedContext.newPage();

    sharedPage.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`❌ Browser console error: ${msg.text()}`);
      }
    });
  });

  test.afterAll(async () => {
    if (sharedPage) await sharedPage.close();
    if (sharedContext) await sharedContext.close();
  });

  // Discover a displayable item from canvas or immich
  test('Find a displayable content item', async ({ request }) => {
    // Try canvas first
    const canvasRes = await request.get(`${BASE_URL}/api/v1/content/list/canvas`);
    if (canvasRes.ok()) {
      const items = await canvasRes.json();
      if (items?.length > 0) {
        // Get first leaf item (not a container)
        const leaf = items.find(i => i.itemType === 'leaf' || i.imageUrl);
        if (leaf) {
          displayableId = leaf.id;
          console.log(`✅ Found canvas item: ${displayableId}`);
          return;
        }
        // If all are containers, drill into first
        const container = items[0];
        const childRes = await request.get(`${BASE_URL}/api/v1/content/list/${container.id.replace(':', '/')}`);
        if (childRes.ok()) {
          const children = await childRes.json();
          if (children?.length > 0) {
            displayableId = children[0].id;
            console.log(`✅ Found canvas child item: ${displayableId}`);
            return;
          }
        }
      }
    }

    console.log('⚠️  No displayable content found');
    test.skip(true, 'No displayable content configured');
  });

  test('Default mode renders bare image', async () => {
    if (!displayableId) {
      test.skip(true, 'No displayable item found');
      return;
    }

    await sharedPage.goto(`${BASE_URL}/tv?display=${displayableId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await sharedPage.waitForTimeout(3000);

    const displayer = await sharedPage.locator('.displayer').count();
    expect(displayer).toBeGreaterThan(0);

    // Default mode should NOT have frame elements
    const frame = await sharedPage.locator('.displayer__frame').count();
    expect(frame).toBe(0);

    // Should have an image
    const img = await sharedPage.locator('.displayer img').count();
    expect(img).toBeGreaterThan(0);

    console.log('✅ Default mode renders correctly');
  });

  test('Art mode renders with frame', async () => {
    if (!displayableId) {
      test.skip(true, 'No displayable item found');
      return;
    }

    await sharedPage.goto(`${BASE_URL}/tv?display=${displayableId}&mode=art`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await sharedPage.waitForTimeout(3000);

    const displayer = await sharedPage.locator('.displayer--art').count();
    expect(displayer).toBeGreaterThan(0);

    // Art mode should have frame elements with default classic style
    const frame = await sharedPage.locator('.displayer__frame--classic').count();
    expect(frame).toBeGreaterThan(0);

    console.log('✅ Art mode renders with classic frame');
  });

  test('Art mode respects frame param override', async () => {
    if (!displayableId) {
      test.skip(true, 'No displayable item found');
      return;
    }

    await sharedPage.goto(`${BASE_URL}/tv?display=${displayableId}&mode=art&frame=ornate`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await sharedPage.waitForTimeout(3000);

    // Should use ornate frame, not classic default
    const ornate = await sharedPage.locator('.displayer__frame--ornate').count();
    expect(ornate).toBeGreaterThan(0);

    const classic = await sharedPage.locator('.displayer__frame--classic').count();
    expect(classic).toBe(0);

    console.log('✅ Frame param override works correctly');
  });

});
```

**Step 2: Verify test file syntax**

Run: `node -c tests/live/flow/displayer/displayer-modes.runtime.test.mjs`
Expected: No syntax errors

**Step 3: Commit**

```bash
git add tests/live/flow/displayer/displayer-modes.runtime.test.mjs
git commit -m "test: add Displayer mode runtime tests"
```

---

### Task 8: Verify End-to-End

Run the full test suite to confirm nothing is broken.

**Step 1: Run the build**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation && npx vite build --mode development 2>&1 | tail -20`
Expected: Build succeeds with no errors.

**Step 2: Run existing canvas display test**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation && npx playwright test tests/live/flow/canvas/canvas-art-display.runtime.test.mjs --reporter=line 2>&1`
Expected: Tests pass (or skip if canvas not configured — acceptable)

**Step 3: Run new displayer mode test**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation && npx playwright test tests/live/flow/displayer/displayer-modes.runtime.test.mjs --reporter=line 2>&1`
Expected: Tests pass (or skip if no displayable content — acceptable)

**Step 4: Run grep to confirm no stale Art references**

Run: `grep -r "ArtViewer\|Apps/Art\|app:art\|art-app" frontend/src/ tests/ --include="*.jsx" --include="*.js" --include="*.mjs" --include="*.scss" -l`
Expected: No results (all references removed)

**Step 5: Final commit if any fixups needed**

If any issues found, fix and commit. Otherwise, this task is verification only.
