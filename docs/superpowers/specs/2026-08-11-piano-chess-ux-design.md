# Piano Chess UX — Design

**Date:** 2026-08-11
**Status:** Approved, not yet implemented.
**Surface:** `/piano/games/chess` (`frontend/src/modules/Piano/PianoChessGame/`)

## Problem

Piano Chess plays chess by chords: the file names the root, the rank names the quality,
and a move is the two chords that perform it. The rules layer is sound and the board now
fits and reads well. Three things are not built.

**The opponent cannot be made harder or easier in any meaningful way.** chess.js supplies
no AI at all — it is a rules library. The opponent is `shared/gaming/chess/opponent.mjs`,
118 lines of minimax over a material-plus-centre eval, with three rungs that differ only
in search depth (1, 2, 3) and a blunder rate. Depth 3 on that eval is a weak club player,
so the top of the ladder is not challenging and the bottom is only "blunders randomly",
which reads as broken rather than gentle.

**Nothing is configurable.** There is no `chess` block in `piano.yml` and no chess config
file anywhere. Difficulty, the feedback cues, the chord scheme and the opponent delay are
all constants compiled into the bundle. Changing any of them is a code edit and a deploy.

**The piano tells the player almost nothing.** The chord cursor waits 140ms for the held
set to settle, previews a square, and commits on release, which is a good model. But when
the board does not respond, the player cannot tell whether the game misheard the chord,
heard a chord that is not a square, or heard the right square and refused the move. The
on-screen keyboard along the bottom — the largest single element on the screen — is
decorative, mirroring held notes and nothing more.

## Decisions

Four decisions were taken during design and are settled:

1. Configuration is **player-facing and in-game**, backed by a global `chess.yml` with
   per-user overrides.
2. The opponent is **Stockfish, server-side**, not a client-side or homegrown engine.
3. The engine runs **in-process in a worker thread**, not in its own container.
4. Piano feedback means **a live chord reading on the keyboard strip** and **a ghost
   preview on the target square**. Audible confirmation and near-miss coaching were
   considered and cut.

### Why server-side Stockfish

Measured on kckern-server against `stockfish@18` (`lite-single`, 7MB wasm):

| Property | Measurement |
|---|---|
| Load to `uciok` | 5 ms |
| `Skill Level` | available, 0–20 |
| `UCI_Elo` | available, **min 1320**, max 3190 |
| Move latency | equals the movetime cap (107 ms at 100, 507 ms at 500) |

The Elo floor is the load-bearing number: 1320 is already a solid club player, so
`UCI_Elo` cannot express the bottom of a household ladder. Low rungs must come from
`Skill Level`, which degrades play deliberately rather than randomly, and only the top
rungs use `UCI_Elo`.

Server-side keeps the 2018 Galaxy Tab doing no work and puts the engine next to the
config that tunes it.

### Why a worker thread, not a container

A UCI engine is a stdin/stdout process, not a server. Containerising one as a service
requires writing an HTTP or WS wrapper around its pipes — which is the adapter we are
writing regardless — so a separate container buys a second image, a second deploy path
and a network hop while handing back the same work. (The widely-cited Stack Exchange
attempt at this fails for exactly this reason: the container exits `Exit 0` because
nothing is attached to stdin, and the accepted answer abandons the split for one fat
image.)

The one real cost of running in-process was measured, not assumed. On the main thread a
search starves the event loop:

| Condition | Max loop lag | Timer samples in window |
|---|---|---|
| Idle baseline | 2 ms | normal |
| `movetime 300` | 43 ms | 6 (expected ~30) |
| `movetime 1000` | 44 ms | 22 (expected ~100) |

The backend serves fitness, the player and every screen from that loop, so ~44 ms stalls
for the duration of every opponent move is a house-wide symptom caused by a game feature.
A worker thread removes it for the cost of one file.

