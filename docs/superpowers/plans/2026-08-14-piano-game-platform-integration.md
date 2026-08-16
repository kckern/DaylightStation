# Piano Game Platform Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the piano game platform real — chess running through the unified container, and opponent pacing plus staff addressing built once in `game-platform` and consumed by Chess, Connect Four and Checkers — then fix the games grid and the visual rhythm the kiosk currently shows.

**Architecture:** `39c7cde73` introduced `game-platform/` (host, input, chrome, families) and a generic backend at `/api/v1/piano-games/:gameId`, with Chess left on a compatibility mount. Three things are currently built per-game that should be built once: the opponent's reply pacing, the board's address legend, and the side-rail chrome. This plan lifts each into the platform, migrates Chess onto the container without losing the help-ceiling policy that governs its ladder, and re-times the layout.

**Tech Stack:** React 18 (`.jsx`/`.js`), ES modules (`.mjs`) backend/shared, Vitest, SCSS.

## Global Constraints

- **Test command:** `./node_modules/.bin/vitest run <paths>`. `--reporter=basic` does not exist in vitest 4.
- **Never run `git stash`** — the stash stack is shared across worktrees on this machine.
- **Never use raw `console.*`** — use the logging framework (`getLogger().child({ component })`).
- **Never animate CSS `filter`** — documented frame-rate killer on the piano tablet.
- **Inline SVG, never unicode glyphs** — the kiosk WebView renders unicode symbols as tofu.
- **No sliders in kiosk UI** — discrete tap targets only.
- **No `findLastIndex`/`findLast`/`.at()`** on kiosk hot paths — 2018 Android WebView.
- snake_case in YAML, records and persisted data; camelCase in component state.
- Comments explain *why*, not *what*, long-form, explaining the failure the code prevents.
- **The help-ceiling policy is load-bearing.** `countsTowardPromotion()` gates promotion on `max_hints`, `max_best_moves`, `max_takebacks`, `unrestricted_below_level`. Any path that records a chess game must preserve it.

---

### Task 1: Help ceilings and ranked/unranked in the generic ladder

**Why first:** `OpponentLadder.record(result, playedLevel)` never sees help data, so migrating Chess onto it would silently delete the takeback/hint gating. Connect Four and Checkers also have an uncharged seven-note "suggestion" gesture and already mark offline games `ranked: false` — a concept the chess ladder lacks. One policy, both directions.

**Files:**
- Modify: `backend/src/2_domains/gaming/entities/OpponentLadder.mjs`
- Modify: `backend/src/2_domains/gaming/entities/OpponentLadder.test.mjs`
- Modify: `backend/src/3_applications/piano-games/PianoGamesContainer.mjs` (+ test)

**Interfaces produced:**
- `new OpponentLadder({ opponents, progress, winsRequired, seriesLength, helpCeilings })` where `helpCeilings` is `{ max_hints, max_best_moves, max_takebacks, unrestricted_below_level }`, all optional; absent means unlimited.
- `ladder.record(result, playedLevel, { help = {}, ranked = true } = {})` — a game that breaches a ceiling, or is unranked, is recorded in the series as **not counted** rather than dropped, mirroring `applyGameToProgress`'s `counted` flag.
- `ladder.countsToward(playedLevel, { help, ranked })` → boolean, exported for callers that need to predict.

**Acceptance:**
- A game with `ranked: false` never promotes, whatever the result.
- A game breaching any ceiling never promotes.
- `unrestricted_below_level` exempts levels below it from all ceilings.
- Absent `helpCeilings` reproduces today's behaviour exactly (existing tests unchanged and passing).
- The series still holds `seriesLength` entries and still resets on promotion.

**TDD:** write the five acceptance cases as failing tests first; run; implement; run; commit.

---

### Task 2: Chess through the unified container

**Files:**
- Create: `backend/src/1_adapters/piano-games/ChessEngineAdapter.mjs` (+ test) — wraps the existing Stockfish adapter behind `IGameOpponentGateway`
- Modify: `backend/src/5_composition/modules/pianoGames.mjs` — register `chess`
- Modify: `frontend/src/modules/Piano/PianoChessGame/chessApi.js` — point at `/api/v1/piano-games/chess/*`
- Modify: `backend/src/4_api/v1/routers/chess.mjs` — keep serving, now as the compatibility mount only

**Interfaces produced:** chess reachable at `/api/v1/piano-games/chess/{move,config,ladder,games,history}` with identical response shapes to `/api/v1/chess/*`.

**Constraints:**
- The 21-rung chess ladder keeps `winsRequired: 5, seriesLength: 7` and its help ceilings.
  **`helpCeilings` must be nested INSIDE `promotion`**, not a sibling of it:
  `PianoGamesContainer.recordGame` constructs the ladder as
  `new OpponentLadder({ opponents, progress, ...game.promotion })`, so a sibling
  `games.chess.helpCeilings` key is never read and the ceiling silently no-ops —
  which is precisely the regression Task 1 exists to prevent. Wire it as:

  ```js
  chess: {
    opponentGateway: chessGateway,
    opponents: CHESS_OPPONENTS,
    promotion: {
      winsRequired: 5,
      seriesLength: 7,
      helpCeilings: { max_hints: 1, max_best_moves: 0, max_takebacks: 1, unrestricted_below_level: 0 },
    },
  },
  ```

  Add a test that a help-heavy chess game recorded through the container does **not**
  promote — a wiring mistake here is invisible without one. Do **not** flatten chess
  onto the 7-opponent/3-of-5 default.
