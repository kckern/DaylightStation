#!/usr/bin/env node
// =============================================================================
// fetch-libs.mjs — vendor the FreematicsPlus Arduino library into firmware/lib/.
//
// The library lives in a subfolder of the vendor monorepo (not a PlatformIO
// registry package), so we shallow-clone and copy just that folder. The result
// (lib/FreematicsPlus/) is gitignored; re-run any time.
//
// Usage: node tools/fetch-libs.mjs [--ref master]
// =============================================================================
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/stanleyhuangyc/Freematics.git';
const SUBDIR = 'libraries/FreematicsPlus';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const destDir = path.join(__dirname, '..', 'lib', 'FreematicsPlus');

const argv = process.argv.slice(2);
const refIdx = argv.indexOf('--ref');
const ref = refIdx !== -1 ? argv[refIdx + 1] : 'master';

const scratch = path.join(tmpdir(), `freematics-${Date.now()}`);
console.log(`[fetch-libs] shallow-cloning ${REPO}@${ref} …`);
execFileSync('git', ['clone', '--depth', '1', '--branch', ref, '--filter=blob:none', '--sparse', REPO, scratch], { stdio: 'inherit' });
execFileSync('git', ['-C', scratch, 'sparse-checkout', 'set', SUBDIR], { stdio: 'inherit' });

const srcDir = path.join(scratch, SUBDIR);
if (!existsSync(srcDir)) {
  console.error(`ERROR: ${SUBDIR} not found in vendor repo (layout changed?).`);
  process.exit(1);
}
rmSync(destDir, { recursive: true, force: true });
mkdirSync(path.dirname(destDir), { recursive: true });
cpSync(srcDir, destDir, { recursive: true });
rmSync(scratch, { recursive: true, force: true });

const sha = execFileSync('git', ['ls-remote', REPO, ref]).toString().slice(0, 12);
console.log(`[fetch-libs] -> ${destDir} (${ref} @ ${sha})`);
console.log('[fetch-libs] hardware env ready: pio run -e freematics-oneplus-b');
