# Content Detail View Design

## Goal

Replace the current "click to play" behavior on search results with a detail view that shows item info (leaves) or children (containers), with play/queue actions available from the detail view. Recursive drill-down for containers, browser history for back navigation.

## Architecture

### Routing

Change `/media` to `/media/*` with nested routes:

- `/media` — ContentBrowser (search/browse, existing behavior)
- `/media/view/:id` — ContentDetailView (detail for any item)

`:id` is the compound content ID (e.g., `plex:12345`, `abs:abc-def`, `readalong:scripture/ot/nirv/1`).

Navigation uses `react-router` v6 `navigate()`. Browser back pops history naturally.

### Component: ContentDetailView (Hybrid Shell)

**Shared shell** (renders for every item):

- **Hero area:** Large thumbnail/artwork, gradient fade to background
- **Title bar:** Title, subtitle (artist/author/season), source badge, format badge
- **Action bar:** Play, Queue, Play Next, Shuffle (containers only), Cast — shown/hidden by capability
- **Body slot:** Type-specific section

**Data fetching:**

- Leaf items → `GET /api/v1/info/{source}/{localId}`
- Container items → `GET /api/v1/list/{source}/{localId}`
- Single `useContentDetail(contentId)` hook detects container vs leaf

### Type-Specific Body Sections

| Type | Body Content |
|------|-------------|
| Album | Tracklist with numbers, durations, per-track play buttons |
| Artist | Album grid/list with thumbnails |
| Show | Season list → episode list with watch progress |
| Movie/Episode | Synopsis, cast/crew, duration, watch progress |
| Track | Album art, artist, album link, duration |
| Scripture | Chapter heading, verse content preview |
| Audiobook | Chapter list with progress, narrator, duration |
| Hymn/Singalong | Lyrics preview, hymn number |
| Collection/Playlist | Ordered item list with thumbnails |

Start with a **generic fallback** body (child list or metadata dump). Add type-specific bodies iteratively.

### Interaction Model

**From search results:**

- Click result info area → `navigate('/media/view/${contentId}')`
- Inline action buttons (play/queue/next/cast) remain for quick actions without opening detail

**Inside detail view:**

- Click child container → `navigate('/media/view/${childId}')` (recursive, pushes history)
- Click child leaf → `navigate('/media/view/${childId}')` (shows leaf info)
- Action buttons on parent detail AND each child row
- Shuffle on containers → resolve all playable children, shuffle
- Play All on containers → queue all children in order

**Back navigation:**

- Browser back pops history
- Visible back arrow in detail header for touch/kiosk
- Back from first detail returns to search results

**Player interaction:**

- Playing from detail view uses existing `queue.playNow()` etc.
- Player mode toggle unchanged
- Detail view state persists in browser history across mode switches

### Styling

- Dark theme consistent with Media app (dark bg, #1db954 green accent)
- Hero: full-width, ~200px, gradient fade, fallback colored placeholder with icon
- Action bar: horizontal buttons, primary action highlighted
- Child rows: similar to search result items (thumbnail, title, metadata, inline actions) plus track number, watch progress
- Fluid layout: single column narrow, potentially two-column wide
