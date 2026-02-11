#!/usr/bin/env node

/**
 * Plex Sync CLI - Sync metadata between Plex and local YAML files
 *
 * A CLI tool for migrating, pulling, and pushing Plex metadata
 * so that library metadata can be version-controlled alongside config.
 *
 * Usage:
 *   node plex-sync.cli.mjs <command> [options]
 *
 * Commands:
 *   migrate                Export Plex metadata to YAML (initial setup)
 *   pull                   Pull latest metadata from Plex into YAML
 *   push                   Push YAML metadata back to Plex
 *
 * Options:
 *   --dry-run              Show what would change without making changes
 *   --force                Overwrite without confirmation
 *   --json                 Output as JSON
 *   --library <id>         Limit to a specific library section
 *   --filter <regex>       Filter items by title regex
 *   --dir <path>           Override output directory for YAML files
 *
 * Environment:
 *   PLEX_MOUNT             Path to the Plex media mount (required)
 *
 * @module cli/plex-sync
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import fs from 'fs';
import yaml from 'js-yaml';
import axios from 'axios';

// Resolve data directory (same search order as backend)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = process.env.DAYLIGHT_DATA_PATH
    || '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data';

// Docker-compose path for volume mapping (from settings.local.json or env)
const PLEX_COMPOSE = process.env.PLEX_COMPOSE
    || '/Volumes/mounts/DockerDrive/Docker/Media/docker-compose.yml';

// ============================================================================
// Argument Parsing
// ============================================================================

const args = process.argv.slice(2);

const flags = {
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    json: args.includes('--json'),
    library: null,
    filter: null,
    dir: null,
};

// Extract --library value
const libIdx = args.indexOf('--library');
if (libIdx !== -1 && args[libIdx + 1]) {
    flags.library = args[libIdx + 1];
}

// Extract --filter value
const filterIdx = args.indexOf('--filter');
if (filterIdx !== -1 && args[filterIdx + 1]) {
    flags.filter = args[filterIdx + 1];
}

// Extract --dir value
const dirIdx = args.indexOf('--dir');
if (dirIdx !== -1 && args[dirIdx + 1]) {
    flags.dir = args[dirIdx + 1];
}

// Indices of consumed flag-value pairs (flag + its argument)
const consumedIndices = new Set();
for (const [flag, idx] of [['--library', libIdx], ['--filter', filterIdx], ['--dir', dirIdx]]) {
    if (idx !== -1) {
        consumedIndices.add(idx);
        consumedIndices.add(idx + 1);
    }
}

// Remove flags from args to get positional arguments
const positionalArgs = args.filter((arg, i) =>
    !arg.startsWith('--') && !consumedIndices.has(i)
);

const command = positionalArgs[0];

// ============================================================================
// PlexSync Client
// ============================================================================

class PlexSync {
    constructor() {
        // Load Plex auth from data/household/auth/plex.yml
        const authPath = path.join(DATA_PATH, 'household/auth/plex.yml');
        if (!existsSync(authPath)) {
            console.error(`Error: Plex auth not found at ${authPath}`);
            process.exit(1);
        }
        const auth = yaml.load(fs.readFileSync(authPath, 'utf-8')) || {};
        this.token = auth.token;

        if (!this.token) {
            console.error('Error: Plex token not found in auth config');
            process.exit(1);
        }

        // Load Plex host from data/household/config/media-app.yml
        const mediaAppPath = path.join(DATA_PATH, 'household/config/media-app.yml');
        if (!existsSync(mediaAppPath)) {
            console.error(`Error: media-app.yml not found at ${mediaAppPath}`);
            process.exit(1);
        }
        const mediaApp = yaml.load(fs.readFileSync(mediaAppPath, 'utf-8')) || {};
        this.baseUrl = mediaApp.plex?.host;

        if (!this.baseUrl) {
            console.error('Error: plex.host not found in media-app.yml');
            process.exit(1);
        }

        // PLEX_MOUNT from environment
        this.mount = process.env.PLEX_MOUNT;

        // Build volume map from docker-compose: container_path → local_path
        // Docker-compose maps host_path:container_path. Host paths use the server
        // filesystem prefix (e.g. /media/kckern/Media). We swap that prefix with
        // PLEX_MOUNT to get the local macOS path.
        this.volumeMap = this._buildVolumeMap();
    }

    /**
     * Parse Plex service volumes from docker-compose.yml.
     * Returns array of { containerPath, localPath } sorted longest-first
     * so the most specific prefix matches first.
     *
     * Docker-compose volume format: host_path:container_path[:rw]
     * Host paths are server-side (e.g. /media/kckern/Media/Fitness).
     * We swap the server host prefix with PLEX_MOUNT to get the local path.
     */
    _buildVolumeMap() {
        if (!existsSync(PLEX_COMPOSE)) {
            console.error(`Warning: docker-compose not found at ${PLEX_COMPOSE}. Path mapping will fail.`);
            return [];
        }
        const compose = yaml.load(fs.readFileSync(PLEX_COMPOSE, 'utf-8'));
        const plexService = compose?.services?.plex;
        if (!plexService?.volumes) return [];

        const entries = [];
        for (const vol of plexService.volumes) {
            const parts = vol.split(':');
            if (parts.length < 2) continue;
            const hostPath = parts[0].replace(/\/+$/, '');  // strip trailing slashes
            const containerPath = parts[1].replace(/\/+$/, '');
            if (!containerPath.startsWith('/data/media')) continue;
            entries.push({ hostPath, containerPath });
        }

        if (!this.mount || entries.length === 0) return [];

        // Auto-detect the host prefix by finding the longest common prefix
        // among host paths that, when swapped with PLEX_MOUNT, yields existing dirs.
        // Most volumes share /media/kckern/Media as their prefix.
        const map = [];
        for (const { hostPath, containerPath } of entries) {
            // Walk up the host path to find which prefix, when replaced
            // with PLEX_MOUNT, produces an existing directory for the full path.
            const segments = hostPath.split('/');
            let matched = false;
            for (let cut = 3; cut < segments.length; cut++) {
                const prefix = segments.slice(0, cut).join('/');
                const remainder = segments.slice(cut).join('/');
                const candidate = path.join(this.mount, remainder);
                if (existsSync(candidate)) {
                    map.push({ containerPath, localPath: candidate });
                    matched = true;
                    break;
                }
            }
            if (!matched) {
                // Fallback: try the full host path directly
                if (existsSync(hostPath)) {
                    map.push({ containerPath, localPath: hostPath });
                }
            }
        }

        // Sort longest containerPath first for most-specific matching
        map.sort((a, b) => b.containerPath.length - a.containerPath.length);
        return map;
    }

    /**
     * Authenticated GET request to Plex API
     */
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
            if (error.response?.status === 404) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Fetch all library sections from Plex
     */
    async getLibraries() {
        const data = await this.fetch('library/sections');
        return data?.MediaContainer?.Directory || [];
    }

    /**
     * Fetch all items in a library section
     */
    async getLibraryItems(libraryId) {
        const data = await this.fetch(`library/sections/${libraryId}/all`);
        return data?.MediaContainer?.Metadata || [];
    }

    /**
     * Fetch full metadata for a single item by ratingKey
     */
    async getMetadata(ratingKey) {
        const data = await this.fetch(`library/metadata/${ratingKey}`);
        return data?.MediaContainer?.Metadata?.[0] || null;
    }

    /**
     * Fetch children of an item (e.g., seasons of a show)
     */
    async getChildren(ratingKey) {
        const data = await this.fetch(`library/metadata/${ratingKey}/children`);
        return data?.MediaContainer?.Metadata || [];
    }

    /**
     * Resolve a Plex container-side path to a local mount path
     * using the docker-compose volume map.
     */
    resolveLocalPath(plexPath) {
        if (!plexPath) return null;
        for (const { containerPath, localPath } of this.volumeMap) {
            if (plexPath.startsWith(containerPath)) {
                const relative = plexPath.slice(containerPath.length);
                return path.join(localPath, relative);
            }
        }
        return null;
    }

    /**
     * Authenticated PUT request to Plex API (for pushing metadata)
     */
    async put(endpoint, params = {}) {
        const url = `${this.baseUrl}/${endpoint}`;
        const separator = url.includes('?') ? '&' : '?';
        const searchParams = new URLSearchParams(params);
        const fullUrl = `${url}${separator}X-Plex-Token=${this.token}&${searchParams.toString()}`;

        const response = await axios.put(fullUrl, null, {
            headers: { Accept: 'application/json' }
        });
        return response.data;
    }
}

