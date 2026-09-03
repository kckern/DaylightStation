#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const firmwareDir = path.join(here, '..');
const argv = process.argv.slice(2);
const portIndex = argv.indexOf('--port');
let port = portIndex >= 0 ? argv[portIndex + 1] : null;
const rest = portIndex >= 0
  ? argv.filter((arg, index) => arg !== '--port' && index !== portIndex + 1)
  : argv;
const src = rest[0] || process.env.DAYLIGHT_PRESSURE_MATS_CONFIG;
const id = rest[1] || '';
if (!src) {
  console.error('ERROR: pass pressure-mats.yml or set DAYLIGHT_PRESSURE_MATS_CONFIG.');
  process.exit(1);
}
if (!port) {
  const devices = readdirSync('/dev').filter((name) => /^cu\.(usbmodem|usbserial|wchusbserial|SLAB)/.test(name));
  if (devices.length !== 1) {
    console.error(`ERROR: expected one ESP serial port, found ${devices.length}: ${devices.join(', ') || '(none)'}. Pass --port.`);
    process.exit(1);
  }
  port = `/dev/${devices[0]}`;
}
const run = (command, args) => {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  execFileSync(command, args, { cwd: firmwareDir, stdio: 'inherit' });
};
run('node', ['tools/gen-config.mjs', src, ...(id ? [id] : [])]);
run('pio', ['run', '-e', 'trampletek-blue', '-t', 'upload', '--upload-port', port]);
console.log(`\n[flash] done -> ${port}`);
