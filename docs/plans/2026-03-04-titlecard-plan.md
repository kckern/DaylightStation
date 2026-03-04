# Title Cards Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add title card support to slideshow queries — custom-rendered slides (intro, outro, section dividers) that appear inline in the queue alongside photos and videos.

**Architecture:** Title cards are synthetic queue items with `format: 'titlecard'`, resolved in QueryAdapter from composite query YAML (`items:` array). The frontend renders them via a new `TitleCardRenderer` registered in the format registry, with four built-in templates and a three-layer styling system (template → theme → CSS overrides).

**Tech Stack:** Node.js (backend), React/JSX (frontend), SCSS, Vitest (unit tests), Web Animations API

**Design doc:** `docs/plans/2026-03-04-titlecard-design.md`

---

### Task 1: SavedQueryService — normalize flat/composite queries

**Files:**
- Modify: `backend/src/3_applications/content/SavedQueryService.mjs:40-57`
- Test: `tests/isolated/applications/content/SavedQueryService.test.mjs`

**Step 1: Write the failing tests**

Add to the existing test file, inside the `getQuery` describe block:

```javascript
it('wraps flat query into single-element items array', () => {
  const result = service.getQuery('dailynews');
  expect(result.items).toEqual([{
    source: 'freshvideo',
    filters: { sources: [] },
    params: {},
  }]);
});

it('returns items array from composite query', () => {
  queries.anniversary = {
    title: 'Anniversary',
    items: [
      { type: 'titlecard', template: 'centered', duration: 6, text: { title: 'Hello' } },
      { type: 'immich', params: { month: 3, day: 4 } },
      { query: 'dailynews' },
    ],
  };
  const result = service.getQuery('anniversary');
  expect(result.items).toHaveLength(3);
  expect(result.items[0].type).toBe('titlecard');
  expect(result.items[1].type).toBe('immich');
  expect(result.items[2].query).toBe('dailynews');
});

it('preserves root-level audio on composite query', () => {
  queries.anniversary = {
    title: 'Anniversary',
    audio: { contentId: 'music:test', behavior: 'pause' },
    items: [
      { type: 'immich', params: { month: 3 } },
    ],
  };
  const result = service.getQuery('anniversary');
  expect(result.audio).toEqual({ contentId: 'music:test', behavior: 'pause' });
});

it('flat titlecard query normalizes into items array', () => {
  queries.welcome = {
    title: 'Welcome',
    type: 'titlecard',
    template: 'centered',
    duration: 10,
    text: { title: 'Welcome' },
  };
  const result = service.getQuery('welcome');
  expect(result.items).toHaveLength(1);
  expect(result.items[0].type).toBe('titlecard');
  expect(result.items[0].template).toBe('centered');
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/isolated/applications/content/SavedQueryService.test.mjs`
Expected: FAIL — `result.items` is undefined

**Step 3: Implement normalization in getQuery()**

Modify `getQuery()` in `SavedQueryService.mjs` (lines 40-57). The method should:

1. If `raw.items` exists, pass items array through as-is (each entry keeps its own `type`/`query`/`params`)
2. If no `raw.items`, wrap the current return shape into a single-element array under `items`
3. Root-level `audio` and `title` stay at the top level

```javascript
getQuery(name) {
  const raw = this.#readQuery(name);
  if (!raw) return null;

  const base = {
    title: raw.title || name,
    ...(raw.audio != null && { audio: raw.audio }),
  };

  // Composite query — items array provided
  if (raw.items) {
    return { ...base, items: raw.items };
  }

  // Flat query — wrap into single-element items array
  return {
    ...base,
    items: [{
      source: raw.type,
      filters: { sources: raw.sources || [] },
      params: raw.params || {},
      ...(raw.type === 'titlecard' && {
        type: 'titlecard',
        template: raw.template,
        duration: raw.duration,
        text: raw.text,
        ...(raw.effect != null && { effect: raw.effect }),
        ...(raw.zoom != null && { zoom: raw.zoom }),
        ...(raw.image != null && { image: raw.image }),
        ...(raw.theme != null && { theme: raw.theme }),
        ...(raw.css != null && { css: raw.css }),
      }),
      ...(raw.sort != null && { sort: raw.sort }),
      ...(raw.take != null && { take: raw.take }),
      ...(raw.exclude != null && { exclude: raw.exclude }),
      ...(raw.slideshow != null && { slideshow: raw.slideshow }),
    }],
  };
}
```

