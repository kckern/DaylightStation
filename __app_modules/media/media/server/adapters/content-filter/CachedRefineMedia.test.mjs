import { describe, expect, it, vi } from 'vitest';
import { FrameChunkCache, ProxiedRefineMedia } from './CachedRefineMedia.mjs';

// A fake media: 24 fps, frame k at pts k/24; every frames() call is one ffmpeg run.
const FPS = 24;
function fakeMedia({ last = 100000 } = {}) {
  const calls = [];
  return {
    calls,
    async frames(src, fromPts, count, opts = {}) {
      calls.push({ src, fromPts, count, opts });
      const first = Math.ceil((fromPts - 0.001) * FPS);
      const out = [];
      for (let k = first; k < first + count && k <= last; k++) out.push({ pts: k / FPS, png: Buffer.from(`${src}:${opts.width}:${k}`) });
      return out;
    },
    async audio(src) { calls.push({ audio: src }); return 'pcm'; },
    async probe(src) { calls.push({ probe: src }); return { width: 1920 }; },
    async shotCuts(src) { calls.push({ cuts: src }); return []; },
    async blackIntervals(src) { calls.push({ black: src }); return []; },
  };
}

describe('FrameChunkCache', () => {
  it('serves nearby single-frame requests from one decoded chunk', async () => {
    const inner = fakeMedia();
    const cache = new FrameChunkCache({ inner, chunkFrames: 48 });
    const a = await cache.frames('s', 386.0, 1, { width: 720 });
    const b = await cache.frames('s', 386.25, 1, { width: 720 });
    const c = await cache.frames('s', 387.5, 1, { width: 720 });
    expect(inner.calls).toHaveLength(1);
    expect(inner.calls[0]).toMatchObject({ fromPts: 386.0, count: 48 });
    expect(a[0].pts).toBe(386.0);
    expect(b[0].pts).toBe(386.25);
    expect(String(c[0].png)).toBe('s:720:9300');
  });

  it('returns exactly the frame asked for, as the inner media would', async () => {
    const inner = fakeMedia();
    const cache = new FrameChunkCache({ inner, chunkFrames: 48 });
    await cache.frames('s', 10, 1, { width: 720 });
    const direct = await fakeMedia().frames('s', 10 + 7 / 24, 3, { width: 720 });
    expect(await cache.frames('s', 10 + 7 / 24, 3, { width: 720 })).toEqual(direct);
  });

  it('a request past the chunk decodes a new chunk', async () => {
    const inner = fakeMedia();
    const cache = new FrameChunkCache({ inner, chunkFrames: 48 });
    await cache.frames('s', 10, 1, { width: 720 });
    await cache.frames('s', 12.5, 1, { width: 720 });
    expect(inner.calls).toHaveLength(2);
  });

  it('a run of frames that spills past a chunk end decodes from the request', async () => {
    const inner = fakeMedia();
    const cache = new FrameChunkCache({ inner, chunkFrames: 48 });
    await cache.frames('s', 10, 1, { width: 720 });
    const r = await cache.frames('s', 11.9, 10, { width: 720 });
    expect(r).toHaveLength(10);
    expect(inner.calls.at(-1)).toMatchObject({ fromPts: 11.9, count: 48 });
  });

  it('keys by width and source', async () => {
    const inner = fakeMedia();
    const cache = new FrameChunkCache({ inner, chunkFrames: 48 });
    await cache.frames('s', 10, 1, { width: 720 });
    await cache.frames('s', 10, 1, { width: 1280 });
    await cache.frames('t', 10, 1, { width: 720 });
    expect(inner.calls).toHaveLength(3);
  });

  it('at the end of the film returns what there is and caches it', async () => {
    const inner = fakeMedia({ last: 10 * FPS + 5 });
    const cache = new FrameChunkCache({ inner, chunkFrames: 48 });
    expect(await cache.frames('s', 10, 1, { width: 720 })).toHaveLength(1);
    expect(await cache.frames('s', 10 + 5 / 24, 3, { width: 720 })).toHaveLength(1);
    expect(inner.calls).toHaveLength(1);
  });

  it('drops the oldest chunks past maxFrames', async () => {
    const inner = fakeMedia();
    const cache = new FrameChunkCache({ inner, chunkFrames: 48, maxFrames: 96 });
    await cache.frames('s', 10, 1, { width: 720 });
    await cache.frames('s', 20, 1, { width: 720 });
    await cache.frames('s', 30, 1, { width: 720 });
    await cache.frames('s', 10, 1, { width: 720 });
    expect(inner.calls).toHaveLength(4);
  });

  it('drops the oldest chunks past maxBytes too', async () => {
    const inner = fakeMedia();
    const big = { ...inner, frames: async (...a) => (await inner.frames(...a)).map((f) => ({ ...f, png: Buffer.alloc(1000) })) };
    const cache = new FrameChunkCache({ inner: big, chunkFrames: 48, maxFrames: 10000, maxBytes: 100000 });
    await cache.frames('s', 10, 1, { width: 720 });
    await cache.frames('s', 20, 1, { width: 720 });
    await cache.frames('s', 30, 1, { width: 720 });
    await cache.frames('s', 10, 1, { width: 720 });
    expect(inner.calls).toHaveLength(4);
  });
  it('passes everything else through', async () => {
    const inner = fakeMedia();
    const cache = new FrameChunkCache({ inner });
    expect(await cache.audio('s', 1, 2)).toBe('pcm');
    expect(await cache.probe('s')).toEqual({ width: 1920 });
    await cache.shotCuts('s', 1, 2); await cache.blackIntervals('s', 1, 2);
    expect(inner.calls).toHaveLength(4);
  });
});

