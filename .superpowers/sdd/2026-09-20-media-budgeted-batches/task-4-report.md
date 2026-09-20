# Task 4 — RELY.9a + RELY.10a focused navigation tranche

## Scope delivered

- `NavProvider` now validates all Media views, exposes primary `area` and `backDestination`, and provides `goToArea` for canonical Home/Browse/Devices selection.
- Reselecting an area traverses to an existing canonical browser-history entry when available; a deep-link without one is replaced in place.
- Primary controls use `goToArea`; Now Playing, Peek, and Browse Breadcrumb Back controls show the actual prior area and still call `pop`.
- Escape-layer behavior is pinned separately from route Back.

## TDD evidence

- RED: focused suite reported 9 expected failures: missing area/goToArea/backDestination, direct primary `push`, generic Back labels, and unknown URL retention.
- GREEN: `npx vitest run frontend/src/modules/Media/shell/NavProvider.test.jsx frontend/src/modules/Media/shell/DismissStackProvider.test.jsx frontend/src/modules/Media/shell/PrimaryNav.test.jsx frontend/src/modules/Media/shell/NowPlayingView.test.jsx frontend/src/modules/Media/shell/PeekPanel.test.jsx frontend/src/modules/Media/browse/BrowseView.dispatch-header.test.jsx` — 6 files, 50 tests passed.
- Scoped ESLint with the frontend binary and `git diff --check` passed.

## Remaining evidence

- The three-viewport Playwright history matrix was intentionally not started before the close 29% checkpoint. RELY acceptance remains unchanged.
- Happy DOM drops the forward entry after `history.go(-1)`. The unit test therefore records history length at the synchronous traversal seam and separately proves the route landing plus the following Back to Home; real-browser runtime proof remains required.
