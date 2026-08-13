#!/usr/bin/env node
// =============================================================================
// flash.mjs — regenerate config.h from scales.yml, then build + upload firmware.
//
// Usage:
//   node tools/flash.mjs <path-to>/config/scales.yml [scale-id] [--port /dev/cu.xxx]
//   DAYLIGHT_SCALES_CONFIG=<path> node tools/flash.mjs [scale-id] [--port ...]
//
// Port autodetects the first /dev/cu.usbserial-* (FTDI) if --port omitted.
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
// Drop the `--port <dev>` pair, but ONLY when it is actually present. This used
// to be `filter((a, i) => a !== '--port' && i !== portIdx + 1)`, and with no
// --port flag portIdx is -1, so `portIdx + 1` is 0 and it silently ate argv[0] —
// the scales.yml path. Every invocation in the README (none of which pass
// --port) then ran `gen-config.mjs <scale-id>` with the id in the path slot and
// died on ENOENT. Fixed 2026-08-12, first time the documented path was run.
const rest = portIdx === -1 ? argv : argv.filter((_, i) => i !== portIdx && i !== portIdx + 1);
const src = rest[0] || process.env.DAYLIGHT_SCALES_CONFIG;
const scaleId = rest[1] || '';

if (!src) { console.error('ERROR: pass scales.yml path or set DAYLIGHT_SCALES_CONFIG.'); process.exit(1); }

if (!port) {
  const dev = readdirSync('/dev').filter((f) => /^cu\.usbserial-/.test(f));
  if (!dev.length) { console.error('ERROR: no /dev/cu.usbserial-* found; pass --port.'); process.exit(1); }
  port = `/dev/${dev[0]}`;
}

const run = (cmd, args, opts = {}) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', cwd: firmwareDir, ...opts });
};

run('node', ['tools/gen-config.mjs', src, ...(scaleId ? [scaleId] : [])]);
// `m5-atom` is the ONLY env platformio.ini defines. This said `m5-atom-idf5` for
// six days after that env was deleted, so the documented flash path failed
// outright — `pio` exits "Unknown environment names". The idf5 env existed for
// the Bluedroid/Classic build; it went with the DS6878, along with the
// src/idf_component.yml (`idf: '>=5.1'`) that was the reason to prefer it over
// this one. Nothing here needs ESP-IDF 5 any more: NimBLE 1.4.x wants Arduino
// core 2.x, which is what espressif32@6.5.0 pins.
run('pio', ['run', '-e', 'm5-atom', '-t', 'upload', '--upload-port', port]);
console.log(`\n[flash] done → ${port}`);
