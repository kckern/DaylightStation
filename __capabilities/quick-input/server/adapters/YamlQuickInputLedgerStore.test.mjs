import test from 'node:test';
import assert from 'node:assert/strict';
import { YamlQuickInputLedgerStore } from './YamlQuickInputLedgerStore.mjs';
import { IQuickInputLedgerStore } from '../application/ports/IQuickInputLedgerStore.mjs';

function dataService({ writes = true } = {}) {
  const calls = [];
  const files = new Map();
  return {
    calls,
    user: {
      read: (path, username) => { calls.push(['read', path, username]); return files.get(`${username}/${path}`) ?? null; },
      write: (path, data, username) => { calls.push(['write', path, username]); if (writes) files.set(`${username}/${path}`, data); return writes; },
    },
  };
}

test('each bot has its own ledger document per user', () => {
  const data = dataService();
  const store = new YamlQuickInputLedgerStore({ dataService: data, bot: 'nutribot' });
  assert.ok(store instanceof IQuickInputLedgerStore);
  assert.equal(store.read('user_1'), null);
  assert.equal(store.write('user_1', { inputs: {} }), true);
  assert.deepEqual(store.read('user_1'), { inputs: {} });
  assert.deepEqual(data.calls[1], ['write', 'apps/nutribot/quick_input_ledger', 'user_1']);
  const other = new YamlQuickInputLedgerStore({ dataService: data, bot: 'journalist' });
  assert.equal(other.read('user_1'), null);
});

test('a write that did not land is reported and logged', () => {
  const events = [];
  const store = new YamlQuickInputLedgerStore({
    dataService: dataService({ writes: false }), bot: 'nutribot',
    logger: { error: (event, data) => events.push({ event, data }) },
  });
  assert.equal(store.write('user_1', {}), false);
  assert.deepEqual(events, [{ event: 'quick_input.ledger.writeFailed', data: { username: 'user_1' } }]);
});

test('the data service and a bot name that is safe in a path are required', () => {
  assert.throws(() => new YamlQuickInputLedgerStore({ bot: 'nutribot' }), /dataService/);
  for (const bot of [undefined, '', '../etc', 'Nutri Bot']) {
    assert.throws(() => new YamlQuickInputLedgerStore({ dataService: dataService(), bot }), /bot/);
  }
});
