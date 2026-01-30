# Media Key Resolver Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a MediaKeyResolver that normalizes media keys at the application boundary, fixing the bug where data written as `plex:11282` cannot be read back.

**Architecture:** Domain service in `1_domains/media/` injected into adapters and services at bootstrap. Resolution uses per-app configuration from `/data/system/config/media.yml` with heuristic pattern matching.

**Tech Stack:** Node.js ES modules, YAML configuration, Jest for testing

---

## Task 1: Create Error Classes

**Files:**
- Create: `backend/src/1_domains/media/errors.mjs`

**Step 1: Write the error classes**

```javascript
// backend/src/1_domains/media/errors.mjs

/**
 * Thrown when a media key uses an unrecognized source prefix
 */
export class UnknownMediaSourceError extends Error {
  constructor(source, knownSources = []) {
    super(`Unknown media source: '${source}'. Known sources: ${knownSources.join(', ')}`);
    this.name = 'UnknownMediaSourceError';
    this.source = source;
    this.knownSources = knownSources;
  }
}

/**
 * Thrown when a media key cannot be resolved in the given context
 */
export class UnresolvableMediaKeyError extends Error {
  constructor(key, appContext) {
    super(`Cannot resolve media key: '${key}' in context '${appContext || 'default'}'`);
    this.name = 'UnresolvableMediaKeyError';
    this.key = key;
    this.appContext = appContext;
  }
}
```

**Step 2: Commit**

```bash
git add backend/src/1_domains/media/errors.mjs
git commit -m "feat(media): add MediaKeyResolver error classes"
```

---

## Task 2: Create MediaKeyResolver Core Class

**Files:**
- Create: `backend/src/1_domains/media/MediaKeyResolver.mjs`

**Step 1: Write the resolver class**

