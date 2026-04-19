# Media App — UX / Best-Practice Audit (2026-04-19)

Scope: `frontend/src/Apps/MediaApp.jsx` and `frontend/src/modules/Media/**` at
commit `e79819e8`. Method: interactive Playwright probing of a warm container
(commit `e79819e8` running at `localhost:3111/media`) plus code reading.
Probe script retained at `/tmp/media-ux-probe.mjs`, raw findings at
`/tmp/media-ux/findings.json`.

---

## Executive summary

The user flagged four categories: **crowded buttons**, **component
lifecycle (can't exit/close comboboxes)**, **bad design (no thumbs, careless
ratio handling)**, **non-intuitive layouts and positioning**. All four have
merit; three are verified defects in the current build, one (missing
thumbnails in search results) was fixed earlier in this session.

Beyond the reported issues, the audit surfaced a broad accessibility gap,
missing URL routing, absent keyboard support, and stale-UI hazards around
the streaming search. 20 discrete findings — 3 high, 13 medium, 2 low,
plus 2 architectural gaps that do not map to a single test but shape the
experience.

---

## 1. Component lifecycle — HIGH

### 1.1 Search combobox does not close on Escape or outside click *(HIGH)*

**Reported by user; verified.** The live-search dropdown renders whenever
`value.length >= 2` at `SearchBar.jsx:36`. There is no `onKeyDown` handler,
no click-outside listener, no focus-out handler anywhere in
`frontend/src/modules/Media/search/`. Pressing `Escape` or clicking the
canvas does nothing; the only way to dismiss the results is to clear the
input character by character.

Evidence (probe):
- `[HIGH] combobox: pressing Escape does NOT close search results`
- `[HIGH] combobox: clicking outside does NOT close search results`
- `[MEDIUM] combobox: after Play Now, search dropdown still obscures the page`

WAI-ARIA Combobox pattern requires at minimum: `Escape` clears/closes,
`ArrowDown` moves into the list, `Enter` activates the highlighted row,
and the combobox must expose `role=combobox` / `aria-expanded` /
`aria-controls`. None of these are implemented.

**Recommendation:** introduce a `useComboboxLifecycle` hook that
- listens for `Escape` on the input and on the dropdown,
- attaches a `pointerdown` listener on `document` to detect outside clicks,
- clears the query after any action row fires (Play Now / Add / Play Next / Cast),
- exposes `role="combobox"` on the wrapper and `role="listbox"` on `<ul>`.

### 1.2 Cast popover does not close on Escape *(HIGH)*

**Not reported by user; discovered during audit.** `CastPopover.jsx:9-51`
is a plain `<div>` with no keyboard handlers. Click-outside *does* work
(finding `[ok]`) only because the wrapping `CastTargetChip` toggles on
click and clicking elsewhere happens to move the active element; Escape
has no effect. Users stuck on keyboard cannot dismiss the popover.

**Recommendation:** same shared hook as above; a popover component should
trap focus, restore it on close, and close on Escape.

### 1.3 NowPlaying has no close/back affordance *(MEDIUM)*

`NowPlayingView.jsx:23-72` renders a host `<div>` and a hand-off section
but no exit button and no Escape handling. Users reach it via the mini
player, then the only exits are (a) browser back or (b) clicking a home
card in the dock. On mobile there is no back button at all. Both the
Plex and Jellyfin analogues have a persistent X or back chevron.

**Recommendation:** persistent Back button in the view header and a
global Escape → `nav.pop()` handler.

---

## 2. Layout & positioning — HIGH/MEDIUM

### 2.1 Crowded action buttons on search rows *(MEDIUM — user reported)*

**Reported by user; verified.** `SearchResults.jsx:56-64` places **five**
action buttons on every row: Play Now · Play Next · Up Next · Add · Cast.
At 14px type and 5px side padding the buttons are 64–71×29 — below the
iOS 44×44 guideline and below Material 48×48. They dominate the row
and occlude any space for a second line of metadata (year, duration,
source). The dimmed-at-rest opacity (0.35) we added this session makes
the row readable but still shipping five controls is excessive.

**Recommendation:** collapse to **one primary action plus an overflow**.
Plex-style pattern: a single round "Play" button visible on hover; a "⋯"
that opens a menu with Play Next / Up Next / Add / Cast. Queue-aware
behavior can change the primary: if nothing is playing, primary is Play
Now; if something is playing, primary is Up Next.

