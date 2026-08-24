import { describe, expect, it } from 'vitest';
import { buildGameRecord } from './chessGameRecord.js';
import { countsTowardPromotion, DEFAULT_LADDER_POLICY } from '@shared-gaming/rulesets/chess/ladder.mjs';

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
      result: 'win', moves: 24, rung: 'steady', duration_ms: 60000,
      help: { hints: 3, best_moves: 1, takebacks: 0 },
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

describe('the record the ladder actually reads', () => {
  // Scoped to this describe block, not module level — the file already has a
  // top-level `finished` (a factory function for the suite above) and this is
  // a fixed fixture object, not a factory; same name, different shape, so it
  // stays local to avoid colliding with the existing one.
  const finished = {
    status: { game_over: true, outcome: 'checkmate', winner: 'w' },
    playerColor: 'w',
    history: new Array(30),
  };

  it('carries the fields the promotion gate asks for', () => {
    const record = buildGameRecord({
      game: finished, rungId: 'learner', level: 0,
      hints: 0, bestMoves: 0, takebacks: 0, startedAt: 0, endedAt: 1000,
    });
    expect(record.completed).toBe(true);
    expect(record.level).toBe(0);
    expect(record.help).toEqual({ hints: 0, best_moves: 0, takebacks: 0 });
  });

  it('a clean win counts toward promotion', () => {
    const record = buildGameRecord({
      game: finished, rungId: 'learner', level: 0,
      hints: 0, bestMoves: 0, takebacks: 0, startedAt: 0, endedAt: 1000,
    });
    expect(countsTowardPromotion(record, DEFAULT_LADDER_POLICY, 0)).toBe(true);
  });

  it('reports the level it was played at, so a replay of a beaten opponent is not mistaken for a climb', () => {
    const record = buildGameRecord({
      game: finished, rungId: 'learner', level: 2,
      hints: 0, bestMoves: 0, takebacks: 0, startedAt: 0, endedAt: 1000,
    });
    expect(countsTowardPromotion(record, DEFAULT_LADDER_POLICY, 5)).toBe(false);
  });

  it('records an unresolved level as null, not 0 — Number(null) is 0, a real finite number, so a naive coercion would silently turn "the ladder had not loaded yet" into an indistinguishable, promotable level-0 win', () => {
    const explicitlyNull = buildGameRecord({
      game: finished, rungId: 'learner', level: null,
      hints: 0, bestMoves: 0, takebacks: 0, startedAt: 0, endedAt: 1000,
    });
    expect(explicitlyNull.level).toBeNull();

    const omitted = buildGameRecord({
      game: finished, rungId: 'learner',
      hints: 0, bestMoves: 0, takebacks: 0, startedAt: 0, endedAt: 1000,
    });
    expect(omitted.level).toBeNull();
  });
});
