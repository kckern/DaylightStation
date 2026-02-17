# Feed Level 2 Detail View — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a detail view to the feed scroll — tapping a card shows expanded content (articles, comments, stats, player) in the center column, with persistent playback via a mini bar.

**Architecture:** New `GET /feed/detail/:itemId` backend endpoint dispatches to per-adapter `getDetail()` methods returning typed `sections[]`. Frontend hides the scroll (preserving position) and renders a `DetailView` with section renderers. A `FeedPlayer` wraps the existing `Player` component for persistent media playback with a collapsible mini bar.

**Tech Stack:** Express (backend), React (frontend), existing Player component, ContentIdResolver for media routing.

**Design doc:** `docs/_wip/plans/2026-02-16-feed-level2-detail-view-design.md`

---

## Phase 1: Backend — Detail API

### Task 1: Add `getDetail` to adapter interface and assembly service

**Files:**
- Modify: `backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs`
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`

**Step 1: Add `getDetail` to the interface**

In `IFeedSourceAdapter.mjs`, add a default `getDetail` method that returns `null` (opt-in, not required):

```js
// After fetchItems (line 27), before closing brace
  /**
   * Fetch detail content for a specific item.
   * Optional — adapters that don't support detail return null.
   *
   * @param {string} localId - The local portion of the item ID
   * @param {Object} meta - The item's meta object from the scroll response
   * @param {string} username - Current user
   * @returns {Promise<{ sections: Array<{ type: string, data: Object }> } | null>}
   */
  async getDetail(localId, meta, username) {
    return null;
  }
```

**Step 2: Add `getDetail` dispatch to FeedAssemblyService**

Add a new public method to `FeedAssemblyService` after `getNextBatch`:

```js
  /**
   * Fetch detail sections for a specific feed item.
   * @param {string} itemId - Full item ID (e.g. "reddit:abc123")
   * @param {Object} itemMeta - The item's meta object (passed from frontend)
   * @param {string} username
   * @returns {Promise<{ sections: Array } | null>}
   */
  async getDetail(itemId, itemMeta, username) {
    const colonIdx = itemId.indexOf(':');
    if (colonIdx === -1) return null;

    const source = itemId.slice(0, colonIdx);
    const localId = itemId.slice(colonIdx + 1);

    // Check registered source adapters
    const adapter = this.#sourceAdapters.get(source);
    if (adapter && typeof adapter.getDetail === 'function') {
      const result = await adapter.getDetail(localId, itemMeta || {}, username);
      return result;
    }

    // Built-in sources (freshrss, headlines) — delegate to feedContentService for article extraction
    if ((source === 'freshrss' || source === 'headlines' || source === 'googlenews') && itemMeta?.link) {
      return this.#getArticleDetail(itemMeta.link);
    }

    return null;
  }

  async #getArticleDetail(url) {
    if (!this.#feedContentService) return null;
    try {
      const result = await this.#feedContentService.extractReadableContent(url);
      return {
        sections: [
          { type: 'article', data: { title: result.title, html: result.content, wordCount: result.wordCount } },
        ],
      };
    } catch {
      return null;
    }
  }
```

Also update the constructor to accept and store `feedContentService`:

```js
// In the constructor, add to destructuring:
this.#feedContentService = feedContentService || null;
// Add private field:
#feedContentService;
```

**Step 3: Wire feedContentService into FeedAssemblyService in app.mjs**

In `backend/src/app.mjs`, where `FeedAssemblyService` is constructed (~line 737), add `feedContentService` to the constructor args. The `feedContentService` is already instantiated earlier in `app.mjs`.

**Step 4: Commit**

```
feat(feed): add getDetail interface and assembly service dispatch
```

---

### Task 2: Add detail API route

**Files:**
- Modify: `backend/src/4_api/v1/routers/feed.mjs`

**Step 1: Add the route**

After the `/scroll` route (line 129), add:

```js
  // =========================================================================
  // Detail (level 2 expanded content)
  // =========================================================================

  router.get('/detail/:itemId', asyncHandler(async (req, res) => {
    const { itemId } = req.params;
    if (!itemId) return res.status(400).json({ error: 'itemId required' });

    const username = getUsername();
    // Parse meta from query string (frontend sends the scroll item's meta as JSON)
    let meta = {};
    if (req.query.meta) {
      try { meta = JSON.parse(req.query.meta); } catch { /* ignore */ }
    }
    // Also accept link directly for convenience
    if (req.query.link) meta.link = req.query.link;

    const result = await feedAssemblyService.getDetail(itemId, meta, username);
    if (!result) return res.status(404).json({ error: 'No detail available' });

    res.json(result);
  }));
