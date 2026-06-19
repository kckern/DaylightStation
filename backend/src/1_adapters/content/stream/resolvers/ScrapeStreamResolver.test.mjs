import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScrapeStreamResolver } from './ScrapeStreamResolver.mjs';
import { StreamProfile } from '#domains/content/value-objects/StreamProfile.mjs';

const profile = new StreamProfile({
  name: 'soccerfull', strategy: 'scrape', format: 'hls_video',
  match: { hosts: ['soccerfull.net'] },
  scrape: { patterns: ['file:\\s*"([^"]+\\.m3u8[^"]*)"'], headers: { referer: 'https://soccerfull.net/' } },
});

test('extracts m3u8 via configured pattern', async () => {
  const fakeFetch = async () => ({ ok: true, text: async () => 'var x = { file: "https://cdn.x/h.m3u8?t=1" };' });
  const r = new ScrapeStreamResolver({ fetchFn: fakeFetch });
  const out = await r.resolve('https://soccerfull.net/play/14360', profile);
  assert.equal(out.format, 'hls_video');
  assert.equal(out.mediaUrl, 'https://cdn.x/h.m3u8?t=1');
  assert.deepEqual(out.headers, { referer: 'https://soccerfull.net/' });
});

test('declines when no pattern matches', async () => {
  const fakeFetch = async () => ({ ok: true, text: async () => '<html>nope</html>' });
  const r = new ScrapeStreamResolver({ fetchFn: fakeFetch });
  assert.equal(await r.resolve('https://soccerfull.net/play/14360', profile), null);
});

test('resolves relative stream URL against the page url', async () => {
  const fakeFetch = async () => ({ ok: true, text: async () => 'file: "/hls/h.m3u8"' });
  const r = new ScrapeStreamResolver({ fetchFn: fakeFetch });
  const out = await r.resolve('https://soccerfull.net/play/14360', profile);
  assert.equal(out.mediaUrl, 'https://soccerfull.net/hls/h.m3u8');
});
