import { describe, expect, it, vi } from 'vitest';
import { createPianoAchievementProvider } from './PianoAchievementProvider.mjs';

const HOUR = 3_600_000;
// UTC household with the 4am boundary, so fixtures read plainly.
const studyDay = (ms) => new Date(ms - 4 * HOUR).toISOString().slice(0, 10);
const at = (iso) => Date.parse(iso);
const week = { from: '2026-11-02', to: '2026-11-08' };
const schoolMs = { fromMs: at('2026-11-02T04:00:00Z'), toMs: at('2026-11-09T04:00:00Z') };
const args = { learnerIds: ['kidB', 'kidC'], week, schoolMs, studyDay };

function provider({ games = {}, attempts = {}, rungs = {}, logger } = {}) {
  return createPianoAchievementProvider({
    gameHistory: { listGameSummaries: (game) => games[game] ?? [] },
    attemptStore: { listCreatedBetween: (id) => attempts[id] ?? [] },
    rungLog: { list: (id) => rungs[id] ?? [] },
    logger,
  });
}

const win = (userId, level, iso, extra = {}) => ({
  userId, level, result: 'win', completed: true, endedBy: 'game_over', atMs: at(iso), playedOn: iso.slice(0, 10), ...extra,
});

describe('piano achievement provider', () => {
  it('names itself and its three activities', () => {
    const p = provider();
    expect(p.name).toBe('piano');
    expect(p.activities).toEqual(['board-game-level', 'piano-practice', 'piano-rung']);
  });

  it('reports a first-ever win per level only when that first win is in the week', async () => {
    const out = await provider({ games: {
      checkers: [
        win('kidB', 3, '2026-10-20T18:00:00Z'), // first win at 3 was weeks ago
        win('kidB', 3, '2026-11-03T18:00:00Z'),
        win('kidB', 4, '2026-11-04T18:00:00Z'),
        win('kidB', 4, '2026-11-03T18:00:00Z'), // earlier, listed later
        win('kidB', 5, '2026-11-05T18:00:00Z', { endedBy: 'left' }),
        win('kidB', 6, '2026-11-05T18:00:00Z', { completed: false }),
        { ...win('kidB', 7, '2026-11-05T18:00:00Z'), result: 'loss' },
        win('guest', 2, '2026-11-05T18:00:00Z'),
      ],
      chess: [win('kidC', 0, '2026-11-06T02:00:00Z')], // 2am counts for the day before
    } }).week(args);
    expect(out.learners.kidB.milestones['board-game-level']).toEqual([
      { key: 'checkers:4', day: '2026-11-03', label: 'Checkers level 4' },
    ]);
    expect(out.learners.kidC.milestones['board-game-level']).toEqual([
      { key: 'chess:0', day: '2026-11-05', label: 'Chess level 0' },
    ]);
    expect(out.unavailable).toEqual([]);
    expect(out.contests).toEqual({});
  });

  it('falls back to played_on when a record has no timestamp', async () => {
    const out = await provider({ games: {
      'connect-four': [{ ...win('kidB', 2, '2026-11-07T12:00:00Z'), atMs: null }],
    } }).week(args);
    expect(out.learners.kidB.milestones['board-game-level']).toEqual([
      { key: 'connect-four:2', day: '2026-11-07', label: 'Connect Four level 2' },
    ]);
  });

  it('counts distinct study days with a passed challenge attempt', async () => {
    const attempt = (iso, extra = {}) => ({ created_at: iso, purpose: 'challenge', verdict: { passed: true }, ...extra });
    const out = await provider({ attempts: { kidB: [
      attempt('2026-11-02T15:00:00Z'),
      attempt('2026-11-02T20:00:00Z'),
      attempt('2026-11-04T01:00:00Z'), // before 4am: still Nov 3
      attempt('2026-11-05T15:00:00Z', { verdict: { passed: false } }),
      attempt('2026-11-06T15:00:00Z', { purpose: 'practice' }),
      { created_at: '2026-11-07T15:00:00Z', challenge_id: 'c1', verdict: { passed: true } }, // legacy, no purpose
    ] } }).week(args);
    expect(out.learners.kidB.days['piano-practice']).toEqual(['2026-11-02', '2026-11-03', '2026-11-07']);
    expect(out.learners.kidC.days['piano-practice']).toEqual([]);
  });

  it('dates each rung by its first reach, including rungs a jump skipped', async () => {
    const out = await provider({ rungs: { kidB: [
      { at: '2026-10-28T18:00:00Z', game: 'checkers', ladder: 'match', from: 2, to: 3 },
      { at: '2026-11-03T18:00:00Z', game: 'checkers', ladder: 'match', from: 3, to: 4 },
      { at: '2026-11-04T18:00:00Z', game: 'checkers', ladder: 'match', from: 2, to: 3 }, // re-reach after a reset
      { at: '2026-11-05T18:00:00Z', game: 'chess', ladder: 'addressing', from: 1, to: 3 },
      { at: 'garbage', game: 'chess', ladder: 'match', from: 0, to: 1 },
    ] } }).week(args);
    expect(out.learners.kidB.milestones['piano-rung']).toEqual([
      { key: 'match:checkers:4', day: '2026-11-03', label: 'Checkers rung 4' },
      { key: 'addressing:chess:2', day: '2026-11-05', label: 'Chess reading rung 2' },
      { key: 'addressing:chess:3', day: '2026-11-05', label: 'Chess reading rung 3' },
    ]);
  });

  it('a failing sub-source makes only its own activity unavailable', async () => {
    const logger = { warn: vi.fn(), debug: vi.fn() };
    const p = createPianoAchievementProvider({
      gameHistory: { listGameSummaries: () => { throw new Error('EACCES'); } },
      attemptStore: { listCreatedBetween: () => [{ created_at: '2026-11-02T15:00:00Z', purpose: 'challenge', verdict: { passed: true } }] },
      rungLog: { list: () => [] },
      logger,
    });
    const out = await p.week(args);
    expect(out.unavailable).toEqual(['board-game-level']);
    expect(out.learners.kidB.milestones['board-game-level']).toBeUndefined();
    expect(out.learners.kidB.days['piano-practice']).toEqual(['2026-11-02']);
    expect(out.learners.kidB.milestones['piano-rung']).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('piano.achievements.source-unavailable', expect.objectContaining({ activity: 'board-game-level', error: 'EACCES' }));
  });
});