// ============================================================================
// Helpers — Migrate
// ============================================================================

/**
 * Recursively scan a directory for files matching a given name.
 * Returns array of full paths. Silently skips unreadable directories.
 */
function findFiles(dir, filename) {
    const results = [];
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return results;
    }
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...findFiles(fullPath, filename));
        } else if (entry.name === filename) {
            results.push(fullPath);
        }
    }
    return results;
}

/**
 * Known music-library directory names (substrings of the Plex media path).
 * "Stage" is intentionally excluded — concerts stored there are movies.
 */
const MUSIC_PATH_TOKENS = ['Music', 'Industrial', 'Ambient', "Children's Music"];

/**
 * Determine YML type from nfo.json content.
 *  - Has seasons[] with length > 0 → 'show'
 *  - Has guids, contentRating, or tagline → 'movie'
 *  - Path contains a known music directory token → 'artist'
 *  - Fallback → 'movie'
 */
function detectTypeFromNfo(data) {
    if (Array.isArray(data.seasons) && data.seasons.length > 0) {
        return 'show';
    }
    if (data.guids || data.contentRating || data.tagline) {
        return 'movie';
    }
    if (data.path) {
        const p = data.path;
        for (const token of MUSIC_PATH_TOKENS) {
            // Match as a path segment (preceded by / or start, followed by / or end)
            const re = new RegExp(`(^|/)${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/|$)`, 'i');
            if (re.test(p)) return 'artist';
        }
    }
    return 'movie';
}

