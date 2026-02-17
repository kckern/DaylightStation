# Feed Desktop Masonry Layout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `/feed/scroll` responsive for desktop with masonry grid, modal/lightbox detail view, and unified FeedCard — while keeping mobile unchanged.

**Architecture:** CSS-columns masonry at >=900px breakpoint with auto-fill column widths. Desktop detail view renders in a centered modal/lightbox with prev/next arrows. MediaCard eliminated — all sources render through FeedCard with body modules and an image overlay mode for photo/plex.

**Tech Stack:** React, SCSS, CSS columns for masonry, no new dependencies.

**Design doc:** `docs/_wip/plans/2026-02-16-feed-desktop-masonry-design.md`

---

### Task 1: Fold MediaCard photo/plex into FeedCard — Add Body Modules

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/cards/FeedCard.jsx:308-317` (BODY_MODULES registry)
- Reference: `frontend/src/modules/Feed/Scroll/cards/MediaCard.jsx` (source of logic to port)

**Step 1: Add `memoryAge` helper to FeedCard.jsx**

Add this helper function after the `StatusDot` component (after line 31):

```jsx
function memoryAge(isoDate) {
  if (!isoDate) return null;
  const diff = Date.now() - new Date(isoDate).getTime();
  if (diff < 0) return null;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365.25);
  const remMonths = Math.floor((days - years * 365.25) / 30.44);
  if (remMonths > 0) return `${years} year${years === 1 ? '' : 's'}, ${remMonths} month${remMonths === 1 ? '' : 's'} ago`;
  return `${years} year${years === 1 ? '' : 's'} ago`;
}
```

**Step 2: Add `PhotoBody` module**

Add after `HealthBody` (after line 306):

```jsx
function PhotoBody({ item }) {
  const photoAge = memoryAge(item.meta?.originalDate);
  const location = item.body || item.meta?.location || null;
  return (
    <>
      {(location || photoAge) && (
        <h3 style={{
          margin: 0,
          fontSize: '0.95rem',
          fontWeight: 600,
          color: '#fff',
          lineHeight: 1.25,
          wordBreak: 'break-word',
        }}>
          {location}{location && photoAge ? ' · ' : ''}{photoAge}
        </h3>
      )}
      {item.title && (
        <p style={{
          margin: '0.15rem 0 0',
          fontSize: '0.8rem',
          color: '#868e96',
          wordBreak: 'break-word',
        }}>
          {item.title}
        </p>
      )}
    </>
  );
}
```

**Step 3: Add `PlexBody` module**

Add after `PhotoBody`:

```jsx
function PlexBody({ item }) {
  const subtitle = item.body || null;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
        <span style={{
          display: 'inline-block',
          background: '#fab005',
          color: '#000',
          fontSize: '0.6rem',
          fontWeight: 700,
          padding: '0.1rem 0.4rem',
          borderRadius: '4px',
          textTransform: 'uppercase',
        }}>
          Plex
        </span>
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
      {subtitle && (
        <p style={{
          margin: '0.25rem 0 0',
          fontSize: '0.8rem',
          color: '#868e96',
          wordBreak: 'break-word',
        }}>
          {subtitle}
        </p>
      )}
    </>
  );
}
```

**Step 4: Register new modules in BODY_MODULES**

Update the `BODY_MODULES` object (line 310-317):

```jsx
const BODY_MODULES = {
  reddit: RedditBody,
  gratitude: GratitudeBody,
  weather: WeatherBody,
  fitness: FitnessBody,
  journal: JournalBody,
  health: HealthBody,
  photo: PhotoBody,
  plex: PlexBody,
};
```

**Step 5: Verify visually**

Run: `npm run dev` (if not already running)
Navigate to `http://localhost:3111/feed/scroll`
Confirm: Photo and Plex items still won't use these yet (still routed to MediaCard). But the modules exist for later.

**Step 6: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/cards/FeedCard.jsx
git commit -m "feat(feed): add PhotoBody and PlexBody modules to FeedCard"
```

---

### Task 2: Add Image Overlay Mode to FeedCard

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/cards/FeedCard.jsx:321-431` (main FeedCard component)

