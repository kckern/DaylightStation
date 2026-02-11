# Plex Sync CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a CLI tool that bi-directionally syncs Plex metadata to/from local YML files (`show.yml`, `movie.yml`, `artist.yml`) for disaster recovery of labels, collections, and other metadata.

**Architecture:** Single CLI file (`cli/plex-sync.cli.mjs`) following the same bootstrap pattern as `cli/plex.cli.mjs`. Uses axios directly for Plex API calls (not PlexClient from backend — avoids DDD dependency injection). Reads/writes YML files on a local mount (`PLEX_MOUNT` env var). Three commands: `migrate`, `pull`, `push`.

**Tech Stack:** Node.js ESM, axios (HTTP), js-yaml (YML I/O), fs/path (filesystem).

**Design doc:** `docs/_wip/plans/2026-02-10-plex-sync-cli-design.md`

---

### Task 1: CLI Skeleton with Config Bootstrap

**Files:**
- Create: `cli/plex-sync.cli.mjs`

**Step 1: Create the CLI skeleton**

Copy the bootstrap pattern from `cli/plex.cli.mjs` (lines 26-48 for config, lines 56-77 for arg parsing). Create a `PlexSync` class with the Plex connection setup, and a command dispatcher for `migrate`, `pull`, `push`.

```js
#!/usr/bin/env node
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import axios from '../backend/lib/http.mjs';
import { configService } from '../backend/lib/config/ConfigService.mjs';
import { resolveConfigPaths } from '../backend/lib/config/pathResolver.mjs';
import { hydrateProcessEnvFromConfigs } from '../backend/lib/logging/config.js';

// Bootstrap config (same as plex.cli.mjs)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDocker = existsSync('/.dockerenv');
const configPaths = resolveConfigPaths({ isDocker, codebaseDir: path.join(__dirname, '..') });
if (configPaths.error) {
  console.error('Config error:', configPaths.error);
  process.exit(1);
}
hydrateProcessEnvFromConfigs(configPaths.configDir);
configService.init({ dataDir: configPaths.dataDir });

// Parse args
const args = process.argv.slice(2);
const flags = {
  dryRun: args.includes('--dry-run'),
  force: args.includes('--force'),
  json: args.includes('--json'),
  library: null,
  filter: null,
  dir: null,
};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--library' && args[i + 1]) flags.library = args[i + 1];
  if (args[i] === '--filter' && args[i + 1]) flags.filter = args[i + 1];
  if (args[i] === '--dir' && args[i + 1]) flags.dir = args[i + 1];
}
const positionalArgs = args.filter(a => !a.startsWith('--') && !['--library','--filter','--dir'].some((f,_,__) => args[args.indexOf(a)-1] === f));
const command = positionalArgs[0];

const PLEX_MOUNT = process.env.PLEX_MOUNT;
if (!PLEX_MOUNT && command !== 'help') {
  console.error('Error: PLEX_MOUNT environment variable is required');
  console.error('Example: PLEX_MOUNT=/Volumes/Media node cli/plex-sync.cli.mjs pull --library 14');
  process.exit(1);
}

class PlexSync {
  constructor() {
    const auth = configService.getHouseholdAuth('plex') || {};
    this.token = auth.token;
    if (!this.token) { console.error('Error: Plex token not found'); process.exit(1); }
    const host = auth.server_url?.replace(/:\d+$/, '') || '';
    this.baseUrl = host;
    this.mount = PLEX_MOUNT;
  }

  async fetch(endpoint) {
    const url = `${this.baseUrl}/${endpoint}`;
    const sep = url.includes('?') ? '&' : '?';
    const resp = await axios.get(`${url}${sep}X-Plex-Token=${this.token}`, {
      headers: { Accept: 'application/json' }
    });
    return resp.data;
  }

  async put(endpoint, params = {}) {
    const url = `${this.baseUrl}/${endpoint}`;
    const sep = url.includes('?') ? '&' : '?';
    const resp = await axios.put(`${url}${sep}X-Plex-Token=${this.token}`, null, {
      params,
      headers: { Accept: 'application/json' }
    });
    return resp.data;
  }
}

function showHelp() {
  console.log(`
