// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolveTranscodeCaps, buildClientProfileExtra, canDirectStreamVideo, isHighBitDepthVideo } from '#adapters/content/media/plex/transcodeProfile.mjs';

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

  it('clamps an explicit frame rate above the default ceiling down to the cap', () => {
    expect(resolveTranscodeCaps({ maxFrameRate: 60 }).maxFrameRate).toBe(30);
  });

  it('lets an explicit lower frame rate pass through', () => {
    expect(resolveTranscodeCaps({ maxFrameRate: 24 }).maxFrameRate).toBe(24);
  });

  it('falls back to the default bitrate when given a non-finite value', () => {
    expect(resolveTranscodeCaps({ maxVideoBitrate: 'abc' }).maxVideoBitrate).toBe(8000);
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

// Regression guard for the 2026-09-12 stall: a 10-bit HEVC source was reported as
// direct-streamable, which makes PlexAdapter drop the transcode caps. Plex then
// re-encoded it anyway, uncapped (CRF 16 / 20 Mbps), at ~0.5x realtime.
describe('canDirectStreamVideo bit-depth gate', () => {
  const media = (overrides = {}) => ({
    videoCodec: 'hevc',
    Part: [{ Stream: [{ streamType: 1, codec: 'hevc', bitDepth: 8, profile: 'main' }] }],
    ...overrides,
  });

  it('allows 8-bit hevc to direct-stream', () => {
    expect(canDirectStreamVideo({ Media: [media()] })).toBe(true);
  });

  it('allows 8-bit h264 to direct-stream', () => {
    expect(canDirectStreamVideo({
      Media: [media({ videoCodec: 'h264', Part: [{ Stream: [{ streamType: 1, bitDepth: 8 }] }] })],
    })).toBe(true);
  });

  it('refuses 10-bit hevc (Main 10) — Plex re-encodes it, so caps must stay on', () => {
    expect(canDirectStreamVideo({
      Media: [media({
        videoProfile: 'main 10',
        Part: [{ Stream: [{ streamType: 1, codec: 'hevc', bitDepth: 10, profile: 'main 10' }] }],
      })],
    })).toBe(false);
  });

  it('refuses 10-bit h264 (Hi10P)', () => {
    expect(canDirectStreamVideo({
      Media: [media({
        videoCodec: 'h264',
        Part: [{ Stream: [{ streamType: 1, bitDepth: 10, profile: 'high 10' }] }],
      })],
    })).toBe(false);
  });

  it('falls back to the profile string when bitDepth is absent', () => {
    expect(isHighBitDepthVideo({ videoProfile: 'main 10', Part: [{ Stream: [{ streamType: 1 }] }] })).toBe(true);
    expect(isHighBitDepthVideo({ videoProfile: 'main', Part: [{ Stream: [{ streamType: 1 }] }] })).toBe(false);
    expect(isHighBitDepthVideo({ videoProfile: 'high', Part: [{ Stream: [{ streamType: 1 }] }] })).toBe(false);
  });

  it('does not mistake an 8-bit profile that merely contains digits for 10-bit', () => {
    expect(isHighBitDepthVideo({ videoProfile: 'high 4:2:2', Part: [{ Stream: [{ streamType: 1, bitDepth: 8 }] }] })).toBe(false);
  });

  it('still refuses codecs that are never copyable, regardless of depth', () => {
    expect(canDirectStreamVideo({ Media: [media({ videoCodec: 'av1' })] })).toBe(false);
    expect(canDirectStreamVideo({ Media: [media({ videoCodec: 'vp9' })] })).toBe(false);
  });
});