describe('ProxiedRefineMedia', () => {
  it('reads pictures from the proxy and sound and the probe from the original', async () => {
    const inner = fakeMedia();
    const media = new ProxiedRefineMedia({ inner, videoSrc: '/cache/p.mkv' });
    await media.frames('orig', 10, 1, { width: 720 });
    await media.shotCuts('orig', 1, 2);
    await media.blackIntervals('orig', 1, 2);
    await media.audio('orig', 1, 2);
    await media.probe('orig');
    expect(inner.calls.map((c) => c.src ?? c.cuts ?? c.black ?? c.audio ?? c.probe)).toEqual(['/cache/p.mkv', '/cache/p.mkv', '/cache/p.mkv', 'orig', 'orig']);
  });
  it('seeks 1.1 s before a frame (the proxy has a keyframe every second) unless asked otherwise', async () => {
    const inner = fakeMedia();
    const media = new ProxiedRefineMedia({ inner, videoSrc: '/cache/p.mkv' });
    await media.frames('orig', 10, 1, { width: 720 });
    await media.frames('orig', 10, 1, { width: 720, preroll: 5 });
    expect(inner.calls.map((c) => c.opts.preroll)).toEqual([1.1, 5]);
  });
  it('a film whose timeline starts at 1.5 s: the copy starts at 0, so times are shifted both ways (review 2026-11-12)', async () => {
    const inner = fakeMedia();
    inner.shotCuts = async (src, t0, t1) => { inner.calls.push({ cuts: src, t0, t1 }); return [{ pts: 8.5 }]; };
    inner.blackIntervals = async (src, t0, t1) => { inner.calls.push({ black: src, t0, t1 }); return [{ start: 8.5, end: 9.0 }]; };
    const media = new ProxiedRefineMedia({ inner, videoSrc: '/p.mkv', offset: 1.5 });
    const [f] = await media.frames('orig', 10, 1, { width: 720 });
    expect(inner.calls[0].fromPts).toBeCloseTo(8.5, 9);
    expect(f.pts).toBeCloseTo(10, 9);
    expect(await media.shotCuts('orig', 10, 12)).toEqual([{ pts: 10 }]);
    expect(inner.calls[1]).toMatchObject({ t0: 8.5, t1: 10.5 });
    const [b] = await media.blackIntervals('orig', 10, 12);
    expect(b.start).toBeCloseTo(10, 9); expect(b.end).toBeCloseTo(10.5, 9);
  });
});

