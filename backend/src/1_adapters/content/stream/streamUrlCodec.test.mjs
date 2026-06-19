import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeStreamUrl, decodeStreamUrl } from './streamUrlCodec.mjs';

test('round-trips a url with slashes/colons/query', () => {
  const url = 'https://soccerfull.net/play/14360?a=b';
  const tok = encodeStreamUrl(url);
  assert.ok(!/[:/]/.test(tok));
  assert.equal(decodeStreamUrl(tok), url);
});

test('decode passes through a raw http url unchanged', () => {
  assert.equal(decodeStreamUrl('https://x/y'), 'https://x/y');
});
