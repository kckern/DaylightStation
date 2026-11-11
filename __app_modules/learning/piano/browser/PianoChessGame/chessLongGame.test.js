import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { chessRuleModule } from "../../../../../__capabilities/gaming/portable/rulesets/chess/ruleModule.mjs";
import { applySquare, commitMove, createChessGameState, projectChessAuthorityState } from './chessGameState.js';
import longGame from './fixtures/long-game-200-plies.json';

/**
 * THE GAME THAT FROZE THE TABLET (chess-1794439407456, 2026-11-11).
 *
 * At ply 200 every chess call re-played the whole move list from the opening,
 * and every projection of the authority's state re-played every prefix of it —
 * O(n²) chess.js moves per board update. On this server that was ~4.6 s; on
 * the kiosk's 2018 tablet it measured as 30–66 s long tasks
 * (`piano.jank.snapshot frameMs.max 65814`). The opponent's 8 s request
 * timeout fired from inside the freeze, chords played into it were read
 * against a stale board, and the child sat in front of a board that did not
 * answer until he left.
 *
 * The budgets below are an order of magnitude above what a linear pass costs
 * here and an order of magnitude below what the quadratic one did.
 */
function coordinateMoves() {
  const engine = new Chess(longGame.initial_fen);
  return longGame.sans.map((san) => {
    const move = engine.move(san);
    return { from: move.from, to: move.to, promotion: move.promotion || null, san: move.san };
  });
}

describe('a 200-ply game stays playable', () => {
  const moves = coordinateMoves();

  it('reaches the position the child was left in', () => {
    let state = createChessGameState({ playerColor: 'w' });
    for (const move of moves) state = commitMove(state, move.from, move.to, move.promotion || 'q', null).state;
    expect(state.game.fen).toBe(longGame.final_fen);
    // King, bishop and knight against a bare king is NOT a draw by any rule —
    // mate is possible, so the board was right to keep the game going.
    expect(state.status.game_over).toBe(false);
  });

  it('plays all 200 plies through the board state machine in linear time', () => {
    const started = performance.now();
    let state = createChessGameState({ playerColor: 'w' });
    for (const move of moves) state = commitMove(state, move.from, move.to, move.promotion || 'q', null).state;
    expect(state.history).toHaveLength(200);
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it('builds the authority state for 200 plies in linear time', () => {
    const started = performance.now();
    let state = chessRuleModule.createInitialState({ initial_fen: longGame.initial_fen });
    moves.forEach((move, index) => {
      const result = chessRuleModule.handleCommand(state, { type: 'chess.move', ...move }, null, { logicalTime: index, revision: index });
      expect(result.error).toBeUndefined();
      state = result.state;
    });
    expect(state.game.fen).toBe(longGame.final_fen);
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it('projects a 200-ply authority state onto the board without re-playing every prefix', () => {
    let authority = chessRuleModule.createInitialState({ initial_fen: longGame.initial_fen });
    moves.forEach((move, index) => {
      authority = chessRuleModule.handleCommand(authority, { type: 'chess.move', ...move }, null, { logicalTime: index, revision: index }).state;
    });
    // Twice per move in the live board (the commit path and the session
    // effect), so this is the cost of every ply the child plays at this depth.
    const started = performance.now();
    const projected = projectChessAuthorityState(authority, { playerColor: 'w' });
    const elapsed = performance.now() - started;
    expect(projected.history).toHaveLength(200);
    expect(projected.game.fen).toBe(longGame.final_fen);
    expect(projected.history.at(-1)).toMatchObject({ san: 'Ka1', from: 'a2', to: 'a1', color: 'b' });
    expect(elapsed).toBeLessThan(400);
  });
});

/** Plays SAN moves onto a fresh board from `fen`; returns the last commit. */
function playOut(fen, sans, playerColor = 'w') {
  let state = createChessGameState({ fen, playerColor });
  let last = null;
  const engine = new Chess(fen);
  for (const san of sans) {
    const move = engine.move(san);
    last = commitMove(state, move.from, move.to, move.promotion || 'q', null);
    state = last.state;
  }
  return last;
}

describe('every draw rule ends the game', () => {
  it('insufficient material: the last capture leaves king against king and bishop', () => {
    // White Bc5 takes the last black pawn on b6: K+B vs K.
    const last = playOut('8/8/1p6/2B5/8/8/3K4/k7 w - - 0 60', ['Bxb6']);
    expect(last.event.type).toBe('game_over');
    expect(last.state.status).toMatchObject({ game_over: true, outcome: 'insufficient_material', winner: null });
  });

  it('stalemate: no legal move and no check', () => {
    const last = playOut('k7/8/1K6/8/8/8/8/2Q5 w - - 0 70', ['Qc7']);
    expect(last.event.type).toBe('game_over');
    expect(last.state.status.outcome).toBe('stalemate');
  });

  it('fifty-move rule: the hundredth quiet half-move', () => {
    const last = playOut('k7/8/8/8/8/8/1N6/K5B1 w - - 99 120', ['Nd3']);
    expect(last.event.type).toBe('game_over');
    expect(last.state.status.outcome).toBe('fifty_move_rule');
  });

  it('threefold repetition: the same position a third time', () => {
    const last = playOut('k7/8/8/8/8/8/1N6/K5B1 w - - 0 40', ['Nd3', 'Kb8', 'Nb2', 'Ka8', 'Nd3', 'Kb8', 'Nb2', 'Ka8']);
    expect(last.event.type).toBe('game_over');
    expect(last.state.status.outcome).toBe('threefold_repetition');
  });

  it('a drawn board refuses further chords', () => {
    const last = playOut('8/8/1p6/2B5/8/8/3K4/k7 w - - 0 60', ['Bxb6']);
    expect(applySquare(last.state, 'd2').event.reason).toBe('game_over');
  });
});
