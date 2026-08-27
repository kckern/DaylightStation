#!/usr/bin/env node
/** Rebuild compact per-player chess rivalry memories from durable game archives. */

import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';
import { initConfigService, configService } from '#system/config/index.mjs';
import { DataService } from '#system/config/DataService.mjs';
import { CHESS_ARCHIVE_DIR } from '#shared/gaming/rulesets/chess/archivePaths.mjs';
import { createChessRivalryMemoryService } from '#apps/chess/ChessRivalryMemoryService.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '..', '.env') });

function files(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? files(target) : (entry.name.endsWith('.yml') ? [target] : []);
  });
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const userIndex = args.indexOf('--user');
const onlyUser = userIndex >= 0 ? args[userIndex + 1] : null;
if (userIndex >= 0 && !onlyUser) throw new Error('--user requires a player id');

const base = process.env.DAYLIGHT_BASE_PATH;
if (!base) throw new Error('DAYLIGHT_BASE_PATH must identify the Daylight data root');
await initConfigService(path.join(base, 'data'));
const dataService = new DataService({ configService });
const memories = new Map();
const service = createChessRivalryMemoryService({
  readMemory: (userId) => memories.get(userId) ?? dataService.user.read('apps/chess/rivalries', userId),
  writeMemory: (userId, memory) => {
    memories.set(userId, memory);
    return dryRun ? true : dataService.user.write('apps/chess/rivalries', memory, userId);
  },
  logger: console,
});

let considered = 0;
let recorded = 0;
for (const filename of files(dataService.household.resolveDir(CHESS_ARCHIVE_DIR)).sort()) {
  const archive = yaml.load(fs.readFileSync(filename, 'utf8'));
  if (!archive?.completed || !archive?.user_id || (onlyUser && archive.user_id !== onlyUser)) continue;
  considered += 1;
  if (await service.recordArchive(archive)) recorded += 1;
}

process.stdout.write(`${dryRun ? 'Would rebuild' : 'Rebuilt'} rivalry memory from ${recorded}/${considered} completed archives${onlyUser ? ` for ${onlyUser}` : ''}.\n`);
