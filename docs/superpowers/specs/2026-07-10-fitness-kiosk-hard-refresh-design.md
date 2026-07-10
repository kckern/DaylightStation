# Fitness Kiosk Hard Refresh — Design

**Date:** 2026-07-10
**Status:** Approved

## Problem

The garage fitness kiosk (fullscreen Firefox, touchscreen, no keyboard) has no way to
hard-refresh the page once a session is active. The existing 🔄 refresh card in the nav
sidebar footer (`SidebarFooter.jsx`) only renders when there are zero active heart-rate
participants — the moment someone straps in, the top performer's avatar replaces it.
During video playback the entire nav is hidden and the player's Settings menu has no
reload entry (a dead `handleReloadPage` in `FitnessSidebarMenu.jsx` suggests one was
removed). After a redeploy the kiosk keeps serving the old bundle; today the only remedy
is SSH + xdotool Ctrl+Shift+R.

The app already survives mid-session reloads by design: the play queue is mirrored to
sessionStorage and restored on mount, so reload is a recoverable operation — it just
lacks a touchable trigger. The user specifically wants a **cache-bypassing** reload
(Ctrl+Shift+R equivalent), not a plain `location.reload()`.

## Design

### 1. Shared `hardReload()` helper

New file: `frontend/src/modules/Fitness/lib/hardReload.js`.

Best-effort cache-bypass sequence, used by every trigger:

1. Log a `fitness-hard-reload` event (with a `source` field: `settings-menu`,
   `footer-longpress`, or `footer-tap`) so the session JSONL records why the page
   unloaded.
2. Delete all Cache API storage (`caches.keys()` → `caches.delete(key)`), guarded so
   absence or failure never blocks the reload.
3. `fetch(window.location.pathname, { cache: 'reload' })` — forces the HTTP cache to
   revalidate `index.html`, the file that points at the hashed bundles.
4. `window.location.reload(true)` — Firefox (the kiosk browser) honors the non-standard
   forceGet flag; other browsers do a normal reload, which suffices after steps 2–3.

### 2. Player Settings menu item (covers playback)

In `FitnessSidebarMenu.jsx`, wire the existing dead `handleReloadPage` to
`hardReload()` and render it as a "🔄 Reload App" menu item in its own small section
near End Session. No confirmation dialog: opening Settings and tapping a labeled item
is deliberate, and reload is recoverable.

### 3. Footer long-press (covers menu/browse views with an active session)

In `SidebarFooter.jsx`:

- **Avatar present:** pointer-down starts a ~2s timer; pointer-up/leave/cancel before
  the threshold cancels the timer and falls through to the existing tap behavior
  (navigate to users view / avatar menu). Holding the full 2s fires `hardReload()`.
  While held, a visual fill/ring on the card makes the hold legible — the hold itself
  is the confirmation; accidental brushes can't trigger it.
- **No session (existing 🔄 card):** keep tap-to-reload but upgrade it from
  `window.location.reload()` to `hardReload()` so all refresh paths bust cache
  consistently.

## Error handling

Every step of `hardReload()` is individually guarded; the final `location.reload()`
always runs even if cache clearing or the revalidation fetch throws. The long-press
timer is cleaned up on unmount.

## Testing

- Unit tests (vitest): long-press timing logic (fires at threshold, cancels on early
  release/leave, tap falls through to existing behavior); `hardReload()` runs its steps
  in order with mocked `caches`/`fetch`/`location` and still reloads when cache APIs
  throw. Exclude `.claire` worktrees from the run.
- Manual: build, deploy (respecting the garage-in-use gates), then eyes-on verify on
  the garage kiosk that a mid-session long-press reloads and the session restores from
  sessionStorage.

## Out of scope

- No new always-visible chrome; no hidden corner gestures.
- No changes to lib/Player or modules/Player (other agents own them).
- No service-worker changes. `index.html` registers `/sw.js` at scope `/`, but it is a
  no-op pass-through (PWA installability only, no caching), so it cannot serve stale
  bundles. The Cache API clearing in `hardReload()` step 2 already covers anything a
  future caching SW might store.
