import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YamlDoNowDatastore } from './YamlDoNowDatastore.mjs';

function makeStore(householdId = null) {
  const calls = [];
  const configService = {
    getHouseholdPath: (rel, hid) => {
      calls.push({ rel, hid });
      return `/data/household${hid ? `-${hid}` : ''}/${rel}`;
    },
  };
  return { store: new YamlDoNowDatastore({ configService, householdId }), calls };
}

test('roots under the household folder, not <dataDir>/apps', () => {
  const { store, calls } = makeStore();
  // #root is private; exercise it through the public path accessor.
  assert.equal(store.rootPath(), '/data/household/donow');
  assert.deepEqual(calls.at(-1), { rel: 'donow', hid: null });
});

test('scopes the path to a non-default household', () => {
  const { store } = makeStore('beta');
  assert.equal(store.rootPath(), '/data/household-beta/donow');
});

test('constructor requires configService with getHouseholdPath', () => {
  assert.throws(
    () => new YamlDoNowDatastore({ dataDir: '/data' }),
    /requires configService with getHouseholdPath/,
  );
});
