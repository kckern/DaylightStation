import { describe, expect, it } from 'vitest';
import { DEFAULT_LADDER_POLICY } from '#shared/gaming/rulesets/chess/ladder.mjs';
import {
  chronological, isFinishedGame, matchScorecards, planUserBackfill, rebuildRivalries, recordLevel, replayLadder,
  summarizeLadder, summarizeRivalries, withOpponentIds, withScorecardLevels,
} from './ChessRecordBackfill.mjs';

const POLICY = DEFAULT_LADDER_POLICY;
let clock = 0;
/** An archived game played to checkmate, one hour after the previous one. */
function finished(over = {}) {
  clock += 1;
  return {
    game_id: `chess-${clock}`, user_id: 'kid', completed: true, ended_by: 'game_over',
    result: 'win', outcome: 'checkmate', duration_ms: 60_000 + clock,
    ended_at: new Date(Date.UTC(2026, 7, 13) + clock * 3_600_000).toISOString(),
    help: { hints: 0, best_moves: 0, takebacks: 0 },
    opponent: { level: 0, name: 'Caterpie', id: 'pokemon:level-1' },
    moves: [{ san: 'e4' }, { san: 'Qxf7#' }], move_count: 2,
    ...over,
  };
}

describe('isFinishedGame and recordLevel', () => {
  it('accepts only a named player\'s game played to the end', () => {
    expect(isFinishedGame(finished())).toBe(true);
    expect(isFinishedGame(finished({ completed: false, ended_by: 'left' }))).toBe(false);
    expect(isFinishedGame(finished({ user_id: null }))).toBe(false);
  });

  it('reads the level from the record, then from its opponent, else unknown', () => {
    expect(recordLevel(finished({ level: 3 }))).toBe(3);
    expect(recordLevel(finished())).toBe(0);
    expect(recordLevel(finished({ opponent: null }))).toBe(null);
  });
});

describe('withOpponentIds', () => {
  it('gives an old record the id a later record used for the same opponent', () => {
    const [legacy] = withOpponentIds([
      finished({ opponent: { level: 0, name: 'Caterpie' } }),
      finished(),
    ], () => 'generic');
    expect(legacy.opponent.id).toBe('pokemon:level-1');
  });

  it('falls back to the player\'s roster pack and a one-based position', () => {
    const [record] = withOpponentIds([finished({ opponent: { level: 3, name: 'Beedrill' } })], (userId) => `${userId}-pack`);
    expect(record.opponent.id).toBe('kid-pack:level-4');
  });

  it('leaves a record with no opponent alone, since nobody can say who it was', () => {
    const record = finished({ opponent: null });
    expect(withOpponentIds([record], () => 'generic')[0]).toBe(record);
  });

  it('assigns a roster id to an opponent with a known level but no name', () => {
    const [record] = withOpponentIds([finished({ opponent: { level: 2 } })], (userId) => `${userId}-pack`);
    expect(record.opponent.id).toBe('kid-pack:level-3');
  });

  it('keeps id-borrowing per player, so two players never share a rival id', () => {
    const [sibling, kid] = withOpponentIds([
      finished({ user_id: 'sibling', opponent: { level: 0, name: 'Caterpie', id: 'other-pack:level-1' } }),
      finished({ user_id: 'kid', opponent: { level: 0, name: 'Caterpie' } }),
    ], (userId) => `${userId}-pack`);
    expect(sibling.opponent.id).toBe('other-pack:level-1');
    expect(kid.opponent.id).toBe('kid-pack:level-1');
  });
});

