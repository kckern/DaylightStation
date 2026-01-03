/**
 * Tests for MenuStack component
 * 
 * These tests verify the stack rendering logic:
 * - Root menu rendering
 * - Content type switching
 * - Selection handling
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Mock implementation of the MenuStack logic
 * This tests the content type routing without React dependencies
 */
class MenuStackLogic {
  constructor() {
    this.stack = [];
    this.depth = 0;
    this.pushedContent = [];
  }

  push(content) {
    this.stack.push(content);
    this.depth = this.stack.length;
    this.pushedContent.push(content);
  }

  get currentContent() {
    return this.stack[this.stack.length - 1] || null;
  }

  /**
   * Determines what component type should be rendered
   */
  getComponentType(content) {
    if (!content) return 'root-menu';
    return content.type;
  }

  /**
   * Routes a selection to the appropriate action
   */
  routeSelection(selection) {
    if (!selection) return null;

    if (selection.list || selection.menu) {
      return { type: 'menu', props: selection };
    } else if (selection.play || selection.queue) {
      return { type: 'player', props: selection };
    } else if (selection.open) {
      return { type: 'app', props: selection };
    }
    return null;
  }

  /**
   * Extracts the list prop from content
   */
  getListFromContent(content) {
    if (!content || !content.props) return null;
    return content.props.list || content.props.menu || content.props;
  }

  /**
   * Simulates handleSelect behavior
   */
  handleSelect(selection) {
    const content = this.routeSelection(selection);
    if (content) {
      this.push(content);
    }
    return content;
  }
}

describe('MenuStack - MenuStackLogic', () => {
  let logic;

  beforeEach(() => {
    logic = new MenuStackLogic();
  });

  describe('initial state', () => {
    it('starts with empty stack', () => {
      assert.deepEqual(logic.stack, []);
    });

    it('starts with depth 0', () => {
      assert.equal(logic.depth, 0);
    });

    it('currentContent is null when empty', () => {
      assert.equal(logic.currentContent, null);
    });
  });

  describe('getComponentType', () => {
    it('returns root-menu for null content', () => {
      assert.equal(logic.getComponentType(null), 'root-menu');
    });

    it('returns menu for menu content', () => {
      assert.equal(logic.getComponentType({ type: 'menu', props: {} }), 'menu');
    });

    it('returns player for player content', () => {
      assert.equal(logic.getComponentType({ type: 'player', props: {} }), 'player');
    });

    it('returns app for app content', () => {
      assert.equal(logic.getComponentType({ type: 'app', props: {} }), 'app');
    });
  });

  describe('routeSelection', () => {
    it('returns null for null selection', () => {
      assert.equal(logic.routeSelection(null), null);
    });

    it('routes list selection to menu', () => {
      const result = logic.routeSelection({ list: 'test-list', label: 'Test' });
      assert.deepEqual(result, {
        type: 'menu',
        props: { list: 'test-list', label: 'Test' }
      });
    });

    it('routes menu selection to menu', () => {
      const result = logic.routeSelection({ menu: 'test-menu' });
      assert.deepEqual(result, {
        type: 'menu',
        props: { menu: 'test-menu' }
      });
    });

    it('routes play selection to player', () => {
      const result = logic.routeSelection({ play: { plex: '123' } });
      assert.deepEqual(result, {
        type: 'player',
        props: { play: { plex: '123' } }
      });
    });

    it('routes queue selection to player', () => {
      const result = logic.routeSelection({ queue: ['a', 'b', 'c'] });
      assert.deepEqual(result, {
        type: 'player',
        props: { queue: ['a', 'b', 'c'] }
      });
    });

    it('routes open selection to app', () => {
      const result = logic.routeSelection({ open: 'fitness' });
      assert.deepEqual(result, {
        type: 'app',
        props: { open: 'fitness' }
      });
    });

    it('returns null for unrecognized selection', () => {
      const result = logic.routeSelection({ label: 'just a label' });
      assert.equal(result, null);
    });
  });

  describe('getListFromContent', () => {
    it('returns null for null content', () => {
      assert.equal(logic.getListFromContent(null), null);
    });

    it('extracts list property', () => {
      const content = { type: 'menu', props: { list: 'my-list' } };
      assert.equal(logic.getListFromContent(content), 'my-list');
    });

    it('extracts menu property', () => {
      const content = { type: 'menu', props: { menu: 'my-menu' } };
      assert.equal(logic.getListFromContent(content), 'my-menu');
    });

    it('returns props if no list/menu', () => {
      const props = { custom: 'data' };
      const content = { type: 'menu', props };
      assert.deepEqual(logic.getListFromContent(content), props);
    });
  });

  describe('handleSelect', () => {
    it('pushes menu content to stack', () => {
      logic.handleSelect({ list: 'level1' });
      assert.equal(logic.stack.length, 1);
      assert.deepEqual(logic.currentContent, {
        type: 'menu',
        props: { list: 'level1' }
      });
    });

    it('handles nested menu selections', () => {
      logic.handleSelect({ list: 'level1' });
      logic.handleSelect({ list: 'level2' });
      logic.handleSelect({ list: 'level3' });
      
      assert.equal(logic.stack.length, 3);
      assert.equal(logic.depth, 3);
    });

    it('tracks all pushed content', () => {
      logic.handleSelect({ list: 'a' });
      logic.handleSelect({ play: { plex: 'b' } });
      
      assert.equal(logic.pushedContent.length, 2);
      assert.equal(logic.pushedContent[0].type, 'menu');
      assert.equal(logic.pushedContent[1].type, 'player');
    });

    it('returns null for unroutable selection', () => {
      const result = logic.handleSelect({ label: 'no action' });
      assert.equal(result, null);
      assert.equal(logic.stack.length, 0);
    });
  });

  describe('navigation scenario', () => {
    it('simulates multi-level menu navigation', () => {
      // Start at root (depth 0)
      assert.equal(logic.getComponentType(logic.currentContent), 'root-menu');

      // Select a submenu
      logic.handleSelect({ list: 'movies', label: 'Movies' });
      assert.equal(logic.depth, 1);
      assert.equal(logic.getComponentType(logic.currentContent), 'menu');

      // Select another submenu
      logic.handleSelect({ list: 'action-movies', label: 'Action' });
      assert.equal(logic.depth, 2);

      // Select a movie to play
      logic.handleSelect({ play: { plex: 'movie-123' }, label: 'Die Hard' });
      assert.equal(logic.depth, 3);
      assert.equal(logic.getComponentType(logic.currentContent), 'player');
    });

    it('simulates menu to app transition', () => {
      logic.handleSelect({ list: 'apps', label: 'Apps' });
      assert.equal(logic.getComponentType(logic.currentContent), 'menu');

      logic.handleSelect({ open: 'fitness', label: 'Fitness' });
      assert.equal(logic.getComponentType(logic.currentContent), 'app');
    });
  });
});
