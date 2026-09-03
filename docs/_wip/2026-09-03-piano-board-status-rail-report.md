# Piano board-game status: bottom row → side rail

Branch: `fix/board-stage-status-rail`
Worktree: `/opt/Code/DaylightStation/.claude/worktrees/piano-board-status`

## What changed

`InstrumentBoardStage` (`frontend/src/modules/Piano/game-platform/families/addressed-board/InstrumentBoardStage.jsx` + `.scss`) no longer renders `status` as a `<footer>` occupying a full-width `auto` grid row beneath the board. It is now a named CSS Grid area (`status`) that shares the **left** rail's column, stacked above whatever the game itself puts in `leftRail`. `board` and the right rail are each assigned to **both** grid rows, so they get the stage's full height whether or not a status band exists — that is what "increase board max height" actually reduces to: the old row took a bite out of every column including the board's; the new layout never does.

Below the existing 850px rail-collapse breakpoint, a media-query override reverts to the original two-row / full-width-footer shape for the *same* DOM node (no duplicate, no JS branch) — rails already collapse to 0-width/hidden there, so a status band living inside one would be invisible.

## Rail choice and why

**Left rail, stacked above the game's own left-rail content.** Two reasons:

1. Settings default to the **right** rail (`BoardGameFrame`'s `selectedRail`, default `'right'`); Connect Four and Checkers both keep that default, so putting status on the left keeps the gear icon and its foot-pinned trigger on the opposite side from the turn/status line in 2 of the 3 shipped games. Chess is the odd one out (`settings.rail: 'left'`), which puts the gear icon in the *same* column as status — a real risk, and one the original pass of this report incorrectly claimed to have "verified not to crowd" without ever having screenshotted Chess. That was an overclaim; it has since actually been verified — see the "Chess left-rail squeeze" section below.
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

---

## Addendum: Chess left-rail squeeze — verified (follow-up review)

The first pass of this report claimed Chess had been "verified not to crowd" while the verification-method section in the same report said Chess was unreachable and never screenshotted. Both statements cannot be true; that was an overclaim on the single highest-risk case (Chess is the only shipped game where `settings.rail: 'left'` puts the gear icon in the *same* rail column status now occupies), and it has been corrected above. This addendum is the actual verification.

### Why Chess couldn't be reached the first time, and how it was reached this time

The prior attempt stubbed the piano-bridge WebSocket open (`ws://localhost:8770`) and expected the Chess board to mount. It didn't — because reaching `/piano/games/chess` for the household's "kckern" (Dad) profile hits a **separate, real gate**: `data/household/piano/config.yml`'s `gameGate.users.kckern` has `enabled: true, games: [chess]`, so the route renders `GameGate` → `ExerciseRun` ("PLAY THIS TO START PIANO CHESS — G major scale, right hand") in place of the game until that scale is played. This is unrelated to piano-bridge connectivity and unrelated to the status-rail change; it's a pre-existing daily-practice gate scoped to exactly this one adult and this one game.

Rather than simulate a full graded scale performance over fake MIDI frames, the gate was bypassed the same way the rest of this verification's environment is already synthetic: a throwaway copy of `data/household/piano/config.yml` (symlink-overlaid over the real, unmodified household data exactly as for `system.yml` earlier in this report) with a single line changed — `gameGate.users.kckern.enabled: true` → `false`, commented as a local test override. **The real file on the data volume was never touched** (diffed and confirmed identical after the fact). The piano-bridge stub itself (open the socket, no real note frames) is the same technique already used by this repo's own `tests/live/flow/piano/piano-chess-layout-stability.runtime.test.mjs`.

### Method

Playwright, `stubPianoBridge` (from the existing layout-stability test) + `/piano/games/chess`, viewport 1280×800 and 1280×700. Three states were driven directly via `page.evaluate` DOM writes (the same technique the existing layout-stability test uses to set `.piano-chess__prompt`/`.chess-readout__square` without a real game move):

1. **short** — `.piano-chess__prompt` set to `"Your opponent is thinking."` (27 chars), `--pg-slot-reserve: 5.5rem` on `.piano-chess__says` (the real reserved-height branch).
2. **long** — `.piano-chess__prompt` set to `"That piece cannot reach that square."` (37 chars, the real `REJECTION_MESSAGES.illegal_destination` string), same reserve.
3. **onboarding-long** — long status text, PLUS a synthesized `.chess-onboard` node (real markup: `.chess-onboard__step` + `.chess-onboard__title`, using the real "land" step copy) appended into `.piano-chess__says`, the `--pg-slot-reserve` property removed (mirrors the real `reserve={onboardCopy ? null : '5.5rem'}`), and `gesture-cards--compact` added to `.gesture-cards` (mirrors the real `compact={!!onboardCopy}`) — reproducing the exact worst-case combination the code comments describe.

For every case, measured via `getBoundingClientRect()`: the settings-gear button (`[aria-label="Settings"]`), all `.gesture-card` elements, the `.pg-rail__foot`, and the innermost `overflow: hidden` ancestor (`.pg-rail.piano-chess__rail--state`) — an element is "clipped" if its bottom edge exceeds that ancestor's bottom edge (overflow:hidden crops silently; the child's own rect doesn't shrink, so this is the right test).

### Results — all four requested cases

| Case | Height | Gear visible & flush | 5 gesture cards present | Anything clipped |
|---|---|---|---|---|
| 1. Short status, normal height | 800px | Yes (bottom = rail bottom, exact) | Yes, all 5 | No |
| 1. Short status, normal height | 700px | Yes (flush) | Yes, all 5 | No |
| 2. Long real status, normal height | 800px | Yes (flush) | Yes, all 5 | No |
| 2. Long real status, normal height | 700px | Yes (flush) | Yes, all 5 | No |
| 3. Onboarding + long status (worst case) | 800px | Yes (flush) | Yes, all 5 (compact) | No |
| 3. Onboarding + long status (worst case) | 700px | Yes (flush) | Yes, all 5 (compact) | No |

"Flush" = the gear button's bottom edge lands exactly on the rail's clip boundary (pinned foot, by design) — never past it.

### The squeeze mechanism is real, but never fires for any message this game actually ships

The reviewer's mechanism is correct: `status` and the left rail's own content (`hand`/`says`/gesture-cards/`foot`) DO share one column split across two grid rows (`auto` for status, `1fr` for the rest), so if `status` wraps to a second line, `auto` grows and `1fr`'s absolute pixel share shrinks. That much was confirmed independently.

What doesn't hold up is the premise that a shipped message reaches that condition. Measured `.piano-chess__status`'s height while cycling through **every one of the 17 real strings** this game can show (`chessRailViewModel.js`'s `promptFor`, `chessGameState.js`'s `REJECTION_MESSAGES`, including the two longest — "Play a piece's two notes twice to pick it up." at 45 chars and "Now play the two notes of the square to move to." at 48 chars) at the narrowest rail width actually measured (217px, the 1280×700 case): **every single one rendered on exactly one line** (`statusH` constant at 48px across all 17). The status text in Chess specifically overrides to `font-size: 1rem`, not `.pg-status__text`'s default `1.25rem` bold (`PianoChessGame.scss:168`), which is why it fits where the reviewer's back-of-envelope estimate (using the bolder/larger default size) suggested it wouldn't.

To find the actual margin before the mechanism bites, a synthetic 105-character string (well beyond anything the game ships — two real prompts concatenated) was forced through the same prompt element. It DID wrap, to 3 lines (`statusH` 48px → 64px, `railLeftTop` shifted down 8px) — and the gear and last gesture card were **still not clipped** (`gearClipped: false`, flush at the boundary, not past it). The rail's own content doesn't fill 100% of its row's height even under real conditions, so there is headroom beyond the wrap point itself.

### Recommendation

**No fix required; nothing changed in the implementation.** The theoretical squeeze exists but the two independent guards that would have to both fail before a player sees clipping — (a) a shipped message long enough to wrap, and (b) the rail's own content already having zero slack — are each individually false today, by a comfortable margin (confirmed with a synthetic string ~2× the longest real one). If a future Chess message is ever added that's dramatically longer than today's longest (48 chars) and multi-clause, re-run this same probe (`stubPianoBridge` + the 17-string sweep) before shipping it — that's the actual tripwire, not the rail-choice mechanism itself.

### Commands / cleanup

Dev servers (backend 3141, static+proxy 3140) were started and torn down the same way as the main verification above; the `gameGate` override lived only in a throwaway `/tmp` overlay directory, never on the real data volume (diffed and confirmed identical afterward). No `frontend/`, `backend/`, or config source files were changed for this addendum — only this report.
