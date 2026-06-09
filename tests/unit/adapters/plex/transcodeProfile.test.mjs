// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolveTranscodeCaps, buildClientProfileExtra } from '#adapters/content/media/plex/transcodeProfile.mjs';

describe('resolveTranscodeCaps', () => {
  it('applies default caps when caller passes nothing', () => {
    const caps = resolveTranscodeCaps({});
    expect(caps).toEqual({ maxVideoBitrate: 8000, maxResolution: '1080', maxFrameRate: 30 });
  });

  it('lets an explicit lower bitrate win but never raises above the default ceiling', () => {
    expect(resolveTranscodeCaps({ maxVideoBitrate: 4000 }).maxVideoBitrate).toBe(4000);
    expect(resolveTranscodeCaps({ maxVideoBitrate: 50000 }).maxVideoBitrate).toBe(8000);
  });

  it('passes through an explicit resolution', () => {
    expect(resolveTranscodeCaps({ maxResolution: '720' }).maxResolution).toBe('720');
  });
});

describe('buildClientProfileExtra', () => {
  it('appends a frame-rate upper-bound limitation to the codec advertisement', () => {
    const extra = buildClientProfileExtra({ maxFrameRate: 30 });
    expect(extra).toContain('videoCodec=h264,hevc');
    expect(extra).toContain('add-limitation(scope=videoCodec&scopeName=*&type=upperBound&name=video.frameRate&value=30)');
    // The two clauses are '+'-joined within the single X-Plex-Client-Profile-Extra value.
    expect(extra.split('+')).toHaveLength(2);
  });

  it('omits the limitation when no frame rate cap is given', () => {
    const extra = buildClientProfileExtra({});
    expect(extra).not.toContain('frameRate');
    expect(extra.split('+')).toHaveLength(1);
  });
});

import { canDirectPlayH264 } from '#adapters/content/media/plex/transcodeProfile.mjs';

describe('canDirectPlayH264', () => {
  const h264Media = {
    Media: [{ container: 'mp4', videoCodec: 'h264', audioCodec: 'aac',
              Part: [{ container: 'mp4', key: '/library/parts/1/file.mp4' }] }]
  };

  it('allows direct play for h264/aac/mp4', () => {
    expect(canDirectPlayH264(h264Media)).toBe(true);
  });

  it('rejects non-h264 video (the VP9/AV1 mismatch class)', () => {
    expect(canDirectPlayH264({ Media: [{ container: 'webm', videoCodec: 'vp9', audioCodec: 'opus', Part: [{ container: 'webm' }] }] })).toBe(false);
    expect(canDirectPlayH264({ Media: [{ container: 'mkv', videoCodec: 'av1', audioCodec: 'aac', Part: [{ container: 'mkv' }] }] })).toBe(false);
  });

  it('rejects non-mp4 containers and non-aac audio', () => {
    expect(canDirectPlayH264({ Media: [{ container: 'mkv', videoCodec: 'h264', audioCodec: 'aac', Part: [{ container: 'mkv' }] }] })).toBe(false);
    expect(canDirectPlayH264({ Media: [{ container: 'mp4', videoCodec: 'h264', audioCodec: 'ac3', Part: [{ container: 'mp4' }] }] })).toBe(false);
  });

  it('rejects missing/empty metadata', () => {
    expect(canDirectPlayH264(null)).toBe(false);
    expect(canDirectPlayH264({})).toBe(false);
  });
});
