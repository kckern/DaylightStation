import { describe, it, expect } from 'vitest';

/**
 * Tests for the queue API audio propagation pattern.
 *
 * The queue API (`/api/v1/queue/:name`) returns `{ items: [...], audio?: { ... } }`.
 * useQueueController must capture both `items` and `audio` from the response.
 * These tests verify the destructuring / extraction logic without rendering
 * React hooks (pure data-shape tests).
 */

describe('queue API response audio extraction', () => {

  // ── Simulates the fixed destructuring pattern ─────────────────────
  function extractFromResponse(response) {
    const items = response.items;
    const audio = response.audio || null;
    return { items, audio };
  }

  describe('response with audio config', () => {
    it('captures audio when present in the API response', () => {
      const response = {
        items: [
          { media: 'immich:abc123', seconds: 8, mediaType: 'photo' },
          { media: 'plex:99999', seconds: 30, mediaType: 'video' },
        ],
        audio: { contentId: 'plex:12345', behavior: 'pause', mode: 'hidden' },
      };

      const { items, audio } = extractFromResponse(response);

      expect(items).toHaveLength(2);
      expect(audio).toEqual({ contentId: 'plex:12345', behavior: 'pause', mode: 'hidden' });
    });

    it('captures audio with minimal fields', () => {
      const response = {
        items: [{ media: 'immich:abc' }],
        audio: { contentId: 'plex:111' },
      };

      const { audio } = extractFromResponse(response);
      expect(audio).toEqual({ contentId: 'plex:111' });
    });
  });

  describe('response without audio config', () => {
    it('returns null when audio is absent from the response', () => {
      const response = {
        items: [
          { media: 'immich:abc123', seconds: 8 },
        ],
      };

      const { items, audio } = extractFromResponse(response);

      expect(items).toHaveLength(1);
      expect(audio).toBe(null);
    });

    it('returns null when audio is explicitly undefined', () => {
      const response = {
        items: [],
        audio: undefined,
      };

      const { audio } = extractFromResponse(response);
      expect(audio).toBe(null);
    });

    it('returns null when audio is explicitly null', () => {
      const response = {
        items: [],
        audio: null,
      };

      const { audio } = extractFromResponse(response);
      expect(audio).toBe(null);
    });
  });

  // ── Demonstrates the old broken pattern vs. the fix ───────────────
  describe('old vs new destructuring pattern', () => {
    it('old pattern: destructuring only { items } silently drops audio', () => {
      const response = {
        items: [{ media: 'immich:abc' }],
        audio: { contentId: 'plex:12345', behavior: 'pause', mode: 'hidden' },
      };

      // Old pattern — this is the bug
      const { items } = response;

      expect(items).toHaveLength(1);
      // audio was silently discarded — no variable holds it
    });

    it('new pattern: capturing full response preserves audio', () => {
      const response = {
        items: [{ media: 'immich:abc' }],
        audio: { contentId: 'plex:12345', behavior: 'pause', mode: 'hidden' },
      };

      // New pattern — captures the full response
      const fetchedAudio = response.audio || null;
      const newQueue = response.items;

      expect(newQueue).toHaveLength(1);
      expect(fetchedAudio).toEqual({ contentId: 'plex:12345', behavior: 'pause', mode: 'hidden' });
    });
  });

  // ── audioConfig resolution chain ──────────────────────────────────
  describe('audioConfig resolution chain', () => {
    it('queueAudio is used when play.audio and queue.audio are absent', () => {
      const play = { contentId: 'some-queue' };
      const queue = undefined;
      const queueAudio = { contentId: 'plex:12345', behavior: 'pause', mode: 'hidden' };
      const activeSource = { media: 'immich:abc' };

      const audioConfig = play?.audio || queue?.audio || queueAudio || activeSource?.audio || null;

      expect(audioConfig).toEqual({ contentId: 'plex:12345', behavior: 'pause', mode: 'hidden' });
    });

    it('play.audio takes precedence over queueAudio', () => {
      const play = { audio: { contentId: 'plex:override' } };
      const queueAudio = { contentId: 'plex:12345' };

      const audioConfig = play?.audio || queueAudio || null;

      expect(audioConfig).toEqual({ contentId: 'plex:override' });
    });

    it('returns null when no audio is configured anywhere', () => {
      const play = { contentId: 'some-queue' };
      const queue = undefined;
      const queueAudio = null;
      const activeSource = { media: 'immich:abc' };

      const audioConfig = play?.audio || queue?.audio || queueAudio || activeSource?.audio || null;

      expect(audioConfig).toBe(null);
    });
  });
});
