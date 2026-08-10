#!/usr/bin/env node
import { cp, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import {
  PRODUCER_FAMILIES,
  normalizeProducerRecord,
  producerContentHash,
  validateProducerRecord,
} from '../backend/src/3_applications/piano/producerRecords.mjs';

function parseArgs(argv) {
  const args = {
    apply: false, requireClean: false, root: null, ledger: null, mediaRoot: null, report: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--apply') args.apply = true;
    else if (token === '--require-clean') args.requireClean = true;
    else if (token === '--root') args.root = argv[++i];
    else if (token === '--ledger') args.ledger = argv[++i];
    else if (token === '--media-root') args.mediaRoot = argv[++i];
    else if (token === '--report') args.report = argv[++i];
    else if (token === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function help() {
  return [
    'Usage: node cli/piano-producer-migrate.cli.mjs --root DIR --ledger FILE --media-root DIR [--apply | --require-clean] [--report FILE]',
    '',
    'Default is a read-only dry run. --apply creates a sibling backup before atomic writes.',
    '--require-clean is read-only and exits nonzero unless no record or reference would change.',
  ].join('\n');
}

async function exists(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

function pushIndex(map, key, value) {
  if (!key) return;
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

async function loadLedger(path) {
  const lines = (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean);
  const entries = lines.map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw new Error(`Invalid ledger line ${index + 1}: ${error.message}`); }
  });
  const bySource = new Map();
  const byOutput = new Map();
  const bySlug = new Map();
  for (const entry of entries) {
    pushIndex(bySource, entry.source, entry);
    pushIndex(byOutput, entry.output, entry);
    pushIndex(bySlug, entry.slug, entry);
  }
  return { entries, bySource, byOutput, bySlug };
}

const TYPES_BY_ROLE = {
  chords: new Set(['chord-progression', 'chords']),
  melody: new Set(['melody']),
  bass: new Set(['bassline', 'bass']),
  idea: new Set(['idea']),
  groove: new Set(['groove', 'percussion']),
};

function uniqueCandidates(candidates, role) {
  const expected = TYPES_BY_ROLE[role];
  const typed = expected ? candidates.filter((entry) => expected.has(entry.type)) : candidates;
  const pool = typed.length ? typed : candidates;
  return [...new Map(pool.filter((entry) => entry.output).map((entry) => [entry.output, entry])).values()];
}

async function repairLibraryLayer(layer, indexes, mediaRoot, location, report) {
  if (layer?.carriedRef || layer?.source?.kind !== 'library') return;
  const entry = layer.source.entry;
  const oldPath = entry?.path;
  if (typeof oldPath !== 'string' || !oldPath) {
    report.errors.push(`${location}: library entry has no path`);
    return;
  }
  if (await exists(join(mediaRoot, oldPath))) return;

  let candidates = indexes.bySource.get(oldPath) ?? indexes.byOutput.get(oldPath) ?? [];
  if (!candidates.length && entry.slug) candidates = indexes.bySlug.get(entry.slug) ?? [];
  const unique = uniqueCandidates(candidates, layer.role);
  const viable = [];
  for (const candidate of unique) {
    if (await exists(join(mediaRoot, candidate.output))) viable.push(candidate);
  }
  if (viable.length !== 1) {
    report.errors.push(`${location}: missing library path ${oldPath}; ${viable.length} unambiguous ledger replacements`);
    if (unique.length) report.unresolvedCandidates[location] = unique.map((candidate) => candidate.output);
    return;
  }

  const replacement = viable[0];
  entry.path = replacement.output;
  entry.migratedFromPath = oldPath;
  if (layer.id === oldPath) layer.id = replacement.output;
  report.repairedLibraryRefs.push({ location, from: oldPath, to: replacement.output, via: replacement.source === oldPath ? 'source' : 'slug' });
}

function collectLayers(family, record) {
  if (family === 'crate') return [{ prefix: 'layers', layers: record.layers ?? [] }];
  if (family !== 'songs') return [];
  const groups = (record.sections ?? []).map((section, index) => ({
    prefix: `sections[${index}].stack`, layers: section.stack ?? [],
  }));
  groups.push({ prefix: 'carriedLayers', layers: Object.values(record.carriedLayers ?? {}) });
  return groups;
}

async function readFamily(root, family) {
  const dir = join(root, family);
  const names = (await readdir(dir)).filter((name) => ['.yml', '.yaml'].includes(extname(name))).sort();
  const records = [];
  for (const name of names) {
    const path = join(dir, name);
    const raw = await readFile(path, 'utf8');
    const parsed = YAML.parse(raw);
    records.push({ family, id: basename(name, extname(name)), name, path, raw, parsed });
  }
  return records;
}

function duplicateGroups(records) {
  const groups = new Map();
  for (const item of records) {
    const hash = producerContentHash(item.family, item.normalized);
    const key = `${item.family}:${hash}`;
    const ids = groups.get(key) ?? [];
    ids.push(item.id);
    groups.set(key, ids);
  }
  return [...groups.entries()].filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ family: key.slice(0, key.indexOf(':')), contentHash: key.slice(key.indexOf(':') + 1), ids }));
}