**Step 4: Update existing tests**

Existing tests that check `result.source`, `result.params`, etc. now need to check `result.items[0].source`, `result.items[0].params`, etc. Update each existing test assertion to reach through the `items` array.

**Step 5: Run tests to verify all pass**

Run: `npx vitest run tests/isolated/applications/content/SavedQueryService.test.mjs`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add backend/src/3_applications/content/SavedQueryService.mjs tests/isolated/applications/content/SavedQueryService.test.mjs
git commit -m "feat(queries): normalize flat/composite queries into items array in SavedQueryService"
```

---

### Task 2: QueryAdapter — iterate items array and resolve title cards

**Files:**
- Modify: `backend/src/1_adapters/content/query/QueryAdapter.mjs:101-118`
- Test: `tests/isolated/adapter/content/query/QueryAdapter.test.mjs`
- Test: `tests/isolated/adapter/content/query/QueryAdapter.immich-exclude.test.mjs`

**Step 1: Write the failing tests**

Create a new test file for composite query resolution:

```javascript
// tests/isolated/adapter/content/query/QueryAdapter.composite.test.mjs
import { describe, it, expect, vi } from 'vitest';

// Import QueryAdapter and construct with mocks
// Follow the pattern from QueryAdapter.test.mjs for setup

describe('QueryAdapter composite queries', () => {

  it('resolves a titlecard entry to a synthetic PlayableItem', async () => {
    const mockSavedQueryService = {
      getQuery: vi.fn().mockReturnValue({
        title: 'Test',
        items: [
          { type: 'titlecard', template: 'centered', duration: 6, text: { title: 'Hello' } },
        ],
      }),
    };
    const adapter = new QueryAdapter({ savedQueryService: mockSavedQueryService });

    const result = await adapter.resolvePlayables('query:test');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('titlecard:test:0');
    expect(result[0].mediaType).toBe('image');
    expect(result[0].metadata.contentFormat).toBe('titlecard');
    expect(result[0].titlecard.template).toBe('centered');
    expect(result[0].titlecard.text.title).toBe('Hello');
    expect(result[0].duration).toBe(6);
  });

  it('resolves titlecard with slideshow effect config', async () => {
    const mockSavedQueryService = {
      getQuery: vi.fn().mockReturnValue({
        title: 'Test',
        items: [
          { type: 'titlecard', template: 'centered', duration: 5, effect: 'kenburns', zoom: 1.3, text: { title: 'Hi' } },
        ],
      }),
    };
    const adapter = new QueryAdapter({ savedQueryService: mockSavedQueryService });

    const result = await adapter.resolvePlayables('query:test');

    expect(result[0].slideshow).toEqual({ duration: 5, effect: 'kenburns', zoom: 1.3 });
  });

  it('concatenates titlecard and content items in order', async () => {
    const mockImmichAdapter = {
      search: vi.fn().mockResolvedValue({
        items: [
          { id: 'immich:photo1', title: '2024-03-04 Beach.jpg', mediaType: 'image' },
        ],
      }),
    };
    const mockRegistry = { get: vi.fn().mockReturnValue(mockImmichAdapter) };
    const mockSavedQueryService = {
      getQuery: vi.fn().mockReturnValue({
        title: 'Composite',
        items: [
          { type: 'titlecard', template: 'centered', duration: 6, text: { title: 'Intro' } },
          { type: 'immich', params: { month: 3, day: 4, yearFrom: 2024 }, slideshow: { duration: 5 } },
        ],
      }),
    };
    const adapter = new QueryAdapter({ savedQueryService: mockSavedQueryService, registry: mockRegistry });

    const result = await adapter.resolvePlayables('query:composite');

    expect(result[0].id).toBe('titlecard:composite:0');
    expect(result[0].titlecard.text.title).toBe('Intro');
    expect(result.length).toBeGreaterThan(1);
    // Content items follow the title card
  });

  it('resolves named query references recursively', async () => {
    const mockSavedQueryService = {
      getQuery: vi.fn().mockImplementation((name) => {
        if (name === 'parent') {
          return {
            title: 'Parent',
            items: [
              { type: 'titlecard', template: 'centered', duration: 4, text: { title: 'Start' } },
              { query: 'child' },
            ],
          };
        }
        if (name === 'child') {
          return {
            title: 'Child',
            items: [
              { type: 'titlecard', template: 'section-header', duration: 3, text: { title: '2019' } },
            ],
          };
        }
        return null;
      }),
    };
    const adapter = new QueryAdapter({ savedQueryService: mockSavedQueryService });

    const result = await adapter.resolvePlayables('query:parent');

    expect(result).toHaveLength(2);
    expect(result[0].titlecard.text.title).toBe('Start');
    expect(result[1].titlecard.text.title).toBe('2019');
  });

  it('resolves titlecard image contentId to proxy URL', async () => {
    const mockSavedQueryService = {
      getQuery: vi.fn().mockReturnValue({
        title: 'Test',
        items: [
          { type: 'titlecard', template: 'lower-third', duration: 5, text: { title: 'Hi' }, image: 'immich:abc-123' },
        ],
      }),
    };
    const adapter = new QueryAdapter({ savedQueryService: mockSavedQueryService });

    const result = await adapter.resolvePlayables('query:test');

    expect(result[0].titlecard.imageUrl).toBe('/api/v1/proxy/immich/assets/abc-123/original');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/isolated/adapter/content/query/QueryAdapter.composite.test.mjs`
Expected: FAIL

**Step 3: Implement composite resolution in QueryAdapter**

Modify `resolvePlayables()` (line 101) to iterate the items array. Add helper methods:

```javascript
async resolvePlayables(id) {
  const name = this.#stripPrefix(id);
  const query = this.#savedQueryService.getQuery(name);
  if (!query) return [];

  const allItems = [];

  for (let i = 0; i < query.items.length; i++) {
    const entry = query.items[i];

    if (entry.type === 'titlecard') {
      allItems.push(this.#buildTitleCardItem(entry, name, i));
      continue;
    }

    if (entry.query) {
      // Recursive: resolve named query ref
      const subItems = await this.resolvePlayables(`query:${entry.query}`);
      allItems.push(...subItems);
      continue;
    }

    // Content query — delegate to existing resolution
    const contentItems = await this.#resolveContentEntry(entry);
    allItems.push(...contentItems);
  }

  // Attach root-level audio config
  if (query.audio) allItems.audio = query.audio;

  return allItems;
}

#buildTitleCardItem(entry, queryName, index) {
  const imageUrl = entry.image ? this.#resolveImageUrl(entry.image) : null;

  return new PlayableItem({
    id: `titlecard:${queryName}:${index}`,
    source: 'titlecard',
    title: entry.text?.title || 'Title Card',
    mediaType: 'image',
    duration: entry.duration || 5,
    metadata: {
      contentFormat: 'titlecard',
    },
    slideshow: {
      duration: entry.duration || 5,
      ...(entry.effect != null && { effect: entry.effect }),
      ...(entry.zoom != null && { zoom: entry.zoom }),
    },
    titlecard: {
      template: entry.template || 'centered',
      text: entry.text || {},
      ...(entry.theme != null && { theme: entry.theme }),
      ...(entry.css != null && { css: entry.css }),
      ...(imageUrl != null && { imageUrl }),
    },
  });
}

#resolveImageUrl(contentId) {
  // Parse contentId like "immich:asset-uuid" → proxy URL
  const match = contentId.match(/^immich:(.+)$/);
  if (match) return `/api/v1/proxy/immich/assets/${match[1]}/original`;
  return null;
}
```

Extract the existing immich/freshvideo resolution into `#resolveContentEntry(entry)` which takes a single items-array entry (with `source`, `params`, `slideshow`, `exclude`, etc.) and returns resolved items. This is a refactor of the existing `resolvePlayables` body.

**Step 4: Update existing QueryAdapter tests**

The existing tests in `QueryAdapter.test.mjs` and `QueryAdapter.immich-exclude.test.mjs` mock `savedQueryService.getQuery()` to return the old flat shape. Update those mocks to return the new normalized shape (with `items` array). The mock return values should wrap existing content in `{ items: [{ source, params, ... }] }`.

**Step 5: Run all QueryAdapter tests**

Run: `npx vitest run tests/isolated/adapter/content/query/`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add backend/src/1_adapters/content/query/QueryAdapter.mjs tests/isolated/adapter/content/query/
git commit -m "feat(queries): composite query resolution with titlecard and recursive query refs"
```

---

### Task 3: Queue API — serialize titlecard payload

**Files:**
- Modify: `backend/src/4_api/v1/routers/queue.mjs:19-79`
- Test: Add to existing queue tests or create `tests/isolated/api/queue.toQueueItem.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/isolated/api/queue.toQueueItem.test.mjs
import { describe, it, expect } from 'vitest';
import { toQueueItem } from '../../../../backend/src/4_api/v1/routers/queue.mjs';

describe('toQueueItem', () => {
  it('passes through titlecard payload', () => {
    const item = {
      id: 'titlecard:test:0',
      source: 'titlecard',
      title: 'Hello',
      mediaType: 'image',
      mediaUrl: null,
      duration: 6,
      metadata: { contentFormat: 'titlecard' },
      slideshow: { duration: 6, effect: 'kenburns' },
      titlecard: {
        template: 'centered',
        text: { title: 'Hello', subtitle: 'World' },
        theme: 'warm-gold',
        css: { title: { fontSize: '4rem' } },
        imageUrl: '/api/v1/proxy/immich/assets/abc/original',
      },
    };

    const qi = toQueueItem(item);

    expect(qi.format).toBe('titlecard');
    expect(qi.titlecard).toEqual(item.titlecard);
    expect(qi.slideshow).toEqual(item.slideshow);
    expect(qi.mediaType).toBe('image');
  });

  it('omits titlecard field when not present', () => {
    const item = {
      id: 'immich:photo1',
      source: 'immich',
      title: 'Photo',
      mediaType: 'image',
      mediaUrl: '/api/v1/proxy/immich/assets/abc/original',
      duration: 0,
      metadata: {},
    };

    const qi = toQueueItem(item);

    expect(qi.titlecard).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/api/queue.toQueueItem.test.mjs`
Expected: FAIL — `qi.titlecard` is undefined

**Step 3: Add titlecard passthrough to toQueueItem()**

Add after the existing slideshow passthrough (line 65 in queue.mjs):

```javascript
if (item.slideshow) qi.slideshow = item.slideshow;
if (item.titlecard) qi.titlecard = item.titlecard;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/api/queue.toQueueItem.test.mjs`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/queue.mjs tests/isolated/api/queue.toQueueItem.test.mjs
git commit -m "feat(queue): serialize titlecard payload in toQueueItem"
```

---

### Task 4: Frontend — TitleCardRenderer component

**Files:**
- Create: `frontend/src/modules/Player/renderers/TitleCardRenderer.jsx`
- Create: `frontend/src/modules/Player/renderers/TitleCardRenderer.scss`

**Step 1: Create TitleCardRenderer component**

```jsx
// frontend/src/modules/Player/renderers/TitleCardRenderer.jsx
import { useEffect, useRef, useMemo, useCallback } from 'react';
import { computeZoomTarget } from './ImageFrame.jsx';
import getLogger from '../../../lib/logging/Logger.js';
import './TitleCardRenderer.scss';

const logger_memo = () => getLogger().child({ component: 'TitleCardRenderer' });
let _logger;
function logger() {
  if (!_logger) _logger = logger_memo();
  return _logger;
}

const TEMPLATES = {
  centered: CenteredTemplate,
  'section-header': SectionHeaderTemplate,
  credits: CreditsTemplate,
  'lower-third': LowerThirdTemplate,
};

export function TitleCardRenderer({ media, advance, resilienceBridge }) {
  const timerRef = useRef(null);
  const containerRef = useRef(null);
  const bgRef = useRef(null);

  const slideshow = useMemo(() => media?.slideshow || {}, [media?.slideshow]);
  const card = useMemo(() => media?.titlecard || {}, [media?.titlecard]);
  const duration = (slideshow.duration || 5) * 1000;
  const effect = slideshow.effect || 'none';
  const zoom = slideshow.zoom || 1.2;

  const TemplateComponent = TEMPLATES[card.template] || TEMPLATES.centered;
  const themeClass = `titlecard--theme-${card.theme || 'default'}`;

  // ResilienceBridge mock — title cards aren't real media elements
  useEffect(() => {
    if (resilienceBridge) {
      resilienceBridge.current = {
        get currentTime() { return 0; },
        get duration() { return slideshow.duration || 5; },
        get paused() { return false; },
        play() { return Promise.resolve(); },
        pause() {},
      };
    }
  }, [resilienceBridge, slideshow.duration]);

  // Ken Burns on background image
  useEffect(() => {
    const bgEl = bgRef.current;
    if (!bgEl || !card.imageUrl || effect !== 'kenburns') return;

    const target = computeZoomTarget({ people: [], focusPerson: null, zoom });
    bgEl.animate([
      { transform: `scale(1.0) translate(${target.startX}, ${target.startY})` },
      { transform: `scale(${zoom}) translate(${target.endX}, ${target.endY})` },
    ], {
      duration,
      easing: 'ease-in-out',
      fill: 'forwards',
    });
  }, [media?.id, card.imageUrl, effect, zoom, duration]);

  // Auto-advance timer
  useEffect(() => {
    logger().info('titlecard-show', {
      id: media?.id,
      template: card.template,
      duration: duration / 1000,
    });

    timerRef.current = setTimeout(() => {
      logger().debug('titlecard-advance', { id: media?.id });
      advance?.();
    }, duration);

    return () => clearTimeout(timerRef.current);
  }, [media?.id, duration, advance]);

  return (
    <div ref={containerRef} className={`titlecard ${themeClass}`}>
      {card.imageUrl && (
        <img
          ref={bgRef}
          className="titlecard__bg"
          src={card.imageUrl}
          alt=""
          draggable={false}
        />
      )}
      <div className="titlecard__overlay">
        <TemplateComponent text={card.text || {}} css={card.css || {}} />
      </div>
    </div>
  );
}

// --- Template Components ---

function CenteredTemplate({ text, css }) {
  return (
    <div className="titlecard-tpl titlecard-tpl--centered" style={css.container}>
      {text.title && (
        <h1 className="titlecard-tpl__title" style={css.title}>{text.title}</h1>
      )}
      {text.subtitle && (
        <p className="titlecard-tpl__subtitle" style={css.subtitle}>{text.subtitle}</p>
      )}
    </div>
  );
}

function SectionHeaderTemplate({ text, css }) {
  return (
    <div className="titlecard-tpl titlecard-tpl--section-header" style={css.container}>
      {text.title && (
        <h1 className="titlecard-tpl__title" style={css.title}>{text.title}</h1>
      )}
      {text.subtitle && (
        <p className="titlecard-tpl__subtitle" style={css.subtitle}>{text.subtitle}</p>
      )}
    </div>
  );
}

function CreditsTemplate({ text, css }) {
  return (
    <div className="titlecard-tpl titlecard-tpl--credits" style={css.container}>
      {text.title && (
        <h1 className="titlecard-tpl__title" style={css.title}>{text.title}</h1>
      )}
      {text.lines?.map((line, i) => (
        <p key={i} className="titlecard-tpl__line" style={css.lines}>{line}</p>
      ))}
    </div>
  );
}

function LowerThirdTemplate({ text, css }) {
  return (
    <div className="titlecard-tpl titlecard-tpl--lower-third" style={css.container}>
      {text.title && (
        <h2 className="titlecard-tpl__title" style={css.title}>{text.title}</h2>
      )}
      {text.subtitle && (
        <p className="titlecard-tpl__subtitle" style={css.subtitle}>{text.subtitle}</p>
      )}
    </div>
  );
}
```

**Step 2: Create SCSS**

```scss
// frontend/src/modules/Player/renderers/TitleCardRenderer.scss
.titlecard {
  position: absolute;
  inset: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;

  &__bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    z-index: 0;
  }

  &__overlay {
    position: relative;
    z-index: 1;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}

// --- Themes ---
.titlecard--theme-default {
  .titlecard-tpl__title { color: #fff; }
  .titlecard-tpl__subtitle { color: rgba(255,255,255,0.8); }
  .titlecard__overlay { background: rgba(0,0,0,0.4); }
}

.titlecard--theme-warm-gold {
  .titlecard-tpl__title { color: #ffd700; font-family: Georgia, serif; }
  .titlecard-tpl__subtitle { color: rgba(255,215,0,0.7); font-family: Georgia, serif; }
  .titlecard__overlay { background: rgba(30,15,0,0.5); }
}

.titlecard--theme-minimal {
  .titlecard-tpl__title { color: #fff; font-weight: 200; }
  .titlecard-tpl__subtitle { color: rgba(255,255,255,0.6); font-weight: 200; }
  .titlecard__overlay { background: transparent; }
}

.titlecard--theme-bold {
  .titlecard-tpl__title { color: #fff; font-weight: 900; font-size: 5rem; letter-spacing: -0.02em; }
  .titlecard-tpl__subtitle { color: #fff; font-weight: 700; font-size: 2rem; }
  .titlecard__overlay { background: rgba(0,0,0,0.6); }
}

// --- Template layouts ---
.titlecard-tpl {
  text-align: center;
  padding: 2rem;

  &__title {
    margin: 0;
    font-size: 3rem;
    line-height: 1.2;
  }

  &__subtitle {
    margin: 0.5rem 0 0;
    font-size: 1.5rem;
    line-height: 1.4;
  }

  &__line {
    margin: 0.3rem 0;
    font-size: 1.2rem;
    line-height: 1.5;
  }

  &--centered {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }

  &--section-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    .titlecard-tpl__title {
      font-size: 4rem;
      font-weight: 300;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
  }

  &--credits {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  &--lower-third {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 2rem 3rem;
    text-align: left;
    background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);

    .titlecard-tpl__title {
      font-size: 2rem;
      text-align: left;
    }

    .titlecard-tpl__subtitle {
      text-align: left;
    }
  }
}
```

**Step 3: Verify file created**

Run: `ls frontend/src/modules/Player/renderers/TitleCardRenderer.*`
Expected: Both `.jsx` and `.scss` files listed

**Step 4: Commit**

```bash
git add frontend/src/modules/Player/renderers/TitleCardRenderer.jsx frontend/src/modules/Player/renderers/TitleCardRenderer.scss
git commit -m "feat(player): add TitleCardRenderer with four templates and theme system"
```

---

### Task 5: Frontend — register titlecard format in registry

**Files:**
- Modify: `frontend/src/modules/Player/lib/registry.js:15-34`

**Step 1: Add import and registration**

Add to the import block (around line 15):

```javascript
import { TitleCardRenderer } from '../renderers/TitleCardRenderer.jsx';
```

Add to `CONTENT_FORMAT_COMPONENTS` (around line 27-34):

```javascript
const CONTENT_FORMAT_COMPONENTS = {
  // ... existing entries ...
  titlecard: TitleCardRenderer,
};
```

**Step 2: Verify the app builds**

Run: `cd /root/Code/DaylightStation && npx vite build 2>&1 | tail -5`
Expected: Build succeeds with no errors

**Step 3: Commit**

```bash
git add frontend/src/modules/Player/lib/registry.js
git commit -m "feat(player): register titlecard format in renderer registry"
```

---

### Task 6: End-to-end smoke test

**Files:**
- Create: `tests/isolated/adapter/content/query/QueryAdapter.composite.test.mjs` (if not already created in Task 2)

**Step 1: Run all affected test suites**

```bash
npx vitest run tests/isolated/applications/content/SavedQueryService.test.mjs
npx vitest run tests/isolated/adapter/content/query/
npx vitest run tests/isolated/api/queue.toQueueItem.test.mjs
```

Expected: ALL PASS

**Step 2: Run vite build to verify frontend compiles**

```bash
cd /root/Code/DaylightStation && npx vite build 2>&1 | tail -10
```

Expected: Build succeeds

**Step 3: Update slideshow docs**

Update `docs/reference/content/content-slideshows.md` to document:
- The `items:` array for composite queries
- Title card entry type and fields
- The three-layer styling hierarchy
- Named query references

**Step 4: Commit**

```bash
git add docs/reference/content/content-slideshows.md
git commit -m "docs: add title card and composite query documentation to slideshow reference"
```
