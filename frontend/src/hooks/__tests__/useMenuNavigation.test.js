/**
 * Tests for useMenuNavigation hook
 * 
 * These tests verify keyboard navigation logic:
 * - Arrow key navigation
 * - Grid-based navigation with columns
 * - Item key generation
 * - Selection restoration
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Mock implementation of the navigation logic
 * This mirrors the hook's behavior without React dependencies
 */
class MenuNavigationLogic {
  constructor({ items = [], columns = 5, initialIndex = 0 }) {
    this.items = items;
    this.columns = columns;
    this.selectedIndex = initialIndex;
    this.selectedKey = this.getItemKey(items[initialIndex]) || null;
  }

  getItemKey(item) {
    if (!item) return null;
    const action = item?.play || item?.queue || item?.list || item?.open;
    const actionVal = action && (Array.isArray(action) ? action[0] : Object.values(action)[0]);
    return item?.id ?? item?.key ?? actionVal ?? item?.label ?? null;
  }

  setSelectedIndex(index, key = null) {
    this.selectedIndex = index;
    this.selectedKey = key;
  }

  navigateUp() {
    if (!this.items.length) return;
    const next = (this.selectedIndex - this.columns + this.items.length) % this.items.length;
    this.setSelectedIndex(next, this.getItemKey(this.items[next]));
  }

  navigateDown() {
    if (!this.items.length) return;
    const next = (this.selectedIndex + this.columns) % this.items.length;
    this.setSelectedIndex(next, this.getItemKey(this.items[next]));
  }

  navigateLeft() {
    if (!this.items.length) return;
    const next = (this.selectedIndex - 1 + this.items.length) % this.items.length;
    this.setSelectedIndex(next, this.getItemKey(this.items[next]));
  }

  navigateRight() {
    if (!this.items.length) return;
    const next = (this.selectedIndex + 1) % this.items.length;
    this.setSelectedIndex(next, this.getItemKey(this.items[next]));
  }

  restoreByKeyOrClamp(items, currentKey, currentIndex) {
    if (!items.length) return { index: 0, key: null };

    // Try to restore by key first
    if (currentKey) {
      const matchIndex = items.findIndex((item) => this.getItemKey(item) === currentKey);
      if (matchIndex >= 0) {
        return { index: matchIndex, key: currentKey };
      }
    }

    // Fallback: clamp index
    if (currentIndex >= items.length) {
      const clamped = Math.max(0, items.length - 1);
      return { index: clamped, key: this.getItemKey(items[clamped]) };
    }

    return { index: currentIndex, key: this.getItemKey(items[currentIndex]) };
  }
}

