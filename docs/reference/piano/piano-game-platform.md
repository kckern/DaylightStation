# Piano Game Platform

The Piano game platform standardizes the instrument-facing shell without pretending every game has the same gameplay model.

Piano remains the context owner for MIDI, instrument addressing, pedagogy, progression, and its native surfaces. A Piano game may implement the shared Gaming protocol through a checkpointed-local or remote authority, but Gaming does not own those concepts and an embedded scene renderer never becomes the gameplay authority.

## Ownership

- `game-platform/host` owns the fullscreen container, one keyboard dock, overlay stacking, host lifecycle projection, and the crash boundary (`GameBoundary`).
- `game-platform/input` owns normalized musical input events.
- `game-platform/chrome` owns **the cabinet**: the token layer every game's furniture is built from, and the furniture itself. See "The chrome kit" below.
- `game-platform/opponent` owns how long a board-game opponent appears to think before replying.
- `game-platform/families` owns mechanics shared by a genuine family of games:
  - `addressed-board`: semantic left/right rails, single/dual board layouts, column-drop or source/destination interaction grammars, and `useAddressedBoardGame` — the ranked/laddered/archived session a board game keeps around its rules (config load and patch, ladder, seed, session id, local-practice flag, restart, save-on-result, archive-on-abandon, structured logging). The game keeps its own transcript and passes it in; the hook reads it and never writes it.
  - `bound-action`: note/chord bindings, fresh-press rules, and hold-to-repeat behavior used by Tetris and Side Scroller.
- Each game owns rules, scene rendering, language, scoring, settings, and game-specific feedback.
- Battle Stadium remains an external runtime. It participates in registry discovery but does not inherit a piano gameplay model.


## The chrome kit

Before this existed, the platform owned layout and nothing else, so every game invented its own surface, border, accent and idea of how big a button is. Eight games shipped six palettes: Chess's stylesheet was 76% tokenized and the other seven were 0%, Checkers' panel was `#071526b8` where Connect Four's was `#071526aa`, and four separate games each picked their own neon for "you scored" (`#00ffc8`, `#38f0cf`, `#72f1b8`, and the house `#2ec46f`).

`game-platform/chrome` is the answer. Import from `chrome/index.js`.

### The cabinet (`gameChrome.scss`)

Declared once on `.piano-game-host` and `.piano-game-fullscreen`. The vocabulary is a piano cabinet, because that is what the player is sitting at: a CASE the game sits in, a SHELF every read-out rests on, IVORY for what you read, BRASS for what is live right now, FELT for a refusal. Every value aliases a house token from `Apps/PianoApp.scss`, so the kiosk keeps exactly one palette.

| Token | Role |
|---|---|
| `--pg-case` / `--pg-shelf` / `--pg-shelf-lift` | the cabinet, the music desk, a nested surface |
| `--pg-hairline` | every edge, one weight |
| `--pg-ivory` / `--pg-ivory-dim` | what you read / what labels it |
| `--pg-brass` / `--pg-brass-fill` / `--pg-brass-ink` | live now, do this — the only accent |
| `--pg-felt` | refusal and danger, nothing else |
| `--pg-rail-w` / `--pg-board-max` / `--pg-gap` / `--pg-tap` | rail width, board ceiling, seam, touch floor |

A game overrides **the board's colours and nothing else**. The board carries the game's hue; the furniture around it does not, so three games in one kiosk stop reading as three different apps.

### The furniture

| Primitive | What it is |
|---|---|
| `GameRail` | the fixed-width column beside the board. A rail FITS the width it is given; it never sets it. `foot` is pinned to the base. |
| `GameSlot` | **the signature.** A bordered tile with an optional label, and a `reserve` height it holds whether or not it has anything to say. Variants: `active`, `muted`, `lift`, `well`, `plain`. Never shrinks. |
| `GameButton` | `primary` / `ghost` / `danger` / `icon`. Every one clears `--pg-tap`. |
| `GameStatusBar` | the one sentence under the board, with `role="status"` and a reserved height. |
| `GameToggle` / `GameChoice` | replace the native checkbox and `<select>`, which rendered as OS widgets on a charcoal kiosk at hit sizes a child misses. |
| `LadderBadge` / `WinTally` | who you are playing, drawn as a ladder and a tally rather than spelled as "Level 3 of 7 · 1 / 3 wins". |
| `CountdownOverlay` / `LifeMeter` / `ProgressMeter` | the HUD. These existed unstyled for a year — `.piano-game-life__notch` drew nothing at all. |

Checkers and Connect Four expose seven neutral difficulty profiles. Display names, portraits, and themes come from mounted environment configuration; no rules engine owns or reuses a character roster. Rail copy is limited to labels, counts, and controls. A
sentence that explains a move, refusal, hint, or map change belongs in `GameStatusBar` or a toast,
not in permanently mounted rail furniture.

