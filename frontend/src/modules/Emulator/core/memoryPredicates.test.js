import { describe, it, expect } from 'vitest';
import { evalPredicate } from './memoryPredicates.js';

describe('evalPredicate', () => {
  it('equals', () => {
    expect(evalPredicate({ equals: 5 }, 5)).toBe(true);
    expect(evalPredicate({ equals: 5 }, 6)).toBe(false);
  });

  it('changed', () => {
    expect(evalPredicate({ changed: true }, 5, 4)).toBe(true);
    expect(evalPredicate({ changed: true }, 5, 5)).toBe(false);
  });

  it('gt', () => {
    expect(evalPredicate({ gt: 0 }, 1)).toBe(true);
    expect(evalPredicate({ gt: 0 }, 0)).toBe(false);
  });

  it('lt', () => {
    expect(evalPredicate({ lt: 10 }, 9)).toBe(true);
    expect(evalPredicate({ lt: 10 }, 10)).toBe(false);
  });

  it('mask', () => {
    expect(evalPredicate({ mask: 0x01 }, 0x03)).toBe(true);
    expect(evalPredicate({ mask: 0x01 }, 0x02)).toBe(false);
  });

  it('combined keys AND together', () => {
    expect(evalPredicate({ gt: 0, mask: 0x01 }, 0x03)).toBe(true); // 3>0 && 3&1
    expect(evalPredicate({ gt: 0, mask: 0x01 }, 0x02)).toBe(false); // 2>0 but 2&1==0
    expect(evalPredicate({ gt: 5, mask: 0x01 }, 0x03)).toBe(false); // 3>5 false
  });

  it('empty / null when never fires', () => {
    expect(evalPredicate({}, 5)).toBe(false);
    expect(evalPredicate(null, 5)).toBe(false);
  });

  it('ignores unknown keys', () => {
    expect(evalPredicate({ equals: 5, bogus: 99 }, 5)).toBe(true);
  });
});