### 2.2 Hit targets below WCAG 2.5.5 target-size *(MEDIUM)*

Probe found 6 buttons smaller than 44×44:
`fleet-indicator`, `cast-target-chip`, `mini-player-open-nowplaying`,
`mini-pause`, `mini-play`, and the `session-reset-btn`.

The dock chips are 36px tall; the mini-play/pause squares are 32×32.
On a laptop this is fine; on a touch deployment (which this app
unambiguously targets given the household-kiosk context) it fails.

**Recommendation:** raise all dock controls to 40–44px minimum height.
Cap the dock row at ~56px with comfortable 8px padding.

### 2.3 Detail-view layout was broken *(verified fixed)*

**Reported by user indirectly via "non-intuitive positioning".** Before
this session the grid put `img` in column 1, `h1` in column 2, and
`.detail-actions` on its own orphan row, which rendered actions below
the poster-tall column-1 cell — leaving a large empty gap. Fixed in
commit `0a4f7e54` with explicit `grid-row: 1 / span 3` on the image so
title/description/actions stack tightly in column 2.

### 2.4 No breadcrumb / back on browse view *(MEDIUM)*

`BrowseView.jsx:17` renders `<h2>{path}</h2>` where `path` is a raw
slash-separated source path (`plex/audio/Artists/Oscar Peterson`). Users
can drill *down* (clicking container rows calls `push('browse', ...)`)
but have no visible way to drill *up* other than browser back. On
Plex/Jellyfin every library page has a ↑ chevron and a breadcrumb trail.

**Recommendation:** replace the `<h2>` with a breadcrumb built from the
path segments. Each segment is clickable and calls `nav.replace('browse',
{ path: trimmedPath })`.

### 2.5 Dispatch tray overlaps content *(MEDIUM)*

`.dispatch-tray` is `position: fixed` at bottom-right with up to 50vh
height and no dismiss. During a slow wake sequence it covers the lower
right half of the canvas for 60–80s and cannot be minimized. It also
has no relationship to whether the user's current view is relevant.

**Recommendation:** collapsed pill by default (device name + progress
bar), click to expand; auto-collapse on success after 3s; explicit X
to dismiss per dispatch row.

---

## 3. Ratio handling & image treatment — MEDIUM (user reported)

### 3.1 Mixed aspect ratios rendered into a uniform tile *(MEDIUM)*

**Reported by user.** The `/api/v1/display/:source/*` endpoint returns
whatever upstream thumbnail exists for the content type:

- Plex **movies/shows**: 2:3 poster (0.67)
- Plex **music**: 1:1 album art (1.0)
- Plex **videos (home videos)**: 16:9 (1.78)
- Immich **photos**: 3:2 or other (1.36 / 0.75)
- Hymn / book entries: placeholder SVG generated server-side (1:1)

Probe saw 4 unique ratios across the top 5 thumbs. The search-result
thumb cell is a fixed 42×42 square with `object-fit: cover`, which
center-crops every asset. Portraits lose head/shoulders; landscapes lose
side context; square album art renders cleanly (only one case).

**Recommendation:** derive a *display orientation* from the content
record (movie/show → portrait, music → square, photo/video → landscape,
hymn/book → square/portrait respectively) and use that to pick a cell
shape in the search row and browse grid. `backend/src/4_api/v1/routers/display.mjs`
could return orientation metadata so the client does not have to
reverse-engineer from pixel dimensions.

### 3.2 Detail poster is a hard 2:3 regardless of content type *(MEDIUM)*

`.detail-view img { aspect-ratio: 2/3 }` forces portrait on everything.
A home-video or podcast rendered in the detail view gets letterboxed
into a poster slot. The Immich result `f55097fb-...` naturally 3:2 is
cropped to 2:3 in the current build (960×1440 source center-cropped).

**Recommendation:** compute the poster aspect at render time from
`info.thumbnail` natural size (or backend metadata) and let the image
define its height up to `max-height: 65vh`.

---

## 4. Accessibility — HIGH *(not reported; broad)*

### 4.1 Zero ARIA attributes across the Media module *(HIGH)*

