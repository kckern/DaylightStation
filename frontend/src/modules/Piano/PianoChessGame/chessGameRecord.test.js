import { describe, expect, it } from 'vitest';
import { buildGameRecord } from './chessGameRecord.js';

const finished = (outcome, winner, plies) => ({
  status: { game_over: true, outcome, winner },
  playerColor: 'w',
  history: Array.from({ length: plies }, (_, i) => ({ san: `m${i}` })),
});

describe('buildGameRecord', () => {
  it('records a win with its move count and help taken', () => {
    const rec = buildGameRecord({
      game: finished('checkmate', 'w', 48), rungId: 'steady',
      opponent: { source: 'ladder', level: 8, name: 'Cubone', rung: { id: 'level-8', skill: 8 } },
      hints: 3, bestMoves: 1, startedAt: 1000, endedAt: 61000,
    });
    expect(rec).toMatchObject({
      result: 'win', moves: 24, hints: 3, best_moves: 1, rung: 'steady', duration_ms: 60000,
      opponent: { source: 'ladder', level: 8, name: 'Cubone', rung: { id: 'level-8', skill: 8 } },
    });
  });

  it('counts moves as full moves, not plies', () => {
    expect(buildGameRecord({ game: finished('checkmate', 'w', 7), rungId: 'learner', hints: 0, bestMoves: 0, startedAt: 0, endedAt: 0 }).moves).toBe(4);
  });

  it('records a loss when the opponent mates', () => {
    expect(buildGameRecord({ game: finished('checkmate', 'b', 30), rungId: 'learner', hints: 0, bestMoves: 0, startedAt: 0, endedAt: 0 }).result).toBe('loss');
  });

  it('records a draw by its outcome name', () => {
    expect(buildGameRecord({ game: finished('stalemate', null, 60), rungId: 'learner', hints: 0, bestMoves: 0, startedAt: 0, endedAt: 0 }).result).toBe('draw');
  });

  it('returns null for a game that is not over, so nothing half-played is filed', () => {
    expect(buildGameRecord({ game: { status: { game_over: false }, history: [] }, rungId: 'learner', hints: 0, bestMoves: 0, startedAt: 0, endedAt: 0 })).toBeNull();
  });
});
