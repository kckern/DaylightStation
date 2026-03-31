import { describe, it, expect } from 'vitest';
import { ContentExpression } from '#domains/content/ContentExpression.mjs';

describe('ContentExpression', () => {

  // ── fromQuery ──────────────────────────────────────────────────────

  describe('fromQuery', () => {
    it('extracts action + contentId', () => {
      const ce = ContentExpression.fromQuery({ play: 'plex:12345' });
      expect(ce.action).toBe('play');
      expect(ce.contentId).toBe('plex:12345');
    });

    it('extracts screen', () => {
      const ce = ContentExpression.fromQuery({ screen: 'living-room', play: 'plex:99' });
      expect(ce.screen).toBe('living-room');
    });

    it('treats bare-key options (empty string) as boolean true', () => {
      const ce = ContentExpression.fromQuery({ play: 'plex:1', shuffle: '' });
      expect(ce.options.shuffle).toBe(true);
    });

    it('preserves key=value options as strings', () => {
      const ce = ContentExpression.fromQuery({ play: 'plex:1', volume: '80' });
      expect(ce.options.volume).toBe('80');
    });

    it('handles mixed boolean and value options', () => {
      const ce = ContentExpression.fromQuery({ play: 'plex:1', shuffle: '', volume: '80' });
      expect(ce.options.shuffle).toBe(true);
      expect(ce.options.volume).toBe('80');
    });

    it('handles no action (options only)', () => {
      const ce = ContentExpression.fromQuery({ shuffle: 'true' });
      expect(ce.action).toBeNull();
      expect(ce.contentId).toBeNull();
      expect(ce.options.shuffle).toBe('true');
    });

    it('first action key wins when multiple present', () => {
      // Object.entries iteration order matches insertion order
      const ce = ContentExpression.fromQuery({ play: 'plex:1', queue: 'plex:2' });
      expect(ce.action).toBe('play');
      expect(ce.contentId).toBe('plex:1');
    });

    it('treats undefined option values as boolean true', () => {
      const ce = ContentExpression.fromQuery({ play: 'plex:1', repeat: undefined });
      expect(ce.options.repeat).toBe(true);
    });

    it('works for all 6 action types', () => {
      for (const action of ['play', 'queue', 'list', 'open', 'display', 'read']) {
        const ce = ContentExpression.fromQuery({ [action]: 'src:id' });
        expect(ce.action).toBe(action);
        expect(ce.contentId).toBe('src:id');
      }
    });

    it('ignores action keys with empty/null/true values', () => {
      const ce = ContentExpression.fromQuery({ play: '', queue: 'plex:5' });
      expect(ce.action).toBe('queue');
      expect(ce.contentId).toBe('plex:5');
    });

    it('returns empty expression for empty query', () => {
      const ce = ContentExpression.fromQuery({});
      expect(ce.screen).toBeNull();
      expect(ce.action).toBeNull();
      expect(ce.contentId).toBeNull();
      expect(ce.options).toEqual({});
    });

    it('ignores screen when value is empty string', () => {
      const ce = ContentExpression.fromQuery({ screen: '' });
      expect(ce.screen).toBeNull();
    });
  });

  // ── fromString ─────────────────────────────────────────────────────

  describe('fromString', () => {
    it('parses source:id', () => {
      const ce = ContentExpression.fromString('plex:12345');
      expect(ce.contentId).toBe('plex:12345');
      expect(ce.action).toBeNull();
      expect(ce.screen).toBeNull();
    });

    it('parses action:source:id', () => {
      const ce = ContentExpression.fromString('play:plex:12345');
      expect(ce.action).toBe('play');
      expect(ce.contentId).toBe('plex:12345');
      expect(ce.screen).toBeNull();
    });

    it('parses screen:source:id when first segment is not an action', () => {
      const ce = ContentExpression.fromString('living-room:plex:12345');
      expect(ce.screen).toBe('living-room');
      expect(ce.action).toBeNull();
      expect(ce.contentId).toBe('plex:12345');
    });

    it('parses screen:action:source:id', () => {
      const ce = ContentExpression.fromString('living-room:play:plex:12345');
      expect(ce.screen).toBe('living-room');
      expect(ce.action).toBe('play');
      expect(ce.contentId).toBe('plex:12345');
    });

    it('parses options after +', () => {
      const ce = ContentExpression.fromString('play:plex:1+shuffle');
      expect(ce.options.shuffle).toBe(true);
    });

    it('parses key=value options after +', () => {
      const ce = ContentExpression.fromString('play:plex:1+volume=80');
      expect(ce.options.volume).toBe('80');
    });

    it('parses full expression with screen + action + content + options', () => {
      const ce = ContentExpression.fromString('living-room:play:plex:12345+shuffle+volume=80');
      expect(ce.screen).toBe('living-room');
      expect(ce.action).toBe('play');
      expect(ce.contentId).toBe('plex:12345');
      expect(ce.options.shuffle).toBe(true);
      expect(ce.options.volume).toBe('80');
    });

    it('normalizes semicolons to colons', () => {
      const ce = ContentExpression.fromString('play;plex;12345');
      expect(ce.action).toBe('play');
      expect(ce.contentId).toBe('plex:12345');
    });

    it('normalizes spaces to colons', () => {
      const ce = ContentExpression.fromString('play plex 12345');
      expect(ce.action).toBe('play');
      expect(ce.contentId).toBe('plex:12345');
    });

    it('preserves dashes in screen names', () => {
      const ce = ContentExpression.fromString('living-room:plex:99');
      expect(ce.screen).toBe('living-room');
    });

    it('returns empty expression for null input', () => {
      const ce = ContentExpression.fromString(null);
      expect(ce.screen).toBeNull();
      expect(ce.action).toBeNull();
      expect(ce.contentId).toBeNull();
    });

    it('returns empty expression for empty string', () => {
      const ce = ContentExpression.fromString('');
      expect(ce.screen).toBeNull();
      expect(ce.action).toBeNull();
      expect(ce.contentId).toBeNull();
    });

    it('handles action-only string (single known action)', () => {
      const ce = ContentExpression.fromString('play');
      expect(ce.action).toBe('play');
      expect(ce.contentId).toBeNull();
    });

    it('accepts custom knownActions set', () => {
      const ce = ContentExpression.fromString('cast:plex:1', ['cast', 'play']);
      expect(ce.action).toBe('cast');
      expect(ce.contentId).toBe('plex:1');
    });

    it('treats unknown first segment as screen with custom actions', () => {
      const ce = ContentExpression.fromString('play:plex:1', ['cast']);
      // 'play' is not in custom actions, so treated as screen
      expect(ce.screen).toBe('play');
      expect(ce.action).toBeNull();
      expect(ce.contentId).toBe('plex:1');
    });

    it('handles multiple + options', () => {
      const ce = ContentExpression.fromString('plex:1+shuffle+repeat+volume=50');
      expect(ce.options.shuffle).toBe(true);
      expect(ce.options.repeat).toBe(true);
      expect(ce.options.volume).toBe('50');
    });
  });

  // ── toString ───────────────────────────────────────────────────────

  describe('toString', () => {
    it('renders full expression', () => {
      const ce = new ContentExpression({
        screen: 'living-room',
        action: 'play',
        contentId: 'plex:12345',
        options: { shuffle: true, volume: '80' },
      });
      expect(ce.toString()).toBe('living-room:play:plex:12345+shuffle+volume=80');
    });

    it('omits screen when null', () => {
      const ce = new ContentExpression({ action: 'play', contentId: 'plex:1', options: {} });
      expect(ce.toString()).toBe('play:plex:1');
    });

    it('renders bare content reference', () => {
      const ce = new ContentExpression({ contentId: 'plex:99', options: {} });
      expect(ce.toString()).toBe('plex:99');
    });

    it('renders empty string when all null', () => {
      const ce = new ContentExpression({});
      expect(ce.toString()).toBe('');
    });

    it('omits options with null/empty values', () => {
      const ce = new ContentExpression({
        action: 'play',
        contentId: 'plex:1',
        options: { keep: true, drop: null, empty: '' },
      });
      expect(ce.toString()).toBe('play:plex:1+keep');
    });
  });

  // ── toQuery ────────────────────────────────────────────────────────

  describe('toQuery', () => {
    it('builds full query', () => {
      const ce = new ContentExpression({
        screen: 'living-room',
        action: 'play',
        contentId: 'plex:12345',
        options: { shuffle: true, volume: '80' },
      });
      expect(ce.toQuery()).toEqual({
        screen: 'living-room',
        play: 'plex:12345',
        shuffle: '',
        volume: '80',
      });
    });

    it('omits screen when null', () => {
      const ce = new ContentExpression({ action: 'play', contentId: 'plex:1', options: {} });
      const q = ce.toQuery();
      expect(q).toEqual({ play: 'plex:1' });
      expect(q).not.toHaveProperty('screen');
    });

    it('omits action when null', () => {
      const ce = new ContentExpression({ options: { shuffle: true } });
      const q = ce.toQuery();
      expect(q).toEqual({ shuffle: '' });
      expect(q).not.toHaveProperty('play');
    });
  });

  // ── roundtrip ──────────────────────────────────────────────────────

  describe('roundtrip', () => {
    it('fromQuery -> toString -> fromString yields same result', () => {
      const original = ContentExpression.fromQuery({
        screen: 'bedroom',
        play: 'abs:book-123',
        shuffle: '',
        volume: '50',
      });
      const str = original.toString();
      const restored = ContentExpression.fromString(str);

      expect(restored.screen).toBe(original.screen);
      expect(restored.action).toBe(original.action);
      expect(restored.contentId).toBe(original.contentId);
      expect(restored.options).toEqual(original.options);
    });

    it('fromString -> toQuery -> fromQuery yields same result', () => {
      const original = ContentExpression.fromString('living-room:play:plex:12345+shuffle+volume=80');
      const query = original.toQuery();
      const restored = ContentExpression.fromQuery(query);

      expect(restored.screen).toBe(original.screen);
      expect(restored.action).toBe(original.action);
      expect(restored.contentId).toBe(original.contentId);
      expect(restored.options).toEqual(original.options);
    });

    it('roundtrips content-only expression', () => {
      const original = ContentExpression.fromString('plex:99');
      const query = original.toQuery();
      const restored = ContentExpression.fromQuery(query);
      // Without action, contentId won't survive query roundtrip (no action key to carry it)
      // This is expected: query format requires an action key to carry contentId
      expect(restored.contentId).toBeNull();
    });

    it('roundtrips with all action types', () => {
      for (const action of ['play', 'queue', 'list', 'open', 'display', 'read']) {
        const original = ContentExpression.fromString(`${action}:src:id`);
        const str = original.toString();
        const restored = ContentExpression.fromString(str);
        expect(restored.action).toBe(action);
        expect(restored.contentId).toBe('src:id');
      }
    });
  });
});
