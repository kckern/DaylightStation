import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeAdapter } from './YouTubeAdapter.mjs';

const quietLogger = { debug() {}, info() {}, warn() {}, error() {} };

function fakeHttp(data, { fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async get(url, opts) {
      calls.push({ url, opts });
      if (fail) throw new Error('piped down');
      return { data };
    },
  };
}

const PIPED_PAGE = {
  items: [
    { url: '/watch?v=LIVE0000001', type: 'stream', title: 'LIVE: Bluey 24h', duration: -1, uploaderName: 'Bluey' },
    { url: '/watch?v=RHUauMcYlX0', type: 'stream', title: 'Bluey Full Episodes', duration: 3600, thumbnail: 'https://p/vi/RHUauMcYlX0.jpg', uploaderName: 'Bluey - Official Channel' },
    { url: '/channel/UCVz', type: 'channel', name: 'Bluey' },
    { url: '/watch?v=dQw4w9WgXcQ', type: 'stream', title: 'Bluey Song', duration: 213, uploaderName: 'Fan' },
  ],
};

test('search: asks Piped for videos and keeps playable videos only', async () => {
  const http = fakeHttp(PIPED_PAGE);
  const a = new YouTubeAdapter({ host: 'https://piped.example/', httpClient: http, logger: quietLogger });
  const results = await a.search('bluey & friends', { take: 5 });
  assert.equal(http.calls[0].url, 'https://piped.example/search?q=bluey%20%26%20friends&filter=videos');
  assert.deepEqual(results, [
    { videoId: 'RHUauMcYlX0', title: 'Bluey Full Episodes', thumbnail: 'https://p/vi/RHUauMcYlX0.jpg', uploader: 'Bluey - Official Channel', duration: 3600 },
    { videoId: 'dQw4w9WgXcQ', title: 'Bluey Song', thumbnail: null, uploader: 'Fan', duration: 213 },
  ]);
});

test('search: take caps, the same words are cached, a failure answers empty', async () => {
  const http = fakeHttp(PIPED_PAGE);
  const a = new YouTubeAdapter({ host: 'https://piped.example', httpClient: http, logger: quietLogger });
  assert.equal((await a.search('bluey', { take: 1 })).length, 1);
  await a.search('Bluey');
  assert.equal(http.calls.length, 1);

  const down = new YouTubeAdapter({ host: 'https://piped.example', httpClient: fakeHttp(null, { fail: true }), logger: quietLogger });
  assert.deepEqual(await down.search('bluey'), []);
  assert.deepEqual(await down.search(''), []);
});
