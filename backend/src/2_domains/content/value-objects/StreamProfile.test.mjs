import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StreamProfile } from './StreamProfile.mjs';
import { STREAM_FORMATS } from './StreamFormat.mjs';

test('matches by host (case-insensitive, with/without www)', () => {
  const p = new StreamProfile({ name: 'soccerfull', match: { hosts: ['soccerfull.net'] }, strategy: 'scrape', format: 'hls_video' });
  assert.equal(p.matches('https://www.soccerfull.net/play/14360'), true);
  assert.equal(p.matches('https://SOCCERFULL.NET/x'), true);
  assert.equal(p.matches('https://example.com/x'), false);
});

test('matches by url regex when provided', () => {
  const p = new StreamProfile({ name: 'x', match: { urlRegex: '/match/\\d+' }, strategy: 'iframe', format: 'webview' });
  assert.equal(p.matches('https://x.tv/match/99'), true);
  assert.equal(p.matches('https://x.tv/other'), false);
});

test('rejects unknown strategy/format', () => {
  assert.throws(() => new StreamProfile({ name: 'x', strategy: 'bogus', format: 'video' }));
  assert.throws(() => new StreamProfile({ name: 'x', strategy: 'scrape', format: 'bogus' }));
});

test('STREAM_FORMATS are the three published formats', () => {
  assert.deepEqual([...STREAM_FORMATS].sort(), ['hls_video', 'video', 'webview']);
});
