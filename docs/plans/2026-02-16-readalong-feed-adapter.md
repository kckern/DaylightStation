# Readalong Feed Adapter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Surface readalong content (scripture, talks) as feed cards with progress-based "next up" chapter selection, scripture text detail view, and audio playback.

**Architecture:** New `ReadalongFeedAdapter` extends `IFeedSourceAdapter`, delegates to the existing `ReadalongAdapter` (content registry) for progress tracking and chapter resolution. Frontend adds a `ScriptureSection` component to the detail view section registry, plus an `AudioSection` for inline playback via the existing `FeedPlayerMiniBar`.

**Tech Stack:** Backend ES modules (.mjs), React JSX, existing `scripture-guide` npm package and `scripture-guide.jsx` frontend lib.

---

### Task 1: Create ReadalongFeedAdapter

**Files:**
- Create: `backend/src/1_adapters/feed/sources/ReadalongFeedAdapter.mjs`

**Step 1: Create the adapter file**

```js
// backend/src/1_adapters/feed/sources/ReadalongFeedAdapter.mjs
/**
 * ReadalongFeedAdapter
 *
 * Surfaces readalong content (scripture, talks, etc.) in the feed scroll.
 * Delegates to the existing ReadalongAdapter for progress-based chapter selection.
 *
 * @module adapters/feed/sources/ReadalongFeedAdapter
 */

import { IFeedSourceAdapter } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

export class ReadalongFeedAdapter extends IFeedSourceAdapter {
  #readalongAdapter;
  #logger;

  /**
   * @param {Object} deps
   * @param {import('../../content/readalong/ReadalongAdapter.mjs').ReadalongAdapter} deps.readalongAdapter
   * @param {Object} [deps.logger]
   */
  constructor({ readalongAdapter, logger = console }) {
    super();
    if (!readalongAdapter) throw new Error('ReadalongFeedAdapter requires readalongAdapter');
    this.#readalongAdapter = readalongAdapter;
    this.#logger = logger;
  }

  get sourceType() { return 'readalong'; }

  /**
   * Fetch the "next up" chapter for a configured collection/volume.
   *
   * @param {Object} query - Query config from YAML
   * @param {string} query.params.collection - Collection name (e.g., 'scripture')
   * @param {string} query.params.volume - Volume name (e.g., 'bom', 'nt')
   * @param {string} _username
   * @returns {Promise<Object[]>} Single FeedItem-shaped object in array
   */
  async fetchItems(query, _username) {
    const { collection, volume } = query.params || {};
    if (!collection || !volume) {
      this.#logger.warn?.('readalong.feed.missing_params', { collection, volume });
      return [];
    }

    try {
      // Use ReadalongAdapter's existing progress-based resolution
      const localId = `${collection}/${volume}`;
      const item = await this.#readalongAdapter.getItem(localId);
      if (!item) return [];

      // Extract heading/summary for card body
      const contentData = item.content?.data || [];
      const firstEntry = contentData[0] || {};
      const heading = firstEntry?.headings?.heading
        || firstEntry?.headings?.summary
        || null;

      return [{
        id: item.id,
        tier: query.tier || 'compass',
        source: 'readalong',
        title: item.title || localId,
        body: heading,
        image: item.thumbnail || null,
        link: null,
        timestamp: new Date().toISOString(),
        priority: query.priority || 5,
        meta: {
          collection,
          volume,
          contentId: item.id,
          audioUrl: item.mediaUrl || null,
          duration: item.duration || 0,
          subtitle: item.subtitle || null,
          sourceName: collection.charAt(0).toUpperCase() + collection.slice(1),
          sourceIcon: item.thumbnail || null,
        },
      }];
    } catch (err) {
      this.#logger.warn?.('readalong.feed.error', { error: err.message, collection, volume });
      return [];
    }
  }

  /**
   * Fetch detail content — full verse data + audio info.
   *
   * @param {string} localId - Local portion of item ID
   * @param {Object} meta - Item meta from scroll response
   * @param {string} _username
   * @returns {Promise<{ sections: Array } | null>}
   */
  async getDetail(localId, meta, _username) {
    try {
      const compoundId = meta?.contentId || `readalong:${localId}`;
      const item = await this.#readalongAdapter.getItem(compoundId);
      if (!item) return null;

      const sections = [];

      // Audio section (if media URL available)
      if (item.mediaUrl) {
        sections.push({
          type: 'player',
          data: { contentId: item.id },
        });
      }

      // Scripture/readalong text section
      if (item.content?.data) {
        sections.push({
          type: 'scripture',
          data: {
            blocks: item.content.data,
            contentType: item.content.type,
          },
        });
      }

      return sections.length > 0 ? { sections } : null;
    } catch (err) {
      this.#logger.warn?.('readalong.detail.error', { error: err.message, localId });
      return null;
    }
  }
}
```

**Step 2: Commit**

```bash
git add backend/src/1_adapters/feed/sources/ReadalongFeedAdapter.mjs
git commit -m "feat(feed): add ReadalongFeedAdapter for scripture/talks feed cards"
```

---

### Task 2: Register adapter in app.mjs bootstrap

**Files:**
- Modify: `backend/src/app.mjs:656-777`

**Step 1: Add import and instantiation**

After the existing adapter imports (line ~664), add:

```js
const { ReadalongFeedAdapter } = await import('./1_adapters/feed/sources/ReadalongFeedAdapter.mjs');
```

After the existing adapter instantiations (after `komgaFeedAdapter`, around line 742), add:

```js
const readalongFeedAdapter = contentRegistry?.get('readalong') ? new ReadalongFeedAdapter({
  readalongAdapter: contentRegistry.get('readalong'),
  logger: rootLogger.child({ module: 'readalong-feed' }),
}) : null;
```

**Step 2: Add to sourceAdapters array**

In the `sourceAdapters` array (line 777), add `readalongFeedAdapter` before `.filter(Boolean)`:

```js
sourceAdapters: [redditAdapter, weatherAdapter, healthAdapter, gratitudeAdapter, stravaAdapter, todoistAdapter, immichAdapter, plexAdapter, journalAdapter, youtubeAdapter, googleNewsAdapter, komgaFeedAdapter, readalongFeedAdapter].filter(Boolean),
```

**Step 3: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat(feed): register ReadalongFeedAdapter in bootstrap"
```

---

### Task 3: Create query config YAML

**Files:**
- Create: `data/household/config/lists/queries/scripture-bom.yml`

**Step 1: Create the query config**

```yaml
type: readalong
tier: compass
limit: 1
priority: 5
params:
  collection: scripture
  volume: bom
```

**Step 2: Commit**

```bash
git add data/household/config/lists/queries/scripture-bom.yml
git commit -m "feat(feed): add scripture-bom query config for readalong feed"
```

---

### Task 4: Create ScriptureSection frontend component

**Files:**
- Create: `frontend/src/modules/Feed/Scroll/detail/sections/ScriptureSection.jsx`
- Modify: `frontend/src/modules/Feed/Scroll/detail/sections/index.jsx`

**Step 1: Create ScriptureSection**

This imports the existing `scripture-guide.jsx` parsing/rendering utilities:

```jsx
import { convertVersesToScriptureData, scriptureDataToJSX } from '../../../../../lib/scripture-guide.jsx';

export default function ScriptureSection({ data }) {
  if (!data?.blocks || !Array.isArray(data.blocks)) return null;

  const blocks = convertVersesToScriptureData(data.blocks);
  return (
    <div className="detail-scripture">
      {scriptureDataToJSX(blocks)}
    </div>
  );
}
```

**Step 2: Register in section index**

In `frontend/src/modules/Feed/Scroll/detail/sections/index.jsx`, add the import:

```jsx
import ScriptureSection from './ScriptureSection.jsx';
```

And add to `SECTION_MAP`:

```js
scripture: ScriptureSection,
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/detail/sections/ScriptureSection.jsx
git add frontend/src/modules/Feed/Scroll/detail/sections/index.jsx
git commit -m "feat(feed): add ScriptureSection for readalong detail view"
```

---

### Task 5: Style the scripture detail view

**Files:**
- Create or modify: `frontend/src/modules/Feed/Scroll/detail/DetailView.scss`

**Step 1: Check existing DetailView.scss for scripture-related styles**

Read `DetailView.scss` to see what's there. The `scripture-guide.jsx` renders with class names like `.scriptures`, `.heading`, `.verse`, `.verse-number`, `.verse-text`, `.background`, `.summary`, `.headnote`. These may need dark-theme styling for the feed detail context.

**Step 2: Add dark-theme scripture styles**

Add styles scoped under `.detail-scripture` to provide dark-theme readability:

```scss
.detail-scripture {
  .scriptures {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 1rem;
    line-height: 1.8;
    color: #c1c2c5;

    h4.heading {
      font-size: 1.1rem;
      font-weight: 600;
      color: #e0e0e0;
      margin: 1.5rem 0 0.5rem;
      text-align: center;
    }

    p.verse {
      margin: 0.25rem 0;
      text-indent: 0;
    }

    p.background,
    p.summary,
    p.headnote {
      font-style: italic;
      color: #868e96;
      margin: 0.5rem 0;
    }

    .verse-number {
      font-weight: 700;
      font-size: 0.75em;
      color: #868e96;
      margin-right: 0.25em;
      vertical-align: super;
    }

    .verse-text {
      color: #c1c2c5;
    }

    blockquote {
      margin: 0.5rem 0 0.5rem 1.5rem;
      padding: 0;
      border: none;
      font-style: italic;
      color: #c1c2c5;

      .verse-text {
        display: block;
        line-height: 1.6;
      }
    }
  }
}
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/detail/DetailView.scss
git commit -m "feat(feed): add dark-theme scripture styles for detail view"
```

---

### Task 6: Manual integration test

**Step 1: Start the dev server**

Check if already running, then start if needed:

```bash
lsof -i :3111
# If not running:
npm run dev
```

**Step 2: Verify the feed API returns a readalong card**

```bash
curl -s http://localhost:3112/api/v1/feed/scroll | jq '.items[] | select(.source == "readalong")'
```

Expected: One item with `source: "readalong"`, a scripture chapter title, and `meta.contentId` starting with `readalong:scripture/`.

**Step 3: Verify detail endpoint returns scripture sections**

Using the item ID from step 2:

```bash
curl -s "http://localhost:3112/api/v1/feed/detail/readalong%3Ascripture%2F...?meta=%7B%22contentId%22%3A%22readalong%3Ascripture%2F...%22%7D" | jq '.sections[].type'
```

Expected: `"player"` and `"scripture"` sections.

**Step 4: Verify in browser**

Open the feed in the browser, find the scripture card, tap it to open the detail view. Confirm:
- Heading is prominent
- Scripture text renders with verse numbers, paragraphs, poetry blocks
- Play button works and activates FeedPlayerMiniBar

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(feed): integration fixes for readalong feed adapter"
```
