import test from 'node:test';
import assert from 'node:assert/strict';
import { YamlMemoLedgerStore } from './YamlMemoLedgerStore.mjs';
import { IMemoLedgerStore } from '../../application/ports/IMemoLedgerStore.mjs';

function build({ writes = true } = {}) {
  const calls = [];
  const files = new Map();
  const events = [];
  const store = new YamlMemoLedgerStore({
    dataService: {
      user: {
        read: (path, username) => { calls.push(['read', path, username]); return files.get(`${username}/${path}`) ?? null; },
        write: (path, data, username) => { calls.push(['write', path, username]); if (writes) files.set(`${username}/${path}`, data); return writes; },
      },
    },
    logger: { error: (event, data) => events.push({ event, data }) },
  });
  return { store, calls, events };
}

test('the ledger is one document per user under the journalist app folder', () => {
  const { store, calls } = build();
  assert.ok(store instanceof IMemoLedgerStore);
  assert.equal(store.read('user_1'), null);
  assert.equal(store.write('user_1', { memos: { m1: { saved: true } } }), true);
  assert.deepEqual(store.read('user_1'), { memos: { m1: { saved: true } } });
  assert.equal(store.read('user_2'), null);
  assert.deepEqual(calls[1], ['write', 'apps/journalist/memo_ledger', 'user_1']);
});

test('a write that did not land is reported and logged', () => {
  const { store, events } = build({ writes: false });
  assert.equal(store.write('user_1', {}), false);
  assert.deepEqual(events, [{ event: 'journalist.memo.ledger.writeFailed', data: { username: 'user_1' } }]);
});

test('the data service is required', () => {
  assert.throws(() => new YamlMemoLedgerStore({}), /dataService/);
});
