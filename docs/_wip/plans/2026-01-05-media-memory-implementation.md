# Media Memory Data Model Redesign - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure media_memory to use library ID prefixed filenames, structured parent/grandparent fields, and daily validation cron.

**Architecture:** Files change from `fitness.yml` to `14_fitness.yml`. Entries gain `parent`, `parentId`, `grandparent`, `grandparentId`, `libraryId` fields. Daily cron validates IDs and auto-backfills orphans.

**Tech Stack:** Node.js, YAML, Plex API, string-similarity for matching

---

## Task 1: Add New mediaMemory Helpers

**Files:**
- Modify: `backend/lib/mediaMemory.mjs`
- Create: `tests/unit/mediaMemory.unit.test.mjs`

**Step 1: Write failing tests for new helpers**

Create `tests/unit/mediaMemory.unit.test.mjs`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseLibraryFilename,
  buildLibraryFilename,
  getMediaMemoryFiles
} from '../../backend/lib/mediaMemory.mjs';

describe('mediaMemory helpers', () => {
  describe('parseLibraryFilename', () => {
    it('parses ID and name from filename', () => {
      const result = parseLibraryFilename('14_fitness.yml');
      assert.deepStrictEqual(result, { libraryId: 14, libraryName: 'fitness' });
    });

    it('returns null for legacy filename without ID', () => {
      const result = parseLibraryFilename('fitness.yml');
      assert.strictEqual(result, null);
    });

    it('handles names with underscores', () => {
      const result = parseLibraryFilename('2_tv_shows.yml');
      assert.deepStrictEqual(result, { libraryId: 2, libraryName: 'tv_shows' });
    });
  });

  describe('buildLibraryFilename', () => {
    it('builds filename from ID and name', () => {
      const result = buildLibraryFilename(14, 'fitness');
      assert.strictEqual(result, '14_fitness.yml');
    });

    it('slugifies name', () => {
      const result = buildLibraryFilename(1, 'My Movies');
      assert.strictEqual(result, '1_my-movies.yml');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test tests/unit/mediaMemory.unit.test.mjs`
Expected: FAIL with "parseLibraryFilename is not exported"

**Step 3: Implement the helpers**

Add to `backend/lib/mediaMemory.mjs`:

```javascript
import slugify from 'slugify';

/**
 * Parse library ID and name from filename like "14_fitness.yml"
 * @param {string} filename - Filename to parse
 * @returns {{libraryId: number, libraryName: string}|null} Parsed components or null if legacy format
 */
export const parseLibraryFilename = (filename) => {
    const match = filename.match(/^(\d+)_(.+)\.ya?ml$/);
    if (!match) return null;
    return {
        libraryId: parseInt(match[1], 10),
        libraryName: match[2]
    };
};

/**
 * Build filename from library ID and name
 * @param {number} libraryId - Library section ID
 * @param {string} libraryName - Library name (will be slugified)
 * @returns {string} Filename like "14_fitness.yml"
 */
export const buildLibraryFilename = (libraryId, libraryName) => {
    const slug = slugify(libraryName, { lower: true, strict: true });
    return `${libraryId}_${slug}.yml`;
};

/**
 * Get all media memory files in plex directory
 * @param {string|null} householdId - Optional household ID
 * @returns {Array<{path: string, libraryId: number|null, libraryName: string}>} File info array
 */
export const getMediaMemoryFiles = (householdId = null) => {
    const plexDir = path.join(getMediaMemoryDir(householdId), 'plex');
    if (!fs.existsSync(plexDir)) return [];

    return fs.readdirSync(plexDir)
        .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
        .filter(f => !f.startsWith('_')) // Exclude _archive, _logs
        .map(f => {
            const parsed = parseLibraryFilename(f);
            return {
                path: path.join(plexDir, f),
                filename: f,
                libraryId: parsed?.libraryId || null,
                libraryName: parsed?.libraryName || f.replace(/\.ya?ml$/, '')
            };
        });
};
```

**Step 4: Run tests to verify they pass**

Run: `node --test tests/unit/mediaMemory.unit.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/lib/mediaMemory.mjs tests/unit/mediaMemory.unit.test.mjs
git commit -m "feat(mediaMemory): add library filename helpers

- parseLibraryFilename: extract ID and name from 14_fitness.yml format
- buildLibraryFilename: create filename from ID and name
- getMediaMemoryFiles: list all media memory files with metadata"
```

---

## Task 2: Create Migration Script Structure

**Files:**
- Create: `scripts/migrate-media-memory.mjs`

**Step 1: Create script with CLI structure and dry-run mode**

Create `scripts/migrate-media-memory.mjs`:

```javascript
#!/usr/bin/env node

/**
 * Migrate media_memory files to new format
 *
 * Changes:
 * - Filename: fitness.yml → 14_fitness.yml (library ID prefix)
 * - Entry: Add parent, parentId, grandparent, grandparentId, libraryId
 * - Preserve: oldPlexIds for backfilled entries
 *
 * Usage:
 *   node scripts/migrate-media-memory.mjs --dry-run    # Preview
 *   node scripts/migrate-media-memory.mjs              # Execute
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { createLogger } from '../backend/lib/logging/logger.js';
import { configService } from '../backend/lib/config/ConfigService.mjs';
import { resolveConfigPaths } from '../backend/lib/config/pathResolver.mjs';
import { hydrateProcessEnvFromConfigs } from '../backend/lib/logging/config.js';
import { getMediaMemoryDir, buildLibraryFilename } from '../backend/lib/mediaMemory.mjs';

// Bootstrap config
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDocker = existsSync('/.dockerenv');
const configPaths = resolveConfigPaths({ isDocker, codebaseDir: path.join(__dirname, '..') });

if (configPaths.error) {
    console.error('Config error:', configPaths.error);
    process.exit(1);
}

hydrateProcessEnvFromConfigs(configPaths.configDir);
configService.init({ dataDir: configPaths.dataDir });

const logger = createLogger({ source: 'script', app: 'migrate-media-memory' });

// Parse arguments
const args = process.argv.slice(2);
const flags = {
    dryRun: !args.includes('--apply'),
    verbose: args.includes('--verbose') || args.includes('-v')
};

async function main() {
    console.log('='.repeat(70));
    console.log('Media Memory Migration Script');
    console.log('='.repeat(70));

    if (flags.dryRun) {
        console.log('DRY RUN MODE - no changes will be made');
        console.log('Use --apply to execute migration\n');
    }

    const plexDir = path.join(getMediaMemoryDir(), 'plex');

    if (!fs.existsSync(plexDir)) {
        console.error(`Plex directory not found: ${plexDir}`);
        process.exit(1);
    }

    // Find legacy files (no ID prefix)
    const files = fs.readdirSync(plexDir)
        .filter(f => (f.endsWith('.yml') || f.endsWith('.yaml')))
        .filter(f => !f.startsWith('_'))
        .filter(f => !/^\d+_/.test(f)); // Only legacy format

    if (files.length === 0) {
        console.log('No legacy files found. Migration may already be complete.');
        return;
    }

    console.log(`Found ${files.length} legacy file(s) to migrate: ${files.join(', ')}\n`);

    // TODO: Implement migration logic in Task 3
    console.log('Migration logic not yet implemented.');
}

main().catch(err => {
    console.error('Error:', err.message);
    logger.error('Migration failed', { error: err.message });
    process.exit(1);
});
```

**Step 2: Verify script runs**

Run: `node scripts/migrate-media-memory.mjs --dry-run`
Expected: Lists legacy files, shows "DRY RUN MODE"

**Step 3: Commit**

```bash
git add scripts/migrate-media-memory.mjs
git commit -m "feat(migration): add migrate-media-memory script structure

CLI with --dry-run/--apply flags, config bootstrap, legacy file detection"
```

---

## Task 3: Implement Migration Logic

**Files:**
- Modify: `scripts/migrate-media-memory.mjs`

**Step 1: Add Plex client for fetching library info**

Add after imports in `scripts/migrate-media-memory.mjs`:

```javascript
import axios from '../backend/lib/http.mjs';

class PlexClient {
    constructor() {
        const auth = configService.getHouseholdAuth('plex') || {};
        this.token = auth.token;
        const { plex: plexEnv } = process.env;
        this.host = auth.server_url?.replace(/:\d+$/, '') || plexEnv?.host;
        this.port = plexEnv?.port;
        this.baseUrl = this.port ? `${this.host}:${this.port}` : this.host;
    }

    async fetch(endpoint) {
        const url = `${this.baseUrl}/${endpoint}`;
        const separator = url.includes('?') ? '&' : '?';
        const fullUrl = `${url}${separator}X-Plex-Token=${this.token}`;

        try {
            const response = await axios.get(fullUrl, {
                headers: { Accept: 'application/json' }
            });
            return response.data;
        } catch (error) {
            if (error.response?.status === 404) return null;
            throw error;
        }
    }

    async checkConnectivity() {
        try {
            const data = await this.fetch('identity');
            return data?.MediaContainer?.machineIdentifier ? true : false;
        } catch {
            return false;
        }
    }

    async getLibraries() {
        const data = await this.fetch('library/sections');
        return data?.MediaContainer?.Directory || [];
    }

    async getMetadata(plexId) {
        const data = await this.fetch(`library/metadata/${plexId}`);
        return data?.MediaContainer?.Metadata?.[0] || null;
    }
}
```

**Step 2: Implement migration function**

Replace the TODO in main() with:

```javascript
    const plex = new PlexClient();

    // Check Plex connectivity
    console.log('Checking Plex connectivity...');
    if (!await plex.checkConnectivity()) {
        console.error('Cannot connect to Plex. Aborting.');
        process.exit(1);
    }
    console.log('Plex connected.\n');

    // Get library mapping
    const libraries = await plex.getLibraries();
    const libraryByName = {};
    for (const lib of libraries) {
        libraryByName[lib.title.toLowerCase()] = lib;
    }

    const stats = { files: 0, entries: 0, migrated: 0, orphaned: 0, errors: 0 };

    for (const file of files) {
        const filePath = path.join(plexDir, file);
        const libraryName = file.replace(/\.ya?ml$/, '');

        console.log(`\nProcessing: ${file}`);
        stats.files++;

        // Find matching library
        const library = libraryByName[libraryName.toLowerCase()];
        if (!library) {
            console.log(`  WARNING: No library found matching "${libraryName}"`);
            // Try to find by partial match
            const match = libraries.find(l =>
                l.title.toLowerCase().includes(libraryName.toLowerCase())
            );
            if (match) {
                console.log(`  Using partial match: "${match.title}" (ID: ${match.key})`);
            } else {
                console.log(`  Skipping file - no library match`);
                continue;
            }
        }

        const libraryId = parseInt(library?.key || '0', 10);
        const newFilename = buildLibraryFilename(libraryId, library?.title || libraryName);
        const newFilePath = path.join(plexDir, newFilename);

        console.log(`  Library ID: ${libraryId}`);
        console.log(`  New filename: ${newFilename}`);

        // Load and migrate entries
        const content = fs.readFileSync(filePath, 'utf8');
        const data = parseYaml(content) || {};
        const entries = Object.entries(data);
        console.log(`  Entries: ${entries.length}`);

        const migratedData = {};

        for (const [plexId, entry] of entries) {
            stats.entries++;

            // Fetch fresh metadata from Plex
            const meta = await plex.getMetadata(plexId);

            if (!meta) {
                stats.orphaned++;
                if (flags.verbose) {
                    console.log(`    [ORPHAN] ${plexId}: ${entry.title || 'unknown'}`);
                }
                // Keep entry as-is for now, validator will handle later
                migratedData[plexId] = {
                    ...entry,
                    libraryId,
                    _orphaned: true
                };
                continue;
            }

            stats.migrated++;

            // Build migrated entry
            migratedData[plexId] = {
                title: meta.title,
                parent: meta.parentTitle || null,
                parentId: meta.parentRatingKey ? parseInt(meta.parentRatingKey, 10) : null,
                grandparent: meta.grandparentTitle || null,
                grandparentId: meta.grandparentRatingKey ? parseInt(meta.grandparentRatingKey, 10) : null,
                libraryId,
                mediaType: meta.type,
                lastPlayed: entry.time || null,
                playCount: entry.playCount || 1,
                progress: entry.seconds || 0,
                duration: meta.duration ? Math.round(meta.duration / 1000) : null,
                // Preserve watch duration data
                ...(entry.watched_duration_lifetime && {
                    watchedDurationLifetime: entry.watched_duration_lifetime
                })
            };

            if (flags.verbose) {
                console.log(`    [OK] ${plexId}: ${meta.title}`);
            }
        }

        if (!flags.dryRun) {
            // Write new file
            const yaml = stringifyYaml(migratedData, { lineWidth: 0 });
            fs.writeFileSync(newFilePath, yaml, 'utf8');
            console.log(`  Wrote: ${newFilename}`);

            // Archive old file
            const archiveDir = path.join(plexDir, '_archive');
            if (!fs.existsSync(archiveDir)) {
                fs.mkdirSync(archiveDir, { recursive: true });
            }
            const archivePath = path.join(archiveDir, file);
            fs.renameSync(filePath, archivePath);
            console.log(`  Archived: ${file} → _archive/${file}`);
        }
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log(`Files processed:  ${stats.files}`);
    console.log(`Total entries:    ${stats.entries}`);
    console.log(`Migrated:         ${stats.migrated}`);
    console.log(`Orphaned:         ${stats.orphaned}`);
    console.log(`Errors:           ${stats.errors}`);

    if (flags.dryRun && stats.files > 0) {
        console.log('\nTo apply migration, run:');
        console.log('  node scripts/migrate-media-memory.mjs --apply');
    }
```

**Step 3: Test with dry-run**

Run: `node scripts/migrate-media-memory.mjs --dry-run --verbose`
Expected: Shows entries being processed, orphan detection, new filenames

**Step 4: Commit**

```bash
git add scripts/migrate-media-memory.mjs
git commit -m "feat(migration): implement media memory migration logic

- Fetch metadata from Plex for each entry
- Add parent/grandparent ID and title fields
- Add libraryId to entries
- Rename files to {libraryId}_{name}.yml format
- Archive old files to _archive/
- Mark orphaned entries for later validation"
```

---

## Task 4: Update media.mjs to Write New Format

**Files:**
- Modify: `backend/routers/media.mjs:234-290`

**Step 1: Update the /log endpoint to write new format**

Find the `/log` endpoint (around line 234) and update the entry construction:

```javascript
mediaRouter.post('/log', async (req, res) => {
    const postData = req.body;
    const { type, media_key, percent, seconds, title, watched_duration } = postData;
    if (!type || !media_key || !percent) {
        return res.status(400).json({ error: `Invalid request: Missing ${!type ? 'type' : !media_key ? 'media_key' : 'percent'}` });
    }
    try {
        if(seconds<10) return res.status(400).json({ error: `Invalid request: seconds < 10` });

        let logPath = getMediaMemoryPath(type);
        let libraryId = null;
        let meta = null;

        if (type === 'plex') {
            const plex = new Plex();
            [meta] = await plex.loadMeta(media_key);
            if (meta && meta.librarySectionID) {
                libraryId = parseInt(meta.librarySectionID, 10);
                const libraryName = slugify(meta.librarySectionTitle, { lower: true, strict: true });
                logPath = getMediaMemoryPath(`plex/${libraryId}_${libraryName}`);
            }
        }

        const log = loadFile(logPath) || {};
        const normalizedSeconds = parseInt(seconds);
        const normalizedPercent = parseFloat(percent);
        const normalizedWatched = Number.parseFloat(watched_duration);
        const watchedDurationValue = Number.isFinite(normalizedWatched) && normalizedWatched >= 0
            ? Number(normalizedWatched.toFixed(3))
            : null;

        // Get existing entry for accumulation
        const existingEntry = log[media_key] || {};
        const existingLifetime = Number.parseFloat(existingEntry.watchedDurationLifetime) || 0;
        const newLifetime = existingLifetime + (watchedDurationValue || 0);

        // Build new format entry
        const entry = {
            title: sanitizeForYAML(meta?.title || title),
            parent: meta?.parentTitle || null,
            parentId: meta?.parentRatingKey ? parseInt(meta.parentRatingKey, 10) : null,
            grandparent: meta?.grandparentTitle || null,
            grandparentId: meta?.grandparentRatingKey ? parseInt(meta.grandparentRatingKey, 10) : null,
            libraryId,
            mediaType: meta?.type || 'unknown',
            lastPlayed: moment().toISOString(),
            playCount: (existingEntry.playCount || 0) + 1,
            progress: normalizedSeconds,
            duration: meta?.duration ? Math.round(meta.duration / 1000) : null
        };

        // Add watched duration if provided
        if (watchedDurationValue != null) {
            entry.watchedDurationLastSession = watchedDurationValue;
            entry.watchedDurationLifetime = Number(newLifetime.toFixed(3));
        }

        // Preserve oldPlexIds if they exist
        if (existingEntry.oldPlexIds?.length) {
            entry.oldPlexIds = existingEntry.oldPlexIds;
        }

        // Remove null values
        Object.keys(entry).forEach(key => {
            if (entry[key] === null) delete entry[key];
        });

        log[media_key] = entry;

        // Sort by lastPlayed descending
        const sortedLog = Object.fromEntries(
            Object.entries(log).sort(([, a], [, b]) =>
                new Date(b.lastPlayed || 0) - new Date(a.lastPlayed || 0)
            )
        );

        saveFile(logPath, sortedLog);
        await logToInfinity(media_key, { percent, seconds });
        res.json({ response: { type, library: meta?.librarySectionTitle, ...log[media_key] } });
    } catch (error) {
        mediaLogger.error('Error handling /log', { message: error.message });
        res.status(500).json({ error: 'Failed to process log.' });
    }
});
```

**Step 2: Add slugify import at top of file**

```javascript
import slugify from 'slugify';
```

**Step 3: Test the endpoint**

Start dev server and test with curl or the app.

**Step 4: Commit**

```bash
git add backend/routers/media.mjs
git commit -m "feat(media): update /log to write new media_memory format

- Use {libraryId}_{name}.yml filename pattern
- Add parent/parentId, grandparent/grandparentId fields
- Add libraryId and mediaType fields
- Convert lastPlayed to ISO format
- Preserve oldPlexIds from previous entries"
```

---

## Task 5: Create Media Memory Validator

**Files:**
- Create: `backend/lib/mediaMemoryValidator.mjs`

**Step 1: Create validator module**

```javascript
/**
 * Media Memory Validator
 *
 * Daily cron job to validate Plex IDs in media_memory and auto-backfill orphans.
 *
 * Safety:
 * - Aborts if Plex server unreachable
 * - Only updates when high-confidence match found (>90%)
 * - Preserves old IDs in oldPlexIds array
 * - Writes work log on changes
 */

import path from 'path';
import fs from 'fs';
import moment from 'moment-timezone';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import stringSimilarity from 'string-similarity';
import axios from './http.mjs';
import { createLogger } from './logging/logger.js';
import { configService } from './config/ConfigService.mjs';
import { getMediaMemoryDir, getMediaMemoryFiles } from './mediaMemory.mjs';

const logger = createLogger({ source: 'cron', app: 'mediaMemoryValidator' });

const MIN_CONFIDENCE = 90;
const RECENT_DAYS = 30;
const SAMPLE_PERCENT = 10;

class PlexClient {
    constructor() {
        const auth = configService.getHouseholdAuth('plex') || {};
        this.token = auth.token;
        const { plex: plexEnv } = process.env;
        this.host = auth.server_url?.replace(/:\d+$/, '') || plexEnv?.host;
        this.port = plexEnv?.port;
        this.baseUrl = this.port ? `${this.host}:${this.port}` : this.host;
    }

    async fetch(endpoint) {
        const url = `${this.baseUrl}/${endpoint}`;
        const separator = url.includes('?') ? '&' : '?';
        const fullUrl = `${url}${separator}X-Plex-Token=${this.token}`;
        try {
            const response = await axios.get(fullUrl, { headers: { Accept: 'application/json' } });
            return response.data;
        } catch (error) {
            if (error.response?.status === 404) return null;
            throw error;
        }
    }

    async checkConnectivity() {
        try {
            const data = await this.fetch('identity');
            return !!data?.MediaContainer?.machineIdentifier;
        } catch {
            return false;
        }
    }

    async verifyId(plexId) {
        const data = await this.fetch(`library/metadata/${plexId}`);
        return data?.MediaContainer?.Metadata?.[0] || null;
    }

    async hubSearch(query, libraryId = null) {
        const sectionParam = libraryId ? `&sectionId=${libraryId}` : '';
        const data = await this.fetch(`hubs/search?query=${encodeURIComponent(query)}${sectionParam}`);
        const hubs = data?.MediaContainer?.Hub || [];
        const results = [];
        for (const hub of hubs) {
            for (const item of (hub.Metadata || [])) {
                results.push({
                    id: item.ratingKey,
                    title: item.title,
                    parent: item.parentTitle,
                    grandparent: item.grandparentTitle,
                    type: item.type
                });
            }
        }
        return results;
    }
}

function calculateConfidence(stored, result) {
    const titleSim = stringSimilarity.compareTwoStrings(
        (stored.title || '').toLowerCase(),
        (result.title || '').toLowerCase()
    );

    let parentSim = 0;
    if (stored.parent && result.parent) {
        parentSim = stringSimilarity.compareTwoStrings(
            stored.parent.toLowerCase(),
            result.parent.toLowerCase()
        );
    }

    let grandparentSim = 0;
    if (stored.grandparent && result.grandparent) {
        grandparentSim = stringSimilarity.compareTwoStrings(
            stored.grandparent.toLowerCase(),
            result.grandparent.toLowerCase()
        );
    }

    // Weight: title 50%, grandparent 30%, parent 20%
    const score = (titleSim * 0.5) + (grandparentSim * 0.3) + (parentSim * 0.2);
    return Math.round(score * 100);
}

async function findBestMatch(plex, entry) {
    const queries = [];
    if (entry.grandparent && entry.title) {
        queries.push(`${entry.grandparent} ${entry.title}`);
    }
    if (entry.title) {
        queries.push(entry.title);
    }

    let bestMatch = null;
    let bestConfidence = 0;

    for (const query of queries) {
        const results = await plex.hubSearch(query, entry.libraryId);
        for (const result of results) {
            const confidence = calculateConfidence(entry, result);
            if (confidence > bestConfidence) {
                bestConfidence = confidence;
                bestMatch = { ...result, confidence };
            }
            if (confidence >= 95) break;
        }
        if (bestConfidence >= MIN_CONFIDENCE) break;
    }

    return bestMatch;
}

function selectEntriesToCheck(entries) {
    const now = moment();
    const recentCutoff = now.subtract(RECENT_DAYS, 'days');

    const recent = [];
    const older = [];

    for (const [id, entry] of entries) {
        const lastPlayed = moment(entry.lastPlayed);
        if (lastPlayed.isValid() && lastPlayed.isAfter(recentCutoff)) {
            recent.push([id, entry]);
        } else {
            older.push([id, entry]);
        }
    }

    // Sample older entries
    const sampleCount = Math.ceil(older.length * SAMPLE_PERCENT / 100);
    const shuffled = older.sort(() => Math.random() - 0.5);
    const sampled = shuffled.slice(0, sampleCount);

    return [...recent, ...sampled];
}

export default async function validateMediaMemory(guidId) {
    logger.info('mediaMemory.validator.started', { guidId });

    const plex = new PlexClient();

    // Safety: Check connectivity first
    if (!await plex.checkConnectivity()) {
        logger.warn('mediaMemory.validator.aborted', { reason: 'Plex unreachable' });
        return;
    }

    const files = getMediaMemoryFiles();
    const stats = { checked: 0, valid: 0, backfilled: 0, unresolved: 0 };
    const allChanges = [];
    const allUnresolved = [];

    for (const fileInfo of files) {
        const content = fs.readFileSync(fileInfo.path, 'utf8');
        const data = parseYaml(content) || {};
        const entries = Object.entries(data);

        const toCheck = selectEntriesToCheck(entries);
        let fileModified = false;

        for (const [plexId, entry] of toCheck) {
            stats.checked++;

            const exists = await plex.verifyId(plexId);
            if (exists) {
                stats.valid++;
                continue;
            }

            // ID is orphaned - try to find match
            logger.info('mediaMemory.validator.orphanFound', {
                id: plexId,
                title: entry.title,
                file: fileInfo.filename
            });

            const match = await findBestMatch(plex, entry);

            if (match && match.confidence >= MIN_CONFIDENCE) {
                stats.backfilled++;

                // Update entry with new ID
                const oldIds = entry.oldPlexIds || [];
                oldIds.push(parseInt(plexId, 10));

                const updatedEntry = {
                    ...entry,
                    oldPlexIds: oldIds
                };

                // Remove old key, add new
                delete data[plexId];
                data[match.id] = updatedEntry;
                fileModified = true;

                const change = {
                    file: fileInfo.filename,
                    oldId: parseInt(plexId, 10),
                    newId: parseInt(match.id, 10),
                    title: entry.title,
                    parent: entry.parent,
                    grandparent: entry.grandparent,
                    confidence: match.confidence,
                    timestamp: new Date().toISOString()
                };
                allChanges.push(change);

                logger.info('mediaMemory.validator.backfilled', change);
            } else {
                stats.unresolved++;
                const unresolved = {
                    file: fileInfo.filename,
                    id: parseInt(plexId, 10),
                    title: entry.title,
                    reason: match ? `low confidence (${match.confidence}%)` : 'no match found'
                };
                allUnresolved.push(unresolved);

                logger.warn('mediaMemory.validator.noMatch', unresolved);
            }
        }

        if (fileModified) {
            const yaml = stringifyYaml(data, { lineWidth: 0 });
            fs.writeFileSync(fileInfo.path, yaml, 'utf8');
        }
    }

    // Write work log if changes or unresolved
    if (allChanges.length > 0 || allUnresolved.length > 0) {
        const logsDir = path.join(getMediaMemoryDir(), 'plex', '_logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        const logFile = path.join(logsDir, `${moment().format('YYYY-MM-DD')}.yml`);
        const logData = {
            date: moment().format('YYYY-MM-DD'),
            runTime: new Date().toISOString(),
            summary: stats,
            ...(allChanges.length > 0 && { changes: allChanges }),
            ...(allUnresolved.length > 0 && { unresolved: allUnresolved })
        };

        fs.writeFileSync(logFile, stringifyYaml(logData, { lineWidth: 0 }), 'utf8');
        logger.info('mediaMemory.validator.logWritten', { path: logFile });
    }

    logger.info('mediaMemory.validator.complete', stats);
}
```

**Step 2: Commit**

```bash
git add backend/lib/mediaMemoryValidator.mjs
git commit -m "feat(validator): add mediaMemoryValidator cron job

- Smart check: recent entries + 10% sample of older
- Auto-backfill orphans with >90% confidence match
- Preserve old IDs in oldPlexIds array
- Write work log on changes
- Abort safely if Plex unreachable"
```

---

## Task 6: Add Validator to Cron

**Files:**
- Modify: `backend/routers/cron.mjs`

**Step 1: Add validator to cronDaily array**

At line 40 in `cron.mjs`, add to cronDaily:

```javascript
  cronDaily: [
    "../lib/youtube.mjs",
    "../lib/fitsync.mjs",
    "../lib/garmin.mjs",
    "../lib/health.mjs",
    "../lib/letterboxd.mjs",
    "../lib/goodreads.mjs",
    "../lib/github.mjs",
    "../lib/reddit.mjs",
    "../lib/shopping.mjs",
    "../lib/archiveRotation.mjs",
    "../lib/mediaMemoryValidator.mjs",  // Add this line
  ],
```

**Step 2: Commit**

```bash
git add backend/routers/cron.mjs
git commit -m "feat(cron): add mediaMemoryValidator to daily cron"
```

---

## Task 7: Update Documentation

**Files:**
- Modify: `docs/ai-context/tv.md`

**Step 1: Update Media Memory section**

Update the Media Memory section in `docs/ai-context/tv.md` with the new format:

```markdown
## Media Memory

**Location:** `data/households/{hid}/history/media_memory/plex/`

**Purpose:** Tracks watch history, progress, play counts per Plex library.

**Directory Structure:**
```
media_memory/
└── plex/
    ├── 14_fitness.yml    # Library ID 14 = "Fitness"
    ├── 1_movies.yml      # Library ID 1 = "Movies"
    ├── 2_tv.yml          # Library ID 2 = "TV Shows"
    ├── _archive/         # Migrated legacy files
    └── _logs/            # Daily validator work logs
```

**Entry Format (YAML):**
```yaml
"673634":                           # Plex ID (ratingKey) as key
  title: "Morning Flow"             # Episode/movie title only
  parent: "30 Days of Yoga"         # Season/Album name
  parentId: 67890                   # Season/Album ratingKey
  grandparent: "Yoga With Adriene"  # Show/Artist name
  grandparentId: 12345              # Show/Artist ratingKey
  libraryId: 14                     # Library section ID
  mediaType: "episode"              # episode | movie | track
  lastPlayed: "2025-01-15T10:30:00Z"
  playCount: 3
  progress: 1800                    # Seconds watched
  duration: 3600                    # Total duration
  oldPlexIds: [606037, 11570]       # Only present if backfilled
```

**Key Files:**
- `backend/lib/mediaMemory.mjs` - Path utilities, filename helpers
- `backend/lib/mediaMemoryValidator.mjs` - Daily cron validator
- `backend/lib/plex.mjs` - Plex API client
- `scripts/migrate-media-memory.mjs` - One-time migration script
```

**Step 2: Commit**

```bash
git add docs/ai-context/tv.md
git commit -m "docs(tv): update media_memory documentation for new format"
```

---

## Task 8: Run Migration on Dev Data

**Prerequisites:** All previous tasks committed

**Step 1: Backup current data**

```bash
cp -r /path/to/data/households/default/history/media_memory/plex \
      /path/to/data/households/default/history/media_memory/plex_backup_$(date +%Y%m%d)
```

**Step 2: Run migration dry-run**

```bash
node scripts/migrate-media-memory.mjs --dry-run --verbose
```

Review output carefully.

**Step 3: Run migration**

```bash
node scripts/migrate-media-memory.mjs --apply
```

**Step 4: Verify new files**

```bash
ls -la /path/to/data/households/default/history/media_memory/plex/
```

Should show `{id}_{name}.yml` format files and `_archive/` with old files.

**Step 5: Commit verification**

```bash
git add .
git commit -m "chore: complete media_memory migration

All tasks implemented:
- New filename format: {libraryId}_{name}.yml
- Structured parent/grandparent fields
- Daily validator cron job
- Migration script with archival"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add mediaMemory helpers | `mediaMemory.mjs`, tests |
| 2 | Migration script structure | `migrate-media-memory.mjs` |
| 3 | Migration logic | `migrate-media-memory.mjs` |
| 4 | Update /log endpoint | `media.mjs` |
| 5 | Create validator | `mediaMemoryValidator.mjs` |
| 6 | Add to cron | `cron.mjs` |
| 7 | Update docs | `tv.md` |
| 8 | Run migration | Execute scripts |
