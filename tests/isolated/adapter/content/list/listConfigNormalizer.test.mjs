// tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs
import { describe, it, expect } from 'vitest';
import { normalizeListItem, extractContentId, normalizeListConfig, serializeListConfig, applyCascade, denormalizeItem, INHERITABLE_FIELDS } from '#adapters/content/list/listConfigNormalizer.mjs';

describe('normalizeListItem', () => {

  // ── New format passthrough (only when input/label are absent) ──
  describe('new format passthrough (no input/label)', () => {
    it('passes through item with play key when no input present', () => {
      const item = { title: 'Opening Hymn', play: { contentId: 'hymn:198' } };
      const result = normalizeListItem(item);
      expect(result.title).toBe('Opening Hymn');
      expect(result.play.contentId).toBe('hymn:198');
    });

    it('passes through item with open key when no input present', () => {
      const item = { title: 'Webcam', open: 'webcam' };
      const result = normalizeListItem(item);
      expect(result.open).toBe('webcam');
    });

    it('passes through item with list key when no input present', () => {
      const item = { title: 'Movies', list: { contentId: 'plex:81061' } };
      const result = normalizeListItem(item);
      expect(result.list.contentId).toBe('plex:81061');
    });

    it('passes through item with queue key when no input present', () => {
      const item = { title: 'Fireworks', queue: { contentId: 'plex:663846' }, shuffle: true };
      const result = normalizeListItem(item);
      expect(result.queue.contentId).toBe('plex:663846');
      expect(result.shuffle).toBe(true);
    });

    it('passes through item with display key when no input present', () => {
      const item = { title: 'Art', display: { contentId: 'canvas:religious/treeoflife.jpg' } };
      const result = normalizeListItem(item);
      expect(result.display.contentId).toBe('canvas:religious/treeoflife.jpg');
    });
  });

  // ── Mixed format: input wins over stale action keys ───
  describe('mixed format (input + action key)', () => {
    it('input wins when both input and play exist with different values', () => {
      const item = { title: 'Felix', input: 'plex:457387', play: { contentId: 'plex:457385' } };
      const result = normalizeListItem(item);
      expect(result.play.contentId).toBe('plex:457387');
      // stale play value is replaced
    });

    it('input wins when both input and play exist with matching values', () => {
      const item = { title: 'Hymn', input: 'singalong:hymn/1030', play: { contentId: 'singalong:hymn/1030' } };
      const result = normalizeListItem(item);
      expect(result.play.contentId).toBe('singalong:hymn/1030');
    });

    it('label triggers input branch even when action key present', () => {
      const item = { label: 'Webcam', input: 'app:webcam', action: 'Open', open: 'stale-value' };
      const result = normalizeListItem(item);
      expect(result.open).toBe('webcam');
      expect(result.title).toBe('Webcam');
    });

    it('drops stale display key when input is present', () => {
      const item = { title: 'Art', input: 'canvas:new.jpg', action: 'Display', display: { contentId: 'canvas:old.jpg' } };
      const result = normalizeListItem(item);
      expect(result.display.contentId).toBe('canvas:new.jpg');
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

describe('normalizeListConfig', () => {

  // ── Input format normalization ────────────────────────
  describe('input format normalization', () => {
    it('wraps bare array into single anonymous section', () => {
      const raw = [
        { label: 'Bluey', input: 'plex: 59493' },
        { label: 'Yoda', input: 'plex: 530423' }
      ];
      const result = normalizeListConfig(raw);
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].title).toBeUndefined();
      expect(result.sections[0].items).toHaveLength(2);
    });

    it('wraps {items} format into single anonymous section', () => {
      const raw = {
        title: 'Kids',
        description: 'Cartoons',
        image: '/img.png',
        items: [
          { title: 'Bluey', play: { plex: '59493' } }
        ]
      };
      const result = normalizeListConfig(raw);
      expect(result.title).toBe('Kids');
      expect(result.description).toBe('Cartoons');
      expect(result.image).toBe('/img.png');
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].items).toHaveLength(1);
    });

    it('passes through {sections} format', () => {
      const raw = {
        title: 'Scripture Study',
        sections: [
          { title: 'BibleProject', items: [{ title: 'Gen', play: { plex: '1' } }] },
          { title: 'Yale', items: [{ title: 'Intro', play: { plex: '2' } }] }
        ]
      };
      const result = normalizeListConfig(raw);
      expect(result.sections).toHaveLength(2);
      expect(result.sections[0].title).toBe('BibleProject');
      expect(result.sections[1].title).toBe('Yale');
    });

    it('handles null/undefined input', () => {
      const result = normalizeListConfig(null);
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].items).toHaveLength(0);
    });

    it('handles empty object', () => {
      const result = normalizeListConfig({});
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].items).toHaveLength(0);
    });
  });

  // ── List-level metadata extraction ────────────────────
  describe('list-level metadata', () => {
    it('extracts title, description, image from {items} format', () => {
      const raw = { title: 'FHE', description: 'Family night', image: '/fhe.png', items: [] };
      const result = normalizeListConfig(raw);
      expect(result.title).toBe('FHE');
      expect(result.description).toBe('Family night');
      expect(result.image).toBe('/fhe.png');
    });

    it('extracts metadata object with inheritable fields', () => {
      const raw = {
        title: 'Study',
        metadata: { priority: 'medium', playbackrate: 2, group: 'Scripture' },
        items: []
      };
      const result = normalizeListConfig(raw);
      expect(result.metadata.priority).toBe('medium');
      expect(result.metadata.playbackrate).toBe(2);
      expect(result.metadata.group).toBe('Scripture');
    });

    it('lifts fixed_order from top level into metadata', () => {
      const raw = { title: 'FHE', fixed_order: true, items: [] };
      const result = normalizeListConfig(raw);
      expect(result.metadata.fixed_order).toBe(true);
    });
  });

  // ── Section-level fields ──────────────────────────────
  describe('section-level fields', () => {
    it('preserves section title, description, image', () => {
      const raw = {
        title: 'Lists',
        sections: [{
          title: 'Favorites',
          description: 'Top picks',
          image: '/fav.png',
          items: []
        }]
      };
      const result = normalizeListConfig(raw);
      expect(result.sections[0].title).toBe('Favorites');
      expect(result.sections[0].description).toBe('Top picks');
      expect(result.sections[0].image).toBe('/fav.png');
    });

    it('preserves section ordering fields (fixed_order, shuffle, limit)', () => {
      const raw = {
        title: 'Mix',
        sections: [{
          shuffle: true,
          limit: 3,
          items: [{ title: 'A', play: { plex: '1' } }]
        }]
      };
      const result = normalizeListConfig(raw);
      expect(result.sections[0].shuffle).toBe(true);
      expect(result.sections[0].limit).toBe(3);
    });

    it('preserves section inheritable fields (priority, days, etc.)', () => {
      const raw = {
        title: 'Watch',
        sections: [{
          title: 'BibleProject',
          priority: 'medium',
          skip_after: '2025-05-04',
          wait_until: '2025-04-27',
          playbackrate: 2,
          items: []
        }]
      };
      const result = normalizeListConfig(raw);
      const s = result.sections[0];
      expect(s.priority).toBe('medium');
      expect(s.skip_after).toBe('2025-05-04');
      expect(s.wait_until).toBe('2025-04-27');
      expect(s.playbackrate).toBe(2);
    });
  });

  // ── Item normalization within sections ────────────────
  describe('item normalization', () => {
    it('normalizes legacy items (label/input/action) within sections', () => {
      const raw = {
        title: 'Test',
        sections: [{
          items: [{ label: 'Hymn', input: 'singalong:hymn/166' }]
        }]
      };
      const result = normalizeListConfig(raw);
      const item = result.sections[0].items[0];
      expect(item.title).toBe('Hymn');
      expect(item.play.contentId).toBe('singalong:hymn/166');
    });

    it('normalizes legacy items in bare array format', () => {
      const raw = [{ label: 'News', input: 'query: dailynews', action: 'Play' }];
      const result = normalizeListConfig(raw);
      const item = result.sections[0].items[0];
      expect(item.title).toBe('News');
      expect(item.play.contentId).toBe('query:dailynews');
    });

    it('passes through new-format items unchanged', () => {
      const raw = {
        title: 'Test',
        sections: [{
          items: [{ title: 'Video', play: { plex: '123' }, uid: 'abc' }]
        }]
      };
      const result = normalizeListConfig(raw);
      const item = result.sections[0].items[0];
      expect(item.title).toBe('Video');
      expect(item.play.plex).toBe('123');
      expect(item.uid).toBe('abc');
    });
  });

  // ── Immutability ──────────────────────────────────────
  describe('immutability', () => {
    it('does not mutate the input object', () => {
      const raw = {
        title: 'Test',
        items: [{ label: 'A', input: 'plex:123' }]
      };
      const frozen = JSON.parse(JSON.stringify(raw));
      normalizeListConfig(raw);
      expect(raw).toEqual(frozen);
    });
  });

  // ── Filename fallback ─────────────────────────────────
  describe('filename fallback', () => {
    it('uses filename as title for bare array', () => {
      const result = normalizeListConfig([{ label: 'A', input: 'plex:1' }], 'morning-program');
      expect(result.title).toBe('morning-program');
    });

    it('uses filename as title for null input', () => {
      const result = normalizeListConfig(null, 'test-list');
      expect(result.title).toBe('test-list');
    });
  });
});

