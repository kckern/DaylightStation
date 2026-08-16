import { describe, expect, it } from 'vitest';
import { INITIAL_FEN } from '../../../../shared/gaming/chess/engine.mjs';
import { toDrills, toPgn } from './ChessGameExport.mjs';

const RECORD = {
  game_id: 'chess-1',
  user_id: 'test-user',
  played_on: '2026-08-15',
  player_color: 'w',
  result: 'loss',
  outcome: 'checkmate',
  initial_fen: INITIAL_FEN,
  opponent: { name: 'Caterpie', level: 0, rung: { elo: null } },
};

const REVIEW = {
  // The position BEFORE each ply — so index 1 is after 1.e4, with Black to move.
  plyFens: [INITIAL_FEN, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'],
  moves: [
    {
      ply: 1, moveNumber: 1, color: 'w', san: 'e4', evalBefore: '+0.20', evalAfter: '+0.20',
      lossCp: 0, verdict: 'ok', bestSan: 'e4', matchedBest: true,
    },
    {
      ply: 2, moveNumber: 1, color: 'b', san: 'e5', evalBefore: '+0.20', evalAfter: '+0.30',
      lossCp: 10, verdict: 'ok', bestSan: 'c5', matchedBest: false,
    },
  ],
};

describe('toPgn', () => {
  it('writes headers a board GUI can read, with the player on the right side', () => {
    const pgn = toPgn(RECORD, REVIEW);
    expect(pgn).toContain('[White "test-user"]');
    expect(pgn).toContain('[Black "Caterpie"]');
    // Player is White and lost, so Black won.
    expect(pgn).toContain('[Result "0-1"]');
  });

  it('flips the result when the player had Black', () => {
    const pgn = toPgn({ ...RECORD, player_color: 'b' }, REVIEW);
    expect(pgn).toContain('[White "Caterpie"]');
    expect(pgn).toContain('[Result "1-0"]');
  });

  it('marks errors with standard NAGs so any viewer shows the same symbols', () => {
    const review = {
      ...REVIEW,
      moves: [{ ...REVIEW.moves[0], verdict: 'blunder', lossCp: 400, bestSan: 'd4', matchedBest: false }],
    };
    const pgn = toPgn(RECORD, review);
    expect(pgn).toContain('$4');
    expect(pgn).toContain('better: d4');
  });

  it('does not suggest an alternative when the player found the engine move', () => {
    expect(toPgn(RECORD, REVIEW)).not.toContain('better: e4');
  });

  it('declares a non-standard starting position', () => {
    const odds = { ...RECORD, initial_fen: 'rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' };
    const pgn = toPgn(odds, REVIEW);
    expect(pgn).toContain('[SetUp "1"]');
    expect(pgn).toContain('[FEN "rnb1kbnr');
  });

  it('wraps the movetext instead of emitting one enormous line', () => {
    const pgn = toPgn(RECORD, REVIEW);
    for (const line of pgn.split('\n')) expect(line.length).toBeLessThanOrEqual(88);
  });
});

describe('toDrills', () => {
  const blunder = {
    ply: 1, moveNumber: 1, color: 'w', san: 'Qd1', evalBefore: '+2.46', evalAfter: '-3.64',
    lossCp: 610, verdict: 'blunder', bestSan: 'd4', matchedBest: false,
  };

  it('turns the player\'s own mistakes into solvable positions', () => {
    const drills = toDrills(RECORD, { ...REVIEW, moves: [blunder] });
    expect(drills).toHaveLength(1);
    expect(drills[0]).toMatchObject({ solution: 'd4', played: 'Qd1', lost_cp: 610, to_move: 'w' });
    expect(drills[0].fen).toBe(INITIAL_FEN);
  });

  it('ignores the opponent\'s mistakes', () => {
    const drills = toDrills(RECORD, { ...REVIEW, moves: [{ ...blunder, color: 'b', ply: 2 }] });
    expect(drills).toHaveLength(0);
  });

  it('ignores moves that were nearly as good — a drill needs a real answer', () => {
    const drills = toDrills(RECORD, { ...REVIEW, moves: [{ ...blunder, lossCp: 40 }] });
    expect(drills).toHaveLength(0);
  });

  it('ignores moves where the player already played the best move', () => {
    const drills = toDrills(RECORD, { ...REVIEW, moves: [{ ...blunder, matchedBest: true }] });
    expect(drills).toHaveLength(0);
  });

  it('follows the player to the black side', () => {
    const drills = toDrills(
      { ...RECORD, player_color: 'b' },
      { ...REVIEW, moves: [{ ...blunder, color: 'b', ply: 2 }] },
    );
    expect(drills).toHaveLength(1);
    expect(drills[0].to_move).toBe('b');
  });
});
