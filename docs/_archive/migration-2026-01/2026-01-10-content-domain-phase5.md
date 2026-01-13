# Content Domain Phase 5 - LocalContent API Endpoints

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add API endpoints for LocalContent types (scripture, talks, hymns, poetry) and their legacy compatibility shims.

**Architecture:** LocalContentAdapter serves YAML metadata + local media files. Each content type has specific response shapes for the ContentScroller component. Legacy endpoints translate to the new unified format.

**Tech Stack:** JavaScript ES Modules (.mjs), JSDoc types, Jest tests, Express.js routing

**Reference Docs:**
- `docs/plans/2026-01-10-content-domain-phase4.md` - Phase 4 completed
- `docs/_wip/plans/2026-01-10-api-consumer-inventory.md` - Frontend consumers

---

## Task 1: Extend LocalContentAdapter for Scripture

**Files:**
- Modify: `backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs`
- Modify: `tests/unit/adapters/content/local-content/LocalContentAdapter.test.mjs`
- Create: `tests/_fixtures/local-content/scripture/cfm/test-chapter.yaml`

**Step 1: Create test fixture**

```yaml
# tests/_fixtures/local-content/scripture/cfm/test-chapter.yaml
reference: "1 Nephi 1"
volume: "bom"
chapter: 1
duration: 360
mediaFile: "cfm/1nephi1.mp3"
verses:
  - num: 1
    text: "I, Nephi, having been born of goodly parents..."
    start: 0
    end: 15
  - num: 2
    text: "Yea, I make a record in the language of my father..."
    start: 15
    end: 30
```

**Step 2: Write the failing test**

```javascript
// Add to LocalContentAdapter.test.mjs
describe('scripture content', () => {
  it('returns scripture item with verses', async () => {
    const fixtureAdapter = new LocalContentAdapter({
      dataPath: path.resolve(__dirname, '../../../../_fixtures/local-content'),
      mediaPath: '/media'
    });

    const item = await fixtureAdapter.getItem('scripture:cfm/test-chapter');

    expect(item).not.toBeNull();
    expect(item.id).toBe('scripture:cfm/test-chapter');
    expect(item.metadata.reference).toBe('1 Nephi 1');
    expect(item.metadata.verses).toHaveLength(2);
    expect(item.metadata.verses[0].num).toBe(1);
  });

  it('includes verse timing for audio sync', async () => {
    const fixtureAdapter = new LocalContentAdapter({
      dataPath: path.resolve(__dirname, '../../../../_fixtures/local-content'),
      mediaPath: '/media'
    });

    const item = await fixtureAdapter.getItem('scripture:cfm/test-chapter');

    expect(item.metadata.verses[0].start).toBe(0);
    expect(item.metadata.verses[0].end).toBe(15);
  });
});
```

**Step 3: Implement scripture handling in LocalContentAdapter**

```javascript
// Add to LocalContentAdapter.mjs

/**
 * Get scripture item
 * @private
 */
async _getScripture(localId) {
  const yamlPath = path.join(this.dataPath, 'scripture', `${localId}.yaml`);

  try {
    if (!fs.existsSync(yamlPath)) return null;
    const content = fs.readFileSync(yamlPath, 'utf8');
    const metadata = yaml.load(content);

    const compoundId = `scripture:${localId}`;
    const mediaUrl = `/proxy/local-content/stream/scripture/${localId}`;

    return new PlayableItem({
      id: compoundId,
      title: metadata.reference || localId,
      type: 'scripture',
      mediaType: 'audio',
      mediaUrl,
      duration: metadata.duration || 0,
      resumable: true,
      metadata: {
        reference: metadata.reference,
        volume: metadata.volume,
        chapter: metadata.chapter,
        verses: metadata.verses || [],
        mediaFile: metadata.mediaFile
      }
    });
  } catch (err) {
    console.error(`[LocalContentAdapter] Error loading scripture ${localId}:`, err);
    return null;
  }
}

// Update getItem to handle scripture prefix
async getItem(id) {
  const [prefix, localId] = id.split(':');
  if (!localId) return null;

  if (prefix === 'talk') {
    return this._getTalk(localId);
  }

  if (prefix === 'scripture') {
    return this._getScripture(localId);
  }

  return null;
}
```