/**
 * Parse a potentially comma-separated string into an array of trimmed strings.
 * Returns empty array for falsy input.
 */
function splitTrimArray(value) {
    if (!value || typeof value !== 'string') return [];
    return value.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Convert nfo.json content to a clean YAML-ready object.
 */
function normalizeNfoToYml(data, type) {
    const out = {};

    // --- Common fields ---
    if (data.ratingKey != null) out.ratingKey = String(data.ratingKey);
    if (data.title) out.title = data.title;
    if (data.titleSort && data.titleSort !== data.title) out.titleSort = data.titleSort;
    if (data.summary) out.summary = data.summary;
    if (data.year != null) out.year = parseInt(data.year, 10) || undefined;
    if (data.studio) out.studio = data.studio;

    // --- Normalize tag fields ---

    // labels: empty string → omit; comma-separated → array of lowercase trimmed
    if (data.labels && typeof data.labels === 'string' && data.labels.trim() !== '') {
        out.labels = splitTrimArray(data.labels).map(s => s.toLowerCase());
    }

    // collection → collections array
    if (data.collection) {
        out.collections = splitTrimArray(data.collection);
    }

    // genre — can be a plain string OR the quirky "genre[0].tag.tag" key
    const genreRaw = data.genre || data['genre[0].tag.tag'];
    if (genreRaw) {
        out.genres = splitTrimArray(genreRaw);
    }

    // --- Type-specific fields ---

    if (type === 'show') {
        if (data.director) out.director = data.director;
        if (data.cast) out.cast = data.cast;
        if (data.originallyAvailableAt) out.originallyAvailableAt = data.originallyAvailableAt;

        if (Array.isArray(data.seasons) && data.seasons.length > 0) {
            out.seasons = data.seasons.map(s => {
                const season = {};
                season.index = parseInt(s.index, 10);
                if (isNaN(season.index)) season.index = s.index; // keep original if not numeric
                if (s.title) season.title = s.title;
                // Keep summary only if it differs from the show-level summary
                if (s.summary && s.summary !== data.summary) {
                    season.summary = s.summary;
                }
                return season;
            });
        }
    }

    if (type === 'movie') {
        if (data.director) out.director = data.director;
        if (data.cast) out.cast = data.cast;
        if (data.tagline) out.tagline = data.tagline;
        if (data.contentRating) out.contentRating = data.contentRating;
        if (data.originallyAvailableAt) out.originallyAvailableAt = data.originallyAvailableAt;
        if (data.country) out.country = data.country;
        if (data.guids && typeof data.guids === 'object' && Object.keys(data.guids).length > 0) {
            out.guids = data.guids;
        }
    }

    if (type === 'artist') {
        if (data.country) out.country = data.country;
    }

    // Remove any keys that ended up undefined/null
    for (const key of Object.keys(out)) {
        if (out[key] === undefined || out[key] === null) {
            delete out[key];
        }
    }

    return out;
}

// ============================================================================
// Helpers — Pull
// ============================================================================

/**
 * Extract tag values from Plex tag arrays (e.g., [{tag: "Action"}, {tag: "Drama"}]).
 */
const extractTags = arr => (arr || []).map(t => typeof t === 'string' ? t : t?.tag).filter(Boolean);

/**
 * Convert raw Plex metadata to a clean YAML-ready object.
 */
function buildYmlFromPlex(meta, libType) {
    const out = {};

    // Common fields
    if (meta.ratingKey != null) out.ratingKey = String(meta.ratingKey);
    if (meta.title) out.title = meta.title;
    if (meta.titleSort && meta.titleSort !== meta.title) out.titleSort = meta.titleSort;
    if (meta.summary) out.summary = meta.summary;
    if (meta.year != null) out.year = parseInt(meta.year, 10) || undefined;
    if (meta.studio) out.studio = meta.studio;

    // Tag arrays — Plex returns arrays of {tag: "value"} objects
    const labels = extractTags(meta.Label);
    if (labels.length > 0) out.labels = labels.map(s => s.toLowerCase());

    const collections = extractTags(meta.Collection);
    if (collections.length > 0) out.collections = collections;

    const genres = extractTags(meta.Genre);
    if (genres.length > 0) out.genres = genres;

    // Show/movie fields
    if (libType === 'show' || libType === 'movie') {
        if (meta.originallyAvailableAt) out.originallyAvailableAt = meta.originallyAvailableAt;

        const directors = extractTags(meta.Director);
        if (directors.length > 0) out.director = directors.join(', ');

        const cast = extractTags(meta.Role);
        if (cast.length > 0) out.cast = cast.join(', ');

        if (meta.tagline) out.tagline = meta.tagline;
        if (meta.contentRating) out.contentRating = meta.contentRating;
    }

    // Artist/movie fields
    if (libType === 'artist' || libType === 'movie') {
        const countries = extractTags(meta.Country);
        if (countries.length > 0) out.country = countries.join(', ');
    }

    // Remove any keys that ended up undefined/null
    for (const key of Object.keys(out)) {
        if (out[key] === undefined || out[key] === null) {
            delete out[key];
        }
    }

    return out;
}

/**
 * Merge src into dst, only filling keys where dst value is empty/missing/empty-array.
 * Used for non-force pull mode so existing manual edits are preserved.
 */
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

/**
 * Download poster image from Plex if not already present locally.
 */
async function downloadPosterIfMissing(plex, meta, localDir, libType) {
    const thumbPath = meta.thumb;
    if (!thumbPath) return;

    const posterFilename = libType === 'show' ? 'show.jpg'
        : libType === 'artist' ? 'artist.jpg' : 'poster.jpg';

    const localPoster = path.join(localDir, posterFilename);
    if (existsSync(localPoster)) return;

    try {
        const url = `${plex.baseUrl}${thumbPath}?X-Plex-Token=${plex.token}`;
        const resp = await axios.get(url, { responseType: 'arraybuffer' });
        fs.writeFileSync(localPoster, Buffer.from(resp.data));
        console.log(`    \u{1F4F7} ${posterFilename}`);
    } catch (err) {
        console.error(`    \u26A0\uFE0F  poster download failed: ${err.message}`);
    }
}

// ============================================================================
// Commands
// ============================================================================

async function cmdMigrate(plex) {
    const scanDir = flags.dir || plex.mount;
    if (!scanDir) {
        console.error('Error: No directory to scan. Set PLEX_MOUNT or use --dir <path>.');
        process.exit(1);
    }

    console.log(`Scanning ${scanDir} for nfo.json files...`);
    const nfoFiles = findFiles(scanDir, 'nfo.json');
    console.log(`Found ${nfoFiles.length} nfo.json files`);

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const nfoPath of nfoFiles) {
        try {
            const dir = path.dirname(nfoPath);
            const raw = fs.readFileSync(nfoPath, 'utf-8');
            let data;
            try {
                data = JSON.parse(raw);
            } catch (parseErr) {
                console.error(`\u{1F534} ${path.relative(scanDir, nfoPath)}: JSON parse error — ${parseErr.message}`);
                errors++;
                continue;
            }

            const type = detectTypeFromNfo(data);
            const ymlFilename = `${type}.yml`;
            const ymlPath = path.join(dir, ymlFilename);

            if (existsSync(ymlPath)) {
                skipped++;
                continue;
            }

            const normalized = normalizeNfoToYml(data, type);

            if (flags.dryRun) {
                console.log(`[DRY] ${path.relative(scanDir, nfoPath)} \u2192 ${ymlFilename}`);
                migrated++;
            } else {
                const ymlContent = yaml.dump(normalized, { lineWidth: 120, noRefs: true });
                fs.writeFileSync(ymlPath, ymlContent, 'utf-8');
                console.log(`\u2705 ${path.relative(scanDir, nfoPath)} \u2192 ${ymlFilename}`);
                migrated++;
            }
        } catch (err) {
            console.error(`\u{1F534} ${path.relative(scanDir, nfoPath)}: ${err.message}`);
            errors++;
        }
    }

    console.log(`\n${migrated} migrated, ${skipped} skipped (yml exists), ${errors} errors`);
}

