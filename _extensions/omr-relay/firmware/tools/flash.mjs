#!/usr/bin/env node
// =============================================================================
// flash.mjs — regenerate config.h from omr-readers.yml, then build + upload.
//
// Usage:
//   node tools/flash.mjs <dataDir>/household/hardware/omr/readers.yml [reader-id] [--port /dev/cu.xxx]
//   DAYLIGHT_OMR_CONFIG=<path> node tools/flash.mjs [reader-id] [--port ...]
//
// Port autodetects the first /dev/cu.usbserial-* if --port omitted.
// (The ATOM Lite enumerates via its CH9102/CP210x USB-serial bridge.)
// =============================================================================
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const firmwareDir = path.join(__dirname, '..');

const argv = process.argv.slice(2);
const portIdx = argv.indexOf('--port');
let port = portIdx !== -1 ? argv[portIdx + 1] : null;
// Drop `--port` and its value, keeping the positionals. Guard on portIdx !== -1:
// when --port is absent indexOf returns -1, and a naive `i !== portIdx + 1`
// filters out index 0 — silently eating the config path so gen-config received
// the reader id as its filename and died on ENOENT.
const rest = portIdx === -1 ? argv : argv.filter((_, i) => i !== portIdx && i !== portIdx + 1);
const src = rest[0] || process.env.DAYLIGHT_OMR_CONFIG;
const readerId = rest[1] || '';

if (!src) { console.error('ERROR: pass omr-readers.yml path or set DAYLIGHT_OMR_CONFIG.'); process.exit(1); }

if (!port) {
  // M5 boards enumerate under several bridge drivers depending on the chip and
  // which dext is installed: CH9102/CH340 → cu.usbserial-* or cu.wchusbserial-*,
  // CP210x → cu.SLAB_USBtoUART, native S3 USB → cu.usbmodem*.
  const PORT_RE = /^cu\.(usbserial|wchusbserial|SLAB_USBtoUART|usbmodem)/;
  const dev = readdirSync('/dev').filter((f) => PORT_RE.test(f));
  if (!dev.length) {
    console.error('ERROR: no USB-serial device found under /dev/cu.*; pass --port.');
    process.exit(1);
  }
  if (dev.length > 1) console.warn(`[flash] multiple ports found (${dev.join(', ')}); using ${dev[0]} — pass --port to choose.`);
  port = `/dev/${dev[0]}`;
}

const run = (cmd, args, opts = {}) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', cwd: firmwareDir, ...opts });
};

run('node', ['tools/gen-config.mjs', src, ...(readerId ? [readerId] : [])]);
run('pio', ['run', '-e', 'm5-atom', '-t', 'upload', '--upload-port', port]);
console.log(`\n[flash] done → ${port}`);
