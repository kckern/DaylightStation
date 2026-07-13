#!/usr/bin/env node
// =============================================================================
// flash.mjs — regenerate config.h from ir-blasters.yml, then build + upload.
//
// Usage:
//   node tools/flash.mjs <path-to>/config/ir-blasters.yml [blaster-id] [--port /dev/cu.xxx]
//   DAYLIGHT_IR_CONFIG=<path> node tools/flash.mjs [blaster-id] [--port ...]
//
// Port autodetects the first /dev/cu.usbserial-* if --port is omitted.
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
const src = rest[0] || process.env.DAYLIGHT_IR_CONFIG;
const blasterId = rest[1] || '';

if (!src) { console.error('ERROR: pass ir-blasters.yml path or set DAYLIGHT_IR_CONFIG.'); process.exit(1); }

if (!port) {
  const dev = readdirSync('/dev').filter((f) => /^cu\.usbserial-/.test(f));
  if (!dev.length) { console.error('ERROR: no /dev/cu.usbserial-* found; pass --port.'); process.exit(1); }
  port = `/dev/${dev[0]}`;
}

const run = (cmd, args, opts = {}) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', cwd: firmwareDir, ...opts });
};

run('node', ['tools/gen-config.mjs', src, ...(blasterId ? [blasterId] : [])]);
run('pio', ['run', '-e', 'm5-atom', '-t', 'upload', '--upload-port', port]);
console.log(`\n[flash] done → ${port}`);
