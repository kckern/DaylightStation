import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StreamAdapter } from './StreamAdapter.mjs';
import { StreamProfile } from '#domains/content/value-objects/StreamProfile.mjs';
import { StreamResult } from '#domains/content/value-objects/StreamResult.mjs';
import { encodeStreamUrl } from './streamUrlCodec.mjs';
import { validateAdapter } from '#domains/content/services/validateContentSource.mjs';

function fakeResolver(strategy, result) {
  return { strategy, resolve: async () => result };
}

test('source + prefixes', () => {
  const a = new StreamAdapter({ resolvers: [], profiles: [] });
  assert.equal(a.source, 'stream');
  assert.deepEqual(a.prefixes, [{ prefix: 'stream' }]);
});

test('passes validateAdapter', () => {
  const a = new StreamAdapter({ resolvers: [], profiles: [] });
  assert.doesNotThrow(() => validateAdapter(a));
});

test('webview result -> item with contentFormat webview, page url as mediaUrl', async () => {
  const a = new StreamAdapter({
    profiles: [],
    resolvers: [fakeResolver('iframe', new StreamResult({ format: 'webview', mediaUrl: 'https://x/y' }))],
    fallbackStrategy: 'iframe',
  });
  const item = await a.getItem(encodeStreamUrl('https://x/y'));
  assert.equal(item.metadata.contentFormat, 'webview');
  assert.equal(item.mediaUrl, 'https://x/y');
});

test('hls result -> contentFormat hls_video, mediaUrl wrapped in stream proxy', async () => {
  const profile = new StreamProfile({ name: 'soccerfull', strategy: 'scrape', format: 'hls_video', match: { hosts: ['soccerfull.net'] } });
  const a = new StreamAdapter({
    profiles: [profile],
    resolvers: [fakeResolver('scrape', new StreamResult({ format: 'hls_video', mediaUrl: 'https://cdn/h.m3u8' }))],
    fallbackStrategy: 'iframe',
  });
  const item = await a.getItem(encodeStreamUrl('https://soccerfull.net/play/14360'));
  assert.equal(item.metadata.contentFormat, 'hls_video');
  assert.equal(item.mediaType, 'hls_video');
  assert.match(item.mediaUrl, /^\/api\/v1\/proxy\/stream\?/);
  assert.match(item.mediaUrl, /profile=soccerfull/);
});

test('resolvePlayables returns single-item array', async () => {
  const a = new StreamAdapter({ profiles: [], resolvers: [fakeResolver('iframe', new StreamResult({ format: 'webview', mediaUrl: 'https://x/y' }))], fallbackStrategy: 'iframe' });
  const items = await a.resolvePlayables(encodeStreamUrl('https://x/y'));
  assert.equal(items.length, 1);
});
