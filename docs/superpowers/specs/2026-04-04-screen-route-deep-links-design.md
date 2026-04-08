# Screen Route Deep Links — Design Spec

**Date:** 2026-04-04
**Goal:** Enable URL deep-links like `/screens/living-room/games` that load specific content as if a menu item were selected, including propagating display properties like `menuStyle`.

---

## Problem

The existing path-based deep-link in ScreenAutoplay always resolves suffixes as `menu:{suffix}`, requiring a corresponding menu YAML file. This doesn't support:
- Content from non-menu sources (e.g., `retroarch/launchable`)
- Display properties like `menuStyle: arcade` that normally come from the parent item selection

## Solution

Add a `routes` map to screen config YAML files. ScreenAutoplay checks this map before falling back to the `menu:{suffix}` default.

## Data Change

Add to `data/household/screens/living-room.yml` (inside the Docker container):

```yaml
routes:
  games:
    contentId: retroarch/launchable
    menuStyle: arcade
```

Each route key is the URL suffix. The value is an object that gets spread into the navigation push props. At minimum it needs `contentId`. Optional properties like `menuStyle`, `shuffle`, `continuous` are passed through.

## Code Change

**File:** `frontend/src/screen-framework/ScreenRenderer.jsx` — `ScreenAutoplay` component

In the path-matching block where `subPath` is extracted, check the screen config's `routes` map first:

```javascript
const pathMatch = pathname.match(/\/screens?\/[^/]+\/(.+)/);
if (pathMatch) {
  const subPath = pathMatch[1];
  const appEntry = getApp(subPath);

  if (appEntry) {
    bus.emit('menu:open', { menuId: subPath });
  } else if (screenConfig?.routes?.[subPath]) {
    // Route defined in screen config — use its content ID and props
    const { contentId, ...routeProps } = screenConfig.routes[subPath];
    push({ type: 'menu', props: { list: { contentId }, ...routeProps } });
  } else {
    // Default: treat suffix as menu name
    push({ type: 'menu', props: { list: { contentId: `menu:${subPath}` } } });
  }

  window.history.replaceState({}, '', cleanPath);
}
```

## Flow

1. User navigates to `/screens/living-room/games`
2. ScreenAutoplay extracts suffix `games`
3. Checks `screenConfig.routes.games` — found: `{ contentId: 'retroarch/launchable', menuStyle: 'arcade' }`
4. Pushes `{ type: 'menu', props: { list: { contentId: 'retroarch/launchable' }, menuStyle: 'arcade' } }`
5. Menu.jsx fetches `/api/v1/list/retroarch/launchable`, renders with ArcadeSelector

## What Doesn't Change

- Backend list API — no changes
- Menu.jsx — already reads `menuStyle` from the input props (line 380)
- ListAdapter, listConfigNormalizer — untouched
- Existing `menu:{suffix}` deep-links (e.g., `/screens/living-room/fhe`) continue to work as fallback

## Scope

- One code change: ScreenAutoplay route lookup (~5 lines)
- One data change: `routes` entry in living-room.yml
- One test: verify route-based deep-link loads correct content
