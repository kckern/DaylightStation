#!/usr/bin/env node
/**
 * Consolidate chess game records into the household archive, and rebuild the
 * ladder and rivalry files derived from it.
 *
 * Game records once lived in three places: the archive's current directory,
 * the directory it had before the household reorganisation, and a per-player
 * scorecard that nothing read. This moves the old archive into the current one
 * under current filenames, retires scorecards whose games the archive already
 * holds, and replays every finished game so each player's ladder and rivalry
 * files match what was actually played.
 *
 * Dry run by default. Nothing is deleted: whatever leaves its place goes to
 * `_deleteme/`. Run it where the data tree is writable as the app's owner; the
 * files and directories it creates take their parent directory's owner.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { fileURLToPath } from 'node:url';
import { CHESS_ARCHIVE_DIR } from '../shared/gaming/rulesets/chess/archivePaths.mjs';
import { mergeLadderConfig, resolvePolicy } from '../shared/gaming/rulesets/chess/ladder.mjs';
import { buildChessArchiveFilename } from '../backend/src/1_adapters/persistence/chess/ChessRecordNames.mjs';
import {
  isFinishedGame, matchScorecards, planUserBackfill, summarizeLadder, summarizeRivalries, withOpponentIds,
} from '../backend/src/3_applications/chess/ChessRecordBackfill.mjs';

/** Where the archive lived before the household reorganisation, under the household root. */
export const LEGACY_ARCHIVE_DIR = 'gaming/log/pianochess';
/** The household chess config, under the household root. */
export const HOUSEHOLD_CHESS_CONFIG = 'gaming/chess.yml';

const USAGE = `Consolidate chess records and rebuild ladder and rivalry files.

  node cli/chess-backfill.cli.mjs [--data <data dir>] [--user <id>] [--write]

  --data <dir>   The data directory (default: $DAYLIGHT_BASE_PATH/data)
  --user <id>    Retire scorecards and rebuild derived files for one player only.
                 Consolidating the archive is always household-wide.
  --write        Apply. Without it, report what would change and touch nothing.
  -h, --help     Show this help
`;

export function parseArgs(argv) {
  const options = { data: null, user: null, write: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--data' || token === '--user') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${token} requires a value`);
      options[token.slice(2)] = value;
      index += 1;
    } else if (token === '--write') options.write = true;
    else if (token === '--help' || token === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!options.data && process.env.DAYLIGHT_BASE_PATH) options.data = path.join(process.env.DAYLIGHT_BASE_PATH, 'data');
  return options;
}

const readYaml = (file) => (fs.existsSync(file) ? YAML.parse(fs.readFileSync(file, 'utf8')) : null);

/**
 * Give a created path its reference's owner. Inside the container this runs as
 * root, and a root-owned file is one the app can read but never write again.
 * Outside it, chown to our own uid changes nothing and to anyone else's fails;
 * in both cases there is nothing to fix.
 */
function matchOwner(target, reference) {
  try {
    const { uid, gid } = fs.statSync(reference);
    fs.chownSync(target, uid, gid);
  } catch { /* see above */ }
}

function ensureDir(dir, reference) {
  if (fs.existsSync(dir)) return;
  ensureDir(path.dirname(dir), reference);
  fs.mkdirSync(dir);
  matchOwner(dir, reference);
}

function writeYaml(file, value) {
  const existed = fs.existsSync(file);
  fs.writeFileSync(file, YAML.stringify(value));
  if (!existed) matchOwner(file, path.dirname(file));
}

function ymlFilesByDay(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const day of fs.readdirSync(root).sort()) {
    const dayDir = path.join(root, day);
    if (!fs.statSync(dayDir).isDirectory()) continue;
    for (const name of fs.readdirSync(dayDir).sort()) {
      if (name.endsWith('.yml')) files.push({ day, name, file: path.join(dayDir, name) });
    }
  }
  return files;
}