Plex Sync CLI - Bi-directional Plex metadata sync

Usage:
  PLEX_MOUNT=/Volumes/Media node cli/plex-sync.cli.mjs <command> [options]

Commands:
  migrate              Convert nfo.json files to show.yml/movie.yml/artist.yml
  pull                 Pull metadata from Plex → local YML files
  push                 Push metadata from local YML → Plex

Options:
  --library <id>       Target library section ID (required for pull/push)
  --filter <regex>     Filter items by title
  --force              Overwrite existing data (default: only fill blanks)
  --dry-run            Show what would change without writing
  --dir <path>         Directory to scan (migrate only, defaults to PLEX_MOUNT)
  --json               JSON output for logging
`);
}

async function main() {
  if (!command || command === 'help' || command === '-h' || command === '--help') {
    showHelp();
    process.exit(0);
  }
  const plex = new PlexSync();
  switch (command) {
    case 'migrate': await cmdMigrate(plex); break;
    case 'pull':    await cmdPull(plex); break;
    case 'push':    await cmdPush(plex); break;
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

async function cmdMigrate(plex) { console.log('migrate: not yet implemented'); }
async function cmdPull(plex) { console.log('pull: not yet implemented'); }
async function cmdPush(plex) { console.log('push: not yet implemented'); }

main();
```

**Step 2: Test the skeleton**

```bash
PLEX_MOUNT=/Volumes/Media node cli/plex-sync.cli.mjs help
PLEX_MOUNT=/Volumes/Media node cli/plex-sync.cli.mjs pull --library 14 --dry-run
```

Expected: Help text prints; pull says "not yet implemented".

**Step 3: Commit**

```bash
git add cli/plex-sync.cli.mjs
git commit -m "feat: plex-sync CLI skeleton with config bootstrap"
```

---

### Task 2: Migrate Command (nfo.json → YML)

**Files:**
- Modify: `cli/plex-sync.cli.mjs`

**Dependencies:** `js-yaml` (already in package.json from backend usage)

**Step 1: Add YML helpers and type detection**

Add these imports and utility functions above the command implementations:

```js
import fs from 'fs';
import yaml from 'js-yaml';

// Determine YML filename from nfo.json content
function detectTypeFromNfo(data) {
  if (Array.isArray(data.seasons) && data.seasons.length > 0) return 'show';
  // Artist nfo.json has country + genre but no seasons, no guids
  // Movie nfo.json has guids or contentRating or tagline
  if (data.guids || data.contentRating || data.tagline) return 'movie';
  // Heuristic: if it has 'path' containing known music dirs, it's an artist
  const musicDirs = ['Music', 'Industrial', 'Ambient', 'Children\'s Music', 'Stage'];
  if (data.path && musicDirs.some(d => data.path.includes(d))) return 'artist';
  // Fallback: if no seasons and no movie fields, assume movie
  return 'movie';
}

// Normalize nfo.json quirks into clean YML-ready object
function normalizeNfoToYml(data, type) {
  const result = {};

  // Common fields
  if (data.ratingKey) result.ratingKey = String(data.ratingKey);
  if (data.title) result.title = data.title;
  if (data.titleSort && data.titleSort !== data.title) result.titleSort = data.titleSort;
  if (data.summary) result.summary = data.summary;
  if (data.year) result.year = typeof data.year === 'string' ? parseInt(data.year, 10) || data.year : data.year;
  if (data.studio) result.studio = data.studio;

  // Normalize labels: "" → [] or "a,b" → [a, b]
  if (data.labels && typeof data.labels === 'string' && data.labels.trim()) {
    result.labels = data.labels.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }

  // Normalize collections: string → array
  if (data.collection) {
    result.collections = typeof data.collection === 'string'
      ? data.collection.split(',').map(s => s.trim()).filter(Boolean)
      : Array.isArray(data.collection) ? data.collection : [data.collection];
  }

  // Normalize genres: string or "genre[0].tag.tag" format → array
  const genreRaw = data.genre || data['genre[0].tag.tag'];
  if (genreRaw) {
    result.genres = typeof genreRaw === 'string'
      ? genreRaw.split(',').map(s => s.trim()).filter(Boolean)
      : Array.isArray(genreRaw) ? genreRaw : [genreRaw];
  }

  // Type-specific fields
  if (type === 'show') {
    if (data.director) result.director = data.director;
    if (data.cast) result.cast = data.cast;
    if (data.originallyAvailableAt) result.originallyAvailableAt = data.originallyAvailableAt;

    // Seasons: normalize index to int, drop summaries that duplicate show summary
    if (Array.isArray(data.seasons)) {
      result.seasons = data.seasons.map(s => {
        const season = { index: parseInt(s.index, 10) };
        if (s.title) season.title = s.title;
        if (s.summary && s.summary !== data.summary) season.summary = s.summary;
        return season;
      });
    }
  }

  if (type === 'movie') {
    if (data.director) result.director = data.director;
    if (data.cast) result.cast = data.cast;
    if (data.tagline) result.tagline = data.tagline;
    if (data.contentRating) result.contentRating = data.contentRating;
    if (data.originallyAvailableAt) result.originallyAvailableAt = data.originallyAvailableAt;
    if (data.country) result.country = data.country;
    if (data.guids) result.guids = data.guids;
  }

  if (type === 'artist') {
    if (data.country) result.country = data.country;
  }

  return result;
}
```

