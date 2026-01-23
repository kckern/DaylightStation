/**
 * Unit test: FolderAdapter action field logic
 *
 * Tests the new action-based logic where:
 * - action: 'Queue' → queueAction = { source: id, shuffle?, continuous? }
 * - action: 'List' → listAction = { source: id }
 * - action: 'Play' (or undefined) → playAction = { source: id }
 */
import { describe, it, expect } from '@jest/globals';

/**
 * Simulates the action logic from FolderAdapter lines 317-351
 */
function buildActions(item, parsed) {
  const playAction = {};
  const openAction = {};
  const listAction = {};
  const queueAction = {};

  // Determine action type from YAML (default to Play)
  const actionType = (item.action || 'Play').toLowerCase();

  // Build the base action object with source and key
  const baseAction = {};
  const src = item.src || parsed.source;
  const mediaKey = parsed.id;
  baseAction[src] = mediaKey;

  // Add options to action object
  if (item.shuffle) baseAction.shuffle = true;
  if (item.continuous) baseAction.continuous = true;
  if (item.playable !== undefined) baseAction.playable = item.playable;

  // Handle raw YAML overrides first
  if (item.play) {
    Object.assign(playAction, item.play);
  } else if (item.open) {
    Object.assign(openAction, item.open);
  } else if (item.queue) {
    Object.assign(queueAction, item.queue);
  } else if (item.list) {
    Object.assign(listAction, item.list);
  } else if (actionType === 'open' || parsed.source === 'app') {
    // Open action for app launches
    Object.assign(openAction, baseAction);
  } else if (actionType === 'queue') {
    // Queue action for shuffle/continuous playback
    Object.assign(queueAction, baseAction);
  } else if (actionType === 'list') {
    // List action for submenus and collections
    Object.assign(listAction, baseAction);
  } else {
    // Play action (default)
    Object.assign(playAction, baseAction);
  }

  return { playAction, openAction, listAction, queueAction };
}

describe('FolderAdapter action field logic', () => {
  describe('Queue action', () => {
    it('should create queue action when action is Queue', () => {
      const item = { action: 'Queue', shuffle: true };
      const parsed = { source: 'plex', id: '642120' };

      const { queueAction, playAction } = buildActions(item, parsed);

      expect(queueAction).toEqual({ plex: '642120', shuffle: true });
      expect(Object.keys(playAction).length).toBe(0);
    });

    it('should include continuous in queue action', () => {
      const item = { action: 'Queue', shuffle: true, continuous: true };
      const parsed = { source: 'plex', id: '456598' };

      const { queueAction } = buildActions(item, parsed);

      expect(queueAction).toEqual({ plex: '456598', shuffle: true, continuous: true });
    });
  });

  describe('List action', () => {
    it('should create list action when action is List for plex items', () => {
      const item = { action: 'List' };
      const parsed = { source: 'plex', id: '408886' };

      const { listAction, playAction } = buildActions(item, parsed);

      expect(listAction).toEqual({ plex: '408886' });
      expect(Object.keys(playAction).length).toBe(0);
    });

    it('should create list action for folder references', () => {
      const item = { action: 'List' };
      const parsed = { source: 'list', id: 'FHE' };

      const { listAction, playAction } = buildActions(item, parsed);

      expect(listAction).toEqual({ list: 'FHE' });
      expect(Object.keys(playAction).length).toBe(0);
    });
  });

  describe('Play action (default)', () => {
    it('should default to play action when no action field', () => {
      const item = {};
      const parsed = { source: 'talk', id: 'ldsgc202510' };

      const { playAction, queueAction, listAction } = buildActions(item, parsed);

      expect(playAction).toEqual({ talk: 'ldsgc202510' });
      expect(Object.keys(queueAction).length).toBe(0);
      expect(Object.keys(listAction).length).toBe(0);
    });

    it('should create play action for plex items without action field', () => {
      const item = {};
      const parsed = { source: 'plex', id: '663846' };

      const { playAction } = buildActions(item, parsed);

      expect(playAction).toEqual({ plex: '663846' });
    });

    it('should create play action for media items', () => {
      const item = {};
      const parsed = { source: 'media', id: 'news/cnn' };

      const { playAction } = buildActions(item, parsed);

      expect(playAction).toEqual({ media: 'news/cnn' });
    });
  });

  describe('Open action', () => {
    it('should create open action when action is Open', () => {
      const item = { action: 'Open' };
      const parsed = { source: 'plex', id: '12345' };

      const { openAction, playAction } = buildActions(item, parsed);

      expect(openAction).toEqual({ plex: '12345' });
      expect(Object.keys(playAction).length).toBe(0);
    });

    it('should create open action for app sources', () => {
      const item = {};
      const parsed = { source: 'app', id: 'netflix' };

      const { openAction, playAction } = buildActions(item, parsed);

      expect(openAction).toEqual({ app: 'netflix' });
      expect(Object.keys(playAction).length).toBe(0);
    });
  });

  describe('Raw YAML overrides', () => {
    it('should use item.play override if provided', () => {
      const item = { play: { plex: 'custom-id', shuffle: true } };
      const parsed = { source: 'plex', id: '123' };

      const { playAction } = buildActions(item, parsed);

      expect(playAction).toEqual({ plex: 'custom-id', shuffle: true });
    });

    it('should use item.list override if provided', () => {
      const item = { list: { list: 'CustomFolder' } };
      const parsed = { source: 'plex', id: '123' };

      const { listAction, playAction } = buildActions(item, parsed);

      expect(listAction).toEqual({ list: 'CustomFolder' });
      expect(Object.keys(playAction).length).toBe(0);
    });
  });

  describe('Source override via item.src', () => {
    it('should use item.src to override parsed source', () => {
      const item = { src: 'talk' };
      const parsed = { source: 'plex', id: 'ldsgc202510' };

      const { playAction } = buildActions(item, parsed);

      expect(playAction).toEqual({ talk: 'ldsgc202510' });
    });
  });
});