/** Every archived game under these roots, each game once. */
export function loadArchive(roots) {
  const seen = new Set();
  const records = [];
  for (const root of roots) {
    for (const entry of ymlFilesByDay(root)) {
      const record = readYaml(entry.file);
      if (!record || typeof record !== 'object') continue;
      const key = `${record.game_id || entry.name}|${record.started_at || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      records.push(record);
    }
  }
  return records;
}

/** Current names lead with `user_level…_`; the oldest files are `user-timestamp.yml`. */
const isLegacyName = (name) => !/_level(\d+|unknown)_/.test(name);

/**
 * Move the pre-reorganisation archive into the current one.
 *
 * Old-style names are rebuilt with the current scheme, stamped with when the
 * game was archived, so filename filters in the review CLIs see them. A file
 * whose destination already exists is a conflict and stays where it is, and
 * then the old directory is not retired either.
 */
export function consolidateArchive({ householdDir, deleteDir, write }) {
  const legacyRoot = path.join(householdDir, ...LEGACY_ARCHIVE_DIR.split('/'));
  const root = path.join(householdDir, ...CHESS_ARCHIVE_DIR.split('/'));
  const report = { moved: 0, renamed: 0, conflicts: [], retiredDir: null };
  if (!fs.existsSync(legacyRoot)) return report;
  for (const { day, name, file } of ymlFilesByDay(legacyRoot)) {
    const record = readYaml(file) || {};
    const target = isLegacyName(name)
      ? `${buildChessArchiveFilename(record, record.user_id || 'guest', new Date(record.archived_at || record.ended_at || `${day}T12:00:00Z`))}.yml`
      : name;
    const destination = path.join(root, day, target);
    if (fs.existsSync(destination)) {
      report.conflicts.push(path.relative(householdDir, file));
      continue;
    }
    report.moved += 1;
    if (target !== name) report.renamed += 1;
    if (!write) continue;
    ensureDir(path.join(root, day), root);
    fs.renameSync(file, destination);
  }
  if (write && report.conflicts.length === 0) {
    ensureDir(deleteDir, path.dirname(deleteDir));
    report.retiredDir = path.join(deleteDir, 'pianochess-archive');
    fs.renameSync(legacyRoot, report.retiredDir);
  }
  return report;
}

/** Move each player's scorecards whose games the archive holds to `_deleteme/`. */
export function retireScorecards({ dataDir, archive, deleteDir, write, users }) {
  const report = {};
  for (const userId of users) {
    const gamesDir = path.join(dataDir, 'users', userId, 'apps', 'chess', 'games');
    if (!fs.existsSync(gamesDir)) continue;
    const cards = fs.readdirSync(gamesDir).filter((name) => name.endsWith('.yml')).sort()
      .map((name) => ({ file: path.join(gamesDir, name), record: readYaml(path.join(gamesDir, name)) || {} }));
    const { matched, unmatched } = matchScorecards(cards, archive);
    report[userId] = { matched: matched.length, unmatched: unmatched.map((card) => path.basename(card.file)) };
    if (!write || matched.length === 0) continue;
    const target = path.join(deleteDir, 'scorecards', userId);
    ensureDir(target, path.dirname(deleteDir));
    for (const card of matched) fs.renameSync(card.file, path.join(target, path.basename(card.file)));
    if (fs.readdirSync(gamesDir).length === 0) fs.renameSync(gamesDir, path.join(target, 'games-dir'));
  }
  return report;
}

/**
 * Back up a derived file before it is overwritten, so the true pre-backfill
 * copy survives a second `--write`. A backup that already exists is never
 * replaced — the first one taken is the only one that is still the truth.
 */
function backupBeforeOverwrite(file, deleteDir, userId) {
  if (!fs.existsSync(file)) return;
  const target = path.join(deleteDir, 'derived-before', userId, path.basename(file));
  if (fs.existsSync(target)) return;
  ensureDir(path.dirname(target), path.dirname(deleteDir));
  fs.copyFileSync(file, target);
  matchOwner(target, path.dirname(deleteDir));
}

/** Rebuild each player's ladder and rivalry files from their finished games. */
export async function rebuildDerived({ dataDir, archive, users, write, deleteDir }) {
  const householdConfig = readYaml(path.join(dataDir, 'household', ...HOUSEHOLD_CHESS_CONFIG.split('/')));
  if (!householdConfig) throw new Error(`No household chess config at household/${HOUSEHOLD_CHESS_CONFIG}`);
  const configFor = (userId) => mergeLadderConfig(
    householdConfig,
    readYaml(path.join(dataDir, 'users', String(userId), 'apps', 'chess', 'config.yml')) || {},
  );
  const records = withOpponentIds(archive, (userId) => configFor(userId).ladder.roster_pack || 'chess');
  const report = {};
  for (const userId of users) {
    const games = records.filter((record) => isFinishedGame(record) && record.user_id === userId).length;
    if (games === 0) continue;
    const chessDir = path.join(dataDir, 'users', userId, 'apps', 'chess');
    // A player with games but no chess profile has nothing to repair, and
    // creating one here would invent state the app never wrote.
    if (!fs.existsSync(chessDir)) {
      report[userId] = { games, skipped: 'no chess profile' };
      continue;
    }
    const policy = resolvePolicy(configFor(userId));
    const ladderFile = path.join(chessDir, 'ladder.yml');
    const rivalriesFile = path.join(chessDir, 'rivalries.yml');
    const storedLadder = readYaml(ladderFile);
    const plan = await planUserBackfill({ userId, records, policy, storedLadder });
    report[userId] = {
      games,
      ladder: { before: summarizeLadder(storedLadder, policy), after: summarizeLadder(plan.ladder, policy) },
      rivalries: { before: summarizeRivalries(readYaml(rivalriesFile)), after: summarizeRivalries(plan.rivalries) },
    };
    if (!write) continue;
    backupBeforeOverwrite(ladderFile, deleteDir, userId);
    backupBeforeOverwrite(rivalriesFile, deleteDir, userId);
    writeYaml(ladderFile, plan.ladder);
    writeYaml(rivalriesFile, plan.rivalries);
  }
  return report;
}

const localDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export async function run({ data, user = null, write = false, now = new Date() }) {
  if (!data) throw new Error('Pass --data <data dir> or set DAYLIGHT_BASE_PATH');
  const householdDir = path.join(data, 'household');
  const archiveRoot = path.join(householdDir, ...CHESS_ARCHIVE_DIR.split('/'));
  // Loudly, not emptily: a wrong path must never look like an empty archive.
  if (!fs.existsSync(archiveRoot)) throw new Error(`No chess archive at ${archiveRoot}`);
  const legacyRoot = path.join(householdDir, ...LEGACY_ARCHIVE_DIR.split('/'));
  const deleteDir = path.join(data, '_deleteme', `${localDay(now)}-chess-record-consolidation`);
  const usersDir = path.join(data, 'users');
  const allUsers = fs.existsSync(usersDir)
    ? fs.readdirSync(usersDir).filter((id) => fs.statSync(path.join(usersDir, id)).isDirectory()).sort()
    : [];
  const users = user ? allUsers.filter((id) => id === user) : allUsers;

  // Read every game before anything moves, so a dry run and a write judge the same games.
  const archive = loadArchive([archiveRoot, legacyRoot]);
  const consolidation = consolidateArchive({ householdDir, deleteDir, write });
  const scorecards = retireScorecards({ dataDir: data, archive, deleteDir, write, users });
  const derived = await rebuildDerived({ dataDir: data, archive, users, write, deleteDir });
  return { write, archive: { games: archive.length }, consolidation, scorecards, derived };
}

export function renderReport(report) {
  const lines = [report.write ? 'Chess record backfill: WRITTEN' : 'Chess record backfill: DRY RUN (pass --write to apply)'];
  lines.push(`Archive: ${report.archive.games} games read`);
  const { consolidation } = report;
  lines.push(`Old archive directory: ${consolidation.moved} files to move, ${consolidation.renamed} renamed from old names, ${consolidation.conflicts.length} conflicts`);
  for (const conflict of consolidation.conflicts) lines.push(`  conflict, left in place: ${conflict}`);
  if (consolidation.retiredDir) lines.push(`  old directory moved to ${consolidation.retiredDir}`);
  for (const [userId, cards] of Object.entries(report.scorecards)) {
    lines.push(`Scorecards ${userId}: ${cards.matched} held by the archive, ${cards.unmatched.length} not`);
    for (const name of cards.unmatched) lines.push(`  not in archive, kept: ${name}`);
  }
  const ladderText = (ladder) => (ladder
    ? `level ${ladder.unlocked_through}, ${ladder.wins} of ${ladder.needed} wins, ${ladder.results} results`
    : 'no file');
  for (const [userId, entry] of Object.entries(report.derived)) {
    if (entry.skipped) {
      lines.push(`Ladder ${userId}: skipped, ${entry.skipped} (${entry.games} finished games)`);
      continue;
    }
    lines.push(`Ladder ${userId} (${entry.games} finished games): ${ladderText(entry.ladder.before)} -> ${ladderText(entry.ladder.after)}`);
    const rivals = new Set([...Object.keys(entry.rivalries.before), ...Object.keys(entry.rivalries.after)]);
    for (const rival of rivals) {
      lines.push(`  ${rival}: ${entry.rivalries.before[rival] || '0-0-0'} -> ${entry.rivalries.after[rival] || '0-0-0'}`);
    }
  }
  return lines.join('\n');
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }
  try {
    process.stdout.write(`${renderReport(await run(options))}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
