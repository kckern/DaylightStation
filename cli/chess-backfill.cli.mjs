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
  isFinishedGame, matchScorecards, planUserBackfill, recordLevel, summarizeLadder, summarizeRivalries,
  withOpponentIds, withScorecardLevels,
} from '../backend/src/3_applications/chess/ChessRecordBackfill.mjs';

/** Where the archive lived before the household reorganisation, under the household root. */
export const LEGACY_ARCHIVE_DIR = 'gaming/log/pianochess';
/** The household chess config, under the household root. */
export const HOUSEHOLD_CHESS_CONFIG = 'gaming/chess.yml';

const USAGE = `Consolidate chess records and rebuild ladder and rivalry files.

  node cli/chess-backfill.cli.mjs [--data <data dir>] [--user <id>] [--write] [--allow-decrease]

  --data <dir>       The data directory (default: $DAYLIGHT_BASE_PATH/data)
  --user <id>        Retire scorecards and rebuild derived files for one player only.
                      Consolidating the archive is always household-wide.
  --write            Apply. Without it, report what would change and touch nothing.
  --allow-decrease   Write even if a player's counted ladder wins or rivalry
                      record would drop. Without it, --write refuses and
                      changes nothing when that would happen.
  -h, --help         Show this help
`;

export function parseArgs(argv) {
  const options = {
    data: null, user: null, write: false, allowDecrease: false, help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--data' || token === '--user') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${token} requires a value`);
      options[token.slice(2)] = value;
      index += 1;
    } else if (token === '--write') options.write = true;
    else if (token === '--allow-decrease') options.allowDecrease = true;
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

function ensureDir(dir) {
  if (fs.existsSync(dir)) return;
  ensureDir(path.dirname(dir));
  fs.mkdirSync(dir);
  matchOwner(dir, path.dirname(dir));
}

function writeYaml(file, value) {
  const existed = fs.existsSync(file);
  fs.writeFileSync(file, YAML.stringify(value));
  if (!existed) matchOwner(file, path.dirname(file));
}

/**
 * A destination that will not silently replace whatever is already there.
 * A same-day re-run, or a `--user` run after a household one, can otherwise
 * overwrite an earlier copy in `_deleteme/` or throw ENOTEMPTY partway
 * through a directory rename. `-1`, `-2`, … is appended before the
 * extension for a file, or to the whole name for a directory.
 */
function uniquePath(target) {
  if (!fs.existsSync(target)) return target;
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);
  let index = 1;
  let candidate = path.join(dir, `${base}-${index}${ext}`);
  while (fs.existsSync(candidate)) {
    index += 1;
    candidate = path.join(dir, `${base}-${index}${ext}`);
  }
  return candidate;
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

/**
 * The identity a game is deduplicated by.
 *
 * `game_id` is authoritative when present. Older records carry none, and two
 * copies of the same id-less game never share a filename — the legacy writer
 * and the current one name files differently — so falling back to the
 * filename let the same game load, and move, twice. The fields that *do*
 * survive a rename are who played, when the game started and ended, and how
 * many plies it ran; together they identify a game as well as an id would.
 * Only when every one of those is also missing does the filename remain the
 * last resort, so a truly bare record still dedupes against an exact re-run.
 */
const archiveKey = (record, name) => {
  if (record?.game_id) return `id:${record.game_id}`;
  // Same derivation the rename path uses (`consolidateArchive`'s `namedRecord`)
  // — a raw `move_count` misses when one copy of an id-less game recorded it
  // and the other only carries `moves`.
  const moveCount = record?.move_count ?? (Array.isArray(record?.moves) ? record.moves.length : undefined);
  const fields = [record?.user_id, record?.started_at, record?.ended_at, moveCount];
  const allMissing = fields.every((value) => value === undefined || value === null || value === '');
  return allMissing ? `name:${name}` : `key:${fields.map((value) => String(value ?? '')).join('|')}`;
};

/** Every archived game under these roots, each game once. */
export function loadArchive(roots) {
  const seen = new Set();
  const records = [];
  for (const root of roots) {
    for (const entry of ymlFilesByDay(root)) {
      const record = readYaml(entry.file);
      if (!record || typeof record !== 'object') continue;
      const key = archiveKey(record, entry.name);
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
 * game was archived, so filename filters in the review CLIs see them. A
 * legacy file whose game the current archive already holds — by the same
 * `game_id|started_at` identity `loadArchive` dedupes on, not by filename —
 * is a duplicate, not a move: a rebuilt legacy name carries a fresh random
 * UUID and would never collide with the copy already filed, and an old file
 * that happens to share a current-style name with its own already-archived
 * copy is not a *conflict* either, just the same game seen twice. Only a
 * destination collision against a genuinely different game is a conflict,
 * left in place, which is also the only thing that stops the old directory
 * from retiring.
 */
export function consolidateArchive({ householdDir, deleteDir, write }) {
  const legacyRoot = path.join(householdDir, ...LEGACY_ARCHIVE_DIR.split('/'));
  const root = path.join(householdDir, ...CHESS_ARCHIVE_DIR.split('/'));
  const report = {
    moved: 0, renamed: 0, alreadyArchived: 0, withoutGameId: 0, conflicts: [], retiredDir: null,
  };
  if (!fs.existsSync(legacyRoot)) return report;
  const currentKeys = new Set(
    ymlFilesByDay(root).map(({ name, file }) => archiveKey(readYaml(file) || {}, name)),
  );
  for (const { day, name, file } of ymlFilesByDay(legacyRoot)) {
    const record = readYaml(file) || {};
    if (!record?.game_id) report.withoutGameId += 1;
    const key = archiveKey(record, name);
    if (currentKeys.has(key)) {
      report.alreadyArchived += 1;
      if (!write) continue;
      const destination = uniquePath(path.join(deleteDir, 'pianochess-duplicates', day, name));
      ensureDir(path.dirname(destination));
      fs.renameSync(file, destination);
      continue;
    }
    // Only the generated filename needs a ply count; the file's own content
    // (and whether it ever recorded move_count) is never rewritten.
    const namedRecord = { ...record, move_count: record.move_count ?? (Array.isArray(record.moves) ? record.moves.length : 0) };
    const target = isLegacyName(name)
      ? `${buildChessArchiveFilename(namedRecord, record.user_id || 'guest', new Date(record.archived_at || record.ended_at || `${day}T12:00:00Z`))}.yml`
      : name;
    const destination = path.join(root, day, target);
    if (fs.existsSync(destination)) {
      report.conflicts.push(path.relative(householdDir, file));
      continue;
    }
    report.moved += 1;
    if (target !== name) report.renamed += 1;
    // Recorded immediately, dry run or not: a second legacy file for the same
    // game (unusual, but the pre-reorganisation directory is exactly where an
    // old duplicate would live) must read as already-archived too, not as a
    // second move.
    currentKeys.add(key);
    if (!write) continue;
    ensureDir(path.join(root, day));
    fs.renameSync(file, destination);
  }
  if (write && report.conflicts.length === 0) {
    ensureDir(deleteDir);
    report.retiredDir = uniquePath(path.join(deleteDir, 'pianochess-archive'));
    fs.renameSync(legacyRoot, report.retiredDir);
  }
  return report;
}

/** A player's scorecards, unread and unmoved — shared by `retireScorecards` and the level-recovery pass in `run`. */
export function loadScorecards(dataDir, userId) {
  const gamesDir = path.join(dataDir, 'users', userId, 'apps', 'chess', 'games');
  if (!fs.existsSync(gamesDir)) return [];
  return fs.readdirSync(gamesDir).filter((name) => name.endsWith('.yml')).sort()
    .map((name) => ({ file: path.join(gamesDir, name), record: readYaml(path.join(gamesDir, name)) || {} }));
}

/** Move each player's scorecards whose games the archive holds to `_deleteme/`. */
export function retireScorecards({ dataDir, archive, deleteDir, write, users }) {
  const report = {};
  for (const userId of users) {
    const gamesDir = path.join(dataDir, 'users', userId, 'apps', 'chess', 'games');
    if (!fs.existsSync(gamesDir)) continue;
    const cards = loadScorecards(dataDir, userId);
    const { matched, unmatched } = matchScorecards(cards, archive);
    report[userId] = { matched: matched.length, unmatched: unmatched.map((card) => path.basename(card.file)) };
    if (!write || matched.length === 0) continue;
    const target = path.join(deleteDir, 'scorecards', userId);
    ensureDir(target);
    for (const card of matched) fs.renameSync(card.file, uniquePath(path.join(target, path.basename(card.file))));
    if (fs.readdirSync(gamesDir).length === 0) fs.renameSync(gamesDir, uniquePath(path.join(target, 'games-dir')));
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
  ensureDir(path.dirname(target));
  fs.copyFileSync(file, target);
  matchOwner(target, path.dirname(target));
}

/** `"Name (id)"`, as `summarizeRivalries` builds it, split back into its parts. */
function parseRivalKey(key) {
  const match = /^(.*) \(([^)]+)\)$/.exec(key);
  return match ? { name: match[1], id: match[2] } : { name: key, id: key };
}

const sameOpponentName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Named drops in a player's counted progress between a before and after
 * report: falling ladder wins, or a rival whose win, loss or draw count
 * falls, or a rival that disappears entirely. Lost progress must never be
 * silent, so every one of these is a line, not a number.
 *
 * A rival can also disappear because it was re-keyed, not lost: stored
 * memory keeps an opponent under an old id nothing rebuilds under any more
 * (a pre-migration `chess:level-N`, say), while every archived game for that
 * same opponent now carries the roster pack's real id. That is a rename, not
 * a loss, provided the same-named rival that took its place in "after" has
 * equal-or-higher win, loss and draw counts — a re-key that actually lost
 * ground still reads as a decrease. The match is on name, never on id: the
 * id is exactly what changed.
 */
function findDecreases(entry) {
  const decreases = [];
  const notes = [];
  const beforeWins = entry.ladder.before?.wins ?? 0;
  const afterWins = entry.ladder.after?.wins ?? 0;
  const beforeLevel = entry.ladder.before?.unlocked_through ?? 0;
  const afterLevel = entry.ladder.after?.unlocked_through ?? 0;
  // A rung gained is never a decrease: promotion legitimately resets the
  // counted-wins tally for the new rung, so only compare wins when the level
  // itself did not go up.
  if (afterWins < beforeWins && afterLevel <= beforeLevel) decreases.push(`ladder wins ${beforeWins} of ${entry.ladder.before?.needed} -> ${afterWins} of ${entry.ladder.after?.needed}`);
  const parseRecord = (value) => {
    const [win, loss, draw] = String(value || '0-0-0').split('-').map(Number);
    return { win, loss, draw };
  };
  for (const [rival, before] of Object.entries(entry.rivalries.before)) {
    const after = entry.rivalries.after[rival];
    if (after === undefined) {
      const beforeRecord = parseRecord(before);
      const { name: beforeName, id: beforeId } = parseRivalKey(rival);
      const rekey = Object.entries(entry.rivalries.after).find(([afterKey, afterValue]) => {
        const { name: afterName, id: afterId } = parseRivalKey(afterKey);
        if (afterId === beforeId || !sameOpponentName(afterName, beforeName)) return false;
        const afterRecord = parseRecord(afterValue);
        return afterRecord.win >= beforeRecord.win && afterRecord.loss >= beforeRecord.loss && afterRecord.draw >= beforeRecord.draw;
      });
      if (rekey) {
        const [afterKey, afterValue] = rekey;
        notes.push(`re-keyed: ${beforeName} ${beforeId} -> ${parseRivalKey(afterKey).id} (${before} -> ${afterValue})`);
        continue;
      }
      decreases.push(`rival ${rival} disappeared, was ${before}`);
      continue;
    }
    const beforeRecord = parseRecord(before);
    const afterRecord = parseRecord(after);
    if (afterRecord.win < beforeRecord.win || afterRecord.loss < beforeRecord.loss || afterRecord.draw < beforeRecord.draw) {
      decreases.push(`rival ${rival} ${before} -> ${after}`);
    }
  }
  return { decreases, notes };
}

/**
 * Rebuild each player's ladder and rivalry files from their finished games.
 *
 * Always computes the full report, decreases included, whether or not
 * `write` is set — `run` calls this once to plan (and to decide whether a
 * write may proceed at all) and, only after that gate passes, a second time
 * with `write: true` to actually persist. The household config is passed in
 * rather than read here, because `run` must validate it before anything else
 * moves.
 */
export async function rebuildDerived({
  dataDir, archive, users, write, deleteDir, householdConfig,
}) {
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
    const entry = {
      games,
      ladder: { before: summarizeLadder(storedLadder, policy), after: summarizeLadder(plan.ladder, policy) },
      rivalries: { before: summarizeRivalries(readYaml(rivalriesFile)), after: summarizeRivalries(plan.rivalries) },
    };
    const { decreases, notes } = findDecreases(entry);
    entry.decreases = decreases;
    entry.notes = notes;
    report[userId] = entry;
    if (!write) continue;
    backupBeforeOverwrite(ladderFile, deleteDir, userId);
    backupBeforeOverwrite(rivalriesFile, deleteDir, userId);
    writeYaml(ladderFile, plan.ladder);
    writeYaml(rivalriesFile, plan.rivalries);
  }
  return report;
}

const localDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export async function run({
  data, user = null, write = false, allowDecrease = false, now = new Date(),
}) {
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

  // Read every game and validate the household config before anything moves,
  // so a refusal to write — for a missing config, or (below) for lost
  // progress — never leaves the tree half-changed.
  const archive = loadArchive([archiveRoot, legacyRoot]);
  const householdConfig = readYaml(path.join(householdDir, ...HOUSEHOLD_CHESS_CONFIG.split('/')));
  if (!householdConfig) throw new Error(`No household chess config at household/${HOUSEHOLD_CHESS_CONFIG}`);

  // A few archived games carry no level (and no opponent) at all — the
  // scorecards retireScorecards is about to move to _deleteme/ are the only
  // remaining place a handful of them survive. Recover what those scorecards
  // know before the plan is computed, so a level recovered this way is what
  // the decrease guard checks against — never rewrites a file, only the
  // in-memory records used for the replay below.
  const cards = users.flatMap((userId) => loadScorecards(data, userId));
  const enrichedArchive = withScorecardLevels(archive, cards);
  const levelsRecovered = enrichedArchive.reduce(
    (count, record, index) => count + (record !== archive[index] && recordLevel(record) !== null ? 1 : 0), 0,
  );

  // Plan the derived rewrite first — it only needs the in-memory archive and
  // configs, not anything consolidateArchive/retireScorecards touch — so a
  // decrease is caught before a single file moves.
  const plan = await rebuildDerived({
    dataDir: data, archive: enrichedArchive, users, write: false, deleteDir, householdConfig,
  });
  const decreases = Object.fromEntries(
    Object.entries(plan).filter(([, entry]) => entry.decreases?.length).map(([id, entry]) => [id, entry.decreases]),
  );
  if (write && Object.keys(decreases).length > 0 && !allowDecrease) {
    throw new Error(`Refusing to write: counted progress would decrease for ${Object.keys(decreases).join(', ')} (pass --allow-decrease to override)`);
  }

  const consolidation = consolidateArchive({ householdDir, deleteDir, write });
  const scorecards = retireScorecards({
    dataDir: data, archive, deleteDir, write, users,
  });
  const derived = write
    ? await rebuildDerived({
      dataDir: data, archive: enrichedArchive, users, write: true, deleteDir, householdConfig,
    })
    : plan;
  return {
    write, archive: { games: archive.length }, consolidation, scorecards, derived, decreases, levelsRecovered,
  };
}

export function renderReport(report) {
  const lines = [report.write ? 'Chess record backfill: WRITTEN' : 'Chess record backfill: DRY RUN (pass --write to apply)'];
  lines.push(`Archive: ${report.archive.games} games read`);
  lines.push(`Levels recovered from scorecards: ${report.levelsRecovered}`);
  const { consolidation } = report;
  lines.push(`Old archive directory: ${consolidation.moved} files to move, ${consolidation.renamed} renamed from old names, ${consolidation.alreadyArchived} already archived, ${consolidation.withoutGameId} without a game id, ${consolidation.conflicts.length} conflicts`);
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
    for (const note of entry.notes || []) lines.push(`  ${note}`);
    for (const decrease of entry.decreases || []) lines.push(`  DECREASE for ${userId}: ${decrease}`);
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
