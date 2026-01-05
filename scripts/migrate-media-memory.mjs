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