```javascript
// backend/src/1_domains/media/MediaKeyResolver.mjs

import { UnknownMediaSourceError, UnresolvableMediaKeyError } from './errors.mjs';

/**
 * Resolves bare media keys to compound format (source:id) using
 * context-aware heuristics and per-app configuration.
 */
export class MediaKeyResolver {
  /**
   * @param {Object} config - mediaKeyResolution config from media.yml
   * @param {string[]} config.knownSources - Valid source prefixes
   * @param {Object} config.defaults - Default patterns and fallback chain
   * @param {Object} config.apps - Per-app resolution overrides
   */
  constructor(config = {}) {
    this.knownSources = config.knownSources || ['plex', 'folder', 'filesystem'];
    this.defaults = config.defaults || {
      patterns: [{ match: '^\\d+$', source: 'plex' }],
      fallbackChain: ['plex', 'folder', 'filesystem']
    };
    this.apps = config.apps || {};
  }

  /**
   * Check if a key is already in compound format (source:id)
   * @param {string} key
   * @returns {boolean}
   */
  isCompound(key) {
    if (!key || typeof key !== 'string') return false;
    const colonIndex = key.indexOf(':');
    if (colonIndex === -1) return false;
    const prefix = key.substring(0, colonIndex);
    return this.knownSources.includes(prefix);
  }

  /**
   * Parse a compound key into source and id
   * @param {string} compoundKey
   * @returns {{ source: string, id: string }}
   */
  parse(compoundKey) {
    if (!compoundKey || typeof compoundKey !== 'string') {
      return { source: null, id: compoundKey };
    }
    const colonIndex = compoundKey.indexOf(':');
    if (colonIndex === -1) {
      return { source: null, id: compoundKey };
    }
    return {
      source: compoundKey.substring(0, colonIndex),
      id: compoundKey.substring(colonIndex + 1)
    };
  }

  /**
   * Get resolution rules for an app context
   * @param {string|null} appContext
   * @returns {Object} Resolution rules with patterns, defaultSource, fallbackChain
   */
  getRulesForApp(appContext) {
    if (appContext && this.apps[appContext]) {
      // Merge app-specific rules with defaults
      const appRules = this.apps[appContext];
      return {
        defaultSource: appRules.defaultSource || null,
        patterns: appRules.patterns || this.defaults.patterns || [],
        fallbackChain: appRules.fallbackChain || this.defaults.fallbackChain || []
      };
    }
    return {
      defaultSource: null,
      patterns: this.defaults.patterns || [],
      fallbackChain: this.defaults.fallbackChain || []
    };
  }

  /**
   * Match a key against patterns to determine source
   * @param {string} key
   * @param {Array} patterns
   * @returns {string|null} Matched source or null
   */
  _matchPattern(key, patterns) {
    for (const { match, source } of patterns) {
      try {
        if (new RegExp(match).test(key)) {
          return source;
        }
      } catch (e) {
        // Invalid regex, skip
      }
    }
    return null;
  }

  /**
   * Resolve a key to compound format
   * @param {string} key - Bare or compound key
   * @param {string|null} appContext - App context for resolution rules
   * @returns {string} Compound key (source:id)
   * @throws {UnknownMediaSourceError} If key has unknown source prefix
   * @throws {UnresolvableMediaKeyError} If key cannot be resolved
   */
  resolve(key, appContext = null) {
    if (!key || typeof key !== 'string' || key.trim() === '') {
      throw new UnresolvableMediaKeyError(key, appContext);
    }

    // 1. Already compound with known source? Return as-is
    if (this.isCompound(key)) {
      return key;
    }

    // 2. Has colon but unknown source? Throw error
    if (key.includes(':')) {
      const [source] = key.split(':');
      throw new UnknownMediaSourceError(source, this.knownSources);
    }

    // 3. Get rules for this app context
    const rules = this.getRulesForApp(appContext);

    // 4. App has defaultSource? Use it
    if (rules.defaultSource) {
      return `${rules.defaultSource}:${key}`;
    }

    // 5. Pattern match
    const matchedSource = this._matchPattern(key, rules.patterns);
    if (matchedSource) {
      return `${matchedSource}:${key}`;
    }

    // 6. Use first in fallback chain
    if (rules.fallbackChain && rules.fallbackChain.length > 0) {
      return `${rules.fallbackChain[0]}:${key}`;
    }

    throw new UnresolvableMediaKeyError(key, appContext);
  }

  /**
   * Soft resolve - returns null instead of throwing
   * @param {string} key
   * @param {string|null} appContext
   * @returns {string|null}
   */
  tryResolve(key, appContext = null) {
    try {
      return this.resolve(key, appContext);
    } catch {
      return null;
    }
  }

  /**
   * Resolve with explicit source hint (bypass patterns)
   * @param {string} key
   * @param {string} source
   * @returns {string}
   * @throws {UnknownMediaSourceError} If source is not known
   */
  resolveAs(key, source) {
    if (!this.knownSources.includes(source)) {
      throw new UnknownMediaSourceError(source, this.knownSources);
    }
    // If already compound, extract the id and re-prefix
    const { id } = this.isCompound(key) ? this.parse(key) : { id: key };
    return `${source}:${id}`;
  }
}

export default MediaKeyResolver;
```

**Step 2: Commit**

```bash
git add backend/src/1_domains/media/MediaKeyResolver.mjs
git commit -m "feat(media): add MediaKeyResolver core class"
```

---

## Task 3: Write Unit Tests for MediaKeyResolver

**Files:**
- Create: `backend/src/1_domains/media/MediaKeyResolver.test.mjs`

**Step 1: Write comprehensive unit tests**

