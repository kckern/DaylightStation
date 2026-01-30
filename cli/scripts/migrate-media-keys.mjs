#!/usr/bin/env node
/**
 * Migrate media keys to compound format (prefix:id)
 *
 * Normalizes existing media memory YAML files by converting bare numeric keys
 * to compound keys (e.g., '11282' -> 'plex:11282') and merging duplicates.
 *
 * Usage:
 *   node cli/scripts/migrate-media-keys.mjs [options]
 *
 * Options:
 *   --dry-run              Show what would change without making changes
 *   --data-path /path      Override default data path
 *   --help, -h             Show this help message
 *
 * @module cli/scripts/migrate-media-keys
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_DATA_PATH = process.env.DAYLIGHT_DATA_PATH
  || '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data';

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const HELP = args.includes('--help') || args.includes('-h');

// Extract --data-path value
const dataPathIdx = args.indexOf('--data-path');
const DATA_PATH = dataPathIdx !== -1 && args[dataPathIdx + 1]
  ? args[dataPathIdx + 1]
  : DEFAULT_DATA_PATH;

const MEDIA_MEMORY_PATH = `${DATA_PATH}/household/history/media_memory`;

// Map directory names to key prefixes
const PREFIX_MAP = {
  'plex': 'plex',
  'folder': 'folder',
  // Add more mappings as needed
};

// =============================================================================
// Help
// =============================================================================

function showHelp() {
  console.log(`
Media Key Migration Script
==========================

Normalizes media memory YAML files by converting bare numeric keys to compound
keys (e.g., '11282' -> 'plex:11282') and merging duplicate entries.

Usage:
  node cli/scripts/migrate-media-keys.mjs [options]

Options:
  --dry-run              Show what would change without making changes
  --data-path /path      Override default data path
  --help, -h             Show this help message

Environment:
  DAYLIGHT_DATA_PATH     Default data path (if --data-path not specified)

Default paths:
  Data path:  ${DEFAULT_DATA_PATH}
  Media mem:  ${MEDIA_MEMORY_PATH}

Merge Rules:
  - playhead:   take maximum value
  - percent:    take maximum value
  - playCount:  sum both values
  - lastPlayed: take most recent
  - watchTime:  sum both values
  - Other fields (title, parent, etc.): keep if present

Examples:
  # Preview changes without modifying files
  node cli/scripts/migrate-media-keys.mjs --dry-run

  # Run migration with custom data path
  node cli/scripts/migrate-media-keys.mjs --data-path /custom/path

  # Run actual migration
  node cli/scripts/migrate-media-keys.mjs
`);
}

// =============================================================================
// YAML Utilities
// =============================================================================

/**
 * Load YAML file safely
 * @param {string} filePath - Path to YAML file
 * @returns {object|null} - Parsed YAML or null on error
 */
function loadYaml(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content) || {};
  } catch (e) {
    console.error(`  Error loading ${filePath}: ${e.message}`);
    return null;
  }
}

/**
 * Save data to YAML file
 * @param {string} filePath - Path to YAML file
 * @param {object} data - Data to save
 */
function saveYaml(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, yaml.dump(data, {
    lineWidth: -1,
    quotingType: "'",
    forceQuotes: false
  }));
}

// =============================================================================
// Key Normalization
// =============================================================================

/**
 * Check if a key is already compound (has prefix)
 * @param {string} key - The key to check
 * @returns {boolean}
 */
function isCompoundKey(key) {
  return /^[a-z]+:/.test(key);
}

/**
 * Extract the numeric ID from a key
 * @param {string} key - The key (bare or compound)
 * @returns {string} - The numeric ID portion
 */
function extractId(key) {
  if (isCompoundKey(key)) {
    return key.split(':').slice(1).join(':');
  }
  return key;
}

/**
 * Normalize a key to compound format
 * @param {string} key - The key to normalize
 * @param {string} prefix - The prefix to use (e.g., 'plex')
 * @returns {string} - Compound key (e.g., 'plex:11282')
 */
function normalizeKey(key, prefix) {
  if (isCompoundKey(key)) {
    return key; // Already compound
  }
  return `${prefix}:${key}`;
}

// =============================================================================
// Date Parsing
// =============================================================================

/**
 * Parse a date string in various formats
 * @param {string|Date} dateStr - Date string or Date object
 * @returns {Date|null}
 */
