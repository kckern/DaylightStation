#!/usr/bin/env node
/**
 * Move issued school artifacts off the flat percent-encoded names and onto the
 * per-segment hierarchy the store already writes and reads.
 *
 * DRY RUN BY DEFAULT. It prints the plan and changes nothing until `--apply`,
 * because the thing being rearranged is a child's school record and the store's
 * whole contract is that an issued artifact is immutable, exact bytes.
 *
 * WHY THIS IS SAFE TO RUN AT ALL: the store has been dual-reading since
 * 70a13f537 — it tries the new path and falls back to the legacy flat one — so
 * artifacts resolve before, during, and after this. There is no window in which
 * a teacher link 404s, and stopping halfway leaves a working system.
 *
 * COPY, VERIFY, PARK — never move, never delete:
 *   1. COPY the legacy file to its new path (skip if already there).
 *   2. VERIFY by re-reading the copy and comparing its sha256 to the manifest's
 *      own recorded digest. A mismatch aborts that artifact and leaves the
 *      legacy file untouched; the store keeps serving it.
 *   3. PARK the legacy file under `data/_deleteme/` once its replacement is
 *      verified. Nothing is unlinked here — emptying `_deleteme/` is a human's
 *      decision, and it is the documented escape hatch in this repo.
 *
 * Ids are NOT rewritten. `out:ses_X` has crossed into the economy ledger, so
 * that history is frozen; only where the bytes live changes. New artifacts have
 * been minting clean ids since 1b9c39d8a — this is purely about the tail.
 *
 * Usage (inside the container, where the data volume is mounted):
 *   node scripts/school/migrate-issued-artifacts.mjs            # plan only
 *   node scripts/school/migrate-issued-artifacts.mjs --apply    # do it
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';

const APPLY = process.argv.includes('--apply');
const DATA = process.env.DAYLIGHT_DATA_DIR ?? 'data';
const ROOT = path.join(DATA, 'household/school/artifacts/issued');
const PARK = path.join(DATA, '_deleteme', `issued-flat-${new Date().toISOString().slice(0, 10)}`);

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The store's own mapping — kept identical to YamlIssuedArtifactStore#stem. */
const stem = (id) => id.split('/')
  .map((segment) => segment.replace(/[^A-Za-z0-9._-]/g, (ch) => encodeURIComponent(ch)))
  .join(path.sep);

const isFlatLegacy = (name) => name.includes('%2F');

async function main() {
  let entries;
  try {
    entries = await fs.readdir(ROOT);
  } catch (error) {
    console.error(`cannot read ${ROOT}: ${error.message}`);
    process.exit(1);
  }

  const manifests = entries.filter((n) => n.endsWith('.yml') && isFlatLegacy(n));
  if (!manifests.length) {
    console.log('nothing to migrate — no flat percent-encoded manifests found');
    return;
  }

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} · ${manifests.length} legacy artifact(s) under ${ROOT}\n`);
  let moved = 0; let skipped = 0; let failed = 0;

  for (const manifestName of manifests) {
    const artifactId = decodeURIComponent(manifestName.replace(/\.yml$/, ''));
    const legacyManifest = path.join(ROOT, manifestName);
    let manifest;
    try {
      manifest = yaml.load(await fs.readFile(legacyManifest, 'utf8'));
    } catch (error) {
      console.log(`  ✗ ${artifactId}\n      unreadable manifest: ${error.message}`);
      failed += 1;
      continue;
    }
    // Trust the manifest's own id over the filename: the filename is the thing
    // being corrected, so it is the less authoritative of the two.
    const id = manifest?.artifactId ?? artifactId;
    const extension = manifest?.representation?.extension ?? 'pdf';
    const legacyPayload = path.join(ROOT, `${encodeURIComponent(id)}.${extension}`);
    const newManifest = path.join(ROOT, `${stem(id)}.yml`);
    const newPayload = path.join(ROOT, `${stem(id)}.${extension}`);

    console.log(`  ${id}`);
    console.log(`      ${path.relative(ROOT, legacyPayload)}  ->  ${path.relative(ROOT, newPayload)}`);

    if (!APPLY) { skipped += 1; continue; }

    try {
      const bytes = await fs.readFile(legacyPayload);
      if (manifest?.sha256 && digest(bytes) !== manifest.sha256) {
        console.log('      ✗ SKIPPED — bytes do not match the manifest digest');
        failed += 1;
        continue;
      }
      await fs.mkdir(path.dirname(newPayload), { recursive: true });
      // COPY, then verify the copy independently before anything is parked.
      await fs.copyFile(legacyPayload, newPayload);
      await fs.copyFile(legacyManifest, newManifest);
      const check = await fs.readFile(newPayload);
      if (digest(check) !== digest(bytes)) {
        console.log('      ✗ SKIPPED — copy failed verification; legacy file left in place');
        failed += 1;
        continue;
      }
      await fs.mkdir(PARK, { recursive: true });
      await fs.rename(legacyPayload, path.join(PARK, path.basename(legacyPayload)));
      await fs.rename(legacyManifest, path.join(PARK, path.basename(legacyManifest)));
      console.log('      ✓ copied, verified, legacy parked');
      moved += 1;
    } catch (error) {
      console.log(`      ✗ ${error.message}`);
      failed += 1;
    }
  }

  console.log(`\n${APPLY ? `moved ${moved}` : `planned ${skipped}`} · failed ${failed}`);
  if (APPLY) console.log(`legacy files parked in ${PARK} (not deleted — empty it yourself)`);
  if (!APPLY) console.log('re-run with --apply to perform the migration');
  if (failed) process.exitCode = 1;
}

await main();
