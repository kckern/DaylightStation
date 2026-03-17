import { describe, it, expect } from 'vitest';
import { shouldEmitTrackChanged } from '../../../../frontend/src/modules/Player/lib/shouldEmitTrackChanged.js';

/**
 * Tests for queue-track-changed emission filtering.
 *
 * The queue controller should not emit track-changed for phantom entries
 * that appear before the queue API response arrives. These have a guid
 * but no title, no mediaType, no media URL — they're placeholders.
 *
 * See: docs/_wip/bugs/2026-03-17-morning-program-spinner-audio-plays.md
 */

describe('shouldEmitTrackChanged', () => {
  describe('phantom entries (should NOT emit)', () => {
    it('rejects entry with only guid', () => {
      expect(shouldEmitTrackChanged({ guid: 'O2ExbkfR8M' })).toBe(false);
    });

    it('rejects null', () => {
      expect(shouldEmitTrackChanged(null)).toBe(false);
    });

    it('rejects entry with guid and empty fields', () => {
      expect(shouldEmitTrackChanged({ guid: 'abc', title: '', mediaType: '' })).toBe(false);
    });
  });

  describe('real entries (should emit)', () => {
    it('allows entry with title', () => {
      expect(shouldEmitTrackChanged({ guid: 'jv2oyqLGRN', title: 'Good Morning' })).toBe(true);
    });

    it('allows entry with mediaType', () => {
      expect(shouldEmitTrackChanged({ guid: 'abc', mediaType: 'video' })).toBe(true);
    });

    it('allows entry with plex', () => {
      expect(shouldEmitTrackChanged({ guid: 'abc', plex: '375839' })).toBe(true);
    });

    it('allows entry with contentId', () => {
      expect(shouldEmitTrackChanged({ guid: 'abc', contentId: 'freshvideo:teded' })).toBe(true);
    });

    it('allows entry with media key', () => {
      expect(shouldEmitTrackChanged({ guid: 'abc', media: 'sfx/intro' })).toBe(true);
    });

    it('allows entry with assetId', () => {
      expect(shouldEmitTrackChanged({ guid: 'abc', assetId: 'files:sfx/intro' })).toBe(true);
    });
  });
});