The adapter boundary makes this reversible: if deep analysis, eval graphs, puzzle
generation or Maia-style human-like play ever justify a dedicated engine service, that is
a transport swap behind `StockfishEngineAdapter`, not a redesign.

## Architecture

```
frontend PianoChessGame ──POST /api/v1/chess/move──▶ chess router
                        ──GET/PUT /api/v1/chess/config──▶ chess router
                                                            │
                                                   ChessConfigService  ── chess.yml
                                                            │          └─ users/{id}/apps/chess/config.yml
                                                   StockfishEngineAdapter
                                                            │
                                                     worker_thread ── stockfish lite-single wasm
                                                            └─ fallback: shared/gaming/chess/opponent.mjs
```

### Engine adapter

`backend/src/1_adapters/chess/StockfishEngineAdapter.mjs` owns one long-lived worker and
exposes a single method:

```
chooseMove({ fen, rung, gameId }) -> { from, to, promotion?, san, engine, thinkingMs }
```

- The worker (`stockfishWorker.mjs`) loads the wasm once, speaks UCI, and returns
  `bestmove`. `ucinewgame` is issued when `gameId` changes.
- Searches are **serialized**: one at a time, queued. A household has one board; a queue
  is simpler than a pool and makes latency predictable.
- Every search carries a timeout of `movetime_ms + 1500`. The margin covers worker
  scheduling and UCI round-trips; a search that overruns it is treated as a hung engine.
  On timeout, or if the
  worker never boots, the adapter falls back to `chooseMove` from
  `shared/gaming/chess/opponent.mjs` and reports `engine: 'fallback'`. **A child must
  never be stuck in front of a board that will not answer because a wasm failed to
  load.**
- The adapter logs `chess.engine.move` (rung, thinkingMs, engine) and
  `chess.engine.fallback` (reason) through the backend logger.

### Docker

`npm i stockfish` unpacks to 251 MB because it ships every build variant. The image keeps
only `stockfish-18-lite-single.js` and `stockfish-18-lite-single.wasm` (~7 MB), pruned in
the Dockerfile after install. The build must fail loudly if those two files are absent
rather than shipping an image whose chess silently runs on the fallback.

### API

`backend/src/4_api/v1/routers/chess.mjs`:

- `POST /move` — body `{ fen, rung, gameId }`. The FEN is validated with the existing
  `validateFen` from `shared/gaming/chess/engine.mjs` before it reaches the engine.
  Returns the move plus which engine produced it.
- `GET /config?user=<id>` — the merged config (global under user).
- `PUT /config?user=<id>` — writes the **user layer only**. The global file is never
  written from the game.

One request per move. No WebSocket: there is nothing to stream until a live eval bar
exists, and adding one later does not disturb this contract.

### Configuration

`data/household/config/chess.yml` — the house defaults:

```yaml
default_rung: learner
rungs:
  - id: first-moves
    label: First moves
    skill: 0
    movetime_ms: 100
  - id: learner
    label: Learner
    skill: 3
    movetime_ms: 200
  - id: steady
    label: Steady
    skill: 8
    movetime_ms: 300
  - id: sharp
    label: Sharp
    skill: 14
    movetime_ms: 500
  - id: ruthless
    label: Ruthless
    elo: 1800
    movetime_ms: 800
opponent_delay_ms: 700
shuffle_each_turn: true
feedback:
  flash_rejected: true
  toast: true
  highlight_sources: true
  highlight_targets: true
```

A rung sets **either `skill` or `elo`, never both.** They are different mechanisms and
setting both is ambiguous: `elo` requires `UCI_LimitStrength true`, which makes the engine
target that rating and ignore `Skill Level` entirely. The adapter sends
`UCI_LimitStrength false` + `Skill Level` for a skill rung, and `UCI_LimitStrength true` +
`UCI_Elo` for an elo rung. A rung carrying both is a config error: the adapter logs a
warning and honours `elo`. Because the engine's floor is 1320, an `elo` below that is
clamped up and warned about.

