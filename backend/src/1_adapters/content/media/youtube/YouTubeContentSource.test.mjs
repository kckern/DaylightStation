import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeContentSource } from './YouTubeContentSource.mjs';
import { encodeStreamUrl } from '#adapters/content/stream/streamUrlCodec.mjs';
import { validateAdapter } from '#domains/content/services/validateContentSource.mjs';

const VID = 'F1sMvm6D-0Y';

function capturingLogger() {
  const events = [];
  const rec = (level) => (event, data) => events.push({ level, event, data });
  return { events, debug: rec('debug'), info: rec('info'), warn: rec('warn'), error: rec('error') };
}

// Fake Piped adapter: getStreamInfo(videoId, opts) -> info | null
function fakePiped(info) {
  return { getStreamInfo: async () => info };
}

// Fake stream adapter: getItem(compoundId) -> Item-ish | null, records calls
function fakeStream(item) {
  const calls = [];
  return {
    calls,
    getItem: async (id) => { calls.push(id); return item; },
  };
}

test('source + prefixes', () => {
  const a = new YouTubeContentSource({});
  assert.equal(a.source, 'youtube');
  assert.deepEqual(a.prefixes, [{ prefix: 'youtube' }]);
});

test('passes validateAdapter', () => {
  const a = new YouTubeContentSource({});
  assert.doesNotThrow(() => validateAdapter(a));
});

test('tier 1: Piped combined stream -> proxied video item, re-ided as youtube:<id>', async () => {
  const logger = capturingLogger();
  const piped = fakePiped({
    url: 'https://rr3.googlevideo.com/videoplayback?id=abc',
    mimeType: 'video/mp4',
    duration: 212,
    title: 'Big Match',
    thumbnailUrl: 'https://i.ytimg.com/vi/F1sMvm6D-0Y/hq.jpg',
  });
  const a = new YouTubeContentSource({ pipedAdapter: piped, streamAdapter: fakeStream(null), logger });

  const item = await a.getItem(`youtube:${VID}`);

  assert.equal(item.id, `youtube:${VID}`);
  assert.equal(item.mediaType, 'video');
  assert.equal(item.metadata.contentFormat, 'video');
  assert.equal(item.title, 'Big Match');
  assert.equal(item.duration, 212);
  assert.match(item.mediaUrl, /^\/api\/v1\/proxy\/stream\?/);
  assert.match(item.mediaUrl, /src=https%3A%2F%2Frr3\.googlevideo\.com/);
  // logs which strategy won
  assert.ok(logger.events.some(e => e.event === 'stream.resolve.selected' && e.data?.strategy === 'piped'));
});

test('tier 2: Piped unavailable -> delegates to stream adapter with base64url token, re-ided', async () => {
  const logger = capturingLogger();
  const streamItem = {
    id: 'stream:zzz',
    title: 'From Stream',
    thumbnail: null,
    mediaUrl: '/api/v1/proxy/stream?src=https%3A%2F%2Fx%2Fv.m3u8',
    mediaType: 'hls_video',
    duration: 99,
    metadata: { contentFormat: 'hls_video' },
  };
  const stream = fakeStream(streamItem);
  const a = new YouTubeContentSource({ pipedAdapter: null, streamAdapter: stream, logger });

  const item = await a.getItem(`youtube:${VID}`);

  // delegated with canonical watch URL, base64url-encoded
  assert.equal(stream.calls.length, 1);
  assert.equal(stream.calls[0], `stream:${encodeStreamUrl('https://www.youtube.com/watch?v=' + VID)}`);
  // re-ided to youtube identity but carries stream's playable fields
  assert.equal(item.id, `youtube:${VID}`);
  assert.equal(item.mediaType, 'hls_video');
  assert.equal(item.mediaUrl, streamItem.mediaUrl);
  assert.equal(item.duration, 99);
  assert.ok(logger.events.some(e => e.event === 'stream.resolve.selected' && e.data?.strategy === 'stream'));
});

test('tier 2 runs when Piped returns null', async () => {
  const stream = fakeStream({
    id: 'stream:zzz', title: 't', mediaUrl: '/api/v1/proxy/stream?src=x', mediaType: 'video', duration: null, metadata: {},
  });
  const a = new YouTubeContentSource({ pipedAdapter: fakePiped(null), streamAdapter: stream });
  const item = await a.getItem(`youtube:${VID}`);
  assert.equal(stream.calls.length, 1);
  assert.equal(item.mediaType, 'video');
});

test('tier 3: both fail -> iframe embed webview item', async () => {
  const logger = capturingLogger();
  const a = new YouTubeContentSource({ pipedAdapter: fakePiped(null), streamAdapter: fakeStream(null), logger });

  const item = await a.getItem(`youtube:${VID}`);

  assert.equal(item.id, `youtube:${VID}`);
  assert.equal(item.mediaType, 'webview');
  assert.equal(item.metadata.contentFormat, 'webview');
  assert.equal(item.mediaUrl, `https://www.youtube.com/embed/${VID}?autoplay=1`);
  assert.ok(logger.events.some(e => e.event === 'stream.resolve.selected' && e.data?.strategy === 'iframe'));
});

test('accepts a bare id without the youtube: prefix', async () => {
  const a = new YouTubeContentSource({ pipedAdapter: fakePiped(null), streamAdapter: fakeStream(null) });
  const item = await a.getItem(VID);
  assert.equal(item.id, `youtube:${VID}`);
});

test('invalid id -> null (logged, not thrown)', async () => {
  const logger = capturingLogger();
  const a = new YouTubeContentSource({ logger });
  const item = await a.getItem('youtube:not-a-valid-id!');
  assert.equal(item, null);
  assert.ok(logger.events.some(e => e.event === 'youtube.id.invalid'));
});

test('resolvePlayables returns single-item array, empty on null', async () => {
  const ok = new YouTubeContentSource({ pipedAdapter: fakePiped(null), streamAdapter: fakeStream(null) });
  assert.equal((await ok.resolvePlayables(`youtube:${VID}`)).length, 1);

  const bad = new YouTubeContentSource({});
  assert.deepEqual(await bad.resolvePlayables('youtube:bad!'), []);
});

test('getList empty, resolveSiblings null', async () => {
  const a = new YouTubeContentSource({});
  assert.deepEqual(await a.getList(), []);
  assert.equal(await a.resolveSiblings(), null);
});
