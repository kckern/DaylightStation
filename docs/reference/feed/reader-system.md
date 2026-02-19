# Reader System

The Reader is a 2-column Google Reader-style inbox for browsing FreshRSS feed subscriptions. It provides category/feed filtering, adaptive time grouping, infinite scroll pagination, and mark-as-read — backed by the FreshRSS Google Reader (GReader) API.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FreshRSS Server                             │
│  Google Reader API: /api/greader.php/reader/api/0/                  │
│  ├─ subscription/list   (feeds + categories)                        │
│  ├─ stream/contents     (articles from reading-list or feed stream) │
│  └─ edit-tag            (mark read/unread)                          │
└────────────────────────────┬────────────────────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────────────┐
│  Backend                   │                                        │
│                            │                                        │
│  FreshRSSFeedAdapter       │  GReader API wrapper                   │
│  ├─ getFeeds()             │  Per-user auth via data/auth/freshrss  │
│  ├─ getCategories()        │                                        │
│  ├─ getItems()             │  Continuation-based pagination         │
│  ├─ markRead()             │                                        │
│  └─ markUnread()           │                                        │
│                            │                                        │
│  Feed API Router           │  /api/v1/feed/reader/*                 │
│  ├─ GET  /feeds            │  List subscriptions                    │
│  ├─ GET  /categories       │  List categories                       │
│  ├─ GET  /items            │  Single-feed item fetch                │
│  ├─ GET  /stream           │  Smart stream (two modes)              │
│  └─ POST /items/mark       │  Mark read/unread                      │
└────────────────────────────┬────────────────────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────────────┐
│  Frontend                  │                                        │
│                            │                                        │
│  Reader.jsx                │  Orchestrator — state, fetch, grouping │
│  ├─ ReaderSidebar.jsx      │  Category/feed filter panel            │
│  └─ ArticleRow.jsx         │  Expandable article accordion          │
│                            │                                        │
│  Reader.scss               │  Responsive layout + mobile drawer     │
└─────────────────────────────────────────────────────────────────────┘
```

### Files

| File | Purpose |
|------|---------|
| `backend/src/1_adapters/feed/FreshRSSFeedAdapter.mjs` | GReader API wrapper (auth, fetch, pagination) |
| `backend/src/4_api/v1/routers/feed.mjs` | Reader API routes (stream, feeds, mark) |
| `frontend/src/modules/Feed/Reader/Reader.jsx` | Main component — state, fetching, grouping |
| `frontend/src/modules/Feed/Reader/ReaderSidebar.jsx` | Sidebar with category/feed filters |
| `frontend/src/modules/Feed/Reader/ArticleRow.jsx` | Article row with accordion expand |
| `frontend/src/modules/Feed/Reader/Reader.scss` | Styles + responsive + mobile drawer |
| `tests/live/flow/feed/feed-reader-inbox.runtime.test.mjs` | 8 Playwright UI tests |
| `tests/live/flow/feed/feed-reader-ai-explained.runtime.test.mjs` | Filtered-feed adaptive grouping test |

---

## Backend: Stream Endpoint

`GET /api/v1/feed/reader/stream` is the primary data endpoint. It operates in two modes depending on whether feeds are being filtered.

### Two Fetch Modes

| | Unfiltered (default) | Filtered (feeds param set) |
|---|---|---|
| **Stream source** | `user/-/state/com.google/reading-list` | Single feed: feed's own stream ID; Multi-feed: reading-list + post-filter |
| **Batch size** | 200 items fetched, trimmed to N distinct days | 50 per page (single feed) or 200 + filter (multi) |
| **Day trimming** | Yes — `?days=3` (default) limits to 3 distinct calendar days | No — returns all items in the batch |
| **Continuation** | Synthetic (microsecond timestamp of oldest trimmed item) or FreshRSS native | FreshRSS native continuation token |
| **Exhaustion** | `exhausted = false` when day-trimming produces a continuation; true only when FreshRSS returns no more | `exhausted = true` when FreshRSS returns no continuation and items < fetchCount |

### Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `days` | number | 3 | (Unfiltered only) Number of distinct calendar days to include |
| `count` | number | 50/200 | Items to fetch from FreshRSS |
| `continuation` | string | — | Pagination cursor (FreshRSS microsecond timestamp) |
| `excludeRead` | string | — | `"true"` to exclude read items |
| `feeds` | string | — | Comma-separated feed IDs to filter by |

### Item Enrichment

Each raw GReader item is enriched before returning:

| Field | Source |
|-------|--------|
| `isRead` | `user/-/state/com.google/read` tag presence (exact match, not substring) |
| `preview` | First 200 chars of content with HTML stripped |
| `tags` | Category labels extracted from `/label/` categories |
| `feedSiteUrl` | For YouTube: channel URL from feed XML URL; otherwise: feed URL origin |

### Continuation Token Format

FreshRSS GReader continuation tokens are **microsecond timestamps** (16 digits, e.g., `1771443079678903`). When the backend generates a synthetic continuation from day-trimming, it uses:

```javascript
String(Math.floor(new Date(oldest.published).getTime() * 1000))
```

`getTime()` returns milliseconds — multiply by 1000 for microseconds. Using `/ 1000` (seconds) produces a 10-digit token that FreshRSS interprets as ~1970, returning 0 items.

### Day-Based Trimming (Unfiltered Only)

The unfiltered stream fetches 200 items from the reading-list, then trims to the first N distinct calendar days:

1. Walk items chronologically, tracking distinct `year-month-day` keys
2. Include items while `distinctDays.size < targetDays` or the item belongs to an already-seen day
3. Stop at the first item from a new day beyond the limit
4. If trimmed: generate synthetic continuation from oldest included item, set `exhausted = false`

This means the initial load shows a manageable window (e.g., 3 days) while infinite scroll loads deeper pages.

---

## Frontend: Reader Component

### State

| State | Type | Purpose |
|-------|------|---------|
| `feeds` | Array | All subscriptions from `/reader/feeds` |
| `articles` | Array | Current article list (appended on scroll) |
| `continuation` | string/null | Next-page cursor |
| `exhausted` | boolean | True when no more content exists |
| `activeFeeds` | Set | Feed IDs currently filtered (empty = show all) |
| `collapsedGroups` | Set | Group keys that are collapsed |
| `drawerOpen` | boolean | Mobile sidebar drawer visibility |
| `loading` / `loadingMore` | boolean | Loading states for initial/append |

### Fetch Logic

`fetchStream(continuation, append)` builds the API call:

- **Unfiltered** (`activeFeeds` empty): `?days=3`
- **Filtered** (`activeFeeds` has entries): `?count=50&feeds=id1,id2,...`
- **Pagination**: passes `?continuation=...` when appending

Changing `activeFeeds` triggers a fresh fetch (via `useCallback` dependency → `useEffect`).

### Infinite Scroll

An `IntersectionObserver` watches a sentinel div at the bottom of the article list. When visible (with 200px root margin), it calls `fetchStream(continuation, true)` to append the next page. The sentinel is only rendered when `continuation` is non-null.

### Filtering

| Action | Behavior |
|--------|----------|
| Click feed name | Toggle that feed in `activeFeeds` (replaces selection unless Ctrl/Cmd held) |
| Click category label | Toggle all feeds in that category |
| Click "View All" | Clear `activeFeeds` entirely |
| Expand a filtered category (click arrow) | Auto-removes that category's filter |
| Mobile: any filter action | Also closes the drawer |

### Mark as Read

- **Single article**: Expanding an unread article fires `POST /reader/items/mark` with `action: "read"` and optimistically sets `isRead: true`
- **Group batch**: "Mark all read" button on group headers collects all unread IDs in the group and fires a single batch mark-read call

---

## Adaptive Time Grouping

Articles are grouped into collapsible sections with time-based headers. The grouping level adapts to data density.

### Grouping Levels

| Level | Key Format | Label Example |
|-------|-----------|---------------|
| Day | `2026-1-18` | "Today", "Yesterday", "Fri, Feb 6" |
| Week | `2026-1-13` (Monday) | "Week of Feb 10" |
| Month | `2026-1` | "February 2026" |
| Season | `2026-0` | "Winter 2026" |
| Year | `2026` | "2026" |

### Season Mapping

| Months | Season | Year Rule |
|--------|--------|-----------|
| Dec (11) | Winter | Next year (Dec 2025 → Winter 2026) |
| Jan–Feb (0–1) | Winter | Same year |
| Mar–May (2–4) | Spring | Same year |
| Jun–Aug (5–7) | Summer | Same year |
| Sep–Nov (8–10) | Fall | Same year |

### `smartGroup(articles, isFiltered)` Algorithm

1. **Unfiltered mode**: always returns day grouping (the 3-day window is dense enough)
2. **Filtered mode**: iterates through groupers in order: day → week → month → season → year
3. For each grouper, computes `avg = articles.length / groups.length`
4. Returns the first grouping where `avg >= 3` (at least 3 articles per group on average)
5. Fallback: year grouping (coarsest)

**Example**: AI Explained feed has 15 articles across 15 different days. Day grouping gives avg 1.0, week gives ~2.1, month gives ~2.5, season gives **7.5** → season grouping is selected, producing "Winter 2026" (7) and "Fall 2025" (8).

---

## Sidebar: ReaderSidebar Component

### Category Organization

Feeds are grouped by their first category label (from FreshRSS), sorted alphabetically with "Uncategorized" last. All categories start collapsed.

### Split Click Targets

The category header has two click zones:

| Element | Click Action |
|---------|-------------|
| Arrow (▾) | Expand/collapse the category to show/hide feeds. If expanding a category whose feeds are all actively filtered, auto-removes that filter. |
| Category label | Filter by all feeds in the category (toggles all on/off). Replaces current selection unless Ctrl/Cmd held. |

### Active State

- Individual feed: highlighted when its ID is in `activeFeeds`
- Category header: highlighted when **all** its feeds are in `activeFeeds`

---

## ArticleRow Component

Each article renders as a single-line row that expands into an accordion on click.

### Collapsed State

```
[favicon] [title...] · Feed Name · [preview text...]     [time] [tag]
```

- **Favicon**: Google CDN for most feeds; proxied via `/api/v1/feed/icon` for YouTube channels (resolves og:image from channel page)
- **Title**: truncates with ellipsis (flex shrinkable)
- **Feed name**: italic, middot-delimited, hidden on mobile
- **Preview**: first 200 chars of content, emojis stripped, hidden on mobile
- **Time**: relative ("5m ago", "3h ago") or absolute ("Feb 6 2:30 PM")
- **Tag**: colored badge from first FreshRSS label

### Expanded State

Shows article metadata (feed title, author, date), full HTML content (capped at 400px with fade gradient, "Read more" to uncap), and "Open original" link.

### Read/Unread Styling

| State | Row background | Title color | Preview color |
|-------|---------------|-------------|---------------|
| Unread | `#fffde7` (pale yellow) | `#1a1b1e` (dark) | `#999` |
| Read | white | `#666` (gray) | `#bbb` (lighter) |

---

## Mobile Responsive (≤768px)

### Layout Changes

| Desktop | Mobile |
|---------|--------|
| 2-column grid (220px sidebar + inbox) | Single column, full width |
| Sidebar always visible | Sidebar hidden; hamburger menu opens drawer |
| Feed name + preview shown | Hidden to save space |
| Title max-width 40% | Title max-width 70% |

### Hamburger + Drawer

- **Toolbar**: inline row at top of inbox with hamburger icon and filter status text ("All Articles" or "2 feeds selected")
- **Drawer**: 260px fixed panel sliding from left with dark backdrop overlay
- **Auto-close**: selecting a feed/category/clear-all closes the drawer automatically

### No Horizontal Scroll

Enforced at multiple levels:
- `.reader-inbox`: `overflow-x: hidden`
- `.article-row`: `overflow: hidden`
- `.article-row-header`: `overflow: hidden; min-width: 0`
- `.article-title`: `flex: 0 1 auto` (shrinkable with ellipsis)
- `.article-expanded`: `overflow-x: hidden; word-break: break-word`
- `.article-content`: `max-width: 100%`

---

## API Reference

### `GET /api/v1/feed/reader/feeds`

Returns all FreshRSS subscriptions with categories.

### `GET /api/v1/feed/reader/categories`

Returns category list.

### `GET /api/v1/feed/reader/stream`

Smart stream with two modes. See [Two Fetch Modes](#two-fetch-modes) above.

**Response:**
```json
{
  "items": [{ "id": "...", "title": "...", "isRead": false, "preview": "...", ... }],
  "continuation": "1771443079678903",
  "exhausted": false
}
```

### `GET /api/v1/feed/reader/items`

Direct item fetch for a single feed. Requires `?feed=<feedId>`.

### `POST /api/v1/feed/reader/items/mark`

Mark items as read or unread.

**Body:**
```json
{
  "itemIds": ["tag:google.com,2005:reader/item/00064b1e3b810bb7"],
  "action": "read"
}
```

---

## Tests

### `feed-reader-inbox.runtime.test.mjs` (8 tests)

| Test | Validates |
|------|-----------|
| 2-column layout + day groups | Grid structure, day headers present |
| Article row elements | Title, favicon, time, feed name, preview |
| Accordion expand/collapse | Click to expand, content visible, collapse |
| Mark as read on expand | Fires POST /items/mark, optimistic class update |
| Sidebar categories collapsed by default | Arrow has `.collapsed`, no feed items visible |
| Feed filter toggle | Click feed → active class, filtered stream, deselect returns to full |
| Day-based batching | Initial load ≤3 day groups |
| Infinite scroll | Scrolling loads more articles beyond initial batch |

### `feed-reader-ai-explained.runtime.test.mjs` (1 test)

Validates adaptive grouping end-to-end: opens reader, expands Tech category, filters AI Explained, verifies articles load from full backlog (not limited to 3-day window), checks that sparse feed uses coarser grouping (season/year instead of daily), and confirms "End of Available Articles" appears when feed is exhausted.