```
$ grep -rn 'aria-\|role=' frontend/src/modules/Media/**/*.jsx
frontend/src/modules/Media/session/HiddenPlayerMount.jsx:181: aria-hidden={...}
```

One `aria-hidden` on the off-screen player mount, and nothing else.
- No `aria-label` on icon-only buttons (`mini-pause`, `mini-play`).
- No `role="combobox"` on the search input.
- No `role="listbox"` on results.
- No `aria-live` region for search status, dispatch progress, or
  playback state announcements.
- Radio groups in the hand-off section lack `<fieldset>` / `<legend>`.

### 4.2 No keyboard affordances *(HIGH)*

`grep` found **one** `onKeyDown` in the Media module
(`ChannelList.jsx:55`, unrelated). There is no Tab order documentation,
no visible focus management on view transitions, and arrow-key
navigation of the search list is absent.

Probe: `ArrowDown from input focuses "media-search-input"` — the arrow
key does nothing. The first `Tab` from the page lands on `<body>`
because the dock is the first focusable row but our session-reset
button lives last.

**Recommendation:** a companion spec
`docs/reference/media/media-app-a11y.md` specifying Tab order, the
WAI-ARIA combobox contract, Escape handling per overlay, and a live
region for transport/dispatch announcements. Accept this as a
deliverable before the next Media-app feature lands — the base spec
already flagged this as "placeholder" (N6.1 in
`docs/reference/media/media-app-requirements.md`).

---

## 5. State feedback — MEDIUM

### 5.1 Mini player shows Play AND Pause simultaneously *(MEDIUM)*

`MiniPlayer.jsx:19-20` always renders both `<button>Pause</button>` and
`<button>Play</button>`. When the session is actively playing, both
appear; the user has to guess which applies. No `<audio>` / `<video>`
player exposes both controls at once — they are mutually exclusive.

**Recommendation:** one toggle button whose label and icon depend on
`snapshot.state`. Use `play` when `paused` / `ready`, `pause` when
`playing` / `buffering`.

### 5.2 No URL/history integration *(MEDIUM — user-visible)*

`NavProvider.jsx` maintains a view stack entirely in memory with no
`pushState` or `URLSearchParams`. Consequences:
- Browser Back does not navigate inside the app — it leaves the app.
- Views cannot be bookmarked or shared: fleet view, peek panel, and
  detail pages all live at `/media`.
- A page refresh in Browse view loses the path and returns to Home.

This directly conflicts with C8.1 / J9 in the requirements document,
which defines a URL deep-link protocol (`?play=<contentId>`, etc.).
The deep-link reader exists (`useUrlCommand.js`) but the reverse —
writing the current view back to the URL — does not.

**Recommendation:** extend `NavProvider` to sync `view` and `params`
to `?view=detail&contentId=...`; respond to `popstate`. Preserve
`?play=...` autoplay on app load (already works) and strip that
param after consumption.

### 5.3 Raw content IDs leak into the UI *(LOW)*

`NowPlayingView.jsx:25` heading: `Now Playing: {item?.contentId ?? 'nothing'}`.
If a content item has a proper `title`, the heading should prefer that.
Same pattern in `FleetView.jsx:13` (`entry.snapshot.currentItem.contentId`
fallback is fine; showing it when `title` exists is not).

### 5.4 Loading pulsers dispatch before stale check *(LOW)*

`[data-testid='home-loading']` animates an amber dot while `browse` is
`null`. If the user just refreshed from a stale cache the data returns
in <10ms and the pulser flashes. Debounce loading indicators to only
show after ~150ms.

---

## 6. Additional findings

### 6.1 No scroll restoration between views *(MEDIUM)*

`Canvas.jsx:26` swaps children when `view` changes but never resets or
restores scroll. Navigate into a long browse list, scroll down, click an
item → detail view inherits the scroll offset. Navigate back → browse
jumps to top instead of where you were.

**Recommendation:** `Canvas` should record scrollTop per `view/params`
combination on unmount and restore on mount. Standard library pattern
(Next.js, React Router v6).

### 6.2 Streaming search cannot be cancelled by the UI *(MEDIUM)*

