# List Sections Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add sections support to the list YAML format — enabling grouping, per-section config (shuffle, limit, fixed_order), cascading inheritance, and section-aware admin UI.

**Architecture:** Three-phase approach. Phase 1 adds `normalizeListConfig()` and `serializeListConfig()` to the existing normalizer, then rewires `ListAdapter._loadList()` to use it — zero changes to YAML files. Phase 2 updates the admin API to expose sections and adds section CRUD endpoints. Phase 3 updates the admin frontend to render/edit sections.

**Tech Stack:** Node.js (ES modules), vitest (isolated tests), Express (admin API), React + Mantine + @dnd-kit (admin UI)

**Design doc:** `docs/_wip/plans/2026-02-10-list-sections-design.md`

**Running tests:** `npx vitest run <path>` from project root (NOT jest — isolated tests use vitest)

---

## Task 1: `normalizeListConfig()` — normalize any YAML shape to sections

**Files:**
- Modify: `backend/src/1_adapters/content/list/listConfigNormalizer.mjs`
- Test: `tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs`

This is the core function. It accepts raw YAML (array, `{items}`, or `{sections}`) and always returns `{ title, description, image, metadata, sections: [{ title?, items, ...sectionDefaults }] }`.

**Step 1: Write failing tests for `normalizeListConfig`**

Add a new `describe('normalizeListConfig')` block at the end of the existing test file:

```js
import { normalizeListConfig } from '#adapters/content/list/listConfigNormalizer.mjs';

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
});
```

**Step 2: Run tests — verify they fail**

```bash
npx vitest run tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs
```

Expected: FAIL — `normalizeListConfig` is not exported.

**Step 3: Implement `normalizeListConfig`**

Add to `backend/src/1_adapters/content/list/listConfigNormalizer.mjs`:

```js
/**
 * Inheritable fields that cascade from list metadata → section → item.
 */
const INHERITABLE_FIELDS = [
  'priority', 'hold', 'watched', 'skip_after', 'wait_until',
  'playbackrate', 'continuous', 'shuffle',
  'days', 'applySchedule',
  'active', 'fixed_order'
];

/**
 * Normalize raw YAML list config into a canonical sections-based structure.
 *
 * Accepts three input shapes:
 * - Array: bare item list → single anonymous section
 * - { items: [] }: flat list with metadata → single anonymous section
 * - { sections: [] }: full sections format → pass through
 *
 * Each item is run through normalizeListItem() for old→new format compat.
 *
 * @param {any} raw - Parsed YAML content
 * @param {string} [filename] - Optional filename for deriving title
 * @returns {{ title, description, image, metadata, sections: Array }}
 */
export function normalizeListConfig(raw, filename) {
  // Handle null/undefined
  if (!raw) {
    return {
      title: filename || undefined,
      description: undefined,
      image: undefined,
      metadata: {},
      sections: [{ items: [] }]
    };
  }

  // Bare array → single anonymous section
  if (Array.isArray(raw)) {
    return {
      title: filename || undefined,
      description: undefined,
      image: undefined,
      metadata: {},
      sections: [{
        items: raw.map(item => normalizeListItem(item)).filter(Boolean)
      }]
    };
  }

  // Object format
  const title = raw.title || raw.label || filename || undefined;
  const description = raw.description || undefined;
  const image = raw.image || undefined;

  // Build metadata from known top-level fields
  const metadata = { ...(raw.metadata || {}) };

  // Lift top-level inheritable fields into metadata
  if (raw.fixed_order != null && metadata.fixed_order == null) metadata.fixed_order = raw.fixed_order;
  if (raw.group != null && metadata.group == null) metadata.group = raw.group;

  // { sections: [] } → pass through
  if (Array.isArray(raw.sections)) {
    const sections = raw.sections.map(section => {
      const { items: rawItems, ...sectionFields } = section;
      return {
        ...sectionFields,
        items: (rawItems || []).map(item => normalizeListItem(item)).filter(Boolean)
      };
    });
    return { title, description, image, metadata, sections };
  }

  // { items: [] } → single anonymous section
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  return {
    title,
    description,
    image,
    metadata,
    sections: [{
      items: rawItems.map(item => normalizeListItem(item)).filter(Boolean)
    }]
  };
}
```

**Step 4: Run tests — verify they pass**

```bash
npx vitest run tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs
```

Expected: All tests PASS (both old and new).

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/list/listConfigNormalizer.mjs tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs
git commit -m "feat: add normalizeListConfig() for sections normalization"
```

---

## Task 2: `serializeListConfig()` — write sections back to compact YAML

**Files:**
- Modify: `backend/src/1_adapters/content/list/listConfigNormalizer.mjs`
- Test: `tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs`

**Step 1: Write failing tests for `serializeListConfig`**

Add to the test file:

```js
import { serializeListConfig } from '#adapters/content/list/listConfigNormalizer.mjs';

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
```

**Step 2: Run tests — verify they fail**

```bash
npx vitest run tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs
```

**Step 3: Implement `serializeListConfig`**

Add to `listConfigNormalizer.mjs`:

```js
/**
 * Serialize a normalized list config back to a YAML-ready object.
 * Uses the most compact valid format:
 * - Single anonymous section with no config → { title, items }
 * - Otherwise → { title, sections }
 *
 * @param {{ title, description, image, metadata, sections }} config
 * @returns {Object} YAML-ready object
 */
