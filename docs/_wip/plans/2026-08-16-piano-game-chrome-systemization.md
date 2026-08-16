# Piano game chrome — audit, systemization, hardening

**Date:** 2026-08-16
**Scope:** the game chrome mounted by `PianoKiosk/modes/Games/`, i.e. `frontend/src/modules/Piano/game-platform/` and the three addressed-board games (`PianoChessGame/`, `PianoCheckers/`, `PianoConnectFour/`).
**Status:** plan, not yet executed.

> Location note: the games are **not** under `PianoKiosk/`. `PianoKiosk/modes/Games/Games.jsx` is a 142-line router + picker; every game lives at `Piano/Piano*Game/` and the shared shell at `Piano/game-platform/`. That split is fine and should stay — this plan works on the latter two.

---

## Part 0 — Audit: what is actually wrong

### 0.1 There are three generations of chrome on screen at once

| | Chess | Checkers | Connect Four |
|---|---|---|---|
| Stage layout | own `.piano-chess__stage` grid | `InstrumentBoardStage` | `InstrumentBoardStage` |
| Rail panels | 6 hand-rolled `<section>`s | `.checkers-opponent` / `.checkers-settings` | `.connect-four-opponent` / `.connect-four-settings` |
| Panel header | `<h2 class="__slot-label">` eyebrow | `<strong>` | `<strong>` |
| Design tokens | 97 token refs / 30 raw hex | **0 token refs / 27 raw hex** | **0 token refs / 21 raw hex** |
| Settings controls | `.chess-settings__opt` toggle buttons | unstyled native checkbox | unstyled native `<select>` + checkbox |
| Transport client | own `chessApi.js` (180 lines) | `createPianoGameClient` (9 lines) | `createPianoGameClient` (14 lines) |
| Structured logging | yes | api only, none in component | api only, none in component |

Measured token/hex counts across every game SCSS:

```
 1 hex /  3 tok  PianoChessGame/ChessClock.scss
 0 hex / 45 tok  PianoChessGame/OpponentRoster.scss
 4 hex / 16 tok  PianoChessGame/GestureCards.scss
30 hex / 97 tok  PianoChessGame/PianoChessGame.scss
27 hex /  0 tok  PianoCheckers/PianoCheckers.scss        ← 0% tokenized
21 hex /  0 tok  PianoConnectFour/PianoConnectFour.scss  ← 0% tokenized
 0 hex /  0 tok  game-platform/**                        ← platform owns no visual layer
```

The platform has a **layout** layer and no **visual** layer. So every game invents its own, and the two newest ones invented one that shares nothing with the house style defined in `Apps/PianoApp.scss` (`--piano-*`, `--t-*`, `--r-*`, `--sp-*`).

### 0.2 The siderails are copy-paste twins

`PianoCheckers.scss` and `PianoConnectFour.scss` are 29 lines each and are the same file with different hexes:

```scss
/* checkers */  .checkers-opponent, .checkers-settings     { …; padding: 1rem; border-radius: 1rem; background: #071526b8; }
/* c4 */        .connect-four-opponent, .connect-four-settings { …; padding: 1rem; border-radius: 1rem; background: #071526aa; }

/* checkers */  .checkers-status button     { border-radius: .6rem; padding: .45rem .9rem; background: #72f1b8; … }
/* c4 */        .connect-four-status button { border-radius: .6rem; padding: .45rem .9rem; background: #72f1b8; … }
```

Duplicated across the pair: the panel, the status bar, the "Play again" pill, the `min(100%, 34rem)` board cap **and** the top-rail width that has to match it, the accent (`#ffdc5e` vs `#ffe081` — same intent, two values), the page gradient. In JSX: `userIdOf()`, `LADDER_LEVELS`, `OPPONENT_THINK_FALLBACK_MS`, `restart()`, the save-on-game-over effect, the archive-on-unmount effect, and the ladder block (`name / Level N of 7 / W of 3 wins`) are all duplicated verbatim.

Neither uses a single house token. Both are 1px off from each other on every measurement, which is exactly what reads as slop.

### 0.3 Chess already solved this and the solution is trapped inside chess

`PianoChessGame.scss:11-33` defines a genuine, subject-specific palette — a **piano cabinet**: case, ivory, ivory-dim, brass, brass-glow, felt, walnut — aliased onto the house tokens. Its rail vocabulary is consistent and good: bordered `--r-md` slot on `--piano-surface`, a `--t-cap`/`--piano-muted` eyebrow header, an accent-tinted `--active` state via `color-mix`, a foot-pinned action row, and — the best rule in the file — **every rail slot reserves its height so nothing reflows while fingers are on the keys** (`__hand { min-height: 8.5rem }`, `__says { min-height: 9.75rem }`).