async function cmdPull(plex) {
    if (!flags.library) {
        console.error('Error: --library <id> is required for pull.');
        console.error('Use the Plex web UI or API to find your library section ID.');
        process.exit(1);
    }

    if (!plex.mount) {
        console.error('Error: PLEX_MOUNT is required for pull.');
        process.exit(1);
    }

    // Fetch library list and find the target
    const libraries = await plex.getLibraries();
    const lib = libraries.find(l => String(l.key) === String(flags.library));
    if (!lib) {
        console.error(`Error: Library section ${flags.library} not found.`);
        console.error(`Available libraries: ${libraries.map(l => `${l.key} (${l.title})`).join(', ')}`);
        process.exit(1);
    }

    console.log(`Pulling from library: ${lib.title} (${lib.type}, section ${lib.key})`);

    // Determine YML filename based on library type
    const ymlFilename = lib.type === 'show' ? 'show.yml'
        : lib.type === 'artist' ? 'artist.yml' : 'movie.yml';

    // Get all items in the library
    const items = await plex.getLibraryItems(lib.key);
    console.log(`Found ${items.length} items in library\n`);

    // Build filter regex if provided
    const filterRegex = flags.filter ? new RegExp(flags.filter, 'i') : null;

    let pulled = 0;
    let skipped = 0;
    let errors = 0;

    for (const item of items) {
        // Apply filter
        if (filterRegex && !filterRegex.test(item.title)) {
            continue;
        }

        try {
            // Fetch full metadata (includes Label, Collection, Genre, etc.)
            const meta = await plex.getMetadata(item.ratingKey);
            if (!meta) {
                console.error(`\u26A0\uFE0F  ${item.title}: metadata fetch failed`);
                errors++;
                continue;
            }

            // Resolve local filesystem path
            let plexPath;
            if (lib.type === 'show' || lib.type === 'artist') {
                plexPath = meta.Location?.[0]?.path;
            } else {
                // Movies: use the directory containing the media file
                plexPath = meta.Media?.[0]?.Part?.[0]?.file;
                if (plexPath) plexPath = path.dirname(plexPath);
            }

            const localDir = plex.resolveLocalPath(plexPath);
            if (!localDir) {
                console.warn(`\u26A0\uFE0F  ${item.title}: path not found (plex path: ${plexPath || 'none'})`);
                errors++;
                continue;
            }

            if (!existsSync(localDir)) {
                console.warn(`\u26A0\uFE0F  ${item.title}: local dir does not exist: ${localDir}`);
                errors++;
                continue;
            }

            // Build YML data from Plex metadata
            const ymlData = buildYmlFromPlex(meta, lib.type);

            // For shows: fetch season children and add seasons array
            if (lib.type === 'show') {
                const seasonChildren = await plex.getChildren(meta.ratingKey);
                if (seasonChildren.length > 0) {
                    ymlData.seasons = seasonChildren
                        .filter(s => s.index !== undefined)
                        .map(s => {
                            const season = {};
                            season.index = parseInt(s.index, 10);
                            if (isNaN(season.index)) season.index = s.index;

                            // Only include title if it's not the generic "Season N"
                            const genericTitle = `Season ${s.index}`;
                            if (s.title && s.title !== genericTitle) {
                                season.title = s.title;
                            }

                            // Only include summary if different from show summary
                            if (s.summary && s.summary !== meta.summary) {
                                season.summary = s.summary;
                            }

                            return season;
                        });
                }
            }

            // Read existing YML if it exists
            const ymlPath = path.join(localDir, ymlFilename);
            let existing = {};
            if (existsSync(ymlPath)) {
                try {
                    existing = yaml.load(fs.readFileSync(ymlPath, 'utf-8')) || {};
                } catch (parseErr) {
                    console.error(`\u26A0\uFE0F  ${item.title}: existing YML parse error — ${parseErr.message}`);
                }
            }

            // Merge: --force means Plex wins, otherwise only fill blanks
            const merged = flags.force
                ? { ...existing, ...ymlData }
                : mergeBlankOnly(existing, ymlData);

            // Compare before/after — if no changes, skip
            const existingYml = yaml.dump(existing, { lineWidth: 120, noRefs: true });
            const mergedYml = yaml.dump(merged, { lineWidth: 120, noRefs: true });

            if (existingYml === mergedYml) {
                skipped++;
                continue;
            }

            if (flags.dryRun) {
                console.log(`[DRY] \u2B07\uFE0F  ${item.title}`);
                pulled++;
            } else {
                fs.writeFileSync(ymlPath, mergedYml, 'utf-8');
                console.log(`\u2B07\uFE0F  ${item.title}`);
                pulled++;

                // Download poster if missing
                await downloadPosterIfMissing(plex, meta, localDir, lib.type);

                // For shows: download season posters
                if (lib.type === 'show') {
                    const seasonChildren = await plex.getChildren(meta.ratingKey);
                    for (const s of seasonChildren) {
                        if (s.thumb && s.index !== undefined) {
                            const seasonPoster = path.join(localDir, `season${s.index}.jpg`);
                            if (!existsSync(seasonPoster)) {
                                try {
                                    const url = `${plex.baseUrl}${s.thumb}?X-Plex-Token=${plex.token}`;
                                    const resp = await axios.get(url, { responseType: 'arraybuffer' });
                                    fs.writeFileSync(seasonPoster, Buffer.from(resp.data));
                                    console.log(`    \u{1F4F7} season${s.index}.jpg`);
                                } catch (err) {
                                    console.error(`    \u26A0\uFE0F  season${s.index}.jpg download failed: ${err.message}`);
                                }
                            }
                        }
                    }
                }
            }
        } catch (err) {
            console.error(`\u{1F534} ${item.title}: ${err.message}`);
            errors++;
        }
    }

    console.log(`\n${pulled} pulled, ${skipped} skipped, ${errors} errors`);
}

