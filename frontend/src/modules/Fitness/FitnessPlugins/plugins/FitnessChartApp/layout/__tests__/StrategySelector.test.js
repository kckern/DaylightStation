import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { StrategySelector } from '../StrategySelector.js';

describe('StrategySelector', () => {
  let selector;

  beforeEach(() => {
    selector = new StrategySelector({ minGap: 10, radius: 50, columns: 2 });
  });

  it('should use no strategy for single element', () => {
    const cluster = [{ id: '1', x: 0, y: 0 }];
    const result = selector.selectAndApply(cluster);
    assert.equal(result.length, 1);
    assert.equal(result[0].strategy, 'none');
  });

  it('should use straddle for 2 elements', () => {
    const cluster = [
      { id: '1', x: 0, y: 0 },
      { id: '2', x: 0, y: 0 }
    ];
    const result = selector.selectAndApply(cluster);
    assert.equal(result.length, 2);
    assert.equal(result[0].strategy, 'straddle');
    assert.equal(result[1].strategy, 'straddle');
  });

  it('should use stack for 3-4 elements', () => {
    const cluster = [
      { id: '1', x: 0, y: 0 },
      { id: '2', x: 0, y: 0 },
      { id: '3', x: 0, y: 0 }
    ];
    const result = selector.selectAndApply(cluster);
    assert.equal(result.length, 3);
    assert.equal(result[0].strategy, 'stack');
  });

  it('should use fan for 5-6 elements', () => {
    const cluster = Array(5).fill(0).map((_, i) => ({ id: String(i), x: 0, y: 0 }));
    const result = selector.selectAndApply(cluster);
    assert.equal(result.length, 5);
    assert.equal(result[0].strategy, 'fan');
  });

  it('should use grid for 7+ elements', () => {
    const cluster = Array(7).fill(0).map((_, i) => ({ id: String(i), x: 0, y: 0 }));
    const result = selector.selectAndApply(cluster);
    assert.equal(result.length, 7);
    assert.equal(result[0].strategy, 'grid');
  });
});
