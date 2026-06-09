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
