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
  assert.equal(checkers.household_flag, true);
  await repository.writeConfig('checkers', 'kid', { addressing: { shuffle: 'each_game' } });
  await repository.writeConfig('checkers', 'kid', { default_level: 2 });
  assert.deepEqual(writes.at(-1).value, { addressing: { shuffle: 'each_game' }, default_level: 2 });
});

test('keeps storage serialization out of the ladder aggregate', async () => {
  const { repository, writes } = fixture();
  await repository.writeProgress('checkers', 'kid', { unlockedThrough: 3, series: ['win'] });
  assert.deepEqual(writes.at(-1).value, { unlocked_through: 3, series: ['win'] });
  assert.deepEqual(await repository.readProgress('checkers', 'kid'), { unlockedThrough: 3, series: ['win'] });
});

/**
 * Every dimension of a nested block has to be independently overridable at every
 * layer, or the layering is decorative. A spread merge replaces the block
 * wholesale: a player who set one addressing dimension silently discarded the
 * household's vocabulary, clefs, shuffle and other axis, and got defaults for
 * all of them. See docs/reference/piano/grid-addressing.md.
 */
test('deep-merges nested config so one overridden dimension keeps its siblings', async () => {
  const writes = [];
  const values = new Map();
  const dataService = {
    user: {
      read: (path, user) => values.get(`${user}:${path}`) ?? null,
      write: (path, value, user) => { writes.push({ path, value, user }); values.set(`${user}:${path}`, value); return true; },
    },
    household: { write: () => true },
  };
  const configService = {
    getHouseholdAppConfig: () => ({
      addressing: {
        vocabulary: 'chords', clefs: 'grand', shuffle: 'each_game',
        x: { tier: 2, order: 'sequential' }, y: { tier: 2, order: 'sequential' },
      },
    }),
  };
  const repository = new DataServicePianoGameRepository({ dataService, configService });

  await repository.writeConfig('checkers', 'kid', { addressing: { x: { tier: 4 } } });
  const config = await repository.readConfig('checkers', 'kid');

  assert.equal(config.addressing.x.tier, 4, 'the overridden dimension wins');
  assert.equal(config.addressing.x.order, 'sequential', 'its sibling on the same axis survives');
  assert.equal(config.addressing.y.tier, 2, 'the other axis survives');
  assert.equal(config.addressing.vocabulary, 'chords', 'the household vocabulary survives');
  assert.equal(config.addressing.shuffle, 'each_game', 'the household cadence survives');
});

test('a second config patch does not erase the first', async () => {
  const { repository } = fixture();
  await repository.writeConfig('checkers', 'kid', { addressing: { vocabulary: 'chords' } });
  await repository.writeConfig('checkers', 'kid', { addressing: { shuffle: 'each_turn' } });
  const config = await repository.readConfig('checkers', 'kid');
  assert.equal(config.addressing.vocabulary, 'chords');
  assert.equal(config.addressing.shuffle, 'each_turn');
});
