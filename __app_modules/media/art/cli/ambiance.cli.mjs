#!/usr/bin/env node
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import yaml from 'js-yaml';
import { auditAmbianceLibrary } from './ambianceAudit.mjs';
import { extractCollection, buildHarvestItems } from './collectionHarvest.mjs';
import { scanLibrary, importHarvest, downloadHarvest } from './harvestFiles.mjs';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const { values } = parseArgs({ args, options: {
    html: { type: 'string' }, inventory: { type: 'string', multiple: true },
    existing: { type: 'string' }, destination: { type: 'string' }, output: { type: 'string' },
    manifest: { type: 'string' }, cache: { type: 'string' }, 'allow-write': { type: 'boolean' },
    concurrency: { type: 'string' },
    catalog: { type: 'string' }, profile: { type: 'string' }, playlist: { type: 'string' }, 'art-root': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help || command === 'help' || !command) {
    process.stdout.write(`art-ambiance commands:\n  audit --catalog YAML --profile NAME --playlist JSON --art-root DIR [--output JSON]\n  harvest-plan --html FILE --inventory JSON [--inventory JSON] --existing DIR [--output JSON]\n  harvest-download --manifest JSON --cache DIR --allow-write [--concurrency 4] [--output JSON]\n  harvest-import --manifest JSON --cache DIR --existing DIR --destination DIR --allow-write [--output JSON]\n\nAudit playlist JSON: { "trackIds": ["source:recording-id"] }. Art IDs are relative to --art-root.\n`);
    return;
  }
  let result;
  if (command === 'harvest-plan') {
    if (!values.html || !values.inventory?.length || !values.existing) throw new Error('harvest-plan requires --html, --inventory and --existing');
    const collection = extractCollection(await readFile(values.html, 'utf8'));
    if (!collection.url) throw new Error('Saved HTML has no canonical collection URL');
    const products = new Map();
    for (const file of values.inventory) {
      const data = JSON.parse(await readFile(file, 'utf8'));
      for (const product of data.products || []) products.set(String(product.id), product);
    }
    const visible = new Set([...products.values()].map((product) => product.handle));
    const missingVisible = collection.visibleHandles.filter((handle) => !visible.has(handle));
    if (missingVisible.length || (collection.expectedCount && products.size < collection.expectedCount)) throw new Error(`Incomplete inventory: ${products.size}/${collection.expectedCount}; ${missingVisible.length} visible works missing`);
    const items = buildHarvestItems([...products.values()], await scanLibrary(values.existing), new URL(collection.url).origin);
    result = { version: 1, collection, inventoryCount: products.size, items,
      counts: items.reduce((counts, item) => ({ ...counts, [item.status]: (counts[item.status] || 0) + 1 }), {}) };
  } else if (command === 'harvest-download') {
    if (!values.manifest || !values.cache) throw new Error('harvest-download requires --manifest and --cache');
    result = await downloadHarvest({ manifest: JSON.parse(await readFile(values.manifest, 'utf8')), cacheDir: values.cache,
      allowWrite: values['allow-write'] === true, concurrency: Number(values.concurrency || 4),
      onProgress: (progress) => { if (progress.completed % 25 === 0 || progress.completed === progress.total) process.stderr.write(JSON.stringify(progress) + '\n'); },
    });
  } else if (command === 'harvest-import') {
    if (!values.manifest || !values.cache || !values.existing || !values.destination) throw new Error('harvest-import requires --manifest, --cache, --existing and --destination');
    result = await importHarvest({ manifest: JSON.parse(await readFile(values.manifest, 'utf8')), cacheDir: values.cache,
      existingRoot: values.existing, destination: path.resolve(values.destination), allowWrite: values['allow-write'] === true });
  } else if (command === 'audit') {
    if (!values.catalog || !values.profile || !values.playlist || !values['art-root']) throw new Error('audit requires --catalog, --profile, --playlist and --art-root');
    result = await auditAmbianceLibrary({ catalog: yaml.load(await readFile(values.catalog, 'utf8')), profile: values.profile,
      trackIds: JSON.parse(await readFile(values.playlist, 'utf8')).trackIds,
      artRoot: values['art-root'] });
  } else throw new Error('Unknown command; use art-ambiance help');
  const text = JSON.stringify(result, null, 2) + '\n';
  if (values.output) await writeFile(values.output, text);
  process.stdout.write(JSON.stringify({ output: values.output || null, ...(result.ok === undefined ? {} : { ok: result.ok }), counts: result.counts || { imported: result.imported, duplicates: result.duplicates, skipped: result.skipped, downloaded: result.downloaded, cached: result.cached, errors: result.errors?.length } }) + '\n');
  if (result.errors?.length || result.ok === false) process.exitCode = 1;
}

main().catch((err) => { process.stderr.write(JSON.stringify({ error: err.message }) + '\n'); process.exitCode = 1; });
