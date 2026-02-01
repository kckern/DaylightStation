#!/usr/bin/env node
/**
 * Migration: Rescue orphaned nutrilist items from telegram:* directories
 *
 * Usage:
 *   node cli/migrations/migrate-orphaned-nutrilist.mjs --dry-run
 *   node cli/migrations/migrate-orphaned-nutrilist.mjs --execute
 *
 * This script finds user directories that start with "telegram:" and
 * attempts to match them to real users via the nutrilog files.
 */

import fs from 'fs';
import path from 'path';
import { loadYamlSafe, saveYaml, ensureDir } from '#system/utils/FileIO.mjs';

const DATA_PATH = process.env.DATA_PATH || '/usr/src/app/data';
const USERS_DIR = path.join(DATA_PATH, 'users');

function findOrphanedDirs() {
  if (!fs.existsSync(USERS_DIR)) {
    console.error(`Users directory not found: ${USERS_DIR}`);
    return [];
  }

  const dirs = fs.readdirSync(USERS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith('telegram:'))
    .map(d => d.name);

  return dirs;
}

function loadNutrilist(userDir) {
  const nutrilistPath = path.join(USERS_DIR, userDir, 'lifelog/nutrition/nutrilist.yml');
  if (!fs.existsSync(nutrilistPath)) {
    return [];
  }
  return loadYamlSafe(nutrilistPath) || [];
}

function findRealUserFromNutrilog(logUuid) {
  // Search all user directories for a nutrilog with this UUID
  const userDirs = fs.readdirSync(USERS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('telegram:'))
    .map(d => d.name);

  for (const userDir of userDirs) {
    const nutrilogPath = path.join(USERS_DIR, userDir, 'lifelog/nutrition/nutrilog.yml');
    if (!fs.existsSync(nutrilogPath)) continue;

    const logs = loadYamlSafe(nutrilogPath);
    if (!logs) continue;

    // Handle both object-keyed format and array format
    if (Array.isArray(logs)) {
      const found = logs.find(log => log.uuid === logUuid || log.id === logUuid);
      if (found) {
        return userDir;
      }
    } else if (typeof logs === 'object') {
      // Object keyed by ID
      if (logs[logUuid]) {
        return userDir;
      }
      // Also check if any entry has matching uuid field
      const found = Object.values(logs).find(log => log.uuid === logUuid || log.id === logUuid);
      if (found) {
        return userDir;
      }
    }
  }
  return null;
}

function mergeItems(existingItems, newItems) {
  const existingUuids = new Set(existingItems.map(i => i.uuid || i.id));
  const uniqueNewItems = newItems.filter(i =>
    !existingUuids.has(i.uuid) && !existingUuids.has(i.id)
  );
  return [...existingItems, ...uniqueNewItems];
}

async function migrate(dryRun = true) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Orphaned Nutrilist Migration ${dryRun ? '(DRY RUN)' : '(EXECUTING)'}`);
  console.log(`${'='.repeat(60)}\n`);

  const orphanedDirs = findOrphanedDirs();

  if (orphanedDirs.length === 0) {
    console.log('No orphaned directories found.');
    return;
  }

  console.log(`Found ${orphanedDirs.length} orphaned directory(ies):\n`);

  let totalMigrated = 0;
  let totalSkipped = 0;

  for (const orphanDir of orphanedDirs) {
    console.log(`\n--- ${orphanDir} ---`);

    const items = loadNutrilist(orphanDir);
    if (items.length === 0) {
      console.log('  No items found, skipping.');
      continue;
    }

    console.log(`  Found ${items.length} item(s)`);

    // Group items by logUuid to find target user
    const itemsByLog = {};
    for (const item of items) {
      const logId = item.logId || item.log_uuid || item.logUuid || 'unknown';
      if (!itemsByLog[logId]) itemsByLog[logId] = [];
      itemsByLog[logId].push(item);
    }

    for (const [logId, logItems] of Object.entries(itemsByLog)) {
      const targetUser = findRealUserFromNutrilog(logId);

      if (!targetUser) {
        console.log(`  Warning: Could not find owner for logId: ${logId} (${logItems.length} items)`);
        totalSkipped += logItems.length;
        continue;
      }

      console.log(`  -> Migrating ${logItems.length} item(s) to user: ${targetUser}`);

      if (!dryRun) {
        const targetPath = path.join(USERS_DIR, targetUser, 'lifelog/nutrition/nutrilist.yml');
        ensureDir(path.dirname(targetPath));

        const existing = fs.existsSync(targetPath) ? loadYamlSafe(targetPath) || [] : [];
        const merged = mergeItems(existing, logItems);

        saveYaml(targetPath, merged);
        console.log(`    Saved to ${targetPath}`);
      }

      totalMigrated += logItems.length;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Summary:`);
  console.log(`  Migrated: ${totalMigrated} item(s)`);
  console.log(`  Skipped:  ${totalSkipped} item(s) (owner not found)`);
  console.log(`${'='.repeat(60)}\n`);

  if (dryRun && totalMigrated > 0) {
    console.log('Run with --execute to perform the migration.\n');
  }
}

// Parse args
const args = process.argv.slice(2);
const dryRun = !args.includes('--execute');

migrate(dryRun).catch(console.error);
