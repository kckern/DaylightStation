import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IframeStreamResolver } from './IframeStreamResolver.mjs';

test('always resolves any http(s) url to a webview result', async () => {
  const r = new IframeStreamResolver();
  const out = await r.resolve('https://soccerfull.net/play/14360');
  assert.equal(out.format, 'webview');
  assert.equal(out.mediaUrl, 'https://soccerfull.net/play/14360');
});

test('declines non-http', async () => {
  const r = new IframeStreamResolver();
  assert.equal(await r.resolve('ftp://x/y'), null);
});