```javascript
// backend/src/1_domains/media/MediaKeyResolver.test.mjs

import { describe, it, expect, beforeEach } from '@jest/globals';
import { MediaKeyResolver } from './MediaKeyResolver.mjs';
import { UnknownMediaSourceError, UnresolvableMediaKeyError } from './errors.mjs';

describe('MediaKeyResolver', () => {
  let resolver;

  beforeEach(() => {
    resolver = new MediaKeyResolver({
      knownSources: ['plex', 'folder', 'filesystem', 'immich', 'youtube'],
      defaults: {
        patterns: [
          { match: '^\\d+$', source: 'plex' },
          { match: '^[a-f0-9-]{36}$', source: 'immich' },
          { match: '^[A-Za-z0-9_-]{11}$', source: 'youtube' },
          { match: '/', source: 'filesystem' }
        ],
        fallbackChain: ['plex', 'folder', 'filesystem']
      },
      apps: {
        fitness: { defaultSource: 'plex' },
        media: {
          patterns: [
            { match: '^\\d+$', source: 'plex' },
            { match: '^[a-z][a-z0-9-]*$', source: 'folder' }
          ],
          fallbackChain: ['plex', 'folder']
        }
      }
    });
  });

  describe('isCompound()', () => {
    it('returns true for known source prefixes', () => {
      expect(resolver.isCompound('plex:11282')).toBe(true);
      expect(resolver.isCompound('folder:fhe')).toBe(true);
      expect(resolver.isCompound('filesystem:path/to/file')).toBe(true);
    });

    it('returns false for bare keys', () => {
      expect(resolver.isCompound('11282')).toBe(false);
      expect(resolver.isCompound('fhe')).toBe(false);
    });

    it('returns false for unknown prefixes', () => {
      expect(resolver.isCompound('bogus:123')).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(resolver.isCompound(null)).toBe(false);
      expect(resolver.isCompound(undefined)).toBe(false);
    });
  });

  describe('parse()', () => {
    it('splits source and id', () => {
      expect(resolver.parse('plex:11282')).toEqual({ source: 'plex', id: '11282' });
      expect(resolver.parse('folder:fhe')).toEqual({ source: 'folder', id: 'fhe' });
    });

    it('handles ids containing colons', () => {
      expect(resolver.parse('filesystem:path/to:file')).toEqual({
        source: 'filesystem',
        id: 'path/to:file'
      });
    });

    it('returns null source for bare keys', () => {
      expect(resolver.parse('11282')).toEqual({ source: null, id: '11282' });
    });
  });

  describe('resolve()', () => {
    it('passes through compound keys unchanged', () => {
      expect(resolver.resolve('plex:11282')).toBe('plex:11282');
      expect(resolver.resolve('folder:fhe')).toBe('folder:fhe');
    });

    it('uses app defaultSource when configured', () => {
      expect(resolver.resolve('11282', 'fitness')).toBe('plex:11282');
      expect(resolver.resolve('any-key', 'fitness')).toBe('plex:any-key');
    });

    it('matches numeric pattern to plex', () => {
      expect(resolver.resolve('99999')).toBe('plex:99999');
      expect(resolver.resolve('12345', 'media')).toBe('plex:12345');
    });

    it('matches slug pattern to folder in media context', () => {
      expect(resolver.resolve('conference-talks', 'media')).toBe('folder:conference-talks');
    });

    it('matches UUID pattern to immich', () => {
      expect(resolver.resolve('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe('immich:a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    });

    it('matches 11-char pattern to youtube', () => {
      expect(resolver.resolve('dQw4w9WgXcQ')).toBe('youtube:dQw4w9WgXcQ');
    });

    it('matches path with slash to filesystem', () => {
      expect(resolver.resolve('path/to/file')).toBe('filesystem:path/to/file');
    });

    it('throws UnknownMediaSourceError for unknown source prefix', () => {
      expect(() => resolver.resolve('bogus:123')).toThrow(UnknownMediaSourceError);
      expect(() => resolver.resolve('bogus:123')).toThrow(/Unknown media source: 'bogus'/);
    });

    it('throws UnresolvableMediaKeyError for empty key', () => {
      expect(() => resolver.resolve('')).toThrow(UnresolvableMediaKeyError);
      expect(() => resolver.resolve(null)).toThrow(UnresolvableMediaKeyError);
    });

    it('uses fallback chain when no pattern matches', () => {
      // 'ABC' doesn't match any pattern in default config
      const minimalResolver = new MediaKeyResolver({
        knownSources: ['plex'],
        defaults: { patterns: [], fallbackChain: ['plex'] }
      });
      expect(minimalResolver.resolve('ABC')).toBe('plex:ABC');
    });
  });

  describe('tryResolve()', () => {
    it('returns resolved key on success', () => {
      expect(resolver.tryResolve('11282', 'fitness')).toBe('plex:11282');
    });

    it('returns null on failure', () => {
      expect(resolver.tryResolve('bogus:123')).toBeNull();
      expect(resolver.tryResolve('')).toBeNull();
    });
  });

  describe('resolveAs()', () => {
    it('resolves bare key with explicit source', () => {
      expect(resolver.resolveAs('11282', 'folder')).toBe('folder:11282');
    });

    it('re-prefixes compound key with new source', () => {
      expect(resolver.resolveAs('plex:11282', 'folder')).toBe('folder:11282');
    });

    it('throws for unknown source', () => {
      expect(() => resolver.resolveAs('123', 'bogus')).toThrow(UnknownMediaSourceError);
    });
  });

  describe('getRulesForApp()', () => {
    it('returns app-specific rules when configured', () => {
      const rules = resolver.getRulesForApp('fitness');
      expect(rules.defaultSource).toBe('plex');
    });

    it('returns defaults for unconfigured app', () => {
      const rules = resolver.getRulesForApp('unknown-app');
      expect(rules.defaultSource).toBeNull();
      expect(rules.patterns.length).toBeGreaterThan(0);
    });

    it('returns defaults when no context provided', () => {
      const rules = resolver.getRulesForApp(null);
      expect(rules.patterns).toEqual(resolver.defaults.patterns);
    });
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/src/1_domains/media/MediaKeyResolver.test.mjs --verbose`

