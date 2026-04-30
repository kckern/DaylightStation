#!/usr/bin/env node

/**
 * Plex CLI - Command-line interface for Plex library operations
 *
 * A CLI tool for searching Plex libraries and verifying media IDs.
 * Used for diagnosing and backfilling media_memory entries.
 *
 * Usage:
 *   node plex.cli.mjs <command> [options]
 *
 * Commands:
 *   libraries              List all library sections
 *   search <query>         Search library by title
 *   info <id>              Show metadata for a Plex ID
 *   verify <id> [id2...]   Check if ID(s) exist in Plex
 *
 * Options:
 *   --json                 Output as JSON
 *   --ids-only             Output only matching Plex IDs
 *   --section <id>         Limit search to specific library section
 *
 * @module cli/plex
 */

import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { hostname } from 'os';
import yaml from 'js-yaml';
import axios from 'axios';

// ============================================================================
// Config: read auth + host from container via docker exec
// (matches the buxfer.cli.mjs pattern — self-contained, no app server bootstrap)
// ============================================================================

const CONTAINER = 'daylight-station';

function dockerRead(filePath) {
    try {
        return execSync(
            `sudo docker exec ${CONTAINER} sh -c 'cat ${filePath}'`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        );
    } catch {
        return null;
    }
}

function loadConfig() {
    // Token from household auth
    const authRaw = dockerRead('data/household/auth/plex.yml');
    if (!authRaw) {
        console.error('Error: cannot read data/household/auth/plex.yml from the daylight-station container.');
        console.error('Ensure the container is running.');
        process.exit(1);
    }
    const auth = yaml.load(authRaw) || {};
    const token = auth.token;
    if (!token) {
        console.error('Error: data/household/auth/plex.yml has no `token` field.');
        process.exit(1);
    }

    // Host from services.yml — keyed by current hostname
    const servicesRaw = dockerRead('data/system/config/services.yml');
    if (!servicesRaw) {
        console.error('Error: cannot read data/system/config/services.yml from the container.');
        process.exit(1);
    }
    const services = yaml.load(servicesRaw) || {};
    const plexHosts = services.plex || {};
    const host = process.env.PLEX_HOST || plexHosts[hostname()] || plexHosts['kckern-server'] || plexHosts.docker;
    if (!host) {
        console.error('Error: no plex host found in services.yml for the current host.');
        console.error(`Tried hostname=${hostname()}, fallback kckern-server, fallback docker.`);
        console.error('Set PLEX_HOST env var to override.');
        process.exit(1);
    }

    return { token, host };
}

// Parse command line arguments
const args = process.argv.slice(2);
const flags = {
    json: args.includes('--json'),
    idsOnly: args.includes('--ids-only'),
    deep: args.includes('--deep'),
    lock: args.includes('--lock'),
    dryRun: args.includes('--dry-run'),
    section: null,
    title: null,
    summary: null,
    titleSort: null,
    tagline: null,
    fromYaml: null
};

// Flags that consume the next argument as their value
const valueFlags = {
    '--section': 'section',
    '--title': 'title',
    '--summary': 'summary',
    '--titleSort': 'titleSort',
    '--tagline': 'tagline',
    '--from-yaml': 'fromYaml'
};

// Track indices of flag-values so we can exclude them from positional args
const consumedValueIndices = new Set();
for (const [flag, key] of Object.entries(valueFlags)) {
    const idx = args.indexOf(flag);
    if (idx !== -1 && args[idx + 1] !== undefined) {
        flags[key] = args[idx + 1];
        consumedValueIndices.add(idx + 1);
    }
}

// Remove flags and flag-values from args to get positional arguments
const positionalArgs = args.filter((arg, i) =>
    !arg.startsWith('--') && !consumedValueIndices.has(i)
);

const command = positionalArgs[0];
const commandArgs = positionalArgs.slice(1);

/**
 * Plex API client for CLI operations
 */
