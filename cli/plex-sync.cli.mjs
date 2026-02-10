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
// Command Stubs
// ============================================================================

async function cmdMigrate(plex) {
    console.log('migrate: not yet implemented');
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
