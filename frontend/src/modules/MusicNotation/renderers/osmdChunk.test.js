import { describe, it, expect } from 'vitest';
import { runSliced } from './osmdRender.js';

describe('runSliced', () => {
  it('processes all indices in order, in slices, reporting progress', async () => {
    const seen = [];
    const progress = [];
    const immediateYield = (cb) => cb();
    await runSliced(5, 2, (i) => seen.push(i), immediateYield, (p) => progress.push(p));
    expect(seen).toEqual([0, 1, 2, 3, 4]);
    expect(progress[progress.length - 1]).toBe(1); // finished at 100%
  });

  it('aborts mid-way when shouldAbort flips', async () => {
    const seen = [];
    let calls = 0;
    const immediateYield = (cb) => cb();
    await runSliced(10, 2, (i) => seen.push(i), immediateYield, () => {}, () => (++calls >= 2));
    expect(seen.length).toBeLessThan(10);
  });
});
