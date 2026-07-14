#!/usr/bin/env node
// =============================================================================
// flash.mjs — regenerate config.h from vehicles.yml, then build + upload.
//
// Usage:
//   node tools/flash.mjs <path-to>/config/vehicles.yml [vehicle-id] [--port /dev/cu.xxx] [--env bench-esp32]
//   DAYLIGHT_VEHICLES_CONFIG=<path> node tools/flash.mjs [vehicle-id] [--port ...]
//
// Default env is the hardware target (freematics-oneplus-b). Port autodetects
// the first /dev/cu.usbserial-* if --port omitted (the Freematics' microUSB
// enumerates as a usb-serial bridge — VERIFY the exact name on arrival).
// =============================================================================
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const firmwareDir = path.join(__dirname, '..');

const argv = process.argv.slice(2);
const take = (flag) => {
  const i = argv.indexOf(flag);
  if (i === -1) return null;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
let port = take('--port');
const env = take('--env') || 'freematics-oneplus-b';
const src = argv[0] || process.env.DAYLIGHT_VEHICLES_CONFIG;
const vehicleId = argv[1] || '';

if (!src) { console.error('ERROR: pass vehicles.yml path or set DAYLIGHT_VEHICLES_CONFIG.'); process.exit(1); }

if (!port) {
  const dev = readdirSync('/dev').filter((f) => /^cu\.(usbserial|usbmodem|SLAB|wchusbserial)/.test(f));
  if (!dev.length) { console.error('ERROR: no /dev/cu.usb* found; pass --port.'); process.exit(1); }
  port = `/dev/${dev[0]}`;
}

const run = (cmd, args, opts = {}) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', cwd: firmwareDir, ...opts });
};

run('node', ['tools/gen-config.mjs', src, ...(vehicleId ? [vehicleId] : [])]);
run('pio', ['run', '-e', env, '-t', 'upload', '--upload-port', port]);
console.log(`\n[flash] done → ${port} (env=${env})`);
