import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { isValidCrop, mergeWorkMetadata }
  from '../../../backend/src/1_adapters/content/art/workMetadata.mjs';

describe('isValidCrop', () => {
  it('accepts a valid band and the not-croppable flag', () => {
    expect(isValidCrop({ top: 10, bottom: 20 })).toBe(true);
    expect(isValidCrop({ enabled: false })).toBe(true);
    expect(isValidCrop(null)).toBe(true);   // clear
  });
  it('rejects out-of-range and over-budget bands', () => {
    expect(isValidCrop({ top: -1 })).toBe(false);
    expect(isValidCrop({ top: 95 })).toBe(false);
    expect(isValidCrop({ top: 60, bottom: 40 })).toBe(false);   // sum > 90
    expect(isValidCrop('top')).toBe(false);
    expect(isValidCrop({ enabled: 'no' })).toBe(false);
  });
});

describe('mergeWorkMetadata crop', () => {
  const base = "title: X\nwidth: 1600\nheight: 1000\n";
  it('writes a crop band', () => {
    const out = yaml.load(mergeWorkMetadata(base, { crop: { enabled: true, top: 12, bottom: 18 } }));
    expect(out.crop).toMatchObject({ enabled: true, top: 12, bottom: 18 });
  });
  it('crop: null clears it', () => {
    const withCrop = "title: X\nwidth: 1\nheight: 1\ncrop:\n  top: 5\n";
    const out = yaml.load(mergeWorkMetadata(withCrop, { crop: null }));
    expect('crop' in out).toBe(false);
  });
  it('throws on an invalid crop', () => {
    expect(() => mergeWorkMetadata(base, { crop: { top: 99 } })).toThrow(/crop/i);
  });
});
