# Piano Game Platform

The Piano game platform standardizes the instrument-facing shell without pretending every game has the same gameplay model.

## Ownership

- `game-platform/host` owns the fullscreen container, one keyboard dock, overlay stacking, and host lifecycle projection.
- `game-platform/input` owns normalized musical input events.
- `game-platform/chrome` owns reusable countdown, life, and progress displays.
- `game-platform/families` owns mechanics shared by a genuine family of games:
  - `addressed-board`: semantic left/right rails, single/dual board layouts, and column-drop or source/destination interaction grammars.
  - `bound-action`: note/chord bindings, fresh-press rules, and hold-to-repeat behavior used by Tetris and Side Scroller.
- Each game owns rules, scene rendering, language, scoring, settings, and game-specific feedback.
- Battle Stadium remains an external runtime. It participates in registry discovery but does not inherit a piano gameplay model.

## Addressed-board layout contract

`InstrumentBoardStage` exposes `leftRail`, `primary`, `secondary`, `rightRail`, and `status` slots. Its supported layout policies are:

| Policy | Use |
|---|---|
| `single-centered` | Chess and Connect Four |
| `single-wide` | Wide rectangular boards |
| `dual-equal` | Two peer boards, such as Battleship placement/target views |
| `primary-secondary` | Main board plus a smaller tactical or private board |

The renderer remains game-specific. Chess therefore keeps its specialized piece and legality renderer; Connect Four owns its gravity board; a future Battleship game may provide two board renderers without changing the host.

## Backend boundaries

The unified HTTP surface is `/api/v1/piano-games/:gameId`. HTTP handlers receive `PianoGamesContainer` and translate transport only. The application container resolves ladder access and orchestrates ports. `OpponentLadder` owns the pure promotion invariants. Engine and persistence implementations live under `1_adapters`; production wiring lives under `5_composition`.

Connect Four and Checkers are complete vertical features on this surface. Their game-specific adapters share `SerializedWorkerOpponent`, which implements the Stockfish adapter's lazy worker, serialized queue, timeout, recovery, and disposal lifecycle. Each adapter retains ownership of transcript validation and its deterministic fallback policy. Chess is also reachable at `/api/v1/piano-games/chess`; `/api/v1/chess` remains its compatibility URI while the mature Chess application service is migrated behind the generic container.

| Game | Family | Instrument grammar | Server authority |
|---|---|---|---|
| Connect Four | addressed-board | one note or major chord addresses a column; seven-note cluster requests a suggestion | transcript validation, seven-opponent ladder, 3-of-5 promotion, worker move |
| Checkers | addressed-board | one exact note selects a playable square; source then destination; seven-note cluster requests a suggestion | forced-capture replay, seven-opponent ladder, 3-of-5 promotion, worker move |
| Chess | addressed-board | chord/staff source then destination | existing Chess application and Stockfish adapter through the unified compatibility mount |

Both new games persist configuration, ranked records, ladder progress, and household archives through `IPianoGameRepository`. A client-side fallback is labeled local practice and recorded with `ranked: false`, so loss of Wi-Fi never turns offline engine help into ladder advancement.

## Adding a game

1. Add registry metadata (`label`, `icon`, `status`, `family`, lazy component).
2. Mount the scene in `PianoGameHost`; do not render a second keyboard.
3. Reuse a family only when the interaction semantics match. Otherwise introduce a small new family or keep the game isolated.
4. Keep deterministic rules in `shared/gaming/<game>` when both browser and server need them.
5. Put server invariants in `2_domains`, orchestration and ports in `3_applications`, implementations in `1_adapters`, HTTP translation in `4_api`, and wiring in `5_composition`.
6. Add pure rule, application invariant, adapter lifecycle, and layout tests in proportion to the game.
