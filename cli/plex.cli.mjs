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

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import axios from '../backend/lib/http.mjs';
import { createLogger } from '../backend/lib/logging/logger.js';
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

const logger = createLogger({
    source: 'cli',
    app: 'plex'
});

// Parse command line arguments
const args = process.argv.slice(2);
const flags = {
    json: args.includes('--json'),
    idsOnly: args.includes('--ids-only'),
    deep: args.includes('--deep'),
    section: null
};

// Extract --section value
const sectionIdx = args.indexOf('--section');
if (sectionIdx !== -1 && args[sectionIdx + 1]) {
    flags.section = args[sectionIdx + 1];
}

// Remove flags from args to get positional arguments
const positionalArgs = args.filter(arg =>
    !arg.startsWith('--') &&
    (sectionIdx === -1 || args.indexOf(arg) !== sectionIdx + 1)
);

const command = positionalArgs[0];
const commandArgs = positionalArgs.slice(1);

/**
 * Plex API client for CLI operations
 */
class PlexCLI {
    constructor() {
        // Load auth from ConfigService (same pattern as backend/lib/plex.mjs)
        const auth = configService.getHouseholdAuth('plex') || {};
        this.token = auth.token;

        if (!this.token) {
            console.error('Error: Plex token not found in config');
            console.error('Ensure secrets.yml has plex.token configured');
            process.exit(1);
        }

        // Get server URL from auth config or environment
        const { plex: plexEnv } = process.env;
        this.host = auth.server_url?.replace(/:\d+$/, '') || plexEnv?.host;
        this.port = plexEnv?.port;
        this.baseUrl = this.port ? `${this.host}:${this.port}` : this.host;

        if (!this.baseUrl) {
            console.error('Error: Plex server URL not configured');
            process.exit(1);
        }

        logger.info('Plex CLI initialized', { baseUrl: this.baseUrl });
    }

    /**
     * Make authenticated request to Plex API
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
            logger.error('Plex API error', { endpoint, error: error.message });
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

function showHelp() {
    console.log(`
Plex CLI - Search and verify Plex library items

Usage:
  node plex.cli.mjs <command> [arguments] [options]

Commands:
  libraries              List all library sections
  search <query>         Search library by title (shows/movies)
  info <id>              Show metadata for a Plex ID
  verify <id> [...]      Check if ID(s) exist in Plex

Options:
  --json                 Output as JSON
  --ids-only             Output only Plex IDs (search command)
  --deep                 Use hub search (finds episodes, tracks, etc.)
  --section <id>         Limit search to specific library section

Examples:
  node plex.cli.mjs libraries
  node plex.cli.mjs search "yoga"
  node plex.cli.mjs search "ninja" --deep         # find episodes
  node plex.cli.mjs search "ninja" --section 14   # fitness library only
  node plex.cli.mjs info 673634
  node plex.cli.mjs verify 606037 11570 11571
  node plex.cli.mjs verify 606037 --json
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

            default:
                console.error(`Unknown command: ${command}`);
                showHelp();
                process.exit(1);
        }
    } catch (error) {
        logger.error('CLI error', { command, error: error.message });
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

main();
