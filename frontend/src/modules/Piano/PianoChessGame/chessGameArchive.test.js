import { describe, expect, it } from 'vitest';
import { INITIAL_FEN, createGame, playMove } from '@shared-gaming/rulesets/chess/engine.mjs';
import { buildGameArchive, localDateStamp } from './chessGameArchive.js';
import { createChessGameState, commitMove, takeMoveBack } from './chessGameState.js';
import { DEFAULT_STAFF_SCHEME } from './staffAddress.js';

/** A real game state carried forward by real moves — never a hand-built fake. */
function played(moves, options = {}) {
  let state = createChessGameState({ seed: 1, shuffleEachTurn: false, ...options });
  for (const [from, to] of moves) state = commitMove(state, from, to).state;
  return state;
}

const inputs = (game, extra = {}) => ({
  game,
  gameId: 'g-1',
  userId: 'learner3',
  rungId: 'learner',
  hints: 1,
  bestMoves: 0,
  startedAt: Date.UTC(2026, 7, 12, 17, 0, 0),
  endedAt: Date.UTC(2026, 7, 12, 17, 9, 30),
  ...extra,
});

describe('the household game archive', () => {
  it('records an unfinished game, which is the case it exists for', () => {
    const game = played([['e2', 'e4'], ['e7', 'e5']]);
    const archive = buildGameArchive(inputs(game, { endedBy: 'left' }));
    expect(archive.completed).toBe(false);
    expect(archive.ended_by).toBe('left');
    expect(archive.result).toBe(null);
    expect(archive.move_count).toBe(2);
  });

  it('keeps only the final player-visible dialogue line for rivalry memory', () => {
    const game = played([['e2', 'e4']]);
    const archive = buildGameArchive(inputs(game, {
      commentary: { quip: 'A small step with plans.', source: 'fallback' },
    }));
    expect(archive.commentary).toEqual({ final_line: 'A small step with plans.', source: 'fallback' });
  });

  it('is replayable: the start position plus every move in both notations', () => {
    const game = played([['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3']]);
    const archive = buildGameArchive(inputs(game));
    expect(archive.initial_fen).toBe(INITIAL_FEN);
    expect(archive.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3']);
    expect(archive.moves.map((m) => [m.from, m.to])).toEqual([['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3']]);
    // Actually replay it, the way the engine will: start from the recorded
    // position, play the recorded moves, and land on the recorded end position.
    // This is the whole promise of the archive, so it is asserted by doing it.
    let replay = createGame({ fen: archive.initial_fen });
    for (const move of archive.moves) {
      const step = playMove(replay, { from: move.from, to: move.to });
      expect(step.error, `move ${move.ply} ${move.san} did not replay`).toBeFalsy();
      expect(step.move.san).toBe(move.san);
      replay = step.game;
    }
    expect(replay.fen).toBe(archive.final_fen);
    expect(archive.final_fen).not.toBe(archive.initial_fen);
  });

  it('keeps the music, which no PGN can hold', () => {
    const game = played([['e2', 'e4']]);
    const archive = buildGameArchive(inputs(game));
    // The two addresses that performed the move, origin then destination.
    expect(archive.moves[0].played).toEqual(['Em', 'Eadd9']);
    expect(archive.addressing).toBe('chords');
  });

  it('says which vocabulary the addresses are in, or they cannot be read back', () => {
    const game = played([['e2', 'e4']], { scheme: DEFAULT_STAFF_SCHEME });
    const archive = buildGameArchive(inputs(game, { addressing: 'staff' }));
    expect(archive.addressing).toBe('staff');
    // Two staff notes, not a chord — 'G/E' means something entirely different
    // from 'Em', and only the vocabulary field tells them apart.
    expect(archive.moves[0].played[0]).toMatch(/\//);
  });

  it('records a finished game as won, lost or drawn', () => {
    // Fool's mate: Black delivers it, so a White player has lost.
    const game = played([['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]);
    expect(game.status.game_over).toBe(true);
    const archive = buildGameArchive(inputs(game, { endedBy: 'game_over' }));
    expect(archive.completed).toBe(true);
    expect(archive.outcome).toBe('checkmate');
    expect(archive.result).toBe('loss');
  });

  it('files the game under the day it was played, in local time', () => {
    const game = played([['e2', 'e4']]);
    const startedAt = new Date(2026, 7, 12, 22, 30).getTime();
    expect(buildGameArchive(inputs(game, { startedAt })).played_on).toBe('2026-08-12');
    expect(localDateStamp(new Date(2026, 0, 3, 9, 0).getTime())).toBe('2026-01-03');
  });

  it('is not written for a game nobody played', () => {
    expect(buildGameArchive(inputs(played([])))).toBe(null);
  });

  it('carries the help tally, so a game won on hints is not read as one that was not', () => {
    const game = played([['e2', 'e4']]);
    const archive = buildGameArchive(inputs(game, { hints: 3, bestMoves: 2 }));
    expect(archive.help).toEqual({ hints: 3, best_moves: 2, takebacks: 0 });
  });

  it('states the effective opponent, not merely the UI rung', () => {
    const game = played([['e2', 'e4']]);
    const archive = buildGameArchive(inputs(game, {
      opponent: { source: 'ladder', level: 0, name: 'Caterpie', rung: { id: 'level-0', skill: 0 } },
    }));
    expect(archive.opponent).toEqual({ source: 'ladder', level: 0, name: 'Caterpie', rung: { id: 'level-0', skill: 0 } });
  });

  it('keeps a guest game, with a null player rather than no record', () => {
    const game = played([['e2', 'e4']]);
    expect(buildGameArchive(inputs(game, { userId: null })).user_id).toBe(null);
  });
});

describe('rewound moves in the archive', () => {
  const game = {
    playerColor: 'w',
    initialFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    game: { fen: 'after', moves: ['Nf3'] },
    status: { game_over: false },
    scheme: { id: 'chords-default' },
    history: [{ san: 'Nf3', from: 'g1', to: 'f3', color: 'w', captured: null, chords: ['G', 'F'] }],
    undoneHistory: [
      { san: 'Qh5', from: 'd1', to: 'h5', color: 'w', captured: null, chords: ['D', 'H'], ply: 1, undone_at_ply: 1, undone_seq: 1 },
    ],
  };

  it('keeps the taken-back move, marked, in the order it was played', () => {
    const archive = buildGameArchive({
      game, gameId: 'g1', userId: 'kid', rungId: 'learner',
      hints: 0, bestMoves: 0, takebacks: 1, startedAt: 0, endedAt: 1000,
    });
    expect(archive.moves).toHaveLength(2);
    expect(archive.moves[0]).toMatchObject({ san: 'Qh5', undone: true, undone_at_ply: 1, undone_seq: 1, ply: 1 });
    expect(archive.moves[1]).toMatchObject({ san: 'Nf3', undone: false, ply: 1 });
  });

  it('counts only the line that was actually played', () => {
    const archive = buildGameArchive({
      game, gameId: 'g1', userId: 'kid', rungId: 'learner',
      hints: 0, bestMoves: 0, takebacks: 1, startedAt: 0, endedAt: 1000,
    });
    expect(archive.move_count).toBe(1);
    expect(archive.help).toEqual({ hints: 0, best_moves: 0, takebacks: 1 });
  });

  it('replays cleanly once the undone moves are filtered out', () => {
    const archive = buildGameArchive({
      game, gameId: 'g1', userId: 'kid', rungId: 'learner',
      hints: 0, bestMoves: 0, takebacks: 1, startedAt: 0, endedAt: 1000,
    });
    const played = archive.moves.filter((move) => !move.undone).map((move) => move.san);
    expect(played).toEqual(['Nf3']);
  });

  it('is still a game when every move was taken back', () => {
    const allRewound = { ...game, history: [], undoneHistory: game.undoneHistory };
    const archive = buildGameArchive({
      game: allRewound, gameId: 'g1', userId: 'kid', rungId: 'learner',
      hints: 0, bestMoves: 0, takebacks: 1, startedAt: 0, endedAt: 1000,
    });
    expect(archive).not.toBe(null);
    expect(archive.move_count).toBe(0);
    expect(archive.moves).toHaveLength(1);
  });

  it('is still not a game when nothing was played at all', () => {
    const untouched = { ...game, history: [], undoneHistory: [] };
    expect(buildGameArchive({
      game: untouched, gameId: 'g1', userId: 'kid', rungId: 'learner',
      hints: 0, bestMoves: 0, takebacks: 0, startedAt: 0, endedAt: 1000,
    })).toBe(null);
  });
});

describe('timing in the archive', () => {
  const START = Date.UTC(2026, 7, 12, 17, 0, 0);

  /** A game whose moves landed at known instants. */
  function timed(moves) {
    let state = createChessGameState({ seed: 1, shuffleEachTurn: false });
    for (const [from, to, at] of moves) state = commitMove(state, from, to, undefined, at).state;
    return state;
  }

  it('records what each move cost in thinking time', () => {
    const game = timed([
      ['e2', 'e4', START + 4000],
      ['e7', 'e5', START + 5000],
      ['g1', 'f3', START + 25000],
    ]);
    const archive = buildGameArchive(inputs(game, {
      startedAt: START, timing: { mode: 'up', initial_ms: null, increment_ms: null },
    }));
    expect(archive.moves.map((move) => move.think_ms)).toEqual([4000, 1000, 20000]);
  });

  it('sums each side\'s time from the moves, so the archive agrees with itself', () => {
    const game = timed([
      ['e2', 'e4', START + 4000],
      ['e7', 'e5', START + 5000],
      ['g1', 'f3', START + 25000],
    ]);
    const archive = buildGameArchive(inputs(game, { startedAt: START, timing: { mode: 'up' } }));
    expect(archive.timing.spent_ms).toEqual({ w: 24000, b: 1000 });
    expect(archive.timing.timed_moves).toBe(3);
  });

  it('omits think_ms entirely for an untimed game rather than writing zeroes', () => {
    // A zero would read as "played instantly", which is a different claim from
    // "we were not recording".
    const game = played([['e2', 'e4'], ['e7', 'e5']]);
    const archive = buildGameArchive(inputs(game, { startedAt: START }));
    expect(archive.moves.every((move) => !('think_ms' in move))).toBe(true);
    expect(archive.timing.timed_moves).toBe(0);
  });

  it('records that the clock was off, rather than leaving it unsaid', () => {
    const game = played([['e2', 'e4']]);
    expect(buildGameArchive(inputs(game)).timing.mode).toBe('off');
  });

  it('carries the time control when one was set', () => {
    const game = played([['e2', 'e4']]);
    const archive = buildGameArchive(inputs(game, {
      timing: { mode: 'down', initial_ms: 300000, increment_ms: 3000 },
    }));
    expect(archive.timing).toMatchObject({ mode: 'down', initial_ms: 300000, increment_ms: 3000 });
  });

  it('leaves a taken-back move untimed, having no line to measure it against', () => {
    let state = createChessGameState({ seed: 1, shuffleEachTurn: false, playerColor: 'w' });
    state = commitMove(state, 'e2', 'e4', undefined, START + 1000).state;
    state = commitMove(state, 'e7', 'e5', undefined, START + 2000).state;
    state = takeMoveBack(state).state;
    const archive = buildGameArchive(inputs(state, { startedAt: START, timing: { mode: 'up' } }));
    const rewound = archive.moves.filter((move) => move.undone);
    expect(rewound.length).toBeGreaterThan(0);
    expect(rewound.every((move) => !('think_ms' in move))).toBe(true);
  });
});