```

**Step 2: Commit**

```
feat(feed): add GET /feed/detail/:itemId route
```

---

## Phase 2: Backend — Adapter `getDetail` Implementations

### Task 3: Reddit adapter getDetail

**Files:**
- Modify: `backend/src/1_adapters/feed/sources/RedditFeedAdapter.mjs`

**Step 1: Add getDetail method**

The `meta` object from the scroll response includes `postId` and `subreddit`. Use Reddit's JSON API to fetch full selftext and top comments:

```js
  async getDetail(localId, meta, _username) {
    const postId = meta.postId || localId;
    const subreddit = meta.subreddit || 'all';
    try {
      const res = await fetch(
        `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/comments/${encodeURIComponent(postId)}.json`,
        { headers: { 'User-Agent': 'DaylightStation/1.0' } }
      );
      if (!res.ok) return null;
      const data = await res.json();

      const post = data?.[0]?.data?.children?.[0]?.data;
      const comments = data?.[1]?.data?.children || [];

      const sections = [];

      // Full selftext body
      if (post?.selftext) {
        sections.push({ type: 'body', data: { text: post.selftext } });
      }

      // Comments
      const commentItems = comments
        .filter(c => c.kind === 't1' && c.data?.body)
        .slice(0, 25)
        .map(c => ({
          author: c.data.author,
          body: c.data.body,
          score: c.data.score,
          depth: c.data.depth || 0,
        }));

      if (commentItems.length > 0) {
        sections.push({ type: 'comments', data: { items: commentItems } });
      }

      return { sections };
    } catch (err) {
      this.#logger.warn?.('reddit.detail.error', { error: err.message, postId });
      return null;
    }
  }
```

**Step 2: Commit**

```
feat(feed): add Reddit adapter getDetail (selftext + comments)
```

---

### Task 4: YouTube adapter getDetail

**Files:**
- Modify: `backend/src/1_adapters/feed/sources/YouTubeFeedAdapter.mjs`

**Step 1: Add getDetail method**

Returns an embed section (no API call needed — the videoId is in the localId):

```js
  async getDetail(localId, meta, _username) {
    const videoId = meta.videoId || localId;
    const sections = [];

    sections.push({
      type: 'embed',
      data: {
        provider: 'youtube',
        url: `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1`,
        aspectRatio: '16:9',
      },
    });

    // Full description if available
    if (meta.description) {
      sections.push({ type: 'body', data: { text: meta.description } });
    }

    return { sections };
  }
```

**Step 2: Commit**

```
feat(feed): add YouTube adapter getDetail (embed + description)
```

---

### Task 5: Grounding adapters getDetail (health, fitness, weather, gratitude, journal, tasks)

**Files:**
- Modify: `backend/src/1_adapters/feed/sources/HealthFeedAdapter.mjs`
- Modify: `backend/src/1_adapters/feed/sources/StravaFeedAdapter.mjs`
- Modify: `backend/src/1_adapters/feed/sources/WeatherFeedAdapter.mjs`
- Modify: `backend/src/1_adapters/feed/sources/GratitudeFeedAdapter.mjs`
- Modify: `backend/src/1_adapters/feed/sources/JournalFeedAdapter.mjs`
- Modify: `backend/src/1_adapters/feed/sources/TodoistFeedAdapter.mjs`

**Step 1: Add getDetail to each**

These adapters repackage their existing `meta` into section format. No additional API calls needed.

**HealthFeedAdapter:**
```js
  async getDetail(localId, meta, _username) {
    const items = [];
    if (meta.weight?.lbs) items.push({ label: 'Weight', value: `${meta.weight.lbs} lbs` });
    if (meta.weight?.trend != null) items.push({ label: 'Trend', value: `${meta.weight.trend > 0 ? '+' : ''}${meta.weight.trend}` });
    if (meta.steps) items.push({ label: 'Steps', value: meta.steps.toLocaleString() });
    if (meta.nutrition?.calories) items.push({ label: 'Calories', value: String(meta.nutrition.calories) });
    if (meta.nutrition?.protein) items.push({ label: 'Protein', value: `${meta.nutrition.protein}g` });
    if (items.length === 0) return null;
    return { sections: [{ type: 'stats', data: { items } }] };
  }
