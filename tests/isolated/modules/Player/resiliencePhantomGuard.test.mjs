import { describe, it, expect } from 'vitest';
import { shouldSkipResilienceReload } from '../../../../frontend/src/modules/Player/lib/shouldSkipResilienceReload.js';

/**
 * Tests for shouldSkipResilienceReload — the guard that prevents
 * recovery attempts on phantom/unresolvable queue entries.
 *
 * A phantom entry is one that was created before the queue API
 * responded — it has no title, no mediaType, no media URL.
 * Attempting to remount for such an entry always fails and can
 * destroy working playback in a different track.
 *
 * See: docs/_wip/bugs/2026-03-17-morning-program-spinner-audio-plays.md
 */

describe('shouldSkipResilienceReload', () => {
  describe('phantom entries (should skip)', () => {
    it('skips when activeSource has no identifying properties', () => {
      expect(shouldSkipResilienceReload({
        activeSource: { guid: 'O2ExbkfR8M' },
        playerType: null,
        resolvedMeta: null
      })).toBe(true);
    });

    it('skips when activeSource is null', () => {
      expect(shouldSkipResilienceReload({
        activeSource: null,
        playerType: null,
        resolvedMeta: null
      })).toBe(true);
    });

    it('skips when resolvedMeta exists but has no media info', () => {
      expect(shouldSkipResilienceReload({
        activeSource: { guid: 'phantom123' },
        playerType: null,
        resolvedMeta: { title: 'Loading...' }
      })).toBe(true);
    });
  });

  describe('real entries (should NOT skip)', () => {
    it('allows recovery when playerType is set', () => {
      expect(shouldSkipResilienceReload({
        activeSource: { guid: 'abc' },
        playerType: 'video',
        resolvedMeta: null
      })).toBe(false);
    });

    it('allows recovery when activeSource has mediaType', () => {
      expect(shouldSkipResilienceReload({
        activeSource: { guid: 'abc', mediaType: 'video' },
        playerType: null,
        resolvedMeta: null
      })).toBe(false);
    });

    it('allows recovery when activeSource has plex ID', () => {
      expect(shouldSkipResilienceReload({
        activeSource: { guid: 'abc', plex: '375839' },
        playerType: null,
        resolvedMeta: null
      })).toBe(false);
    });

    it('allows recovery when activeSource has contentId', () => {
      expect(shouldSkipResilienceReload({
        activeSource: { guid: 'abc', contentId: 'freshvideo:teded' },
        playerType: null,
        resolvedMeta: null
      })).toBe(false);
    });

    it('allows recovery when activeSource has media key', () => {
      expect(shouldSkipResilienceReload({
        activeSource: { guid: 'abc', media: 'sfx/intro' },
        playerType: null,
        resolvedMeta: null
      })).toBe(false);
    });

    it('allows recovery when resolvedMeta has mediaType', () => {
      expect(shouldSkipResilienceReload({
        activeSource: { guid: 'abc' },
        playerType: null,
        resolvedMeta: { mediaType: 'audio' }
      })).toBe(false);
    });

    it('allows recovery when resolvedMeta has mediaUrl', () => {
      expect(shouldSkipResilienceReload({
        activeSource: { guid: 'abc' },
        playerType: null,
        resolvedMeta: { mediaUrl: '/media/video/news/cnn/20260317.mp4' }
      })).toBe(false);
    });

    it('allows recovery when resolvedMeta has plex', () => {
      expect(shouldSkipResilienceReload({
        activeSource: { guid: 'abc' },
        playerType: null,
        resolvedMeta: { plex: '12345' }
      })).toBe(false);
    });
  });
});
