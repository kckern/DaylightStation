import { describe, it, expect, afterEach } from 'vitest';
import { sizedPlexImage, ART_BOX } from './plexImage.js';

const POSTER = '/api/v1/proxy/plex/library/metadata/489954/thumb/1719035803';

function parse(url) {
  const [path, query] = url.split('?');
  return { path, params: new URLSearchParams(query) };
}

afterEach(() => { globalThis.devicePixelRatio = 1; });

describe('sizedPlexImage', () => {
  it('asks Plex for the box we draw in, carrying the original path in `url`', () => {
    const { path, params } = parse(sizedPlexImage(POSTER, ...ART_BOX.gridPoster));
    expect(path).toBe('/api/v1/proxy/plex/photo/:/transcode');
    expect(params.get('url')).toBe('/library/metadata/489954/thumb/1719035803');
    // minSize=1 fills the box (matches object-fit: cover); without it Plex
    // fits INSIDE the box and a cover-cropped tile shows background bars.
    expect(params.get('minSize')).toBe('1');
  });

  it('keeps the caller box aspect ratio', () => {
    const { params } = parse(sizedPlexImage(POSTER, ...ART_BOX.unitThumb)); // 16:9
    expect(Number(params.get('width')) / Number(params.get('height'))).toBeCloseTo(16 / 9, 2);
  });

  it('snaps widths to the ladder so a fluid grid does not spawn a transcode per pixel', () => {
    const widths = [200, 210, 236, 240].map((w) => parse(sizedPlexImage(POSTER, w, w * 1.5)).params.get('width'));
    expect(new Set(widths).size).toBe(1);
    expect(widths[0]).toBe('240');
  });

  it('doubles for a retina panel, capped at 2x', () => {
    globalThis.devicePixelRatio = 2;
    expect(parse(sizedPlexImage(POSTER, 240, 360)).params.get('width')).toBe('480');
    globalThis.devicePixelRatio = 3;
    expect(parse(sizedPlexImage(POSTER, 240, 360)).params.get('width')).toBe('480');
  });

  it('leaves anything that is not a proxied Plex original alone', () => {
    expect(sizedPlexImage(null, 240, 360)).toBeNull();
    expect(sizedPlexImage(undefined, 240, 360)).toBeUndefined();
    expect(sizedPlexImage('/img/local/cover.png', 240, 360)).toBe('/img/local/cover.png');
    expect(sizedPlexImage('https://cdn.example/x.jpg', 240, 360)).toBe('https://cdn.example/x.jpg');
    // Already sized — re-wrapping would nest one transcode inside another.
    const once = sizedPlexImage(POSTER, 240, 360);
    expect(sizedPlexImage(once, 240, 360)).toBe(once);
  });

  it('returns the source untouched when the box is unknown', () => {
    expect(sizedPlexImage(POSTER, 0, 0)).toBe(POSTER);
    expect(sizedPlexImage(POSTER, undefined, undefined)).toBe(POSTER);
  });
});
