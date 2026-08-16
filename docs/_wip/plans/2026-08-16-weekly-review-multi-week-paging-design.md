# Weekly Review — multi-week paging

**Date:** 2026-08-16
**Status:** Design, validated. Not yet implemented.

## Problem

The weekly review always shows the same eight days: `[today-8, today-1]`. After a
long trip there is more material than one window holds, and no way to reach it.
The review is a single live-recorded sitting, so the fix has to let the user walk
backward through several windows without disturbing the recording.

## What already works

- `WeeklyReviewService.bootstrap(weekStart)` parameterizes the start date and
  derives an inclusive 8-day span from it (`WeeklyReviewService.mjs:53-56`).
- The router already forwards `?week=` to it (`weekly-review.mjs` `GET /bootstrap`).
- `keymap.js` is a pure resolver — the single source of truth for the input
  matrix. Navigation changes belong there, not in the component.
- `viewReducer` already clamps grid movement at the boundaries
  (`viewReducer.js:31-32`), so top-row `Up` and bottom-row `Down` are free keys.
- `DayColumn` already renders a contentless day as `day-column--empty`, so empty
  windows need no new UI.

The backend needs no range work. The gap is entirely the frontend's assumption
that exactly one window exists — plus one small new endpoint for jump-to-oldest.

## Decisions

| # | Decision | Rejected alternative |
|---|---|---|
| D1 | Page between 8-day windows | One long scrolling grid; a launch-time span picker |
| D2 | Double-tap `Up` on the top row to page back | Bare single `Up` (a stray press swaps the grid mid-narration) |
| D3 | Triple-tap `Up` to jump to the oldest window with content | Long-press. `useLongPress` is pointer-based (piano touchscreen), and whether the Shield remote emits key-repeat is **unverified**. Triple-tap assumes nothing about the hardware. |
| D4 | Backward paging unbounded; forward stops at the current window | A hard cap (~4 windows) that a longer trip runs into |
| D5 | Recording is frozen to the mount-time week | Letting it follow the viewed window — splits the audio |

## Section 1 — The window model

**Frontend state.** A `windowStart` state value, initially `null` (meaning
"server default"). Paging sets an explicit date and refetches. Visited windows
are cached in a `Map` keyed by start date, so paging back and forth after the
first visit is instant instead of re-hitting Immich + calendar + fitness +
weather each time.

**Recording is decoupled from the window.** This is the one place the current
code would break. `weekForUploader = data.week` (`WeeklyReview.jsx:96`) — if
`data` is replaced by another window's payload mid-recording, chunks start
landing in a different folder and the audio splits.

Fix: capture the mount-time week into a ref alongside `sessionIdRef`, and feed
that to `useChunkUploader` and to every `finalize` call. One session, one file,
regardless of where the user has browsed. Draft recovery
(`WeeklyReview.jsx:341`) keys off the same frozen week.

**Two labels, not one.** `weekLabel` (`WeeklyReview.jsx:510`) currently drives
the recording bar. It splits:

- Grid header — the *viewed* window plus a relative tag: `Aug 1 – Aug 8 · 2 weeks ago`.
- Recording bar — the session: duration, mic level, sync status. It no longer moves.

## Section 2 — Navigation and the keymap

All of this lands in `keymap.js`. No new key handling in the component.

**The edge counter generalizes.** `lastEdgeRef` holds `{ dir, at }` and arms
cross-day taps in the reel (`keymap.js:97`). It gains a `count`, and the grid
layer starts using it too. The clamped no-ops become trigger points:

| Where | Press | Result |
|---|---|---|
| Top row | `Up` ×1 | Arms. Header shows `▲ again for Jul 25 – Aug 1` |
| Top row | `Up` ×2 within 500ms | Load previous window |
| Top row | `Up` ×3 within 500ms | Jump to oldest window with content |
| Bottom row | `Down` ×1 | Arms — only if a newer window exists |
| Bottom row | `Down` ×2 within 500ms | Load next window |

Same 500ms `DOUBLE_EDGE_WINDOW_MS`, same idiom as crossing days in the reel. A
single stray `Up` still does nothing but show a hint that fades, so the safe
no-op the user can lean on survives.

**Boundaries.** Forward paging stops at the current window; `Down` on the bottom
row there is inert with no hint. Backward is unbounded.

**Landing focus.** Paging back focuses the *last* cell (index 7), so `Up` is
immediately armed for another jump back. Paging forward lands on index 0. A
chronological walk forward — the natural pass after triple-tapping to the oldest
window — is then `Down Down` from a consistent spot each time.

**Load state.** A refetch mid-review must not blank the grid or the review
stalls. The outgoing window stays painted, dimmed, with a spinner in the header;
keys are inert until it resolves. Cached windows skip this entirely.

## Section 3 — The extent probe

Jump-to-oldest needs one new backend affordance; the frontend cannot know where
content stops without probing.

```
GET /api/v1/weekly-review/extent?before=YYYY-MM-DD
    → { oldestContentDate, hasOlder }
```

The service asks Immich for assets in `[before − lookbackDays, before)` —
lookback defaults to 120 days — and returns the earliest `localDateTime` found.
The frontend snaps that date to a window start, aligned to the same 8-day stride
as the current window, and jumps there.

Preferred call: `searchMetadata({ takenAfter, takenBefore, size: 1, order: 'asc' })`.
`ImmichClient.searchMetadata` (`ImmichClient.mjs:106`) is a thin passthrough to
`/api/search/metadata`, so it forwards whatever the endpoint accepts.

**Unverified:** whether this Immich build honors `order`. If it does not, fall
back to the pattern the adapter already uses — `size: 500` over the lookback,
take the min date. One extra call, only on triple-tap; cost is acceptable either
way. Verify before relying on the `size: 1` form.

## Failure paths

The review is a live recording session. Nothing here may trap the user.

- Extent probe fails or returns nothing → log `weekly-review.extent.failed`,
  degrade the triple-tap to an ordinary double-tap (one window back). No modal.
- A window's `bootstrap` fails → keep the current window painted, show a
  transient header notice, log `weekly-review.window.load-failed`. Focus and keys
  return to the window still on screen.
- Recording is never touched by any of this. A failed page-back cannot stop,
  restart, or redirect the recorder.

## Tests

The pure modules are already well covered, and this stays in them.

- `keymap.test.js` — arm/fire/reset for double and triple `Up`; the bottom-row
  forward case; forward-boundary inertness; reel cross-day behavior unchanged.
- `viewReducer.test.js` — landing focus on index 7 backward, index 0 forward.
- New `WeeklyReviewService` test — extent probe with `order` honored, with
  `order` ignored, and with zero assets.
- Component-level — assert the uploader's `week` stays fixed across a window
  change. That is the regression that would silently split a recording.

## Logging

New structured events, per the framework in `frontend/src/lib/logging/`:

| Event | Level | Data |
|---|---|---|
| `window.paged` | info | `{ from, to, direction, cached }` |
| `window.load-failed` | warn | `{ start, error }` |
| `window.jump-oldest` | info | `{ from, to }` |
| `extent.failed` | warn | `{ before, error }` |
| `window.edge-armed` | debug | `{ dir, count }` |
