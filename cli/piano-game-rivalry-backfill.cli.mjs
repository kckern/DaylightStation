#!/usr/bin/env node
/** Idempotently ingest completed Chess, Checkers, and Connect Four archives. */
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';
import { initConfigService, configService } from '#system/config/index.mjs';
import { DataService } from '#adapters/persistence/files/DataService.mjs';
import { GameRivalryMemoryService } from '#apps/piano-games/GameRivalryMemoryService.mjs';
import { checkersNotableFacts } from '#shared/gaming/rulesets/checkers/commentary.mjs';
import { connectFourNotableFacts } from '#shared/gaming/rulesets/connect-four/commentary.mjs';
import { chessNotableFacts } from '#shared/gaming/rulesets/chess/dialogueAdapter.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '..', '.env') });
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const gameFlag = args.indexOf('--game');
const selected = gameFlag >= 0 ? [args[gameFlag + 1]] : ['chess', 'checkers', 'connect-four'];
if (selected.some((game) => !['chess', 'checkers', 'connect-four'].includes(game))) throw new Error('--game must be chess, checkers, or connect-four');

function files(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? files(target) : entry.name.endsWith('.yml') ? [target] : [];
  });
}

const base = process.env.DAYLIGHT_BASE_PATH;
if (!base) throw new Error('DAYLIGHT_BASE_PATH must identify the Daylight data root');
await initConfigService(path.join(base, 'data'));
const dataService = new DataService({ configService });
const cache = new Map();
const service = new GameRivalryMemoryService({
  readMemory: (gameId, userId) => cache.get(`${gameId}:${userId}`) ?? dataService.user.read(`apps/${gameId}/rivalries`, userId),
  writeMemory: (gameId, userId, memory) => {
    cache.set(`${gameId}:${userId}`, memory);
    return dryRun || dataService.user.write(`apps/${gameId}/rivalries`, memory, userId);
  },
  readLegacy: (userId) => dataService.user.read('apps/chess/rivalry', userId)
    || dataService.user.read('apps/chess/rivalries', userId),
  notableFacts: {
    'connect-four': connectFourNotableFacts,
    checkers: checkersNotableFacts,
    chess: chessNotableFacts,
  },
});

let considered = 0;
let ingested = 0;
for (const gameId of selected) {
  const root = dataService.household.resolveDir(`gaming/log/${gameId}`);
  for (const filename of files(root).sort()) {
    const record = yaml.load(fs.readFileSync(filename, 'utf8'));
    if (!record?.completed || !record?.user_id) continue;
    considered += 1;
    if (await service.recordArchive(gameId, record)) ingested += 1;
  }
}
process.stdout.write(`${dryRun ? 'Would ingest' : 'Ingested'} ${ingested}/${considered} completed board-game archives.\n`);
