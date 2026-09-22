import test from 'node:test';
import assert from 'node:assert/strict';
import { runLiveProbe } from './live/libby-bootstrap.live.mjs';

const env = { LIBBY_LIVE: '1', LIBBY_LIVE_DATA_PATH: '/fixture', LIBBY_LIVE_USERNAME: 'reader', LIBBY_LIVE_CARD_ID: '1', LIBBY_LIVE_TITLE_ID: '2', DAYLIGHT_BROWSER_URL: 'http://daylight-browser:3000' };

function fixture({ rangeStatus = 206, failCover = false, slowCleanup = false } = {}) {
  const events = [];
  const opened = type => ({ kind: 'opened', status: rangeStatus, contentType: type,
    contentRange: 'bytes 0-0/42', contentLength: '1',
    body: new ReadableStream({ cancel() { events.push(`cancel:${type}`); } }),
    async cleanup() { if (slowCleanup) await new Promise(resolve => setTimeout(resolve, 5)); events.push(`cleanup:${type}`); } });
  const runtime = {
    client: { async openLoan() { return { cardId: '1', titleId: '2', title: 'A book', subtitle: null, author: null, narrator: null, description: null, expiresAt: null,
      parts: [{ key: 'part', index: 0, title: 'Part 1', duration: 123, contentLength: 42, mimeType: 'audio/mpeg', upstreamUrl: 'SECRET', headers: {} }] }; } },
    leases: { issue() { return { handle: 'SECRET' }; }, dispose() { events.push('dispose'); } },
    streamService: { async open(input) { assert.equal(input.range, 'bytes=0-0'); return opened('audio/mpeg'); } },
    coverService: { async open() { if (failCover) throw Error('SECRET'); return opened('image/jpeg'); } },
  };
  return { runtimeFactory: () => runtime, events };
}

const rejectedConfigurations = [
  ['all configuration absent', {}],
  ...Object.keys(env).map(key => {
    const configuration = { ...env };
    delete configuration[key];
    return [`${key} absent`, configuration];
  }),
  ['opt-in disabled', { ...env, LIBBY_LIVE: '0' }],
  ['card identity malformed', { ...env, LIBBY_LIVE_CARD_ID: 'not-a-card' }],
  ['title identity malformed', { ...env, LIBBY_LIVE_TITLE_ID: '2/path' }],
];

for (const [name, configuration] of rejectedConfigurations) {
  test(`live probe never constructs credential-capable runtime with ${name}`, async () => {
    let runtimeCalls = 0;
    const result = await runLiveProbe({ env: configuration, runtimeFactory: () => {
      runtimeCalls += 1;
      throw Error('credential-capable boundary reached');
    } });
    // This assertion is outside the probe's catch: swallowing the factory error
    // cannot conceal entering the credential-capable boundary without opt-in.
    assert.equal(runtimeCalls, 0);
    assert.deepEqual(result, { success: false, title: null, partCount: 0, duration: 0, mimeTypes: [], coverMimeType: null });
  });
}

test('live probe returns only approved evidence and immediately cancels media and cover bodies', async () => {
  const f = fixture();
  assert.deepEqual(await runLiveProbe({ env, ...f }), { success: true, title: 'A book', partCount: 1, duration: 123, mimeTypes: ['audio/mpeg'], coverMimeType: 'image/jpeg' });
  assert.deepEqual(f.events, ['cancel:audio/mpeg', 'cleanup:audio/mpeg', 'cancel:image/jpeg', 'cleanup:image/jpeg', 'dispose']);
});

test('ignored range and provider failures fail closed without leaking errors or retaining leases', async () => {
  for (const options of [{ rangeStatus: 200 }, { failCover: true }]) {
    const f = fixture(options);
    const result = await runLiveProbe({ env, ...f });
    assert.equal(result.success, false);
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
    assert.equal(f.events.at(-1), 'dispose');
    assert.ok(f.events.includes('cancel:audio/mpeg'));
  }
});

test('live evidence waits for asynchronous stream cleanup before disposing leases', async () => {
  const f = fixture({ slowCleanup: true });
  await runLiveProbe({ env, ...f });
  assert.deepEqual(f.events, ['cancel:audio/mpeg', 'cleanup:audio/mpeg', 'cancel:image/jpeg', 'cleanup:image/jpeg', 'dispose']);
});