export function serializeListConfig(config) {
  const output = {};

  if (config.title) output.title = config.title;
  if (config.description) output.description = config.description;
  if (config.image) output.image = config.image;
  if (config.metadata && Object.keys(config.metadata).length > 0) {
    output.metadata = config.metadata;
  }

  const sections = config.sections || [];

  // Compact form: single section with no title and no section-level config
  const canCompact = sections.length <= 1 && !sectionHasConfig(sections[0]);
  if (canCompact) {
    output.items = sections[0]?.items || [];
  } else {
    output.sections = sections.map(section => {
      const { items, ...rest } = section;
      const s = { ...rest };
      s.items = items || [];
      return s;
    });
  }

  return output;
}

/**
 * Check if a section has any config beyond just items
 * @param {Object} section
 * @returns {boolean}
 */
function sectionHasConfig(section) {
  if (!section) return false;
  const { items, ...rest } = section;
  return Object.keys(rest).some(key => rest[key] != null);
}
```

**Step 4: Run tests — verify they pass**

```bash
npx vitest run tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs
```

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/list/listConfigNormalizer.mjs tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs
git commit -m "feat: add serializeListConfig() for compact YAML serialization"
```

---

## Task 3: `applyCascade()` — resolve inherited fields

**Files:**
- Modify: `backend/src/1_adapters/content/list/listConfigNormalizer.mjs`
- Test: `tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs`

**Step 1: Write failing tests for `applyCascade`**

```js
import { applyCascade } from '#adapters/content/list/listConfigNormalizer.mjs';

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
    // group is list-level metadata, not inheritable to items
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
    expect(result.sections[0].items[1].days).toBe('daily'); // item override
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
```

**Step 2: Run tests — verify they fail**

```bash
npx vitest run tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs
```

**Step 3: Implement `applyCascade`**

Add to `listConfigNormalizer.mjs`:

```js
/**
 * Apply cascading inheritance: list metadata → section defaults → item fields.
 * Returns a new config with resolved items (does not mutate input).
 *
 * @param {{ metadata, sections }} config - Normalized config from normalizeListConfig
 * @returns {{ metadata, sections }} Config with cascaded item fields
 */
export function applyCascade(config) {
  const listDefaults = {};
  for (const field of INHERITABLE_FIELDS) {
    if (config.metadata?.[field] != null) {
      listDefaults[field] = config.metadata[field];
    }
  }

  const sections = (config.sections || []).map(section => {
    // Build section-level defaults (list defaults + section overrides)
    const sectionDefaults = { ...listDefaults };
    for (const field of INHERITABLE_FIELDS) {
      if (section[field] != null) {
        sectionDefaults[field] = section[field];
      }
    }

    // Apply to each item (item overrides section)
    const items = (section.items || []).map(item => {
      const resolved = {};
      for (const field of INHERITABLE_FIELDS) {
        if (item[field] != null) {
          resolved[field] = item[field];
        } else if (sectionDefaults[field] != null) {
          resolved[field] = sectionDefaults[field];
        }
      }
      return { ...item, ...resolved };
    });

    return { ...section, items };
  });

  return { ...config, sections };
}
```

**Step 4: Run tests — verify they pass**

```bash
npx vitest run tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs
```

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/list/listConfigNormalizer.mjs tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs
git commit -m "feat: add applyCascade() for section inheritance resolution"
```

---

## Task 4: Wire `ListAdapter._loadList()` to use `normalizeListConfig()`

**Files:**
- Modify: `backend/src/1_adapters/content/list/ListAdapter.mjs`
- Test: `tests/isolated/adapter/content/list/ListAdapter.resolvePlayables.test.mjs`

This is the critical integration point. `_loadList()` currently returns raw YAML. After this change, it returns normalized config with `sections`. All callers (`getItem`, `getList`, `resolvePlayables`) must be updated to iterate `sections[].items` instead of a flat array.

**Step 1: Write failing test for normalized _loadList output**

Add a new test file `tests/isolated/adapter/content/list/ListAdapter.loadList.test.mjs`:

```js
import { describe, it, expect, vi } from 'vitest';

// Mock FileIO
vi.mock('#system/utils/FileIO.mjs', () => ({
  dirExists: vi.fn(() => true),
  listEntries: vi.fn(() => ['test-list.yml']),
  fileExists: vi.fn(() => true),
  loadYaml: vi.fn(),
}));

