# Per-App Document Titles

**Date:** 2026-04-19
**Status:** Design

## Problem

The browser tab title is a static `Daylight Station` for every route. When multiple tabs are open (common during development and daily use), there's no way to tell Media, Finances, Life, Feed, etc. apart at a glance. Bookmarks and browser history also all look identical.

## Goal

Each top-level app sets a distinct `document.title` so the tab/history reflects which app is active. Format:

```
<AppName> | Daylight Station
```

Sub-route granularity is **out of scope** for this change — the hook we add should make it easy to extend later.

## Non-Goals

- Dynamic titles that reflect sub-route context (e.g., `Media · Browse · Music | Daylight Station`). The primitive we add supports this, but no app will use it yet.
- Favicon changes.
- SEO / Open Graph metadata.

## Design

### Shared hook

New file: `frontend/src/hooks/useDocumentTitle.js`

```js
import { useEffect } from 'react';

const SUFFIX = 'Daylight Station';

export default function useDocumentTitle(name) {
  useEffect(() => {
    const prev = document.title;
    document.title = name ? `${name} | ${SUFFIX}` : SUFFIX;
    return () => { document.title = prev; };
  }, [name]);
}
```

Behavior notes:
- Restores the previous title on unmount so navigating between apps doesn't leave a stale title if an app unmounts without another immediately remounting.
- Reacts to `name` changes so sub-routes can later pass a dynamic string.
- Passing a falsy `name` falls back to just `Daylight Station` — useful for the setup/invite/blank routes.

### Per-app usage

Each component listed below calls the hook once at the top of its component body:

```jsx
import useDocumentTitle from '../hooks/useDocumentTitle.js';

export default function MediaApp() {
  useDocumentTitle('Media');
  // ...existing body
}
```

(Import path depends on the file's location — `../hooks/...` from `Apps/`, `../../hooks/...` from `modules/Auth/`, etc.)

### Title mapping

| Component (file) | Route(s) | Title |
|---|---|---|
| `Apps/AdminApp.jsx` | `/`, `/admin/*` | `Admin \| Daylight Station` |
| `Apps/HomeApp.jsx` | `/home` | `Home \| Daylight Station` |
| `Apps/LifeApp.jsx` | `/life/*` | `Life \| Daylight Station` |
| `Apps/HealthApp.jsx` | `/health` | `Health \| Daylight Station` |
| `Apps/FitnessApp.jsx` | `/fitness/*` | `Fitness \| Daylight Station` |
| `Apps/FinanceApp.jsx` | `/finances`, `/budget` | `Finances \| Daylight Station` |
| `Apps/MediaApp.jsx` | `/media` | `Media \| Daylight Station` |
| `Apps/LiveStreamApp.jsx` | `/media/channels/*` | `Live \| Daylight Station` |
| `Apps/FeedApp.jsx` | `/feed/*` | `Feed \| Daylight Station` |
| `Apps/TVApp.jsx` | `/tv`, `/tv/app/:app` | `TV \| Daylight Station` |
| `Apps/CallApp.jsx` | `/call` | `Call \| Daylight Station` |
| `modules/Auth/SetupWizard.jsx` | `/setup` | `Setup \| Daylight Station` |
| `modules/Auth/InviteAccept.jsx` | `/invite/:token` | `Invite \| Daylight Station` |
| `screen-framework/` (ScreenRenderer) | `/screen/:screenId/*`, `/screens/:screenId/*` | `Screen \| Daylight Station` |
| `OfficeRedirect` (in `main.jsx`) | `/office`, `/office/*` | skipped — redirects immediately |
| `modules/Blank/Blank.jsx` | `*` fallback | skipped — stays `Daylight Station` |

### Static fallback

`frontend/index.html` already contains `<title>Daylight Station</title>` — no change needed. This is shown during the brief window before the React app mounts, and matches the suffix.

## Alternatives Considered

**A. Inline `useEffect` in each App.** No new file, but 12+ copies of the same three-line pattern. Easier to drift (typos, suffix changes). Rejected in favor of the shared hook.

**B. Centralize titles in `main.jsx` by wrapping each `<Route>` element.** Keeps titles in one place but makes it awkward for sub-routes inside `LifeApp`, `FeedApp`, `FitnessApp`, `AdminApp` to refine their own title later. Also clutters the routing table. Rejected.

**C. React Helmet / react-helmet-async.** Overkill for a single `<title>` tag. Adds a dependency. Rejected.

## Testing

- **Manual:** Load each route in the browser, confirm the tab title matches the table. Navigate between apps and confirm titles update.
- **Automated:** Not adding dedicated tests — a one-line hook + per-component string is low-risk and any regression is instantly visible in the tab. If we later add sub-route titles, a small unit test on the hook can be added at that time.

## Rollout

Single PR, no feature flag. Change is visual-only and reversible.

## Open Questions

None. Brand spelling confirmed as `Daylight Station` (with space).