**Step 2: Implement cmdMigrate**

```js
async function cmdMigrate(plex) {
  const scanDir = flags.dir || plex.mount;
  console.log(`Scanning ${scanDir} for nfo.json files...`);

  const nfoFiles = findFiles(scanDir, 'nfo.json');
  console.log(`Found ${nfoFiles.length} nfo.json files\n`);

  let migrated = 0, skipped = 0, errors = 0;

  for (const nfoPath of nfoFiles) {
    const dir = path.dirname(nfoPath);
    try {
      const raw = fs.readFileSync(nfoPath, 'utf-8');
      const data = JSON.parse(raw);
      const type = detectTypeFromNfo(data);
      const ymlFilename = `${type}.yml`;
      const ymlPath = path.join(dir, ymlFilename);

      if (fs.existsSync(ymlPath)) {
        skipped++;
        continue;
      }

      const normalized = normalizeNfoToYml(data, type);

      if (flags.dryRun) {
        console.log(`  [DRY] ${path.relative(scanDir, dir)}/ → ${ymlFilename}`);
        migrated++;
        continue;
      }

      fs.writeFileSync(ymlPath, yaml.dump(normalized, { lineWidth: 120, noRefs: true }));
      console.log(`  ✅ ${path.relative(scanDir, dir)}/ → ${ymlFilename}`);
      migrated++;
    } catch (err) {
      console.error(`  🔴 ${path.relative(scanDir, nfoPath)}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone: ${migrated} migrated, ${skipped} skipped (yml exists), ${errors} errors`);
}

// Recursive file finder
function findFiles(dir, filename) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findFiles(fullPath, filename));
      } else if (entry.name === filename) {
        results.push(fullPath);
      }
    }
  } catch (err) {
    // Skip unreadable directories
  }
  return results;
}
```

**Step 3: Test migrate with dry run on Fitness library**

```bash
PLEX_MOUNT=/Volumes/Media node cli/plex-sync.cli.mjs migrate --dir /Volumes/Media/Fitness --dry-run
```

Expected: Lists ~198 nfo.json files that would be migrated to `show.yml`.

**Step 4: Test migrate for real on a single directory**

```bash
PLEX_MOUNT=/Volumes/Media node cli/plex-sync.cli.mjs migrate --dir "/Volumes/Media/Fitness/10 Rounds"
```