describe('serializeListConfig', () => {
  it('serializes single anonymous section as {title, items} (compact)', () => {
    const config = {
      title: 'Kids',
      description: undefined,
      image: undefined,
      metadata: {},
      sections: [{ items: [{ title: 'Bluey', play: { plex: '59493' } }] }]
    };
    const result = serializeListConfig(config);
    expect(result.title).toBe('Kids');
    expect(result.items).toHaveLength(1);
    expect(result.sections).toBeUndefined();
  });

  it('serializes multiple sections with sections key', () => {
    const config = {
      title: 'Scripture',
      metadata: {},
      sections: [
        { title: 'BP', items: [{ title: 'A', play: { plex: '1' } }] },
        { title: 'Yale', items: [{ title: 'B', play: { plex: '2' } }] }
      ]
    };
    const result = serializeListConfig(config);
    expect(result.sections).toHaveLength(2);
    expect(result.items).toBeUndefined();
  });

  it('serializes named single section with sections key', () => {
    const config = {
      title: 'Mix',
      metadata: {},
      sections: [{ title: 'Favs', shuffle: true, items: [{ title: 'A', play: { plex: '1' } }] }]
    };
    const result = serializeListConfig(config);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].title).toBe('Favs');
    expect(result.items).toBeUndefined();
  });

  it('serializes section with config (shuffle, limit) using sections key', () => {
    const config = {
      title: 'Grab Bag',
      metadata: {},
      sections: [{ shuffle: true, limit: 3, items: [{ title: 'A', play: { plex: '1' } }] }]
    };
    const result = serializeListConfig(config);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].shuffle).toBe(true);
    expect(result.sections[0].limit).toBe(3);
  });

  it('omits empty metadata', () => {
    const config = {
      title: 'Test',
      metadata: {},
      sections: [{ items: [] }]
    };
    const result = serializeListConfig(config);
    expect(result.metadata).toBeUndefined();
  });

  it('includes non-empty metadata', () => {
    const config = {
      title: 'Test',
      metadata: { group: 'Scripture', fixed_order: true },
      sections: [{ items: [] }]
    };
    const result = serializeListConfig(config);
    expect(result.metadata.group).toBe('Scripture');
    expect(result.metadata.fixed_order).toBe(true);
  });

  it('omits undefined description and image', () => {
    const config = {
      title: 'Test',
      description: undefined,
      image: undefined,
      metadata: {},
      sections: [{ items: [] }]
    };
    const result = serializeListConfig(config);
    expect(result.description).toBeUndefined();
    expect(result.image).toBeUndefined();
  });
});

