// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizePlaybackQuality, playbackQualityChange } from './playbackQuality.mjs';

describe('playback quality input', () => {
  it('leaves an ordinary play request unchanged', () => {
    expect(normalizePlaybackQuality({ play: 'plex:42' })).toEqual({});
    expect(normalizePlaybackQuality({ maxResolution: null, maxVideoBitrate: undefined })).toEqual({});
  });

  it('normalizes HTTP values without losing an explicit false', () => {
    expect(normalizePlaybackQuality({ maxResolution: '720p', maxVideoBitrate: '4000', transcode: 'force', adaptive: 'false' }))
      .toEqual({ maxResolution: '720', maxVideoBitrate: 4000, transcode: 'force', adaptive: false });
    expect(normalizePlaybackQuality({ maxVideoResolution: 480, adaptive: true }))
      .toEqual({ maxResolution: '480', adaptive: true });
  });

  it.each([
    { maxResolution: 'garbage' }, { maxResolution: ['720', '1080'] },
    { maxResolution: '720', maxVideoResolution: '1080' },
    { maxVideoBitrate: '4000oops' }, { maxVideoBitrate: 0 }, { maxVideoBitrate: -1 },
    { maxVideoBitrate: Infinity }, { maxVideoBitrate: 1.5 },
    { transcode: 'yes' }, { adaptive: 'sometimes' }, { adaptive: 0 },
  ])('rejects malformed or conflicting settings: %j', input => {
    expect(() => normalizePlaybackQuality(input)).toThrow(expect.objectContaining({ status: 400, code: 'VALIDATION' }));
  });
});

describe('changing the current visit quality', () => {
  const snapshot = () => ({ sessionId: 's1', state: 'paused', position: 4320,
    currentItem: { contentId: 'plex:42', format: 'video', maxResolution: '1080', transcode: 'force', subtitleStreamId: '22' },
    queue: { currentIndex: 0, items: [{ queueItemId: 'q1', contentId: 'plex:42', maxResolution: '1080' }, { queueItemId: 'q2', contentId: 'plex:43' }] },
    config: { volume: 33, shader: 'night', shuffle: true },
  });
  it('changes only the current visit, retaining pause, position, tracks and queue identity', () => {
    const before = snapshot();
    const result = playbackQualityChange(before, { contentId: 'plex:42', queueItemId: 'q1', quality: { maxResolution: '720', adaptive: false } });
    expect(result.ok).toBe(true);
    expect(result.snapshot).toMatchObject({ state: 'paused', position: 4320, config: before.config,
      currentItem: { contentId: 'plex:42', maxResolution: '720', adaptive: false, subtitleStreamId: '22' } });
    expect(result.snapshot.currentItem).not.toHaveProperty('transcode');
    expect(result.snapshot.queue.items[0]).toMatchObject({ queueItemId: 'q1', maxResolution: '720', adaptive: false });
    expect(result.snapshot.queue.items[1]).toEqual(before.queue.items[1]);
    expect(before.currentItem.maxResolution).toBe('1080');
  });
  it.each([{ contentId: 'plex:42', format: 'audio' }, { contentId: 'libby:42', format: 'video' }])('refuses unsupported active media: %j', currentItem => {
    expect(playbackQualityChange({ ...snapshot(), currentItem }, { contentId: currentItem.contentId, quality: { maxResolution: '720' } }))
      .toMatchObject({ ok: false, code: 'QUALITY_UNSUPPORTED' });
  });
  it('clears overrides without changing playback or leaving stale caps', () => {
    const result = playbackQualityChange(snapshot(), { contentId: 'plex:42', quality: {} });
    expect(result.snapshot.currentItem).not.toHaveProperty('maxResolution');
    expect(result.snapshot.currentItem).not.toHaveProperty('transcode');
    expect(result.snapshot.queue.items[0]).not.toHaveProperty('maxResolution');
    expect(result.snapshot.position).toBe(4320);
  });
  it.each([{ contentId: 'plex:43' }, { contentId: 'plex:42', queueItemId: 'old-visit' }, { contentId: 'plex:42', sessionId: 'old-session' }])('refuses stale controls: %j', target => {
    expect(playbackQualityChange(snapshot(), { ...target, quality: { maxResolution: '720' } })).toMatchObject({ ok: false, code: 'PLAYBACK_CHANGED' });
  });
});