async function cmdPush(plex) {
    if (!flags.library) {
        console.error('Error: --library <id> is required for push.');
        process.exit(1);
    }

    if (!plex.mount) {
        console.error('Error: PLEX_MOUNT is required for push.');
        process.exit(1);
    }

    // Fetch library list and find the target
    const libraries = await plex.getLibraries();
    const lib = libraries.find(l => String(l.key) === String(flags.library));
    if (!lib) {
        console.error(`Error: Library section ${flags.library} not found.`);
        console.error(`Available libraries: ${libraries.map(l => `${l.key} (${l.title})`).join(', ')}`);
        process.exit(1);
    }

    const ymlFilename = lib.type === 'show' ? 'show.yml'
        : lib.type === 'artist' ? 'artist.yml' : 'movie.yml';

    console.log(`Pushing to library: ${lib.title} (${lib.type}, section ${lib.key})`);

    // Determine local scan directories from docker-compose volume map.
    // A library can have multiple Location paths, each mapping to a different local dir.
    const containerPaths = (lib.Location || []).map(l => l.path);
    const scanDirs = flags.dir
        ? [flags.dir]
        : containerPaths.map(cp => plex.resolveLocalPath(cp)).filter(Boolean);

    if (scanDirs.length === 0) {
        console.error('Error: Could not determine local directories for this library.');
        process.exit(1);
    }

    console.log(`Scanning ${scanDirs.join(', ')} for ${ymlFilename} files...\n`);

    const ymlFiles = scanDirs.flatMap(dir => findFiles(dir, ymlFilename));
    const scanDir = scanDirs[0]; // for relative path display
    const filterRegex = flags.filter ? new RegExp(flags.filter, 'i') : null;

    let pushed = 0;
    let skipped = 0;
    let errors = 0;

    for (const ymlPath of ymlFiles) {
        try {
            const ymlData = yaml.load(fs.readFileSync(ymlPath, 'utf-8'));
            if (!ymlData?.ratingKey) {
                console.warn(`\u26A0\uFE0F  ${path.relative(scanDir, ymlPath)}: no ratingKey, skipping`);
                skipped++;
                continue;
            }

            if (filterRegex && !filterRegex.test(ymlData.title || '')) continue;

            // Fetch current Plex metadata for comparison
            const meta = await plex.getMetadata(ymlData.ratingKey);
            if (!meta) {
                console.warn(`\u26A0\uFE0F  ${ymlData.title || ymlPath}: ratingKey ${ymlData.ratingKey} not found in Plex`);
                skipped++;
                continue;
            }

            // Build params for the show/movie/artist level
            const params = buildPlexParams(ymlData, meta, flags.force);

            // Collect season push actions for shows
            const seasonActions = [];
            if (lib.type === 'show' && Array.isArray(ymlData.seasons)) {
                const plexSeasons = await plex.getChildren(ymlData.ratingKey);
                for (const ymlSeason of ymlData.seasons) {
                    const plexSeason = plexSeasons.find(s => parseInt(s.index, 10) === ymlSeason.index);
                    if (!plexSeason) continue;

                    // Season summary inheritance: if season has no summary, use the show summary
                    const seasonData = { ...ymlSeason };
                    if (!seasonData.summary && ymlData.summary) {
                        seasonData.summary = ymlData.summary;
                    }

                    const seasonParams = buildPlexParams(
                        { title: seasonData.title, summary: seasonData.summary },
                        plexSeason,
                        flags.force
                    );
                    if (Object.keys(seasonParams).length > 0) {
                        seasonActions.push({ plexSeason, seasonParams, index: ymlSeason.index });
                    }
                }
            }

            const hasChanges = Object.keys(params).length > 0 || seasonActions.length > 0;
            if (!hasChanges) {
                skipped++;
                continue;
            }

            if (flags.dryRun) {
                if (Object.keys(params).length > 0) {
                    console.log(`[DRY] \u2B06\uFE0F  ${ymlData.title}: would push ${Object.keys(params).join(', ')}`);
                }
                for (const sa of seasonActions) {
                    console.log(`[DRY]   \u2B06\uFE0F  Season ${sa.index}: would push ${Object.keys(sa.seasonParams).join(', ')}`);
                }
                pushed++;
                continue;
            }

            // Push show/movie/artist level
            if (Object.keys(params).length > 0) {
                await plex.put(`library/metadata/${ymlData.ratingKey}`, params);
                console.log(`\u2B06\uFE0F  ${ymlData.title}: pushed ${Object.keys(params).join(', ')}`);
            }

            // Push season metadata
            for (const sa of seasonActions) {
                await plex.put(`library/metadata/${sa.plexSeason.ratingKey}`, sa.seasonParams);
                console.log(`  \u2B06\uFE0F  Season ${sa.index}: pushed ${Object.keys(sa.seasonParams).join(', ')}`);
            }

            pushed++;
        } catch (err) {
            console.error(`\u{1F534} ${path.relative(scanDir, ymlPath)}: ${err.message}`);
            errors++;
        }
    }

    console.log(`\n${pushed} pushed, ${skipped} skipped, ${errors} errors`);
}

