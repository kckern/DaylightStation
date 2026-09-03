# Piano board-game status: bottom row → side rail

Branch: `fix/board-stage-status-rail`
Worktree: `/opt/Code/DaylightStation/.claude/worktrees/piano-board-status`

## What changed

`InstrumentBoardStage` (`frontend/src/modules/Piano/game-platform/families/addressed-board/InstrumentBoardStage.jsx` + `.scss`) no longer renders `status` as a `<footer>` occupying a full-width `auto` grid row beneath the board. It is now a named CSS Grid area (`status`) that shares the **left** rail's column, stacked above whatever the game itself puts in `leftRail`. `board` and the right rail are each assigned to **both** grid rows, so they get the stage's full height whether or not a status band exists — that is what "increase board max height" actually reduces to: the old row took a bite out of every column including the board's; the new layout never does.

Below the existing 850px rail-collapse breakpoint, a media-query override reverts to the original two-row / full-width-footer shape for the *same* DOM node (no duplicate, no JS branch) — rails already collapse to 0-width/hidden there, so a status band living inside one would be invisible.

## Rail choice and why

**Left rail, stacked above the game's own left-rail content.** Two reasons:

1. Settings default to the **right** rail (`BoardGameFrame`'s `selectedRail`, default `'right'`); Connect Four and Checkers both keep that default, so putting status on the left keeps the gear icon and its foot-pinned trigger on the opposite side from the turn/status line in 2 of the 3 shipped games. Chess is the odd one out (`settings.rail: 'left'`), but there its settings trigger is pinned to the rail's *foot* while status occupies the top band — different bands, verified not to crowd in the chess screenshot.
2. Connect Four and Checkers already dock an "Opponent" panel (who you're playing, their think state, ladder position) in the left rail. Stacking status above it groups all "what's happening in the game right now" information into one visual column instead of splitting it across a header line and a bottom footer.

## Narrow-width fallback

Verified explicit call: **same DOM node, CSS-only reflow** — not a duplicated status element. Below 850px, `grid-template-areas` puts `status` back into its own full-width row under the board (`"status status status"`), matching the pre-existing narrow layout exactly. No duplicate interactive elements are ever in the DOM at once (ruled out a two-copy approach specifically because it would put two `role="status"`/action-button copies in the tree simultaneously, which risks `getByRole`/`getByText` ambiguity in game-specific tests even though jsdom doesn't evaluate the media query itself).

## Verification method

Dev server could not use 3111/3112/3113 (production + forbidden). Built a throwaway data-path overlay (`/tmp/.../scratchpad/fake-base`) that symlinks every real data-volume entry except `system/config/system.yml`, which was replaced with a copy adding one port mapping (`app.ports.claude-worktree: 3140`). Ran with `DAYLIGHT_ENV=claude-worktree`:
- Backend: `node backend/index.js` → listened on 3141 (real household/game data, read-only).
- Frontend: raw `vite` dev server hit `net::ERR_NETWORK_CHANGED` on nearly every ES-module request (known Chromium-in-container flakiness, confirmed via a public Playwright issue, not specific to this app). Switched to `vite build` + a small Express static server (with a hand-rolled `/api` proxy to 3141, since a plain static server doesn't proxy) — the built single-bundle app loaded reliably.

Screenshotted `/piano/games/connect-four` and `/piano/games/checkers` (both fully render headlessly) at 1440px, 900px, and 390px, before and after the change (via `git stash` on the four changed source files, rebuild, screenshot, `git stash pop`, rebuild again). Chess could not be reached past its onboarding gate headlessly (`PLAY THIS TO START PIANO CHESS… Waiting for the piano…` — the fake MIDI bridge at `ws://localhost:8770` isn't running in this sandbox), so it wasn't screenshotted, but the JS/CSS it depends on is identical to the other two games.

### Board height, measured (`getBoundingClientRect()` on `.instrument-board-stage__primary`), Connect Four

| Viewport | Before | After | Δ |
|---|---|---|---|
| 1440px wide | 538px | 606px | **+68px (+12.6%)** |
| 900px (just above the 850px breakpoint) | 336px | 378px | **+42px (+12.5%)** |
| 390px (narrow, below breakpoint) | 151px | 151px | **0px (unchanged, by design)** |

### Screenshot observations

- **1440px (wide):** *Before* — status line ("Your turn — play a key to drop a disc") centered in a dead full-width band under the board, board visibly smaller. *After* — status sits top-left above the "Diglett / Ready / Opponent 1 of 7" panel with a hairline divider between them; board is taller and the empty band is gone.
- **900px (mid, just above rail breakpoint):** Same rail-stacked arrangement as 1440px, proportionally scaled; status, opponent panel, and right-rail controls all remain visible and correctly separated.
- **390px (narrow, below rail breakpoint):** Rails collapse to 0-width (pre-existing behavior, unchanged); status renders as a full-width centered line directly under the board — visible and readable, exactly matching the old narrow-width contract. Confirmed for both Connect Four and Checkers.

Screenshots saved under the session scratchpad (`before-cf-*.png`, `final-cf-*.png`, `final-checkers-*.png`) — not committed (build artifacts / local verification only).

## Tests

Command: `npx vitest run frontend/src/modules/Piano/game-platform/`
Result: **39 files / 419 tests passed** (up from 415 before — 4 new tests added, 0 removed, 0 pre-existing assertions weakened).

Files changed:
- `InstrumentBoardStage.test.jsx` — added a `describe('InstrumentBoardStage status')` block with 4 new tests:
  1. renders status when provided
  2. renders nothing for status when none is given
  3. places status in the rail structure, not as a bottom-row `<footer>` (asserts no `<footer>` exists, status is a direct child of `.instrument-board-stage`, not nested in `.instrument-board-stage__rail` or `.instrument-board-stage__boards`)
  4. left rail's own content stays a separate sibling from status (`leftRail.contains(status) === false`)
- `BoardGameFrame.test.jsx` — added two assertions to the existing "keeps semantic rails…" test: `.instrument-board-stage__status` is never inside `.instrument-board-stage__rail`, and no `<footer>` exists anywhere in the stage. No existing assertion was changed or removed.

Full related-suite sweep: `npx vitest run frontend/src/modules/Piano/` → **405 files / 4963 tests passed, 1 skipped** (the skip pre-dates this change).

## Deliberate breakage (TDD-style regression proof)

Each was introduced by hand, confirmed to fail the relevant new test(s), then reverted and confirmed to pass again:

1. **Reverted to the old `<footer>` full-width placement.** Failed: `places status in the rail structure, not as a bottom-row footer` (InstrumentBoardStage) and the new `BoardGameFrame` assertions — both correctly detected the `<footer class="instrument-board-stage__status">` reappearing.
2. **Nested `status` inside the left rail `<aside>`** (instead of as its own sibling grid item). Failed 3 tests: the "not a bottom-row footer" test (parent mismatch), the "left rail stays a separate sibling" test, and the `BoardGameFrame` "not inside `.instrument-board-stage__rail`" assertion.
3. **Always rendered the status `<div>` even when `status` prop is falsy** (dropped the `status &&` guard). Failed: `renders nothing for status when none is given`.

All three were restored to the correct implementation and the full `game-platform` suite (419 tests) was re-confirmed green afterward.

## Design-system / hook constraints

- `InstrumentBoardStage.scss` is not under any `audit:ui`-scanned root (`ROOTS` in `scripts/audit-ui-tokens.mjs` covers `Apps`, `Health`, `Life`, `Auto`, `Media`, `lib/ui` — Piano isn't in that list), so the raw-color/raw-motion gate doesn't apply here, but the new rule still avoids raw hex: the status/left-rail divider uses `border-block-end: 1px solid var(--pg-hairline, transparent)` — `--pg-hairline` is the existing cabinet token from `gameChrome.scss` (defined on `.piano-game-host` and siblings), falling back to `transparent` (a keyword, not a color) when that chrome ancestor isn't present (bare test renders).
- No raw `console.*` added; no new SCSS selector errors (both builds above compiled cleanly).

## Commit

Committed locally on `fix/board-stage-status-rail`, not merged/pushed/deployed, per instructions.
