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
    // Env overrides let the CLI run anywhere (e.g. a workstation that is not the
    // Docker host) without `docker exec`. If both are set we skip Docker entirely.
    const envToken = process.env.PLEX_TOKEN;
    const envHost = process.env.PLEX_HOST;
    if (envToken && envHost) {
        return { token: envToken, host: envHost };
    }

    // Token from household auth (env override wins)
    let token = envToken;
    if (!token) {
        const authRaw = dockerRead('data/household/auth/plex.yml');
        if (!authRaw) {
            console.error('Error: cannot read data/household/auth/plex.yml from the daylight-station container.');
            console.error('Ensure the container is running, or set PLEX_TOKEN (and PLEX_HOST) to run off-host.');
            process.exit(1);
        }
        token = (yaml.load(authRaw) || {}).token;
        if (!token) {
            console.error('Error: data/household/auth/plex.yml has no `token` field.');
            process.exit(1);
        }
    }

    // Host from services.yml — keyed by current hostname (env override wins)
    let host = envHost;
    if (!host) {
        const servicesRaw = dockerRead('data/system/config/services.yml');
        if (!servicesRaw) {
            console.error('Error: cannot read data/system/config/services.yml from the container.');
            console.error('Set PLEX_HOST env var to override.');
            process.exit(1);
        }
        const plexHosts = (yaml.load(servicesRaw) || {}).plex || {};
        host = plexHosts[hostname()] || plexHosts['kckern-server'] || plexHosts.docker;
        if (!host) {
            console.error('Error: no plex host found in services.yml for the current host.');
            console.error(`Tried hostname=${hostname()}, fallback kckern-server, fallback docker.`);
            console.error('Set PLEX_HOST env var to override.');
            process.exit(1);
        }
    }

    return { token, host };
}

// Parse command line arguments
const args = process.argv.slice(2);
/**
 * Scalar metadata fields Plex accepts as `<field>.value=...`.
 * YAML manifest keys and CLI flags use these exact names.
 */
const SCALAR_FIELDS = [
    'title', 'titleSort', 'summary', 'tagline', 'studio',
    'contentRating', 'originalTitle', 'originallyAvailableAt'
];

/**
 * Multi-value tag fields. Key = YAML/CLI plural name, value = the singular
 * field name Plex expects in `<field>[i].tag.tag=...`, plus the capitalized
 * key the read API returns them under (needed to diff for removals).
 */
const TAG_FIELDS = {
    genres: { field: 'genre', metaKey: 'Genre' },
    collections: { field: 'collection', metaKey: 'Collection' },
    labels: { field: 'label', metaKey: 'Label' },
    directors: { field: 'director', metaKey: 'Director' },
    writers: { field: 'writer', metaKey: 'Writer' },
    producers: { field: 'producer', metaKey: 'Producer' }
};

const flags = {
    json: args.includes('--json'),
    idsOnly: args.includes('--ids-only'),
    deep: args.includes('--deep'),
    lock: args.includes('--lock'),
    dryRun: args.includes('--dry-run'),
    section: null,
    fromYaml: null,
    ids: null
};

// Flags that consume the next argument as their value
const valueFlags = {
    '--section': 'section',
    '--from-yaml': 'fromYaml',
    '--ids': 'ids'
};
for (const f of SCALAR_FIELDS) valueFlags[`--${f}`] = f;
for (const k of Object.keys(TAG_FIELDS)) valueFlags[`--${k}`] = k;
for (const key of Object.values(valueFlags)) {
    if (!(key in flags)) flags[key] = null;
}

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
 * Map Plex content-type strings to the numeric `type` codes the API expects
 * when creating/editing collections.
 */