/**
 * Build Plex PUT parameters from YML data, comparing against existing Plex metadata.
 * Without force, only fills empty/missing fields. With force, overwrites.
 *
 * Plex tag format: label[0].tag.tag=fitness&label[1].tag.tag=beginner
 * Simple fields: title.value=...&summary.value=...
 */
function buildPlexParams(ymlData, existingMeta, force) {
    const params = {};

    // Simple value fields
    const valueFields = ['title', 'titleSort', 'summary', 'studio', 'year', 'originallyAvailableAt', 'tagline', 'contentRating'];
    for (const field of valueFields) {
        if (ymlData[field] === undefined || ymlData[field] === null) continue;
        const plexValue = existingMeta[field];
        const isEmpty = plexValue === undefined || plexValue === null || plexValue === '';
        if (force || isEmpty) {
            params[`${field}.value`] = String(ymlData[field]);
        }
    }

    // Tag array fields: labels → label, collections → collection, genres → genre
    const tagFields = { labels: 'Label', collections: 'Collection', genres: 'Genre' };
    for (const [ymlKey, plexKey] of Object.entries(tagFields)) {
        const ymlTags = ymlData[ymlKey];
        if (!Array.isArray(ymlTags) || ymlTags.length === 0) continue;

        const existingTags = extractTags(existingMeta[plexKey]);
        // Genres always sync (tracked with collections); other tags only fill empty
        if (!force && ymlKey !== 'genres' && existingTags.length > 0) continue;

        const paramKey = plexKey.charAt(0).toLowerCase() + plexKey.slice(1);
        ymlTags.forEach((tag, i) => {
            params[`${paramKey}[${i}].tag.tag`] = tag;
        });
    }

    return params;
}