describe('applyCascade', () => {
  it('merges list metadata into items with no overrides', () => {
    const config = {
      metadata: { playbackrate: 2, priority: 'medium' },
      sections: [{
        items: [{ title: 'A', play: { plex: '1' } }]
      }]
    };
    const result = applyCascade(config);
    expect(result.sections[0].items[0].playbackrate).toBe(2);
    expect(result.sections[0].items[0].priority).toBe('medium');
  });

  it('section fields override list metadata', () => {
    const config = {
      metadata: { playbackrate: 2 },
      sections: [{
        playbackrate: 1.5,
        items: [{ title: 'A', play: { plex: '1' } }]
      }]
    };
    const result = applyCascade(config);
    expect(result.sections[0].items[0].playbackrate).toBe(1.5);
  });

  it('item fields override section fields', () => {
    const config = {
      metadata: { priority: 'medium' },
      sections: [{
        priority: 'high',
        items: [{ title: 'A', play: { plex: '1' }, priority: 'urgent' }]
      }]
    };
    const result = applyCascade(config);
    expect(result.sections[0].items[0].priority).toBe('urgent');
  });

  it('does not cascade non-inheritable fields', () => {
    const config = {
      metadata: { group: 'Scripture' },
      sections: [{
        items: [{ title: 'A', play: { plex: '1' } }]
      }]
    };
    const result = applyCascade(config);
    expect(result.sections[0].items[0].group).toBeUndefined();
  });

  it('cascades days from section to items', () => {
    const config = {
      metadata: {},
      sections: [{
        days: 'weekdays',
        items: [
          { title: 'A', play: { plex: '1' } },
          { title: 'B', play: { plex: '2' }, days: 'daily' }
        ]
      }]
    };
    const result = applyCascade(config);
    expect(result.sections[0].items[0].days).toBe('weekdays');
    expect(result.sections[0].items[1].days).toBe('daily');
  });

  it('returns new object without mutating input', () => {
    const config = {
      metadata: { playbackrate: 2 },
      sections: [{ items: [{ title: 'A', play: { plex: '1' } }] }]
    };
    const result = applyCascade(config);
    expect(config.sections[0].items[0].playbackrate).toBeUndefined();
    expect(result.sections[0].items[0].playbackrate).toBe(2);
  });
});