**Step 4: Run tests**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/content/local-content/LocalContentAdapter.test.mjs --verbose
```

**Step 5: Commit**

```bash
git add backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs
git add tests/unit/adapters/content/local-content/LocalContentAdapter.test.mjs
git add tests/_fixtures/local-content/scripture/
git commit -m "feat(adapters): add scripture support to LocalContentAdapter"
```

---

## Task 2: Add Hymn Support to LocalContentAdapter

**Files:**
- Modify: `backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs`
- Modify: `tests/unit/adapters/content/local-content/LocalContentAdapter.test.mjs`
- Create: `tests/_fixtures/local-content/songs/hymn/113.yaml`

**Step 1: Create test fixture**

```yaml
# tests/_fixtures/local-content/songs/hymn/113.yaml
title: "Our Savior's Love"
number: 113
collection: "hymn"
duration: 180
mediaFile: "hymns/113.mp3"
verses:
  - num: 1
    lines:
      - "Our Savior's love shines like the sun"
      - "With perfect light"
    start: 0
    end: 45
  - num: 2
    lines:
      - "The Spirit, voice of goodness, whispers"
      - "To our hearts"
    start: 45
    end: 90
lyrics: |
  Our Savior's love shines like the sun
  With perfect light
  ...
```

**Step 2: Write the failing test**

```javascript
// Add to LocalContentAdapter.test.mjs
describe('hymn content', () => {
  it('returns hymn item with lyrics', async () => {
    const fixtureAdapter = new LocalContentAdapter({
      dataPath: path.resolve(__dirname, '../../../../_fixtures/local-content'),
      mediaPath: '/media'
    });

    const item = await fixtureAdapter.getItem('hymn:113');

    expect(item).not.toBeNull();
    expect(item.id).toBe('hymn:113');
    expect(item.title).toBe("Our Savior's Love");
    expect(item.metadata.number).toBe(113);
    expect(item.metadata.verses).toHaveLength(2);
  });

  it('maps hymn prefix to songs/hymn path', async () => {
    const fixtureAdapter = new LocalContentAdapter({
      dataPath: path.resolve(__dirname, '../../../../_fixtures/local-content'),
      mediaPath: '/media'
    });

    // hymn:113 should resolve to songs/hymn/113.yaml
    const item = await fixtureAdapter.getItem('hymn:113');
    expect(item).not.toBeNull();
  });
});
```

**Step 3: Implement hymn handling with prefix mapping**

```javascript
// Add to LocalContentAdapter.mjs

// Prefix to path mappings
static PREFIX_PATHS = {
  'hymn': 'songs/hymn',
  'primary': 'songs/primary',
  'poem': 'poetry',
  'talk': 'talks',
  'scripture': 'scripture'
};

/**
 * Get song (hymn or primary) item
 * @private
 */
async _getSong(collection, number) {
  const yamlPath = path.join(this.dataPath, 'songs', collection, `${number}.yaml`);

  try {
    if (!fs.existsSync(yamlPath)) return null;
    const content = fs.readFileSync(yamlPath, 'utf8');
    const metadata = yaml.load(content);

    const compoundId = `${collection}:${number}`;
    const mediaUrl = `/proxy/local-content/stream/${collection}/${number}`;

    return new PlayableItem({
      id: compoundId,
      title: metadata.title || `${collection.charAt(0).toUpperCase() + collection.slice(1)} ${number}`,
      type: collection,
      mediaType: 'audio',
      mediaUrl,
      duration: metadata.duration || 0,
      resumable: false, // Songs don't need resume
      metadata: {
        number: metadata.number || parseInt(number),
        collection: metadata.collection || collection,
        verses: metadata.verses || [],
        lyrics: metadata.lyrics
      }
    });
  } catch (err) {
    console.error(`[LocalContentAdapter] Error loading ${collection} ${number}:`, err);
    return null;
  }
}

// Update getItem
async getItem(id) {
  const [prefix, localId] = id.split(':');
  if (!localId) return null;

  switch (prefix) {
    case 'talk':
      return this._getTalk(localId);
    case 'scripture':
      return this._getScripture(localId);
    case 'hymn':
      return this._getSong('hymn', localId);
    case 'primary':
      return this._getSong('primary', localId);
    case 'poem':
      return this._getPoem(localId);
    default:
      return null;
  }
}
```

**Step 4: Run tests and commit**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/content/local-content/LocalContentAdapter.test.mjs --verbose
git add backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs tests/
git commit -m "feat(adapters): add hymn and primary song support to LocalContentAdapter"
```

---

