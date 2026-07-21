#!/usr/bin/env node
// =============================================================================
// flash.mjs — regenerate config.h from barcode-relay.yml, then build + upload.
//
// Usage:
//   node tools/flash.mjs <path-to>/config/barcode-relay.yml [relay-id] [--port /dev/cu.xxx]
//   DAYLIGHT_BARCODE_CONFIG=<path> node tools/flash.mjs [relay-id] [--port ...]
//
// Port autodetects the first /dev/cu.usbserial-* if --port omitted.
// =============================================================================
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const firmwareDir = path.join(__dirname, '..');

const argv = process.argv.slice(2);
let port = null;
const rest = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--port') {
    port = argv[i + 1] || null;
    i += 1;
    continue;
  }
  rest.push(argv[i]);
}
const src = rest[0] || process.env.DAYLIGHT_BARCODE_CONFIG;
const relayId = rest[1] || '';

if (!src) {
  console.error('ERROR: pass barcode-relay.yml path or set DAYLIGHT_BARCODE_CONFIG.');
  process.exit(1);
}

if (!port) {
  const dev = readdirSync('/dev').filter((f) => /^cu\.usbserial-/.test(f));
  if (!dev.length) {
    console.error('ERROR: no /dev/cu.usbserial-* found; pass --port.');
    process.exit(1);
  }
  port = `/dev/${dev[0]}`;
}

const run = (cmd, args, opts = {}) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', cwd: firmwareDir, ...opts });
};

run('node', ['tools/gen-config.mjs', src, ...(relayId ? [relayId] : [])]);
run('pio', ['run', '-e', 'm5-atom', '-t', 'upload', '--upload-port', port]);
console.log(`\n[flash] done → ${port}`);
