#!/usr/bin/env node
// retroarch-overrides.cli.mjs — sync every RetroArch game's override file on the
// Shield from household config, in one pass.
//
// What it owns: the `savestate_auto_load` line of
// `<config_dir>/<core_name>/<rom basename>.cfg`, set from catalog.yml
// `overrides["<console>/<game>"].resume` (absent = false). Other keys in those
// files are preserved. The same write also happens per game just before each
// launch (LaunchService prepareLaunch); this CLI is the bulk version.
//
// Config (data volume):
//   household/gaming/games.yml            launch.game_overrides.{device,config_dir}, consoles.<id>.core_name
//   household/gaming/retroarch/catalog.yml games + overrides
//   household/hardware/devices.yml        <device>.content_control.fallback (adb host/port)
//
// Run where adb and the data volume both exist — inside the container:
//   sudo docker exec daylight-station node cli/retroarch-overrides.cli.mjs plan
//   sudo docker exec daylight-station node cli/retroarch-overrides.cli.mjs sync
// Flags: --data <dir> (default ./data), --force (sync even if RetroArch is running)

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { parseArgv } from './_argv.mjs';
import { AdbAdapter } from '../__backend/src/1_adapters/devices/AdbAdapter.mjs';
import {
  planRetroArchGameOverrides,
  syncRetroArchGameOverrides,
} from '../__capabilities/content-catalog/server/composition/retroarch-overrides.mjs';

const quietLogger = { debug() {}, info() {}, warn() {}, error() {} };

function readYaml(file) {
  return yaml.load(readFileSync(file, 'utf8')) || {};
}

export function loadOverrideInputs(dataDir) {
  const household = path.join(dataDir, 'household');
  const config = readYaml(path.join(household, 'gaming/games.yml'));
  const catalog = readYaml(path.join(household, 'gaming/retroarch/catalog.yml'));
  const devices = readYaml(path.join(household, 'hardware/devices.yml'))?.devices || {};
  return { config, catalog, devices };
}

function usage() {
  console.log(`Usage: node cli/retroarch-overrides.cli.mjs <plan|sync> [--data <dir>] [--force]

  plan   list every game, its override path and resume value (no device access)
  sync   write any override whose savestate_auto_load differs from config`);
}

async function main(argv) {
  const { subcommand, flags, help } = parseArgv(argv);
  if (help || !['plan', 'sync'].includes(subcommand)) { usage(); return subcommand ? 1 : 0; }

  const dataDir = typeof flags.data === 'string' ? flags.data : 'data';
  const { config, catalog, devices } = loadOverrideInputs(dataDir);
  const { plans, skipped } = planRetroArchGameOverrides({ config, catalog });

  for (const s of skipped) console.log(`SKIP   ${s.consoleId}/${s.gameId}  (${s.reason})`);

  if (subcommand === 'plan') {
    for (const p of plans) console.log(`${p.resume ? 'RESUME' : 'fresh '} ${p.consoleId}/${p.gameId}  ${p.path}`);
    console.log(`\n${plans.length} games planned, ${plans.filter((p) => p.resume).length} resume, ${skipped.length} skipped`);
    return skipped.length ? 1 : 0;
  }

  const deviceId = config?.launch?.game_overrides?.device;
  const fallback = devices?.[deviceId]?.content_control?.fallback;
  if (!deviceId || fallback?.provider !== 'adb' || !fallback.host) {
    console.error(`No ADB endpoint: games.yml launch.game_overrides.device=${deviceId ?? '(unset)'} has no adb fallback`);
    return 1;
  }

  const adb = new AdbAdapter({ host: fallback.host, port: fallback.port }, { logger: quietLogger });
  const conn = await adb.connect();
  if (!conn.ok) { console.error(`adb connect failed: ${conn.error}`); return 1; }

  const pkg = config?.launch?.package;
  if (pkg && !flags.force && await adb.isProcessRunning(pkg)) {
    console.error(`${pkg} is running — refusing (a game may be in progress). Re-run when it has exited, or pass --force.`);
    return 1;
  }

  const { results } = await syncRetroArchGameOverrides({
    shell: (script) => adb.shellArgv(script), config, catalog, logger: quietLogger,
  });
  for (const r of results) {
    console.log(`${r.status.padEnd(9)} ${r.resume ? 'RESUME' : 'fresh '} ${r.consoleId}/${r.gameId}  ${r.path}${r.error ? `  ${r.error}` : ''}`);
  }
  const failed = results.filter((r) => r.status === 'failed').length;
  const written = results.filter((r) => r.status === 'written').length;
  console.log(`\n${results.length} games: ${written} written, ${results.length - written - failed} unchanged, ${failed} failed, ${skipped.length} skipped`);
  return failed || skipped.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
