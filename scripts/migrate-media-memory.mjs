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
import axios from '../backend/lib/http.mjs';

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
        let library = libraryByName[libraryName.toLowerCase()];
        if (!library) {
            // Try partial match
            library = libraries.find(l =>
                l.title.toLowerCase().includes(libraryName.toLowerCase()) ||
                libraryName.toLowerCase().includes(l.title.toLowerCase())
            );
            if (library) {
                console.log(`  Using partial match: "${library.title}" (ID: ${library.key})`);
            } else {
                console.log(`  WARNING: No library found matching "${libraryName}", skipping`);
                continue;
            }
        }

        const libraryId = parseInt(library.key, 10);
        const newFilename = buildLibraryFilename(libraryId, library.title);
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
                // Keep entry with orphan flag for validator to handle later
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
                duration: meta.duration ? Math.round(meta.duration / 1000) : null
            };

            // Preserve watch duration data if it exists
            if (entry.watched_duration_lifetime) {
                migratedData[plexId].watchedDurationLifetime = entry.watched_duration_lifetime;
            }

            // Remove null values for cleaner YAML
            Object.keys(migratedData[plexId]).forEach(key => {
                if (migratedData[plexId][key] === null) {
                    delete migratedData[plexId][key];
                }
            });

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
        } else {
            console.log(`  [DRY RUN] Would write: ${newFilename}`);
            console.log(`  [DRY RUN] Would archive: ${file}`);
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
}

main().catch(err => {
    console.error('Error:', err.message);
    logger.error('Migration failed', { error: err.message });
    process.exit(1);
});
