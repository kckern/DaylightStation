# Reader Inbox Redesign — Design Document

**Date:** 2026-02-18
**Status:** Approved

## Overview

Replace the current 3-column FreshRSS Reader with a 2-column Google Reader-style inbox. Left sidebar for category/feed filtering, main area for a unified chronological article list with accordion expand.

## Layout

2-column grid: sidebar (~220px fixed) + main content (1fr).

```
┌──────────────┬──────────────────────────────────────────────────┐
│  SIDEBAR     │  MAIN INBOX                                     │
│  ~220px      │                                                  │
│              │  ── Today ──────────────────────────────────────  │
│  ▾ Tech      │  ■ Title       Preview text here...       2h ago │
│    Ars Tech  │    Title       Preview text fills...      4h ago │
│    Hacker N  │  ■ Title       Rest of the line...        6h ago │
│              │                                                  │
│  ▾ News      │  ── Yesterday ─────────────────────────────────  │
│    BBC       │    Title       Preview text...           11:30am │
│    Reuters   │  ■ Title       More preview...            9:15am │
│              │                                                  │
│  ▸ Gaming    │  ── Feb 16 ────────────────────────────────────  │
│              │    ...                                           │
│              │                                                  │
│              │  ── Loading more... ────────────────────────────  │
└──────────────┴──────────────────────────────────────────────────┘
```

## Article Row — Collapsed

```
[■] Source Tag  Article Title (bold if unread)  Preview text fills line...  2h ago
```

- **Bold title** for unread articles, normal weight for read
- **Source tag** — small inline colored label from feed category (e.g. `Tech`, `News`)
- **1-line preview** — truncated excerpt from article body/content, fills remaining horizontal space, lighter color
- **Time** — right-aligned. Relative for today/yesterday ("2h ago", "11:30am"), date for older ("Feb 16")
- Compact row height, minimal padding

## Article Row — Expanded (Accordion)

```
┌──────────────────────────────────────────────────────────┐
│ Article Title                                            │
│ Source Name · Author · Feb 17, 2026 3:45 PM              │
│──────────────────────────────────────────────────────────│
│ Article content (HTML rendered)                           │
│ Images constrained to max-height: 300px                  │
│                                                          │
│ ─── Read more ───  (if content exceeds ~400px)           │
│                                                          │
│ Open original article →                                  │
└──────────────────────────────────────────────────────────┘
```

- Max-height ~400px on content area, "Read more" button expands fully
- Images: `max-height: 300px`, `object-fit: contain`
- Source link prominently visible at bottom
- Expanding marks article as read (triggers POST to FreshRSS)

## Sidebar

### Structure

Categories from FreshRSS displayed as collapsible sections. Each category contains its subscribed feeds as filter toggles.

### Filter Behavior

- **Default:** All feeds shown (no filters active)
- **Click a feed:** Filter to that feed only (highlighted)
- **Click another feed:** Replaces current filter (single-select default)
- **Ctrl/Cmd+click:** Adds to filter selection (multi-select)
- **Click active filter:** Deselects it; returns to "all" if none remain
- **Category header click:** Toggles collapse/expand of that category group
- **No unread counts** — clean sidebar, unread state visible only via bold in main list

## Data Flow

### New Backend Endpoint

`GET /api/v1/feed/reader/stream`

Uses FreshRSS GReader API reading-list stream (`user/-/state/com.google/reading-list`) to fetch items across all feeds in a single call.

**Query params:**
- `count=50` — number of items per batch (default 50)
- `continuation` — cursor token for pagination
- `excludeRead` — boolean, default false
- `feeds` — comma-separated feed IDs for filtering (optional)

**Response:**
```json
{
  "items": [
    {
      "id": "...",
      "title": "...",
      "content": "<html>...</html>",
      "preview": "Plain text excerpt...",
      "link": "https://...",
      "published": "2026-02-18T14:30:00Z",
      "author": "...",
      "feedTitle": "Ars Technica",
      "feedId": "feed/...",
      "categories": ["user/-/label/Tech"],
      "isRead": false
    }
  ],
  "continuation": "next-page-token-or-null"
}
```

The `preview` field is generated server-side by stripping HTML from `content` and truncating to ~200 chars.

### Frontend Data Flow

1. On mount: fetch `/reader/feeds` and `/reader/categories` in parallel for sidebar
2. Fetch `/reader/stream?days=3` for initial article batch
3. Group items by day client-side (using `published` timestamp)
4. Sort within each day group: newest first
5. Infinite scroll sentinel triggers next batch: `/reader/stream?days=3&continuation=...`
6. Sidebar filter changes re-fetch with `feeds=` param, reset scroll position
7. On accordion expand: POST `/reader/items/mark` with `action: "read"`, update local state

### Mark-as-Read

- Triggered on accordion expand (not on row click)
- Optimistic UI update: immediately remove bold styling
- Fire-and-forget POST to `/reader/items/mark`

## Styling

- Follows existing Feed module conventions (custom CSS, no Mantine components)
- Day group headers: subtle separator with date label, optionally sticky
- Compact rows: ~36-40px collapsed height
- Source tags: small pill/badge, colored via `colorFromLabel()` from `cards/utils.js`
- Expanded content: standard article typography, constrained images