Expected: All tests pass

**Step 3: Commit**

```bash
git add backend/src/1_domains/media/MediaKeyResolver.test.mjs
git commit -m "test(media): add MediaKeyResolver unit tests"
```

---

## Task 4: Update Domain Index Export

**Files:**
- Modify: `backend/src/1_domains/media/index.mjs`

**Step 1: Add exports**

```javascript
// backend/src/1_domains/media/index.mjs

/**
 * Media Domain
 *
 * Domain entities and value objects for media operations.
 * Note: YouTubeDownloadService moved to 3_applications/media/services (uses infrastructure)
 *
 * @module domains/media
 */

export { MediaKeyResolver } from './MediaKeyResolver.mjs';
export { UnknownMediaSourceError, UnresolvableMediaKeyError } from './errors.mjs';
```

**Step 2: Commit**

```bash
git add backend/src/1_domains/media/index.mjs
git commit -m "feat(media): export MediaKeyResolver from domain index"
```

---

## Task 5: Create System Configuration File

**Files:**
- Create: `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/system/config/media.yml`

**Step 1: Create the configuration file**

```yaml
# Media configuration
# Path: /data/system/config/media.yml

mediaKeyResolution:
  # All known media source prefixes
  knownSources:
    - plex
    - folder
    - filesystem
    - immich
    - youtube
    - audiobookshelf

  # Default resolution rules (used when no app-specific config)
  defaults:
    patterns:
      # Numeric IDs -> plex (most common)
      - match: '^\d+$'
        source: plex
      # UUIDs -> immich
      - match: '^[a-f0-9-]{36}$'
        source: immich
      # 11-char base64-like -> youtube
      - match: '^[A-Za-z0-9_-]{11}$'
        source: youtube
      # Contains slash -> filesystem path
      - match: '/'
        source: filesystem
    fallbackChain:
      - plex
      - folder
      - filesystem

  # Per-app resolution overrides
  apps:
    fitness:
      # Fitness is 100% plex-driven
      defaultSource: plex

    media:
      patterns:
        - match: '^\d+$'
          source: plex
        - match: '^[a-z][a-z0-9-]*$'
          source: folder
      fallbackChain:
        - plex
        - folder

    content:
      # Uses defaults - pattern matching
```

**Step 2: Verify the file was created**

Run: `cat /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/system/config/media.yml | head -20`

Expected: Shows the YAML content

**Step 3: Commit (in main repo, not data folder)**

This file lives in data folder, not tracked in git. No commit needed.

---

## Task 6: Write Migration Script

**Files:**
- Create: `cli/scripts/migrate-media-keys.mjs`

**Step 1: Write the migration script**