Expected: Creates `/Volumes/Media/Fitness/10 Rounds/show.yml`. Verify contents manually.

**Step 5: Verify against other types**

```bash
# Movie type
PLEX_MOUNT=/Volumes/Media node cli/plex-sync.cli.mjs migrate --dir "/Volumes/Media/Documentaries/Movies/Free Solo (2018)" --dry-run
# Artist type
PLEX_MOUNT=/Volumes/Media node cli/plex-sync.cli.mjs migrate --dir "/Volumes/Media/Industrial/Two Steps From Hell" --dry-run
```

**Step 6: Commit**

```bash
git add cli/plex-sync.cli.mjs
git commit -m "feat: plex-sync migrate command (nfo.json → show/movie/artist.yml)"
```

---

### Task 3: Pull Command — Library Scan & Path Mapping

**Files:**
- Modify: `cli/plex-sync.cli.mjs`

**Step 1: Add Plex library helpers to PlexSync class**

```js
// Inside PlexSync class:

async getLibraries() {
  const data = await this.fetch('library/sections');
  return data?.MediaContainer?.Directory || [];
}

async getLibraryItems(libraryId) {
  const data = await this.fetch(`library/sections/${libraryId}/all`);
  return data?.MediaContainer?.Metadata || [];
}

async getMetadata(ratingKey) {
  const data = await this.fetch(`library/metadata/${ratingKey}`);
  return data?.MediaContainer?.Metadata?.[0] || null;
}

async getChildren(ratingKey) {
  const data = await this.fetch(`library/metadata/${ratingKey}/children`);
  return data?.MediaContainer?.Metadata || [];
}

// Resolve server-side Plex path to local mount path
resolveLocalPath(plexPath) {
  if (!plexPath) return null;
  // Find common prefix between Plex paths and strip it
  // Plex paths: /data/Fitness/10 Rounds or /Volumes/Media Library/Industrial/...
  // We need to map to PLEX_MOUNT + relative part
  // Strategy: strip everything before the library subfolder name
  // The library subfolder is the first component after the Plex root
  return null; // Implemented in step 2
}
```

**Step 2: Implement path mapping with auto-detection**

The tricky part: Plex `Location` paths vary (e.g., `/data/media/video/fitness` vs `/Volumes/Media Library/Industrial`). We use the Plex library's own `Location` field to discover the server-side prefix, then swap it.

Add to PlexSync class:

```js
async getLibraryPathMap(libraryId) {
  // Plex library sections have Location entries showing the server-side root paths
  const data = await this.fetch(`library/sections/${libraryId}`);
  const dir = data?.MediaContainer?.Directory?.[0];
  const locations = dir?.Location || [];
  // Returns array like [{path: "/data/Fitness"}]
  return locations.map(l => l.path);
}

resolveLocalPath(plexItemPath, serverPrefixes) {
  if (!plexItemPath || !serverPrefixes?.length) return null;
  for (const prefix of serverPrefixes) {
    if (plexItemPath.startsWith(prefix)) {
      const relative = plexItemPath.slice(prefix.length);
      // The mount should map to the parent of the library folder
      // e.g., prefix=/data/Fitness, mount=/Volumes/Media → /Volumes/Media/Fitness
      // But we need to figure out the right mount subfolder
      // Approach: the last component of the server prefix should match a dir under mount
      const serverParts = prefix.replace(/\/$/, '').split('/');
      const libFolderName = serverParts[serverParts.length - 1];
      return path.join(this.mount, libFolderName, relative);
    }
  }
  return null;
}
```

**Step 3: Implement basic pull flow**