Player identity follows the same honesty rule. A game receives a roster-resolved display name (and
portrait where the surface supports one); a database id is never presentation copy. When a profile
cannot be resolved, the UI says `Player` or `Guest` rather than printing the slug.

### Terminal results stay put

A finished run is a decision point, not a timed advertisement. Game-over, victory, and completed-run
surfaces remain until the player explicitly starts again or leaves. On piano-only surfaces any fresh
key starts again; that alternative is stated in the status/result line, while the button itself keeps
the short action label `Play again`. A timeout must never silently return a completed game to `IDLE`,
because the host correctly interprets `IDLE` as an exited game.

### The reservation rule

A slot holds its size whether or not it has anything to say. The rails size the stage, so a read-out that grows a line as fingers land moves the **board** — during the exact half-second the player is looking at it.

Pass `reserve` measured **above** the slot's tallest state, never guessed, and never a floor below it: a floor reserves nothing, because the box still shrinks for shorter messages, which is the defect it was meant to fix. `.pg-slot` is `flex: 0 0 auto` for the same reason — a reservation that a short rail can overrule is not a reservation.

### The colour rule, and its guard

**A colour a game names must be NAMED** — declared as a custom property, in one palette block, in the file that owns it. Ordinary declarations reference a variable and never a literal.

Board and scene art still gets a colour of its own (the wood of a checkers board, the blue of a Connect Four grid). It just has to say its name out loud. `chrome/gameChromeTokens.test.js` enforces both halves and carries a per-file budget for how many colours each may name; the budgets are a ratchet that may fall freely and rise only with a reason written beside them.

### Crash containment

`GameBoundary` wraps the lazy game in `PianoKiosk/modes/Games/Games.jsx`. Nothing stood between a game's render and the app root, so any throw in any of the eight games blanked the whole screen — and on the piano tablet the render watchdog then read a dead page and rebooted it. The boundary recovers to the picker (not "try again in place": whatever state made the game throw is still there) and unlatches on `resetKey`, so one crashed game does not shut its neighbours out.

### School completion access

Games is a reward surface, so the active piano identity must resolve to School
state `complete` or `no_work_today`. The home tile, the routed `Games.jsx`
host, and `PianoVisualizer`'s note-launcher host each enforce the rule: neither
a deep link nor a note selection can bypass the gate.
The client reads the side-effect-free School lifecycle completion endpoint and
fails closed when identity or backend state is unavailable. Guest is explicitly
treated as `no_work_today`; it is not sent to a per-learner School endpoint.

## Addressed-board layout contract

`InstrumentBoardStage` exposes `leftRail`, `primary`, `secondary`, `rightRail`, and `status` slots. Its supported layout policies are:

| Policy | Use |
|---|---|
| `single-centered` | Connect Four and Checkers |
| `single-wide` | Wide rectangular boards |
| `dual-equal` | Two peer boards, such as Battleship placement/target views |
| `primary-secondary` | Main board plus a smaller tactical or private board |

The renderer remains game-specific. Chess therefore keeps its specialized piece and legality renderer; Connect Four owns its gravity board; a future Battleship game may provide two board renderers without changing the host.

**Chess does not use `InstrumentBoardStage`.** It hand-rolls the identical three-column equal-rail grid in `.piano-chess__stage`, because it also needs `container-type: size` (its board sizes itself in `cq` units) and a rank-axis centring compensation the stage has no hook for. It does use the chrome kit, and its `--pc-rail` reads `--pg-rail-w`, so the two layouts cannot drift apart on the one measurement that matters. Migrating it onto the stage is worthwhile only if those two hooks land cleanly; until then this paragraph is the reason, not an oversight.

### Chess frontend boundaries

`PianoChessGame.jsx` is the presentation composition root, not the owner of every chess use case.
It renders the board and rails, owns immediate interaction state, and wires these focused units:

- `useChessSessionIdentity` latches the player for one game and relatches both id and display name on restart.
- `useChessPersistenceLifecycle` owns completion records, page-exit/unmount archives, and restart bookkeeping. It consumes an injected persistence gateway; it does not import HTTP itself.
- `useChessOpponentTurn` owns request timing, stale-game cancellation, local fallback, and committing the served move. The HTTP request function is injected at the composition root.
- `useChessAddressingProgress` records the separate skill of turning staff/chord input into a valid square address.
- `chessRailViewModel` and `opponentViewModel` are pure derivation modules for rail copy, opponent state, onboarding, turn labels, and safe board theming.

