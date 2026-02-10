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

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import fs from 'fs';
import yaml from 'js-yaml';
import axios from '../backend/lib/http.mjs';
import { configService } from '../backend/lib/config/ConfigService.mjs';
import { resolveConfigPaths } from '../backend/lib/config/pathResolver.mjs';
import { hydrateProcessEnvFromConfigs } from '../backend/lib/logging/config.js';

// Bootstrap config (same as backend/index.js)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDocker = existsSync('/.dockerenv');
const configPaths = resolveConfigPaths({ isDocker, codebaseDir: path.join(__dirname, '..') });

if (configPaths.error) {
    console.error('Config error:', configPaths.error);
    console.error('Set DAYLIGHT_DATA_PATH environment variable');
    process.exit(1);
}

hydrateProcessEnvFromConfigs(configPaths.configDir);
configService.init({ dataDir: configPaths.dataDir });

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
        // Load auth from ConfigService (same pattern as plex.cli.mjs)
        const auth = configService.getHouseholdAuth('plex') || {};
        this.token = auth.token;

        if (!this.token) {
            console.error('Error: Plex token not found in config');
            console.error('Ensure secrets.yml has plex.token configured');
            process.exit(1);
        }

        // Get server URL from auth config
        const host = auth.server_url?.replace(/:\d+$/, '') || '';
        const { plex: plexEnv } = process.env;
        const port = plexEnv?.port;
        this.baseUrl = port ? `${host}:${port}` : host;

        if (!this.baseUrl) {
            console.error('Error: Plex server URL not configured');
            process.exit(1);
        }

        // PLEX_MOUNT from environment
        this.mount = process.env.PLEX_MOUNT;
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
    console.log('pull: not yet implemented');
}

async function cmdPush(plex) {
    console.log('push: not yet implemented');
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