const FileIO = await import('#system/utils/FileIO.mjs');
const { ListAdapter } = await import('#adapters/content/list/ListAdapter.mjs');

describe('ListAdapter._loadList normalization', () => {
  function makeAdapter() {
    return new ListAdapter({ dataPath: '/fake/data' });
  }

  it('normalizes bare array YAML into sections', () => {
    FileIO.loadYaml.mockReturnValue([
      { label: 'Bluey', input: 'plex: 59493' },
      { label: 'Yoda', input: 'plex: 530423' }
    ]);

    const adapter = makeAdapter();
    const data = adapter._loadList('menus', 'test-list');

    expect(data.sections).toBeDefined();
    expect(data.sections).toHaveLength(1);
    expect(data.sections[0].items).toHaveLength(2);
    expect(data.sections[0].items[0].title).toBe('Bluey');
  });

  it('normalizes {title, items} YAML into sections', () => {
    FileIO.loadYaml.mockReturnValue({
      title: 'FHE',
      fixed_order: true,
      items: [
        { title: 'Opening Hymn', play: { contentId: 'hymn:166' } }
      ]
    });

    const adapter = makeAdapter();
    const data = adapter._loadList('menus', 'fhe');

    expect(data.title).toBe('FHE');
    expect(data.metadata.fixed_order).toBe(true);
    expect(data.sections).toHaveLength(1);
    expect(data.sections[0].items[0].title).toBe('Opening Hymn');
  });

  it('passes through {sections} YAML unchanged', () => {
    FileIO.loadYaml.mockReturnValue({
      title: 'Scripture',
      sections: [
        { title: 'BP', items: [{ title: 'Gen', play: { plex: '1' } }] },
        { title: 'Yale', items: [{ title: 'Intro', play: { plex: '2' } }] }
      ]
    });

    const adapter = makeAdapter();
    const data = adapter._loadList('watchlists', 'scripture');

    expect(data.sections).toHaveLength(2);
    expect(data.sections[0].title).toBe('BP');
    expect(data.sections[1].title).toBe('Yale');
  });
});
```

**Step 2: Run test — verify it fails**

```bash
npx vitest run tests/isolated/adapter/content/list/ListAdapter.loadList.test.mjs
```

Expected: FAIL — `data.sections` is undefined (current `_loadList` returns raw YAML).

**Step 3: Update `_loadList()` in ListAdapter.mjs**

In `backend/src/1_adapters/content/list/ListAdapter.mjs`:

1. Add import at top:
```js
import { normalizeListItem, extractContentId, normalizeListConfig } from './listConfigNormalizer.mjs';
```

2. Replace `_loadList()` body:
```js
_loadList(listType, name) {
  const cacheKey = `${listType}:${name}`;
  if (this._listCache.has(cacheKey)) {
    return this._listCache.get(cacheKey);
  }

  const filePath = this._getListPath(listType, name);
  if (!fileExists(filePath)) {
    return null;
  }

  try {
    const raw = loadYaml(filePath.replace(/\.yml$/, ''));
    const data = normalizeListConfig(raw, name);
    this._listCache.set(cacheKey, data);
    return data;
  } catch (err) {
    console.warn(`Failed to load list ${listType}/${name}:`, err.message);
    return null;
  }
}
```

3. Update `getItem()` — replace:
```js
const items = Array.isArray(listData) ? listData : (listData.items || []);
```
with:
```js
const items = listData.sections.flatMap(s => s.items);
```

4. Update `getList()` — replace:
```js
const rawItems = Array.isArray(listData) ? listData : (listData.items || []);
const menuFixedOrder = !Array.isArray(listData) && listData.fixed_order;
const items = rawItems.map(normalizeListItem);
```
with:
```js
const items = listData.sections.flatMap(s => s.items);
const menuFixedOrder = listData.metadata?.fixed_order;
```
(Items are already normalized by `normalizeListConfig`.)

5. Update `resolvePlayables()` non-watchlist path — replace:
```js
const rawItems = Array.isArray(listData) ? listData : (listData.items || []);
const items = rawItems.map(normalizeListItem);
```
with:
```js
const items = listData.sections.flatMap(s => s.items);
```

**Step 4: Run tests — verify they pass**

```bash
npx vitest run tests/isolated/adapter/content/list/ListAdapter.loadList.test.mjs
npx vitest run tests/isolated/adapter/content/list/ListAdapter.resolvePlayables.test.mjs
npx vitest run tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs
```

All three should PASS.

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/list/ListAdapter.mjs tests/isolated/adapter/content/list/ListAdapter.loadList.test.mjs
git commit -m "feat: wire ListAdapter._loadList to normalizeListConfig"
```

---

## Task 5: Update admin API `parseListContent` to use shared normalizer

**Files:**
- Modify: `backend/src/4_api/v1/routers/admin/content.mjs`
- Test: `tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs` (already covered by Task 1)