```js
async function cmdPull(plex) {
  if (!flags.library) {
    console.error('Error: --library <id> is required for pull');
    process.exit(1);
  }

  // Get library info
  const libraries = await plex.getLibraries();
  const lib = libraries.find(l => l.key === flags.library);
  if (!lib) {
    console.error(`Library ${flags.library} not found. Available:`);
    libraries.forEach(l => console.log(`  [${l.key}] ${l.title} (${l.type})`));
    process.exit(1);
  }

  const ymlFilename = lib.type === 'show' ? 'show.yml'
    : lib.type === 'artist' ? 'artist.yml'
    : 'movie.yml';

  console.log(`Pulling from library: ${lib.title} [${lib.key}] (${lib.type}) → ${ymlFilename}`);

  // Get server-side path prefixes for this library
  const serverPrefixes = await plex.getLibraryPathMap(flags.library);
  console.log(`Server paths: ${serverPrefixes.join(', ')}`);

  // Get all items in library
  const items = await plex.getLibraryItems(flags.library);
  console.log(`Found ${items.length} items\n`);

  const filterRegex = flags.filter ? new RegExp(flags.filter, 'i') : null;
  let pulled = 0, skipped = 0, errors = 0;

  for (const item of items) {
    if (filterRegex && !filterRegex.test(item.title)) continue;

    try {
      // Get full metadata (includes Label, Collection, Genre arrays)
      const meta = await plex.getMetadata(item.ratingKey);
      if (!meta) { errors++; continue; }

      // Resolve local filesystem path
      const itemPath = meta.Location?.[0]?.path || meta.Media?.[0]?.Part?.[0]?.file;
      const localDir = plex.resolveLocalPath(
        // For shows: use Location. For movies: use file's parent dir
        meta.Location?.[0]?.path || (itemPath ? path.dirname(itemPath) : null),
        serverPrefixes
      );

      if (!localDir || !fs.existsSync(localDir)) {
        console.log(`  ⚠️  ${meta.title}: path not found (${localDir || 'no path'})`);
        skipped++;
        continue;
      }

      // Build YML data from Plex metadata
      const ymlData = buildYmlFromPlex(meta, lib.type);

      // For shows, also fetch seasons
      if (lib.type === 'show') {
        const seasons = await plex.getChildren(item.ratingKey);
        if (seasons.length > 0) {
          ymlData.seasons = seasons.map(s => {
            const season = { index: parseInt(s.index, 10) };
            if (s.title && s.title !== `Season ${s.index}`) season.title = s.title;
            if (s.summary && s.summary !== meta.summary) season.summary = s.summary;
            return season;
          });
        }
      }

      // Read existing YML if present
      const ymlPath = path.join(localDir, ymlFilename);
      let existing = {};
      if (fs.existsSync(ymlPath)) {
        try {
          existing = yaml.load(fs.readFileSync(ymlPath, 'utf-8')) || {};
        } catch (e) { /* treat as empty */ }
      }

      // Merge: without --force, only fill blank fields
      const merged = flags.force ? { ...existing, ...ymlData } : mergeBlankOnly(existing, ymlData);

      // Check if anything changed
      const existingYml = yaml.dump(existing, { lineWidth: 120, noRefs: true });
      const mergedYml = yaml.dump(merged, { lineWidth: 120, noRefs: true });
      if (existingYml === mergedYml) {
        skipped++;
        continue;
      }

      if (flags.dryRun) {
        console.log(`  [DRY] ⬇️  ${meta.title}`);
        pulled++;
        continue;
      }

      fs.writeFileSync(ymlPath, mergedYml);
      console.log(`  ⬇️  ${meta.title}`);

      // Download poster if missing
      await downloadPosterIfMissing(plex, meta, localDir, lib.type);

      pulled++;
    } catch (err) {
      console.error(`  🔴 ${item.title}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone: ${pulled} pulled, ${skipped} skipped, ${errors} errors`);
}
```

**Step 4: Add helper functions**

