# Content Plugin Registry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a content plugin registry that detects and enriches content-type-specific metadata (starting with YouTube) across all feed paths — FreshRSS Reader, FreshRSS Scroll, and direct YouTube API items.

**Architecture:** A backend `ContentPluginRegistry` post-processes normalized items from any source adapter. Each plugin detects items by URL pattern and merges content-type metadata. A shared frontend `contentPlugins` registry maps `contentType` to view-specific renderers (`ScrollBody` for masonry cards, `ReaderRow` for the inbox). YouTube is the first plugin.

**Tech Stack:** Node.js ES modules (backend), React JSX (frontend), Jest (tests)

**Design doc:** `docs/plans/2026-02-18-content-plugin-registry-design.md`

---

### Task 1: IContentPlugin Interface

**Files:**
- Create: `backend/src/3_applications/feed/plugins/IContentPlugin.mjs`
- Test: `tests/isolated/application/feed/ContentPluginRegistry.test.mjs`

**Step 1: Write the failing test**

Create the test file with the interface contract test:

```javascript
// tests/isolated/application/feed/ContentPluginRegistry.test.mjs
import { jest } from '@jest/globals';
import { IContentPlugin } from '#apps/feed/plugins/IContentPlugin.mjs';

describe('IContentPlugin', () => {
  test('throws if contentType not implemented', () => {
    const plugin = new IContentPlugin();
    expect(() => plugin.contentType).toThrow('must be implemented');
  });

  test('detect() returns false by default', () => {
    const plugin = new IContentPlugin();
    expect(plugin.detect({ link: 'https://example.com' })).toBe(false);
  });

  test('enrich() returns empty object by default', () => {
    const plugin = new IContentPlugin();
    expect(plugin.enrich({ link: 'https://example.com' })).toEqual({});
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/application/feed/ContentPluginRegistry.test.mjs --verbose`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```javascript
// backend/src/3_applications/feed/plugins/IContentPlugin.mjs
/**
 * Content plugin interface.
 *
 * Plugins detect items by URL/metadata and enrich them with
 * content-type-specific fields. The ContentPluginRegistry runs
 * all registered plugins as a post-processing step.
 *
 * @module applications/feed/plugins
 */
export class IContentPlugin {
  /** @returns {string} Content type identifier, e.g. 'youtube' */
  get contentType() {
    throw new Error('IContentPlugin.contentType must be implemented');
  }

  /**
   * Test whether this plugin should handle the given item.
   * @param {Object} item - Normalized feed item
   * @returns {boolean}
   */
  detect(item) {
    return false;
  }

  /**
   * Return metadata to merge onto the item.
   * Called only when detect() returns true.
   * @param {Object} item - Normalized feed item
   * @returns {Object} Fields to shallow-merge onto item (may include nested `meta`)
   */
  enrich(item) {
    return {};
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/application/feed/ContentPluginRegistry.test.mjs --verbose`
Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/plugins/IContentPlugin.mjs tests/isolated/application/feed/ContentPluginRegistry.test.mjs
git commit -m "feat(feed): add IContentPlugin interface"
```

---

### Task 2: ContentPluginRegistry Service

**Files:**
- Create: `backend/src/3_applications/feed/services/ContentPluginRegistry.mjs`
- Modify: `tests/isolated/application/feed/ContentPluginRegistry.test.mjs`

**Step 1: Add failing tests for the registry**

Append to the existing test file:

```javascript
import { ContentPluginRegistry } from '#apps/feed/services/ContentPluginRegistry.mjs';

