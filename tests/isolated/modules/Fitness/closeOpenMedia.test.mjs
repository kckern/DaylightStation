import { describe, it, expect } from 'vitest';
import { findUnclosedMedia } from '#frontend/hooks/fitness/closeOpenMedia.js';

describe('findUnclosedMedia', () => {

  // ── Empty / trivial input ──────────────────────────────────────────
  describe('empty input', () => {
    it('returns empty array for an empty event list', () => {
      expect(findUnclosedMedia([])).toEqual([]);
    });
  });

  // ── All media properly closed ──────────────────────────────────────
  describe('all media closed', () => {
    it('returns empty when every media_start has a matching media_end', () => {
      const events = [
        { type: 'media_start', data: { contentId: 'plex:100' } },
        { type: 'media_end',   data: { contentId: 'plex:100' } },
      ];
      expect(findUnclosedMedia(events)).toEqual([]);
    });

    it('returns empty for multiple start/end pairs', () => {
      const events = [
        { type: 'media_start', data: { contentId: 'plex:100' } },
        { type: 'media_start', data: { contentId: 'plex:200' } },
        { type: 'media_end',   data: { contentId: 'plex:100' } },
        { type: 'media_end',   data: { contentId: 'plex:200' } },
      ];
      expect(findUnclosedMedia(events)).toEqual([]);
    });
  });

  // ── Unclosed media detected ────────────────────────────────────────
  describe('unclosed media', () => {
    it('returns contentId when media_start has no matching media_end', () => {
      const events = [
        { type: 'media_start', data: { contentId: 'plex:100' } },
      ];
      expect(findUnclosedMedia(events)).toEqual(['plex:100']);
    });

    it('returns multiple unclosed contentIds', () => {
      const events = [
        { type: 'media_start', data: { contentId: 'plex:100' } },
        { type: 'media_start', data: { contentId: 'plex:200' } },
        { type: 'media_start', data: { contentId: 'plex:300' } },
      ];
      const result = findUnclosedMedia(events);
      expect(result).toHaveLength(3);
      expect(result).toContain('plex:100');
      expect(result).toContain('plex:200');
      expect(result).toContain('plex:300');
    });

    it('returns only the unclosed ones when some are closed', () => {
      const events = [
        { type: 'media_start', data: { contentId: 'plex:100' } },
        { type: 'media_start', data: { contentId: 'plex:200' } },
        { type: 'media_end',   data: { contentId: 'plex:100' } },
      ];
      expect(findUnclosedMedia(events)).toEqual(['plex:200']);
    });
  });

  // ── Pairing by contentId ───────────────────────────────────────────
  describe('pairing by contentId', () => {
    it('media_end closes the correct media_start by contentId', () => {
      const events = [
        { type: 'media_start', data: { contentId: 'plex:100' } },
        { type: 'media_start', data: { contentId: 'plex:200' } },
        { type: 'media_end',   data: { contentId: 'plex:200' } },
      ];
      expect(findUnclosedMedia(events)).toEqual(['plex:100']);
    });
  });

  // ── Re-opened media ────────────────────────────────────────────────
  describe('re-opened media', () => {
    it('returns contentId when media is started, ended, then started again', () => {
      const events = [
        { type: 'media_start', data: { contentId: 'plex:100' } },
        { type: 'media_end',   data: { contentId: 'plex:100' } },
        { type: 'media_start', data: { contentId: 'plex:100' } },
      ];
      expect(findUnclosedMedia(events)).toEqual(['plex:100']);
    });

    it('returns empty when re-opened media is closed again', () => {
      const events = [
        { type: 'media_start', data: { contentId: 'plex:100' } },
        { type: 'media_end',   data: { contentId: 'plex:100' } },
        { type: 'media_start', data: { contentId: 'plex:100' } },
        { type: 'media_end',   data: { contentId: 'plex:100' } },
      ];
      expect(findUnclosedMedia(events)).toEqual([]);
    });
  });

  // ── Events without contentId ───────────────────────────────────────
  describe('events without contentId', () => {
    it('skips events where data.contentId is undefined', () => {
      const events = [
        { type: 'media_start', data: {} },
        { type: 'media_start', data: { contentId: 'plex:100' } },
      ];
      expect(findUnclosedMedia(events)).toEqual(['plex:100']);
    });

    it('skips events with null data', () => {
      const events = [
        { type: 'media_start', data: null },
        { type: 'media_start', data: { contentId: 'plex:100' } },
      ];
      expect(findUnclosedMedia(events)).toEqual(['plex:100']);
    });

    it('skips events with no data property at all', () => {
      const events = [
        { type: 'media_start' },
        { type: 'media_start', data: { contentId: 'plex:100' } },
      ];
      expect(findUnclosedMedia(events)).toEqual(['plex:100']);
    });
  });

  // ── Non-media event types ──────────────────────────────────────────
  describe('non-media event types', () => {
    it('ignores tick events', () => {
      const events = [
        { type: 'media_start', data: { contentId: 'plex:100' } },
        { type: 'tick',        data: { contentId: 'plex:100' } },
      ];
      // tick is not media_end, so plex:100 remains unclosed
      expect(findUnclosedMedia(events)).toEqual(['plex:100']);
    });

    it('ignores arbitrary event types even if they have contentId', () => {
      const events = [
        { type: 'media_start',  data: { contentId: 'plex:100' } },
        { type: 'media_pause',  data: { contentId: 'plex:100' } },
        { type: 'heartbeat',    data: { contentId: 'plex:100' } },
      ];
      expect(findUnclosedMedia(events)).toEqual(['plex:100']);
    });

    it('only media_end closes an open media_start', () => {
      const events = [
        { type: 'media_start', data: { contentId: 'plex:100' } },
        { type: 'media_stop',  data: { contentId: 'plex:100' } },
      ];
      // media_stop is NOT media_end, so it does not close
      expect(findUnclosedMedia(events)).toEqual(['plex:100']);
    });
  });
});