```js
function buildYmlFromPlex(meta, libType) {
  const result = {};
  result.ratingKey = String(meta.ratingKey);
  if (meta.title) result.title = meta.title;
  if (meta.titleSort && meta.titleSort !== meta.title) result.titleSort = meta.titleSort;
  if (meta.summary) result.summary = meta.summary;
  if (meta.year) result.year = meta.year;
  if (meta.studio) result.studio = meta.studio;

  // Extract tag arrays (Plex returns [{tag: "value"}, ...])
  const extractTags = arr => (arr || []).map(t => typeof t === 'string' ? t : t?.tag).filter(Boolean);

  const labels = extractTags(meta.Label).map(s => s.toLowerCase());
  if (labels.length) result.labels = labels;

  const collections = extractTags(meta.Collection);
  if (collections.length) result.collections = collections;

  const genres = extractTags(meta.Genre);
  if (genres.length) result.genres = genres;

  if (libType === 'show' || libType === 'movie') {
    if (meta.originallyAvailableAt) result.originallyAvailableAt = meta.originallyAvailableAt;
    const directors = extractTags(meta.Director);
    if (directors.length) result.director = directors.join(', ');
    const roles = extractTags(meta.Role);
    if (roles.length) result.cast = roles.join(', ');
    if (meta.tagline) result.tagline = meta.tagline;
    if (meta.contentRating) result.contentRating = meta.contentRating;
  }

  if (libType === 'artist' || libType === 'movie') {
    const countries = extractTags(meta.Country);
    if (countries.length) result.country = countries.join(', ');
  }

  return result;
}

// Merge src into dst, only filling keys where dst value is empty/missing
function mergeBlankOnly(dst, src) {
  const result = { ...dst };
  for (const [key, value] of Object.entries(src)) {
    const existing = result[key];
    const isEmpty = existing === undefined || existing === null || existing === ''
      || (Array.isArray(existing) && existing.length === 0);
    if (isEmpty) {
      result[key] = value;
    }
  }
  return result;
}

// Download poster image from Plex if local file doesn't exist
async function downloadPosterIfMissing(plex, meta, localDir, libType) {
  const thumbPath = meta.thumb;
  if (!thumbPath) return;

  let posterFilename;
  if (libType === 'show') posterFilename = 'show.jpg';
  else if (libType === 'artist') posterFilename = 'artist.jpg';
  else posterFilename = 'poster.jpg';

  const localPoster = path.join(localDir, posterFilename);
  if (fs.existsSync(localPoster)) return;

  try {
    const url = `${plex.baseUrl}${thumbPath}?X-Plex-Token=${plex.token}`;
    const resp = await axios.get(url, { responseType: 'arraybuffer' });
    fs.writeFileSync(localPoster, Buffer.from(resp.data));
    console.log(`    📷 ${posterFilename}`);
  } catch (err) {
    console.error(`    ⚠️  poster download failed: ${err.message}`);
  }
}
```

**Step 5: Test pull with dry run on Fitness library**

```bash
PLEX_MOUNT=/Volumes/Media node cli/plex-sync.cli.mjs pull --library 14 --filter "10 Rounds" --dry-run
```

Expected: Shows what would be pulled for "10 Rounds" without writing.

**Step 6: Test pull for real on a single show**

```bash
PLEX_MOUNT=/Volumes/Media node cli/plex-sync.cli.mjs pull --library 14 --filter "10 Rounds"
```

Expected: Creates/updates `show.yml` and downloads `show.jpg` if missing.

**Step 7: Commit**

```bash
git add cli/plex-sync.cli.mjs
git commit -m "feat: plex-sync pull command with path mapping and poster download"
```

---

### Task 4: Pull — Season Poster Downloads

**Files:**
- Modify: `cli/plex-sync.cli.mjs`

**Step 1: Add season poster download after show pull**

Extend the pull flow (inside the show-type branch, after fetching seasons) to also download season posters:

```js
// After building ymlData.seasons in the pull loop:
if (lib.type === 'show' && !flags.dryRun) {
  for (const season of seasons) {
    if (!season.thumb) continue;
    const seasonFile = `season${season.index}.jpg`;
    const seasonPath = path.join(localDir, seasonFile);
    if (fs.existsSync(seasonPath)) continue;

    try {
      const url = `${plex.baseUrl}${season.thumb}?X-Plex-Token=${plex.token}`;
      const resp = await axios.get(url, { responseType: 'arraybuffer' });
      fs.writeFileSync(seasonPath, Buffer.from(resp.data));
      console.log(`    📷 ${seasonFile}`);
    } catch (err) {
      console.error(`    ⚠️  ${seasonFile} download failed: ${err.message}`);
    }
  }
}
```