```

**StravaFeedAdapter:**
```js
  async getDetail(localId, meta, _username) {
    const items = [];
    if (meta.type) items.push({ label: 'Type', value: meta.type });
    if (meta.minutes) items.push({ label: 'Duration', value: `${Math.round(meta.minutes)} min` });
    if (meta.avgHeartrate) items.push({ label: 'Avg HR', value: `${Math.round(meta.avgHeartrate)} bpm` });
    if (meta.maxHeartrate) items.push({ label: 'Max HR', value: `${Math.round(meta.maxHeartrate)} bpm` });
    if (meta.sufferScore) items.push({ label: 'Suffer Score', value: String(meta.sufferScore) });
    if (items.length === 0) return null;
    return { sections: [{ type: 'stats', data: { items } }] };
  }
```

**WeatherFeedAdapter:**
```js
  async getDetail(localId, meta, _username) {
    const items = [];
    if (meta.tempF != null) items.push({ label: 'Temperature', value: `${meta.tempF}°F` });
    if (meta.feelsF != null) items.push({ label: 'Feels Like', value: `${meta.feelsF}°F` });
    if (meta.cloud != null) items.push({ label: 'Cloud Cover', value: `${meta.cloud}%` });
    if (meta.precip != null) items.push({ label: 'Precipitation', value: `${meta.precip} mm` });
    if (meta.aqi) items.push({ label: 'AQI', value: String(meta.aqi) });
    if (items.length === 0) return null;
    return { sections: [{ type: 'stats', data: { items } }] };
  }
```

**GratitudeFeedAdapter:**
```js
  async getDetail(localId, meta, _username) {
    return null; // Body is already fully shown in scroll card
  }
```

**JournalFeedAdapter:**
```js
  async getDetail(localId, meta, _username) {
    return null; // Full message is already in the card title
  }
```

**TodoistFeedAdapter:**
```js
  async getDetail(localId, meta, _username) {
    const sections = [];
    const items = [];
    if (meta.taskPriority) items.push({ label: 'Priority', value: `P${meta.taskPriority}` });
    if (meta.projectId) items.push({ label: 'Project', value: meta.projectId });
    if (meta.labels?.length) items.push({ label: 'Labels', value: meta.labels.join(', ') });
    if (items.length > 0) sections.push({ type: 'metadata', data: { items } });
    return sections.length > 0 ? { sections } : null;
  }
```

**Step 2: Commit**

```
feat(feed): add getDetail to grounding adapters
```

---

### Task 6: Media adapters getDetail (Plex, Immich)

**Files:**
- Modify: `backend/src/1_adapters/feed/sources/PlexFeedAdapter.mjs`
- Modify: `backend/src/1_adapters/feed/sources/ImmichFeedAdapter.mjs`

**Step 1: Plex getDetail — player section + metadata**

```js
  async getDetail(localId, meta, _username) {
    const sections = [];

    // Player section — uses contentId format for ContentIdResolver
    sections.push({ type: 'player', data: { contentId: `plex:${localId}` } });

    // Metadata from what we already have
    const items = [];
    if (meta.type) items.push({ label: 'Type', value: meta.type });
    if (meta.year) items.push({ label: 'Year', value: String(meta.year) });
    if (items.length > 0) sections.push({ type: 'metadata', data: { items } });

    return { sections };
  }
