# Content Detail View Redesign

## Problem

The current `ContentDetailView` uses a full-width 200px hero banner that crops wide images badly. The vertical stack of title/meta/actions/children wastes horizontal space on the center panel.

## Design

### Layout: Horizontal Split Header + Children Below

```
+------------------------------------------+
| <- Back > Movies > Star Wars             |  breadcrumbs (existing)
+-------------+----------------------------+
|             | Star Wars                  |  title (h2)
|   POSTER    | Lucasfilm . 1977 . 2h5m    |  metadata chips
|   33% w     | movie                      |  format/type badge
|   cover     |                            |
|   tall/sq   | "A long time ago..."       |  tagline (italic)
|             | Luke Skywalker joins...    |  summary (3-line clamp + "more")
|             |                            |
|             | [> Play] [> All] [+Queue]  |  action buttons
|             | [Shuffle] [Cast]           |
+-------------+----------------------------+
| 12 Episodes                     list|grid|  children header + toggle
+------------------------------------------+
| (children in list or grid view)          |
+------------------------------------------+
```

### Poster (Left Column)

- 33% width of the detail view
- `object-fit: cover` with `aspect-ratio: 2/3` (portrait default)
- Wide images detected via `naturalWidth > naturalHeight` get `aspect-ratio: 1` (square crop)
- Max-height ~300px, border-radius 8px
- On mobile: full-width, max-height 200px, centered

### Info (Right Column)

- **Title**: h2, same style as current
- **Metadata chips**: horizontal flex-wrap row. Render only what exists:
  - year
  - studio / label / artist
  - duration (formatted as Xh Ym)
  - genre (if available)
  - source badge
  - format badge
- **Tagline**: italic, muted color, only if present
- **Summary**: `line-clamp: 3` by default with a "more/less" text toggle
- **Action buttons**: same buttons as current, flex-wrap row below summary

### Children Section

- **Header row**: "{count} {type}" label on left (e.g. "12 Episodes", "8 Tracks"), list/grid toggle icons on right
- **Toggle state**: persisted in `localStorage` as `media:childrenView` (`list` | `grid`)
- **List mode**: current row layout (thumb + title + meta + hover actions)
- **Grid mode**: CSS grid, 3 columns on desktop, 2 on mobile. Each card: square thumbnail, title below (1-line clamp), meta line below that. Click = drill-down, hover shows play overlay

### Mobile Responsive

- Below tablet breakpoint: poster stacks on top (full-width, shorter), info below
- Children grid: 2 columns
- Everything else flows naturally from flex-direction change

### Files Changed

1. `frontend/src/modules/Media/ContentDetailView.jsx` — restructure JSX
2. `frontend/src/Apps/MediaApp.scss` — replace `.content-detail-*` styles

### Files NOT Changed

- `ContentBrowserPanel.jsx` — breadcrumb wrapper stays as-is
- All callback logic (playNow, playNext, addToQueue, shuffle, drillDown) stays identical
- API layer unchanged
- No new dependencies

## Implementation Tasks

1. Restructure `ContentDetailView.jsx` JSX: replace hero banner with poster+info horizontal layout
2. Add summary expand/collapse state
3. Add children list/grid toggle with localStorage persistence
4. Add grid view rendering for children
5. Replace SCSS: delete `.content-detail-hero*`, add new `.detail-header`, `.detail-poster`, `.detail-info`, `.detail-children-header`, `.detail-children-grid` styles
6. Mobile responsive breakpoints
