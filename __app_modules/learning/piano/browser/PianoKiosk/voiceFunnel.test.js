import { describe, it, expect } from 'vitest';
import { buildFunnel, bundleKey } from './voiceFunnel.js';

const fav = [{ voice: { pc: 16, bank: 0 } }];
const shortlist = [{ pc: 16, bank: 0, name: 'Upright' }, { pc: 0, bank: 0, name: 'Grand' }];
const groups = [{ group: 'Piano', voices: [{ pc: 0, bank: 0, name: 'Grand' }] }];

describe('buildFunnel', () => {
  it('dedups shortlist against favorites by pc:bank', () => {
    const out = buildFunnel({ favorites: fav, shortlistVoices: shortlist, allGroups: groups });
    expect(out.favorites).toEqual(fav);
    expect(out.shortlist).toEqual([{ pc: 0, bank: 0, name: 'Grand' }]);
    expect(out.groups).toEqual(groups);
  });
  it('handles empty inputs', () => {
    expect(buildFunnel({})).toEqual({ favorites: [], shortlist: [], groups: [] });
  });
});

describe('bundleKey', () => {
  it('keys by pc:bank', () => {
    expect(bundleKey({ voice: { pc: 5, bank: 1 } })).toBe('5:1');
  });
});