```

**Step 2: Immich getDetail — player (if video) or media (if image) + metadata**

```js
  async getDetail(localId, meta, _username) {
    const sections = [];

    // Try to determine if this is a video or image via the content registry
    let isVideo = false;
    let exifItems = [];
    const immichAdapter = this.#contentRegistry?.get('immich');
    if (immichAdapter && typeof immichAdapter.getViewable === 'function') {
      try {
        const viewable = await immichAdapter.getViewable(localId);
        isVideo = viewable?.metadata?.type === 'VIDEO';
        const exif = viewable?.metadata?.exif;
        if (exif) {
          if (exif.make) exifItems.push({ label: 'Camera', value: `${exif.make} ${exif.model || ''}`.trim() });
          if (exif.lensModel) exifItems.push({ label: 'Lens', value: exif.lensModel });
          if (exif.fNumber) exifItems.push({ label: 'Aperture', value: `f/${exif.fNumber}` });
          if (exif.iso) exifItems.push({ label: 'ISO', value: String(exif.iso) });
          if (exif.city) exifItems.push({ label: 'Location', value: exif.city });
        }
      } catch { /* proceed without EXIF */ }
    }

    if (isVideo) {
      sections.push({ type: 'player', data: { contentId: `immich:${localId}` } });
    } else {
      sections.push({
        type: 'media',
        data: { images: [{ url: `/api/v1/proxy/immich/assets/${localId}/original`, caption: meta.location || null }] },
      });
    }

    if (exifItems.length > 0) {
      sections.push({ type: 'metadata', data: { items: exifItems } });
    }

    return { sections };
  }
```

**Step 3: Commit**

```
feat(feed): add getDetail to Plex and Immich adapters (player + metadata)
```

---

### Task 7: Google News adapter getDetail

**Files:**
- Modify: `backend/src/1_adapters/feed/sources/GoogleNewsFeedAdapter.mjs`

Google News items have no body in the RSS — detail must extract the article via the link. But the link goes through a Google redirect. The adapter can return a hint to use the article extractor:

```js
  async getDetail(localId, meta, _username) {
    // Google News links redirect to the real article
    // The assembly service handles article extraction via feedContentService
    // Return null to let the built-in fallback in FeedAssemblyService handle it
    return null;
  }
```

Since Google News uses `source: 'googlenews'`, the `FeedAssemblyService.getDetail()` built-in fallback already handles it (added in Task 1). No adapter-level code needed — the `getDetail` base class returns `null`, and the assembly service's built-in fallback for `googlenews` kicks in.

**Commit:**
```
chore(feed): confirm googlenews detail handled by assembly service fallback
```

---

## Phase 3: Frontend — Detail View Navigation

### Task 8: Add detail state management to Scroll.jsx

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.jsx`
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.scss`

**Step 1: Add state and fetch logic**

Add to Scroll.jsx:

```js
// New state
const [selectedItem, setSelectedItem] = useState(null);
const [detailData, setDetailData] = useState(null);
const [detailLoading, setDetailLoading] = useState(false);
const [activeMedia, setActiveMedia] = useState(null);

// Detail fetch function
const fetchDetail = useCallback(async (item) => {
  setSelectedItem(item);
  setDetailData(null);
  setDetailLoading(true);
  try {
    const params = new URLSearchParams();
    if (item.link) params.set('link', item.link);
    if (item.meta) params.set('meta', JSON.stringify(item.meta));
    const result = await DaylightAPI(`/api/v1/feed/detail/${encodeURIComponent(item.id)}?${params}`);
    setDetailData(result);
  } catch (err) {
    console.error('Detail fetch failed:', err);
    setDetailData(null);
  } finally {
    setDetailLoading(false);
  }
}, []);