That vocabulary is the design system. It is currently private to one game under a `--pc-` prefix, and repeated inline six times within that game.

### 0.4 Doc/code drift

`docs/reference/piano/piano-game-platform.md` states `single-centered` is used by "Chess and Connect Four". Chess does not use `InstrumentBoardStage` at all — it hand-rolls the identical three-column equal-rail grid in `.piano-chess__stage`. The doc describes the target state as if it were the current state.

### 0.5 Hardening gaps

| # | Finding | Where | Severity |
|---|---|---|---|
| H1 | No error boundary around the lazy game. A throw inside any game blanks the kiosk, and the render watchdog then reloads the tablet. `modes/Videos/PlayerBoundary.jsx` is the in-repo pattern. | `Games.jsx:GameHost` | high (kiosk) |
| H2 | Zero structured logging in the Checkers, Connect Four, Flashcards and Hero components — violates the CLAUDE.md "new features ship with logging" rule. No mount, no ladder resolve, no local-practice fallback, no game-over event. | 4 games | high |
| H3 | Unstyled native `<select>` and `<input type=checkbox>` render as OS light-grey widgets on the charcoal kiosk, and their hit targets are well under the 48px the rest of the kiosk uses. | C4 `:223,:228`, Checkers `:256` | medium |
| H4 | `.checkers-status button` / `.connect-four-status button` are `.45rem .9rem` — roughly 30px tall. The only way to restart a finished game. | both | medium |
| H5 | Status line has no `role="status"` in Checkers/C4 (chess has it on its prompt), so the turn/result never announces. | both | medium |
| H6 | The archive-on-unmount effect keys on `[userId]`; a mid-game identity change runs cleanup and files an incomplete game. Needs verification, then a ref for the id. | both | medium |
| H7 | `userIdOf` duplicated; chess resolves the user a third way (`lockedUser`). | 3 files | low |
| H8 | Chess passes no `onNoteOn`/`onNoteOff` to its instrument while Checkers/C4 do — the on-screen keyboard is tappable in two games and inert in the third. Decide which is intended and make it uniform. | chess `:1275` | low |
| H9 | Global `:focus { outline: none }` in `PianoApp.scss` plus no `:focus-visible` on any game button — keyboard focus is invisible inside the games. | platform | low |

---

## Part 1 — Design plan

Not a new identity. The kiosk's identity is fixed (`PianoApp.scss`, Roboto Condensed is canon) and Chess has already proved a good dialect of it. The job is to **promote chess's cabinet vocabulary out of chess and into the platform**, then make the other two games speak it.

### Color — the cabinet, 7 named values

Defined once on `.piano-game-host`, all aliased to existing house tokens so nothing in chess changes visually on migration:

| Token | Value | Meaning |
|---|---|---|
| `--pg-case` | `#16161b` (`--piano-bg`) | the cabinet the whole game sits in |
| `--pg-shelf` | `#1f1f26` (`--piano-surface`) | the music desk — every rail slot |
| `--pg-shelf-lift` | `#2a2a33` (`--piano-surface-2`) | nested / the game's speech bubble |
| `--pg-hairline` | `#34343f` (`--piano-border`) | every slot edge, one weight, 1px |
| `--pg-ivory` / `--pg-ivory-dim` | `#f1f1f4` / `#9a9aa6` | key-white text / damper-grey labels |
| `--pg-brass` / `--pg-brass-fill` | `#5fe39a` / `#2ec46f` | the single accent: *live now / play this* |
| `--pg-felt` | `#e05a4f` | refusal and danger, nothing else |

The **board** is the only place a game gets a hue of its own (`--pg-board-light` / `--pg-board-dark` / `--pg-board-max`), set by the game on its own board element.

**The risk taken:** retire the per-game full-screen gradients (`radial-gradient(#193b68…)` in C4, `radial-gradient(#334155…)` in Checkers) and the twin `#72f1b8` mint accent. One cabinet, three boards. Three games in one kiosk that each repaint the entire screen a different colour read as three different apps by three different people — which is what they currently are. The board carries the game's colour; the furniture around it is the instrument, and the instrument does not change colour when you change what you play on it.

### Type — role assignments, no new faces