class PlexCLI {
    constructor() {
        const { token, host } = loadConfig();
        this.token = token;
        this.baseUrl = host.replace(/\/$/, '');
    }

    /**
     * Make authenticated GET request to Plex API
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
            console.error(`Plex API error on ${endpoint}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get all library sections
     */
    async getLibraries() {
        const data = await this.fetch('library/sections');
        return data?.MediaContainer?.Directory || [];
    }

    /**
     * Search a library section by title (top-level items only)
     */
    async searchLibrary(query, sectionKey = null) {
        let results = [];

        if (sectionKey) {
            // Search specific section
            const data = await this.fetch(`library/sections/${sectionKey}/all?title=${encodeURIComponent(query)}`);
            const items = data?.MediaContainer?.Metadata || [];
            results = items.map(item => this.formatSearchResult(item, sectionKey));
        } else {
            // Search all sections
            const libraries = await this.getLibraries();
            for (const lib of libraries) {
                const data = await this.fetch(`library/sections/${lib.key}/all?title=${encodeURIComponent(query)}`);
                const items = data?.MediaContainer?.Metadata || [];
                results.push(...items.map(item => this.formatSearchResult(item, lib.key, lib.title)));
            }
        }

        return results;
    }

    /**
     * Hub search - searches across all content types including episodes
     */
    async hubSearch(query, sectionKey = null) {
        const sectionParam = sectionKey ? `&sectionId=${sectionKey}` : '';
        const data = await this.fetch(`hubs/search?query=${encodeURIComponent(query)}${sectionParam}`);

        const hubs = data?.MediaContainer?.Hub || [];
        let results = [];

        for (const hub of hubs) {
            const items = hub.Metadata || [];
            for (const item of items) {
                results.push(this.formatSearchResult(item, hub.librarySectionID, hub.librarySectionTitle));
            }
        }

        return results;
    }

    /**
     * Get metadata for a specific Plex ID
     */
    async getMetadata(plexId) {
        const data = await this.fetch(`library/metadata/${plexId}`);
        if (!data?.MediaContainer?.Metadata?.length) {
            return null;
        }
        return data.MediaContainer.Metadata[0];
    }

    /**
     * Verify if a Plex ID exists
     */
    async verifyId(plexId) {
        const meta = await this.getMetadata(plexId);
        return {
            id: plexId,
            exists: meta !== null,
            title: meta?.title || null,
            type: meta?.type || null
        };
    }

    /**
     * Authenticated PUT request to Plex API.
     * Used for editing metadata (title, summary, etc.).
     *
     * @param {string} endpoint - API path (e.g., 'library/metadata/603856')
     * @param {Object} params - Query params to send (e.g., { 'title.value': 'New Title' })
     * @returns {Promise<Object>} Response data
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

    /**
     * Update metadata fields on a Plex item.
     * Builds Plex's `field.value=...` (and optional `field.locked=1`) params and PUTs them.
     *
     * @param {string} plexId - Plex rating key (e.g., '603856')
     * @param {Object} fields - Field name -> string value (only present fields are sent)
     * @param {Object} [opts]
     * @param {boolean} [opts.lock=false] - Also send `field.locked=1` for each field (recommended for
     *   seasons whose default title comes from a Plex agent and would otherwise be re-overwritten on refresh)
     * @returns {Promise<Object>} Plex response
     */
    async setMetadata(plexId, fields, { lock = false } = {}) {
        const params = {};
        for (const [field, value] of Object.entries(fields)) {
            if (value === undefined || value === null) continue;
            params[`${field}.value`] = String(value);
            if (lock) params[`${field}.locked`] = '1';
        }
        if (Object.keys(params).length === 0) {
            throw new Error('setMetadata called with no fields to update');
        }
        return this.put(`library/metadata/${plexId}`, params);
    }

