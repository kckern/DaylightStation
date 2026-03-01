import { describe, it, expect } from 'vitest';
import { resolveMediaIdentity, resolveContentId } from '#frontend/modules/Player/utils/mediaIdentity.js';

describe('resolveMediaIdentity', () => {

  // ── Null / undefined handling ─────────────────────────────────────
  describe('null and undefined input', () => {
    it('returns null for null', () => {
      expect(resolveMediaIdentity(null)).toBe(null);
    });

    it('returns null for undefined', () => {
      expect(resolveMediaIdentity(undefined)).toBe(null);
    });

    it('returns null for an empty object (no candidate fields)', () => {
      expect(resolveMediaIdentity({})).toBe(null);
    });

    it('returns null when all candidate fields are null or undefined', () => {
      expect(resolveMediaIdentity({
        assetId: undefined,
        key: null,
        plex: undefined,
        media: null,
        id: undefined,
        guid: null,
        mediaUrl: undefined,
      })).toBe(null);
    });
  });

  // ── Priority order ────────────────────────────────────────────────
  describe('candidate field priority', () => {
    it('prefers assetId over all others', () => {
      expect(resolveMediaIdentity({
        assetId: 'A', key: 'B', plex: 'C', media: 'D', id: 'E', guid: 'F', mediaUrl: 'G',
      })).toBe('A');
    });

    it('prefers key when assetId is absent', () => {
      expect(resolveMediaIdentity({
        key: 'B', plex: 'C', media: 'D', id: 'E', guid: 'F', mediaUrl: 'G',
      })).toBe('B');
    });

    it('prefers plex when assetId and key are absent', () => {
      expect(resolveMediaIdentity({
        plex: 'C', media: 'D', id: 'E', guid: 'F', mediaUrl: 'G',
      })).toBe('C');
    });

    it('prefers media when assetId, key, and plex are absent', () => {
      expect(resolveMediaIdentity({
        media: 'D', id: 'E', guid: 'F', mediaUrl: 'G',
      })).toBe('D');
    });

    it('prefers id when assetId, key, plex, and media are absent', () => {
      expect(resolveMediaIdentity({
        id: 'E', guid: 'F', mediaUrl: 'G',
      })).toBe('E');
    });

    it('prefers guid when only guid and mediaUrl are present', () => {
      expect(resolveMediaIdentity({
        guid: 'F', mediaUrl: 'G',
      })).toBe('F');
    });

    it('falls back to mediaUrl when it is the only field', () => {
      expect(resolveMediaIdentity({ mediaUrl: 'G' })).toBe('G');
    });
  });

  // ── Nullish-coalescing skips null/undefined but not falsy ─────────
  describe('nullish coalescing behaviour', () => {
    it('skips undefined assetId and uses key', () => {
      expect(resolveMediaIdentity({ assetId: undefined, key: '42' })).toBe('42');
    });

    it('skips null assetId and uses key', () => {
      expect(resolveMediaIdentity({ assetId: null, key: '42' })).toBe('42');
    });

    it('does NOT skip zero — returns "0"', () => {
      // ?? does not skip 0; 0 is not null/undefined
      expect(resolveMediaIdentity({ assetId: 0 })).toBe('0');
    });

    it('does NOT skip empty string — returns ""', () => {
      expect(resolveMediaIdentity({ assetId: '' })).toBe('');
    });

    it('does NOT skip false — returns "false"', () => {
      expect(resolveMediaIdentity({ assetId: false })).toBe('false');
    });
  });

  // ── Type coercion ─────────────────────────────────────────────────
  describe('type coercion to string', () => {
    it('converts numeric ID to string', () => {
      expect(resolveMediaIdentity({ id: 649319 })).toBe('649319');
    });

    it('converts numeric assetId to string', () => {
      expect(resolveMediaIdentity({ assetId: 12345 })).toBe('12345');
    });

    it('keeps string values unchanged', () => {
      expect(resolveMediaIdentity({ key: '/library/metadata/42' })).toBe('/library/metadata/42');
    });

    it('converts boolean to string', () => {
      expect(resolveMediaIdentity({ id: true })).toBe('true');
    });
  });

  // ── Non-candidate fields ignored ──────────────────────────────────
  describe('non-candidate fields', () => {
    it('ignores fields that are not in the candidate list', () => {
      expect(resolveMediaIdentity({ title: 'Workout', duration: 1800 })).toBe(null);
    });
  });
});