| Role | Token | Treatment |
|---|---|---|
| Slot label (eyebrow) | `--t-cap` | `--pg-ivory-dim`, the engraved nameplate voice |
| Instruction / prompt | `--t-body` | `--pg-ivory`, line-height 1.35 |
| Value (chord, count, level) | `--t-h` | `--pg-ivory`, `tabular-nums` |
| Character name | `--t-title` | `--pg-ivory` |

`font-variant-numeric: tabular-nums` becomes mandatory anywhere a number changes in place (clock, score, piece counts, wins) — Chess's clock already does it, Checkers' piece counts do not, and a proportional digit jitters the rail every ply.

### Layout — one rule, already proven

```
┌──────────────────────────────────────────────────────────────────┐
│ ┌─ rail ──┐   ┌──── top rail (BOARD width, not stage width) ──┐  │
│ │ ▤ slot  │   │  ♪   ♪   ♪   ♪   ♪   ♪   ♪                    │  │
│ │  label  │   ├───────────────────────────────────────────────┤  │
│ │  body   │ ♪ │                                               │  │  ┌─ rail ─┐
│ ├─────────┤ ♪ │                   BOARD                       │  │  │ ▤ slot │
│ │ ▤ slot  │ ♪ │            (centred unconditionally)          │  │  │ ▤ slot │
│ │  (held  │ ♪ │                                               │  │  │ ▤ slot │
│ │  height)│   └───────────────────────────────────────────────┘  │  └────────┘
│ ├─────────┤                                                      │
│ │ ▤ slot  │                                                      │
│ └─────────┘                                                      │
│ [⚙ actions, pinned to foot]  ── status ──   [ Play again ]        │
├──────────────────────────────────────────────────────────────────┤
│ ▓▓ ▓ ▓▓ ▓ ▓  keyboard dock — platform-owned, one per screen       │
└──────────────────────────────────────────────────────────────────┘
```

The rule, lifted verbatim from `.piano-chess__stage`'s own comment and made a platform contract: **the two rails are always the same width, so the board is centred as a property of the layout rather than as a coincidence of the current content length. A rail fits the width it is given; it never sets it.**

### Signature — the reserved slot

The one memorable element, and the one place to spend boldness: **a rail slot holds its size whether or not it has anything to say.** An empty socket shows that something belongs there (inset well, dashed lip) rather than collapsing. A message that grows from one line to two does not shove the gesture cards down 9px. A read-out that resizes as fingers land drags the eye and, worse, moves the board — during the exact half-second the player is looking at the board.

This is already true in Chess (`min-height: 9.75rem` "above the TALLEST state, measured, not guessed") and true nowhere else. Codifying it as `<GameSlot reserve="…">` is the systemization, and the reservation values become a documented, testable property instead of a comment.

Everything else stays quiet: one hairline weight, one radius (`--r-md`), one accent, one active treatment (`color-mix` tint + accent border, never a glow, never a filter — `filter` is a documented frame-rate killer on the SM-T590).

### Design self-critique

- *Is charcoal + green accent one of the templated AI defaults?* It is adjacent to "near-black with a single bright accent" — but it is the shipped identity of this app, declared in `PianoApp.scss`, and the brief is to systemize an existing kiosk, not to redesign it. The skill's rule applies: the brief's own words win. The non-default part is the cabinet vocabulary and the reserved-slot rule, both derived from the subject (piano furniture, hands on keys) rather than from a template.
- *Is the `--pg-` alias layer ceremony over just using `--piano-*` directly?* It earns its place for exactly one reason: it names the roles a **game** has (case / shelf / board / brass / felt) which the app-level tokens don't (`--piano-surface` doesn't tell you a rail slot goes there). If it turns out no game ever overrides one, collapse it at Phase 4 review.
- *Numbered markers, eyebrows, dividers* — Chess's `Step N of M` onboarding numbering stays because it is a real ordered sequence. No numbering is introduced anywhere else.

---

## Part 2 — Systemization: the kit

New directory `game-platform/chrome/` (extends the existing `GameChrome.jsx`), all of it token-driven, all of it tested:

