#!/usr/bin/env node
/**
 * Migration: Reorganize Strava activity archives
 *
 * Moves existing lifelog/archives/strava/ files:
 * - Files within 90 days → lifelog/strava/
 * - Files older than 90 days → media/archives/strava/
 *
 * Usage:
 *   node cli/migrations/migrate-strava-archives.mjs --dry-run
 *   node cli/migrations/migrate-strava-archives.mjs --execute
 */

import fs from 'fs';
import path from 'path';
import moment from 'moment-timezone';
import { listYamlFiles, loadYamlSafe, saveYaml, ensureDir, deleteFile } from '#system/utils/FileIO.mjs';
import { configService } from '#system/config/index.mjs';

const cutoffDays = 90;
const cutoff = moment().subtract(cutoffDays, 'days').startOf('day');

function getUsers() {
  const dataDir = configService.getDataDir();
  const usersDir = path.join(dataDir, 'users');
  if (!fs.existsSync(usersDir)) return [];
  return fs.readdirSync(usersDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name);
}

async function migrate(dryRun = true) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Strava Archive Migration ${dryRun ? '(DRY RUN)' : '(EXECUTING)'}`);
  console.log(`Cutoff: ${cutoff.format('YYYY-MM-DD')} (${cutoffDays} days ago)`);
  console.log(`${'='.repeat(60)}\n`);

  const mediaArchiveDir = path.join(configService.getMediaDir(), 'archives', 'strava');
  const users = getUsers();

  if (users.length === 0) {
    console.log('No users found.');
    return;
  }

  let totalRecent = 0;
  let totalArchived = 0;
  let totalSkipped = 0;

  for (const username of users) {
    const userDir = configService.getUserDir(username);
    const legacyDir = path.join(userDir, 'lifelog', 'archives', 'strava');
    const recentDir = path.join(userDir, 'lifelog', 'strava');

    if (!fs.existsSync(legacyDir)) continue;

    const files = listYamlFiles(legacyDir);
    if (files.length === 0) continue;

    console.log(`\n--- ${username} (${files.length} files) ---`);

    for (const filename of files) {
      const dateStr = filename.substring(0, 10);
      const fileDate = moment(dateStr, 'YYYY-MM-DD', true);

      if (!fileDate.isValid()) {
        console.log(`  SKIP (bad date): ${filename}`);
        totalSkipped++;
        continue;
      }

      const srcPath = path.join(legacyDir, `${filename}.yml`);
      const isRecent = fileDate.isSameOrAfter(cutoff);
      const destDir = isRecent ? recentDir : mediaArchiveDir;
      const destPath = path.join(destDir, `${filename}.yml`);
      const label = isRecent ? 'RECENT' : 'ARCHIVE';

      console.log(`  ${label}: ${filename} → ${destDir}/`);

      if (!dryRun) {
        const data = loadYamlSafe(srcPath);
        if (data) {
          ensureDir(destDir);
          saveYaml(destPath, data);
          deleteFile(srcPath);
        } else {
          console.log(`    WARNING: Could not read ${srcPath}`);
          totalSkipped++;
          continue;
        }
      }

      if (isRecent) totalRecent++;
      else totalArchived++;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Summary:`);
  console.log(`  Recent (→ lifelog/strava/):         ${totalRecent}`);
  console.log(`  Archived (→ media/archives/strava/): ${totalArchived}`);
  console.log(`  Skipped:                             ${totalSkipped}`);
  console.log(`${'='.repeat(60)}\n`);

  if (dryRun && (totalRecent + totalArchived) > 0) {
    console.log('Run with --execute to perform the migration.\n');
  }
}

const args = process.argv.slice(2);
const dryRun = !args.includes('--execute');

migrate(dryRun).catch(console.error);
