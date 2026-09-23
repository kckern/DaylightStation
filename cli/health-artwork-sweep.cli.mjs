#!/usr/bin/env node
// health-artwork-sweep.cli.mjs — one-time sweep of the WHOLE food history into
// the artwork remediation queue (design 2026-09-23 §5).
//
// The running server sweeps only the last 7 days, hourly. This walks every row
// (hot nutrilist + every archive month) for food whose artwork cannot be shown
// — no working photo, and an icon that is missing, `default`, or not served by
// the manifest — and reports what the queue would do with each food.
//
// DRY RUN BY DEFAULT: reads only, prints counts and what the deterministic
// ladder (catalog pin/icon → reviewed name map → name guess → exact-only photo)
// would pick; foods only the AI step could place are counted as `ai`. Nothing
// calls the AI here.
// --apply enqueues the findings into users/{id}/lifelog/nutrition/artwork-queue.yml;
// the server's 2-minute tick then works them through the audited repair path.
// Apply only where that server is the one that reads this tree.
//
// Usage:
//   node cli/health-artwork-sweep.cli.mjs --user ID [--since-days N] [--manifest PATH] [--json] [--apply]
//   (DAYLIGHT_BASE_PATH must point at the data root; --since-days defaults to all history)

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { ArtworkRemediation } from '#apps/nutrition/ArtworkRemediation.mjs';
import { manifestVocabulary } from '#apps/health/ScanDataRepair.mjs';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { YamlFoodCatalogDatastore } from '#adapters/persistence/yaml/YamlFoodCatalogDatastore.mjs';
import { YamlArtworkQueueStore } from '#adapters/persistence/yaml/YamlArtworkQueueStore.mjs';

const silent = { info() {}, warn() {}, debug() {}, error() {} };
const refuse = () => { throw new Error('dry-run CLI does not repair rows'); };

/** Icons straight from the manifest file: offered slugs + aliases, reviewed names. */
function manifestIcons(manifestPath) {
  const manifest = (manifestPath && fs.existsSync(manifestPath) ? yaml.load(fs.readFileSync(manifestPath, 'utf8')) : null) || {};
  const { offered, aliases } = manifestVocabulary(manifest);
  const served = new Set([...offered, ...Object.keys(aliases)]);
  const foodNames = Object.fromEntries(Object.entries(manifest.foodNames || {}).filter(([, slug]) => slug === null || offered.includes(slug)));
  return { list: () => offered, foodNames: () => foodNames, has: slug => served.has(slug) };
}

export async function sweepHistory({ dataRoot, userId, sinceDays = null, manifestPath = null, apply = false, now = Date.now() }) {
  const userDir = path.join(dataRoot, 'users', userId);
  const dataService = { user: {
    resolveDir: (relative, id) => path.join(dataRoot, 'users', id, relative),
    resolvePath: (relative, id) => path.join(dataRoot, 'users', id, relative + '.yml'),
  } };
  const items = new YamlNutriListDatastore({ dataService, logger: silent });
  const photosDir = path.join(userDir, 'lifelog/nutrition/photos');
  const photos = { resolvePath: (_id, ref) => (/^ph_[A-Za-z0-9_-]+$/.test(ref) && fs.existsSync(path.join(photosDir, `${ref}.jpg`)) ? ref : null) };
  const remediation = new ArtworkRemediation({
    queue: new YamlArtworkQueueStore({ dataService }), items, repairs: { apply: refuse },
    catalog: new YamlFoodCatalogDatastore({ dataService, logger: silent }), icons: manifestIcons(manifestPath),
    photos, clock: { now: () => now }, logger: silent,
  });
  const days = sinceDays ?? Math.ceil((now - Date.parse('2000-01-01')) / 86400000);
  const result = await remediation.sweep(userId, { sinceDays: days, dryRun: !apply });

  // One preview per FOOD (the queue's own dedupe), not per row.
  const foods = new Map();
  for (const candidate of result.candidates) {
    const key = candidate.kind === 'photo-failed' ? `photo:${candidate.photoRef}` : candidate.foodId ? `food:${candidate.foodId}` : `name:${String(candidate.name).toLowerCase()}`;
    const food = foods.get(key) || { key, kind: candidate.kind, name: candidate.name, foodId: candidate.foodId, rowIds: [] };
    food.rowIds.push(...candidate.rowIds);
    foods.set(key, food);
  }
  // One ledger read for every preview.
  const since = result.candidates.flatMap(candidate => candidate.dates || []).filter(Boolean).sort()[0] ?? null;
  const pass = remediation.pass(userId);
  const byVia = {};
  const open = [];
  const needsAi = [];
  for (const food of foods.values()) {
    const preview = await remediation.previewArt(userId, { ...food, earliestDate: since }, pass);
    const via = preview.open ? 'stays-open' : preview.via;
    byVia[via] = (byVia[via] || 0) + 1;
    if (preview.open) open.push({ name: food.name, kind: food.kind, rows: food.rowIds.length, reason: preview.open });
    else if (via === 'ai') needsAi.push({ name: food.name, rows: food.rowIds.length });
    food.preview = preview;
  }
  const byKind = {};
  for (const candidate of result.candidates) byKind[candidate.kind] = (byKind[candidate.kind] || 0) + 1;
  return { mode: apply ? 'applied (queued)' : 'dry-run (nothing written; --apply to enqueue)', userId, sinceDays: days,
    rowsScanned: result.scanned, rowsWithBrokenArt: result.broken, rowsByKind: byKind, foods: foods.size,
    enqueued: result.enqueued, foodsByResolution: byVia, needsAi, stayOpen: open,
    sample: [...foods.values()].slice(0, 25).map(({ name, kind, rowIds, preview }) => ({ name, kind, rows: rowIds.length, preview })) };
}

export async function main(args, { env = process.env, out = process.stdout } = {}) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (['--apply', '--json'].includes(flag)) options[flag.slice(2)] = true;
    else if (['--user', '--since-days', '--manifest', '--data-root'].includes(flag)) options[flag.slice(2)] = args[++i];
    else throw new Error('Usage: --user ID [--since-days N] [--manifest PATH] [--data-root DIR] [--json] [--apply]');
  }
  const dataRoot = options['data-root'] || (env.DAYLIGHT_BASE_PATH ? path.join(env.DAYLIGHT_BASE_PATH, 'data') : null);
  if (!dataRoot || !options.user) throw new Error('--user and DAYLIGHT_BASE_PATH (or --data-root) are required');
  const manifestPath = options.manifest || path.join(dataRoot, 'household/apps/health/icon-manifest.yml');
  const report = await sweepHistory({ dataRoot, userId: options.user, manifestPath, apply: !!options.apply,
    sinceDays: options['since-days'] ? Number(options['since-days']) : null });
  if (!options.json) delete report.sample;
  out.write(JSON.stringify(report, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