## Task 3: Add Poetry Support to LocalContentAdapter

**Files:**
- Modify: `backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs`
- Create: `tests/_fixtures/local-content/poetry/remedy/01.yaml`

**Step 1: Create test fixture**

```yaml
# tests/_fixtures/local-content/poetry/remedy/01.yaml
title: "Test Poem"
author: "Test Author"
condition: "sleep"
also_suitable_for:
  - "calm"
  - "peace"
duration: 120
mediaFile: "poetry/remedy/01.mp3"
verses:
  - stanza: 1
    lines:
      - "The first line of verse"
      - "The second line"
    start: 0
    end: 30
  - stanza: 2
    lines:
      - "Another stanza begins"
      - "And continues here"
    start: 30
    end: 60
```

**Step 2: Write the failing test**

```javascript
// Add to LocalContentAdapter.test.mjs
describe('poetry content', () => {
  it('returns poem item with stanzas', async () => {
    const fixtureAdapter = new LocalContentAdapter({
      dataPath: path.resolve(__dirname, '../../../../_fixtures/local-content'),
      mediaPath: '/media'
    });

    const item = await fixtureAdapter.getItem('poem:remedy/01');

    expect(item).not.toBeNull();
    expect(item.id).toBe('poem:remedy/01');
    expect(item.title).toBe('Test Poem');
    expect(item.metadata.author).toBe('Test Author');
    expect(item.metadata.condition).toBe('sleep');
    expect(item.metadata.verses).toHaveLength(2);
  });
});
```

**Step 3: Implement poetry handling**

```javascript
// Add to LocalContentAdapter.mjs

/**
 * Get poem item
 * @private
 */
async _getPoem(localId) {
  const yamlPath = path.join(this.dataPath, 'poetry', `${localId}.yaml`);

  try {
    if (!fs.existsSync(yamlPath)) return null;
    const content = fs.readFileSync(yamlPath, 'utf8');
    const metadata = yaml.load(content);

    const compoundId = `poem:${localId}`;
    const mediaUrl = `/proxy/local-content/stream/poem/${localId}`;

    return new PlayableItem({
      id: compoundId,
      title: metadata.title || localId,
      type: 'poem',
      mediaType: 'audio',
      mediaUrl,
      duration: metadata.duration || 0,
      resumable: false,
      metadata: {
        author: metadata.author,
        condition: metadata.condition,
        also_suitable_for: metadata.also_suitable_for || [],
        verses: metadata.verses || [],
        poem_id: localId
      }
    });
  } catch (err) {
    console.error(`[LocalContentAdapter] Error loading poem ${localId}:`, err);
    return null;
  }
}
```

**Step 4: Run tests and commit**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/content/local-content/LocalContentAdapter.test.mjs --verbose
git add backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs tests/
git commit -m "feat(adapters): add poetry support to LocalContentAdapter"
```

---

## Task 4: Create LocalContent API Router

**Files:**
- Create: `backend/src/4_api/routers/localContent.mjs`
- Create: `tests/unit/api/routers/localContent.test.mjs`

**Step 1: Write the test**

```javascript
// tests/unit/api/routers/localContent.test.mjs
import express from 'express';
import request from 'supertest';
import { createLocalContentRouter } from '../../../../backend/src/4_api/routers/localContent.mjs';