**Step 1: Replace `parseListContent` with `normalizeListConfig`**

In `backend/src/4_api/v1/routers/admin/content.mjs`:

1. Add import:
```js
import { normalizeListConfig, serializeListConfig } from '#adapters/content/list/listConfigNormalizer.mjs';
```

2. Remove the local `parseListContent()` function (lines ~58-94).

3. Replace the local `serializeList()` function (lines ~115-133) — it's superseded by the imported `serializeListConfig`.

4. Replace every call to `parseListContent(listName, content)` with `normalizeListConfig(content, listName)`.

5. Replace every call to `serializeList(list)` with `serializeListConfig(list)`.

6. In `GET /lists/:type/:name` — update the response to return sections:
```js
res.json({
  type,
  name: listName,
  title: list.title,
  description: list.description,
  image: list.image,
  metadata: list.metadata,
  sections: list.sections.map((section, si) => ({
    ...section,
    index: si,
    items: section.items.map((item, ii) => ({ ...item, sectionIndex: si, itemIndex: ii }))
  })),
  household: householdId
});
```

7. In `GET /lists/:type` — update item count calculation:
```js
const list = normalizeListConfig(content, name);
const itemCount = list.sections.reduce((sum, s) => sum + s.items.length, 0);
```

**Step 2: Run existing admin API tests to verify nothing broke**

```bash
npx vitest run tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs
```

**Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/admin/content.mjs
git commit -m "refactor: admin content API uses shared normalizeListConfig"
```

---

## Task 6: Add section CRUD endpoints to admin API

**Files:**
- Modify: `backend/src/4_api/v1/routers/admin/content.mjs`
- Create: `tests/isolated/api/admin/content-sections.test.mjs`

**Step 1: Write failing tests for section CRUD**

Create `tests/isolated/api/admin/content-sections.test.mjs`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock dependencies
vi.mock('#system/utils/FileIO.mjs', () => ({
  loadYamlSafe: vi.fn(),
  saveYaml: vi.fn(),
  listYamlFiles: vi.fn(() => []),
  ensureDir: vi.fn(),
  deleteYaml: vi.fn(),
}));

const FileIO = await import('#system/utils/FileIO.mjs');
const { createAdminContentRouter } = await import('#api/v1/routers/admin/content.mjs');

function createApp() {
  const app = express();
  app.use(express.json());
  const router = createAdminContentRouter({
    userDataService: { getHouseholdDir: () => '/fake/data/household' },
    configService: { getDefaultHouseholdId: () => 'default' },
    logger: { info: vi.fn(), error: vi.fn() }
  });
  app.use('/', router);
  return app;
}

describe('Section CRUD endpoints', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe('POST /lists/:type/:name/sections', () => {
    it('adds a new section to a list', async () => {
      FileIO.loadYamlSafe.mockReturnValue({
        title: 'Test',
        sections: [{ items: [{ title: 'A', play: { plex: '1' } }] }]
      });

      const res = await request(app)
        .post('/lists/menus/test/sections')
        .send({ title: 'New Section' });

      expect(res.status).toBe(201);
      expect(FileIO.saveYaml).toHaveBeenCalled();
    });
  });

  describe('PUT /lists/:type/:name/sections/:index', () => {
    it('updates section settings', async () => {
      FileIO.loadYamlSafe.mockReturnValue({
        title: 'Test',
        sections: [
          { title: 'Old Title', items: [{ title: 'A', play: { plex: '1' } }] }
        ]
      });

      const res = await request(app)
        .put('/lists/menus/test/sections/0')
        .send({ title: 'New Title', shuffle: true });

      expect(res.status).toBe(200);
      expect(FileIO.saveYaml).toHaveBeenCalled();
    });
  });

  describe('DELETE /lists/:type/:name/sections/:index', () => {
    it('deletes a section', async () => {
      FileIO.loadYamlSafe.mockReturnValue({
        title: 'Test',
        sections: [
          { title: 'Keep', items: [{ title: 'A', play: { plex: '1' } }] },
          { title: 'Delete', items: [{ title: 'B', play: { plex: '2' } }] }
        ]
      });

      const res = await request(app)
        .delete('/lists/menus/test/sections/1');

      expect(res.status).toBe(200);
      expect(FileIO.saveYaml).toHaveBeenCalled();
    });
  });

  describe('PUT /lists/:type/:name/sections/reorder', () => {
    it('reorders sections', async () => {
      FileIO.loadYamlSafe.mockReturnValue({
        title: 'Test',
        sections: [
          { title: 'A', items: [] },
          { title: 'B', items: [] },
          { title: 'C', items: [] }
        ]
      });

      const res = await request(app)
        .put('/lists/menus/test/sections/reorder')
        .send({ order: [2, 0, 1] });

      expect(res.status).toBe(200);
      expect(FileIO.saveYaml).toHaveBeenCalled();
    });
  });

  describe('PUT /lists/:type/:name/items/move', () => {
    it('moves item between sections', async () => {
      FileIO.loadYamlSafe.mockReturnValue({
        title: 'Test',
        sections: [
          { title: 'A', items: [{ title: 'Item1', play: { plex: '1' } }] },
          { title: 'B', items: [] }
        ]
      });

      const res = await request(app)
        .put('/lists/menus/test/items/move')
        .send({ from: { section: 0, index: 0 }, to: { section: 1, index: 0 } });

      expect(res.status).toBe(200);
      expect(FileIO.saveYaml).toHaveBeenCalled();
    });
  });
});
```

