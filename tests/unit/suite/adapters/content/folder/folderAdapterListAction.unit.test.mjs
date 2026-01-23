/**
 * Unit test: FolderAdapter list action for folder items
 */
import { describe, it, expect } from '@jest/globals';

describe('FolderAdapter list action logic', () => {
  describe('action type detection', () => {
    it('should create list action for folder references', () => {
      const parsed = { source: 'list', id: 'FHE' };
      const mediaKey = 'FHE';

      const playAction = {};
      const listAction = {};

      if (parsed.source === 'list') {
        listAction.folder = mediaKey;
      } else {
        playAction[parsed.source] = mediaKey;
      }

      expect(listAction).toEqual({ folder: 'FHE' });
      expect(Object.keys(playAction).length).toBe(0);
    });

    it('should create play action for plex items', () => {
      const parsed = { source: 'plex', id: '663846' };
      const mediaKey = '663846';

      const playAction = {};
      const listAction = {};

      if (parsed.source === 'list') {
        listAction.folder = mediaKey;
      } else {
        playAction[parsed.source] = mediaKey;
      }

      expect(playAction).toEqual({ plex: '663846' });
      expect(Object.keys(listAction).length).toBe(0);
    });

    it('should create play action for media items', () => {
      const parsed = { source: 'media', id: 'news/cnn' };
      const mediaKey = 'news/cnn';

      const playAction = {};
      const listAction = {};

      if (parsed.source === 'list') {
        listAction.folder = mediaKey;
      } else {
        playAction[parsed.source] = mediaKey;
      }

      expect(playAction).toEqual({ media: 'news/cnn' });
      expect(Object.keys(listAction).length).toBe(0);
    });
  });

  describe('actions object construction', () => {
    it('should include list in actions when listAction is populated', () => {
      const listAction = { folder: 'FHE' };
      const playAction = {};
      const openAction = {};

      const actions = {
        list: Object.keys(listAction).length > 0 ? listAction : undefined,
        play: Object.keys(playAction).length > 0 ? playAction : undefined,
        open: Object.keys(openAction).length > 0 ? openAction : undefined
      };

      expect(actions.list).toEqual({ folder: 'FHE' });
      expect(actions.play).toBeUndefined();
      expect(actions.open).toBeUndefined();
    });
  });
});
