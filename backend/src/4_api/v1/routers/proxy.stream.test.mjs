import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteHlsPlaylist, isBlockedStreamHost } from './proxy.mjs';

test('rewrites relative + absolute segment/variant URIs through the proxy', () => {
  const playlist = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=1',
    'sub/variant.m3u8',
    '#EXTINF:6,',
    'https://cdn.x/seg1.ts',
    '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.x/key"',
  ].join('\n');
  const out = rewriteHlsPlaylist(playlist, 'https://cdn.x/live/index.m3u8', 'soccerfull');
  assert.match(out, /\/api\/v1\/proxy\/stream\?src=https%3A%2F%2Fcdn\.x%2Flive%2Fsub%2Fvariant\.m3u8&profile=soccerfull/);
  assert.match(out, /\/api\/v1\/proxy\/stream\?src=https%3A%2F%2Fcdn\.x%2Fseg1\.ts&profile=soccerfull/);
  assert.match(out, /URI="\/api\/v1\/proxy\/stream\?src=https%3A%2F%2Fcdn\.x%2Fkey&profile=soccerfull"/);
  assert.match(out, /#EXTINF:6,/);
});

test('SSRF guard blocks internal hosts, allows public', () => {
  assert.equal(isBlockedStreamHost('localhost'), true);
  assert.equal(isBlockedStreamHost('127.0.0.1'), true);
  assert.equal(isBlockedStreamHost('10.0.0.5'), true);
  assert.equal(isBlockedStreamHost('192.168.1.9'), true);
  assert.equal(isBlockedStreamHost('foo.local'), true);
  assert.equal(isBlockedStreamHost('cdn.soccerfull.net'), false);
});
