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

  it('should generate connector for leftward displacement', () => {
    // Connectors are only generated for avatars moved LEFT (negative offsetX)
    // This happens when avatars are clamped to avoid going off the right edge
    //
    // Radius 10. Offset -20 (moved left).
    // Origin 100. Avatar center at 80 (100 - 20).
    // Avatar right edge at 80 + 10 = 90.
    // Connector from origin (100) to avatar right edge (90).

    const elements = [
      { id: '1', type: 'avatar', x: 100, y: 100, offsetX: -20, offsetY: 0, color: 'red' }
    ];
    const connectors = generator.generate(elements);
    assert.equal(connectors.length, 1);

    const c = connectors[0];
    assert.equal(c.id, 'connector-1');
    assert.equal(c.x1, 100); // Original X (line endpoint)
    assert.equal(c.y1, 100); // Original Y
    assert.equal(c.x2, 90);  // Avatar right edge: 80 + 10 = 90
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