const PLEX_TYPE_NUM = {
    movie: 1, show: 2, season: 3, episode: 4, trailer: 5,
    artist: 8, album: 9, track: 10, photo: 13, collection: 18
};

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
     * Authenticated POST request to Plex API (used for creating collections).
     */
    async post(endpoint, params = {}) {
        const url = `${this.baseUrl}/${endpoint}`;
        const separator = url.includes('?') ? '&' : '?';
        const searchParams = new URLSearchParams(params);
        const fullUrl = `${url}${separator}X-Plex-Token=${this.token}&${searchParams.toString()}`;
        const response = await axios.post(fullUrl, null, { headers: { Accept: 'application/json' } });
        return response.data;
    }

    /**
     * Authenticated DELETE request to Plex API (used for removing collection items / collections).
     */
    async del(endpoint, params = {}) {
        const url = `${this.baseUrl}/${endpoint}`;
        const separator = url.includes('?') ? '&' : '?';
        const qs = new URLSearchParams(params).toString();
        const fullUrl = `${url}${separator}X-Plex-Token=${this.token}${qs ? `&${qs}` : ''}`;
        const response = await axios.delete(fullUrl, { headers: { Accept: 'application/json' } });
        return response.data;
    }

    /**
     * Resolve (and cache) the server's machineIdentifier — required to build the
     * `server://...` URIs that collection create/add operations expect.
     */
    async getMachineIdentifier() {
        if (this._machineId) return this._machineId;
        const data = await this.fetch('');
        this._machineId = data?.MediaContainer?.machineIdentifier;
        if (!this._machineId) throw new Error('Could not resolve server machineIdentifier');
        return this._machineId;
    }

    /**
     * List collections — in one section, or across all sections when sectionKey is null.
     */
    async getCollections(sectionKey = null) {
        const sections = sectionKey
            ? [{ key: sectionKey, title: null }]
            : await this.getLibraries();
        const out = [];
        for (const lib of sections) {
            const data = await this.fetch(`library/sections/${lib.key}/collections`);
            const items = data?.MediaContainer?.Metadata || [];
            out.push(...items.map(c => ({
                id: c.ratingKey, title: c.title, childCount: c.childCount,
                subtype: c.subtype, section: lib.key, sectionTitle: lib.title
            })));
        }
        return out;
    }

    /**
     * Get the child items of a collection.
     */
    async getCollectionChildren(id) {
        const data = await this.fetch(`library/collections/${id}/children`);
        return data?.MediaContainer?.Metadata || [];
    }

    /**
     * Create a collection seeded with the given item IDs. Section and content
     * type are inferred from the first item unless sectionId is supplied.
     */
    async createCollection(name, ids, { sectionId = null } = {}) {
        if (!ids.length) throw new Error('createCollection requires at least one item id');
        const first = await this.getMetadata(ids[0]);
        if (!first) throw new Error(`First item ${ids[0]} not found`);
        const typeNum = PLEX_TYPE_NUM[first.type];
        if (!typeNum) throw new Error(`Unsupported item type "${first.type}" for a collection`);
        const section = sectionId || first.librarySectionID;
        if (!section) throw new Error('Could not resolve sectionId; pass --section');
        const machine = await this.getMachineIdentifier();
        const uri = `server://${machine}/com.plexapp.plugins.library/library/metadata/${ids.join(',')}`;
        const data = await this.post('library/collections', {
            type: String(typeNum), title: name, smart: '0', sectionId: String(section), uri
        });
        return data?.MediaContainer?.Metadata?.[0] || null;
    }

    /**
     * Rename a collection. Pass lock=true to also set title.locked so a Plex
     * agent refresh won't overwrite it.
     */
    async renameCollection(id, name, { lock = false } = {}) {
        const meta = await this.getMetadata(id);
        if (!meta) throw new Error(`Collection ${id} not found`);
        const params = { type: '18', id: String(id), 'title.value': name };
        if (lock) params['title.locked'] = '1';
        await this.put(`library/sections/${meta.librarySectionID}/all`, params);
        return this.getMetadata(id);
    }

    /**
     * Add item(s) to a collection.
     */
    async addToCollection(id, itemIds) {
        const machine = await this.getMachineIdentifier();
        const uri = `server://${machine}/com.plexapp.plugins.library/library/metadata/${itemIds.join(',')}`;
        return this.put(`library/collections/${id}/items`, { uri });
    }

    /**
     * Remove a single item from a collection.
     */
    async removeFromCollection(id, itemId) {
        return this.del(`library/collections/${id}/items/${itemId}`);
    }

    /**
     * Delete an entire collection (does not delete the underlying media).
     */
    async deleteCollection(id) {
        return this.del(`library/collections/${id}`);
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
     * Replace a multi-value tag field (genre, label, collection, …) on an item.
     *
     * Tag edits do NOT go through library/metadata/{id} — Plex only accepts them on the
     * section endpoint, keyed by numeric content type. Values already present are re-sent
     * (harmless); values present in Plex but absent from `values` are explicitly removed via
     * the `<field>[].tag.tag-` param, since a bare list only ever adds.
     *
     * @param {Object} meta - Item metadata (needs librarySectionID, type, and the tag's metaKey)
     * @param {string} tagKey - Plural key from TAG_FIELDS (e.g. 'genres')
     * @param {string[]} values - Desired final tag list
     * @param {Object} [opts]
     * @param {boolean} [opts.lock=false] - Send `<field>.locked=1`
     */
    async editTags(meta, tagKey, values, { lock = false } = {}) {
        const spec = TAG_FIELDS[tagKey];
        if (!spec) throw new Error(`Unknown tag field "${tagKey}"`);
        const typeNum = PLEX_TYPE_NUM[meta.type];
        if (!typeNum) throw new Error(`Unsupported item type "${meta.type}" for tag edit`);

        const existing = (meta[spec.metaKey] || []).map(t => t.tag);
        const removals = existing.filter(t => !values.includes(t));

        const params = {
            type: String(typeNum),
            id: String(meta.ratingKey),
            [`${spec.field}.locked`]: lock ? '1' : '0'
        };
        if (removals.length) params[`${spec.field}[].tag.tag-`] = removals.join(',');
        values.forEach((v, i) => { params[`${spec.field}[${i}].tag.tag`] = v; });

        return this.put(`library/sections/${meta.librarySectionID}/all`, params);
    }

    /**
     * Apply a manifest entry (scalar fields and/or tag lists) to one item.
     * Returns the list of field names actually touched.
     */
    async applyEdits(plexId, entry, { lock = false, dryRun = false } = {}) {
        const meta = await this.getMetadata(plexId);
        if (!meta) throw new Error(`No item found with ID: ${plexId}`);

        const scalars = {};
        for (const f of SCALAR_FIELDS) {
            if (typeof entry[f] === 'string') scalars[f] = entry[f];
        }
        const tagEdits = {};
        for (const k of Object.keys(TAG_FIELDS)) {
            if (Array.isArray(entry[k])) tagEdits[k] = entry[k].map(String);
        }

        const touched = [...Object.keys(scalars), ...Object.keys(tagEdits)];
        if (touched.length === 0) return [];
        if (dryRun) return touched;

        if (Object.keys(scalars).length) await this.setMetadata(plexId, scalars, { lock });
        for (const [k, values] of Object.entries(tagEdits)) {
            await this.editTags(meta, k, values, { lock });
        }
        return touched;
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

/** Build a manifest-shaped entry from the CLI flags (scalars as-is, tag lists comma-split). */
function entryFromFlags() {
    const entry = {};
    for (const f of SCALAR_FIELDS) {
        if (flags[f] !== null) entry[f] = flags[f];
    }
    for (const k of Object.keys(TAG_FIELDS)) {
        if (flags[k] !== null) entry[k] = parseIdList(flags[k]);
    }
    return entry;
}

async function cmdSet(plex, plexId) {
    const usage = 'Usage: plex set <id> [--title "..."] [--summary "..."] [--studio "..."] '
        + '[--genres "a,b"] [--labels "a,b"] [--lock] [--dry-run]';
    if (!plexId) {
        console.error(usage);
        process.exit(1);
    }

    const entry = entryFromFlags();
    if (Object.keys(entry).length === 0) {
        console.error(`Error: provide at least one field.\n${usage}`);
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
    if (before.summary) console.log(`  Summary: ${truncate(before.summary)}`);
    if (before.studio) console.log(`  Studio: ${before.studio}`);
    for (const [k, spec] of Object.entries(TAG_FIELDS)) {
        const cur = (before[spec.metaKey] || []).map(t => t.tag);
        if (cur.length) console.log(`  ${k}: ${cur.join(', ')}`);
    }

    console.log('\nWill update:');
    for (const [k, v] of Object.entries(entry)) {
        console.log(`  ${k}: ${truncate(Array.isArray(v) ? v.join(', ') : v)}`);
    }
    if (flags.lock) console.log('  (with .locked=1 — agents will not overwrite)');

    if (flags.dryRun) {
        console.log('\n[dry-run] Skipping PUT.');
        return;
    }

    await plex.applyEdits(plexId, entry, { lock: flags.lock });

    // Verify by re-fetching
    const after = await plex.getMetadata(plexId);
    console.log('\nAfter:');
    console.log(`  Title: ${after?.title}`);
    if (after?.summary) console.log(`  Summary: ${truncate(after.summary)}`);
    if (after?.studio) console.log(`  Studio: ${after.studio}`);
    for (const [k, spec] of Object.entries(TAG_FIELDS)) {
        const cur = (after?.[spec.metaKey] || []).map(t => t.tag);
        if (cur.length) console.log(`  ${k}: ${cur.join(', ')}`);
    }
    console.log('\n✓ Update applied');
}

function truncate(value, max = 120) {
    const s = String(value);
    return s.length > max ? `${s.substring(0, max)}…` : s;
}

async function cmdSetFromYaml(plex, yamlPath) {
    if (!yamlPath) {
        console.error('Usage: plex set-from-yaml <path/to/manifest.yml> [--lock] [--dry-run]');
        console.error('\nManifest format (show/seasons/items are all optional):');
        console.error('  show:');
        console.error('    id: 603855');
        console.error('    title: Super Blocks');
        console.error('    studio: Beachbody');
        console.error('    genres: [Fitness, Educational]');
        console.error('  seasons:');
        console.error('    - id: 603856');
        console.error('      title: "LIIFT MORE Super Block"');
        console.error('      summary: |');
        console.error('        Description text...');
        console.error('  items:            # any type (episodes, movies, collections)');
        console.error('    - id: 603900');
        console.error('      tagline: "..."');
        process.exit(1);
    }

    if (!existsSync(yamlPath)) {
        console.error(`File not found: ${yamlPath}`);
        process.exit(1);
    }

    const raw = readFileSync(yamlPath, 'utf8');
    const manifest = yaml.load(raw);

    // `show` is a single entry; `seasons`/`items` are arrays. All are optional, but at
    // least one must carry an id or there is nothing to do.
    const entries = [
        ...(manifest?.show ? [manifest.show] : []),
        ...(Array.isArray(manifest?.seasons) ? manifest.seasons : []),
        ...(Array.isArray(manifest?.items) ? manifest.items : [])
    ];

    if (entries.length === 0) {
        console.error('Manifest must have a `show:` map and/or a `seasons:`/`items:` array');
        process.exit(1);
    }

    console.log(`\nLoaded ${entries.length} entries from ${yamlPath}`);
    if (flags.lock) console.log('Mode: locking fields (agents will not overwrite)');
    if (flags.dryRun) console.log('Mode: dry-run (no PUTs)');

    let updated = 0;
    let skipped = 0;
    const errors = [];

    for (const entry of entries) {
        if (!entry?.id) {
            console.warn(`  ⚠️  Skipping entry with no id: ${JSON.stringify(entry)}`);
            skipped++;
            continue;
        }

        try {
            const touched = await plex.applyEdits(entry.id, entry, {
                lock: flags.lock,
                dryRun: flags.dryRun
            });

            if (touched.length === 0) {
                console.log(`  ↷ ${entry.id}: no fields to update — skipped`);
                skipped++;
                continue;
            }

            const label = truncate(entry.title || entry.summary || '', 60);
            const prefix = flags.dryRun ? '  [dry]' : '  ✓';
            console.log(`${prefix} ${entry.id}: ${touched.join(', ')} → "${label}"`);
            updated++;
        } catch (err) {
            console.error(`  ✗ ${entry.id}: ${err.message}`);
            errors.push({ id: entry.id, error: err.message });
        }
    }

    console.log(`\n${updated} updated, ${skipped} skipped, ${errors.length} errors`);
    if (errors.length > 0) process.exit(1);
}

function parseIdList(...sources) {
    const ids = [];
    for (const s of sources) {
        if (!s) continue;
        for (const part of String(s).split(',')) {
            const id = part.trim();
            if (id) ids.push(id);
        }
    }
    return ids;
}

async function cmdCollection(plex, sub, rest) {
    switch (sub) {
        case 'list':
        case 'ls': {
            const cols = await plex.getCollections(flags.section);
            if (flags.json) { console.log(JSON.stringify(cols, null, 2)); return; }
            if (cols.length === 0) { console.log('\nNo collections found.'); return; }
            console.log(`\nCollections${flags.section ? ` in section ${flags.section}` : ''}:`);
            console.log('='.repeat(60));
            for (const c of cols) {
                console.log(`\n  [${c.id}] ${c.title}`);
                console.log(`      Items: ${c.childCount ?? '?'}${c.subtype ? `  (${c.subtype})` : ''}`);
                if (c.sectionTitle) console.log(`      Library: ${c.sectionTitle} [${c.section}]`);
            }
            console.log();
            break;
        }

        case 'items':
        case 'children': {
            const id = rest[0];
            if (!id) { console.error('Usage: plex collection items <id>'); process.exit(1); }
            const kids = await plex.getCollectionChildren(id);
            if (flags.json) { console.log(JSON.stringify(kids, null, 2)); return; }
            console.log(`\n${kids.length} item(s) in collection ${id}:`);
            console.log('='.repeat(60));
            for (const k of kids) console.log(`  [${k.ratingKey}] ${k.title}${k.year ? ` (${k.year})` : ''}`);
            console.log();
            break;
        }

        case 'create': {
            const name = flags.title || rest[0];
            const ids = parseIdList(flags.ids, ...rest.slice(name === rest[0] ? 1 : 0));
            if (!name) { console.error('Usage: plex collection create "<name>" --ids <id1,id2,...> [--section <id>]'); process.exit(1); }
            if (!ids.length) { console.error('Error: provide item IDs via --ids <id1,id2,...> or as positional args'); process.exit(1); }
            if (flags.dryRun) {
                console.log(`[dry-run] Would create "${name}" with ${ids.length} item(s): ${ids.join(', ')}`);
                return;
            }
            const meta = await plex.createCollection(name, ids, { sectionId: flags.section });
            console.log(`\n✓ Created collection [${meta?.ratingKey}] ${meta?.title} (childCount=${meta?.childCount})`);
            break;
        }

        case 'rename': {
            const id = rest[0];
            const newName = flags.title || rest.slice(1).join(' ');
            if (!id || !newName) { console.error('Usage: plex collection rename <id> "<newName>" [--lock]'); process.exit(1); }
            if (flags.dryRun) {
                console.log(`[dry-run] Would rename ${id} → "${newName}"${flags.lock ? ' (locked)' : ''}`);
                return;
            }
            const meta = await plex.renameCollection(id, newName, { lock: flags.lock });
            console.log(`\n✓ Renamed [${id}] → ${meta?.title}${flags.lock ? ' (locked)' : ''}`);
            break;
        }

        case 'add': {
            const id = rest[0];
            const itemIds = parseIdList(flags.ids, ...rest.slice(1));
            if (!id || !itemIds.length) { console.error('Usage: plex collection add <id> <itemId> [itemId...]'); process.exit(1); }
            if (flags.dryRun) {
                console.log(`[dry-run] Would add ${itemIds.length} item(s) to ${id}: ${itemIds.join(', ')}`);
                return;
            }
            await plex.addToCollection(id, itemIds);
            console.log(`\n✓ Added ${itemIds.length} item(s) to collection ${id}`);
            break;
        }

        case 'remove':
        case 'rm': {
            const id = rest[0];
            const itemIds = parseIdList(flags.ids, ...rest.slice(1));
            if (!id || !itemIds.length) { console.error('Usage: plex collection remove <id> <itemId> [itemId...]'); process.exit(1); }
            if (flags.dryRun) {
                console.log(`[dry-run] Would remove ${itemIds.length} item(s) from ${id}: ${itemIds.join(', ')}`);
                return;
            }
            for (const itemId of itemIds) await plex.removeFromCollection(id, itemId);
            console.log(`\n✓ Removed ${itemIds.length} item(s) from collection ${id}`);
            break;
        }

        case 'delete': {
            const id = rest[0];
            if (!id) { console.error('Usage: plex collection delete <id>'); process.exit(1); }
            const meta = await plex.getMetadata(id);
            if (!meta) { console.error(`No item found with ID: ${id}`); process.exit(1); }
            if (meta.type !== 'collection') {
                console.error(`ID ${id} is a ${meta.type}, not a collection. Aborting.`);
                process.exit(1);
            }
            if (flags.dryRun) {
                console.log(`[dry-run] Would delete collection [${id}] ${meta.title}`);
                return;
            }
            await plex.deleteCollection(id);
            console.log(`\n✓ Deleted collection [${id}] ${meta.title}`);
            break;
        }

        default:
            console.error(`Unknown collection subcommand: ${sub || '(none)'}`);
            console.error('Valid: list, items, create, rename, add, remove, delete');
            process.exit(1);
    }
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
  collection <subcommand>  Manage collections (see below)

Collection subcommands:
  collection list [--section <id>]        List collections (all sections, or one)
  collection items <id>                   List items in a collection
  collection create "<name>" --ids a,b,c  Create a collection (section/type inferred from first item)
  collection rename <id> "<name>" [--lock] Rename a collection
  collection add <id> <itemId> [...]      Add item(s) to a collection
  collection remove <id> <itemId> [...]   Remove item(s) from a collection
  collection delete <id>                  Delete a collection (media is untouched)

Options:
  --json                   Output as JSON
  --ids-only               Output only Plex IDs (search command)
  --deep                   Use hub search (finds episodes, tracks, etc.)
  --section <id>           Limit search to specific library section
  --title "..."            (set/collection) New title.value
  --summary "..."          (set) New summary.value
  --titleSort "..."        (set) New titleSort.value
  --tagline "..."          (set) New tagline.value
  --studio "..."           (set) New studio.value
  --contentRating "..."    (set) New contentRating.value
  --originalTitle "..."    (set) New originalTitle.value
  --originallyAvailableAt  (set) New originallyAvailableAt.value (YYYY-MM-DD)
  --genres "a,b"           (set) Replace the genre tag list
  --labels "a,b"           (set) Replace the label tag list
  --collections "a,b"      (set) Replace the collection tag list
  --directors "a,b"        (set) Replace the director tag list
  --writers "a,b"          (set) Replace the writer tag list
  --producers "a,b"        (set) Replace the producer tag list
  --ids <a,b,c>            (collection) Comma-separated item IDs for create/add/remove
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
  node plex.cli.mjs set 676490 --studio "Piano With Jonny" --genres "Music,Educational" --lock
  node plex.cli.mjs set-from-yaml data/_drafts/super-blocks-seasons.yml --lock
  node plex.cli.mjs collection list --section 17
  node plex.cli.mjs collection items 675687
  node plex.cli.mjs collection create "Music Appreciation" --ids 412096,648969,243200
  node plex.cli.mjs collection rename 675686 "Music Lessons" --lock
  node plex.cli.mjs collection add 675686 379729 376471
  node plex.cli.mjs collection remove 675686 243200
  node plex.cli.mjs collection delete 675687
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

            case 'collection':
            case 'col':
            case 'coll':
                await cmdCollection(plex, commandArgs[0], commandArgs.slice(1));
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