**Step 2: Test**

```bash
PLEX_MOUNT=/Volumes/Media node cli/plex-sync.cli.mjs pull --library 14 --filter "21 Day Fix"
ls "/Volumes/Media/Fitness/21 Day Fix/"*.jpg
```

Expected: `show.jpg` and `season1.jpg` through `season7.jpg` exist.

**Step 3: Commit**

```bash
git add cli/plex-sync.cli.mjs
git commit -m "feat: plex-sync pull downloads season poster images"
```

---

### Task 5: Push Command

**Files:**
- Modify: `cli/plex-sync.cli.mjs`

**Step 1: Add Plex tag parameter builder**

```js
// Build Plex PUT params from YML data
// Plex expects: label[0].tag.tag=fitness&label[1].tag.tag=beginner
// Simple fields: title.value=...&summary.value=...
function buildPlexParams(ymlData, existingMeta, force) {
  const params = {};

  // Simple value fields
  const valueFields = ['title', 'titleSort', 'summary', 'studio', 'year', 'originallyAvailableAt', 'tagline', 'contentRating'];
  for (const field of valueFields) {
    if (!ymlData[field]) continue;
    const plexValue = existingMeta[field];
    const isEmpty = !plexValue || plexValue === '';
    if (force || isEmpty) {
      params[`${field}.value`] = ymlData[field];
    }
  }

  // Tag array fields
  const tagFields = {
    labels: 'label',
    collections: 'collection',
    genres: 'genre',
  };

  for (const [ymlKey, plexKey] of Object.entries(tagFields)) {
    const ymlTags = ymlData[ymlKey];
    if (!Array.isArray(ymlTags) || ymlTags.length === 0) continue;

    const existingTags = (existingMeta[capitalize(plexKey)] || [])
      .map(t => typeof t === 'string' ? t : t?.tag)
      .filter(Boolean);

    if (!force && existingTags.length > 0) continue;

    ymlTags.forEach((tag, i) => {
      params[`${plexKey}[${i}].tag.tag`] = tag;
    });
  }

  return params;
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
```

**Step 2: Implement cmdPush**

