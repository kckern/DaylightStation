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
  // Task 4 redesigned checkers addressing to file+rank (mirroring chess)
  // instead of one unique note per square — see checkersAddress.js on the
  // frontend for why 32 independent notes could never grow a truthful axis
  // rail. The server default has to carry the same shape or a fresh install
  // hands the client a config it cannot address anything with.
  assert.equal(checkers.file_notes.length, 8);
  assert.equal(checkers.rank_notes.length, 8);
  assert.equal(checkers.square_notes, undefined);
  assert.equal(checkers.household_flag, true);
  await repository.writeConfig('checkers', 'kid', { shuffle_each_game: true });
  await repository.writeConfig('checkers', 'kid', { default_level: 2 });
  assert.deepEqual(writes.at(-1).value, { shuffle_each_game: true, default_level: 2 });
});

test('a legacy square_notes config still merges without throwing (frontend normalizes it)', async () => {
  const { repository } = fixture();
  await repository.writeConfig('checkers', 'legacy-kid', {
    square_notes: Array.from({ length: 32 }, (_, index) => 48 + index),
  });
  const checkers = await repository.readConfig('checkers', 'legacy-kid');
  // The repository itself does no validation — it's a plain merge — so the
  // stale key rides along harmlessly. What matters is that the merge still
  // yields valid file_notes/rank_notes from the defaults layer underneath,
  // because nothing in this user's saved config overwrote those keys.
  assert.equal(checkers.file_notes.length, 8);
  assert.equal(checkers.rank_notes.length, 8);
  assert.equal(checkers.square_notes.length, 32);
});

test('keeps storage serialization out of the ladder aggregate', async () => {
  const { repository, writes } = fixture();
  await repository.writeProgress('checkers', 'kid', { unlockedThrough: 3, series: ['win'] });
  assert.deepEqual(writes.at(-1).value, { unlocked_through: 3, series: ['win'] });
  assert.deepEqual(await repository.readProgress('checkers', 'kid'), { unlockedThrough: 3, series: ['win'] });
});
