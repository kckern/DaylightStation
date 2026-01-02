import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LayoutManager } from '../LayoutManager.js';

describe('LayoutManager', () => {
  let manager;

  beforeEach(() => {
    manager = new LayoutManager({
      avatarRadius: 30
    });
  });

  it('should pass through single avatar without offset', () => {
    const elements = [{ id: '1', type: 'avatar', x: 100, y: 100 }];
    const result = manager.layout(elements);
    
    assert.equal(result.elements.length, 1);
    assert.equal(result.elements[0].offsetY, 0);
  });

  it('should offset overlapping avatars vertically (Straddle Strategy)', () => {
    const elements = [
      { id: '1', type: 'avatar', x: 100, y: 100 },
      { id: '2', type: 'avatar', x: 100, y: 100 }
    ];
    const result = manager.layout(elements);
    
    assert.equal(result.elements.length, 2);
    
    // Sort by ID to ensure deterministic check
    const sorted = result.elements.sort((a, b) => a.id.localeCompare(b.id));
    
    // Straddle strategy centers around centroid (100)
    // Gap is 64 (30*2 + 4). Half gap is 32.
    // One should be at -32 offset, other at +32 offset
    
    assert.equal(sorted[0].offsetY, -32);
    assert.equal(sorted[1].offsetY, 32);
  });

  it('should stack overlapping badges vertically', () => {
    const elements = [
      { id: 'b1', type: 'badge', x: 50, y: 50 },
      { id: 'b2', type: 'badge', x: 50, y: 50 }
    ];
    const result = manager.layout(elements);
    
    assert.equal(result.elements.length, 2);
    const sorted = result.elements.sort((a, b) => a.id.localeCompare(b.id));
    
    // Badges should be stacked
    // Gap is 22 (10*2 + 2). Half gap is 11.
    assert.equal(sorted[0].offsetY, -11);
    assert.equal(sorted[1].offsetY, 11);
  });

  it('should separate avatars and badges', () => {
    const elements = [
      { id: 'a1', type: 'avatar', x: 100, y: 100 },
      { id: 'b1', type: 'badge', x: 50, y: 50 }
    ];
    const result = manager.layout(elements);
    
    assert.equal(result.elements.length, 2);
    const avatar = result.elements.find(e => e.type === 'avatar');
    const badge = result.elements.find(e => e.type === 'badge');
    
    assert.ok(avatar);
    assert.ok(badge);
  });

  it('should filter max badges per user', () => {
    const manager = new LayoutManager({
      options: { maxBadgesPerUser: 2 }
    });
    const elements = [
      { id: 'b1', type: 'badge', participantId: 'p1', tick: 10 },
      { id: 'b2', type: 'badge', participantId: 'p1', tick: 20 },
      { id: 'b3', type: 'badge', participantId: 'p1', tick: 30 }
    ];
    const result = manager.layout(elements);
    
    assert.equal(result.elements.length, 2);
    // Should keep b3 (30) and b2 (20)
    const ids = result.elements.map(e => e.id);
    assert.ok(ids.includes('b3'));
    assert.ok(ids.includes('b2'));
    assert.ok(!ids.includes('b1'));
  });

  it('should fade badges near left edge', () => {
    const manager = new LayoutManager({
      bounds: { margin: { left: 0 } }
    });
    const elements = [
      { id: 'b1', type: 'badge', x: 10, y: 100 }, // Near edge (10 < 50)
      { id: 'b2', type: 'badge', x: 100, y: 100 } // Far from edge
    ];
    const result = manager.layout(elements);
    
    const b1 = result.elements.find(e => e.id === 'b1');
    const b2 = result.elements.find(e => e.id === 'b2');
    
    assert.ok(b1.opacity < 1);
    assert.equal(b2.opacity, 1);
  });

  it('should fade badge if colliding with avatar', () => {
    const elements = [
      { id: 'a1', type: 'avatar', x: 100, y: 100 },
      { id: 'b1', type: 'badge', x: 100, y: 100 } // Direct collision
    ];
    const result = manager.layout(elements);
    
    const badge = result.elements.find(e => e.type === 'badge');
    assert.ok(badge.opacity <= 0.2);
  });
});
