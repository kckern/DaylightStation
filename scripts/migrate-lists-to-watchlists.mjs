#!/usr/bin/env node
/**
 * Migration Script: state/lists.yml -> config/watchlists/*.yml
 *
 * Transforms flat array with folder tags into file-per-folder structure.
 *
 * Usage:
 *   node scripts/migrate-lists-to-watchlists.mjs --dry-run    # Preview changes
 *   node scripts/migrate-lists-to-watchlists.mjs              # Execute migration
 *   node scripts/migrate-lists-to-watchlists.mjs --household=my-household
 *
 * Options:
 *   --dry-run    Show what would be migrated without writing files
 *   --household  Specify household ID (default: from config)
 *   --verbose    Show detailed transformation info
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import yaml from 'js-yaml';

// Resolve paths relative to script location
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Get data path from environment or use default
const DATA_PATH = process.env.DAYLIGHT_DATA_PATH || process.env.DATA_PATH || path.join(PROJECT_ROOT, 'data');

// Parse arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose') || args.includes('-v');
const householdArg = args.find(a => a.startsWith('--household='));
const householdId = householdArg?.split('=')[1] || 'default';

console.log('='.repeat(70));
console.log('Lists to Watchlists Migration Script');
console.log('='.repeat(70));
console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
console.log(`Household: ${householdId}`);
console.log(`Data path: ${DATA_PATH}`);
console.log('');

if (dryRun) {
  console.log('DRY RUN - no changes will be made. Run without --dry-run to execute.\n');
}

/**
 * Convert string to kebab-case
 */