// ============================================================================
// Help
// ============================================================================

function showHelp() {
    console.log(`
Plex Sync CLI - Sync metadata between Plex and local YAML files

Usage:
  node plex-sync.cli.mjs <command> [options]

Commands:
  migrate                Export Plex metadata to YAML (initial setup)
  pull                   Pull latest metadata from Plex into YAML
  push                   Push YAML metadata back to Plex

Options:
  --dry-run              Show what would change without making changes
  --force                Overwrite without confirmation
  --json                 Output as JSON
  --library <id>         Limit to a specific library section
  --filter <regex>       Filter items by title regex
  --dir <path>           Override output directory for YAML files

Environment:
  PLEX_MOUNT             Path to the Plex media mount (required)

Examples:
  node plex-sync.cli.mjs migrate
  node plex-sync.cli.mjs migrate --library 1 --dir ./plex-meta
  node plex-sync.cli.mjs pull --dry-run
  node plex-sync.cli.mjs pull --library 5 --filter "yoga"
  node plex-sync.cli.mjs push --dry-run
  node plex-sync.cli.mjs push --force --library 1
`);
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
    if (!command || command === 'help' || command === '--help' || command === '-h') {
        showHelp();
        process.exit(0);
    }

    // PLEX_MOUNT is required for all operational commands
    if (!process.env.PLEX_MOUNT) {
        console.error('Error: PLEX_MOUNT environment variable is not set.');
        console.error('');
        console.error('Set it to the local path where Plex media is mounted. For example:');
        console.error('  export PLEX_MOUNT=/mnt/plex');
        console.error('  export PLEX_MOUNT=/Volumes/PlexMedia');
        console.error('');
        console.error('Then re-run this command.');
        process.exit(1);
    }

    const plex = new PlexSync();

    try {
        switch (command) {
            case 'migrate':
                await cmdMigrate(plex);
                break;

            case 'pull':
                await cmdPull(plex);
                break;

            case 'push':
                await cmdPush(plex);
                break;

            default:
                console.error(`Unknown command: ${command}`);
                showHelp();
                process.exit(1);
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

main();