// Back handler
const handleBack = useCallback(() => {
  setSelectedItem(null);
  setDetailData(null);
}, []);
```

**Step 2: Update the card click handler**

Replace the existing double-tap `handleCardClick` with a single-tap handler that opens the detail view:

```js
const handleCardClick = useCallback((e, item) => {
  // Don't intercept if user clicked a link
  if (e.target.closest('a[href]')) return;
  e.preventDefault();
  fetchDetail(item);
}, [fetchDetail]);
```

**Step 3: Conditionally hide scroll, show detail**

In the JSX, the scroll-view gets `style={{ display: selectedItem ? 'none' : undefined }}`, and `DetailView` renders when `selectedItem` is set:

```jsx
<div className="scroll-layout">
  <div className="scroll-sidebar scroll-sidebar--left" />
  <div className="scroll-view" style={{ display: selectedItem ? 'none' : undefined }}>
    {/* existing scroll items */}
  </div>
  {selectedItem && (
    <DetailView
      item={selectedItem}
      sections={detailData?.sections || []}
      loading={detailLoading}
      onBack={handleBack}
      onPlay={(item) => setActiveMedia({ item })}
      activeMedia={activeMedia}
    />
  )}
  <div className="scroll-sidebar scroll-sidebar--right" />
  {activeMedia && !selectedItem && (
    <FeedPlayerMiniBar
      item={activeMedia.item}
      onOpen={() => fetchDetail(activeMedia.item)}
      onClose={() => setActiveMedia(null)}
    />
  )}
</div>
```

**Step 4: Remove ContentDrawer import and expandedItemId state**

Remove the `expandedItemId` state, `lastTapRef`, double-tap logic, and the `ContentDrawer` component from the JSX. Remove the import.

**Step 5: Commit**

```
feat(feed): add detail view navigation state to Scroll.jsx
```

---

### Task 9: Create DetailView.jsx

**Files:**
- Create: `frontend/src/modules/Feed/Scroll/detail/DetailView.jsx`
- Create: `frontend/src/modules/Feed/Scroll/detail/DetailView.scss`

**Step 1: Create DetailView component**

```jsx
import { formatAge, proxyIcon, colorFromLabel } from '../cards/utils.js';
import { renderSection } from './sections/index.jsx';
import './DetailView.scss';

export default function DetailView({ item, sections, loading, onBack, onPlay, activeMedia }) {
  const sourceName = item.meta?.sourceName || item.source || '';
  const iconUrl = proxyIcon(item.meta?.sourceIcon);
  const borderColor = colorFromLabel(sourceName);
  const age = formatAge(item.timestamp);

  return (
    <div className="detail-view">
      {/* Sticky header */}
      <div className="detail-header" style={{ borderBottom: `2px solid ${borderColor}` }}>
        <button className="detail-back" onClick={onBack} aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
        </button>
        <div className="detail-header-source">
          {iconUrl && <img src={iconUrl} alt="" className="detail-header-icon" onError={(e) => { e.target.style.display = 'none'; }} />}
          <span className="detail-header-label">{sourceName}</span>
          <span className="detail-header-age">{age}</span>
        </div>
        {item.link && (
          <a href={item.link} target="_blank" rel="noopener noreferrer" className="detail-external" aria-label="Open original">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
            </svg>
          </a>
        )}
      </div>

      {/* Hero image */}
      {item.image && !sections.some(s => s.type === 'player' || s.type === 'embed') && (
        <div className="detail-hero">
          <img src={item.image} alt="" />
        </div>
      )}

      {/* Title */}
      <div className="detail-title-area">
        <h2 className="detail-title">{item.title}</h2>
        {item.body && <p className="detail-subtitle">{item.body}</p>}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="detail-loading">
          <div className="scroll-loading-dots"><span /><span /><span /></div>
        </div>
      )}

      {/* Sections */}
      {!loading && sections.map((section, i) => (
        <div key={i} className="detail-section">
          {renderSection(section, { onPlay, activeMedia, item })}
        </div>
      ))}
    </div>
  );
}
```

**Step 2: Create DetailView.scss**

```scss
.detail-view {
  max-width: 540px;
  width: 100%;
  margin: 0 auto;
  min-height: 100vh;
  background: #111;
  color: #e0e0e0;
}

.detail-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  background: #111;
}

.detail-back {
  background: none;
  border: none;
  color: #868e96;
  cursor: pointer;
  padding: 0.25rem;
  display: flex;
  align-items: center;
  flex-shrink: 0;

  &:hover { color: #fff; }
}

.detail-header-source {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex: 1;
  overflow: hidden;
}

.detail-header-icon {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  flex-shrink: 0;
}

.detail-header-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: #868e96;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-header-age {
  font-size: 0.65rem;
  color: #5c636a;
  flex-shrink: 0;
}

