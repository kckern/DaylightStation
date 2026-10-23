import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogStoreQuery, logStoreBaseFromSinkUrl } from './logStoreQuery.mjs';

test('derives the query base from the remote sink insert url', () => {
  assert.equal(logStoreBaseFromSinkUrl('http://victoria-logs:9428/insert/jsonline?_time_field=ts&_msg_field=event'), 'http://victoria-logs:9428');
  assert.equal(logStoreBaseFromSinkUrl(null), null);
  assert.equal(logStoreBaseFromSinkUrl('not a url'), null);
});

test('POSTs LogsQL and parses JSON Lines', async () => {
  let seen;
  const q = createLogStoreQuery({
    baseUrl: 'http://victoria-logs:9428',
    fetchImpl: async (url, init) => { seen = { url, body: String(init.body) }; return { ok: true, text: async () => '{"_msg":"a"}\n{"_msg":"b"}\n' }; },
  });
  assert.deepEqual(await q('"piano.speaker.dropped" AND _time:7d'), [{ _msg: 'a' }, { _msg: 'b' }]);
  assert.equal(seen.url, 'http://victoria-logs:9428/select/logsql/query');
  assert.match(seen.body, /query=%22piano\.speaker\.dropped%22/);
  assert.match(seen.body, /limit=5000/);
});

test('a non-2xx answer throws (the caller retries later)', async () => {
  const q = createLogStoreQuery({ baseUrl: 'http://x:9428', fetchImpl: async () => ({ ok: false, status: 400, text: async () => 'bad' }) });
  await assert.rejects(() => q('x'), /HTTP 400/);
});