describe('ContentPluginRegistry', () => {
  const makePlugin = (type, detectFn, enrichFn) => ({
    contentType: type,
    detect: detectFn,
    enrich: enrichFn,
  });

  test('enrich() returns items unchanged when no plugins match', () => {
    const registry = new ContentPluginRegistry([]);
    const items = [{ id: '1', link: 'https://example.com', meta: {} }];
    const result = registry.enrich(items);
    expect(result).toEqual(items);
    expect(result[0].contentType).toBeUndefined();
  });

  test('enrich() applies matching plugin metadata', () => {
    const plugin = makePlugin(
      'youtube',
      (item) => item.link?.includes('youtube.com'),
      (item) => ({ contentType: 'youtube', meta: { videoId: 'abc', playable: true } }),
    );
    const registry = new ContentPluginRegistry([plugin]);
    const items = [{ id: '1', link: 'https://youtube.com/watch?v=abc', meta: { feedTitle: 'Tech' } }];
    const result = registry.enrich(items);
    expect(result[0].contentType).toBe('youtube');
    expect(result[0].meta.videoId).toBe('abc');
    expect(result[0].meta.playable).toBe(true);
    // Original meta preserved
    expect(result[0].meta.feedTitle).toBe('Tech');
  });

  test('enrich() skips items that already have a contentType', () => {
    const plugin = makePlugin(
      'youtube',
      () => true,
      () => ({ contentType: 'youtube', meta: { videoId: 'new' } }),
    );
    const registry = new ContentPluginRegistry([plugin]);
    const items = [{ id: '1', contentType: 'youtube', meta: { videoId: 'existing' } }];
    const result = registry.enrich(items);
    expect(result[0].meta.videoId).toBe('existing');
  });

  test('enrich() skips items whose source matches the contentType', () => {
    const plugin = makePlugin(
      'youtube',
      () => true,
      () => ({ contentType: 'youtube', meta: { videoId: 'overwritten' } }),
    );
    const registry = new ContentPluginRegistry([plugin]);
    const items = [{ id: '1', source: 'youtube', meta: { videoId: 'original' } }];
    const result = registry.enrich(items);
    expect(result[0].meta.videoId).toBe('original');
  });

  test('first matching plugin wins', () => {
    const pluginA = makePlugin('youtube', () => true, () => ({ contentType: 'youtube', meta: { from: 'A' } }));
    const pluginB = makePlugin('youtube', () => true, () => ({ contentType: 'youtube', meta: { from: 'B' } }));
    const registry = new ContentPluginRegistry([pluginA, pluginB]);
    const items = [{ id: '1', link: 'https://youtube.com', meta: {} }];
    const result = registry.enrich(items);
    expect(result[0].meta.from).toBe('A');
  });

  test('enrich() merges meta shallowly (plugin meta keys override, others preserved)', () => {
    const plugin = makePlugin(
      'youtube',
      () => true,
      () => ({ contentType: 'youtube', image: 'thumb.jpg', meta: { videoId: 'v1' } }),
    );
    const registry = new ContentPluginRegistry([plugin]);
    const items = [{ id: '1', link: 'https://youtube.com', image: null, meta: { feedTitle: 'Feed' } }];
    const result = registry.enrich(items);
    expect(result[0].image).toBe('thumb.jpg');
    expect(result[0].meta.videoId).toBe('v1');
    expect(result[0].meta.feedTitle).toBe('Feed');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/application/feed/ContentPluginRegistry.test.mjs --verbose`
Expected: FAIL — cannot resolve `#apps/feed/services/ContentPluginRegistry.mjs`

**Step 3: Write minimal implementation**

```javascript
// backend/src/3_applications/feed/services/ContentPluginRegistry.mjs
/**
 * ContentPluginRegistry
 *
 * Post-processing enrichment layer for normalized feed items.
 * Iterates registered IContentPlugin instances; first match wins.
 * Items with an existing `contentType` or whose `source` matches
 * a plugin's contentType are skipped (already enriched).
 *
 * @module applications/feed/services
 */
export class ContentPluginRegistry {
  /** @type {Array<import('../plugins/IContentPlugin.mjs').IContentPlugin>} */
  #plugins;

  /**
   * @param {Array<import('../plugins/IContentPlugin.mjs').IContentPlugin>} plugins
   */
  constructor(plugins = []) {
    this.#plugins = plugins;
  }

  /**
   * Enrich items in-place. Returns the same array for convenience.
   * @param {Object[]} items - Normalized feed items
   * @returns {Object[]}
   */
  enrich(items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Skip already-typed items
      if (item.contentType) continue;

      for (const plugin of this.#plugins) {
        // Skip if item.source already matches this plugin (e.g., source:'youtube')
        if (item.source === plugin.contentType) break;

        if (plugin.detect(item)) {
          const enrichment = plugin.enrich(item);
          const { meta: enrichedMeta, ...rest } = enrichment;
          Object.assign(item, rest);
          if (enrichedMeta) {
            item.meta = { ...item.meta, ...enrichedMeta };
          }
          break; // first match wins
        }
      }
    }
    return items;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/application/feed/ContentPluginRegistry.test.mjs --verbose`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/services/ContentPluginRegistry.mjs tests/isolated/application/feed/ContentPluginRegistry.test.mjs
git commit -m "feat(feed): add ContentPluginRegistry service"
```

---

### Task 3: YouTube Content Plugin (Backend)

**Files:**
- Create: `backend/src/1_adapters/feed/plugins/youtube.mjs`
- Test: `tests/isolated/adapter/feed/YouTubeContentPlugin.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/isolated/adapter/feed/YouTubeContentPlugin.test.mjs
import { YouTubeContentPlugin } from '#adapters/feed/plugins/youtube.mjs';

describe('YouTubeContentPlugin', () => {
  const plugin = new YouTubeContentPlugin();

  test('contentType is youtube', () => {
    expect(plugin.contentType).toBe('youtube');
  });

  describe('detect()', () => {
    test('matches youtube.com/watch?v= links', () => {
      expect(plugin.detect({ link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })).toBe(true);
    });

    test('matches youtu.be short links', () => {
      expect(plugin.detect({ link: 'https://youtu.be/dQw4w9WgXcQ' })).toBe(true);
    });

    test('matches youtube.com/embed/ links', () => {
      expect(plugin.detect({ link: 'https://www.youtube.com/embed/dQw4w9WgXcQ' })).toBe(true);
    });

    test('matches youtube.com/shorts/ links', () => {
      expect(plugin.detect({ link: 'https://www.youtube.com/shorts/dQw4w9WgXcQ' })).toBe(true);
    });

    test('does not match non-youtube links', () => {
      expect(plugin.detect({ link: 'https://example.com/article' })).toBe(false);
    });

    test('does not match null/missing link', () => {
      expect(plugin.detect({ link: null })).toBe(false);
      expect(plugin.detect({})).toBe(false);
    });
  });

  describe('enrich()', () => {
    test('extracts videoId from youtube.com/watch?v=', () => {
      const result = plugin.enrich({ link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', meta: {} });
      expect(result.contentType).toBe('youtube');
      expect(result.meta.videoId).toBe('dQw4w9WgXcQ');
      expect(result.meta.playable).toBe(true);
      expect(result.meta.embedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1');
    });

    test('extracts videoId from youtu.be/', () => {
      const result = plugin.enrich({ link: 'https://youtu.be/abc123_-xyz', meta: {} });
      expect(result.meta.videoId).toBe('abc123_-xyz');
    });

    test('extracts videoId from /embed/', () => {
      const result = plugin.enrich({ link: 'https://www.youtube.com/embed/abc123', meta: {} });
      expect(result.meta.videoId).toBe('abc123');
    });

    test('extracts videoId from /shorts/', () => {
      const result = plugin.enrich({ link: 'https://www.youtube.com/shorts/abc123', meta: {} });
      expect(result.meta.videoId).toBe('abc123');
    });

    test('sets thumbnail image when item has no image', () => {
      const result = plugin.enrich({ link: 'https://youtube.com/watch?v=abc', image: null, meta: {} });
      expect(result.image).toBe('https://img.youtube.com/vi/abc/hqdefault.jpg');
      expect(result.meta.imageWidth).toBe(480);
      expect(result.meta.imageHeight).toBe(360);
    });

    test('does not overwrite existing image', () => {
      const result = plugin.enrich({ link: 'https://youtube.com/watch?v=abc', image: 'https://existing.jpg', meta: {} });
      expect(result.image).toBeUndefined(); // no image key in enrichment
    });

    test('returns empty enrichment when videoId cannot be extracted', () => {
      const result = plugin.enrich({ link: 'https://youtube.com/channel/UC123', meta: {} });
      expect(result).toEqual({});
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/adapter/feed/YouTubeContentPlugin.test.mjs --verbose`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```javascript
// backend/src/1_adapters/feed/plugins/youtube.mjs
/**
 * YouTube Content Plugin
 *
 * Detects YouTube URLs in feed items from any source (FreshRSS, Reddit, etc.)
 * and enriches them with videoId, embed URL, thumbnail, and playable flag.
 *
 * @module adapters/feed/plugins/youtube
 */
import { IContentPlugin } from '#apps/feed/plugins/IContentPlugin.mjs';

const YT_URL_PATTERN = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/;

export class YouTubeContentPlugin extends IContentPlugin {
  get contentType() { return 'youtube'; }

  detect(item) {
    if (!item.link) return false;
    return YT_URL_PATTERN.test(item.link);
  }

  enrich(item) {
    const match = item.link?.match(YT_URL_PATTERN);
    if (!match) return {};

    const videoId = match[1];
    const result = {
      contentType: 'youtube',
      meta: {
        videoId,
        playable: true,
        embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1`,
      },
    };

    // Set thumbnail if item has no image
    if (!item.image) {
      result.image = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      result.meta.imageWidth = 480;
      result.meta.imageHeight = 360;
    }

    return result;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/adapter/feed/YouTubeContentPlugin.test.mjs --verbose`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/feed/plugins/youtube.mjs tests/isolated/adapter/feed/YouTubeContentPlugin.test.mjs
git commit -m "feat(feed): add YouTube content plugin"
```

---

### Task 4: Wire Registry into Backend (Scroll + Reader)

**Files:**
- Modify: `backend/src/app.mjs:839-876` — instantiate registry, pass to FeedAssemblyService and router
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs:18-80,120` — accept and call registry
- Modify: `backend/src/4_api/v1/routers/feed.mjs:26-27,87-186` — accept and call registry in `/reader/stream`

**Step 1: Modify `FeedAssemblyService` to accept `contentPluginRegistry`**

In `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`:

Add to private fields (after line 27):
```javascript
  #contentPluginRegistry;
```

Add to constructor params (at line 49, inside the destructuring):
```javascript
    contentPluginRegistry = null,
```

Add to constructor body (after line 79):
```javascript
    this.#contentPluginRegistry = contentPluginRegistry;
```

Add enrichment call after pool fetch. At line 120 (after `const freshPool = ...`), insert:
```javascript
    // Post-process: content-type enrichment
    if (this.#contentPluginRegistry) {
      this.#contentPluginRegistry.enrich(freshPool);
    }
```

**Step 2: Modify `feed.mjs` router to accept and call registry in `/reader/stream`**

In `backend/src/4_api/v1/routers/feed.mjs`:

Update the destructuring at line 27 to include `contentPluginRegistry`:
```javascript
  const { freshRSSAdapter, headlineService, feedAssemblyService, feedContentService, dismissedItemsStore, sourceAdapters = [], contentPluginRegistry = null, configService, logger = console } = config;
```

In the `/reader/stream` handler, after the `result` variable is finalized (just before `res.json(...)` at line 186), insert enrichment:
```javascript
    // Content-type enrichment (e.g., detect YouTube URLs in FreshRSS items)
    if (contentPluginRegistry) {
      contentPluginRegistry.enrich(result);
    }
```

**Step 3: Wire in `app.mjs`**

In `backend/src/app.mjs`, after the `sourceResolver` instantiation (around line 841), add:

```javascript
    const { ContentPluginRegistry } = await import('./3_applications/feed/services/ContentPluginRegistry.mjs');
    const { YouTubeContentPlugin } = await import('./1_adapters/feed/plugins/youtube.mjs');
    const contentPluginRegistry = new ContentPluginRegistry([
      new YouTubeContentPlugin(),
    ]);
```

Pass to `FeedAssemblyService` constructor (add to the object at line 865):
```javascript
      contentPluginRegistry,
```

Pass to `createFeedRouter` (add to the object at line 877):
```javascript
      contentPluginRegistry,
```

**Step 4: Run existing tests to verify nothing broke**

Run: `npx jest tests/isolated/api/feed/feed.router.test.mjs tests/isolated/application/feed/ContentPluginRegistry.test.mjs --verbose`
Expected: All PASS

**Step 5: Commit**

```bash
git add backend/src/app.mjs backend/src/3_applications/feed/services/FeedAssemblyService.mjs backend/src/4_api/v1/routers/feed.mjs
git commit -m "feat(feed): wire ContentPluginRegistry into Scroll and Reader paths"
```

---

### Task 5: Frontend Content Plugin Registry

**Files:**
- Create: `frontend/src/modules/Feed/contentPlugins/index.js`

**Step 1: Write the registry**

```javascript
// frontend/src/modules/Feed/contentPlugins/index.js
/**
 * Content plugin registry (frontend).
 *
 * Maps `item.contentType` to view-specific renderers.
 * Each plugin exports: { contentType, ScrollBody, ReaderRow }
 *
 * Checked before the source-based body module registry (bodies/index.js).
 */
import { YouTubeScrollBody, YouTubeReaderRow } from './youtube.jsx';

const CONTENT_PLUGINS = [
  { contentType: 'youtube', ScrollBody: YouTubeScrollBody, ReaderRow: YouTubeReaderRow },
];

const pluginMap = new Map(CONTENT_PLUGINS.map(p => [p.contentType, p]));

/**
 * Get content plugin for an item, if any.
 * @param {Object} item - Feed item with optional `contentType` field
 * @returns {{ contentType: string, ScrollBody: Function, ReaderRow: Function } | null}
 */
export function getContentPlugin(item) {
  if (!item?.contentType) return null;
  return pluginMap.get(item.contentType) || null;
}
```

**Step 2: Commit** (will fail to import until youtube.jsx exists — that's Task 6)

No commit yet — this file is committed together with Task 6.

---

### Task 6: YouTube Frontend Plugin — ScrollBody

**Files:**
- Create: `frontend/src/modules/Feed/contentPlugins/youtube.jsx`

Reference: `frontend/src/modules/Feed/Scroll/cards/bodies/MediaBody.jsx` for styling patterns.

**Step 1: Create the YouTube plugin components**

```jsx
// frontend/src/modules/Feed/contentPlugins/youtube.jsx
/**
 * YouTube content plugin renderers.
 *
 * ScrollBody: card body for Scroll masonry view (like MediaBody)
 * ReaderRow: collapsed/expanded row for Reader inbox
 */
import { useState, useRef, useEffect } from 'react';

// =========================================================================
// Scroll Body (masonry card)
// =========================================================================

export function YouTubeScrollBody({ item }) {
  const channelName = item.meta?.channelName || item.meta?.sourceName || 'YouTube';
  const duration = item.meta?.duration;

  const formatDuration = (seconds) => {
    if (!seconds || !Number.isFinite(seconds)) return null;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m} min`;
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="#ff0000" style={{ flexShrink: 0 }}>
          <path d="M21.8 8s-.2-1.4-.8-2c-.7-.8-1.6-.8-2-.8C15.6 5 12 5 12 5s-3.6 0-7 .2c-.4 0-1.3 0-2 .8-.6.6-.8 2-.8 2S2 9.6 2 11.2v1.5c0 1.6.2 3.2.2 3.2s.2 1.4.8 2c.7.8 1.7.8 2.2.8 1.5.2 6.8.2 6.8.2s3.6 0 7-.2c.4-.1 1.3-.1 2-.9.6-.6.8-2 .8-2s.2-1.6.2-3.2v-1.5c0-1.6-.2-3.1-.2-3.1zM9.9 15.1V8.9l5.4 3.1-5.4 3.1z" />
        </svg>
        <span style={{
          display: 'inline-block',
          background: '#ff0000',
          color: '#fff',
          fontSize: '0.6rem',
          fontWeight: 700,
          padding: '0.1rem 0.4rem',
          borderRadius: '4px',
          textTransform: 'uppercase',
        }}>
          {channelName}
        </span>
        {duration && (
          <span style={{ fontSize: '0.6rem', color: '#868e96', marginLeft: 'auto' }}>
            {formatDuration(duration)}
          </span>
        )}
      </div>
      <h3 style={{
        margin: 0,
        fontSize: '0.95rem',
        fontWeight: 500,
        color: '#fff',
        wordBreak: 'break-word',
      }}>
        {item.title}
      </h3>
      {item.body && (
        <p style={{
          margin: '0.25rem 0 0',
          fontSize: '0.8rem',
          color: '#868e96',
          wordBreak: 'break-word',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {item.body}
        </p>
      )}
    </>
  );
}

// =========================================================================
// Reader Row (inbox — replaces ArticleRow internals when contentType=youtube)
// =========================================================================

export function YouTubeReaderRow({ article, onMarkRead }) {
  const [expanded, setExpanded] = useState(false);
  const videoId = article.meta?.videoId;
  const thumbnailUrl = article.image || (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null);
  const channelName = article.meta?.channelName || article.feedTitle || 'YouTube';

  const handleExpand = () => {
    if (!expanded) {
      setExpanded(true);
      if (!article.isRead) onMarkRead?.(article.id);
    } else {
      setExpanded(false);
    }
  };

  const formatTime = (published) => {
    if (!published) return '';
    const d = new Date(published);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.getFullYear() === now.getFullYear()) {
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + time;
  };

  return (
    <div className={`article-row ${expanded ? 'expanded' : ''} ${article.isRead ? 'read' : 'unread'}`}>
      {!expanded ? (
        /* Collapsed: thumbnail + play overlay + title + time */
        <button className="article-row-header youtube-row-header" onClick={handleExpand}>
          {thumbnailUrl && (
            <div className="youtube-thumb-wrapper">
              <img src={thumbnailUrl} alt="" className="youtube-thumb" />
              <span className="youtube-play-badge">&#9654;</span>
            </div>
          )}
          <div className="youtube-row-text">
            <span className="article-title">{article.title}</span>
            <span className="youtube-channel-name">{channelName}</span>
          </div>
          <span className="article-time">{formatTime(article.published)}</span>
        </button>
      ) : (
        /* Expanded: embedded iframe player */
        <div>
          <button className="article-row-header" onClick={handleExpand}>
            <span className="article-title">{article.title}</span>
            <span className="article-time">{formatTime(article.published)}</span>
          </button>
          <div className="article-expanded">
            {videoId && (
              <div className="youtube-embed-wrapper">
                <iframe
                  src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
                  title={article.title}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  className="youtube-embed"
                />
              </div>
            )}
            <div className="article-meta">
              <span>{channelName}</span>
              {article.author && <span> &middot; {article.author}</span>}
              {article.published && <span> &middot; {new Date(article.published).toLocaleString()}</span>}
            </div>
            {article.link && (
              <a
                className="article-source-link"
                href={article.link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                Open on YouTube &rarr;
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit together with the registry**

```bash
git add frontend/src/modules/Feed/contentPlugins/index.js frontend/src/modules/Feed/contentPlugins/youtube.jsx
git commit -m "feat(feed): add frontend content plugin registry + YouTube renderers"
```

---

### Task 7: YouTube Reader CSS

**Files:**
- Modify: `frontend/src/modules/Feed/Reader/Reader.scss:193+` — add YouTube-specific styles

**Step 1: Add YouTube styles**

Append the following after the `.article-source-link` block (around line 381) and before the utility section:

```scss
// ---- YouTube content plugin ----

.youtube-row-header {
  gap: 0.75rem !important;
}

.youtube-thumb-wrapper {
  position: relative;
  flex-shrink: 0;
  width: 120px;
  height: 68px;
  border-radius: 4px;
  overflow: hidden;
  background: #1a1b1e;
}

.youtube-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.youtube-play-badge {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.youtube-row-text {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  flex: 1;
}

.youtube-channel-name {
  font-size: 0.72rem;
  color: #888;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.youtube-embed-wrapper {
  position: relative;
  width: 100%;
  padding-bottom: 56.25%; // 16:9
  margin-bottom: 0.75rem;
  border-radius: 6px;
  overflow: hidden;
  background: #000;
}

.youtube-embed {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: none;
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Feed/Reader/Reader.scss
git commit -m "feat(feed): add YouTube reader row styles"
```

---

### Task 8: Integrate Frontend Plugin into FeedCard + ArticleRow

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/cards/FeedCard.jsx:3,80-81`
- Modify: `frontend/src/modules/Feed/Reader/ArticleRow.jsx:1-2,10-11`

**Step 1: Modify `FeedCard.jsx`**

Add import at line 3 (after `getBodyModule` import):
```javascript
import { getContentPlugin } from '../../contentPlugins/index.js';
```

Replace line 80 (`const BodyModule = getBodyModule(item.source);`):
```javascript
  const contentPlugin = getContentPlugin(item);
  const BodyModule = contentPlugin?.ScrollBody || getBodyModule(item.source);
```

**Step 2: Modify `ArticleRow.jsx`**

Add import at the top (after the existing imports):
```javascript
import { getContentPlugin } from '../../contentPlugins/index.js';
```

At the beginning of the `ArticleRow` function body (line 10, after `export default function ArticleRow({ article, onMarkRead })`), add:
```javascript
  const contentPlugin = getContentPlugin(article);
  if (contentPlugin?.ReaderRow) {
    const PluginRow = contentPlugin.ReaderRow;
    return <PluginRow article={article} onMarkRead={onMarkRead} />;
  }
```

This early-returns before any of ArticleRow's own state/hooks, so the plugin fully replaces the row rendering.

**Important:** Because React hooks cannot be called conditionally, the plugin check must go **before** any `useState`/`useRef`/`useEffect` calls. Move the check to be the very first thing in the function, before the existing `useState` declarations.

Revised approach — wrap the original ArticleRow:

```javascript
export default function ArticleRow({ article, onMarkRead }) {
  const contentPlugin = getContentPlugin(article);
  if (contentPlugin?.ReaderRow) {
    const PluginRow = contentPlugin.ReaderRow;
    return <PluginRow article={article} onMarkRead={onMarkRead} />;
  }
  return <DefaultArticleRow article={article} onMarkRead={onMarkRead} />;
}

function DefaultArticleRow({ article, onMarkRead }) {
  // ... all existing ArticleRow code with hooks ...
}
```

This avoids the conditional-hooks issue entirely.

**Step 3: Run dev server and verify visually**

Run: `npm run dev` (if not already running)
Open the Reader view — YouTube-sourced FreshRSS articles should show with thumbnail + play overlay.
Open the Scroll view — YouTube items from any source should show the red YouTube badge + channel name.

**Step 4: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/cards/FeedCard.jsx frontend/src/modules/Feed/Reader/ArticleRow.jsx
git commit -m "feat(feed): integrate content plugin registry into FeedCard and ArticleRow"
```

---

### Task 9: Integration Test

**Files:**
- Modify: `tests/isolated/api/feed/feed.router.test.mjs` — add test for YouTube enrichment in `/reader/stream`

**Step 1: Add integration test**

Append a new describe block:

```javascript
describe('Content plugin enrichment on /reader/stream', () => {
  test('enriches YouTube URLs from FreshRSS with contentType and videoId', async () => {
    const { ContentPluginRegistry } = await import('#apps/feed/services/ContentPluginRegistry.mjs');
    const { YouTubeContentPlugin } = await import('#adapters/feed/plugins/youtube.mjs');
    const registry = new ContentPluginRegistry([new YouTubeContentPlugin()]);

    const ytMockAdapter = {
      ...mockFreshRSSAdapter,
      getItems: jest.fn().mockResolvedValue({
        items: [{
          id: 'yt-item-1',
          title: 'Cool Video',
          link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          content: '<p>Video description</p>',
          published: new Date('2026-02-18T12:00:00Z'),
          author: null,
          feedTitle: 'My YouTube Channel',
          feedId: 'feed/yt1',
          categories: [],
        }],
        continuation: null,
      }),
      getFeeds: jest.fn().mockResolvedValue([]),
    };

    const ytApp = express();
    ytApp.use(express.json());
    ytApp.use('/api/v1/feed', createFeedRouter({
      freshRSSAdapter: ytMockAdapter,
      headlineService: mockHeadlineService,
      feedAssemblyService: { getNextBatch: jest.fn() },
      feedContentService: { resolveIcon: jest.fn() },
      contentPluginRegistry: registry,
      configService: mockConfigService,
    }));

    const res = await request(ytApp).get('/api/v1/feed/reader/stream?days=3');
    expect(res.status).toBe(200);
    const item = res.body.items[0];
    expect(item.contentType).toBe('youtube');
    expect(item.meta.videoId).toBe('dQw4w9WgXcQ');
    expect(item.meta.playable).toBe(true);
  });
});
```

**Step 2: Run test**

Run: `npx jest tests/isolated/api/feed/feed.router.test.mjs --verbose`
Expected: All PASS

**Step 3: Commit**

```bash
git add tests/isolated/api/feed/feed.router.test.mjs
git commit -m "test(feed): add integration test for YouTube content plugin enrichment"
```

---

### Task 10: Final Verification + Cleanup

**Step 1: Run all feed tests**

Run: `npx jest tests/isolated/adapter/feed/ tests/isolated/application/feed/ tests/isolated/api/feed/ --verbose`
Expected: All PASS

**Step 2: Visual verification**

With dev server running, verify:
- Reader: FreshRSS YouTube articles show thumbnail + play overlay (collapsed), iframe embed (expanded)
- Scroll: YouTube items from any source show red YouTube badge in card body
- Non-YouTube items: unchanged behavior in both views

**Step 3: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "feat(feed): content plugin registry with YouTube support"
```
