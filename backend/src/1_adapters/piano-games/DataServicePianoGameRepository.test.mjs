import test from 'node:test';
import assert from 'node:assert/strict';
import { DataServicePianoGameRepository } from './DataServicePianoGameRepository.mjs';

function fixture() {
  const writes = [];
  const values = new Map();
  const dataService = {
    user: {
      read: (path, user) => values.get(`${user}:${path}`) ?? null,
      write: (path, value, user) => { writes.push({ path, value, user }); values.set(`${user}:${path}`, value); return true; },
    },
    household: { write: () => true },
  };
  const configService = { getHouseholdAppConfig: () => ({ household_flag: true }) };
  return { repository: new DataServicePianoGameRepository({ dataService, configService }), writes };
}

test('hydrates per-game defaults and merges user config patches', async () => {
  const { repository, writes } = fixture();
  const checkers = await repository.readConfig('checkers', 'kid');
  assert.equal(checkers.square_notes.length, 32);
  assert.equal(checkers.household_flag, true);
  await repository.writeConfig('checkers', 'kid', { shuffle_each_game: true });
  await repository.writeConfig('checkers', 'kid', { default_level: 2 });
  assert.deepEqual(writes.at(-1).value, { shuffle_each_game: true, default_level: 2 });
});

test('keeps storage serialization out of the ladder aggregate', async () => {
  const { repository, writes } = fixture();
  await repository.writeProgress('checkers', 'kid', { unlockedThrough: 3, series: ['win'] });
  assert.deepEqual(writes.at(-1).value, { unlocked_through: 3, series: ['win'] });
  assert.deepEqual(await repository.readProgress('checkers', 'kid'), { unlockedThrough: 3, series: ['win'] });
});
