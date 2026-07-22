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
const rest = argv.filter((a, i) => a !== '--port' && i !== portIdx + 1);
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
// m5-atom-idf5, not m5-atom. src/idf_component.yml declares `idf: '>=5.1'`, and
// the m5-atom env pins espressif32@6.5.0 (IDF 4.4.6) -- so that env cannot
// resolve dependencies at all and fails before compiling a single file
// ("Because project depends on idf (>=5.1) ... version solving failed").
// This pointed at the broken env, so the documented flash path did not work.
run('pio', ['run', '-e', 'm5-atom-idf5', '-t', 'upload', '--upload-port', port]);
console.log(`\n[flash] done → ${port}`);
