// tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs
import { describe, it, expect } from 'vitest';
import { normalizeListItem, extractContentId } from '#adapters/content/list/listConfigNormalizer.mjs';

describe('normalizeListItem', () => {

  // ── New format passthrough ──────────────────────────────
  describe('new format passthrough', () => {
    it('passes through item with play key unchanged', () => {
      const item = { title: 'Opening Hymn', play: { contentId: 'hymn:198' } };
      const result = normalizeListItem(item);
      expect(result.title).toBe('Opening Hymn');
      expect(result.play.contentId).toBe('hymn:198');
    });

    it('passes through item with open key unchanged', () => {
      const item = { title: 'Webcam', open: 'webcam' };
      const result = normalizeListItem(item);
      expect(result.open).toBe('webcam');
    });

    it('passes through item with list key unchanged', () => {
      const item = { title: 'Movies', list: { contentId: 'plex:81061' } };
      const result = normalizeListItem(item);
      expect(result.list.contentId).toBe('plex:81061');
    });

    it('passes through item with queue key unchanged', () => {
      const item = { title: 'Fireworks', queue: { contentId: 'plex:663846' }, shuffle: true };
      const result = normalizeListItem(item);
      expect(result.queue.contentId).toBe('plex:663846');
      expect(result.shuffle).toBe(true);
    });

    it('passes through item with display key unchanged', () => {
      const item = { title: 'Art', display: { contentId: 'canvas:religious/treeoflife.jpg' } };
      const result = normalizeListItem(item);
      expect(result.display.contentId).toBe('canvas:religious/treeoflife.jpg');
    });
  });

  // ── Menu items (label/input/action) ─────────────────────
  describe('menu items (label/input/action)', () => {
    it('normalizes default Play action', () => {
      const item = { label: 'Opening Hymn', input: 'singalong:hymn/166', fixed_order: true };
      const result = normalizeListItem(item);
      expect(result.title).toBe('Opening Hymn');
      expect(result.play.contentId).toBe('singalong:hymn/166');
      expect(result.fixed_order).toBe(true);
    });

    it('normalizes explicit Play action', () => {
      const item = { label: 'News', input: 'plex:375839', action: 'Play' };
      const result = normalizeListItem(item);
      expect(result.play.contentId).toBe('plex:375839');
    });

    it('normalizes action: Open to open key', () => {
      const item = { label: 'Gratitude', input: 'app: gratitude', action: 'Open' };
      const result = normalizeListItem(item);
      expect(result.open).toBe('gratitude');
    });

    it('normalizes action: Display to display key', () => {
      const item = { label: 'Art', input: 'canvas:religious/treeoflife.jpg', action: 'Display' };
      const result = normalizeListItem(item);
      expect(result.display.contentId).toBe('canvas:religious/treeoflife.jpg');
    });

    it('normalizes action: List to list key', () => {
      const item = { label: 'Movies', input: 'plex: 81061', action: 'List' };
      const result = normalizeListItem(item);
      expect(result.list.contentId).toBe('plex:81061');
    });

    it('normalizes action: Queue to queue key', () => {
      const item = { label: 'Fireworks', input: 'plex: 663846; overlay: 440630', action: 'Queue', shuffle: true };
      const result = normalizeListItem(item);
      expect(result.queue.contentId).toBe('plex:663846;overlay:440630');
      expect(result.shuffle).toBe(true);
    });

    it('normalizes space-after-colon YAML quirk', () => {
      const item = { label: 'News', input: 'query: dailynews' };
      const result = normalizeListItem(item);
      expect(result.play.contentId).toBe('query:dailynews');
    });

    it('preserves uid and image', () => {
      const item = { label: 'Test', input: 'plex:123', uid: 'abc-123', image: 'https://example.com/img.jpg' };
      const result = normalizeListItem(item);
      expect(result.uid).toBe('abc-123');
      expect(result.image).toBe('https://example.com/img.jpg');
    });

    it('handles case-insensitive action', () => {
      const item = { label: 'App', input: 'app:webcam', action: 'open' };
      const result = normalizeListItem(item);
      expect(result.open).toBe('webcam');
    });

    it('extracts app ID from app:id/param format for Open action', () => {
      const item = { label: 'Spotlight', input: 'app:family-selector/alan', action: 'Open' };
      const result = normalizeListItem(item);
      expect(result.open).toBe('family-selector/alan');
    });
  });

  // ── Watchlist items (title/src/media_key) ───────────────
  describe('watchlist items (title/src/media_key)', () => {
    it('normalizes watchlist format', () => {
      const item = { title: 'Generosity', src: 'plex', media_key: '463210', program: 'BibleProject' };
      const result = normalizeListItem(item);
      expect(result.title).toBe('Generosity');
      expect(result.play.contentId).toBe('plex:463210');
      expect(result.program).toBe('BibleProject');
    });

    it('ensures media_key is string', () => {
      const item = { title: 'Video', src: 'plex', media_key: 12345 };
      const result = normalizeListItem(item);
      expect(result.play.contentId).toBe('plex:12345');
    });

    it('preserves scheduling fields', () => {
      const item = {
        title: 'D&C 1', src: 'scriptures', media_key: 'dc/rex/37707',
        priority: 'High', wait_until: '2025-01-12', skip_after: '2025-01-26',
        watched: true, progress: 100, uid: 'abc-123'
      };
      const result = normalizeListItem(item);
      expect(result.priority).toBe('High');
      expect(result.wait_until).toBe('2025-01-12');
      expect(result.skip_after).toBe('2025-01-26');
      expect(result.watched).toBe(true);
      expect(result.progress).toBe(100);
      expect(result.uid).toBe('abc-123');
    });

    it('preserves hold and assetId', () => {
      const item = { title: 'Test', src: 'plex', media_key: '123', hold: true, assetId: 'custom-key' };
      const result = normalizeListItem(item);
      expect(result.hold).toBe(true);
      expect(result.assetId).toBe('custom-key');
    });
  });

  // ── Program items (label/input with days) ───────────────
  describe('program items (label/input with scheduling)', () => {
    it('normalizes program item with days', () => {
      const item = { label: 'Crash Course', input: 'plex:375839', days: 'weekdays' };
      const result = normalizeListItem(item);
      expect(result.title).toBe('Crash Course');
      expect(result.play.contentId).toBe('plex:375839');
      expect(result.days).toBe('weekdays');
    });

    it('preserves applySchedule', () => {
      const item = { label: 'News', input: 'query:dailynews', applySchedule: false };
      const result = normalizeListItem(item);
      expect(result.applySchedule).toBe(false);
    });

    it('preserves active flag', () => {
      const item = { label: 'Disabled', input: 'plex:999', active: false };
      const result = normalizeListItem(item);
      expect(result.active).toBe(false);
    });
  });

  // ── Edge cases ──────────────────────────────────────────
  describe('edge cases', () => {
    it('handles empty input gracefully', () => {
      const item = { label: 'Empty' };
      const result = normalizeListItem(item);
      expect(result.title).toBe('Empty');
      expect(result.play).toBeUndefined();
      expect(result.open).toBeUndefined();
    });

    it('preserves playbackrate', () => {
      const item = { label: 'Fast', input: 'plex:123', playbackrate: 1.5 };
      const result = normalizeListItem(item);
      expect(result.playbackrate).toBe(1.5);
    });

    it('preserves continuous flag', () => {
      const item = { label: 'Cont', input: 'plex:123', continuous: true };
      const result = normalizeListItem(item);
      expect(result.continuous).toBe(true);
    });

    it('preserves shuffle flag', () => {
      const item = { label: 'Shuf', input: 'plex:123', shuffle: true };
      const result = normalizeListItem(item);
      expect(result.shuffle).toBe(true);
    });
  });
});

describe('extractContentId', () => {
  it('extracts from play.contentId', () => {
    expect(extractContentId({ play: { contentId: 'plex:123' } })).toBe('plex:123');
  });

  it('extracts from list.contentId', () => {
    expect(extractContentId({ list: { contentId: 'plex:81061' } })).toBe('plex:81061');
  });

  it('extracts from queue.contentId', () => {
    expect(extractContentId({ queue: { contentId: 'plex:663846' } })).toBe('plex:663846');
  });

  it('extracts from display.contentId', () => {
    expect(extractContentId({ display: { contentId: 'canvas:img.jpg' } })).toBe('canvas:img.jpg');
  });

  it('extracts from open key (prefixes with app:)', () => {
    expect(extractContentId({ open: 'webcam' })).toBe('app:webcam');
  });

  it('falls back to legacy input field', () => {
    expect(extractContentId({ input: 'plex:456' })).toBe('plex:456');
  });

  it('returns empty string for empty item', () => {
    expect(extractContentId({})).toBe('');
  });

  it('returns empty string for null', () => {
    expect(extractContentId(null)).toBe('');
  });
});
