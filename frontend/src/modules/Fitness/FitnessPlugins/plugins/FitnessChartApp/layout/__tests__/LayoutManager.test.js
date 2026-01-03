import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LayoutManager } from '../LayoutManager.js';

describe('LayoutManager', () => {
  let manager;

  // Use realistic bounds for all tests to avoid clamping artifacts
  const DEFAULT_BOUNDS = {
    width: 800,
    height: 400,
    margin: { top: 10, right: 64, bottom: 38, left: 4 }
  };

  beforeEach(() => {
    manager = new LayoutManager({
      bounds: DEFAULT_BOUNDS,
      avatarRadius: 30
    });
  });

  it('should pass through single avatar without offset when within bounds', () => {
    const elements = [{ id: '1', type: 'avatar', x: 300, y: 200 }];
    const result = manager.layout(elements);
    
    assert.equal(result.elements.length, 1);
    assert.equal(result.elements[0].offsetX, 0);
    assert.equal(result.elements[0].offsetY, 0);
  });

  it('should offset overlapping avatars vertically (Push-Apart)', () => {
    const elements = [
      { id: '1', type: 'avatar', x: 300, y: 200, value: 20 },
      { id: '2', type: 'avatar', x: 300, y: 200, value: 10 }
    ];
    const result = manager.layout(elements);
    
    assert.equal(result.elements.length, 2);
    
    // Find avatars by ID
    const a1 = result.elements.find(e => e.id === '1');
    const a2 = result.elements.find(e => e.id === '2');
    
    // Push-apart strategy: first avatar stays at original Y, second pushed down
    // Higher value avatar (id=1) should be first (stays at top)
    // MIN_DISTANCE = DIAMETER(60) + MIN_GAP(10) = 70
    assert.equal(a1.offsetY, 0); // First avatar unchanged
    assert.equal(a2.offsetY, 70); // Second pushed down by MIN_DISTANCE
  });

  it('should preserve original x/y and use offsetX for bounds clamping', () => {
    const manager = new LayoutManager({
      bounds: { width: 500, height: 400, margin: { top: 10, right: 50, bottom: 10, left: 10 } },
      avatarRadius: 30
    });
    const elements = [
      { id: 'a1', type: 'avatar', x: 480, y: 100 } // Near right edge (maxX = 500-50-30-50=370)
    ];
    const result = manager.layout(elements);
    
    const avatar = result.elements.find(e => e.id === 'a1');
    
    // Original x/y should be preserved
    assert.equal(avatar.x, 480);
    assert.equal(avatar.y, 100);
    // Clamping should be applied via offsetX (480 -> 370 = -110)
    assert.equal(avatar.offsetX, -110);
    // labelPosition is determined by LabelManager collision check, defaults to 'right'
    // It would only be 'left' if there's another avatar to collide with
    assert.ok(['right', 'left', 'top', 'bottom'].includes(avatar.labelPosition));
  });

  it('should not apply offset when avatar is within bounds', () => {
    const manager = new LayoutManager({
      bounds: { width: 1000, height: 400, margin: { top: 10, right: 100, bottom: 10, left: 10 } },
      avatarRadius: 30
    });
    const elements = [
      { id: 'a1', type: 'avatar', x: 500, y: 100 } // Well within bounds
    ];
    const result = manager.layout(elements);
    
    const avatar = result.elements.find(e => e.id === 'a1');
    
    assert.equal(avatar.x, 500);
    assert.equal(avatar.offsetX, 0);
    assert.equal(avatar.offsetY, 0);
  });

  it('should stack overlapping badges vertically', () => {
    const elements = [
      { id: 'b1', type: 'badge', x: 200, y: 200 },
      { id: 'b2', type: 'badge', x: 200, y: 200 }
    ];
    const result = manager.layout(elements);
    
    assert.equal(result.elements.length, 2);
    const sorted = result.elements.sort((a, b) => a.id.localeCompare(b.id));
    
    // Badges should be stacked via BadgeStackLayout
    // Gap is 22 (10*2 + 2). Half gap is 11.
    assert.equal(sorted[0].offsetY, -11);
    assert.equal(sorted[1].offsetY, 11);
  });

  it('should separate avatars and badges', () => {
    const elements = [
      { id: 'a1', type: 'avatar', x: 300, y: 200 },
      { id: 'b1', type: 'badge', x: 150, y: 150 }
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
      bounds: DEFAULT_BOUNDS,
      options: { maxBadgesPerUser: 2 }
    });
    const elements = [
      { id: 'b1', type: 'badge', participantId: 'p1', tick: 10, x: 100, y: 200 },
      { id: 'b2', type: 'badge', participantId: 'p1', tick: 20, x: 150, y: 200 },
      { id: 'b3', type: 'badge', participantId: 'p1', tick: 30, x: 200, y: 200 }
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
      bounds: { width: 800, height: 400, margin: { left: 0, top: 10, right: 10, bottom: 10 } }
    });
    const elements = [
      { id: 'b1', type: 'badge', x: 10, y: 200 }, // Near edge (10 < 50)
      { id: 'b2', type: 'badge', x: 200, y: 200 } // Far from edge
    ];
    const result = manager.layout(elements);
    
    const b1 = result.elements.find(e => e.id === 'b1');
    const b2 = result.elements.find(e => e.id === 'b2');
    
    assert.ok(b1.opacity < 1);
    assert.equal(b2.opacity, 1);
  });

  it('should fade badge if colliding with avatar', () => {
    const elements = [
      { id: 'a1', type: 'avatar', x: 300, y: 200 },
      { id: 'b1', type: 'badge', x: 300, y: 200 } // Direct collision
    ];
    const result = manager.layout(elements);
    
    const badge = result.elements.find(e => e.type === 'badge');
    assert.ok(badge.opacity <= 0.2);
  });

  it('should generate connectors for clamped avatars', () => {
    const manager = new LayoutManager({
      bounds: { width: 500, height: 400, margin: { top: 10, right: 50, bottom: 10, left: 10 } },
      avatarRadius: 30,
      options: { enableConnectors: true }
    });
    const elements = [
      { id: 'a1', type: 'avatar', x: 480, y: 200 } // Will be clamped left by 110px
    ];
    const result = manager.layout(elements);
    
    // Should have one connector for the clamped avatar
    assert.equal(result.connectors.length, 1);
    assert.equal(result.connectors[0].x1, 480); // Original line endpoint
    assert.ok(result.connectors[0].x2 < 480); // Connector ends at avatar's right edge
  });
});