function kebabCase(str) {
  if (!str) return 'uncategorized';
  return str
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Transform legacy input format to new unified format
 * Legacy formats:
 *   - type: 'Plex', key: '12345'
 *   - type: 'Local', key: 'filename.mp4'
 *   - kind: 'Plex', media_key: '12345'
 *   - kind: 'Media', media_key: 'filename.mp4'
 */
function transformInput(item) {
  // Already in new format
  if (item.input) return item.input;

  // Legacy format with 'type'
  if (item.type === 'Plex') return `plex:${item.key}`;
  if (item.type === 'Local') return `media:${item.key}`;

  // Legacy format with 'kind'
  if (item.kind === 'Plex') return `plex:${item.media_key}`;
  if (item.kind === 'Media') return `media:${item.media_key}`;

  // Fallback - try to figure it out
  const key = item.key || item.media_key || 'unknown';
  const type = item.type || item.kind || 'unknown';
  return `${type.toLowerCase()}:${key}`;
}

/**
 * Generate a simple unique ID (timestamp-based)
 */
function generateId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

/**
 * Download an image from URL to local path
 */
async function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);

    const request = protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        fs.unlinkSync(destPath);
        downloadImage(response.headers.location, destPath)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    });

    request.on('error', (err) => {
      file.close();
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      reject(err);
    });

    // Timeout after 10 seconds
    request.setTimeout(10000, () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Migrate image from external URL to local storage
 */
async function migrateImage(imageUrl, mediaPath, dryRun) {
  if (!imageUrl) return null;

  // Already local
  if (imageUrl.startsWith('/media/') || imageUrl.startsWith('media/')) {
    return imageUrl;
  }

  // Only migrate Infinity URLs (startinfinity.com)
  if (!imageUrl.includes('startinfinity.com')) {
    if (verbose) {
      console.log(`      [SKIP] Non-Infinity URL: ${imageUrl.slice(0, 50)}...`);
    }
    return imageUrl; // Keep external URL as-is
  }

  const id = generateId();
  const localPath = `/media/img/lists/${id}.jpg`;
  const fullPath = path.join(mediaPath, 'img', 'lists', `${id}.jpg`);

  if (dryRun) {
    console.log(`      [DRY-RUN] Would download image to ${localPath}`);
    return localPath;
  }

  try {
    // Ensure directory exists
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    await downloadImage(imageUrl, fullPath);
    console.log(`      [OK] Downloaded image to ${localPath}`);
    return localPath;
  } catch (err) {
    console.log(`      [WARN] Failed to download image: ${err.message}`);
    return null; // Image expired or inaccessible
  }
}

/**
 * Load YAML file
 */
function loadYaml(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  return yaml.load(content);
}

/**
 * Save data as YAML file
 */
function saveYaml(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const yamlContent = yaml.dump(data, {
    lineWidth: -1,
    quotingType: '"',
    forceQuotes: false
  });
  fs.writeFileSync(filePath, yamlContent, 'utf8');
}

/**
 * Main migration function
 */
async function migrate() {
  // Resolve household path
  // Try flat structure first: data/household/ or data/household-{id}/
  let householdPath;
  if (householdId === 'default') {
    householdPath = path.join(DATA_PATH, 'household');
  } else {
    householdPath = path.join(DATA_PATH, `household-${householdId}`);
  }

  // Fallback to just data/household if the above doesn't exist
  if (!fs.existsSync(householdPath)) {
    householdPath = path.join(DATA_PATH, 'household');
  }

  const sourcePath = path.join(householdPath, 'state', 'lists.yml');
  const targetDir = path.join(householdPath, 'config', 'watchlists');

  // Get media path from environment or derive from data path
  const mediaPath = process.env.DAYLIGHT_MEDIA_PATH || process.env.MEDIA_PATH || '/media';

  console.log(`Source: ${sourcePath}`);
  console.log(`Target: ${targetDir}`);
  console.log(`Media:  ${mediaPath}`);
  console.log('');

  // Check source exists
  if (!fs.existsSync(sourcePath)) {
    console.error(`ERROR: Source file not found: ${sourcePath}`);
    console.log('\nExpected file structure:');
    console.log('  data/household/state/lists.yml');
    process.exit(1);
  }

  // Load source data
  const items = loadYaml(sourcePath);

  if (!items || !Array.isArray(items)) {
    console.error('ERROR: Source file is empty or not an array');
    process.exit(1);
  }

  console.log(`Found ${items.length} items in source file\n`);

  // Group by folder
  const byFolder = {};
  for (const item of items) {
    const folder = kebabCase(item.folder || 'uncategorized');
    if (!byFolder[folder]) byFolder[folder] = [];
    byFolder[folder].push(item);
  }

  const folderNames = Object.keys(byFolder).sort();
  console.log(`Folders: ${folderNames.length}`);
  console.log(`  ${folderNames.join(', ')}\n`);

  const stats = {
    folders: 0,
    items: 0,
    imagesDownloaded: 0,
    imagesFailed: 0
  };

  // Process each folder
  for (const [folder, folderItems] of Object.entries(byFolder)) {
    console.log(`\n[${folder}] - ${folderItems.length} items`);
    stats.folders++;

    const transformed = [];

    for (const item of folderItems) {
      stats.items++;

      // Build new item structure
      const newItem = {
        label: item.label || item.title || 'Untitled'
      };

      // Transform input
      newItem.input = transformInput(item);

      // Set action (default to 'Play')
      newItem.action = item.action || 'Play';

      // Set active (inverse of hide)
      newItem.active = item.hide !== true;

      // Migrate image if present
      if (item.image) {
        const migratedImage = await migrateImage(item.image, mediaPath, dryRun);
        if (migratedImage) {
          newItem.image = migratedImage;
          if (!dryRun && migratedImage.startsWith('/media/')) {
            stats.imagesDownloaded++;
          }
        } else {
          stats.imagesFailed++;
        }
      }

      // Preserve any extra metadata
      if (item.year) newItem.year = item.year;
      if (item.added) newItem.added = item.added;

      if (verbose) {
        console.log(`    ${newItem.label}: ${newItem.input}`);
      }

      transformed.push(newItem);
    }

    const targetPath = path.join(targetDir, `${folder}.yml`);

    if (dryRun) {
      console.log(`  [DRY-RUN] Would write ${transformed.length} items to ${folder}.yml`);
    } else {
      saveYaml(targetPath, transformed);
      console.log(`  [OK] Wrote ${transformed.length} items to ${folder}.yml`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Folders created:    ${stats.folders}`);
  console.log(`Items migrated:     ${stats.items}`);
  console.log(`Images downloaded:  ${stats.imagesDownloaded}`);
  console.log(`Images failed:      ${stats.imagesFailed}`);
  console.log('');

  if (dryRun) {
    console.log('This was a dry run. Run without --dry-run to execute migration.\n');
  } else {
    console.log('Migration complete!\n');
    console.log('Next steps:');
    console.log('  1. Verify migrated files in config/watchlists/');
    console.log('  2. Test AdminApp with new data');
    console.log('  3. Once verified, you can archive state/lists.yml');
    console.log('');
  }
}

// Run migration
migrate().catch(err => {
  console.error('\nMigration failed:', err.message);
  if (verbose) {
    console.error(err.stack);
  }
  process.exit(1);
});