describe('replayLadder', () => {
  it('promotes on five clean wins and keeps real times', () => {
    const games = Array.from({ length: 5 }, () => finished());
    const ladder = replayLadder(games, POLICY, null);
    expect(ladder.unlocked_through).toBe(1);
    expect(ladder.results.map((entry) => entry.at)).toEqual(games.map((game) => game.ended_at));
  });

  it('records help-heavy wins without counting them', () => {
    const ladder = replayLadder([finished({ help: { hints: 11, best_moves: 14, takebacks: 1 } })], POLICY, null);
    expect(ladder.results).toEqual([expect.objectContaining({ level: 0, result: 'win', counted: false })]);
  });

  it('treats a game played at a level as proof that level was unlocked', () => {
    const strict = { ...POLICY, max_hints: 0 };
    const early = Array.from({ length: 5 }, () => finished({ help: { hints: 1, best_moves: 0, takebacks: 0 } }));
    const later = [finished({ opponent: { level: 1, name: 'Weedle', id: 'pokemon:level-2' } }), finished({ opponent: { level: 1, name: 'Weedle', id: 'pokemon:level-2' } })];
    const ladder = replayLadder([...early, ...later], strict, null);
    expect(ladder.unlocked_through).toBe(1);
    expect(ladder.results.filter((entry) => entry.level === 1 && entry.counted)).toHaveLength(2);
  });

  it('never lowers the stored level', () => {
    expect(replayLadder([finished()], POLICY, { unlocked_through: 3, results: [] }).unlocked_through).toBe(3);
  });

  it('files a game of unknown level at the current level and does not count it', () => {
    const ladder = replayLadder([finished({ opponent: null, result: 'loss' })], POLICY, null);
    expect(ladder.results).toEqual([expect.objectContaining({ level: 0, result: 'loss', counted: false })]);
  });

  it('replays in the order games ended, not the order given', () => {
    const first = finished({ result: 'loss' });
    const second = finished();
    expect(replayLadder([second, first], POLICY, null).results.map((entry) => entry.result)).toEqual(['loss', 'win']);
    expect(chronological([second, first])[0]).toBe(first);
  });
});

describe('planUserBackfill', () => {
  it('rebuilds rivalry totals per opponent from this player\'s finished games only', async () => {
    const records = withOpponentIds([
      finished({ opponent: { level: 0, name: 'Caterpie' } }),
      finished(),
      finished({ result: 'loss', opponent: { level: 1, name: 'Weedle', id: 'pokemon:level-2' } }),
      finished({ completed: false, ended_by: 'left', result: null }),
      finished({ user_id: 'sibling' }),
    ], () => 'generic');
    const plan = await planUserBackfill({ userId: 'kid', records, policy: POLICY, storedLadder: null });
    expect(summarizeRivalries(plan.rivalries)).toEqual({
      'Caterpie (pokemon:level-1)': '2-0-0',
      'Weedle (pokemon:level-2)': '0-1-0',
    });
    expect(plan.ladder.results).toHaveLength(3);
  });

  it('counts an opponent-less game with a recovered level toward the ladder, but builds no rival for it', async () => {
    const records = [finished({ opponent: null, level: 2 })];
    const plan = await planUserBackfill({
      userId: 'kid', records, policy: POLICY, storedLadder: null,
    });
    expect(plan.ladder.results).toEqual([expect.objectContaining({ level: 2, result: 'win', counted: true })]);
    expect(plan.rivalries.rivals).toEqual({});
  });
});

describe('rebuildRivalries', () => {
  it('never contributes a rival for a game with no opponent block, even with a recovered level', async () => {
    const memory = await rebuildRivalries([finished({ opponent: null, level: 2 })]);
    expect(memory.rivals).toEqual({});
  });

  it('still contributes a rival for a game that carries an opponent block, as before', async () => {
    const memory = await rebuildRivalries([finished()]);
    expect(Object.keys(memory.rivals)).toEqual(['pokemon:level-1']);
  });
});

