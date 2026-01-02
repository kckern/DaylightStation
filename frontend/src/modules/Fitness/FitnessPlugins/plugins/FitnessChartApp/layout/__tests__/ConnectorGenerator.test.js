import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectorGenerator } from '../ConnectorGenerator.js';

describe('ConnectorGenerator', () => {
  let generator;

  beforeEach(() => {
    generator = new ConnectorGenerator({ threshold: 10, avatarRadius: 10 });
  });

  it('should not generate connector for small displacement', () => {
    const elements = [
      { id: '1', type: 'avatar', x: 100, y: 100, offsetX: 5, offsetY: 5 }
    ];
    const connectors = generator.generate(elements);
    assert.equal(connectors.length, 0);
  });

  it('should generate connector for large displacement', () => {
    // Radius 10. Offset 20. Distance 20.
    // Line should stop at edge (distance - radius) = 20 - 10 = 10 from origin.
    // Origin 100. Target Center 120.
    // Vector (20, 0).
    // Ratio (20-10)/20 = 0.5.
    // TargetX = 100 + 20 * 0.5 = 110.
    
    const elements = [
      { id: '1', type: 'avatar', x: 100, y: 100, offsetX: 20, offsetY: 0, color: 'red' }
    ];
    const connectors = generator.generate(elements);
    assert.equal(connectors.length, 1);
    
    const c = connectors[0];
    assert.equal(c.id, 'connector-1');
    assert.equal(c.x1, 100); // Original X
    assert.equal(c.y1, 100); // Original Y
    assert.equal(c.x2, 110); // 100 + 10
    assert.equal(c.y2, 100);
    assert.equal(c.color, 'red');
  });

  it('should ignore non-avatar elements', () => {
    const elements = [
      { id: '1', type: 'badge', x: 100, y: 100, offsetX: 20, offsetY: 0 }
    ];
    const connectors = generator.generate(elements);
    assert.equal(connectors.length, 0);
  });
});