describe('denormalizeItem', () => {
  it('converts play item to input format', () => {
    const item = { title: 'Hymn', play: { contentId: 'plex:123' }, uid: 'abc' };
    const result = denormalizeItem(item);
    expect(result.input).toBe('plex:123');
    expect(result.label).toBe('Hymn');
    expect(result.title).toBeUndefined();
    expect(result.play).toBeUndefined();
  });

  it('omits action when it is Play (default)', () => {
    const item = { title: 'Video', play: { contentId: 'plex:456' } };
    const result = denormalizeItem(item);
    expect(result.input).toBe('plex:456');
    expect(result.action).toBeUndefined();
  });

  it('sets action for Queue', () => {
    const item = { title: 'Fireworks', queue: { contentId: 'plex:663846' }, shuffle: true };
    const result = denormalizeItem(item);
    expect(result.input).toBe('plex:663846');
    expect(result.action).toBe('Queue');
    expect(result.queue).toBeUndefined();
    expect(result.shuffle).toBe(true);
  });

  it('sets action for List', () => {
    const item = { title: 'Movies', list: { contentId: 'plex:81061' } };
    const result = denormalizeItem(item);
    expect(result.input).toBe('plex:81061');
    expect(result.action).toBe('List');
    expect(result.list).toBeUndefined();
  });

  it('converts open key to input with app: prefix and Open action', () => {
    const item = { title: 'Webcam', open: 'webcam' };
    const result = denormalizeItem(item);
    expect(result.input).toBe('app:webcam');
    expect(result.action).toBe('Open');
    expect(result.open).toBeUndefined();
  });

  it('converts display key to input with Display action', () => {
    const item = { title: 'Art', display: { contentId: 'canvas:religious/ark.jpg' } };
    const result = denormalizeItem(item);
    expect(result.input).toBe('canvas:religious/ark.jpg');
    expect(result.action).toBe('Display');
    expect(result.display).toBeUndefined();
  });

  it('preserves existing input field', () => {
    const item = { title: 'Test', input: 'plex:789', play: { contentId: 'plex:000' } };
    const result = denormalizeItem(item);
    expect(result.input).toBe('plex:789');
    expect(result.play).toBeUndefined();
  });

  it('preserves uid, image, and common fields', () => {
    const item = { title: 'T', play: { contentId: 'plex:1' }, uid: 'u1', image: '/img.png', continuous: true };
    const result = denormalizeItem(item);
    expect(result.uid).toBe('u1');
    expect(result.image).toBe('/img.png');
    expect(result.continuous).toBe(true);
  });

  it('is idempotent on already-denormalized items', () => {
    const item = { label: 'Test', input: 'plex:123' };
    const result = denormalizeItem(item);
    expect(result.input).toBe('plex:123');
    expect(result.label).toBe('Test');
  });

  it('handles null/undefined', () => {
    expect(denormalizeItem(null)).toBeNull();
    expect(denormalizeItem(undefined)).toBeUndefined();
  });
});