describe('resolveContentId', () => {

  // ── Null / undefined handling ─────────────────────────────────────
  describe('null and undefined input', () => {
    it('returns null for null', () => {
      expect(resolveContentId(null)).toBe(null);
    });

    it('returns null for undefined', () => {
      expect(resolveContentId(undefined)).toBe(null);
    });

    it('returns null when no identity can be resolved', () => {
      expect(resolveContentId({})).toBe(null);
    });
  });

  // ── Already-namespaced IDs ────────────────────────────────────────
  describe('already-namespaced IDs returned as-is', () => {
    it('returns an already-namespaced ID unchanged', () => {
      expect(resolveContentId({ id: 'plex:649319' })).toBe('plex:649319');
    });

    it('preserves non-plex namespaces', () => {
      expect(resolveContentId({ id: 'youtube:abc123' })).toBe('youtube:abc123');
    });

    it('preserves IDs with multiple colons', () => {
      expect(resolveContentId({ guid: 'com.plexapp.agents.imdb://tt1234567' })).toBe('com.plexapp.agents.imdb://tt1234567');
    });

    it('preserves plex library key paths with colons', () => {
      expect(resolveContentId({ assetId: 'plex:/library/metadata/42' })).toBe('plex:/library/metadata/42');
    });
  });

  // ── Source prefix from explicit source field ──────────────────────
  describe('explicit source field', () => {
    it('uses the explicit source field when provided', () => {
      expect(resolveContentId({ id: '12345', source: 'youtube' })).toBe('youtube:12345');
    });

    it('uses explicit source even when plex-related fields are present', () => {
      expect(resolveContentId({ plex: '9999', source: 'custom' })).toBe('custom:9999');
    });
  });

  // ── Source inference from metadata fields ──────────────────────────
  describe('source inference', () => {
    it('infers plex from plex field', () => {
      expect(resolveContentId({ plex: '649319' })).toBe('plex:649319');
    });

    it('infers plex from assetId field', () => {
      expect(resolveContentId({ assetId: '12345' })).toBe('plex:12345');
    });

    it('infers plex from key field', () => {
      expect(resolveContentId({ key: '42' })).toBe('plex:42');
    });

    it('defaults to plex when no source can be inferred', () => {
      expect(resolveContentId({ id: '99' })).toBe('plex:99');
    });

    it('defaults to plex for guid-only metadata', () => {
      expect(resolveContentId({ guid: '77' })).toBe('plex:77');
    });

    it('defaults to plex for mediaUrl-only metadata', () => {
      expect(resolveContentId({ mediaUrl: '55' })).toBe('plex:55');
    });
  });

  // ── Numeric IDs ───────────────────────────────────────────────────
  describe('numeric ID handling', () => {
    it('converts numeric id to string in the result', () => {
      expect(resolveContentId({ id: 649319 })).toBe('plex:649319');
    });

    it('converts numeric assetId to string in the result', () => {
      expect(resolveContentId({ assetId: 12345 })).toBe('plex:12345');
    });
  });

  // ── Source priority ───────────────────────────────────────────────
  describe('source resolution priority', () => {
    it('explicit source takes precedence over plex inference', () => {
      expect(resolveContentId({ id: '1', source: 'immich', plex: '2' })).toBe('immich:2');
    });

    it('plex field inference takes precedence over assetId inference', () => {
      // Both plex and assetId present; resolveMediaIdentity picks assetId (higher priority)
      // but source inference picks plex field first
      const result = resolveContentId({ assetId: '100', plex: '200' });
      // assetId wins for the ID value (via resolveMediaIdentity priority)
      // source inference: metadata?.source is falsy, metadata?.plex != null -> 'plex'
      expect(result).toBe('plex:100');
    });
  });
});