export async function auditProducerData({ root, ledger, mediaRoot }) {
  if (!root || !ledger || !mediaRoot) throw new Error('root, ledger, and mediaRoot are required');
  const resolved = { root: resolve(root), ledger: resolve(ledger), mediaRoot: resolve(mediaRoot) };
  const indexes = await loadLedger(resolved.ledger);
  const all = [];
  for (const family of PRODUCER_FAMILIES) all.push(...await readFamily(resolved.root, family));
  const loopIds = new Set(all.filter((item) => item.family === 'loops').map((item) => item.id));
  const now = new Date().toISOString();
  const report = {
    schemaVersion: 2,
    mode: 'dry-run',
    root: resolved.root,
    counts: Object.fromEntries(PRODUCER_FAMILIES.map((family) => [family, all.filter((item) => item.family === family).length])),
    changed: [],
    repairedLibraryRefs: [],
    unresolvedCandidates: {},
    duplicateContentGroups: [],
    errors: [],
    warnings: [],
  };

  for (const item of all) {
    const mutable = structuredClone(item.parsed ?? {});
    for (const group of collectLayers(item.family, mutable)) {
      for (let index = 0; index < group.layers.length; index += 1) {
        await repairLibraryLayer(group.layers[index], indexes, resolved.mediaRoot, `${item.family}/${item.id}:${group.prefix}[${index}]`, report);
      }
    }
    item.normalized = normalizeProducerRecord(item.family, mutable, { id: item.id, now });
    const errors = validateProducerRecord(item.family, item.normalized, { hasLoop: (id) => loopIds.has(id) });
    report.errors.push(...errors.map((error) => `${item.family}/${item.id}: ${error}`));
    item.output = YAML.stringify(item.normalized, { lineWidth: 0 });
    if (item.output !== item.raw) report.changed.push(`${item.family}/${item.id}`);
  }

  report.duplicateContentGroups = duplicateGroups(all);
  report.valid = report.errors.length === 0;
  report.clean = report.valid
    && report.changed.length === 0
    && report.repairedLibraryRefs.length === 0;
  return { report, records: all, resolved };
}

function backupName(root) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(dirname(root), `${basename(root)}.backup-v1-${stamp}`);
}

export async function applyProducerMigration(audit) {
  if (!audit.report.valid) throw new Error(`Refusing migration with ${audit.report.errors.length} validation errors`);
  const backup = backupName(audit.resolved.root);
  await cp(audit.resolved.root, backup, { recursive: true, errorOnExist: true });
  for (const item of audit.records) {
    const temp = `${item.path}.producer-v2.tmp`;
    await writeFile(temp, item.output, 'utf8');
    await rename(temp, item.path);
  }
  audit.report.mode = 'applied';
  audit.report.backup = backup;
  return audit.report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(`${help()}\n`); return; }
  if (args.apply && args.requireClean) throw new Error('--apply and --require-clean are mutually exclusive');
  const audit = await auditProducerData(args);
  const report = args.apply ? await applyProducerMigration(audit) : audit.report;
  if (args.report) {
    const reportPath = resolve(args.report);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.valid || (args.requireClean && !report.clean)) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
}
