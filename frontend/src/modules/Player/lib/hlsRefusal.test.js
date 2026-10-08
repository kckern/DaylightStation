import { describe, it, expect } from 'vitest';
import { createHlsRefusalTracker, classifyHlsError, reportHlsError, HLS_REFUSAL_EVENT } from './hlsRefusal.js';
import { vi } from 'vitest';

// 2026-10-07: on a transcode the refusal is a SEGMENT 404 after a 200 manifest;
// hls.js logs a networkError and no MediaError ever reaches the resilience hook.
const seg = (code, extra = {}) => ({
  type: 'networkError', details: 'fragLoadError', fatal: false,
  response: { code }, frag: { url: 'http://x/api/v1/proxy/plex/video/:/transcode/universal/session/s/base/00012.ts?X-Plex-Token=SECRET' }, ...extra,
});

describe('classifyHlsError', () => {
  it('reads status, details and URL kind (never the URL itself)', () => {
    expect(classifyHlsError(seg(404))).toEqual({ status: 404, details: 'fragLoadError', urlKind: 'segment', fatal: false, networkError: true });
    expect(classifyHlsError({ type: 'networkError', details: 'manifestLoadError', response: { code: 503 }, context: { url: 'http://x/start.m3u8' } }))
      .toMatchObject({ status: 503, urlKind: 'manifest' });
    expect(JSON.stringify(classifyHlsError(seg(404)))).not.toContain('SECRET');
  });
  it('ignores non-network errors', () => {
    expect(classifyHlsError({ type: 'mediaError', details: 'bufferStalledError' }).networkError).toBe(false);
  });
});

describe('createHlsRefusalTracker', () => {
  it('raises on the second refusal-status error of a session', () => {
    const t = createHlsRefusalTracker();
    expect(t.observe(seg(404))).toBeNull();
    expect(t.observe(seg(404))).toMatchObject({ status: 404, urlKind: 'segment', count: 2 });
  });
  it('raises at once on a fatal refusal', () => {
    expect(createHlsRefusalTracker().observe(seg(503, { fatal: true }))).toMatchObject({ status: 503, fatal: true });
  });
  it('counts 403 / 404 / 5xx, not 400s, 0 or non-network errors', () => {
    for (const code of [403, 404, 500, 502, 503]) {
      const t = createHlsRefusalTracker();
      t.observe(seg(code));
      expect(t.observe(seg(code))).not.toBeNull();
    }
    for (const code of [0, 400, 401, 416]) {
      const t = createHlsRefusalTracker();
      t.observe(seg(code));
      expect(t.observe(seg(code))).toBeNull();
    }
    const t = createHlsRefusalTracker();
    t.observe({ type: 'mediaError', details: 'x', response: { code: 404 } });
    expect(t.observe({ type: 'mediaError', details: 'x', response: { code: 404 } })).toBeNull();
  });
  it('rate-limits repeats (a raised refusal is re-raised at most every 10 s)', () => {
    let now = 0;
    const t = createHlsRefusalTracker({ now: () => now });
    t.observe(seg(404));
    expect(t.observe(seg(404))).not.toBeNull();
    now += 2000;
    expect(t.observe(seg(404))).toBeNull();
    now += 9000;
    expect(t.observe(seg(404))).not.toBeNull();
  });
});

describe('reportHlsError', () => {
  it('logs the facts, and raises the DOM event on the element once it amounts to a refusal', () => {
    const video = document.createElement('video');
    const seen = [];
    video.addEventListener(HLS_REFUSAL_EVENT, (e) => seen.push(e.detail));
    const logger = { warn: vi.fn() };
    const tracker = createHlsRefusalTracker();
    expect(reportHlsError({ video, tracker, data: seg(404), logger })).toBe(false);
    expect(reportHlsError({ video, tracker, data: seg(404), logger })).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ status: 404, urlKind: 'segment', details: 'fragLoadError', count: 2 });
    expect(logger.warn).toHaveBeenCalledWith('video.hls.error', expect.objectContaining({ status: 404, urlKind: 'segment', details: 'fragLoadError' }));
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('SECRET');
  });
});