```javascript
#!/usr/bin/env node
// cli/scripts/migrate-media-keys.mjs

/**
 * One-time migration script to normalize media keys in media_memory YAML files.
 *
 * Usage:
 *   node cli/scripts/migrate-media-keys.mjs [--dry-run] [--data-path /path/to/data]
 *
 * This script:
 * 1. Backs up the media_memory directory
 * 2. Scans all YAML files for bare keys (e.g., '11282')
 * 3. Converts them to compound keys (e.g., 'plex:11282')
 * 4. Merges duplicates when both bare and compound exist
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// Parse arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dataPathIndex = args.indexOf('--data-path');
const dataPath = dataPathIndex !== -1
  ? args[dataPathIndex + 1]
  : process.env.DAYLIGHT_DATA_PATH || '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data';

const MEDIA_MEMORY_PATH = path.join(dataPath, 'household/history/media_memory');
const BACKUP_SUFFIX = `.bak.${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

/**
 * Merge two watch state entries
 */
function mergeEntries(a, b) {
  return {
    title: a.title || b.title,
    parent: a.parent || b.parent,
    parentId: a.parentId || b.parentId,
    grandparent: a.grandparent || b.grandparent,
    grandparentId: a.grandparentId || b.grandparentId,
    libraryId: a.libraryId || b.libraryId,
    mediaType: a.mediaType || b.mediaType,
    playhead: Math.max(a.playhead || 0, b.playhead || 0),
    mediaDuration: a.mediaDuration || b.mediaDuration || a.duration || b.duration,
    duration: a.duration || b.duration || a.mediaDuration || b.mediaDuration,
    percent: Math.max(a.percent || 0, b.percent || 0),
    playCount: (a.playCount || 0) + (b.playCount || 0),
    lastPlayed: [a.lastPlayed, b.lastPlayed].filter(Boolean).sort().pop() || null,
    watchTime: (a.watchTime || 0) + (b.watchTime || 0)
  };
}

/**
 * Determine the source prefix for a storage path
 */
function getSourceForPath(storagePath) {
  if (storagePath.includes('plex')) return 'plex';
  if (storagePath.includes('folder')) return 'folder';
  if (storagePath.includes('filesystem')) return 'filesystem';
  return 'plex'; // Default fallback
}

/**
 * Check if a key is a bare key (not compound)
 */
function isBareKey(key) {
  const knownPrefixes = ['plex:', 'folder:', 'filesystem:', 'immich:', 'youtube:', 'audiobookshelf:'];
  return !knownPrefixes.some(prefix => key.startsWith(prefix));
}

/**
 * Normalize a bare key to remove quotes
 */
function normalizeBareKey(key) {
  // Remove surrounding quotes if present
  if ((key.startsWith("'") && key.endsWith("'")) ||
      (key.startsWith('"') && key.endsWith('"'))) {
    return key.slice(1, -1);
  }
  return key;
}

/**
 * Process a single YAML file
 */
function processFile(filePath, source) {
  const content = fs.readFileSync(filePath, 'utf8');
  const data = yaml.load(content) || {};

  const normalized = {};
  const stats = { bare: 0, compound: 0, merged: 0 };

  for (const [key, value] of Object.entries(data)) {
    const bareKey = normalizeBareKey(key);

    if (isBareKey(bareKey)) {
      // This is a bare key - convert to compound
      const compoundKey = `${source}:${bareKey}`;
      stats.bare++;

      if (normalized[compoundKey]) {
        // Merge with existing compound entry
        normalized[compoundKey] = mergeEntries(normalized[compoundKey], value);
        stats.merged++;
      } else {
        normalized[compoundKey] = value;
      }
    } else {
      // Already compound
      stats.compound++;

      if (normalized[key]) {
        // Merge duplicate compound keys
        normalized[key] = mergeEntries(normalized[key], value);
        stats.merged++;
      } else {
        normalized[key] = value;
      }
    }
  }

  return { normalized, stats };
}

/**
 * Main migration function
 */
async function migrate() {
  console.log('Media Key Migration Script');
  console.log('==========================');
  console.log(`Data path: ${dataPath}`);
  console.log(`Media memory path: ${MEDIA_MEMORY_PATH}`);
  console.log(`Dry run: ${dryRun}`);
  console.log('');

  // Check if media_memory exists
  if (!fs.existsSync(MEDIA_MEMORY_PATH)) {
    console.error(`ERROR: Media memory path not found: ${MEDIA_MEMORY_PATH}`);
    process.exit(1);
  }

  // Create backup
  const backupPath = `${MEDIA_MEMORY_PATH}${BACKUP_SUFFIX}`;
  if (!dryRun) {
    console.log(`Creating backup at: ${backupPath}`);
    fs.cpSync(MEDIA_MEMORY_PATH, backupPath, { recursive: true });
    console.log('Backup created successfully\n');
  } else {
    console.log(`[DRY RUN] Would backup to: ${backupPath}\n`);
  }

  // Find all YAML files
  const processDir = (dir, relativePath = '') => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let totalStats = { files: 0, bare: 0, compound: 0, merged: 0 };

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        const subStats = processDir(fullPath, relPath);
        totalStats.files += subStats.files;
        totalStats.bare += subStats.bare;
        totalStats.compound += subStats.compound;
        totalStats.merged += subStats.merged;
      } else if (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')) {
        console.log(`Processing: ${relPath}`);

        const source = getSourceForPath(relPath);
        const { normalized, stats } = processFile(fullPath, source);

        console.log(`  Source: ${source}, Bare: ${stats.bare}, Compound: ${stats.compound}, Merged: ${stats.merged}`);

        if (!dryRun && stats.bare > 0) {
          const newContent = yaml.dump(normalized, {
            lineWidth: -1,
            quotingType: "'",
            forceQuotes: false
          });
          fs.writeFileSync(fullPath, newContent);
          console.log(`  Written: ${Object.keys(normalized).length} entries`);
        }

        totalStats.files++;
        totalStats.bare += stats.bare;
        totalStats.compound += stats.compound;
        totalStats.merged += stats.merged;
      }
    }

    return totalStats;
  };

  const stats = processDir(MEDIA_MEMORY_PATH);

  console.log('\n==========================');
  console.log('Migration Summary:');
  console.log(`  Files processed: ${stats.files}`);
  console.log(`  Bare keys converted: ${stats.bare}`);
  console.log(`  Compound keys (unchanged): ${stats.compound}`);
  console.log(`  Entries merged: ${stats.merged}`);

  if (dryRun) {
    console.log('\n[DRY RUN] No changes made. Run without --dry-run to apply changes.');
  } else {
    console.log('\nMigration complete!');
    console.log(`Backup available at: ${backupPath}`);
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
```

**Step 2: Make executable and test dry run**

Run: `chmod +x cli/scripts/migrate-media-keys.mjs && node cli/scripts/migrate-media-keys.mjs --dry-run`

Expected: Shows dry run output with file stats

**Step 3: Commit**

```bash
git add cli/scripts/migrate-media-keys.mjs
git commit -m "feat(cli): add media key migration script"
```

---

## Task 7: Wire MediaKeyResolver into Bootstrap

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`

**Step 1: Add import at top of file (after existing imports around line 30)**

Find the content domain imports section and add:

```javascript
import { MediaKeyResolver } from '#domains/media/MediaKeyResolver.mjs';
```

**Step 2: Create resolver instance in createContentDomain function**

In the `createContentDomain` function, after ConfigService is available, add:

```javascript
  // Load media config and create resolver
  const mediaConfig = configService.get('system', 'media') || {};
  const mediaKeyResolver = new MediaKeyResolver(mediaConfig.mediaKeyResolution || {});
```

**Step 3: Inject resolver into YamlMediaProgressMemory**

Update the YamlMediaProgressMemory instantiation to include the resolver:

```javascript
  const mediaProgressMemory = new YamlMediaProgressMemory({
    basePath: path.join(dataPath, 'household/history/media_memory'),
    mediaKeyResolver
  });
```

**Step 4: Inject resolver into PlexAdapter**

Find where PlexAdapter is instantiated and add `mediaKeyResolver`:

```javascript
  const plexAdapter = new PlexAdapter({
    // ... existing config
    mediaKeyResolver
  });
```

**Step 5: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "feat(bootstrap): wire MediaKeyResolver into content domain"
```

---

## Task 8: Update YamlMediaProgressMemory to Accept Resolver

**Files:**
- Modify: `backend/src/2_adapters/persistence/yaml/YamlMediaProgressMemory.mjs`

**Step 1: Update constructor to accept resolver**

```javascript
  constructor(config) {
    super();
    if (!config.basePath) throw new InfrastructureError('YamlMediaProgressMemory requires basePath', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'basePath'
      });
    this.basePath = config.basePath;
    this.mediaKeyResolver = config.mediaKeyResolver || null;
  }
