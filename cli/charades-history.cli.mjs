#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { fileExists, readTextFromPath, writeFileExclusive } from '#system/utils/FileIO.mjs';
import { YamlCharadesClueHistory } from '#adapters/persistence/yaml/gaming/YamlCharadesClueHistory.mjs';

function parseArgs(argv) {
  const options = { command: argv[0], sessionId: null, apply: false };
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === '--from-session') options.sessionId = argv[++index];
    else if (argv[index] === '--apply') options.apply = true;
    else throw new Error(`Unknown option: ${argv[index]}`);
  }
  if (options.command !== 'import-fhe' || !options.sessionId) {
    throw new Error('Usage: charades-history import-fhe --from-session <session-id> [--apply]');
  }
  return options;
}

function timestamp(date) {
  return date.toISOString().replaceAll('-', '').replaceAll(':', '').replace('T', '-').replace('.', '-').slice(0, 19);
}

function resolveDataDir() {
  if (process.env.DAYLIGHT_DATA_PATH) return process.env.DAYLIGHT_DATA_PATH;
  if (process.env.DAYLIGHT_BASE_PATH) return path.join(process.env.DAYLIGHT_BASE_PATH, 'data');
  throw new Error('Set DAYLIGHT_BASE_PATH or DAYLIGHT_DATA_PATH');
}

function readPlayedEntries(dataDir, sessionId) {
  if (!String(sessionId).startsWith('game:')) throw new Error('source must be a persisted real game session');
  const gaming = path.join(dataDir, 'household/gaming');
  const snapshotFile = path.join(gaming, 'snapshots', `${sessionId}.yml`);
  const snapshot = YAML.parse(readTextFromPath(snapshotFile), { uniqueKeys: true });
  if (snapshot?.header?.artifacts?.content_pack?.id !== 'charades:fhe') {
    throw new Error('source must be a charades:fhe session');
  }
  const order = snapshot?.state?.challenge_order;
  if (!Array.isArray(order)) throw new Error('source session must contain a challenge order');
  const contentHash = snapshot.header.artifacts.content_pack.hash;
  const content = YAML.parse(readTextFromPath(path.join(gaming, 'definitions/content', `${contentHash}.yml`)), { uniqueKeys: true });
  const journal = readTextFromPath(path.join(gaming, 'journals', `${sessionId}.jsonl`)).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const finished = journal.flatMap(record => record.events || []).filter(entry => entry.event?.type === 'challenge.finished');
  if (finished.length === 0) throw new Error('source session has no finished challenges');
  return finished.map((entry, turn) => {
    const challengeIndex = order[entry.event?.challenge_index ?? turn];
    const clue = content?.challenges?.[challengeIndex];
    if (!clue?.id) throw new Error(`source content is missing challenge index ${challengeIndex}`);
    return {
      key: `import:${sessionId}:${turn}`,
      clue_id: String(clue.id), session_id: sessionId,
      challenge_index: turn, clue_index: 0,
      presentation: snapshot.state.clue_presentations?.[turn] || 'text',
      played_at: finished[turn].recorded_at,
    };
  });
}

export async function runCli(argv, { dataDir = resolveDataDir(), now = () => new Date(), stdout = value => process.stdout.write(value) } = {}) {
  const options = parseArgs(argv);
  const entries = readPlayedEntries(dataDir, options.sessionId);
  const file = path.join(dataDir, 'household/gaming/history/charades.yml');
  const backup = `${file}.backup-${timestamp(now())}`;
  const store = new YamlCharadesClueHistory({ file });
  const existing = await store.list('charades:fhe');
  const existingKeys = new Set(existing.map(entry => entry.key));
  const existingTurns = new Set(existing.map(entry => [entry.session_id, entry.challenge_index, entry.clue_index ?? 0].join(':')));
  const additions = entries.filter(entry => !existingKeys.has(entry.key)
    && !existingTurns.has([entry.session_id, entry.challenge_index, entry.clue_index].join(':')));
  const merged = [...existing, ...additions].sort((left, right) => String(left.played_at || '').localeCompare(String(right.played_at || '')));
  stdout(`Target: ${file}\nBackup: ${backup}\nExisting: ${existing.length}; adding: ${additions.length}\n${additions.map(entry => entry.clue_id).join('\n')}\n`);
  if (!options.apply) return { applied: false, entries: additions };
  if (additions.length === 0) return { applied: false, entries: [], file, backup: null };
  if (fileExists(file)) writeFileExclusive(backup, readTextFromPath(file));
  await store.replace('charades:fhe', merged);
  stdout(`Imported ${additions.length} played clues.\n`);
  return { applied: true, entries: additions, file, backup: fileExists(backup) ? backup : null };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
