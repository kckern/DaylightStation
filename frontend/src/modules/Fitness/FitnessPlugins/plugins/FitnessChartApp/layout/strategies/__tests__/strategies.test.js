import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compareAvatars } from '../../utils/sort.js';
import { StraddleLayout } from '../StraddleLayout.js';
import { StackLayout } from '../StackLayout.js';
import { FanLayout } from '../FanLayout.js';
import { GridLayout } from '../GridLayout.js';

describe('Strategies', () => {
  describe('compareAvatars', () => {
    it('should sort by Y position', () => {
      const a = { id: '1', y: 10 };
      const b = { id: '2', y: 20 };
      assert.ok(compareAvatars(a, b) < 0);
      assert.ok(compareAvatars(b, a) > 0);
    });

    it('should sort by value if Y is same', () => {
      const a = { id: '1', y: 10, value: 100 };
      const b = { id: '2', y: 10, value: 50 };
      // Higher value first (descending)
      assert.ok(compareAvatars(a, b) < 0);
    });

    it('should sort by ID if Y and value are same', () => {
      const a = { id: 'A', y: 10, value: 100 };
      const b = { id: 'B', y: 10, value: 100 };
      assert.ok(compareAvatars(a, b) < 0);
      assert.ok(compareAvatars(b, a) > 0);
    });
  });

  describe('StraddleLayout', () => {
    it('should sort avatars before applying layout', () => {
      const layout = new StraddleLayout();
      const avatars = [
        { id: 'B', y: 100, x: 0 },
        { id: 'A', y: 100, x: 0 }
      ];
      const result = layout.apply(avatars);
      // A should be first (top) because of ID sort
      assert.equal(result[0].id, 'A');
      assert.equal(result[1].id, 'B');
      assert.ok(result[0].finalY < result[1].finalY);
    });
  });

  describe('StackLayout', () => {
    it('should sort avatars before applying layout', () => {
      const layout = new StackLayout();
      const avatars = [
        { id: 'C', y: 100, x: 0 },
        { id: 'A', y: 100, x: 0 },
        { id: 'B', y: 100, x: 0 }
      ];
      const result = layout.apply(avatars);
      assert.equal(result[0].id, 'A');
      assert.equal(result[1].id, 'B');
      assert.equal(result[2].id, 'C');
    });
  });
});
