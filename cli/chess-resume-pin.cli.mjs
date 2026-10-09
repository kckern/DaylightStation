#!/usr/bin/env node
/**
 * Make one archived chess game the one a player's next launch resumes.
 *
 * Built for 2026-10-09, when a child one or two moves from mate left a game and
 * the tablet's six-hour idle rule threw the only live copy away. The game was
 * in the household archive the whole time; this puts it back in the server's
 * resume slot (the same file the app keeps, `users/<id>/apps/chess/resume.yml`)
 * as a PIN, which outranks any newer game. Games that began after it and were
 * left unfinished are filed in the slot as superseded — kept, never deleted.
 *
 * Goes through the shared slot rules (`resumeSlot.mjs`), the same code the
 * server runs, so the file is always one the app understands. Dry run by
 * default. Run it where the data tree is writable as the app's owner (inside
 * the container).
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { fileURLToPath } from 'node:url';
import { CHESS_ARCHIVE_DIR } from '../shared/gaming/rulesets/chess/archivePaths.mjs';
import { emptySlot, normalizeSlot, pinGame, playedMoves } from '../shared/gaming/rulesets/chess/resumeSlot.mjs';

const USAGE = `Pin an archived chess game as a player's resumable game.

  node cli/chess-resume-pin.cli.mjs --user <id> --game <game_id> [--data <data dir>] [--write]

  --user <id>     The player (a users/<id> profile)
  --game <id>     The archived game_id to resume (e.g. chess-1791514906380)
  --data <dir>    The data directory (default: $DAYLIGHT_BASE_PATH/data, or /usr/src/app/data in the container)
  --write         Apply. Without it, report what would change and touch nothing.
  -h, --help      Show this help
`;

export function parseArgs(argv) {
  const options = { user: null, game: null, data: null, write: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--user' || token === '--game' || token === '--data') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${token} requires a value`);
      options[token.slice(2)] = value;
      i += 1;
    } else if (token === '--write') options.write = true;
    else if (token === '--help' || token === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!options.data) {
    if (fs.existsSync('/.dockerenv')) options.data = '/usr/src/app/data';
    else if (process.env.DAYLIGHT_BASE_PATH) options.data = path.join(process.env.DAYLIGHT_BASE_PATH, 'data');
  }
  return options;
}

const SAFE = /^[A-Za-z0-9_-]+$/;

/** Every archived record for this player, newest file last. */
function archivedGamesFor(dataDir, user) {
  const root = path.join(dataDir, 'household', ...CHESS_ARCHIVE_DIR.split('/'));
  const found = [];
  if (!fs.existsSync(root)) return found;
  for (const day of fs.readdirSync(root).sort()) {
    const dayDir = path.join(root, day);
    if (!fs.statSync(dayDir).isDirectory()) continue;
    for (const name of fs.readdirSync(dayDir).sort()) {
      if (!name.endsWith('.yml')) continue;
      let record;
      try { record = YAML.parse(fs.readFileSync(path.join(dayDir, name), 'utf8')); } catch { continue; }
      if (record && record.user_id === user && record.game_id) found.push(record);
    }
  }
  return found;
}

function matchOwner(target, reference) {
  try {
    const { uid, gid } = fs.statSync(reference);
    fs.chownSync(target, uid, gid);
  } catch { /* nothing to fix outside the container */ }
}

export function run(options, { now = new Date(), log = console.log } = {}) {
  const { user, game, data, write } = options;
  if (!user || !SAFE.test(user)) throw new Error('--user is required (letters, digits, - and _ only)');
  if (!game || !SAFE.test(game)) throw new Error('--game is required (letters, digits, - and _ only)');
  if (!data) throw new Error('No data directory: pass --data');

  const archived = archivedGamesFor(data, user);
  // A resumed game is re-filed under a new id with the same line, and the same
  // id can be archived more than once; the fullest copy is the one to restore.
  const copies = archived.filter((record) => record.game_id === game);
  if (!copies.length) throw new Error(`No archived game ${game} for ${user}`);
  const record = copies.sort((a, b) => playedMoves(b).length - playedMoves(a).length
    || (Date.parse(b.ended_at) || 0) - (Date.parse(a.ended_at) || 0))[0];
  if (record.completed || record.ended_by === 'game_over') {
    throw new Error(`Game ${game} is finished (${record.result || record.outcome}); a finished game never resumes`);
  }

  const slotFile = path.join(data, 'users', user, 'apps', 'chess', 'resume.yml');
  const before = normalizeSlot(fs.existsSync(slotFile) ? YAML.parse(fs.readFileSync(slotFile, 'utf8')) : emptySlot());
  const startedAt = Date.parse(record.started_at) || 0;
  const newer = archived.filter((other) => other.game_id !== game
    && !other.completed && other.ended_by !== 'restarted' && other.ended_by !== 'game_over'
    && (Date.parse(other.started_at) || 0) > startedAt && playedMoves(other).length > 0);
  const { slot, superseded } = pinGame(before, record, now, newer);

  log(`${write ? 'PIN' : 'DRY RUN — would pin'} ${game} for ${user}: ${playedMoves(record).length} plies, final ${record.final_fen}`);
  log(`  superseded (kept, not deleted): ${superseded.length ? superseded.join(', ') : 'none'}`);
  log(`  slot: ${slotFile}`);
  if (!write) return { wrote: false, slot, superseded };
  fs.mkdirSync(path.dirname(slotFile), { recursive: true });
  const existed = fs.existsSync(slotFile);
  fs.writeFileSync(slotFile, YAML.stringify(slot));
  if (!existed) matchOwner(slotFile, path.dirname(slotFile));
  return { wrote: true, slot, superseded };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(USAGE);
    else run(options);
  } catch (error) {
    console.error(`${error.message}\n\n${USAGE}`);
    process.exit(1);
  }
}