`useLiveSearch.js` delegates to `useStreamingSearch`. When the user
types faster than the stream returns, the dropdown fills with results
from the previous query briefly before reconciling. There is no visible
hint that the current results are stale. The `pending` array from the
stream is rendered as `Loading plex, singalong…` which is useful, but
there is no *stop* affordance if the user wants to abandon a slow scope.

### 6.3 Fleet card state is a string *(MEDIUM)*

`FleetView.jsx:6-10` stringifies the remote state as `unknown`,
`playing`, `paused`, etc. directly. Better UX: colour-coded pill
(amber = busy, green dot = idle, red = offline, gray = unknown), and a
last-seen timestamp on hover when offline. Current card shows "unknown"
below a dashed item row which just looks broken.

### 6.4 Peek panel lacks seek and queue views *(MEDIUM — spec gap)*

Spec C5.2 requires peek to support seek (abs + rel) and C5.3 requires
the full queue-operation set. The current `PeekPanel.jsx:21-43` exposes
only play / pause / stop / next / prev plus a volume slider. No
position scrubber, no queue list, no reorder. This is a product gap
against the written requirements, not just a style concern.

### 6.5 No empty-state illustrations *(LOW)*

When browse returns zero items, the user gets a silent blank canvas
below the `<h2>path</h2>`. No "No items in this collection"
placeholder. Same story when search returns zero results — the dropdown
disappears entirely rather than saying "No matches."

### 6.6 Dock wraps on narrow widths but mini-player sits at line-start *(LOW)*

The responsive rule at 780px puts `media-search-bar` first, dock below.
The mini-player becomes its own row and aligns left, making it look
disconnected from the transport context. Either wrap the entire
transport block together (mini + cast + reset) or move the dock into a
hamburger.

### 6.7 Reset session has no confirmation *(MEDIUM)*

`Dock.jsx:18` calls `lifecycle.reset()` on click with no confirmation.
Clicking mid-playback drops the queue and current item irrecoverably
(C2.3 does say "MUST be explicit and confirmable"). Currently it is
neither.

---

## Severity rollup

| Severity | Count | Category representatives                                                              |
|----------|-------|---------------------------------------------------------------------------------------|
| HIGH     | 4     | combobox escape, popover escape, zero ARIA, zero keyboard support                     |
| MEDIUM   | 14    | crowded actions, hit targets, breadcrumbs, aspect ratios, URL routing, mini toggle …  |
| LOW      | 3     | content ID leakage, loading flash, wrap layout, empty states                          |

## User-report mapping

| User report                                       | Verdict                          | Reference |
|---------------------------------------------------|----------------------------------|-----------|
| Crowded buttons                                   | **Verified** — 5 actions/row     | §2.1      |
| Can't exit/close comboboxes                       | **Verified** — Escape + outside click broken | §1.1, §1.2 |
| No thumbnails                                     | **Fixed in this session**        | §3.1 for follow-up aspect handling |
| Careless ratio handling                           | **Verified** — 4 ratios collapsed to 42×42 | §3.1, §3.2 |
| Non-intuitive layouts / positioning               | **Verified** — detail grid was broken, no breadcrumbs, mini-player both-buttons | §2.3, §2.4, §5.1 |

## Recommended order of work

1. (HIGH, 1–2 h) Shared `useDismissable(ref, onClose)` hook + apply to
   search dropdown, cast popover, now-playing. Restores Escape + outside
   click across the app.
2. (HIGH, 2–3 h) Consolidate search row actions to one primary + overflow
   menu. Halves hit-target crowding at once.
3. (MEDIUM, 3–4 h) URL/history integration in `NavProvider` — fixes
   §5.2, unlocks bookmarkability, makes browser Back work.
4. (MEDIUM, 2–3 h) Aspect ratio metadata through the display/list APIs +
   a lookup table on the client; variable-shape search thumbs and
   detail posters.
5. (MEDIUM, 2–3 h) Breadcrumb on browse + Back/close on NowPlaying + confirmation
   on reset. Together these are the layout-intuitiveness wins.
6. (HIGH, 1 day) First pass of the promised `media-app-a11y.md` spec
   plus the minimum ARIA + keyboard support inside `Media/`.
7. (MEDIUM, 1–2 h) Mini-player play/pause collapse to a single toggle.

Items 4 and 6 deserve a design pre-read because both ripple into the
shared display/list API contract and a separate accessibility spec
respectively.
