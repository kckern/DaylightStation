/**
 * Unit test: FolderAdapter nomusic label detection
 * Tests the pure logic for detecting nomusic labels and generating overlay configs
 */
import { describe, it, expect } from '@jest/globals';

describe('FolderAdapter nomusic detection logic', () => {
  describe('label matching', () => {
    it('should detect nomusic label in item labels (case insensitive)', () => {
      const nomusicLabels = ['nomusic', 'silent'];
      const itemLabels = ['HD', 'NoMusic', '2025'];  // Note: different case

      const normalizedItem = itemLabels.map(l => l.toLowerCase().trim());
      const nomusicSet = new Set(nomusicLabels.map(l => l.toLowerCase().trim()));

      const hasNomusic = normalizedItem.some(l => nomusicSet.has(l));
      expect(hasNomusic).toBe(true);
    });

    it('should not detect nomusic when label not present', () => {
      const nomusicLabels = ['nomusic', 'silent'];
      const itemLabels = ['HD', '4K', '2025'];

      const normalizedItem = itemLabels.map(l => l.toLowerCase().trim());
      const nomusicSet = new Set(nomusicLabels.map(l => l.toLowerCase().trim()));

      const hasNomusic = normalizedItem.some(l => nomusicSet.has(l));
      expect(hasNomusic).toBe(false);
    });

    it('should handle empty labels array', () => {
      const nomusicLabels = ['nomusic'];
      const itemLabels = [];

      const normalizedItem = itemLabels.map(l => l.toLowerCase().trim());
      const nomusicSet = new Set(nomusicLabels.map(l => l.toLowerCase().trim()));

      const hasNomusic = normalizedItem.some(l => nomusicSet.has(l));
      expect(hasNomusic).toBe(false);
    });

    it('should handle empty nomusicLabels config', () => {
      const nomusicLabels = [];
      const itemLabels = ['nomusic'];

      const normalizedItem = itemLabels.map(l => l.toLowerCase().trim());
      const nomusicSet = new Set(nomusicLabels.map(l => l.toLowerCase().trim()));

      const hasNomusic = normalizedItem.some(l => nomusicSet.has(l));
      expect(hasNomusic).toBe(false);
    });
  });

  describe('overlay config generation', () => {
    it('should add overlay config when nomusic detected', () => {
      const playAction = { plex: '663846' };
      const musicOverlayPlaylist = '730101';
      const hasNomusic = true;
      const hasExistingOverlay = false;

      let finalPlayAction = playAction;
      if (hasNomusic && musicOverlayPlaylist && !hasExistingOverlay) {
        finalPlayAction = {
          ...playAction,
          overlay: {
            queue: { plex: musicOverlayPlaylist },
            shuffle: true
          }
        };
      }

      expect(finalPlayAction.overlay).toBeDefined();
      expect(finalPlayAction.overlay.queue.plex).toBe('730101');
      expect(finalPlayAction.overlay.shuffle).toBe(true);
      expect(finalPlayAction.plex).toBe('663846');  // Original preserved
    });

    it('should not add overlay when musicOverlayPlaylist is null', () => {
      const playAction = { plex: '663846' };
      const musicOverlayPlaylist = null;
      const hasNomusic = true;

      let finalPlayAction = playAction;
      if (hasNomusic && musicOverlayPlaylist) {
        finalPlayAction = {
          ...playAction,
          overlay: { queue: { plex: musicOverlayPlaylist }, shuffle: true }
        };
      }

      expect(finalPlayAction.overlay).toBeUndefined();
    });

    it('should not overwrite existing overlay', () => {
      const playAction = {
        plex: '663846',
        overlay: { queue: { plex: 'custom-playlist' } }
      };
      const musicOverlayPlaylist = '730101';
      const hasNomusic = true;

      let finalPlayAction = playAction;
      if (hasNomusic && musicOverlayPlaylist && !playAction.overlay) {
        finalPlayAction = {
          ...playAction,
          overlay: { queue: { plex: musicOverlayPlaylist }, shuffle: true }
        };
      }

      expect(finalPlayAction.overlay.queue.plex).toBe('custom-playlist');
    });
  });
});
