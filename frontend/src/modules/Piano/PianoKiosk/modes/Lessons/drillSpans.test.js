import { describe, it, expect } from 'vitest';
import { drillSpans } from './drillSpans.js';

describe('drillSpans', () => {
  it('maps each expanded right-hand cell to a span of its midi notes', () => {
    const expanded = {
      hands: {
        right: [
          { role: 'ascending', notes: [{ midi: 48 }, { midi: 52 }] },
          { role: 'ascending', notes: [{ midi: 50 }, { midi: 53 }] },
        ],
        left: [{ role: 'ascending', notes: [{ midi: 36 }] }],
      },
    };
    expect(drillSpans(expanded)).toEqual([
      { id: 0, expectedMidi: [48, 52] },
      { id: 1, expectedMidi: [50, 53] },
    ]);
  });

  it('is empty for missing hands and skips noteless cells', () => {
    expect(drillSpans(null)).toEqual([]);
    expect(drillSpans({ hands: { right: [{ role: 'ascending' }] } })).toEqual([]);
  });
});