Photo and Plex cards render title/subtitle over the image with a gradient scrim, not below it. FeedCard needs an overlay mode for this.

**Step 1: Add overlay source set**

Add after `BODY_MODULES` (after the registry object):

```jsx
const OVERLAY_SOURCES = new Set(['photo', 'plex']);
```

**Step 2: Modify the FeedCard component to support overlay mode**

Replace the current `FeedCard` component (lines 321-431) with:

```jsx
export default function FeedCard({ item }) {
  const tier = item.tier || 'wire';
  const sourceName = item.meta?.sourceName || item.meta?.feedTitle || item.source || '';
  const age = formatAge(item.timestamp);
  const iconUrl = proxyIcon(item.meta?.sourceIcon);
  const borderColor = TIER_COLORS[tier] ?? colorFromLabel(sourceName);
  const useOverlay = item.image && OVERLAY_SOURCES.has(item.source);

  const BodyModule = BODY_MODULES[item.source] || DefaultBody;

  return (
    <div
      className={`feed-card feed-card-${tier}${useOverlay ? ' feed-card-overlay' : ''}`}
      style={{
        display: 'block',
        background: '#25262b',
        borderRadius: '12px',
        borderLeft: useOverlay ? 'none' : `4px solid ${borderColor}`,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Hero image */}
      {item.image && (
        <div style={{ overflow: 'hidden', position: 'relative' }}>
          <img
            src={item.image}
            alt=""
            className="feed-card-image"
            style={{
              width: '100%',
              display: 'block',
              objectFit: 'cover',
            }}
          />
          {/* Plex play button overlay */}
          {item.source === 'plex' && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          )}
          {/* Overlay scrim with body content */}
          {useOverlay && (
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              padding: '2.5rem 1rem 0.75rem',
              background: 'linear-gradient(transparent, rgba(0,0,0,0.75))',
            }}>
              <BodyModule item={item} />
            </div>
          )}
        </div>
      )}

      {/* Standard layout: source bar + body below image */}
      <div style={{ padding: '0.75rem 1rem' }}>
        {/* Source bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          marginBottom: useOverlay ? '0' : '0.35rem',
        }}>
          {item.meta?.status && <StatusDot status={item.meta.status} />}
          {iconUrl && (
            <img
              src={iconUrl}
              alt=""
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                flexShrink: 0,
              }}
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          )}
          <span style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            color: '#868e96',
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {sourceName}
          </span>
          <span style={{
            fontSize: '0.65rem',
            color: '#5c636a',
            marginLeft: 'auto',
            flexShrink: 0,
          }}>
            {age}
          </span>
        </div>

        {/* Body — only render below if NOT overlay mode */}
        {!useOverlay && <BodyModule item={item} />}

        {/* Overdue badge (tasks) */}
        {item.source === 'tasks' && item.meta?.isOverdue && (
          <span style={{
            display: 'inline-block',
            background: '#ff6b6b',
            color: '#fff',
            fontSize: '0.6rem',
            fontWeight: 700,
            padding: '0.1rem 0.4rem',
            borderRadius: '999px',
            marginTop: '0.4rem',
            textTransform: 'uppercase',
          }}>
            Overdue
          </span>
        )}
      </div>
    </div>
  );
}
```