**Step 2: Run tests — verify they fail**

```bash
npx vitest run tests/isolated/api/admin/content-sections.test.mjs
```

**Step 3: Implement section CRUD endpoints**

Add to `createAdminContentRouter()` in `content.mjs`, after the existing item endpoints:

```js
// POST /lists/:type/:name/sections — Add new section
router.post('/lists/:type/:name/sections', (req, res) => {
  const { type, name: listName } = req.params;
  const householdId = req.query.household || configService.getDefaultHouseholdId();
  const sectionData = req.body || {};
  validateType(type);

  const listPath = getListPath(type, listName, householdId);
  const content = loadYamlSafe(listPath);
  if (content === null) throw new NotFoundError('List', `${type}/${listName}`);

  const list = normalizeListConfig(content, listName);
  const newSection = { title: sectionData.title, items: [], ...sectionData };
  delete newSection.items; // Don't accept items in create
  newSection.items = [];
  list.sections.push(newSection);
  saveYaml(listPath, serializeListConfig(list));

  res.status(201).json({ ok: true, sectionIndex: list.sections.length - 1 });
});

// PUT /lists/:type/:name/sections/reorder — Reorder sections
router.put('/lists/:type/:name/sections/reorder', (req, res) => {
  const { type, name: listName } = req.params;
  const householdId = req.query.household || configService.getDefaultHouseholdId();
  const { order } = req.body || {};
  validateType(type);

  if (!Array.isArray(order)) throw new ValidationError('order array required', { field: 'order' });

  const listPath = getListPath(type, listName, householdId);
  const content = loadYamlSafe(listPath);
  if (content === null) throw new NotFoundError('List', `${type}/${listName}`);

  const list = normalizeListConfig(content, listName);
  const reordered = order.map(i => list.sections[i]).filter(Boolean);
  list.sections = reordered;
  saveYaml(listPath, serializeListConfig(list));

  res.json({ ok: true });
});

// PUT /lists/:type/:name/sections/:sectionIndex — Update section settings
router.put('/lists/:type/:name/sections/:sectionIndex', (req, res) => {
  const { type, name: listName, sectionIndex: siStr } = req.params;
  const householdId = req.query.household || configService.getDefaultHouseholdId();
  const updates = req.body || {};
  validateType(type);

  const si = parseInt(siStr, 10);
  const listPath = getListPath(type, listName, householdId);
  const content = loadYamlSafe(listPath);
  if (content === null) throw new NotFoundError('List', `${type}/${listName}`);

  const list = normalizeListConfig(content, listName);
  if (si < 0 || si >= list.sections.length) throw new NotFoundError('Section', si);

  const section = list.sections[si];
  const allowed = ['title', 'description', 'image', 'fixed_order', 'shuffle', 'limit',
    'priority', 'playbackrate', 'continuous', 'days', 'applySchedule',
    'hold', 'skip_after', 'wait_until', 'active'];
  for (const field of allowed) {
    if (updates[field] !== undefined) section[field] = updates[field];
  }
  saveYaml(listPath, serializeListConfig(list));

  res.json({ ok: true, sectionIndex: si });
});

// DELETE /lists/:type/:name/sections/:sectionIndex — Delete section
router.delete('/lists/:type/:name/sections/:sectionIndex', (req, res) => {
  const { type, name: listName, sectionIndex: siStr } = req.params;
  const householdId = req.query.household || configService.getDefaultHouseholdId();
  validateType(type);

  const si = parseInt(siStr, 10);
  const listPath = getListPath(type, listName, householdId);
  const content = loadYamlSafe(listPath);
  if (content === null) throw new NotFoundError('List', `${type}/${listName}`);

  const list = normalizeListConfig(content, listName);
  if (si < 0 || si >= list.sections.length) throw new NotFoundError('Section', si);

  list.sections.splice(si, 1);
  if (list.sections.length === 0) list.sections.push({ items: [] });
  saveYaml(listPath, serializeListConfig(list));

  res.json({ ok: true });
});

// PUT /lists/:type/:name/items/move — Move item between sections
router.put('/lists/:type/:name/items/move', (req, res) => {
  const { type, name: listName } = req.params;
  const householdId = req.query.household || configService.getDefaultHouseholdId();
  const { from, to } = req.body || {};
  validateType(type);

  if (!from || !to) throw new ValidationError('from and to required');

  const listPath = getListPath(type, listName, householdId);
  const content = loadYamlSafe(listPath);
  if (content === null) throw new NotFoundError('List', `${type}/${listName}`);

  const list = normalizeListConfig(content, listName);
  const fromSection = list.sections[from.section];
  const toSection = list.sections[to.section];
  if (!fromSection || !toSection) throw new NotFoundError('Section');

  const [item] = fromSection.items.splice(from.index, 1);
  if (!item) throw new NotFoundError('Item', from.index);
  toSection.items.splice(to.index, 0, item);
  saveYaml(listPath, serializeListConfig(list));

  res.json({ ok: true });
});
```

