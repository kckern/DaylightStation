#!/usr/bin/env node
// Production certification for the mounted Producer loop and prefab catalogs.
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { buildManifest } from '../backend/src/3_applications/piano/loopManifest.mjs';
import {
  resolvePrefabSong, resolvePrefabStack,
} from '../frontend/src/modules/Piano/PianoKiosk/producer/prefabHydrate.js';

const SKIP_HARMONY = new Set(['groove', 'percussion']);

async function exists(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

function parseArgs(argv) {
  const args = {
    mediaRoot: null,
    ledger: null,
    prefabs: null,
    minStacks: 6,
    minSongs: 3,
    maxBuildMs: 5000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--media-root') args.mediaRoot = argv[++i];
    else if (token === '--ledger') args.ledger = argv[++i];
    else if (token === '--prefabs') args.prefabs = argv[++i];
    else if (token === '--min-stacks') args.minStacks = Number(argv[++i]);
    else if (token === '--min-songs') args.minSongs = Number(argv[++i]);
    else if (token === '--max-build-ms') args.maxBuildMs = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function collectPrefabRefs(kind, payload) {
  if (kind === 'stacks') return payload.layers ?? [];
  return [
    ...Object.values(payload.carried ?? {}),
    ...(payload.sections ?? []).flatMap((section) => section.layers ?? []).filter((ref) => !ref?.carried),
  ];
}

export async function certifyProducerCatalog({
  mediaRoot, ledger, prefabs,
  minStacks = 6,
  minSongs = 3,
  maxBuildMs = 5000,
}) {
  if (!mediaRoot || !ledger || !prefabs) throw new Error('mediaRoot, ledger, and prefabs are required');
  if (!Number.isFinite(minStacks) || minStacks < 0) throw new Error('minStacks must be a non-negative number');
  if (!Number.isFinite(minSongs) || minSongs < 0) throw new Error('minSongs must be a non-negative number');
  if (!Number.isFinite(maxBuildMs) || maxBuildMs < 0) throw new Error('maxBuildMs must be a non-negative number');
  const root = resolve(mediaRoot);
  const ledgerPath = resolve(ledger);
  const prefabRoot = resolve(prefabs);
  const errors = [];
  const warnings = [];

  const ledgerRows = [];
  const rawLedger = await readFile(ledgerPath, 'utf8');
  for (const [index, line] of rawLedger.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try { ledgerRows.push(JSON.parse(line)); } catch (error) { errors.push(`ledger line ${index + 1}: ${error.message}`); }
  }
  const outputs = new Map();
  for (const row of ledgerRows) {
    if (!row.output) { errors.push(`ledger row ${row.slug ?? '<unknown>'}: output required`); continue; }
    const prior = outputs.get(row.output);
    if (prior) errors.push(`duplicate ledger output: ${row.output}`);
    outputs.set(row.output, row);
    if (!await exists(join(root, row.output))) errors.push(`missing ledger output file: ${row.output}`);
  }

  const started = performance.now();
  const manifest = buildManifest(root);
  const buildMs = performance.now() - started;
  const byPath = new Map();
  const counts = {};
  for (const entry of manifest) {
    if (!entry.path || !entry.slug) errors.push(`manifest entry lacks path/slug: ${entry.path ?? '<unknown>'}`);
    if (byPath.has(entry.path)) errors.push(`duplicate manifest path: ${entry.path}`);
    byPath.set(entry.path, entry);
    counts[entry.type] = (counts[entry.type] ?? 0) + 1;
  }

  // A count printed beside another count is not certification. Prove the two
  // sets are identical in both directions so neither unindexed media nor dead
  // ledger rows can hide behind coincidentally equal totals.
  if (ledgerRows.length !== manifest.length) {
    errors.push(`ledger/manifest count mismatch: ${ledgerRows.length} != ${manifest.length}`);
  }
  for (const output of outputs.keys()) {
    if (!byPath.has(output)) errors.push(`ledger output absent from manifest: ${output}`);
  }
  for (const path of byPath.keys()) {
    if (!outputs.has(path)) errors.push(`manifest path absent from ledger: ${path}`);
  }
  if (buildMs > maxBuildMs) {
    errors.push(`manifest build ${Math.round(buildMs)}ms exceeds ${maxBuildMs}ms budget`);
  }

  const explicitNo = ledgerRows.filter((row) => (
    (row.harmonyVerified === 'no' || row.harmonyVerified === false)
    && row.output
    && byPath.has(row.output)
  ));
  for (const row of explicitNo) {
    if (byPath.get(row.output).harmonyVerified !== false) errors.push(`manifest lost failed harmony verdict: ${row.output}`);
  }
  const reviewCount = manifest.filter((entry) => entry.needsReview).length;
  if (reviewCount) errors.push(`${reviewCount} manifest entries are not playable/reviewed`);

  const grooves = manifest.filter((entry) => entry.type === 'groove');
  if (grooves.length < 8) errors.push(`only ${grooves.length} groove entries; require at least 8`);
  for (const groove of grooves) {
    if (!groove.feel) errors.push(`groove lacks visible feel identity: ${groove.path}`);
    if (!Number.isFinite(groove.bpm)) errors.push(`groove lacks bpm: ${groove.path}`);
  }

  const index = YAML.parse(await readFile(join(prefabRoot, 'index.yml'), 'utf8')) ?? {};
  const prefabCounts = { stacks: index.stacks?.length ?? 0, songs: index.songs?.length ?? 0 };
  if (prefabCounts.stacks < minStacks) errors.push(`only ${prefabCounts.stacks} prefab stacks; require ${minStacks}`);
  if (prefabCounts.songs < minSongs) errors.push(`only ${prefabCounts.songs} prefab songs; require ${minSongs}`);
  for (const kind of ['stacks', 'songs']) {
    const ids = new Set();
    for (const light of index[kind] ?? []) {
      if (!light?.id || ids.has(light.id)) { errors.push(`invalid/duplicate prefab ${kind} id: ${light?.id}`); continue; }
      ids.add(light.id);
      const path = join(prefabRoot, kind, `${light.id}.yml`);
      if (!await exists(path)) { errors.push(`missing prefab payload: ${kind}/${light.id}.yml`); continue; }
      const payload = YAML.parse(await readFile(path, 'utf8')) ?? {};
      if (payload.id !== light.id) errors.push(`prefab id mismatch: ${kind}/${light.id}`);
      try {
        if (kind === 'stacks') resolvePrefabStack(payload, manifest);
        else resolvePrefabSong(payload, manifest);
      } catch (error) {
        errors.push(`prefab ${kind}/${light.id} fails runtime hydration: ${error.message}`);
      }
      const refs = collectPrefabRefs(kind, payload);
      if (!refs.length) errors.push(`prefab has no playable refs: ${kind}/${light.id}`);
      for (const ref of refs) {
        let resolvedEntry = null;
        if (ref.path && !byPath.has(ref.path)) errors.push(`prefab ${kind}/${light.id} missing path: ${ref.path}`);
        else if (ref.path) resolvedEntry = byPath.get(ref.path);
        else if (ref.slug) {
          const matches = manifest.filter((entry) => entry.slug === ref.slug);
          if (matches.length !== 1) errors.push(`prefab ${kind}/${light.id} ambiguous slug: ${ref.slug}`);
          else [resolvedEntry] = matches;
        } else if (!ref.path && !ref.slug) errors.push(`prefab ${kind}/${light.id} ref lacks identity`);
        if (resolvedEntry?.needsReview) errors.push(`prefab ${kind}/${light.id} references unplayable material: ${resolvedEntry.path}`);
        if (resolvedEntry?.harmonyVerified === false && !SKIP_HARMONY.has(resolvedEntry.type)) {
          errors.push(`prefab ${kind}/${light.id} references failed harmony: ${resolvedEntry.path}`);
        }
      }
      if (kind === 'stacks' && Number(light.layerCount) !== refs.length) errors.push(`prefab stack count mismatch: ${light.id}`);
      if (kind === 'songs') {
        const sectionIds = new Set((payload.sections ?? []).map((section) => section.id));
        for (const item of payload.arrangement ?? []) {
          if (!sectionIds.has(item.section ?? item.sectionId)) errors.push(`prefab song ${light.id} arrangement has dead section`);
        }
        if (Number(light.sectionCount) !== sectionIds.size) errors.push(`prefab song count mismatch: ${light.id}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    counts: {
      ledger: ledgerRows.length,
      manifest: manifest.length,
      ...counts,
      explicitHarmonyFailures: explicitNo.length,
      needsReview: reviewCount,
      prefabStacks: prefabCounts.stacks,
      prefabSongs: prefabCounts.songs,
    },
    timings: { manifestBuildMs: Math.round(buildMs) },
    errors,
    warnings,
  };
}

async function main() {
  const report = await certifyProducerCatalog(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.valid) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
}