.detail-external {
  color: #5c636a;
  display: flex;
  align-items: center;
  padding: 0.25rem;
  flex-shrink: 0;

  &:hover { color: #228be6; }
}

.detail-hero {
  img {
    width: 100%;
    display: block;
    max-height: 400px;
    object-fit: cover;
  }
}

.detail-title-area {
  padding: 0.75rem 1rem;
}

.detail-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: #fff;
  line-height: 1.3;
}

.detail-subtitle {
  margin: 0.3rem 0 0;
  font-size: 0.85rem;
  color: #868e96;
  line-height: 1.4;
}

.detail-loading {
  display: flex;
  justify-content: center;
  padding: 2rem;
}

.detail-section {
  padding: 0 1rem 0.75rem;
}
```

**Step 3: Commit**

```
feat(feed): create DetailView component with header, hero, sections
```

---

### Task 10: Create section renderers

**Files:**
- Create: `frontend/src/modules/Feed/Scroll/detail/sections/index.jsx`
- Create: `frontend/src/modules/Feed/Scroll/detail/sections/BodySection.jsx`
- Create: `frontend/src/modules/Feed/Scroll/detail/sections/ArticleSection.jsx`
- Create: `frontend/src/modules/Feed/Scroll/detail/sections/CommentsSection.jsx`
- Create: `frontend/src/modules/Feed/Scroll/detail/sections/StatsSection.jsx`
- Create: `frontend/src/modules/Feed/Scroll/detail/sections/MetadataSection.jsx`
- Create: `frontend/src/modules/Feed/Scroll/detail/sections/EmbedSection.jsx`
- Create: `frontend/src/modules/Feed/Scroll/detail/sections/MediaSection.jsx`
- Create: `frontend/src/modules/Feed/Scroll/detail/sections/ActionsSection.jsx`
- Create: `frontend/src/modules/Feed/Scroll/detail/sections/PlayerSection.jsx`

**Step 1: Create section registry (index.jsx)**

```jsx
import BodySection from './BodySection.jsx';
import ArticleSection from './ArticleSection.jsx';
import CommentsSection from './CommentsSection.jsx';
import StatsSection from './StatsSection.jsx';
import MetadataSection from './MetadataSection.jsx';
import EmbedSection from './EmbedSection.jsx';
import MediaSection from './MediaSection.jsx';
import ActionsSection from './ActionsSection.jsx';
import PlayerSection from './PlayerSection.jsx';

const SECTION_MAP = {
  body: BodySection,
  article: ArticleSection,
  comments: CommentsSection,
  stats: StatsSection,
  metadata: MetadataSection,
  embed: EmbedSection,
  media: MediaSection,
  actions: ActionsSection,
  player: PlayerSection,
};