```

**Step 2: Commit**

```bash
git add backend/src/2_adapters/persistence/yaml/YamlMediaProgressMemory.mjs
git commit -m "feat(adapter): accept MediaKeyResolver in YamlMediaProgressMemory"
```

---

## Task 9: Update PlexAdapter to Use Resolver

**Files:**
- Modify: `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs`

**Step 1: Store resolver in constructor**

Find the constructor and add:

```javascript
    this.mediaKeyResolver = config.mediaKeyResolver || null;
```

**Step 2: Update _loadViewingHistoryAsync to preserve compound keys**

Replace the key stripping logic (around line 850):

```javascript
  async _loadViewingHistoryAsync(storagePath = 'plex') {
    if (!this.mediaProgressMemory) {
      return {};
    }

    try {
      const states = await this.mediaProgressMemory.getAll(storagePath);
      const history = {};
      for (const state of states) {
        // Use resolver to parse compound key, or strip prefix as fallback
        let bareKey;
        if (this.mediaKeyResolver) {
          const { id } = this.mediaKeyResolver.parse(state.itemId);
          bareKey = id;
        } else {
          bareKey = state.itemId.replace(/^plex:/, '');
        }
        history[bareKey] = {
          playhead: state.playhead || 0,
          percent: state.percent || 0,
          lastPlayed: state.lastPlayed || null,
          mediaDuration: state.duration || 0
        };
      }
      return history;
    } catch (e) {
      console.error('[PlexAdapter] Error loading history from mediaProgressMemory:', e.message);
      return {};
    }
  }
