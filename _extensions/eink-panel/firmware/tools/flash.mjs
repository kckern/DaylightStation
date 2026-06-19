#!/usr/bin/env node
// =============================================================================
// flash.mjs — build + flash the right firmware for a panel, driven by its SSOT.
//
// Reads `hardware.device` from the screen YAML, maps it to a PlatformIO env
// (which sets BOARD_SCREEN_COMBO + the EINK_* render profile), regenerates
// config.h from the same SSOT, then builds + uploads that env. So flashing any
// panel — whatever model — is one command:
//
//   node tools/flash.mjs <path-to>/screens/<panel>.yml [--port /dev/cu.xxx]
//
// Adding a new model = add an [env:<x>] in platformio.ini + an entry in DEVICE_ENV.
// =============================================================================
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FW = path.join(__dirname, '..');           // firmware/ (platformio project root)

// hardware.device (from the SSOT) -> platformio env name (platformio.ini)
const DEVICE_ENV = {
  'seeed-reterminal-e1003': 'e1003',   // 10.3" mono Gray16
  'seeed-reterminal-e1004': 'e1004',   // 13.3" Spectra-6 color
};

const args = process.argv.slice(2);
const ssot = args.find(a => !a.startsWith('--'));
const pi = args.indexOf('--port');
const port = pi >= 0 ? args[pi + 1] : null;
if (!ssot) {
  console.error('usage: node tools/flash.mjs <screens/<panel>.yml> [--port /dev/cu.xxx]');
  process.exit(1);
}

const cfg = yaml.load(readFileSync(ssot, 'utf8')) || {};
const device = cfg?.hardware?.device;
const env = DEVICE_ENV[device];
if (!env) {
  console.error(`ERROR: unsupported hardware.device "${device}" in ${ssot}`);
  console.error(`       known: ${Object.keys(DEVICE_ENV).join(', ')}`);
  console.error(`       (add an [env:<x>] in platformio.ini + a DEVICE_ENV entry)`);
  process.exit(1);
}

console.log(`[flash] ${cfg.screen}  device=${device}  -> env=${env}`);

// 1) generate config.h (bootstrap: wifi + host/port + panel id) from the SSOT
execFileSync('node', [path.join(__dirname, 'gen-config.mjs'), ssot], { stdio: 'inherit' });

// 2) build + upload the matching env
const pioArgs = ['run', '-e', env, '-t', 'upload'];
if (port) pioArgs.push('--upload-port', port);
console.log(`[flash] pio ${pioArgs.join(' ')}`);
const r = spawnSync('pio', pioArgs, { stdio: 'inherit', cwd: FW });
process.exit(r.status ?? 1);