Key changes from original:
- Removed `<a>` wrapper (card click is handled by `Scroll.jsx`'s `handleCardClick`)
- Added `useOverlay` flag for photo/plex
- Overlay mode: body renders inside gradient scrim over image
- Overlay mode: no left border (photo/plex cards look cleaner without it)
- Added Plex play button overlay on image
- Image gets class `feed-card-image` for desktop 16:9 targeting

**Step 3: Verify visually**

Navigate to `http://localhost:3111/feed/scroll`
Confirm: Non-photo/plex cards render normally. Photo/plex still use MediaCard (haven't switched routing yet).

**Step 4: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/cards/FeedCard.jsx
git commit -m "feat(feed): add image overlay mode to FeedCard for photo/plex sources"
```

---

### Task 3: Route All Sources Through FeedCard and Delete MediaCard

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/cards/index.jsx`
- Delete: `frontend/src/modules/Feed/Scroll/cards/MediaCard.jsx`
- Delete: `frontend/src/modules/Feed/Scroll/cards/ExternalCard.jsx`
- Delete: `frontend/src/modules/Feed/Scroll/cards/GroundingCard.jsx`
- Delete: `frontend/src/modules/Feed/Scroll/cards/PlexCard.jsx`
- Delete: `frontend/src/modules/Feed/Scroll/cards/FitnessCard.jsx`
- Delete: `frontend/src/modules/Feed/Scroll/cards/JournalCard.jsx`
- Delete: `frontend/src/modules/Feed/Scroll/cards/WeatherCard.jsx`
- Delete: `frontend/src/modules/Feed/Scroll/ScrollCard.jsx`

**Step 1: Update index.jsx to route everything through FeedCard**

Replace entire file:

```jsx
import FeedCard from './FeedCard.jsx';

export function renderFeedCard(item) {
  return <FeedCard key={item.id} item={item} />;
}

export default {};
```

**Step 2: Verify visually**

Navigate to `http://localhost:3111/feed/scroll`
Confirm: All card types render through FeedCard. Photo/plex cards show overlay mode. Reddit cards show scores. Gratitude cards show italic yellow. Weather/fitness show their custom body modules.

**Step 3: Delete unused card files**

```bash
git rm frontend/src/modules/Feed/Scroll/cards/MediaCard.jsx
git rm frontend/src/modules/Feed/Scroll/cards/ExternalCard.jsx
git rm frontend/src/modules/Feed/Scroll/cards/GroundingCard.jsx
git rm frontend/src/modules/Feed/Scroll/cards/PlexCard.jsx
git rm frontend/src/modules/Feed/Scroll/cards/FitnessCard.jsx
git rm frontend/src/modules/Feed/Scroll/cards/JournalCard.jsx
git rm frontend/src/modules/Feed/Scroll/cards/WeatherCard.jsx
git rm frontend/src/modules/Feed/Scroll/ScrollCard.jsx
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/cards/index.jsx
git commit -m "feat(feed): consolidate all card types into FeedCard, delete legacy card files"
```

---

### Task 4: Masonry Layout for Desktop

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.scss`

**Step 1: Update Scroll.scss for masonry at >=900px**

Replace the existing `@media (min-width: 900px)` block (lines 21-46) and update `.scroll-items` / `.scroll-item-wrapper`:

Replace the entire file with:

```scss
.scroll-layout {
  display: flex;
  min-height: 100vh;
  background: #111;
}

.scroll-sidebar {
  display: none;
}

.scroll-view {
  max-width: 540px;
  width: 100%;
  margin: 0 auto;
  padding: 0.75rem;
  min-height: 100vh;
  background: #111;
}

.scroll-items {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.scroll-item-wrapper {
  cursor: pointer;

  // Photo cards get full-bleed treatment on mobile
  .feed-card-overlay {
    margin: 0 -0.75rem;
    border-radius: 0;
  }
}

// Desktop: masonry grid
@media (min-width: 900px) {
  .scroll-sidebar {
    display: none;
  }

  .scroll-view {
    max-width: 1400px;
    flex: 1;
    padding: 1rem 2rem;
    border: none;
  }

  .scroll-items {
    display: block;
    column-width: 320px;
    column-gap: 16px;
  }

  .scroll-item-wrapper {
    break-inside: avoid;
    margin-bottom: 16px;

    .feed-card-overlay {
      margin: 0;
      border-radius: 12px;
    }
  }

  // 16:9 image crop in masonry
  .feed-card-image {
    aspect-ratio: 16 / 9;
  }

  // Hover state for cards
  .feed-card {
    transition: filter 0.15s ease;

    &:hover {
      filter: brightness(1.1);
    }
  }
}

// Loading skeleton
.scroll-skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 1rem;
}

.scroll-skeleton-card {
  height: 120px;
  background: #1a1b1e;
  border-radius: 12px;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}

@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.7; }
}