describe('matchScorecards', () => {
  it('matches by game id, else by result and duration within 50ms', () => {
    const archive = [finished({ game_id: 'a', duration_ms: 3_499_621, result: 'loss' }), finished({ game_id: 'b' })];
    const cards = [
      { file: 'one.yml', record: { user_id: 'kid', result: 'loss', duration_ms: 3_499_617 } },
      { file: 'two.yml', record: { user_id: 'kid', game_id: 'b', result: 'win' } },
      { file: 'three.yml', record: { user_id: 'kid', game_id: 'zzz', result: 'win', duration_ms: 1 } },
    ];
    const { matched, unmatched } = matchScorecards(cards, archive);
    expect(matched.map((card) => card.file)).toEqual(['one.yml', 'two.yml']);
    expect(unmatched.map((card) => card.file)).toEqual(['three.yml']);
  });

  it('never falls back to duration for a card whose game id the archive does not have', () => {
    const archive = [finished({ game_id: 'a', duration_ms: 3_499_621, result: 'loss' })];
    const cards = [{ file: 'four.yml', record: { user_id: 'kid', game_id: 'zzz', result: 'loss', duration_ms: 3_499_621 } }];
    const { matched, unmatched } = matchScorecards(cards, archive);
    expect(matched).toEqual([]);
    expect(unmatched.map((card) => card.file)).toEqual(['four.yml']);
  });

  it('lets each archived game satisfy at most one id-less duration-fallback card', () => {
    const archive = [finished({ game_id: 'a', duration_ms: 100_000, result: 'win' })];
    const cards = [
      { file: 'five.yml', record: { user_id: 'kid', result: 'win', duration_ms: 100_010 } },
      { file: 'six.yml', record: { user_id: 'kid', result: 'win', duration_ms: 100_020 } },
    ];
    const { matched, unmatched } = matchScorecards(cards, archive);
    expect(matched.map((card) => card.file)).toEqual(['five.yml']);
    expect(unmatched.map((card) => card.file)).toEqual(['six.yml']);
  });

  it('attaches the archive record it matched to each matched card', () => {
    const archive = [finished({ game_id: 'a' })];
    const cards = [{ file: 'one.yml', record: { user_id: 'kid', game_id: 'a', result: 'win' } }];
    const { matched } = matchScorecards(cards, archive);
    expect(matched[0].archived).toBe(archive[0]);
  });
});

describe('withScorecardLevels', () => {
  it('fills in a level for an archive record that has none, from its matching scorecard', () => {
    const record = finished({ opponent: null, game_id: 'no-level' });
    const cards = [{ file: 'c.yml', record: { user_id: 'kid', game_id: 'no-level', level: 2 } }];
    const [result] = withScorecardLevels([record], cards);
    expect(recordLevel(result)).toBe(2);
    expect(recordLevel(record)).toBe(null);
  });

  it('leaves a record alone when no scorecard matches it', () => {
    const record = finished({ opponent: null, game_id: 'no-level' });
    expect(withScorecardLevels([record], [])[0]).toBe(record);
  });

  it('leaves a record alone when its matching scorecard also has no level', () => {
    const record = finished({ opponent: null, game_id: 'no-level' });
    const cards = [{ file: 'c.yml', record: { user_id: 'kid', game_id: 'no-level' } }];
    expect(withScorecardLevels([record], cards)[0]).toBe(record);
  });

  it('never overwrites a level the archive record already has', () => {
    const record = finished({ level: 3, game_id: 'has-level' });
    const cards = [{ file: 'c.yml', record: { user_id: 'kid', game_id: 'has-level', level: 5 } }];
    expect(withScorecardLevels([record], cards)[0]).toBe(record);
  });
});

describe('summarizeLadder', () => {
  it('reports level, counted wins and history length, or null for no file', () => {
    expect(summarizeLadder(null, POLICY)).toBe(null);
    const ladder = replayLadder([finished(), finished({ help: { hints: 5, best_moves: 0, takebacks: 0 } })], POLICY, null);
    expect(summarizeLadder(ladder, POLICY)).toEqual({ unlocked_through: 0, wins: 1, needed: 5, results: 2 });
  });
});