    /**
     * Format search result for display
     */
    formatSearchResult(item, sectionKey, sectionTitle = null) {
        return {
            id: item.ratingKey,
            title: item.title,
            type: item.type,
            year: item.year,
            parent: item.parentTitle,
            grandparent: item.grandparentTitle,
            section: sectionKey,
            sectionTitle: sectionTitle
        };
    }
}

// ============================================================================
// Command Implementations
// ============================================================================

async function cmdLibraries(plex) {
    const libraries = await plex.getLibraries();

    if (flags.json) {
        console.log(JSON.stringify(libraries, null, 2));
        return;
    }

    console.log('\nPlex Libraries:');
    console.log('='.repeat(60));

    for (const lib of libraries) {
        console.log(`\n  [${lib.key}] ${lib.title}`);
        console.log(`      Type: ${lib.type}`);
        console.log(`      Agent: ${lib.agent}`);
    }
    console.log();
}

async function cmdSearch(plex, query) {
    if (!query) {
        console.error('Usage: plex search <query>');
        process.exit(1);
    }

    const searchType = flags.deep ? 'hub (deep)' : 'library';
    console.error(`Searching ${searchType} for: "${query}"...`);

    const results = flags.deep
        ? await plex.hubSearch(query, flags.section)
        : await plex.searchLibrary(query, flags.section);

    if (flags.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
    }

    if (flags.idsOnly) {
        results.forEach(r => console.log(r.id));
        return;
    }

    if (results.length === 0) {
        console.log('\nNo results found.');
        return;
    }

    console.log(`\nFound ${results.length} result(s):`);
    console.log('='.repeat(70));

    for (const r of results) {
        const context = r.grandparent
            ? `${r.grandparent} > ${r.parent}`
            : r.parent || '';

        console.log(`\n  [${r.id}] ${r.title}`);
        console.log(`      Type: ${r.type}${r.year ? ` (${r.year})` : ''}`);
        if (context) {
            console.log(`      Context: ${context}`);
        }
        if (r.sectionTitle) {
            console.log(`      Library: ${r.sectionTitle} [${r.section}]`);
        }
    }
    console.log();
}

async function cmdInfo(plex, plexId) {
    if (!plexId) {
        console.error('Usage: plex info <id>');
        process.exit(1);
    }

    const meta = await plex.getMetadata(plexId);

    if (!meta) {
        console.error(`No item found with ID: ${plexId}`);
        process.exit(1);
    }

    if (flags.json) {
        console.log(JSON.stringify(meta, null, 2));
        return;
    }

    console.log('\nPlex Item Info:');
    console.log('='.repeat(60));
    console.log(`  ID: ${meta.ratingKey}`);
    console.log(`  Title: ${meta.title}`);
    console.log(`  Type: ${meta.type}`);

    if (meta.year) console.log(`  Year: ${meta.year}`);
    if (meta.parentTitle) console.log(`  Parent: ${meta.parentTitle}`);
    if (meta.grandparentTitle) console.log(`  Show/Artist: ${meta.grandparentTitle}`);
    if (meta.duration) console.log(`  Duration: ${Math.round(meta.duration / 1000 / 60)} min`);
    if (meta.summary) {
        const summary = meta.summary.length > 200
            ? meta.summary.substring(0, 200) + '...'
            : meta.summary;
        console.log(`  Summary: ${summary}`);
    }
    console.log();
}

async function cmdVerify(plex, ids) {
    if (ids.length === 0) {
        console.error('Usage: plex verify <id> [id2] [id3] ...');
        process.exit(1);
    }

    const results = [];

    for (const id of ids) {
        const result = await plex.verifyId(id);
        results.push(result);
    }

    if (flags.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
    }

    console.log('\nVerification Results:');
    console.log('='.repeat(60));

    for (const r of results) {
        const status = r.exists ? 'EXISTS' : 'MISSING';
        const icon = r.exists ? '✓' : '✗';
        console.log(`  ${icon} [${r.id}] ${status}${r.title ? `: ${r.title}` : ''}`);
    }

    const missing = results.filter(r => !r.exists).length;
    const valid = results.filter(r => r.exists).length;
    console.log(`\nSummary: ${valid} valid, ${missing} missing`);
    console.log();
}

