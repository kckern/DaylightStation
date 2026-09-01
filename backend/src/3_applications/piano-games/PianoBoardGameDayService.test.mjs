import test from 'node:test';
import assert from 'node:assert/strict';
import { PianoBoardGameDayService, emptyBoardGameDay } from './PianoBoardGameDayService.mjs';

function fixture() {
  let day = emptyBoardGameDay('2026-08-28');
  const service = new PianoBoardGameDayService({
    store: { loadDay: () => structuredClone(day), saveDay: (next) => { day = structuredClone(next); } },
    timezone: 'America/Los_Angeles',
    now: () => Date.parse('2026-08-28T20:00:00Z'),
  });
  return service;
}

test('counts every completed eligible board game, regardless of result', () => {
  const service = fixture();
  for (const [gameId, result, gameSessionId] of [
    ['chess', 'win', 'c1'], ['checkers', 'loss', 'd1'], ['connect-four', 'draw', 'f1'],
  ]) service.record({ learnerId: 'user_4', gameId, gameSessionId, completed: true, result });
  assert.equal(service.current('user_4').completedGames, 3);
});

test('is idempotent by learner and game session, and ignores abandoned/ineligible games', () => {
  const service = fixture();
  const record = { learnerId: 'user_3', gameId: 'chess', gameSessionId: 'same', completed: true, result: 'loss' };
  assert.equal(service.record(record).counted, true);
  assert.equal(service.record(record).duplicate, true);
  service.record({ learnerId: 'user_3', gameId: 'checkers', gameSessionId: 'abandoned', completed: false, result: 'loss' });
  service.record({ learnerId: 'user_3', gameId: 'solitaire', gameSessionId: 'other', completed: true, result: 'win' });
  assert.equal(service.current('user_3').completedGames, 1);
});

test('uses the household four-AM study-day boundary', () => {
  let day = emptyBoardGameDay('2026-08-27');
  const service = new PianoBoardGameDayService({
    store: { loadDay: (date) => { assert.equal(date, '2026-08-27'); return day; }, saveDay: (next) => { day = next; } },
    timezone: 'America/Los_Angeles',
    now: () => Date.parse('2026-08-28T10:59:00Z'), // 03:59 local
  });
  assert.equal(service.current('user_2').studyDate, '2026-08-27');
});