- `unrestricted_below_level` is read by `OpponentLadder` in **1-based** numbering while
  chess's own policy is 0-based. Convert when porting a non-zero value; `0` is
  equivalent in both and is the current default.
- The container's `ranked: false` path early-returns and **drops** the game rather than
  recording it as not-counted. Chess's own `applyGameToProgress` keeps every game with a
  `counted` flag. Do not introduce `ranked: false` for chess in this task — if the
  bundled-fallback engine should mark games unranked (it arguably should), that is a
  separate decision with a visible behavioural difference, and it needs its own task.
- `/api/v1/chess/*` must keep working unchanged for one release — it is what the deployed kiosk calls until this ships.
- Chess games recorded through the container must still pass `help` and `level`, and must reach the same promotion decision as before. **Prove it:** a test that feeds one record through both paths and asserts the same `counted`/promotion outcome.

**Acceptance:** the existing chess router tests still pass; new container tests cover move/config/ladder/games/history for `chess`; promotion parity test passes.

---

### Task 3: Opponent pacing as a platform capability

**Why:** Connect Four commits its reply the instant the request resolves (`PianoConnectFour.jsx:105-120`) — no floor at all. Chess waits `opponentDelayMs` and *then* sends the request, so network time is added to the pause. Both are the same missing concept.

**Files:**
- Create: `frontend/src/modules/Piano/game-platform/opponent/opponentPacing.js` (+ test)
- Modify: `PianoConnectFour.jsx`, `PianoCheckers.jsx`, `PianoChessGame.jsx` to consume it

**Interfaces produced:**
- `thinkTimeFor({ level, levels, config, seed, ply, pace })` → ms. Interpolates `floor`→`ceiling` across `levels` rungs (21 for chess, 7 for the others), deterministic jitter from `seed + ply` (never `Math.random`), scaled by `pace`. Returns `null` when `level` is not a number so callers fall back.
- `useOpponentReply({ enabled, request, fallback, thinkMs, onReply })` — a hook that **fires the request immediately** and commits the answer at `max(elapsed, thinkMs)`. The pause is a floor, never an addend.

**Config** (per game, under its own config file):
```yaml
opponent:
  think_ms: { floor: 600, ceiling: 4000, jitter: 0.25 }
  pace: 1
```

**Acceptance:**
- Think time is monotonic across levels; jitter stays inside its band; deterministic for a seed+ply.
- The request is dispatched before the pause elapses (test asserts the call happened with zero timers advanced).
- Total wait is `max(elapsed, thinkMs)`, not their sum.
- Connect Four's opponent visibly pauses; a takeback or unmount mid-think discards the pending reply.

**Note:** this supersedes Tasks 8 and 9 of `2026-08-13-piano-chess-takeback.md`. Mark those superseded in that plan rather than building chess-only pacing twice.

---

### Task 4: The staff address rail

**Why:** Chess already renders staff-notation addresses on the board axis (`StaffNoteLabel` on `fileLabels`/`rankLabels`, switchable via `addressing: chords|staff`). Connect Four prints a text legend in a side panel; Checkers prints note names on the cells. Three implementations, one idea, and the two newer ones are the worse ones.

**Files:**
- Create: `frontend/src/modules/Piano/game-platform/families/addressed-board/AddressRail.jsx` + `.scss` (+ test)
- Move: `StaffNoteLabel.jsx`/`.scss` from `PianoChessGame/` into the family, re-exported so chess keeps working
- Modify: `InstrumentBoardStage.jsx` — accept `topRail` alongside the existing slots
- Modify: `PianoConnectFour.jsx`, `PianoCheckers.jsx`, `PianoChessGame.jsx`

**Interfaces produced:**
- `<AddressRail addresses={[{ midi, label, chord }]} notation="staff|chords|names" orientation="horizontal|vertical" active={index} />`
- `InstrumentBoardStage` gains a `topRail` slot rendered above `primary`.

**Per game:**
- **Connect Four:** seven staff cards above the board, one per column, in column order, from `config.column_notes`. The active/hovered column highlights. The text legend in the settings panel goes away — the board says it.
- **Checkers:** addresses move off the cells and onto the axis — file letters and rank numbers as staff notes, matching chess's treatment. Cells carry pieces only.
- **Chess:** keeps today's behaviour; its labels now come from the shared component.

**Notation setting:** `staff` (default), `chords`, or `names`. When `chords`, show chord spellings; when `names`, note names. Per game, in its own config.

**Acceptance:** each game renders its addresses on an axis/rail and never on a playable cell; all three read from one component; chess's existing address tests still pass.

---

### Task 4b: Connect Four — the disc actually falls

