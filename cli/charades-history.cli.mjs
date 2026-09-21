#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { fileExists, readTextFromPath, writeFileAtomic } from '#system/utils/FileIO.mjs';
import { YamlCharadesClueHistory } from '#adapters/persistence/yaml/gaming/YamlCharadesClueHistory.mjs';

function parseArgs(argv) {
  const options = { command: argv[0], sessionId: null, apply: false };
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === '--from-session') options.sessionId = argv[++index];
    else if (argv[index] === '--apply') options.apply = true;
    else throw new Error(`Unknown option: ${argv[index]}`);
  }
  if (options.command !== 'reset-fhe' || !options.sessionId) {
    throw new Error('Usage: charades-history reset-fhe --from-session <session-id> [--apply]');
  }
  return options;
}

function timestamp(date) {
  return date.toISOString().replaceAll('-', '').replaceAll(':', '').replace('T', '-').slice(0, 15);
}

function resolveDataDir() {
  if (process.env.DAYLIGHT_DATA_PATH) return process.env.DAYLIGHT_DATA_PATH;
  if (process.env.DAYLIGHT_BASE_PATH) return path.join(process.env.DAYLIGHT_BASE_PATH, 'data');
  throw new Error('Set DAYLIGHT_BASE_PATH or DAYLIGHT_DATA_PATH');
}

function readCanonicalEntries(dataDir, sessionId) {
  const gaming = path.join(dataDir, 'household/gaming');
  const snapshotFile = path.join(gaming, 'snapshots', `${sessionId}.yml`);
  const snapshot = YAML.parse(readTextFromPath(snapshotFile), { uniqueKeys: true });
  if (snapshot?.header?.status !== 'complete' || snapshot.header?.artifacts?.content_pack?.id !== 'charades:fhe') {
    throw new Error('source must be a completed charades:fhe session');
  }
  const order = snapshot?.state?.challenge_order;
  if (!Array.isArray(order) || order.length !== 18) throw new Error('source session must contain exactly 18 challenge indices');
  const contentHash = snapshot.header.artifacts.content_pack.hash;
  const content = YAML.parse(readTextFromPath(path.join(gaming, 'definitions/content', `${contentHash}.yml`)), { uniqueKeys: true });
  const journal = readTextFromPath(path.join(gaming, 'journals', `${sessionId}.jsonl`)).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const finished = journal.flatMap(record => record.events || []).filter(entry => entry.event?.type === 'challenge.finished');
  if (finished.length !== 18) throw new Error('source session must contain exactly 18 finished challenges');
  return order.map((challengeIndex, turn) => {
    const clue = content?.challenges?.[challengeIndex];
    if (!clue?.id) throw new Error(`source content is missing challenge index ${challengeIndex}`);
    return {
      key: `legacy:${sessionId}:${turn}`,
      clue_id: String(clue.id), session_id: sessionId,
      challenge_index: turn, clue_index: 0,
      presentation: snapshot.state.clue_presentations?.[turn] || 'text',
      played_at: finished[turn].recorded_at,
    };
  });
}

export async function runCli(argv, { dataDir = resolveDataDir(), now = () => new Date(), stdout = value => process.stdout.write(value) } = {}) {
  const options = parseArgs(argv);
  const entries = readCanonicalEntries(dataDir, options.sessionId);
  const file = path.join(dataDir, 'household/gaming/history/charades.yml');
  const backup = `${file}.backup-${timestamp(now())}`;
  stdout(`Target: ${file}\nBackup: ${backup}\n${entries.map(entry => entry.clue_id).join('\n')}\n`);
  if (!options.apply) return { applied: false, entries };
  if (fileExists(file)) writeFileAtomic(backup, readTextFromPath(file));
  const store = new YamlCharadesClueHistory({ file });
  await store.replace('charades:fhe', entries);
  stdout(`Applied ${entries.length} canonical clues.\n`);
  return { applied: true, entries, file, backup: fileExists(backup) ? backup : null };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