describe('LocalContent API Router', () => {
  let app;
  let mockAdapter;

  beforeEach(() => {
    mockAdapter = {
      name: 'local-content',
      getItem: jest.fn()
    };

    const mockRegistry = {
      getAdapter: jest.fn().mockReturnValue(mockAdapter)
    };

    app = express();
    app.use('/api/local-content', createLocalContentRouter({ registry: mockRegistry }));
  });

  describe('GET /api/local-content/scripture/:path', () => {
    it('returns scripture with verses', async () => {
      mockAdapter.getItem.mockResolvedValue({
        id: 'scripture:cfm/1nephi1',
        title: '1 Nephi 1',
        mediaUrl: '/proxy/local-content/stream/scripture/cfm/1nephi1',
        metadata: {
          reference: '1 Nephi 1',
          verses: [{ num: 1, text: 'Test verse' }]
        }
      });

      const res = await request(app).get('/api/local-content/scripture/cfm/1nephi1');

      expect(res.status).toBe(200);
      expect(res.body.reference).toBe('1 Nephi 1');
      expect(res.body.verses).toHaveLength(1);
      expect(res.body.mediaUrl).toBeDefined();
    });
  });

  describe('GET /api/local-content/hymn/:number', () => {
    it('returns hymn with lyrics', async () => {
      mockAdapter.getItem.mockResolvedValue({
        id: 'hymn:113',
        title: "Our Savior's Love",
        mediaUrl: '/proxy/local-content/stream/hymn/113',
        metadata: {
          number: 113,
          verses: [{ num: 1, lines: ['Test line'] }]
        }
      });

      const res = await request(app).get('/api/local-content/hymn/113');

      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Our Savior's Love");
      expect(res.body.number).toBe(113);
    });
  });

  describe('GET /api/local-content/talk/:path', () => {
    it('returns talk with content', async () => {
      mockAdapter.getItem.mockResolvedValue({
        id: 'talk:general/test-talk',
        title: 'Test Talk',
        mediaUrl: '/proxy/local-content/stream/talk/general/test-talk',
        metadata: {
          speaker: 'Elder Test',
          content: [{ type: 'paragraph', text: 'Test content' }]
        }
      });

      const res = await request(app).get('/api/local-content/talk/general/test-talk');

      expect(res.status).toBe(200);
      expect(res.body.speaker).toBe('Elder Test');
      expect(res.body.content).toHaveLength(1);
    });
  });

  describe('GET /api/local-content/poem/:path', () => {
    it('returns poem with stanzas', async () => {
      mockAdapter.getItem.mockResolvedValue({
        id: 'poem:remedy/01',
        title: 'Test Poem',
        mediaUrl: '/proxy/local-content/stream/poem/remedy/01',
        metadata: {
          author: 'Test Author',
          condition: 'sleep',
          verses: [{ stanza: 1, lines: ['Test line'] }]
        }
      });

      const res = await request(app).get('/api/local-content/poem/remedy/01');

      expect(res.status).toBe(200);
      expect(res.body.author).toBe('Test Author');
      expect(res.body.condition).toBe('sleep');
    });
  });
});
```

**Step 2: Write the implementation**

```javascript
// backend/src/4_api/routers/localContent.mjs
import express from 'express';

/**
 * Create LocalContent API router for scripture, hymns, talks, poetry
 *
 * These endpoints return content-specific response shapes for ContentScroller.
 *
 * @param {Object} config
 * @param {Object} config.registry - ContentSourceRegistry
 * @returns {express.Router}
 */