describe('serializeListConfig denormalization', () => {
  it('strips action keys from items in compact form', () => {
    const config = {
      title: 'FHE',
      metadata: {},
      sections: [{ items: [
        { title: 'Hymn', play: { contentId: 'singalong:hymn/166' }, uid: 'abc' },
        { title: 'App', open: 'webcam', uid: 'def' }
      ]}]
    };
    const result = serializeListConfig(config);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].input).toBe('singalong:hymn/166');
    expect(result.items[0].play).toBeUndefined();
    expect(result.items[1].input).toBe('app:webcam');
    expect(result.items[1].action).toBe('Open');
    expect(result.items[1].open).toBeUndefined();
  });

  it('strips action keys from items in sections form', () => {
    const config = {
      title: 'TV',
      metadata: {},
      sections: [
        { title: 'Main', items: [
          { title: 'Fireworks', queue: { contentId: 'plex:663846' }, shuffle: true }
        ]}
      ]
    };
    const result = serializeListConfig(config);
    const item = result.sections[0].items[0];
    expect(item.input).toBe('plex:663846');
    expect(item.action).toBe('Queue');
    expect(item.queue).toBeUndefined();
    expect(item.shuffle).toBe(true);
  });
});

describe('round-trip: normalizeListConfig → serializeListConfig', () => {
  it('produces clean input+action format from input-based YAML', () => {
    const raw = {
      title: 'FHE',
      items: [
        { label: 'Hymn', input: 'singalong:hymn/166', fixed_order: true },
        { label: 'Gratitude', input: 'app: gratitude', action: 'Open' },
        { label: 'Art', input: 'canvas:religious/treeoflife.jpg', action: 'Display' }
      ]
    };
    const normalized = normalizeListConfig(raw);
    const serialized = serializeListConfig(normalized);
    expect(serialized.items[0].input).toBe('singalong:hymn/166');
    expect(serialized.items[0].play).toBeUndefined();
    expect(serialized.items[1].input).toBe('app:gratitude');
    expect(serialized.items[1].action).toBe('Open');
    expect(serialized.items[1].open).toBeUndefined();
    expect(serialized.items[2].input).toBe('canvas:religious/treeoflife.jpg');
    expect(serialized.items[2].action).toBe('Display');
    expect(serialized.items[2].display).toBeUndefined();
  });

  it('produces clean input+action format from action-key-only YAML', () => {
    const raw = {
      title: 'TV',
      sections: [{ items: [
        { title: 'Fireworks', queue: { contentId: 'plex:663846' }, shuffle: true },
        { title: 'FHE', list: { contentId: 'menu:fhe' } },
        { title: 'Webcam', open: 'webcam' }
      ]}]
    };
    const normalized = normalizeListConfig(raw);
    const serialized = serializeListConfig(normalized);
    const items = serialized.items; // single anonymous section → compact form
    expect(items[0].input).toBe('plex:663846');
    expect(items[0].action).toBe('Queue');
    expect(items[0].queue).toBeUndefined();
    expect(items[1].input).toBe('menu:fhe');
    expect(items[1].action).toBe('List');
    expect(items[2].input).toBe('app:webcam');
    expect(items[2].action).toBe('Open');
  });

  it('cleans up mixed-format items (input wins)', () => {
    const raw = {
      title: 'FHE',
      items: [
        { title: 'Felix', input: 'plex:457387', play: { contentId: 'plex:457385' }, uid: 'abc' }
      ]
    };
    const normalized = normalizeListConfig(raw);
    const serialized = serializeListConfig(normalized);
    expect(serialized.items[0].input).toBe('plex:457387');
    expect(serialized.items[0].play).toBeUndefined();
  });
});
