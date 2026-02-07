# Menu Skeleton Loader

Related code:
- frontend/src/modules/Menu/MenuSkeleton.jsx
- frontend/src/modules/Menu/Menu.scss
- frontend/src/modules/Menu/Menu.jsx
- frontend/src/Apps/TVApp.jsx

## Purpose
Menu loading states should avoid blank screens or player-specific spinners. The menu skeleton loader provides a consistent shimmer layout that mirrors the menu header and grid so users perceive a stable structure while data loads.

## Usage
- Use `MenuSkeleton` for menu data fetches (`!loaded`) in TV and keypad menus.
- Do not use the skeleton for empty states. Render a distinct empty message once data is loaded.
- Keep player-context loading states (deep links, autoplay) on `PlayerOverlayLoading` or other player-specific indicators.

## Styling
- Skeleton shimmer and pulse utilities live in `frontend/src/styles/_skeleton.scss` and are imported by menu and office styles.
- Menu skeleton elements reuse `menu-item` sizing to avoid layout shifts.
- The menu container uses a short fade-in animation to soften the swap from skeleton to real content.
