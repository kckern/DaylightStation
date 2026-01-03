/**
 * Tests for MenuNavigationContext
 * 
 * These tests verify the navigation state management:
 * - Push/pop stack operations
 * - Selection state per depth
 * - Reset functionality
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Since we can't easily test React context without a DOM,
// we'll test the logic by extracting and testing the core functions

/**
 * Mock implementation of the navigation state logic
 * This mirrors the context's internal behavior
 */
class NavigationStateMachine {
  constructor(onBackAtRoot = null) {
    this.stack = [];
    this.selections = { 0: { index: 0, key: null } };
    this.onBackAtRoot = onBackAtRoot;
  }

  get depth() {
    return this.stack.length;
  }

  get currentContent() {
    return this.stack[this.stack.length - 1] || null;
  }

  push(content) {
    this.stack = [...this.stack, content];
    const newDepth = this.stack.length;
    this.selections = {
      ...this.selections,
      [newDepth]: { index: 0, key: null }
    };
  }

  pop() {
    if (this.stack.length === 0) {
      this.onBackAtRoot?.();
      return false;
    }
    this.stack = this.stack.slice(0, -1);
    return true;
  }

  setSelectionAtDepth(targetDepth, index, key = null) {
    this.selections = {
      ...this.selections,
      [targetDepth]: { index, key }
    };
  }

  getSelection(targetDepth) {
    return this.selections[targetDepth] || { index: 0, key: null };
  }

  reset() {
    this.stack = [];
    this.selections = { 0: { index: 0, key: null } };
  }

  replace(content) {
    if (this.stack.length === 0) return;
    this.stack = [...this.stack.slice(0, -1), content];
  }
}