**Why:** a disc that teleports into its slot gives a player nothing to follow. Live
evidence from the kiosk: opponent replies landed **206ms** apart (`08:43:33.512` →
`33.718`) and one whole game ran start to finish in **two seconds**, ending in a loss.
Task 3 gives the opponent time to think; this gives the move something to look at.
Together they are what makes the game readable.

**Files:**
- Modify: `frontend/src/modules/Piano/PianoConnectFour/PianoConnectFour.jsx` and `.scss`

**Required:**
- A dropped disc animates from above the board down to its resting row, accelerating —
  gravity, not a linear slide. Land it with a short settle (a small squash or bounce),
  because a disc that stops dead reads as a bug.
- Duration scales with distance fallen: a disc landing in the bottom row travels further
  and takes longer than one stacking on top. A fixed duration makes the near ones feel
  sluggish and the far ones feel teleported.
- **`transform` and `opacity` only — never `top`/`height`/`filter`.** Animating layout
  properties on the piano tablet drops the whole screen's frame rate with no long tasks
  to show for it, which makes it invisible in a profiler and expensive on the bench.
- The board must not reflow while a disc is in flight. Animate the disc, not the grid.
- The move is committed in state immediately; the animation is presentation only. A
  player who plays the next column mid-animation must never lose that input, and an
  unmount mid-flight must not leave a stuck element.
- Honour `prefers-reduced-motion`: fall back to a brief fade-in rather than no feedback
  at all.

**Acceptance:** dropping a disc into an empty column visibly falls further and slower
than one landing on a full stack; rapid successive plays queue or overlap without
dropping a move; no test regressions.

---

### Task 5: The games grid — three rows, right-sized

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/tileGridLayout.js` (+ test)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Games/Games.jsx` if needed, and the tile SCSS

**The bug:** `balancedColumns(9)` returns 5, giving a ragged 5+4 across two rows. The helper minimises rows on purpose ("staying above the fold matters more than a perfectly square grid"), which is right for the 10-item home menu and wrong for a 9-tile game wall on a landscape kiosk.

**Required:** 9 tiles lay out **3×3**. Use `balancedGrid`'s balance rule (no row differs from another by more than one) with a **squarer** target for this menu — do not simply lower the global cap, which would re-rag the home menu. Add a test pinning 8→3×3-ish (3/3/2), 9→3×3, 10→(4/3/3 or 5×2 — pick one and pin it), and pin the home menu's existing counts unchanged.

**Also:** restore spacing. Tiles currently read edge-to-edge with no breathing room. Set gap and outer padding from house tokens, and size tiles so 3×3 fills the stage without overflowing above the keyboard dock.

**Verify on the real page**, not only in unit tests. Headless Playwright reaches `https://daylightlocal.kckern.net/piano/games` but lands on a "Connecting… / Continue without piano" gate — click **Continue without piano** first, then screenshot and read back `gridTemplateColumns`, `gap`, `padding` and the tile rect.

---

### Task 6: Visual pass — tile chrome, rhythm, type, side rails

**Scope, in the user's words:** spacing and rhythm, typography and labels, tile chrome, and "side rails look thrown together."

**REQUIRED SUB-SKILL:** load `frontend-design` before touching any of this. This is a design task, not a CSS chore, and the current look was called "AI slop" — uniform cards, flat radii, no hierarchy.

**Files:** `PianoTile` + its SCSS, `InstrumentBoardStage.scss`, the three games' rail markup, and the shared token layer.

**Direction:**
- **Side rails** are the worst offender: chess's rails are a stack of unrelated cards (In hand / says / gesture cards / summary / actions) with no shared rhythm. Give the family one rail vocabulary — a consistent slot header treatment, one card idiom, one spacing scale — and have all three games fill it.
- **Typography:** establish hierarchy between a slot label and its value. Labels are currently the same weight and near the same size as the values they label.
- **Tile chrome:** the picker tiles read as generic cards. They should read as *this instrument's* furniture.
- **Rhythm:** one spacing scale, applied. No element flush to a container edge.

**Constraint:** cosmetic only. No behaviour, no markup restructuring beyond what the rail vocabulary needs, and every existing test still passes.

**Acceptance:** before/after screenshots of `/piano/games`, `/piano/games/chess`, `/piano/games/connect-four` and `/piano/games/checkers` at 1920×1080, taken through the "Continue without piano" gate.

---

## Verification

```bash
./node_modules/.bin/vitest run \
  frontend/src/modules/Piano/ shared/gaming/ \
  backend/src/2_domains/gaming/ backend/src/3_applications/piano-games/ \
  backend/src/4_api/v1/routers/ backend/src/5_composition/modules/
```

Then on the kiosk: the games grid is 3×3 with visible margins; Connect Four's opponent pauses before answering and its columns are addressed by staff cards above the board; Checkers' cells carry pieces only; chess is unchanged in behaviour and still refuses to promote a help-heavy game.

## Out of scope

- Retiring `/api/v1/chess/*` (one release of overlap, deliberately).
- Any change to Battle Stadium, which is an external runtime.
- New games.