function parseDate(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return dateStr;

  // Handle "2025-12-07 22.54.56" format
  const normalized = String(dateStr)
    .replace(' ', 'T')
    .replace(/\.(\d{2})\.(\d{2})$/, ':$1:$2');

  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Compare two date strings and return the most recent
 * @param {string} date1
 * @param {string} date2
 * @returns {string} - The more recent date string
 */
function mostRecentDate(date1, date2) {
  const d1 = parseDate(date1);
  const d2 = parseDate(date2);

  if (!d1 && !d2) return null;
  if (!d1) return date2;
  if (!d2) return date1;

  return d1 > d2 ? date1 : date2;
}

// =============================================================================
// Entry Merging
// =============================================================================

/**
 * Merge two entries according to merge rules
 * @param {object} existing - Existing entry
 * @param {object} incoming - Incoming entry to merge
 * @returns {object} - Merged entry
 */
function mergeEntries(existing, incoming) {
  const merged = { ...existing };

  // playhead: take max
  if (incoming.playhead !== undefined) {
    merged.playhead = Math.max(existing.playhead || 0, incoming.playhead || 0);
  }

  // percent: take max
  if (incoming.percent !== undefined) {
    merged.percent = Math.max(existing.percent || 0, incoming.percent || 0);
  }

  // playCount: sum both
  if (incoming.playCount !== undefined) {
    merged.playCount = (existing.playCount || 0) + (incoming.playCount || 0);
  }

  // lastPlayed: take most recent
  if (incoming.lastPlayed !== undefined) {
    merged.lastPlayed = mostRecentDate(existing.lastPlayed, incoming.lastPlayed);
  }

  // watchTime: sum both
  if (incoming.watchTime !== undefined) {
    merged.watchTime = (existing.watchTime || 0) + (incoming.watchTime || 0);
  }

  // Other string fields: keep if present (prefer non-empty)
  const stringFields = ['title', 'parent', 'grandparent', 'parentId', 'grandparentId',
                        'libraryId', 'mediaType', 'mediaDuration', 'duration'];

  for (const field of stringFields) {
    if (incoming[field] !== undefined && !merged[field]) {
      merged[field] = incoming[field];
    }
  }

  return merged;
}

// =============================================================================
// File Processing
// =============================================================================

/**
 * Process a single YAML file
 * @param {string} filePath - Path to the YAML file
 * @param {string} prefix - Key prefix for this file (e.g., 'plex')
 * @returns {object} - Stats about the migration
 */
function processFile(filePath, prefix) {
  const stats = {
    bareKeysConverted: 0,
    compoundKeysUnchanged: 0,
    entriesMerged: 0,
    totalEntries: 0
  };

  const data = loadYaml(filePath);
  if (!data || Object.keys(data).length === 0) {
    return { ...stats, skipped: true };
  }

  const migrated = {};

  for (const [key, value] of Object.entries(data)) {
    stats.totalEntries++;

    const compoundKey = normalizeKey(key, prefix);
    const isBare = !isCompoundKey(key);

    if (migrated[compoundKey]) {
      // Merge with existing entry
      migrated[compoundKey] = mergeEntries(migrated[compoundKey], value);
      stats.entriesMerged++;
    } else {
      migrated[compoundKey] = value;

      if (isBare) {
        stats.bareKeysConverted++;
      } else {
        stats.compoundKeysUnchanged++;
      }
    }
  }

  // Only write if there were changes
  const hasChanges = stats.bareKeysConverted > 0 || stats.entriesMerged > 0;

  if (hasChanges && !DRY_RUN) {
    saveYaml(filePath, migrated);
  }

  return { ...stats, migrated, hasChanges };
}

/**
 * Recursively find all .yml files in a directory
 * @param {string} dir - Directory to search
 * @returns {string[]} - Array of file paths
 */
function findYamlFiles(dir) {
  const files = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    // Skip hidden files and backup directories
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...findYamlFiles(fullPath));
    } else if (entry.name.endsWith('.yml')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Determine the prefix for a file based on its path
 * @param {string} filePath - Full file path
 * @param {string} baseDir - Base media_memory directory
 * @returns {string} - Prefix to use (e.g., 'plex')
 */
function getPrefixForPath(filePath, baseDir) {
  const relativePath = path.relative(baseDir, filePath);
  const parts = relativePath.split(path.sep);

  // If file is in a subdirectory, use that as prefix
  if (parts.length > 1) {
    const dirName = parts[0];
    return PREFIX_MAP[dirName] || dirName;
  }

  // Top-level files - determine from filename or content
  const basename = path.basename(filePath, '.yml');

  // Check if filename suggests a prefix
  for (const [key, prefix] of Object.entries(PREFIX_MAP)) {
    if (basename.includes(key)) {
      return prefix;
    }
  }

  // Default fallback based on common patterns
  return 'plex';
}

// =============================================================================
// Backup
// =============================================================================

/**
 * Create a backup of the media_memory directory
 * @param {string} sourceDir - Directory to backup
 * @returns {string|null} - Backup directory path or null if skipped
 */
function createBackup(sourceDir) {
  if (DRY_RUN) {
    return null;
  }

  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const backupDir = `${sourceDir}.bak.${timestamp}`;

  // Don't overwrite existing backup
  if (fs.existsSync(backupDir)) {
    console.log(`Backup already exists: ${backupDir}`);
    return backupDir;
  }

  // Copy directory recursively
  fs.cpSync(sourceDir, backupDir, { recursive: true });
  console.log(`Created backup: ${backupDir}`);

  return backupDir;
}

// =============================================================================
// Main
// =============================================================================

function main() {
  if (HELP) {
    showHelp();
    process.exit(0);
  }

  console.log('Media Key Migration Script');
  console.log('==========================');
  console.log(`Mode:       ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log(`Data path:  ${DATA_PATH}`);
  console.log(`Media mem:  ${MEDIA_MEMORY_PATH}`);
  console.log('');

  // Verify paths exist
  if (!fs.existsSync(DATA_PATH)) {
    console.error(`Error: Data path does not exist: ${DATA_PATH}`);
    process.exit(1);
  }

  if (!fs.existsSync(MEDIA_MEMORY_PATH)) {
    console.error(`Error: Media memory path does not exist: ${MEDIA_MEMORY_PATH}`);
    process.exit(1);
  }

  // Create backup
  console.log('Creating backup...');
  const backupDir = createBackup(MEDIA_MEMORY_PATH);
  if (backupDir) {
    console.log('');
  } else if (DRY_RUN) {
    console.log('Skipped (dry run)');
    console.log('');
  }

  // Find all YAML files
  const yamlFiles = findYamlFiles(MEDIA_MEMORY_PATH);
  console.log(`Found ${yamlFiles.length} YAML file(s) to process`);
  console.log('');

  // Process files
  const totalStats = {
    filesProcessed: 0,
    filesModified: 0,
    filesSkipped: 0,
    bareKeysConverted: 0,
    compoundKeysUnchanged: 0,
    entriesMerged: 0,
    totalEntries: 0
  };

  for (const filePath of yamlFiles) {
    const relativePath = path.relative(MEDIA_MEMORY_PATH, filePath);
    const prefix = getPrefixForPath(filePath, MEDIA_MEMORY_PATH);

    console.log(`Processing: ${relativePath} (prefix: ${prefix})`);

    const stats = processFile(filePath, prefix);

    if (stats.skipped) {
      console.log(`  Skipped (empty or error)`);
      totalStats.filesSkipped++;
      continue;
    }

    totalStats.filesProcessed++;
    totalStats.bareKeysConverted += stats.bareKeysConverted;
    totalStats.compoundKeysUnchanged += stats.compoundKeysUnchanged;
    totalStats.entriesMerged += stats.entriesMerged;
    totalStats.totalEntries += stats.totalEntries;

    if (stats.hasChanges) {
      totalStats.filesModified++;
      console.log(`  Bare -> compound: ${stats.bareKeysConverted}`);
      console.log(`  Already compound: ${stats.compoundKeysUnchanged}`);
      console.log(`  Entries merged:   ${stats.entriesMerged}`);
      if (!DRY_RUN) {
        console.log(`  Written: ${filePath}`);
      }
    } else {
      console.log(`  No changes needed`);
    }
  }

  // Final summary
  console.log('');
  console.log('='.repeat(50));
  console.log('Migration Summary');
  console.log('='.repeat(50));
  console.log(`Files processed:      ${totalStats.filesProcessed}`);
  console.log(`Files modified:       ${totalStats.filesModified}`);
  console.log(`Files skipped:        ${totalStats.filesSkipped}`);
  console.log(`Total entries:        ${totalStats.totalEntries}`);
  console.log(`Bare keys converted:  ${totalStats.bareKeysConverted}`);
  console.log(`Already compound:     ${totalStats.compoundKeysUnchanged}`);
  console.log(`Entries merged:       ${totalStats.entriesMerged}`);
  console.log('');

  if (DRY_RUN) {
    console.log('DRY RUN COMPLETE - No files were modified.');
    console.log('Run without --dry-run to apply changes.');
  } else {
    console.log('MIGRATION COMPLETE');
    if (backupDir) {
      console.log(`Backup saved to: ${backupDir}`);
    }
  }
}

main();