**Step 4: Run tests — verify they pass**

```bash
npx vitest run tests/isolated/api/admin/content-sections.test.mjs
```

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/admin/content.mjs tests/isolated/api/admin/content-sections.test.mjs
git commit -m "feat: add section CRUD endpoints to admin API"
```

---

## Task 7: Update `useAdminLists` hook for sections

**Files:**
- Modify: `frontend/src/hooks/admin/useAdminLists.js`

**Step 1: Update state from items to sections**

Replace the hook's state and methods to work with sections. Key changes:

1. Replace `const [items, setItems] = useState([]);` with `const [sections, setSections] = useState([]);`

2. Add computed `flatItems`:
```js
const flatItems = useMemo(() =>
  sections.flatMap((section, si) =>
    section.items.map((item, ii) => ({ ...item, sectionIndex: si, itemIndex: ii, sectionTitle: section.title }))
  ), [sections]);
```

3. Update `fetchItems` → `fetchList`:
```js
const fetchList = useCallback(async (type, listName) => {
  setLoading(true);
  setError(null);
  try {
    const data = await DaylightAPI(`${API_BASE}/lists/${type}/${listName}`);
    setSections(data.sections || []);
    const { sections: _, ...metadata } = data;
    setListMetadata(metadata);
    setCurrentType(type);
    setCurrentList(listName);
    return data.sections;
  } catch (err) {
    setError(err);
    throw err;
  } finally {
    setLoading(false);
  }
}, []);
```

4. Update item CRUD methods to use `sectionIndex` + `itemIndex`:
```js
const addItem = useCallback(async (sectionIndex, item) => { ... }, [...]);
const updateItem = useCallback(async (sectionIndex, itemIndex, updates) => { ... }, [...]);
const deleteItem = useCallback(async (sectionIndex, itemIndex) => { ... }, [...]);
```

5. Add section CRUD methods:
```js
const addSection = useCallback(async (sectionData) => { ... }, [...]);
const updateSection = useCallback(async (sectionIndex, updates) => { ... }, [...]);
const deleteSection = useCallback(async (sectionIndex) => { ... }, [...]);
const reorderSections = useCallback(async (newOrder) => { ... }, [...]);
const moveItem = useCallback(async (from, to) => { ... }, [...]);
```

6. Update return object:
```js
return {
  loading, error, lists, sections, flatItems, listMetadata, currentType, currentList,
  fetchLists, createList, deleteList, fetchList,
  addItem, updateItem, deleteItem, reorderItems, toggleItemActive,
  addSection, updateSection, deleteSection, reorderSections, moveItem,
  updateListSettings, clearError: () => setError(null)
};
```

**Step 2: Commit**

```bash
git add frontend/src/hooks/admin/useAdminLists.js
git commit -m "feat: update useAdminLists hook for sections state"
```

---

## Task 8: Add SectionHeader component

**Files:**
- Create: `frontend/src/modules/Admin/ContentLists/SectionHeader.jsx`

**Step 1: Create component**

```jsx
import React, { useState } from 'react';
import {
  Group, Text, ActionIcon, Badge, Collapse, TextInput, Menu
} from '@mantine/core';
import {
  IconChevronDown, IconChevronRight, IconSettings,
  IconTrash, IconDotsVertical, IconGripVertical,
  IconArrowsShuffle, IconSortAscending
} from '@tabler/icons-react';

