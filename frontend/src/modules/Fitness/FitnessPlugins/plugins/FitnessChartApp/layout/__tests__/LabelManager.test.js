import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LabelManager } from '../LabelManager.js';

describe('LabelManager', () => {
  let manager;

  beforeEach(() => {
    manager = new LabelManager({
      avatarRadius: 10,
      labelGap: 5,
      labelWidth: 20,
      labelHeight: 10
    });
  });

  it('should default to right position', () => {
    const avatars = [{ id: '1', x: 100, y: 100 }];
    const result = manager.resolve(avatars);
    assert.equal(result[0].labelPosition, 'right');
  });

  it('should move label to left if right is blocked', () => {
    const avatars = [
      { id: '1', x: 100, y: 100 },
      // Avatar 2 is to the right of Avatar 1, blocking its label
      // Avatar 1 label rect (right): x: 100+10+5=115, y: 95, w: 20, h: 10
      // Avatar 2 rect: x: 120-10=110, y: 90, w: 20, h: 20
      // Overlap!
      { id: '2', x: 120, y: 100 }
    ];
    
    const result = manager.resolve(avatars);
    
    // Avatar 1 should move label to left
    const a1 = result.find(a => a.id === '1');
    assert.equal(a1.labelPosition, 'left');
    
    // Avatar 2 should stay right (nothing blocking it)
    const a2 = result.find(a => a.id === '2');
    assert.equal(a2.labelPosition, 'right');
  });
});