The dependency direction is presentation composition root → focused presentation controllers →
pure chess rules and injected API clients. These React hooks are presentation controllers, not the
DDD application layer. New persistence, opponent, identity, or rail-copy behavior belongs in the
corresponding unit rather than growing `PianoChessGame.jsx` again.

Opponent speech follows a separate fail-open path: `OpponentPortrait` → `chessApi` →
`ChessOpponentCommentaryService` (application layer) → `IAIGateway` (port) → configured AI adapter.
The application service replays the submitted game and resolves the ladder opponent on the server;
the browser cannot invent a persona or feed unverified move facts to the prompt. Commentary is
cosmetic: a short deadline and deterministic fallback ensure it never gates move input, opponent
play, persistence, or ranking. Optional chess config lives under `personality` (`enabled`, `model`,
`timeout_ms`, and `max_chars`); safe defaults require no user-layer migration. The model is currently
allowlisted to the cost-capped Luna model, and timeout/length overrides are clamped server-side so a
crafted user preference cannot turn decorative copy into an expensive request.

## Opponent pacing

Chess, Connect Four, and Checkers all share one pacing capability rather than three ad hoc delays. `game-platform/opponent/opponentPacing.js` exports:

- `thinkTimeFor({ level, levels, config, seed, ply, pace })` — how long, in ms, a character at a given rung of a `levels`-rung ladder should appear to think. Interpolates the config's `floor`→`ceiling` across the ladder (21 rungs for Chess, 7 for Connect Four and Checkers), with deterministic jitter derived from `seed + ply` (never `Math.random`, so a game replays identically and a test can pin a value). Returns `null` when `level` is not a number, so a caller with no ladder resolved yet falls back to its own default.
- `useOpponentReply({ enabled, request, fallback, thinkMs, onReply, resetKey })` — fires `request()` the instant it is enabled, and commits whatever it resolves to at `max(elapsed, thinkMs)`. The think time is a floor on the total wait, never an addend on top of the network round trip — the bug this replaced (Chess) waited the delay and only then asked, turning a deliberate brood into a hang on a stalled kiosk WiFi; the other bug (Connect Four) had no floor at all, so a fast server reply looked like no opponent was present. `resetKey` (typically a `gameId`) cancels a pending reply on restart even when `enabled` itself does not toggle (e.g. a fresh Chess game that opens right back on the opponent's turn).

Per-game config lives under that game's own `opponent` key:

```yaml
opponent:
  think_ms: { floor: 600, ceiling: 4000, jitter: 0.25 }
  pace: 1
```

Pacing and presentation only — this module never touches rules or legality.

## Backend boundaries

The unified HTTP surface is `/api/v1/piano-games/:gameId`. HTTP handlers receive `PianoGamesContainer` and translate transport only. The application container resolves ladder access and orchestrates ports. `OpponentLadder` owns the pure promotion invariants. Engine and persistence implementations live under `1_adapters`; production wiring lives under `5_composition`.

Connect Four, Checkers, and Chess are complete vertical features on this surface. Their game-specific adapters retain ownership of transcript validation and deterministic fallback policy. Chess is reachable only at `/api/v1/piano-games/chess`.

| Game | Family | Instrument grammar | Server authority |
|---|---|---|---|
| Connect Four | addressed-board | one note or major chord addresses a column; seven-note cluster requests a suggestion | transcript validation, seven-opponent ladder, 3-of-5 promotion, worker move |
| Checkers | addressed-board | one exact note selects a playable square; source then destination; seven-note cluster requests a suggestion | forced-capture replay, seven-opponent ladder, 3-of-5 promotion, worker move |
| Chess | addressed-board | chord/staff source then destination | Chess application and Stockfish adapter through the native Piano Games mount |

Both new games persist configuration, ranked records, ladder progress, and household archives through `IPianoGameRepository`. A client-side fallback is labeled local practice and recorded with `ranked: false`, so loss of Wi-Fi never turns offline engine help into ladder advancement.

## Adding a game

1. Add registry metadata (`label`, `icon`, `status`, `family`, lazy component).
2. Mount the scene in `PianoGameHost`; do not render a second keyboard.
2b. Build every rail, panel, button, toggle and status line from the chrome kit. Name the scene's own colours in one palette block and nothing anywhere else — `gameChromeTokens.test.js` will tell you if you drift.
3. Reuse a family only when the interaction semantics match. Otherwise introduce a small new family or keep the game isolated.
4. Keep deterministic rules in `shared/gaming/<game>` when both browser and server need them.
5. Put server invariants in `2_domains`, orchestration and ports in `3_applications`, implementations in `1_adapters`, HTTP translation in `4_api`, and wiring in `5_composition`.
6. Add pure rule, application invariant, adapter lifecycle, and layout tests in proportion to the game.
