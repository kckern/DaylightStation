import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickPlayableFormat } from './YtDlpAdapter.mjs';

test('prefers top-level info.url when present', () => {
  const out = pickPlayableFormat({ url: 'https://cdn/merged.m3u8', protocol: 'm3u8_native', formats: [] });
  assert.deepEqual(out, { url: 'https://cdn/merged.m3u8', protocol: 'm3u8_native' });
});

test('picks highest progressive/combined format', () => {
  const info = {
    formats: [
      { url: 'https://cdn/360.mp4', vcodec: 'avc1', acodec: 'mp4a', height: 360, protocol: 'https' },
      { url: 'https://cdn/720.mp4', vcodec: 'avc1', acodec: 'mp4a', height: 720, protocol: 'https' },
      { url: 'https://cdn/video-only.mp4', vcodec: 'avc1', acodec: 'none', height: 1080, protocol: 'https' },
    ],
  };
  const out = pickPlayableFormat(info);
  assert.equal(out.url, 'https://cdn/720.mp4');
  assert.equal(out.protocol, 'https');
});

test('falls back to last format with a url when no combined format', () => {
  const info = {
    protocol: 'https',
    formats: [
      { url: 'https://cdn/a.mp4', vcodec: 'avc1', acodec: 'none', height: 720 },
      { url: 'https://cdn/b.m4a', vcodec: 'none', acodec: 'mp4a' },
    ],
  };
  const out = pickPlayableFormat(info);
  assert.equal(out.url, 'https://cdn/b.m4a');
  assert.equal(out.protocol, 'https');
});

test('returns null when nothing playable', () => {
  assert.equal(pickPlayableFormat({ formats: [] }), null);
  assert.equal(pickPlayableFormat(null), null);
});