function SectionHeader({
  section,
  sectionIndex,
  collapsed,
  onToggleCollapse,
  onUpdate,
  onDelete,
  itemCount,
  dragHandleProps
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(section.title || '');

  const handleTitleSave = () => {
    setEditingTitle(false);
    if (titleValue !== (section.title || '')) {
      onUpdate(sectionIndex, { title: titleValue || undefined });
    }
  };

  const isAnonymous = !section.title;

  // Don't render header for anonymous sections in single-section lists
  if (isAnonymous && sectionIndex === 0) return null;

  return (
    <Group
      className="section-header"
      justify="space-between"
      px="xs"
      py={6}
      style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}
    >
      <Group gap="xs">
        <div {...(dragHandleProps || {})} style={{ cursor: 'grab' }}>
          <IconGripVertical size={14} stroke={1.5} color="gray" />
        </div>
        <ActionIcon variant="subtle" size="xs" onClick={() => onToggleCollapse(sectionIndex)}>
          {collapsed ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
        </ActionIcon>
        {editingTitle ? (
          <TextInput
            size="xs"
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={(e) => e.key === 'Enter' && handleTitleSave()}
            autoFocus
            style={{ width: 200 }}
          />
        ) : (
          <Text
            size="sm"
            fw={600}
            c={isAnonymous ? 'dimmed' : undefined}
            onClick={() => setEditingTitle(true)}
            style={{ cursor: 'pointer' }}
          >
            {section.title || `Section ${sectionIndex + 1}`}
          </Text>
        )}
        <Badge size="xs" variant="light" color="gray">{itemCount}</Badge>
        {section.shuffle && <Badge size="xs" variant="light" color="violet">shuffle</Badge>}
        {section.limit && <Badge size="xs" variant="light" color="teal">limit: {section.limit}</Badge>}
        {section.fixed_order && <Badge size="xs" variant="light" color="blue">fixed</Badge>}
        {section.days && <Badge size="xs" variant="light" color="orange">{section.days}</Badge>}
      </Group>
      <Menu position="bottom-end">
        <Menu.Target>
          <ActionIcon variant="subtle" size="xs">
            <IconDotsVertical size={14} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<IconSettings size={14} />} onClick={() => onUpdate(sectionIndex, null)}>
            Section Settings
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => onDelete(sectionIndex)}>
            Delete Section
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}

export default SectionHeader;
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/SectionHeader.jsx
git commit -m "feat: add SectionHeader component for admin list sections"
```

---

## Task 9: Update `ListsFolder.jsx` to render sections

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx`

This is the largest frontend change. Key transformations:

**Step 1: Replace items state with sections from hook**

Replace:
```js
const { items, loading, error, listMetadata, fetchItems, addItem, updateItem, deleteItem, reorderItems, toggleItemActive, deleteList, updateListSettings } = useAdminLists();
```
With:
```js
const { sections, flatItems, loading, error, listMetadata, fetchList, addItem, updateItem, deleteItem, reorderItems, toggleItemActive, deleteList, updateListSettings, addSection, updateSection, deleteSection, moveItem } = useAdminLists();
```

**Step 2: Add section collapse state**

```js
const [collapsedSections, setCollapsedSections] = useState(new Set());
const toggleCollapse = (si) => {
  setCollapsedSections(prev => {
    const next = new Set(prev);
    next.has(si) ? next.delete(si) : next.add(si);
    return next;
  });
};
```

**Step 3: Remove viewMode, existingGroups, groupedItems**

Delete the `viewMode` state, the `existingGroups` memo, the `groupedItems` memo, and the SegmentedControl from the header.

**Step 4: Update fetchItems call to fetchList**

```js
useEffect(() => {
  if (type && listName) fetchList(type, listName);
}, [type, listName, fetchList]);
```

**Step 5: Replace the main render with section-based rendering**

Replace the `DndContext` block with:
```jsx
<Stack gap="md">
  {sections.map((section, si) => (
    <Box key={si} className="section-container">
      <SectionHeader
        section={section}
        sectionIndex={si}
        collapsed={collapsedSections.has(si)}
        onToggleCollapse={toggleCollapse}
        onUpdate={(idx, updates) => updates ? updateSection(idx, updates) : setSettingsOpen(idx)}
        onDelete={deleteSection}
        itemCount={section.items.length}
      />
      <Collapse in={!collapsedSections.has(si)}>
        <DndContext sensors={sensors} collisionDetection={closestCenter}
          onDragEnd={(e) => handleDragEnd(e, si)}>
          {renderItems(section.items, si)}
        </DndContext>
      </Collapse>
    </Box>
  ))}
  <Button variant="light" leftSection={<IconPlus size={16} />}
    onClick={() => addSection({ title: `Section ${sections.length + 1}` })}>
    Add Section
  </Button>
</Stack>
```

**Step 6: Update item handlers to pass sectionIndex**

```js
const handleInlineUpdate = async (sectionIndex, itemIndex, updates) => {
  await updateItem(sectionIndex, itemIndex, updates);
};
```

Update `renderItems` to pass `sectionIndex`:
```jsx
const renderItems = (itemsToRender, sectionIndex) => (
  <Box className="items-container">
    <SortableContext items={itemsToRender.map((_, i) => `${sectionIndex}-${i}`)}
      strategy={verticalListSortingStrategy}>
      {itemsToRender.map((item, idx) => (
        <ListsItemRow
          key={item.uid || `${sectionIndex}-${idx}`}
          item={{ ...item, index: idx }}
          onUpdate={(updates) => handleInlineUpdate(sectionIndex, idx, updates)}
          onDelete={() => deleteItem(sectionIndex, idx)}
          onToggleActive={() => toggleItemActive(sectionIndex, idx)}
          onDuplicate={() => handleDuplicateItem(sectionIndex, item)}
          isWatchlist={type === 'watchlists'}
          onEdit={() => { setEditingItem({ ...item, sectionIndex, itemIndex: idx }); setEditorOpen(true); }}
        />
      ))}
    </SortableContext>
    <EmptyItemRow onAdd={() => { setEditingItem(null); setEditorOpen(true); }}
      nextIndex={itemsToRender.length} isWatchlist={type === 'watchlists'} />
  </Box>
);
```

