#!/usr/bin/env node
//
// One-shot migration of history/automotive/ to the current write format.
//
//   node cli/automotive.cli.mjs migrate            # dry run — prints the plan
//   node cli/automotive.cli.mjs migrate --apply    # write it
//   node cli/automotive.cli.mjs migrate --apply --keep-legacy   # leave originals
//
// What it does, per vehicle:
//   • Day logs  — merges every YYYY-MM-DD.yml, re-buckets records by the
//     household-LOCAL day (they were keyed by UTC, so evening drives filed
//     under tomorrow), rewrites each ts to local ISO-with-offset.
//   • Trips     — converts flat trips/<device-id>.yml to keyed samples with a
//     derived summary, filed at trips/<YYYY-MM>/<YYYY-MM-DD>_<HHMM>_<id>.yml.
//     Sample-less trips are dropped (they carry nothing).
//   • Removes stray .DS_Store files Dropbox left behind.
//
// Conversion logic + tests: cli/automotive/lib.mjs, cli/automotive.cli.test.mjs
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import yaml from 'js-yaml';
import { parseArgv } from './_argv.mjs';
import { regroupByLocalDay, convertLegacyTrip } from './automotive/lib.mjs';
import { dumpTrip } from '#apps/hardware/automotiveRelay.mjs';
import { DEFAULT_TIMEZONE } from '#domains/core/utils/timezone.mjs';

const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.yml$/;

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });

async function resolveDataDir() {
  const base = process.env.DAYLIGHT_BASE_PATH;
  if (base) return path.join(base, 'data');
  const { getConfigService, initConfigService } = await import('#system/config/index.mjs');
  await initConfigService();
  return getConfigService().getDataDir();
}

async function resolveTimezone(dataDir) {
  try {
    const raw = await fs.readFile(path.join(dataDir, 'system', 'config', 'system.yml'), 'utf8');
    return yaml.load(raw)?.timezone || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

const readYaml = async (file) => {
  try { return yaml.load(await fs.readFile(file, 'utf8')); } catch { return null; }
};

async function migrateVehicle(vehicleDir, timezone, { apply, keepLegacy }) {
  const plan = { dayFilesRead: 0, dayFilesWritten: [], dayFilesRemoved: [], trips: [], dropped: [], junk: [] };
  const entries = await fs.readdir(vehicleDir, { withFileTypes: true });

  // ── Day logs ───────────────────────────────────────────────────────────────
  const legacyDays = entries.filter((e) => e.isFile() && DAY_FILE.test(e.name)).map((e) => e.name);
  const records = [];
  for (const name of legacyDays) {
    const doc = await readYaml(path.join(vehicleDir, name));
    if (Array.isArray(doc)) { records.push(...doc); plan.dayFilesRead += 1; }
  }

  if (records.length) {
    const grouped = regroupByLocalDay(records, timezone);
    for (const [day, list] of grouped) {
      const name = `${day}.yml`;
      plan.dayFilesWritten.push(`${name} (${list.length} records)`);
      if (apply) {
        await fs.writeFile(path.join(vehicleDir, name), yaml.dump(list, { noRefs: true, lineWidth: -1 }), 'utf8');
      }
    }
    const kept = new Set([...grouped.keys()].map((d) => `${d}.yml`));
    for (const name of legacyDays) {
      if (kept.has(name)) continue;
      plan.dayFilesRemoved.push(name);
      if (apply && !keepLegacy) await fs.rm(path.join(vehicleDir, name), { force: true });
    }
  }

  // ── Trips ──────────────────────────────────────────────────────────────────
  const tripsDir = path.join(vehicleDir, 'trips');
  let tripEntries = [];
  try { tripEntries = await fs.readdir(tripsDir, { withFileTypes: true }); } catch { /* no trips yet */ }

  for (const entry of tripEntries) {
    if (entry.isDirectory()) continue;                       // already-sharded months
    if (entry.name === '.DS_Store') { plan.junk.push(path.join('trips', entry.name)); continue; }
    if (!entry.name.endsWith('.yml')) continue;

    const legacyFile = path.join(tripsDir, entry.name);
    const doc = await readYaml(legacyFile);
    if (!doc?.meta) continue;

    const { trip, relPath, droppable } = convertLegacyTrip(doc, timezone);
    if (droppable) {
      plan.dropped.push(entry.name);
      if (apply && !keepLegacy) await fs.rm(legacyFile, { force: true });
      continue;
    }

    plan.trips.push(`${entry.name} → ${relPath} (${trip.meta.samples} samples, ecu=${trip.meta.ecu})`);
    if (apply) {
      const target = path.join(tripsDir, relPath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, dumpTrip(trip), 'utf8');
      if (!keepLegacy) await fs.rm(legacyFile, { force: true });
    }
  }

  // ── Stray sync artifacts ───────────────────────────────────────────────────
  for (const entry of entries) {
    if (entry.name === '.DS_Store') {
      plan.junk.push(entry.name);
      if (apply) await fs.rm(path.join(vehicleDir, entry.name), { force: true });
    }
  }
  for (const entry of tripEntries) {
    if (entry.name === '.DS_Store' && apply) {
      await fs.rm(path.join(tripsDir, entry.name), { force: true });
    }
  }

  return plan;
}

async function main() {
  const { subcommand, flags, help } = parseArgv(process.argv.slice(2));
  if (help || subcommand !== 'migrate') {
    console.log('usage: node cli/automotive.cli.mjs migrate [--apply] [--keep-legacy] [--root <dir>]');
    process.exit(help ? 0 : 1);
  }

  const apply = Boolean(flags.apply);
  const keepLegacy = Boolean(flags['keep-legacy']);
  const dataDir = await resolveDataDir();
  const timezone = await resolveTimezone(dataDir);
  const root = flags.root
    ? String(flags.root)
    : path.join(dataDir, 'household', 'history', 'automotive');

  console.log(`root:     ${root}`);
  console.log(`timezone: ${timezone}`);
  console.log(`mode:     ${apply ? 'APPLY' : 'dry run (pass --apply to write)'}\n`);

  let vehicles = [];
  try {
    vehicles = (await fs.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory());
  } catch {
    console.error(`no automotive history at ${root}`);
    process.exit(1);
  }

  for (const vehicle of vehicles) {
    const plan = await migrateVehicle(path.join(root, vehicle.name), timezone, { apply, keepLegacy });
    console.log(`── ${vehicle.name} ─────────────────────────────`);
    console.log(`  day logs:  ${plan.dayFilesRead} read → ${plan.dayFilesWritten.length} written`);
    plan.dayFilesWritten.forEach((l) => console.log(`    + ${l}`));
    plan.dayFilesRemoved.forEach((l) => console.log(`    - ${l} (misdated by UTC key)`));
    console.log(`  trips:     ${plan.trips.length} converted, ${plan.dropped.length} dropped as empty`);
    plan.trips.forEach((l) => console.log(`    + ${l}`));
    if (plan.dropped.length) console.log(`    - ${plan.dropped.join(', ')}`);
    if (plan.junk.length) console.log(`  junk:      ${plan.junk.join(', ')}`);
    console.log('');
  }

  if (!apply) console.log('Nothing written. Re-run with --apply.');
}

main().catch((err) => { console.error(err); process.exit(1); });
