#!/usr/bin/env node
/**
 * Void piano attempts that should not count — e.g. runs the grader got wrong.
 * The records stay on disk with `voided: { at, reason }`; every attempt
 * listing (and so every challenge policy) skips them.
 *
 *   node cli/piano-attempt-void.cli.mjs <userId> <attemptId...> --reason "<why>" [--dry-run]
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { YamlPianoAttemptStore } from '#adapters/persistence/yaml/piano/YamlPianoAttemptStore.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '..', '.env') });

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const reasonFlag = args.indexOf('--reason');
const reason = reasonFlag >= 0 ? args[reasonFlag + 1] : null;
const positional = args.filter((arg, index) => !arg.startsWith('--') && index !== reasonFlag + 1);
const [userId, ...attemptIds] = positional;
if (!userId || !attemptIds.length || !reason) {
  process.stderr.write('usage: piano-attempt-void.cli.mjs <userId> <attemptId...> --reason "<why>" [--dry-run]\n');
  process.exit(2);
}

const base = process.env.DAYLIGHT_BASE_PATH;
if (!base) throw new Error('DAYLIGHT_BASE_PATH must identify the Daylight data root');
const store = new YamlPianoAttemptStore({ usersDir: path.join(base, 'data', 'users') });

const known = new Map(store.listRecent(userId, { limit: 100000, includeVoided: true }).map((a) => [a.attempt_id, a]));
let failed = false;
for (const attemptId of attemptIds) {
  const existing = known.get(attemptId);
  if (!existing) { process.stdout.write(`missing  ${attemptId}\n`); failed = true; continue; }
  if (existing.voided) { process.stdout.write(`already  ${attemptId} (${existing.voided.reason})\n`); continue; }
  if (dryRun) { process.stdout.write(`would    ${attemptId} score=${existing.score}\n`); continue; }
  store.void(userId, attemptId, { reason });
  process.stdout.write(`voided   ${attemptId} score=${existing.score}\n`);
}
process.exit(failed ? 1 : 0);
