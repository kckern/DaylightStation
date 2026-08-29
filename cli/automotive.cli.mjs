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
import { regroupByLocalDay, convertLegacyTrip, repairTelemetryDocument } from './automotive/lib.mjs';
import { encodeAutomotiveTrip } from '#adapters/hardware/automotive/YamlAutomotiveTripStore.mjs';
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
      await fs.writeFile(target, encodeAutomotiveTrip(trip), 'utf8');
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

async function listYamlFiles(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listYamlFiles(file));
    else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) out.push(file);
  }
  return out;
}

async function repairTelemetry(root, dataDir, { apply }) {
  const files = await listYamlFiles(root);
  const total = { files: 0, odometers: 0, saturatedDistances: 0, invalidVins: 0, duplicateTrips: 0 };
  const changes = [];

  for (const file of files) {
    const before = await readYaml(file);
    if (before == null) continue;
    const { document, stats } = repairTelemetryDocument(before);
    const changed = Object.values(stats).some((n) => n > 0);
    if (!changed) continue;
    total.files += 1;
    for (const key of Object.keys(stats)) total[key] += stats[key];
    changes.push({ file, document, stats });
  }

  let backup = null;
  if (apply && changes.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backup = path.join(dataDir, '_backups', 'automotive', stamp);
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.cp(root, backup, { recursive: true, errorOnExist: true });
    for (const { file, document } of changes) {
      const temp = `${file}.repair-${process.pid}.tmp`;
      await fs.writeFile(temp, yaml.dump(document, { noRefs: true, lineWidth: -1 }), 'utf8');
      await fs.rename(temp, file);
    }
  }
  return { total, backup };
}

async function main() {
  const { subcommand, flags, help } = parseArgv(process.argv.slice(2));
  if (help || !['migrate', 'repair-telemetry'].includes(subcommand)) {
    console.log('usage: node cli/automotive.cli.mjs <migrate|repair-telemetry> [--apply] [--keep-legacy] [--root <dir>] [--data-dir <dir>]');
    process.exit(help ? 0 : 1);
  }

  const apply = Boolean(flags.apply);
  const keepLegacy = Boolean(flags['keep-legacy']);
  const explicitRoot = flags.root ? path.resolve(String(flags.root)) : null;
  const dataDir = flags['data-dir']
    ? path.resolve(String(flags['data-dir']))
    : (explicitRoot ? path.resolve(explicitRoot, '..', '..', '..') : await resolveDataDir());
  const timezone = await resolveTimezone(dataDir);
  const root = explicitRoot
    ? explicitRoot
    : path.join(dataDir, 'household', 'automotive', 'log');

  console.log(`root:     ${root}`);
  console.log(`timezone: ${timezone}`);
  console.log(`mode:     ${apply ? 'APPLY' : 'dry run (pass --apply to write)'}\n`);

  if (subcommand === 'repair-telemetry') {
    const { total, backup } = await repairTelemetry(root, dataDir, { apply });
    console.log(`files changed:       ${total.files}`);
    console.log(`odometers corrected: ${total.odometers}`);
    console.log(`saturated distances: ${total.saturatedDistances}`);
    console.log(`invalid VINs removed:${total.invalidVins}`);
    console.log(`duplicate trip refs: ${total.duplicateTrips}`);
    if (backup) console.log(`backup:              ${backup}`);
    if (!apply) console.log('Nothing written. Re-run with --apply; a full backup is created first.');
    return;
  }

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