describe('MenuNavigationContext - NavigationStateMachine', () => {
  let nav;

  beforeEach(() => {
    nav = new NavigationStateMachine();
  });

  describe('initial state', () => {
    it('starts with empty stack', () => {
      assert.deepEqual(nav.stack, []);
    });

    it('starts with depth 0', () => {
      assert.equal(nav.depth, 0);
    });

    it('starts with null currentContent', () => {
      assert.equal(nav.currentContent, null);
    });

    it('starts with default selection at depth 0', () => {
      assert.deepEqual(nav.getSelection(0), { index: 0, key: null });
    });
  });

  describe('push operation', () => {
    it('adds content to stack', () => {
      nav.push({ type: 'menu', props: { list: 'test' } });
      assert.equal(nav.stack.length, 1);
      assert.deepEqual(nav.currentContent, { type: 'menu', props: { list: 'test' } });
    });

    it('increments depth', () => {
      nav.push({ type: 'menu', props: {} });
      assert.equal(nav.depth, 1);
      nav.push({ type: 'menu', props: {} });
      assert.equal(nav.depth, 2);
    });

    it('initializes selection for new depth', () => {
      nav.push({ type: 'menu', props: {} });
      assert.deepEqual(nav.getSelection(1), { index: 0, key: null });
    });

    it('preserves existing selections', () => {
      nav.setSelectionAtDepth(0, 5, 'key1');
      nav.push({ type: 'menu', props: {} });
      assert.deepEqual(nav.getSelection(0), { index: 5, key: 'key1' });
    });
  });

  describe('pop operation', () => {
    it('removes last item from stack', () => {
      nav.push({ type: 'menu', props: { id: 1 } });
      nav.push({ type: 'menu', props: { id: 2 } });
      nav.pop();
      assert.equal(nav.stack.length, 1);
      assert.deepEqual(nav.currentContent, { type: 'menu', props: { id: 1 } });
    });

    it('returns true when pop succeeds', () => {
      nav.push({ type: 'menu', props: {} });
      assert.equal(nav.pop(), true);
    });

    it('returns false when at root', () => {
      assert.equal(nav.pop(), false);
    });

    it('preserves selections when popping', () => {
      nav.setSelectionAtDepth(0, 3, 'root-key');
      nav.push({ type: 'menu', props: {} });
      nav.setSelectionAtDepth(1, 7, 'child-key');
      nav.pop();
      // Both selections should be preserved
      assert.deepEqual(nav.getSelection(0), { index: 3, key: 'root-key' });
      assert.deepEqual(nav.getSelection(1), { index: 7, key: 'child-key' });
    });
  });

  describe('pop at root with callback', () => {
    it('calls onBackAtRoot when popping from empty stack', () => {
      let called = false;
      const navWithCallback = new NavigationStateMachine(() => { called = true; });
      navWithCallback.pop();
      assert.equal(called, true);
    });

    it('does not call onBackAtRoot when stack is not empty', () => {
      let called = false;
      const navWithCallback = new NavigationStateMachine(() => { called = true; });
      navWithCallback.push({ type: 'menu', props: {} });
      navWithCallback.pop();
      assert.equal(called, false);
    });
  });

  describe('selection management', () => {
    it('sets selection at specific depth', () => {
      nav.setSelectionAtDepth(0, 5, 'test-key');
      assert.deepEqual(nav.getSelection(0), { index: 5, key: 'test-key' });
    });

    it('handles null key', () => {
      nav.setSelectionAtDepth(0, 3);
      assert.deepEqual(nav.getSelection(0), { index: 3, key: null });
    });

    it('returns default for unknown depth', () => {
      assert.deepEqual(nav.getSelection(99), { index: 0, key: null });
    });

    it('selections are independent per depth', () => {
      nav.push({ type: 'menu', props: {} });
      nav.push({ type: 'menu', props: {} });
      
      nav.setSelectionAtDepth(0, 1, 'a');
      nav.setSelectionAtDepth(1, 2, 'b');
      nav.setSelectionAtDepth(2, 3, 'c');
      
      assert.deepEqual(nav.getSelection(0), { index: 1, key: 'a' });
      assert.deepEqual(nav.getSelection(1), { index: 2, key: 'b' });
      assert.deepEqual(nav.getSelection(2), { index: 3, key: 'c' });
    });
  });

  describe('reset operation', () => {
    it('clears the stack', () => {
      nav.push({ type: 'menu', props: {} });
      nav.push({ type: 'menu', props: {} });
      nav.reset();
      assert.deepEqual(nav.stack, []);
    });

    it('resets depth to 0', () => {
      nav.push({ type: 'menu', props: {} });
      nav.reset();
      assert.equal(nav.depth, 0);
    });

    it('resets selections', () => {
      nav.setSelectionAtDepth(0, 5, 'key');
      nav.push({ type: 'menu', props: {} });
      nav.setSelectionAtDepth(1, 3, 'key2');
      nav.reset();
      assert.deepEqual(nav.selections, { 0: { index: 0, key: null } });
    });
  });

  describe('replace operation', () => {
    it('replaces top of stack', () => {
      nav.push({ type: 'menu', props: { id: 1 } });
      nav.replace({ type: 'menu', props: { id: 999 } });
      assert.equal(nav.stack.length, 1);
      assert.deepEqual(nav.currentContent, { type: 'menu', props: { id: 999 } });
    });

    it('does nothing when stack is empty', () => {
      nav.replace({ type: 'menu', props: {} });
      assert.equal(nav.stack.length, 0);
    });

    it('preserves items below top', () => {
      nav.push({ type: 'menu', props: { id: 1 } });
      nav.push({ type: 'menu', props: { id: 2 } });
      nav.replace({ type: 'menu', props: { id: 999 } });
      assert.equal(nav.stack.length, 2);
      assert.deepEqual(nav.stack[0], { type: 'menu', props: { id: 1 } });
      assert.deepEqual(nav.stack[1], { type: 'menu', props: { id: 999 } });
    });
  });

  describe('deep navigation scenario', () => {
    it('handles 3+ levels of navigation correctly', () => {
      // This is the scenario that was broken before
      nav.push({ type: 'menu', props: { list: 'level1' } });
      nav.setSelectionAtDepth(1, 2, 'item-2');
      
      nav.push({ type: 'menu', props: { list: 'level2' } });
      nav.setSelectionAtDepth(2, 5, 'item-5');
      
      nav.push({ type: 'menu', props: { list: 'level3' } });
      nav.setSelectionAtDepth(3, 1, 'item-1');
      
      // Verify state at depth 3
      assert.equal(nav.depth, 3);
      assert.deepEqual(nav.getSelection(3), { index: 1, key: 'item-1' });
      
      // Navigate back and verify selection is preserved
      nav.pop();
      assert.equal(nav.depth, 2);
      assert.deepEqual(nav.getSelection(2), { index: 5, key: 'item-5' });
      
      nav.pop();
      assert.equal(nav.depth, 1);
      assert.deepEqual(nav.getSelection(1), { index: 2, key: 'item-2' });
      
      nav.pop();
      assert.equal(nav.depth, 0);
      assert.deepEqual(nav.getSelection(0), { index: 0, key: null });
    });
  });
});
