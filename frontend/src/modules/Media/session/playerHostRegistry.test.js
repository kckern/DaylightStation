import { describe, it, expect } from 'vitest';
import { resolveActiveHost } from './playerHostRegistry.js';

const el = (name) => ({ name }); // stand-in DOM nodes

describe('resolveActiveHost', () => {
  it('returns null for an empty claim set', () => {
    expect(resolveActiveHost([])).toBeNull();
  });

  it('ignores claims whose element is null', () => {
    expect(resolveActiveHost([{ el: null, priority: 5, seq: 9 }])).toBeNull();
  });

  it('returns the highest-priority claim', () => {
    const low = el('low'); const high = el('high');
    const active = resolveActiveHost([
      { el: low, priority: 1, seq: 1 },
      { el: high, priority: 2, seq: 2 },
    ]);
    expect(active).toBe(high);
  });

  it('breaks priority ties by most-recent (highest seq)', () => {
    const a = el('a'); const b = el('b');
    const active = resolveActiveHost([
      { el: a, priority: 1, seq: 1 },
      { el: b, priority: 1, seq: 2 },
    ]);
    expect(active).toBe(b);
  });

  it('falls back to the next claim when the top one is absent', () => {
    const low = el('low');
    // Simulates the priority-2 claim having been released (removed from the set).
    expect(resolveActiveHost([{ el: low, priority: 1, seq: 1 }])).toBe(low);
  });
});