`data/users/{id}/apps/chess/config.yml` holds a sparse override of the same shape —
typically just `default_rung` and `feedback`. Merge is global ← user, per top-level key,
with `rungs` replaced wholesale rather than merged element-wise (a half-merged ladder is
never what anyone means).

An unknown `default_rung` resolves to the middle rung and logs a warning; it must not
throw, because a typo in YAML should not take the game down.

The existing `feedback` cues keep their current meaning, with one change already shipped:
`highlight_sources` and `highlight_targets` are gated on a refusal, so they describe how
loudly the board answers a *mistake*, not what it volunteers up front.

### In-game settings panel

A panel on the chess screen, opened from the right rail, offering: difficulty rung, hint
level, chord map shuffle, and opponent delay. It is reachable by touch and by piano, per
the kiosk's existing input rules, and every control is a discrete tap target — no
sliders.

Hint level is one three-way control over the two *legality* cues, because "how much does
the board show me about legal moves" is one question to a player and two booleans to the
code:

| Hint level | `highlight_sources` / `highlight_targets` |
|---|---|
| Off | never shown |
| After a mistake (default) | shown once a chord is refused, hidden again when the next move lands |
| Always | shown whenever a piece can be picked up or is held |

`flash_rejected` and `toast` are not part of this control. They answer a different
question — how loudly a refusal is announced — and stay on, configurable only from YAML.
The panel therefore writes `feedback.hint_level` to the user layer, and the resolver
projects that onto the two booleans plus the gating rule; the YAML booleans remain the
underlying truth so an advanced user can still set them directly.

Changing a setting applies to the game in progress and writes the user's override layer.
Difficulty changes take effect on the opponent's next move; they never restart the game.

### Piano feedback

**The keyboard strip becomes the instrument's read-out.** It already renders held notes.
It gains: the chord it hears named (`Fmaj7`), and the square that names (`e4`), or an
explicit "not a square on this board" when the held set does not resolve. This is the
single highest-value change in the design, because it converts every silent non-response
into a legible one — the player can see whether the game misheard them or they aimed at
the wrong square.

**A ghost piece previews the destination.** While a chord is held and a piece is
selected, the target square shows a translucent copy of the piece, with a ring that
completes over the settle window. Commit-on-release then reads as aiming rather than
hoping.

Both are driven by state the component already computes (`cursorChord`, `cursor`,
`game.origin`); neither needs new engine or network work.

## Testing

- **Adapter:** worker boots and answers a known position; `bestmove` parsing; timeout
  falls back to the homegrown engine and says so; two concurrent requests serialize
  rather than interleave; `ucinewgame` is issued when `gameId` changes.
- **Config:** global-only resolves; user override wins per key; unknown rung falls back
  to the middle rung and warns; `PUT` writes only the user file.
- **API:** invalid FEN is rejected before reaching the engine; a move response names its
  engine.
- **Frontend:** the keyboard strip names a held chord and its square, and says so when
  the set is not a square; the ghost preview appears while held and clears on commit and
  on cancel; the settings panel writes an override and applies the rung to the next move.
- Existing pure tests in `shared/gaming/chess/` and `PianoChessGame/` stay as they are.

Engine tests must not assert specific moves at a given skill level — Stockfish is free to
change its mind between versions. Assert that a legal move comes back, that it arrives
within the movetime budget, and that the fallback engages when it should.

## Scope

**In:** the engine adapter and its worker, the Dockerfile prune, the chess API router,
the config file pair and its merge, the in-game settings panel, the keyboard-strip chord
read-out, and the ghost preview.

**Out:** `School/chess/ChessLessons.jsx` keeps calling the homegrown `chooseMove` in the
browser. Moving it to the API is a small follow-up and deliberately not bundled here.
Also out: live eval bar, post-game analysis, puzzle generation, opening book, Maia or any
human-like engine, and audible move confirmation.
