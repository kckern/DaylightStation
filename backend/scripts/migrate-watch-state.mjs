#!/usr/bin/env node
/**
 * Migrate watch state data to household-scoped WatchStore format
 *
 * Usage: node backend/scripts/migrate-watch-state.mjs [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const DRY_RUN = process.argv.includes('--dry-run');

// Paths - adjust for environment or pass as args
const DATA_BASE_PATH = process.env.DATA_PATH || '/usr/src/app/data';
const HOUSEHOLD_DIR = process.env.HOUSEHOLD_DIR || `${DATA_BASE_PATH}/household`;

const OLD_WATCHSTORE_PATH = `${DATA_BASE_PATH}/history/media_memory/plex.yml`;
const LEGACY_PLEX_DIR = `${HOUSEHOLD_DIR}/history/media_memory/plex`;
const NEW_WATCHSTORE_PATH = `${HOUSEHOLD_DIR}/history/media_memory/plex.yml`;

function loadYaml(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content) || {};
  } catch (e) {
    console.error(`Error loading ${filePath}:`, e.message);
    return null;
  }
}

function saveYaml(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, yaml.dump(data, { lineWidth: -1 }));
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr.replace(' ', 'T').replace(/\./g, ':'));
  return isNaN(d.getTime()) ? null : d;
}

function normalizeKey(key) {
  return key.startsWith('plex:') ? key : `plex:${key}`;
}

function normalizeEntry(value) {
  return {
    playhead: value.playhead || value.seconds || 0,
    duration: value.mediaDuration || value.duration || 0,
    percent: value.percent || 0,
    playCount: value.playCount || 1,
    lastPlayed: value.lastPlayed || null,
    watchTime: value.watchTime || 0
  };
}

function main() {
  console.log('Watch State Migration Script');
  console.log('============================');
  console.log(`Dry run: ${DRY_RUN}`);
  console.log(`Old WatchStore: ${OLD_WATCHSTORE_PATH}`);
  console.log(`Legacy Plex dir: ${LEGACY_PLEX_DIR}`);
  console.log(`New WatchStore: ${NEW_WATCHSTORE_PATH}`);
  console.log('');

  const merged = {};
  let oldCount = 0, legacyCount = 0, conflictCount = 0;

  // Load old WatchStore data
  const oldData = loadYaml(OLD_WATCHSTORE_PATH);
  if (oldData) {
    for (const [key, value] of Object.entries(oldData)) {
      const normalizedKey = normalizeKey(key);
      merged[normalizedKey] = normalizeEntry(value);
      oldCount++;
    }
    console.log(`Loaded ${oldCount} entries from old WatchStore`);
  } else {
    console.log('No old WatchStore data found');
  }

  // Load legacy plex directory files
  if (fs.existsSync(LEGACY_PLEX_DIR)) {
    const files = fs.readdirSync(LEGACY_PLEX_DIR).filter(f =>
      f.endsWith('.yml') && !f.startsWith('_') && !f.startsWith('.')
    );

    for (const file of files) {
      const filePath = path.join(LEGACY_PLEX_DIR, file);
      const data = loadYaml(filePath);
      if (!data) continue;

      for (const [key, value] of Object.entries(data)) {
        // Skip non-watch-state entries (metadata only)
        if (!value.playhead && !value.seconds && !value.percent && !value.lastPlayed) {
          continue;
        }

        const normalizedKey = normalizeKey(key);

        if (merged[normalizedKey]) {
          const existingDate = parseDate(merged[normalizedKey].lastPlayed);
          const newDate = parseDate(value.lastPlayed);

          if (newDate && (!existingDate || newDate > existingDate)) {
            console.log(`  Conflict: ${normalizedKey} - using legacy (newer)`);
            merged[normalizedKey] = normalizeEntry(value);
            conflictCount++;
          } else {
            console.log(`  Conflict: ${normalizedKey} - keeping existing`);
            conflictCount++;
          }
        } else {
          merged[normalizedKey] = normalizeEntry(value);
          legacyCount++;
        }
      }
    }
    console.log(`Loaded ${legacyCount} new entries from legacy directory`);
  } else {
    console.log('No legacy plex directory found');
  }

  console.log('');
  console.log(`Total merged entries: ${Object.keys(merged).length}`);
  console.log(`Conflicts resolved: ${conflictCount}`);

  if (DRY_RUN) {
    console.log('');
    console.log('DRY RUN - no files written');
    const sample = Object.entries(merged).slice(0, 3);
    console.log('Sample entries:');
    for (const [key, value] of sample) {
      console.log(`  ${key}: lastPlayed=${value.lastPlayed}, percent=${value.percent}%`);
    }
  } else {
    // Create backup
    const backupDir = `${HOUSEHOLD_DIR}/history/media_memory/_backup_${Date.now()}`;
    fs.mkdirSync(backupDir, { recursive: true });

    if (fs.existsSync(OLD_WATCHSTORE_PATH)) {
      fs.copyFileSync(OLD_WATCHSTORE_PATH, `${backupDir}/old_plex.yml`);
      console.log(`Backed up: ${backupDir}/old_plex.yml`);
    }
    if (fs.existsSync(NEW_WATCHSTORE_PATH)) {
      fs.copyFileSync(NEW_WATCHSTORE_PATH, `${backupDir}/existing_plex.yml`);
      console.log(`Backed up: ${backupDir}/existing_plex.yml`);
    }

    // Write merged data
    saveYaml(NEW_WATCHSTORE_PATH, merged);
    console.log(`Written: ${NEW_WATCHSTORE_PATH}`);
  }
}

main();