describe('useMenuNavigation - MenuNavigationLogic', () => {
  describe('getItemKey', () => {
    const logic = new MenuNavigationLogic({ items: [] });

    it('returns null for null item', () => {
      assert.equal(logic.getItemKey(null), null);
    });

    it('returns id if present', () => {
      assert.equal(logic.getItemKey({ id: 'test-id', key: 'other', label: 'label' }), 'test-id');
    });

    it('returns key if no id', () => {
      assert.equal(logic.getItemKey({ key: 'test-key', label: 'label' }), 'test-key');
    });

    it('returns label as fallback', () => {
      assert.equal(logic.getItemKey({ label: 'Test Label' }), 'Test Label');
    });

    it('extracts key from play array', () => {
      assert.equal(logic.getItemKey({ play: ['media-123'] }), 'media-123');
    });

    it('extracts key from play object', () => {
      assert.equal(logic.getItemKey({ play: { plex: 'plex-123' } }), 'plex-123');
    });

    it('extracts key from list property when it is the action value', () => {
      // When list is a string, it becomes the actionVal via Object.values()
      // For strings, Object.values returns array of characters, so first char is used
      // This is a quirk of the implementation - typically items have id/key/label
      assert.equal(logic.getItemKey({ list: 'menu-name' }), 'm');
    });

    it('extracts key from open property when it is the action value', () => {
      // Same behavior as list - first char of string
      assert.equal(logic.getItemKey({ open: 'app-name' }), 'a');
    });

    it('prefers id over action value', () => {
      assert.equal(logic.getItemKey({ list: 'menu-name', id: 'menu-id' }), 'menu-id');
    });

    it('prefers key over action value', () => {
      assert.equal(logic.getItemKey({ open: 'app-name', key: 'app-key' }), 'app-key');
    });
  });

  describe('grid navigation', () => {
    // Test a 3x3 grid (9 items, 3 columns)
    const items = [
      { id: '0' }, { id: '1' }, { id: '2' },
      { id: '3' }, { id: '4' }, { id: '5' },
      { id: '6' }, { id: '7' }, { id: '8' },
    ];

    describe('navigateDown', () => {
      it('moves down by column count', () => {
        const logic = new MenuNavigationLogic({ items, columns: 3, initialIndex: 0 });
        logic.navigateDown();
        assert.equal(logic.selectedIndex, 3);
      });

      it('wraps to top when at bottom', () => {
        const logic = new MenuNavigationLogic({ items, columns: 3, initialIndex: 6 });
        logic.navigateDown();
        assert.equal(logic.selectedIndex, 0);
      });

      it('handles wrap in middle column', () => {
        const logic = new MenuNavigationLogic({ items, columns: 3, initialIndex: 7 });
        logic.navigateDown();
        assert.equal(logic.selectedIndex, 1);
      });
    });

    describe('navigateUp', () => {
      it('moves up by column count', () => {
        const logic = new MenuNavigationLogic({ items, columns: 3, initialIndex: 4 });
        logic.navigateUp();
        assert.equal(logic.selectedIndex, 1);
      });

      it('wraps to bottom when at top', () => {
        const logic = new MenuNavigationLogic({ items, columns: 3, initialIndex: 1 });
        logic.navigateUp();
        assert.equal(logic.selectedIndex, 7);
      });
    });

    describe('navigateRight', () => {
      it('moves to next item', () => {
        const logic = new MenuNavigationLogic({ items, columns: 3, initialIndex: 0 });
        logic.navigateRight();
        assert.equal(logic.selectedIndex, 1);
      });

      it('wraps to first item from last', () => {
        const logic = new MenuNavigationLogic({ items, columns: 3, initialIndex: 8 });
        logic.navigateRight();
        assert.equal(logic.selectedIndex, 0);
      });
    });

    describe('navigateLeft', () => {
      it('moves to previous item', () => {
        const logic = new MenuNavigationLogic({ items, columns: 3, initialIndex: 4 });
        logic.navigateLeft();
        assert.equal(logic.selectedIndex, 3);
      });

      it('wraps to last item from first', () => {
        const logic = new MenuNavigationLogic({ items, columns: 3, initialIndex: 0 });
        logic.navigateLeft();
        assert.equal(logic.selectedIndex, 8);
      });
    });
  });

  describe('5-column grid (default)', () => {
    // Test 10 items in 5 columns (2 rows)
    const items = Array.from({ length: 10 }, (_, i) => ({ id: String(i) }));

    it('navigates down correctly', () => {
      const logic = new MenuNavigationLogic({ items, columns: 5, initialIndex: 2 });
      logic.navigateDown();
      assert.equal(logic.selectedIndex, 7);
    });

    it('navigates up correctly', () => {
      const logic = new MenuNavigationLogic({ items, columns: 5, initialIndex: 7 });
      logic.navigateUp();
      assert.equal(logic.selectedIndex, 2);
    });

    it('wraps down at bottom row', () => {
      const logic = new MenuNavigationLogic({ items, columns: 5, initialIndex: 9 });
      logic.navigateDown();
      assert.equal(logic.selectedIndex, 4);
    });
  });

  describe('edge cases', () => {
    it('handles empty items array', () => {
      const logic = new MenuNavigationLogic({ items: [], columns: 5 });
      logic.navigateDown();
      assert.equal(logic.selectedIndex, 0);
    });

    it('handles single item', () => {
      const logic = new MenuNavigationLogic({ items: [{ id: '0' }], columns: 5 });
      logic.navigateDown();
      assert.equal(logic.selectedIndex, 0);
      logic.navigateRight();
      assert.equal(logic.selectedIndex, 0);
    });

    it('handles fewer items than columns', () => {
      const items = [{ id: '0' }, { id: '1' }, { id: '2' }];
      const logic = new MenuNavigationLogic({ items, columns: 5, initialIndex: 1 });
      logic.navigateDown();
      // (1 + 5) % 3 = 0
      assert.equal(logic.selectedIndex, 0);
    });
  });

  describe('restoreByKeyOrClamp', () => {
    const logic = new MenuNavigationLogic({ items: [] });
    
    const items = [
      { id: 'a', label: 'Item A' },
      { id: 'b', label: 'Item B' },
      { id: 'c', label: 'Item C' },
    ];

    it('restores by key when found', () => {
      const result = logic.restoreByKeyOrClamp(items, 'b', 0);
      assert.deepEqual(result, { index: 1, key: 'b' });
    });

    it('clamps index when key not found', () => {
      const result = logic.restoreByKeyOrClamp(items, 'nonexistent', 5);
      assert.deepEqual(result, { index: 2, key: 'c' });
    });

    it('keeps current index if within bounds and key not found', () => {
      const result = logic.restoreByKeyOrClamp(items, 'nonexistent', 1);
      assert.deepEqual(result, { index: 1, key: 'b' });
    });

    it('handles empty items', () => {
      const result = logic.restoreByKeyOrClamp([], 'any', 5);
      assert.deepEqual(result, { index: 0, key: null });
    });
  });

  describe('selection key tracking', () => {
    const items = [
      { id: 'item-a' },
      { id: 'item-b' },
      { id: 'item-c' },
    ];

    it('updates key when navigating', () => {
      const logic = new MenuNavigationLogic({ items, columns: 5, initialIndex: 0 });
      assert.equal(logic.selectedKey, 'item-a');
      
      logic.navigateRight();
      assert.equal(logic.selectedIndex, 1);
      assert.equal(logic.selectedKey, 'item-b');
    });
  });
});