async function cmdSet(plex, plexId) {
    if (!plexId) {
        console.error('Usage: plex set <id> [--title "..."] [--summary "..."] [--titleSort "..."] [--tagline "..."] [--lock] [--dry-run]');
        process.exit(1);
    }

    const fields = {};
    if (flags.title !== null) fields.title = flags.title;
    if (flags.summary !== null) fields.summary = flags.summary;
    if (flags.titleSort !== null) fields.titleSort = flags.titleSort;
    if (flags.tagline !== null) fields.tagline = flags.tagline;

    if (Object.keys(fields).length === 0) {
        console.error('Error: provide at least one of --title, --summary, --titleSort, --tagline');
        process.exit(1);
    }

    // Show before-state for user verification
    const before = await plex.getMetadata(plexId);
    if (!before) {
        console.error(`No item found with ID: ${plexId}`);
        process.exit(1);
    }

    console.log('\nBefore:');
    console.log(`  ID: ${before.ratingKey}  type: ${before.type}`);
    console.log(`  Title: ${before.title}`);
    if (before.summary) console.log(`  Summary: ${before.summary.substring(0, 120)}${before.summary.length > 120 ? '…' : ''}`);

    console.log('\nWill update:');
    for (const [k, v] of Object.entries(fields)) {
        const display = String(v).substring(0, 120);
        console.log(`  ${k}: ${display}${String(v).length > 120 ? '…' : ''}`);
    }
    if (flags.lock) console.log('  (with .locked=1 — agents will not overwrite)');

    if (flags.dryRun) {
        console.log('\n[dry-run] Skipping PUT.');
        return;
    }

    await plex.setMetadata(plexId, fields, { lock: flags.lock });

    // Verify by re-fetching
    const after = await plex.getMetadata(plexId);
    console.log('\nAfter:');
    console.log(`  Title: ${after?.title}`);
    if (after?.summary) console.log(`  Summary: ${after.summary.substring(0, 120)}${after.summary.length > 120 ? '…' : ''}`);
    console.log('\n✓ Update applied');
}

async function cmdSetFromYaml(plex, yamlPath) {
    if (!yamlPath) {
        console.error('Usage: plex set-from-yaml <path/to/manifest.yml> [--lock] [--dry-run]');
        console.error('\nManifest format:');
        console.error('  show:               # optional, for context only');
        console.error('    id: 603855');
        console.error('    title: Super Blocks');
        console.error('  seasons:');
        console.error('    - id: 603856');
        console.error('      title: "LIIFT MORE Super Block"');
        console.error('      summary: |');
        console.error('        Description text...');
        process.exit(1);
    }

    if (!existsSync(yamlPath)) {
        console.error(`File not found: ${yamlPath}`);
        process.exit(1);
    }

    const raw = readFileSync(yamlPath, 'utf8');
    const manifest = yaml.load(raw);

    if (!manifest || !Array.isArray(manifest.seasons)) {
        console.error('Manifest must have a top-level `seasons:` array');
        process.exit(1);
    }

    console.log(`\nLoaded ${manifest.seasons.length} season entries from ${yamlPath}`);
    if (manifest.show?.title) console.log(`Show: ${manifest.show.title} (id ${manifest.show.id})`);
    if (flags.lock) console.log('Mode: locking fields (agents will not overwrite)');
    if (flags.dryRun) console.log('Mode: dry-run (no PUTs)');

    let updated = 0;
    let skipped = 0;
    const errors = [];

    for (const entry of manifest.seasons) {
        if (!entry?.id) {
            console.warn(`  ⚠️  Skipping entry with no id: ${JSON.stringify(entry)}`);
            skipped++;
            continue;
        }

        const fields = {};
        if (typeof entry.title === 'string') fields.title = entry.title;
        if (typeof entry.summary === 'string') fields.summary = entry.summary;
        if (typeof entry.titleSort === 'string') fields.titleSort = entry.titleSort;
        if (typeof entry.tagline === 'string') fields.tagline = entry.tagline;

        if (Object.keys(fields).length === 0) {
            console.log(`  ↷ ${entry.id}: no fields to update — skipped`);
            skipped++;
            continue;
        }

        const fieldList = Object.keys(fields).join(', ');
        if (flags.dryRun) {
            console.log(`  [dry] ${entry.id}: would set ${fieldList} → "${(fields.title || fields.summary || '').substring(0, 60)}…"`);
            updated++;
            continue;
        }

        try {
            await plex.setMetadata(entry.id, fields, { lock: flags.lock });
            console.log(`  ✓ ${entry.id}: updated ${fieldList} → "${(fields.title || '').substring(0, 60)}"`);
            updated++;
        } catch (err) {
            console.error(`  ✗ ${entry.id}: ${err.message}`);
            errors.push({ id: entry.id, error: err.message });
        }
    }

    console.log(`\n${updated} updated, ${skipped} skipped, ${errors.length} errors`);
    if (errors.length > 0) process.exit(1);
}