export function renderSection(section, context) {
  const Component = SECTION_MAP[section.type];
  if (!Component) return null;
  return <Component data={section.data} {...context} />;
}
```

**Step 2: Create each section renderer**

**BodySection.jsx** — plain text block:
```jsx
export default function BodySection({ data }) {
  if (!data?.text) return null;
  return (
    <div style={{ fontSize: '0.9rem', color: '#c1c2c5', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
      {data.text}
    </div>
  );
}
```

**ArticleSection.jsx** — rendered HTML article content:
```jsx
export default function ArticleSection({ data }) {
  if (!data?.html) return null;
  return (
    <div
      className="detail-article"
      style={{ fontSize: '0.9rem', color: '#c1c2c5', lineHeight: 1.7 }}
      dangerouslySetInnerHTML={{ __html: data.html }}
    />
  );
}
```

**CommentsSection.jsx** — threaded comment list:
```jsx
export default function CommentsSection({ data }) {
  if (!data?.items?.length) return null;
  return (
    <div>
      {data.items.map((c, i) => (
        <div key={i} style={{
          padding: '0.5rem 0',
          borderBottom: '1px solid #1e1f23',
          marginLeft: `${Math.min(c.depth || 0, 3) * 12}px`,
        }}>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.2rem' }}>
            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#228be6' }}>{c.author}</span>
            {c.score != null && (
              <span style={{ fontSize: '0.65rem', color: '#5c636a' }}>{c.score} pts</span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#c1c2c5', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
            {c.body}
          </p>
        </div>
      ))}
    </div>
  );
}
```

**StatsSection.jsx** — grid of label/value pairs:
```jsx
export default function StatsSection({ data }) {
  if (!data?.items?.length) return null;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
      gap: '0.5rem',
    }}>
      {data.items.map(s => (
        <div key={s.label} style={{
          background: '#1a1b1e',
          borderRadius: '8px',
          padding: '0.5rem',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '0.6rem', color: '#5c636a', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</div>
          <div style={{ fontSize: '0.95rem', color: '#fff', fontWeight: 600, marginTop: '0.15rem' }}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}
```

**MetadataSection.jsx** — vertical key-value list:
```jsx
export default function MetadataSection({ data }) {
  if (!data?.items?.length) return null;
  return (
    <div>
      {data.items.map(m => (
        <div key={m.label} style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '0.35rem 0',
          borderBottom: '1px solid #1e1f23',
        }}>
          <span style={{ fontSize: '0.75rem', color: '#5c636a', textTransform: 'uppercase' }}>{m.label}</span>
          <span style={{ fontSize: '0.8rem', color: '#c1c2c5' }}>{m.value}</span>
        </div>
      ))}
    </div>
  );
}
```

**EmbedSection.jsx** — responsive iframe:
```jsx
export default function EmbedSection({ data }) {
  if (!data?.url) return null;
  const [w, h] = (data.aspectRatio || '16:9').split(':').map(Number);
  const paddingTop = `${(h / w) * 100}%`;
  return (
    <div style={{ position: 'relative', width: '100%', paddingTop, background: '#000', borderRadius: '8px', overflow: 'hidden' }}>
      <iframe
        src={data.url}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
        allow="autoplay; encrypted-media"
        allowFullScreen
      />
    </div>
  );
}
```

**MediaSection.jsx** — full-width images:
```jsx
export default function MediaSection({ data }) {
  if (!data?.images?.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {data.images.map((img, i) => (
        <div key={i}>
          <img src={img.url} alt="" style={{ width: '100%', display: 'block', borderRadius: '8px' }} />
          {img.caption && (
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#5c636a', textAlign: 'center' }}>{img.caption}</p>
          )}
        </div>
      ))}
    </div>
  );
}
```

**ActionsSection.jsx** — button row:
```jsx
import { DaylightAPI } from '../../../../lib/api.mjs';

const STYLES = {
  primary: { background: '#228be6', color: '#fff' },
  danger: { background: '#ff6b6b', color: '#fff' },
  default: { background: '#25262b', color: '#c1c2c5' },
};

export default function ActionsSection({ data }) {
  if (!data?.items?.length) return null;

  const handleAction = async (action) => {
    try {
      await DaylightAPI(action.endpoint, action.body || {}, action.method || 'POST');
    } catch (err) {
      console.error('Action failed:', err);
    }
  };

  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.5rem' }}>
      {data.items.map(action => (
        <button
          key={action.id}
          onClick={() => handleAction(action)}
          style={{
            ...STYLES[action.style] || STYLES.default,
            border: 'none',
            borderRadius: '8px',
            padding: '0.5rem 1rem',
            fontSize: '0.8rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
```

**PlayerSection.jsx** — renders the Player or triggers playback:
```jsx
import { lazy, Suspense } from 'react';

const Player = lazy(() => import('../../../../Player/Player.jsx'));

export default function PlayerSection({ data, onPlay, activeMedia, item }) {
  if (!data?.contentId) return null;

  const isPlaying = activeMedia?.item?.id === item?.id;

  if (isPlaying) {
    return (
      <div style={{ borderRadius: '8px', overflow: 'hidden', background: '#000' }}>
        <Suspense fallback={
          <div style={{ height: '240px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#868e96' }}>
            Loading player...
          </div>
        }>
          <Player
            play={{ contentId: data.contentId }}
            clear={() => onPlay?.(null)}
            ignoreKeys
            playerType="feed"
          />
        </Suspense>
      </div>
    );
  }

  return (
    <button
      onClick={() => onPlay?.(item)}
      style={{
        width: '100%',
        padding: '1rem',
        background: '#1a1b1e',
        border: '1px solid #25262b',
        borderRadius: '8px',
        color: '#fff',
        fontSize: '0.85rem',
        fontWeight: 600,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.5rem',
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
        <path d="M8 5v14l11-7z" />
      </svg>
      Play
    </button>
  );
}
```

**Step 3: Commit**

```
feat(feed): create all section renderers for detail view
```

---

## Phase 4: Frontend — FeedPlayer & Mini Bar

### Task 11: Create FeedPlayerMiniBar

**Files:**
- Create: `frontend/src/modules/Feed/Scroll/FeedPlayerMiniBar.jsx`
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.scss`

**Step 1: Create the mini bar component**

```jsx
import { formatAge } from './cards/utils.js';

export default function FeedPlayerMiniBar({ item, onOpen, onClose }) {
  if (!item) return null;

  return (
    <div className="feed-mini-bar" onClick={onOpen}>
      <div className="feed-mini-bar-info">
        <span className="feed-mini-bar-source">{item.meta?.sourceName || item.source}</span>
        <span className="feed-mini-bar-title">{item.title}</span>
      </div>
      <button
        className="feed-mini-bar-close"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Stop playback"
      >
        &times;
      </button>
    </div>
  );
}
```

**Step 2: Add mini bar styles to Scroll.scss**

```scss
// Mini player bar
.feed-mini-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1rem;
  background: #1a1b1e;
  border-top: 1px solid #25262b;
  cursor: pointer;
  max-width: 540px;
  margin: 0 auto;
}

@media (min-width: 900px) {
  .feed-mini-bar {
    // Position within the center column on wide screens
    left: 50%;
    transform: translateX(-50%);
  }
}

.feed-mini-bar-info {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.feed-mini-bar-source {
  font-size: 0.6rem;
  color: #5c636a;
  text-transform: uppercase;
  font-weight: 600;
}

.feed-mini-bar-title {
  font-size: 0.8rem;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.feed-mini-bar-close {
  background: none;
  border: none;
  color: #868e96;
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  flex-shrink: 0;

  &:hover { color: #fff; }
}
```

**Step 3: Commit**

```
feat(feed): create FeedPlayerMiniBar component
```

---

### Task 12: Wire everything together in Scroll.jsx

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.jsx`

**Step 1: Final integration**

Update imports:
```js
import DetailView from './detail/DetailView.jsx';
import FeedPlayerMiniBar from './FeedPlayerMiniBar.jsx';
```

Remove imports:
```js
// Remove: import ContentDrawer from './ContentDrawer.jsx';
```

The full integrated state and JSX structure is described in Task 8. This task is about final assembly and testing.

**Step 2: Verify the complete flow**

1. Load `/feed/scroll` — cards render as before
2. Tap a card — detail view replaces scroll, back button works, scroll position preserved
3. Tap a Plex/media card — play button shows in detail, clicking it starts playback
4. Navigate back while playing — mini bar appears at bottom
5. Tap mini bar — reopens detail for that item
6. Close mini bar — playback stops

**Step 3: Commit**

```
feat(feed): wire detail view and mini player into scroll layout
```

---

## Phase 5: Cleanup

### Task 13: Remove ContentDrawer

**Files:**
- Delete: `frontend/src/modules/Feed/Scroll/ContentDrawer.jsx`

ContentDrawer is fully superseded by the detail view. After confirming everything works, remove the file.

**Commit:**
```
refactor(feed): remove ContentDrawer, superseded by detail view
```

---

## Execution Order & Dependencies

```
Task 1 (interface + assembly) ──→ Task 2 (route)
                                     │
Task 3 (reddit detail) ─────────────┤
Task 4 (youtube detail) ────────────┤
Task 5 (grounding details) ─────────┤ (all independent, can parallelize)
Task 6 (media details) ─────────────┤
Task 7 (googlenews detail) ─────────┘
                                     │
Task 8 (scroll state) ──→ Task 9 (DetailView) ──→ Task 10 (sections)
                                                          │
Task 11 (mini bar) ──→ Task 12 (final wiring) ──→ Task 13 (cleanup)
```

Tasks 3-7 are independent and can be parallelized. Tasks 8-10 are the frontend critical path. Task 11-12 can happen after the detail view is working.
