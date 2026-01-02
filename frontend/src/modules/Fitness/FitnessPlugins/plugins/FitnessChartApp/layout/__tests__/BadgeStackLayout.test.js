import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BadgeStackLayout } from '../strategies/BadgeStackLayout.js';

describe('BadgeStackLayout', () => {
  let layout;

  beforeEach(() => {
    layout = new BadgeStackLayout({ minGap: 20 });
  });

  it('should pass through single badge', () => {
    const badges = [{ id: '1', x: 100, y: 100 }];
    const result = layout.apply(badges);
    assert.equal(result.length, 1);
    assert.equal(result[0].y, 100);
  });

  it('should stack overlapping badges vertically', () => {
    const badges = [
      { id: '1', x: 100, y: 100 },
      { id: '2', x: 100, y: 100 }
    ];
    const result = layout.apply(badges);
    
    assert.equal(result.length, 2);
    // Centroid is 100. Total height is 20. Start Y is 100 - 10 = 90.
    // Badge 1: 90
    // Badge 2: 110
    
    const sorted = result.sort((a, b) => a.finalY - b.finalY);
    assert.equal(sorted[0].finalY, 90);
    assert.equal(sorted[1].finalY, 110);
    assert.equal(sorted[0].finalX, 100); // X frozen
  });
});
