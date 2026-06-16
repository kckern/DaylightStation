import { describe, it, expect } from 'vitest';
import { immichDimensions } from '../../../backend/src/1_adapters/content/gallery/immich/immichDimensions.mjs';

describe('immichDimensions', () => {
  it('prefers Immich top-level (orientation-corrected) dims over raw exif', () => {
    // The real bug: a portrait shot with orientation 6 stores landscape sensor
    // pixels (3264×1836) but Immich reports corrected 1836×3264 up top, and the
    // preview is portrait. We must report portrait.
    const asset = {
      width: 1836, height: 3264,
      exifInfo: { exifImageWidth: 3264, exifImageHeight: 1836, orientation: '6' },
    };
    expect(immichDimensions(asset)).toEqual({ width: 1836, height: 3264 });
  });

  it('non-rotated asset (orientation 1): top-level and exif agree', () => {
    const asset = {
      width: 4032, height: 1960,
      exifInfo: { exifImageWidth: 4032, exifImageHeight: 1960, orientation: '1' },
    };
    expect(immichDimensions(asset)).toEqual({ width: 4032, height: 1960 });
  });

  it('falls back to exif dims when top-level dims are missing', () => {
    const asset = { exifInfo: { exifImageWidth: 1600, exifImageHeight: 1000 } };
    expect(immichDimensions(asset)).toEqual({ width: 1600, height: 1000 });
  });

  it('swaps exif dims on the fallback path when orientation is a quarter turn', () => {
    for (const o of [5, 6, 7, 8]) {
      const asset = { exifInfo: { exifImageWidth: 3264, exifImageHeight: 1836, orientation: String(o) } };
      expect(immichDimensions(asset)).toEqual({ width: 1836, height: 3264 });
    }
  });

  it('does not swap exif dims for non-quarter-turn orientations (1,2,3,4)', () => {
    for (const o of [1, 2, 3, 4]) {
      const asset = { exifInfo: { exifImageWidth: 3264, exifImageHeight: 1836, orientation: String(o) } };
      expect(immichDimensions(asset)).toEqual({ width: 3264, height: 1836 });
    }
  });

  it('accepts numeric orientation as well as string', () => {
    const asset = { exifInfo: { exifImageWidth: 3264, exifImageHeight: 1836, orientation: 6 } };
    expect(immichDimensions(asset)).toEqual({ width: 1836, height: 3264 });
  });

  it('returns nulls when no usable dimensions exist', () => {
    expect(immichDimensions({})).toEqual({ width: null, height: null });
    expect(immichDimensions({ exifInfo: {} })).toEqual({ width: null, height: null });
    expect(immichDimensions({ width: 0, height: 0, exifInfo: {} })).toEqual({ width: null, height: null });
  });

  it('ignores a partial top-level pair and uses exif instead', () => {
    const asset = { width: 1836, exifInfo: { exifImageWidth: 3264, exifImageHeight: 1836, orientation: '6' } };
    // Only width present up top → not a usable pair → fall back to (swapped) exif.
    expect(immichDimensions(asset)).toEqual({ width: 1836, height: 3264 });
  });
});