```js
async function cmdPush(plex) {
  if (!flags.library) {
    console.error('Error: --library <id> is required for push');
    process.exit(1);
  }

  const libraries = await plex.getLibraries();
  const lib = libraries.find(l => l.key === flags.library);
  if (!lib) {
    console.error(`Library ${flags.library} not found`);
    process.exit(1);
  }

  const ymlFilename = lib.type === 'show' ? 'show.yml'
    : lib.type === 'artist' ? 'artist.yml'
    : 'movie.yml';

  console.log(`Pushing to library: ${lib.title} [${lib.key}] (${lib.type}) from ${ymlFilename}`);

  // Get server-side paths to know which local dirs to scan
  const serverPrefixes = await plex.getLibraryPathMap(flags.library);
  // Determine local scan root from library path mapping
  const serverParts = serverPrefixes[0]?.replace(/\/$/, '').split('/') || [];
  const libFolderName = serverParts[serverParts.length - 1];
  const scanDir = flags.dir || path.join(plex.mount, libFolderName);

  console.log(`Scanning ${scanDir} for ${ymlFilename} files...\n`);

  const ymlFiles = findFiles(scanDir, ymlFilename);
  const filterRegex = flags.filter ? new RegExp(flags.filter, 'i') : null;
  let pushed = 0, skipped = 0, errors = 0;

  for (const ymlPath of ymlFiles) {
    try {
      const ymlData = yaml.load(fs.readFileSync(ymlPath, 'utf-8'));
      if (!ymlData?.ratingKey) {
        console.log(`  ⚠️  ${path.relative(scanDir, ymlPath)}: no ratingKey, skipping`);
        skipped++;
        continue;
      }

      if (filterRegex && !filterRegex.test(ymlData.title || '')) continue;

      // Fetch current Plex metadata
      const meta = await plex.getMetadata(ymlData.ratingKey);
      if (!meta) {
        console.log(`  ⚠️  ${ymlData.title}: ratingKey ${ymlData.ratingKey} not found in Plex`);
        skipped++;
        continue;
      }

      const params = buildPlexParams(ymlData, meta, flags.force);

      if (Object.keys(params).length === 0) {
        skipped++;
        continue;
      }

      if (flags.dryRun) {
        console.log(`  [DRY] ⬆️  ${ymlData.title}: would push ${Object.keys(params).join(', ')}`);
        pushed++;
        continue;
      }

      // PUT to Plex
      await plex.put(`library/metadata/${ymlData.ratingKey}`, params);
      console.log(`  ⬆️  ${ymlData.title}: pushed ${Object.keys(params).join(', ')}`);
      pushed++;

      // Push season metadata for shows
      if (lib.type === 'show' && Array.isArray(ymlData.seasons)) {
        const seasons = await plex.getChildren(ymlData.ratingKey);
        for (const ymlSeason of ymlData.seasons) {
          const plexSeason = seasons.find(s => parseInt(s.index, 10) === ymlSeason.index);
          if (!plexSeason) continue;
          const seasonParams = buildPlexParams(
            { title: ymlSeason.title, summary: ymlSeason.summary },
            plexSeason,
            flags.force
          );
          if (Object.keys(seasonParams).length > 0) {
            if (!flags.dryRun) {
              await plex.put(`library/metadata/${plexSeason.ratingKey}`, seasonParams);
            }
            console.log(`    ⬆️  Season ${ymlSeason.index}: ${Object.keys(seasonParams).join(', ')}`);
          }
        }
      }
    } catch (err) {
      console.error(`  🔴 ${path.relative(scanDir, ymlPath)}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone: ${pushed} pushed, ${skipped} skipped, ${errors} errors`);
}
```

**Step 3: Test push with dry run**

```bash
PLEX_MOUNT=/Volumes/Media node cli/plex-sync.cli.mjs push --library 14 --filter "10 Rounds" --dry-run
```

Expected: Shows what would be pushed to Plex without making changes.

**Step 4: Test push for real on a single show**

```bash
PLEX_MOUNT=/Volumes/Media node cli/plex-sync.cli.mjs push --library 14 --filter "10 Rounds"
```

Verify in Plex that metadata was updated correctly.

**Step 5: Commit**

```bash
git add cli/plex-sync.cli.mjs
git commit -m "feat: plex-sync push command with tag parameter builder"
```

---

### Task 6: End-to-End Validation

**Step 1: Full migrate dry run**

```bash
PLEX_MOUNT=/Volumes/Media node cli/plex-sync.cli.mjs migrate --dry-run
```

Verify count is ~3,200 and types are correctly detected.

**Step 2: Migrate Fitness library**

```bash
PLEX_MOUNT=/Volumes/Media node cli/plex-sync.cli.mjs migrate --dir /Volumes/Media/Fitness
```

Spot-check a few `show.yml` files.

**Step 3: Pull Fitness library to enrich with labels/collections**

```bash
PLEX_MOUNT=/Volumes/Media node cli/plex-sync.cli.mjs pull --library 14
```

Verify `show.yml` files now have `ratingKey`, `labels`, `collections` from Plex.

**Step 4: Push dry run to verify round-trip**

```bash
PLEX_MOUNT=/Volumes/Media node cli/plex-sync.cli.mjs push --library 14 --dry-run
```

Should show mostly skips (Plex already has the data).

**Step 5: Commit**

```bash
git add cli/plex-sync.cli.mjs
git commit -m "feat: plex-sync CLI complete with migrate, pull, push"
```