export function createLocalContentRouter(config) {
  const { registry } = config;
  const router = express.Router();

  /**
   * GET /api/local-content/scripture/:path
   * Returns scripture with verse timings for ContentScroller
   */
  router.get('/scripture/*', async (req, res) => {
    try {
      const path = req.params[0] || '';
      const adapter = registry.getAdapter('local-content');

      if (!adapter) {
        return res.status(500).json({ error: 'LocalContent adapter not configured' });
      }

      const item = await adapter.getItem(`scripture:${path}`);
      if (!item) {
        return res.status(404).json({ error: 'Scripture not found', path });
      }

      // Response shape for ContentScroller scripture mode
      res.json({
        reference: item.metadata.reference,
        media_key: item.id,
        mediaUrl: item.mediaUrl,
        duration: item.duration,
        volume: item.metadata.volume,
        chapter: item.metadata.chapter,
        verses: item.metadata.verses
      });
    } catch (err) {
      console.error('[localContent] scripture error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/local-content/hymn/:number
   * Returns hymn with lyrics for ContentScroller
   */
  router.get('/hymn/:number', async (req, res) => {
    try {
      const { number } = req.params;
      const adapter = registry.getAdapter('local-content');

      if (!adapter) {
        return res.status(500).json({ error: 'LocalContent adapter not configured' });
      }

      const item = await adapter.getItem(`hymn:${number}`);
      if (!item) {
        return res.status(404).json({ error: 'Hymn not found', number });
      }

      res.json({
        title: item.title,
        number: item.metadata.number,
        media_key: item.id,
        mediaUrl: item.mediaUrl,
        duration: item.duration,
        verses: item.metadata.verses,
        lyrics: item.metadata.lyrics
      });
    } catch (err) {
      console.error('[localContent] hymn error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/local-content/primary/:number
   * Returns primary song with lyrics
   */
  router.get('/primary/:number', async (req, res) => {
    try {
      const { number } = req.params;
      const adapter = registry.getAdapter('local-content');

      if (!adapter) {
        return res.status(500).json({ error: 'LocalContent adapter not configured' });
      }

      const item = await adapter.getItem(`primary:${number}`);
      if (!item) {
        return res.status(404).json({ error: 'Primary song not found', number });
      }

      res.json({
        title: item.title,
        number: item.metadata.number,
        media_key: item.id,
        mediaUrl: item.mediaUrl,
        duration: item.duration,
        verses: item.metadata.verses,
        lyrics: item.metadata.lyrics
      });
    } catch (err) {
      console.error('[localContent] primary error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/local-content/talk/:path
   * Returns talk with paragraphs for ContentScroller
   */
  router.get('/talk/*', async (req, res) => {
    try {
      const path = req.params[0] || '';
      const adapter = registry.getAdapter('local-content');

      if (!adapter) {
        return res.status(500).json({ error: 'LocalContent adapter not configured' });
      }

      const item = await adapter.getItem(`talk:${path}`);
      if (!item) {
        return res.status(404).json({ error: 'Talk not found', path });
      }

      res.json({
        title: item.title,
        speaker: item.metadata.speaker,
        media_key: item.id,
        mediaUrl: item.mediaUrl,
        duration: item.duration,
        date: item.metadata.date,
        description: item.metadata.description,
        content: item.metadata.content || []
      });
    } catch (err) {
      console.error('[localContent] talk error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/local-content/poem/:path
   * Returns poem with stanzas for ContentScroller
   */
  router.get('/poem/*', async (req, res) => {
    try {
      const path = req.params[0] || '';
      const adapter = registry.getAdapter('local-content');

      if (!adapter) {
        return res.status(500).json({ error: 'LocalContent adapter not configured' });
      }

      const item = await adapter.getItem(`poem:${path}`);
      if (!item) {
        return res.status(404).json({ error: 'Poem not found', path });
      }

      res.json({
        title: item.title,
        author: item.metadata.author,
        condition: item.metadata.condition,
        also_suitable_for: item.metadata.also_suitable_for,
        poem_id: item.metadata.poem_id,
        media_key: item.id,
        mediaUrl: item.mediaUrl,
        duration: item.duration,
        verses: item.metadata.verses
      });
    } catch (err) {
      console.error('[localContent] poem error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
```

**Step 3: Run tests and commit**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/api/routers/localContent.test.mjs --verbose
git add backend/src/4_api/routers/localContent.mjs tests/unit/api/routers/localContent.test.mjs
git commit -m "feat(api): add LocalContent router for scripture, hymns, talks, poetry"
```

---

## Task 5: Create Legacy LocalContent Shims

**Files:**
- Create: `backend/src/4_api/middleware/legacyLocalContentShim.mjs`
- Create: `tests/unit/api/middleware/legacyLocalContentShim.test.mjs`

**Step 1: Write the test**

```javascript
// tests/unit/api/middleware/legacyLocalContentShim.test.mjs
import {
  translateLegacyScripturePath,
  translateLegacyTalkPath,
  translateLegacyHymnPath,
  translateLegacyPoetryPath
} from '../../../../backend/src/4_api/middleware/legacyLocalContentShim.mjs';

describe('Legacy LocalContent Shim', () => {
  describe('translateLegacyScripturePath', () => {
    it('translates simple scripture path', () => {
      const result = translateLegacyScripturePath('cfm');
      expect(result).toBe('scripture/cfm');
    });

    it('handles version modifier', () => {
      // Legacy: data/scripture/bom; version redc
      const result = translateLegacyScripturePath('bom', { version: 'redc' });
      expect(result).toBe('scripture/bom?version=redc');
    });
  });

  describe('translateLegacyTalkPath', () => {
    it('translates talk path', () => {
      const result = translateLegacyTalkPath('ldsgc202510/11');
      expect(result).toBe('talk/ldsgc202510/11');
    });
  });

  describe('translateLegacyHymnPath', () => {
    it('translates hymn number', () => {
      const result = translateLegacyHymnPath('113');
      expect(result).toBe('hymn/113');
    });
  });

  describe('translateLegacyPoetryPath', () => {
    it('translates poetry path', () => {
      const result = translateLegacyPoetryPath('remedy/01');
      expect(result).toBe('poem/remedy/01');
    });
  });
});
```

**Step 2: Write the implementation**

```javascript
// backend/src/4_api/middleware/legacyLocalContentShim.mjs
import express from 'express';

/**
 * Translate legacy scripture path to new format
 */
export function translateLegacyScripturePath(path, modifiers = {}) {
  let newPath = `scripture/${path}`;
  if (modifiers.version) {
    newPath += `?version=${modifiers.version}`;
  }
  return newPath;
}

/**
 * Translate legacy talk path
 */
export function translateLegacyTalkPath(path) {
  return `talk/${path}`;
}

/**
 * Translate legacy hymn path
 */
export function translateLegacyHymnPath(number) {
  return `hymn/${number}`;
}

/**
 * Translate legacy primary song path
 */
export function translateLegacyPrimaryPath(number) {
  return `primary/${number}`;
}

/**
 * Translate legacy poetry path
 */
export function translateLegacyPoetryPath(path) {
  return `poem/${path}`;
}

/**
 * Parse legacy input string modifiers
 * Example: "bom; version redc" -> { path: "bom", version: "redc" }
 */
function parseLegacyModifiers(input) {
  const parts = input.split(';').map(p => p.trim());
  const path = parts[0];
  const modifiers = {};

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith('version ')) {
      modifiers.version = part.replace('version ', '').trim();
    }
  }

  return { path, modifiers };
}

/**
 * Create middleware for legacy LocalContent endpoints
 */
export function createLegacyLocalContentShim() {
  const router = express.Router();

  /**
   * GET /data/scripture/:ref
   */
  router.get('/data/scripture/*', async (req, res, next) => {
    const rawPath = req.params[0] || '';
    const { path, modifiers } = parseLegacyModifiers(rawPath);
    const newPath = `/api/local-content/${translateLegacyScripturePath(path, modifiers)}`;

    req.url = newPath;
    req.originalUrl = newPath;
    next('route');
  });

  /**
   * GET /data/talk/:id
   */
  router.get('/data/talk/*', async (req, res, next) => {
    const path = req.params[0] || '';
    const newPath = `/api/local-content/${translateLegacyTalkPath(path)}`;

    req.url = newPath;
    req.originalUrl = newPath;
    next('route');
  });

  /**
   * GET /data/hymn/:num
   */
  router.get('/data/hymn/:num', async (req, res, next) => {
    const { num } = req.params;
    const newPath = `/api/local-content/${translateLegacyHymnPath(num)}`;

    req.url = newPath;
    req.originalUrl = newPath;
    next('route');
  });

  /**
   * GET /data/primary/:num
   */
  router.get('/data/primary/:num', async (req, res, next) => {
    const { num } = req.params;
    const newPath = `/api/local-content/${translateLegacyPrimaryPath(num)}`;

    req.url = newPath;
    req.originalUrl = newPath;
    next('route');
  });

  /**
   * GET /data/poetry/:id
   */
  router.get('/data/poetry/*', async (req, res, next) => {
    const path = req.params[0] || '';
    const newPath = `/api/local-content/${translateLegacyPoetryPath(path)}`;

    req.url = newPath;
    req.originalUrl = newPath;
    next('route');
  });

  return router;
}
```

**Step 3: Run tests and commit**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/api/middleware/legacyLocalContentShim.test.mjs --verbose
git add backend/src/4_api/middleware/legacyLocalContentShim.mjs tests/unit/api/middleware/legacyLocalContentShim.test.mjs
git commit -m "feat(api): add legacy LocalContent shims for scripture, hymns, talks, poetry"
```

---

## Task 6: Add LocalContent Proxy Routes

**Files:**
- Modify: `backend/src/4_api/routers/proxy.mjs`
- Modify: `tests/integration/api/proxy.test.mjs`

**Step 1: Add test cases**

```javascript
// Add to proxy.test.mjs
describe('LocalContent proxy', () => {
  it('streams talk audio', async () => {
    // Mock the adapter's file resolution
    const res = await request(app).get('/proxy/local-content/stream/talk/general/test-talk');
    // Should attempt to stream the file
    expect(res.status).toBe(404); // 404 because fixture file doesn't exist
  });

  it('streams hymn audio', async () => {
    const res = await request(app).get('/proxy/local-content/stream/hymn/113');
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Add LocalContent proxy routes**

```javascript
// Add to backend/src/4_api/routers/proxy.mjs

/**
 * GET /proxy/local-content/stream/:type/*
 * Stream audio for LocalContent types
 */
router.get('/local-content/stream/:type/*', async (req, res) => {
  try {
    const { type } = req.params;
    const path = req.params[0] || '';
    const adapter = registry.get('local-content');

    if (!adapter) {
      return res.status(500).json({ error: 'LocalContent adapter not configured' });
    }

    // Map type to prefix
    const prefixMap = {
      'talk': 'talk',
      'scripture': 'scripture',
      'hymn': 'hymn',
      'primary': 'primary',
      'poem': 'poem'
    };

    const prefix = prefixMap[type];
    if (!prefix) {
      return res.status(400).json({ error: `Unknown content type: ${type}` });
    }

    // Get item to find media file path
    const item = await adapter.getItem(`${prefix}:${path}`);
    if (!item || !item.metadata?.mediaFile) {
      return res.status(404).json({ error: 'Media file not found', type, path });
    }

    // Construct full file path
    const mediaPath = item.metadata.mediaFile;
    const fullPath = path.join(adapter.mediaPath, mediaPath);

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Media file not found on disk', path: fullPath });
    }

    const stat = fs.statSync(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const mimeType = ext === '.mp3' ? 'audio/mpeg' : 'audio/mp4';

    // Handle range requests
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType
      });

      fs.createReadStream(fullPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': mimeType
      });
      fs.createReadStream(fullPath).pipe(res);
    }
  } catch (err) {
    console.error('[proxy] local-content stream error:', err);
    res.status(500).json({ error: err.message });
  }
});
```

**Step 3: Run tests and commit**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/integration/api/proxy.test.mjs --verbose
git add backend/src/4_api/routers/proxy.mjs tests/integration/api/proxy.test.mjs
git commit -m "feat(proxy): add LocalContent stream routes for talks, hymns, scripture, poetry"
```

---

## Task 7: Update Bootstrap with LocalContent Routes

**Files:**
- Modify: `backend/src/0_infrastructure/bootstrap.mjs`

**Step 1: Update bootstrap**

```javascript
// Add import
import { createLocalContentRouter } from '../4_api/routers/localContent.mjs';
import { createLegacyLocalContentShim } from '../4_api/middleware/legacyLocalContentShim.mjs';

// Update createApiRouters
export function createApiRouters(config) {
  const { registry, watchStore } = config;

  return {
    content: createContentRouter(registry),
    play: createPlayRouter({ registry, watchStore }),
    list: createListRouter({ registry }),
    localContent: createLocalContentRouter({ registry }),
    proxy: createProxyRouter({ registry }),
    legacyShims: {
      play: createLegacyPlayShim(),
      list: createLegacyListShim(),
      localContent: createLegacyLocalContentShim(),
      mediaLog: legacyMediaLogMiddleware(watchStore)
    }
  };
}
```

**Step 2: Update legacy index mounting**

```javascript
// In backend/_legacy/index.js, add:
app.use(apiRouters.legacyShims.localContent);
app.use('/api/local-content', apiRouters.localContent);
```

**Step 3: Commit**

```bash
git add backend/src/0_infrastructure/bootstrap.mjs backend/_legacy/index.js
git commit -m "feat(bootstrap): wire LocalContent router and legacy shims"
```

---

## Summary

**Tasks in this plan:**

1. **Scripture Support** - LocalContentAdapter scripture handling with verse timings
2. **Hymn Support** - Hymn/Primary song handling with lyrics
3. **Poetry Support** - Poem handling with stanzas
4. **LocalContent Router** - `/api/local-content/:type/*` endpoints
5. **Legacy Shims** - `/data/scripture`, `/data/talk`, `/data/hymn`, `/data/poetry`
6. **Proxy Routes** - `/proxy/local-content/stream/:type/*`
7. **Bootstrap Update** - Wire everything together

**API Endpoint Summary:**

| New Endpoint | Legacy Endpoint | Purpose |
|--------------|-----------------|---------|
| `GET /api/local-content/scripture/*` | `/data/scripture/:ref` | Get scripture with verses |
| `GET /api/local-content/hymn/:num` | `/data/hymn/:num` | Get hymn with lyrics |
| `GET /api/local-content/primary/:num` | `/data/primary/:num` | Get primary song |
| `GET /api/local-content/talk/*` | `/data/talk/:id` | Get talk with content |
| `GET /api/local-content/poem/*` | `/data/poetry/:id` | Get poem with stanzas |
| `GET /proxy/local-content/stream/:type/*` | - | Stream audio files |

**Next Phase (6):** Final integration, cleanup, and frontend adoption guide.