// Sentinel and loading
.scroll-sentinel {
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.scroll-loading {
  padding: 1rem;
}

.scroll-loading-dots {
  display: flex;
  gap: 6px;
  justify-content: center;

  span {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #5c636a;
    animation: dot-bounce 1.2s ease-in-out infinite;

    &:nth-child(2) { animation-delay: 0.15s; }
    &:nth-child(3) { animation-delay: 0.3s; }
  }
}

@keyframes dot-bounce {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}

// End states
.scroll-end,
.scroll-empty {
  text-align: center;
  padding: 2rem 1rem;
  color: #5c636a;
  font-size: 0.85rem;
}

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
    max-width: 640px;
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

**Step 2: Verify visually**

- **Mobile** (resize browser < 900px): Single column, photo cards full-bleed, same as before.
- **Desktop** (resize browser >= 900px): Cards arrange in masonry columns (~2 at 900px, ~3 at 1100px). Images are 16:9 cropped. Cards have subtle hover brightness.

**Step 3: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/Scroll.scss
git commit -m "feat(feed): masonry grid layout for desktop at >=900px"
```

---

### Task 5: Create DetailModal Component

**Files:**
- Create: `frontend/src/modules/Feed/Scroll/detail/DetailModal.jsx`
- Modify: `frontend/src/modules/Feed/Scroll/detail/DetailView.scss` (add modal styles)

**Step 1: Create DetailModal.jsx**

```jsx
import DetailView from './DetailView.jsx';
import './DetailView.scss';

export default function DetailModal({ item, sections, ogImage, ogDescription, loading, onBack, onNext, onPrev, onPlay, activeMedia }) {
  return (
    <div className="detail-modal-scrim" onClick={onBack}>
      {onPrev && (
        <button
          className="detail-modal-arrow detail-modal-arrow--left"
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
          aria-label="Previous item"
        >
          &#8249;
        </button>
      )}
      <div className="detail-modal-panel" onClick={(e) => e.stopPropagation()}>
        <DetailView
          item={item}
          sections={sections}
          ogImage={ogImage}
          ogDescription={ogDescription}
          loading={loading}
          onBack={onBack}
          onNext={onNext}
          onPrev={onPrev}
          onPlay={onPlay}
          activeMedia={activeMedia}
        />
      </div>
      {onNext && (
        <button
          className="detail-modal-arrow detail-modal-arrow--right"
          onClick={(e) => { e.stopPropagation(); onNext(); }}
          aria-label="Next item"
        >
          &#8250;
        </button>
      )}
    </div>
  );
}
```

**Step 2: Add modal styles to DetailView.scss**

Append to the end of `frontend/src/modules/Feed/Scroll/detail/DetailView.scss`:

```scss

// ─── Desktop Modal/Lightbox ────────────────────────────────
.detail-modal-scrim {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}

.detail-modal-panel {
  position: relative;
  max-width: 640px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  border-radius: 12px;
  border: 1px solid #25262b;
  background: #111;

  // Override DetailView styles inside modal
  .detail-view {
    max-width: none;
    min-height: auto;
    border-radius: 12px;
  }
}

.detail-modal-arrow {
  position: fixed;
  top: 50%;
  transform: translateY(-50%);
  z-index: 210;
  background: rgba(255, 255, 255, 0.08);
  border: none;
  color: rgba(255, 255, 255, 0.5);
  font-size: 2.5rem;
  width: 48px;
  height: 80px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;

  &:hover {
    background: rgba(255, 255, 255, 0.15);
    color: #fff;
  }

  &--left {
    left: 1rem;
  }

  &--right {
    right: 1rem;
  }
}

// Hide arrows on narrow screens (modal shouldn't appear, but safety)
@media (max-width: 899px) {
  .detail-modal-scrim {
    display: none;
  }
}
```

**Step 3: Verify file created**

Run: `ls frontend/src/modules/Feed/Scroll/detail/DetailModal.jsx`
Expected: File exists.

**Step 4: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/detail/DetailModal.jsx
git add frontend/src/modules/Feed/Scroll/detail/DetailView.scss
git commit -m "feat(feed): add DetailModal lightbox component for desktop"
```

---

### Task 6: Update Scroll.jsx for Desktop Modal vs Mobile Full-Page

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.jsx`

This is the integration task. On desktop, the grid stays visible and DetailModal overlays it. On mobile, the existing full-page behavior continues.

**Step 1: Add imports and viewport hook**

Add after existing imports (after line 7):

```jsx
import DetailModal from './detail/DetailModal.jsx';
```

**Step 2: Add `useIsDesktop` hook inside the component**

Add inside the `Scroll` component, after the state declarations (after line 40):

```jsx
// Viewport-aware rendering
const [isDesktop, setIsDesktop] = useState(
  typeof window !== 'undefined' && window.innerWidth >= 900
);
useEffect(() => {
  const mql = window.matchMedia('(min-width: 900px)');
  const handler = (e) => setIsDesktop(e.matches);
  mql.addEventListener('change', handler);
  return () => mql.removeEventListener('change', handler);
}, []);
```

**Step 3: Modify the scroll-view visibility logic**

Replace line 208:
```jsx
<div className="scroll-view" style={{ display: urlSlug ? 'none' : undefined }}>
```

With:
```jsx
<div className="scroll-view" style={{ display: (urlSlug && !isDesktop) ? 'none' : undefined }}>
```

On desktop, grid stays visible when detail is open. On mobile, grid is hidden as before.

**Step 4: Modify the scroll position restore to skip on desktop**

Replace the `window.scrollTo(0, 0)` calls in the detail fetch effect (lines 118, 135). These should only scroll to top on mobile:

Line 118 — replace `window.scrollTo(0, 0);` with:
```jsx
if (!isDesktop) window.scrollTo(0, 0);
```

Line 135 — replace `window.scrollTo(0, 0);` with:
```jsx
if (!isDesktop) window.scrollTo(0, 0);
```

**Step 5: Render DetailModal on desktop, DetailView on mobile**

Replace the `selectedItem && (` block (lines 236-249) with:

```jsx
{selectedItem && isDesktop && (
  <DetailModal
    item={selectedItem}
    sections={detailData?.sections || []}
    ogImage={detailData?.ogImage || null}
    ogDescription={detailData?.ogDescription || null}
    loading={detailLoading}
    onBack={handleBack}
    onNext={currentIdx < items.length - 1 ? () => handleNav(1) : null}
    onPrev={currentIdx > 0 ? () => handleNav(-1) : null}
    onPlay={(item) => setActiveMedia(item ? { item } : null)}
    activeMedia={activeMedia}
  />
)}
{selectedItem && !isDesktop && (
  <DetailView
    item={selectedItem}
    sections={detailData?.sections || []}
    ogImage={detailData?.ogImage || null}
    ogDescription={detailData?.ogDescription || null}
    loading={detailLoading}
    onBack={handleBack}
    onNext={currentIdx < items.length - 1 ? () => handleNav(1) : null}
    onPrev={currentIdx > 0 ? () => handleNav(-1) : null}
    onPlay={(item) => setActiveMedia(item ? { item } : null)}
    activeMedia={activeMedia}
  />
)}
```

**Step 6: Prevent body scroll when modal is open on desktop**

Add a new effect after the existing effects (after the scroll-restore effect, ~line 166):

```jsx
// Prevent body scroll when modal is open on desktop
useEffect(() => {
  if (urlSlug && isDesktop) {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }
}, [urlSlug, isDesktop]);
```

**Step 7: Verify visually**

- **Desktop (>=900px):** Click a card — masonry grid stays visible behind dark scrim, detail appears in centered modal with prev/next arrows. Escape/click scrim dismisses. Arrow keys navigate. Body doesn't scroll behind modal.
- **Mobile (<900px):** Click a card — full-page detail view, grid hidden. Same as before.
- **Deep link:** Navigate directly to `/feed/scroll/{slug}` — works on both desktop and mobile.
- **Back button:** Browser back returns to scroll list on both.

**Step 8: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/Scroll.jsx
git commit -m "feat(feed): desktop modal detail view, mobile full-page preserved"
```

---

### Task 7: Skeleton and Loading States for Desktop

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.jsx:188-201` (skeleton)
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.scss` (skeleton masonry)

**Step 1: Update skeleton to use masonry on desktop**

The loading skeleton (lines 188-201 of Scroll.jsx) renders 3 skeleton cards in a column. On desktop, render more cards so the masonry skeleton looks natural.

Replace the skeleton rendering (lines 192-195):

```jsx
{[1, 2, 3, 4, 5, 6].map(i => (
  <div key={i} className="scroll-skeleton-card" />
))}
```

**Step 2: Add varied skeleton heights for masonry effect**

Add to `Scroll.scss` inside the `@media (min-width: 900px)` block:

```scss
  .scroll-skeleton {
    display: block;
    column-width: 320px;
    column-gap: 16px;
  }

  .scroll-skeleton-card {
    break-inside: avoid;
    margin-bottom: 16px;

    &:nth-child(odd) { height: 200px; }
    &:nth-child(even) { height: 160px; }
  }
```

**Step 3: Verify visually**

Reload the page — skeleton should appear as masonry grid on desktop, single column on mobile.

**Step 4: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/Scroll.jsx frontend/src/modules/Feed/Scroll/Scroll.scss
git commit -m "feat(feed): masonry skeleton loading state for desktop"
```

---

### Task 8: Final Polish and Edge Cases

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.jsx` (minor fixes)
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.scss` (minor fixes)

**Step 1: Remove sidebar divs from JSX**

The sidebars (`scroll-sidebar--left` and `scroll-sidebar--right`) are no longer used on desktop (masonry fills the space). Remove them from Scroll.jsx.

In the loading return (lines 190, 198) and main return (lines 207, 250), remove:
```jsx
<div className="scroll-sidebar scroll-sidebar--left" />
```
and:
```jsx
<div className="scroll-sidebar scroll-sidebar--right" />
```

There are 4 sidebar divs total to remove (2 in skeleton, 2 in main render).

**Step 2: Remove sidebar styles from Scroll.scss**

Remove the `.scroll-sidebar` rule (it's no longer needed — was already set to `display: none` on mobile and we removed the desktop override).

**Step 3: Verify end-to-end**

Full test checklist:
- [ ] Mobile single-column layout works
- [ ] Desktop masonry grid renders
- [ ] Photo/plex cards show overlay mode
- [ ] All other cards show standard layout
- [ ] Clicking a card on desktop opens modal
- [ ] Prev/next arrows work in modal
- [ ] Escape/scrim click dismisses modal
- [ ] Keyboard arrows navigate in modal
- [ ] Clicking a card on mobile opens full-page detail
- [ ] Back button works on both
- [ ] Deep link to `/feed/scroll/{slug}` works
- [ ] Infinite scroll loads more items
- [ ] Mini player bar shows when media is playing

**Step 4: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/Scroll.jsx frontend/src/modules/Feed/Scroll/Scroll.scss
git commit -m "chore(feed): remove unused sidebar elements, clean up layout"
```

---

### Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | PhotoBody + PlexBody modules | FeedCard.jsx |
| 2 | Image overlay mode | FeedCard.jsx |
| 3 | Route all to FeedCard, delete legacy cards | index.jsx, 8 deleted files |
| 4 | Masonry CSS layout | Scroll.scss |
| 5 | DetailModal component | DetailModal.jsx (new), DetailView.scss |
| 6 | Desktop modal vs mobile full-page | Scroll.jsx |
| 7 | Masonry skeleton loading | Scroll.jsx, Scroll.scss |
| 8 | Polish: remove sidebars, edge cases | Scroll.jsx, Scroll.scss |
