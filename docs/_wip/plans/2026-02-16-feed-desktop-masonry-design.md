# Feed Desktop Masonry Layout Design

**Date:** 2026-02-16
**Status:** Draft

## Goal

Make `/feed/scroll` responsive for desktop with a masonry grid layout, modal detail view, and unified FeedCard component — while keeping the current mobile experience unchanged.

## Current State

- Single-column feed, 540px max-width, mobile-first
- Desktop gets empty sidebars flanking the column
- DetailView is a full-page takeover
- Three card components: `FeedCard.jsx` (generic with body modules), `MediaCard.jsx` (photo/plex), mapped in `index.jsx`
- FeedCard already has a body module registry (`BODY_MODULES`) for source-specific rendering

## Design Decisions

| Decision | Choice |
|----------|--------|
| Desktop layout | Masonry grid with CSS `column-width: 320px` auto-fill |
| Detail view | Modal/lightbox with scrim overlay, prev/next arrows |
| Breakpoint | Single at 900px; mobile stays as-is below |
| Card images | Force 16:9 crop (`aspect-ratio: 16/9; object-fit: cover`) |
| Card architecture | All sources consolidated into single `FeedCard.jsx` |
| Content modules | Body modules for card-level; section renderers for detail-level |

---

## 1. Masonry Layout (CSS-only)

### Desktop (>=900px)

```scss
.scroll-items {
  column-width: 320px;
  column-gap: 16px;
  max-width: 1400px;
  margin: 0 auto;
  padding: 1rem 2rem;
}

.scroll-item-wrapper {
  break-inside: avoid;
  margin-bottom: 16px;
}
```

- Auto-fills columns: ~2 at 900px, ~3 at 1100px, ~4 on ultrawide
- Sidebars (`.scroll-sidebar--left`, `.scroll-sidebar--right`) are removed on desktop
- `.scroll-view` drops its `max-width: 540px` and `flex: 0 0 540px` constraints

### Mobile (<900px)

No changes. Single column, 540px max, existing layout.

---

## 2. Modal/Lightbox Detail View

### Desktop behavior

When a card is clicked on desktop (>=900px):

- **Scrim**: Fixed overlay, `background: rgba(0,0,0,0.7)`, click-to-dismiss
- **Modal panel**: Centered, max-width ~640px, max-height ~90vh, `overflow-y: auto`, dark background (`#1a1b1e`), rounded corners
- **Prev/Next arrows**: Large arrow buttons outside the modal on left/right viewport edges, semi-transparent, visible on hover
- **Keyboard**: Left/Right arrows navigate, Escape dismisses (already implemented in DetailView)
- **Scroll preservation**: Masonry grid stays visible behind scrim; scroll position preserved

### Mobile behavior

No changes. DetailView renders as full-page takeover (existing behavior).

### Implementation

- New `DetailModal.jsx` wrapper component that wraps `DetailView` on desktop
- `Scroll.jsx` checks viewport width to decide rendering mode:
  - Desktop: grid stays visible (`display` not set to `none`), DetailModal overlays
  - Mobile: grid hidden, DetailView renders directly (current behavior)
- URL behavior unchanged — `/feed/scroll/{slug}` still works for deep links

### DetailModal structure

```jsx
<div className="detail-modal-scrim" onClick={onBack}>
  <button className="detail-modal-prev" onClick={onPrev}>&#8249;</button>
  <div className="detail-modal-panel" onClick={e => e.stopPropagation()}>
    <DetailView {...props} />
  </div>
  <button className="detail-modal-next" onClick={onNext}>&#8250;</button>
</div>
```

---

## 3. Unified FeedCard

### Fold MediaCard into FeedCard

`MediaCard.jsx` is eliminated. All sources render through `FeedCard.jsx`. The `CARD_MAP` in `index.jsx` simplifies to just `FeedCard` for everything.

### Image area modes

FeedCard's image area supports two modes:

1. **Default** (news, reddit, etc.): Image on top, text content below
2. **Overlay** (photo, plex): Title/subtitle rendered over image with gradient scrim

Mode is determined by source:
```js
const OVERLAY_SOURCES = new Set(['photo', 'plex']);
const useOverlay = item.image && OVERLAY_SOURCES.has(item.source);
```

### 16:9 image crop (desktop masonry)

On desktop, all card images get:
```css
aspect-ratio: 16/9;
object-fit: cover;
```

On mobile, keep current behavior (maxHeight caps).

### New body modules for photo/plex

- **`PhotoBody`**: Memory age ("3 years ago"), location, photo title
- **`PlexBody`**: Play button overlay, inline player state management (lazy-loaded `<Player>`)

### Plex inline player

The inline player currently replaces the entire MediaCard. In unified FeedCard, it replaces the image area + body when active. The card shell (border, source bar) stays visible.

### Full-bleed on mobile

Photo/plex cards currently get full-bleed treatment (negative margins, no border-radius) on mobile via `.scroll-item-wrapper .feed-card-photo`. This stays as a CSS class applied when source is photo/plex, mobile only.

---

## 4. FeedCard Generic Interface

### Standard fields (top to bottom)

1. **Colored left border** — tier-based (`TIER_COLORS`) or dynamic via `colorFromLabel`
2. **Hero image** — optional, 16:9 crop on desktop. Two modes: default (above text) or overlay (text over image)
3. **Source bar** — favicon + source name (uppercase) + age (right-aligned) + optional status dot
4. **Body** — delegated to body module registry
5. **Footer badges** — optional (e.g., overdue tag for tasks)

### Body module registry

```js
const BODY_MODULES = {
  reddit: RedditBody,
  gratitude: GratitudeBody,
  weather: WeatherBody,
  fitness: FitnessBody,
  journal: JournalBody,
  health: HealthBody,
  photo: PhotoBody,     // NEW
  plex: PlexBody,       // NEW
  // everything else: DefaultBody
};
```

### Hover state (desktop only)

Cards get a subtle hover effect on desktop to indicate clickability:
```css
@media (min-width: 900px) {
  .feed-card:hover {
    filter: brightness(1.08);
    cursor: pointer;
  }
}
```

---

## 5. Files Changed

| File | Change |
|------|--------|
| `Scroll.scss` | Masonry layout at >=900px, remove sidebar constraints, hover states |
| `Scroll.jsx` | Conditional modal vs full-page detail, keep grid visible on desktop |
| `FeedCard.jsx` | Add image overlay mode, PhotoBody, PlexBody modules, 16:9 image class |
| `MediaCard.jsx` | **Delete** — functionality folded into FeedCard |
| `cards/index.jsx` | Remove MediaCard from CARD_MAP, everything uses FeedCard |
| `detail/DetailModal.jsx` | **New** — modal/lightbox wrapper for desktop |
| `DetailView.scss` | Desktop modal styles (scrim, panel, arrows) |

---

## 6. What Does NOT Change

- API / backend — no changes
- Mobile layout — stays single-column, full-page detail
- URL routing — `/feed/scroll/{slug}` continues to work
- DetailView internals — sections, renderSection, content all stays
- Data model — no new fields required