```

**Step 3: Commit**

```bash
git add backend/src/2_adapters/content/media/plex/PlexAdapter.mjs
git commit -m "feat(plex): use MediaKeyResolver for history loading"
```

---

## Task 10: Run Migration and Verify

**Step 1: Run migration with dry-run first**

Run: `node cli/scripts/migrate-media-keys.mjs --dry-run`

Expected: Shows summary of what would be changed

**Step 2: Run actual migration**

Run: `node cli/scripts/migrate-media-keys.mjs`

Expected: Migration completes, backup created

**Step 3: Verify data was migrated**

Run: `grep "11282" /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/history/media_memory/plex/14_fitness.yml | head -5`

Expected: Shows only `plex:11282:` format, no bare `'11282':` keys

**Step 4: Test the API endpoint**

Run: `curl -s 'https://daylightlocal.kckern.net/api/v1/fitness/show/11253/playable' | python3 -c "import json,sys; d=json.load(sys.stdin); burn=[i for i in d['items'] if i.get('key')==11282]; print(json.dumps(burn[0] if burn else 'NOT FOUND', indent=2))" | head -20`

Expected: Shows `resumeSeconds`, `watchProgress` fields populated

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat(media): complete MediaKeyResolver integration

- Migration script run successfully
- Watch state now correctly retrieved from normalized keys
- Verified fitness/show/11253/playable returns correct data"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Error classes | `1_domains/media/errors.mjs` |
| 2 | MediaKeyResolver class | `1_domains/media/MediaKeyResolver.mjs` |
| 3 | Unit tests | `1_domains/media/MediaKeyResolver.test.mjs` |
| 4 | Domain exports | `1_domains/media/index.mjs` |
| 5 | System config | `data/system/config/media.yml` |
| 6 | Migration script | `cli/scripts/migrate-media-keys.mjs` |
| 7 | Bootstrap wiring | `0_system/bootstrap.mjs` |
| 8 | YamlMediaProgressMemory | `2_adapters/persistence/yaml/YamlMediaProgressMemory.mjs` |
| 9 | PlexAdapter | `2_adapters/content/media/plex/PlexAdapter.mjs` |
| 10 | Migration & verification | Run scripts, verify API |
