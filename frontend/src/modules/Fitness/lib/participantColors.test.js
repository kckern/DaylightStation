import { describe, it, expect } from 'vitest';
import { assignIdentityColors, IDENTITY_PALETTE } from './participantColors.js';
import { ZoneColors } from '@/modules/Fitness/domain';

describe('assignIdentityColors', () => {
  it('returns a stable color per id regardless of input order', () => {
    const a = assignIdentityColors(['user_3', 'user_2', 'user_1']);
    const b = assignIdentityColors(['user_1', 'user_3', 'user_2']);
    expect(a.get('user_3')).toBe(b.get('user_3'));
    expect(a.get('user_1')).toBe(b.get('user_1'));
  });
  it('gives distinct colors to up to palette-length ids', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const m = assignIdentityColors(ids);
    expect(new Set(ids.map(i => m.get(i))).size).toBe(5);
  });
  it('never collides with a zone color', () => {
    const zone = new Set(Object.values(ZoneColors).map(c => c.toLowerCase()));
    expect(IDENTITY_PALETTE.every(c => !zone.has(c.toLowerCase()))).toBe(true);
  });
  it('cycles the palette when there are more ids than colors', () => {
    const ids = Array.from({ length: IDENTITY_PALETTE.length + 1 }, (_, i) => `u${i}`);
    const m = assignIdentityColors(ids);
    expect(m.size).toBe(ids.length);
    expect(m.get('u0')).toBe(m.get(`u${IDENTITY_PALETTE.length}`));
  });
  it('handles empty / falsy input', () => {
    expect(assignIdentityColors([]).size).toBe(0);
    expect(assignIdentityColors(['', null, 'x']).get('x')).toBeTruthy();
  });
});