**Step 7: Update search to use flatItems**

```js
const filteredItems = useMemo(() => {
  if (!searchQuery) return null; // null means show sections normally
  const query = searchQuery.toLowerCase();
  return flatItems.filter(item =>
    item.title?.toLowerCase().includes(query) ||
    item.label?.toLowerCase().includes(query)
  );
}, [flatItems, searchQuery]);
```

When search is active, render as flat list. When not, render sections.

**Step 8: Update context value**

```js
const contextValue = useMemo(() => ({
  sections,
  flatItems,
  contentInfoMap,
  setContentInfo,
  getNearbyItems,
  inUseImages,
}), [sections, flatItems, contentInfoMap, setContentInfo, getNearbyItems, inUseImages]);
```

**Step 9: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsFolder.jsx
git commit -m "feat: ListsFolder renders sections with collapsible headers"
```

---

## Task 10: Update `ListsItemEditor.jsx` for section-aware editing

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemEditor.jsx`

**Step 1: Replace `group` field with section selector**

1. Remove the `group` autocomplete field from the form
2. Add a section selector dropdown (only shown when editing existing items):
```jsx
<Select
  label="Section"
  data={sections.map((s, i) => ({ value: String(i), label: s.title || `Section ${i + 1}` }))}
  value={String(editingItem?.sectionIndex ?? 0)}
  onChange={(val) => {
    // Move item to different section via moveItem
  }}
/>
```

3. Update the `onSave` callback to pass `sectionIndex`

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemEditor.jsx
git commit -m "feat: replace group field with section selector in item editor"
```

---

## Task 11: Update `listConstants.js` for section defaults

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/listConstants.js`

**Step 1: Add section defaults**

```js
export const SECTION_DEFAULTS = {
  title: null,
  description: null,
  image: null,
  fixed_order: false,
  shuffle: false,
  limit: null,
  priority: null,
  playbackrate: null,
  continuous: false,
  days: null,
  applySchedule: true,
  hold: false,
  skip_after: null,
  wait_until: null,
  active: true
};

export const SECTION_INHERITABLE_FIELDS = [
  'priority', 'hold', 'skip_after', 'wait_until',
  'playbackrate', 'continuous', 'shuffle',
  'days', 'applySchedule', 'active', 'fixed_order'
];
```

**Step 2: Remove `group` from KNOWN_ITEM_FIELDS**

Remove `'group'` from the `KNOWN_ITEM_FIELDS` array — it's been superseded by sections.

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/listConstants.js
git commit -m "feat: add section constants, remove group from item fields"
```

---

## Task 12: Integration smoke test

**Files:**
- No new files — verify existing system works end-to-end

**Step 1: Run all normalizer tests**

```bash
npx vitest run tests/isolated/adapter/content/list/
```

Expected: ALL PASS

**Step 2: Run all isolated tests**

```bash
npm run test:isolated
```

Verify no regressions.

**Step 3: Start dev server and verify admin UI loads**

```bash
lsof -i :3111
# If not running: npm run dev
```

Navigate to admin UI and verify:
1. List index page loads and shows lists with correct item counts
2. Opening a list shows sections (single anonymous section for current flat lists)
3. Items are visible and interactive within their section

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration fixes for list sections"
```

---

## Summary

| Task | What | Risk |
|------|------|------|
| 1 | `normalizeListConfig()` | Low — pure function, additive |
| 2 | `serializeListConfig()` | Low — pure function, additive |
| 3 | `applyCascade()` | Low — pure function, additive |
| 4 | Wire `ListAdapter._loadList()` | **Medium** — changes adapter behavior for all list consumers |
| 5 | Admin API uses shared normalizer | Low — refactor, same behavior |
| 6 | Section CRUD endpoints | Low — new endpoints only |
| 7 | `useAdminLists` hook update | Medium — changes admin data flow |
| 8 | `SectionHeader` component | Low — new component |
| 9 | `ListsFolder` sections rendering | **Medium** — largest UI change |
| 10 | `ListsItemEditor` section selector | Low — small UI change |
| 11 | `listConstants` updates | Low — constants only |
| 12 | Integration smoke test | Low — verification only |

Tasks 1-3 are the foundation (pure functions + tests). Task 4 is the critical backend integration. Tasks 5-6 are admin API. Tasks 7-11 are frontend. Task 12 is verification.