| Primitive | Replaces |
|---|---|
| `gameChrome.scss` — the `--pg-*` layer on `.piano-game-host` | chess's private `--pc-*` block; 48 raw hexes in Checkers + C4 |
| `<GameRail side>` / `.pg-rail` — fixed-width column, foot-pinned actions, overflow-clipped | `.piano-chess__rail`, `InstrumentBoardStage__rail` ad-hoc children |
| `<GameSlot label reserve variant>` / `.pg-slot` — bordered tile + eyebrow header; variants `default` / `active` / `muted` / `well` | `.piano-chess__hand`, `__says`, `__identity`, `__opponent`, `__captured`, `.gesture-card`, `.checkers-opponent`, `.checkers-settings`, `.connect-four-opponent`, `.connect-four-settings` |
| `<GameStatusBar>` / `.pg-status` | `.checkers-status`, `.connect-four-status`, chess's ad-hoc status |
| `<GameButton variant>` / `.pg-btn` — `primary` (accent pill) / `ghost` / `icon`; 48px minimum | `.piano-chess__cancel`, `.piano-chess__settings-btn`, both games' `status button` |
| `<GameToggle>` / `<GameChoice>` | the native `<select>` and two native checkboxes (H3); generalizes `.chess-settings__opt` |
| `<LadderBadge>` — name, `Level N of M`, `W of N wins`; `portrait` and `text` densities | duplicated ladder blocks in Checkers + C4; `.chess-ladder-progress` |
| `--pg-board-max` on `<InstrumentBoardStage>` | the `min(100%, 34rem)` magic number duplicated in 4 places across 2 files |

`InstrumentBoardStage` also grows the two things Chess needs before it can adopt it: `container-type: size` on the boards column (chess sizes its board in `cq` units) and a `bleed` hook for the rank-axis centring compensation (`margin-inline-end: var(--pc-axis-w)`).

**Not in scope for extraction:** anything genuinely chess-specific — `OpponentPortrait`, `ChessClock`, `GestureCards`' key diagrams, `ChordReadout`, the onboarding stepper. Those stay in chess. The kit is furniture, not gameplay.

---

## Part 3 — Sequencing

Each phase is independently mergeable and independently verifiable on the kiosk.

**Phase 1 — Kit, no consumers.** Build `game-platform/chrome/` + `gameChrome.scss`. Unit tests per primitive (renders label, honours `reserve`, `active` variant sets the accent, button meets 48px). Nothing else changes; no visual diff anywhere.

**Phase 2 — Checkers + Connect Four siderails.** The biggest visible win at the lowest risk: two 29-line SCSS files and ~60 lines of rail JSX each. Delete both SCSS files down to board-only rules; rails become `<GameRail><GameSlot>…`. Also lands H3, H4, H5 and the `LadderBadge`/`userIdOf` dedupe. **This is the phase that fixes the slop the request named.**

**Phase 3 — Shared game shell.** Extract the duplicated component logic the two games still share after Phase 2: `useAddressedBoardGame({ gameId, client, engine, ladderLevels })` covering config/ladder load, `restart`, the save-on-game-over effect, the archive-on-unmount effect (fixing H6), and the local-practice flag. Lands H2 (structured logging) once, in the hook, for both games.

**Phase 4 — Chess, mechanically.** Point chess's `--pc-*` aliases at the `--pg-*` layer (a one-line-per-token change, zero visual diff), then swap its six inline rail sections for `<GameSlot>` with the measured `reserve` values preserved exactly. **Chess is freshly calibrated and just shipped to prod** (`13536d355`) — this phase is a like-for-like swap, verified by screenshot diff, not a redesign.

**Phase 5 — Chess onto `InstrumentBoardStage`.** Optional and gated on Phase 4 being clean. Only worth doing if the `container-type`/`bleed` hooks land cleanly; if chess's stage still needs a third and fourth hook, leave `.piano-chess__stage` alone and record why in the platform doc.

**Phase 6 — Hardening + guardrails.**
- H1: `GameErrorBoundary` in `Games.jsx:GameHost`, modelled on `PlayerBoundary.jsx`, recovering to the picker rather than blanking under the watchdog.
- H8, H9: settle keyboard interactivity and add `:focus-visible` to `.pg-btn`.
- Guardrail: a test that fails on a raw hex literal in any `Piano/**/game*/**.scss` outside the token block — this is what stops generation four appearing.
- Update `docs/reference/piano/piano-game-platform.md` to describe what the code does (fixes 0.4), with a "chrome kit" section listing each primitive and what a new game is expected to use.

---

## Part 4 — Verification

- Unit tests per primitive (Phase 1) and per extracted hook (Phase 3).
- Existing game tests must keep passing untouched — 46 test files already cover these games; any change to one is a signal the migration changed behaviour.
- Screenshot comparison on the kiosk before/after Phase 4 (chess must be pixel-stable) and after Phase 2 (checkers/C4 are expected to change, and should be reviewed against this plan's palette).
- Kiosk check on the real tablet (10.0.0.245) for frame rate after Phase 2 — the migration removes two full-screen gradients, which should help rather than hurt, but the SM-T590 is where this is decided.
