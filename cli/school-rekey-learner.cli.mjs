#!/usr/bin/env node
/**
 * school-rekey-learner — rename a learner id across BOTH school data roots
 * (admin advocacy #8): `users/{id}/…` moves attempts and frozen report cards,
 * but assignments, assignment history, session events, milestones,
 * attestations, teacher notes, enrichment, quiz requests, print rows, and
 * tokens are all household-keyed by the old string. Renaming the directory by
 * hand strands every one of them — the child re-appears with zero assignments
 * and reset gating while the old id haunts the pickers.
 *
 * Usage:
 *   node cli/school-rekey-learner.cli.mjs <oldId> <newId> [--data-dir <path>] [--apply]
 *
 * DRY RUN BY DEFAULT: prints what would change; nothing moves without
 * --apply. Refuses when <newId> already exists in either root.
 *
 * What it deliberately does NOT touch:
 *   - `household/config/school.yml` (`students:`, `schoolcalc.…learner_slots`)
 *     — config is boot-cached and hand-edited; the report names the keys.
 *   - teacher ids (`from`, `assignedBy`, `gradedBy`, `dismissedBy`,
 *     `attestedBy`, `decidedBy`) — this rekeys a LEARNER; an adult actor
 *     keeps their name.
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

/** Keys whose VALUE is a learner identity. Actor keys are deliberately absent. */
const LEARNER_KEYS = new Set(['learnerId', 'userId', 'attributedTo', 'reassignedFrom', 'reassignedTo']);
const LEARNER_LIST_KEYS = new Set(['learnerIds']);

/** Recursively rewrite learner identities in a parsed YAML value. Returns hit count. */
export function rewriteLearnerIds(node, oldId, newId) {
  let hits = 0;
  if (Array.isArray(node)) {
    for (const item of node) hits += rewriteLearnerIds(item, oldId, newId);
    return hits;
  }
  if (!node || typeof node !== 'object') return 0;
  for (const [key, value] of Object.entries(node)) {
    if (LEARNER_KEYS.has(key) && value === oldId) {
      node[key] = newId;
      hits += 1;
    } else if (LEARNER_LIST_KEYS.has(key) && Array.isArray(value)) {
      value.forEach((v, i) => { if (v === oldId) { value[i] = newId; hits += 1; } });
    } else if (value && typeof value === 'object') {
      hits += rewriteLearnerIds(value, oldId, newId);
    }
  }
  return hits;
}

function* walkYamlFiles(root) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walkYamlFiles(full);
    else if (/\.ya?ml$/.test(entry.name)) yield full;
  }
}

/**
 * The rekey plan+apply, pure-ish for tests: `apply:false` only reports.
 * @returns {{moves: Array, edits: Array, warnings: string[], errors: string[]}}
 */
export function runRekey({ dataDir, oldId, newId, apply = false }) {
  const moves = []; // {from, to}
  const edits = []; // {file, hits}
  const warnings = [];
  const errors = [];

  const userDirOld = path.join(dataDir, 'users', oldId);
  const userDirNew = path.join(dataDir, 'users', newId);
  const schoolDir = path.join(dataDir, 'household', 'apps', 'school');

  if (!fs.existsSync(userDirOld) && !fs.existsSync(schoolDir)) {
    errors.push(`nothing found for '${oldId}' under ${dataDir}`);
    return { moves, edits, warnings, errors };
  }
  if (fs.existsSync(userDirNew)) {
    errors.push(`refusing: users/${newId} already exists`);
    return { moves, edits, warnings, errors };
  }

  // 1. The per-user root — attempts, frozen report cards, app state.
  if (fs.existsSync(userDirOld)) moves.push({ from: userDirOld, to: userDirNew });
  else warnings.push(`users/${oldId} does not exist — rekeying household stores only`);

  // 2. Keyed FILENAMES under the household school root.
  for (const sub of ['assignments', 'history']) {
    const oldFile = path.join(schoolDir, sub, `${oldId}.yml`);
    if (fs.existsSync(oldFile)) {
      const newFile = path.join(schoolDir, sub, `${newId}.yml`);
      if (fs.existsSync(newFile)) { errors.push(`refusing: ${sub}/${newId}.yml already exists`); return { moves, edits, warnings, errors }; }
      moves.push({ from: oldFile, to: newFile });
    }
  }

  // 3. Learner identities INSIDE every YAML under the school root.
  for (const file of walkYamlFiles(schoolDir)) {
    let doc;
    try { doc = yaml.load(fs.readFileSync(file, 'utf8')); } catch { warnings.push(`unparseable, skipped: ${file}`); continue; }
    const hits = rewriteLearnerIds(doc, oldId, newId);
    if (hits) edits.push({ file, hits, doc });
  }

  if (apply) {
    for (const { file, doc } of edits) fs.writeFileSync(file, yaml.dump(doc, { noRefs: true }));
    for (const { from, to } of moves) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(from, to); }
  }
  return { moves, edits: edits.map(({ file, hits }) => ({ file, hits })), warnings, errors };
}

const ENTRYPOINT = path.resolve(new URL(import.meta.url).pathname);
if (process.argv[1] && path.resolve(process.argv[1]) === ENTRYPOINT) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const dataDirFlag = args.includes('--data-dir') ? args[args.indexOf('--data-dir') + 1] : null;
  const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--data-dir');
  if (positional.length !== 2) {
    process.stderr.write('Usage: school-rekey-learner.cli.mjs <oldId> <newId> [--data-dir <path>] [--apply]\n');
    process.exit(2);
  }
  const dataDir = dataDirFlag ?? path.join(process.env.DAYLIGHT_BASE_PATH ?? process.cwd(), 'data');
  const [oldId, newId] = positional;
  const result = runRekey({ dataDir, oldId, newId, apply });
  for (const w of result.warnings) process.stdout.write(`WARN  ${w}\n`);
  for (const m of result.moves) process.stdout.write(`MOVE  ${m.from} -> ${m.to}\n`);
  for (const e of result.edits) process.stdout.write(`EDIT  ${e.file} (${e.hits} identit${e.hits === 1 ? 'y' : 'ies'})\n`);
  for (const e of result.errors) process.stderr.write(`ERROR ${e}\n`);
  if (!result.errors.length) {
    process.stdout.write(apply
      ? `Rekeyed '${oldId}' -> '${newId}'. NOW EDIT school.yml by hand (students:, schoolcalc.continuation.learner_slots) and restart the container.\n`
      : 'DRY RUN — nothing changed. Re-run with --apply to execute.\n');
  }
  process.exit(result.errors.length ? 1 : 0);
}