function showHelp() {
    console.log(`
Plex CLI - Search, verify, and edit Plex library items

Usage:
  node plex.cli.mjs <command> [arguments] [options]

Commands:
  libraries                List all library sections
  search <query>           Search library by title (shows/movies)
  info <id>                Show metadata for a Plex ID
  verify <id> [...]        Check if ID(s) exist in Plex
  set <id>                 Update metadata for a single item
  set-from-yaml <file>     Bulk-update metadata from a YAML manifest

Options:
  --json                   Output as JSON
  --ids-only               Output only Plex IDs (search command)
  --deep                   Use hub search (finds episodes, tracks, etc.)
  --section <id>           Limit search to specific library section
  --title "..."            (set) New title.value
  --summary "..."          (set) New summary.value
  --titleSort "..."        (set) New titleSort.value
  --tagline "..."          (set) New tagline.value
  --from-yaml <file>       (alt to positional) Manifest path for set-from-yaml
  --lock                   Also send .locked=1 (prevents agent overwrite — recommended for seasons)
  --dry-run                Show what would be sent without making the request

Examples:
  node plex.cli.mjs libraries
  node plex.cli.mjs search "yoga"
  node plex.cli.mjs search "ninja" --deep
  node plex.cli.mjs info 673634
  node plex.cli.mjs verify 606037 11570 11571
  node plex.cli.mjs set 603856 --title "LIIFT MORE Super Block" --lock
  node plex.cli.mjs set 603856 --summary "..." --dry-run
  node plex.cli.mjs set-from-yaml data/_drafts/super-blocks-seasons.yml --lock
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

    const plex = new PlexCLI();

    try {
        switch (command) {
            case 'libraries':
            case 'libs':
                await cmdLibraries(plex);
                break;

            case 'search':
            case 's':
                await cmdSearch(plex, commandArgs.join(' '));
                break;

            case 'info':
            case 'i':
                await cmdInfo(plex, commandArgs[0]);
                break;

            case 'verify':
            case 'v':
                await cmdVerify(plex, commandArgs);
                break;

            case 'set':
                await cmdSet(plex, commandArgs[0]);
                break;

            case 'set-from-yaml':
            case 'yaml':
                await cmdSetFromYaml(plex, commandArgs[0] || flags.fromYaml);
                break;

            default:
                console.error(`Unknown command: ${command}`);
                showHelp();
                process.exit(1);
        }
    } catch (error) {
        console.error(`CLI error in ${command}: ${error.message}`);
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

main();
