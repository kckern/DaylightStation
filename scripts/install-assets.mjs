#!/usr/bin/env node
// install:assets — fetch the third-party assets listed in assets.manifest.yml
// into <media>/vendor, verifying each against its pinned sha256. The backend
// serves that directory at /vendor. Idempotent: an entry whose file already
// matches is skipped. A failed entry aborts only that entry (exit 1 overall).
//
//   node scripts/install-assets.mjs [--media-dir DIR] [--only ID] [--check]
//
// --check writes nothing: it reports missing / mismatched entries and exits 1.
// Entries with `source.local` are owner-provided: never fetched, only checked.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_KINDS = ['url', 'npm', 'local'];

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export function resolveTarget(mediaDir, target) {
  if (!target || isAbsolute(target)) throw new Error(`target must be a relative path: ${target}`);
  const base = resolve(mediaDir, 'vendor');
  const full = resolve(base, target);
  if (full !== base && !full.startsWith(base + sep)) throw new Error(`target escapes media/vendor: ${target}`);
  return full;
}

export function validateManifest(manifest) {
  const assets = manifest?.assets;
  if (!Array.isArray(assets)) throw new Error('manifest must have an assets: list');
  const seen = new Set();
  for (const a of assets) {
    if (!a?.id) throw new Error('manifest entry without id');
    if (seen.has(a.id)) throw new Error(`duplicate manifest id: ${a.id}`);
    seen.add(a.id);
    if (!a.target) throw new Error(`${a.id}: missing target`);
    if (!/^[0-9a-f]{64}$/.test(a.sha256 || '')) throw new Error(`${a.id}: missing or malformed sha256`);
    const kinds = SOURCE_KINDS.filter((k) => a.source?.[k]);
    if (kinds.length !== 1) throw new Error(`${a.id}: source needs exactly one of ${SOURCE_KINDS.join('/')}`);
  }
  return assets;
}

function parseArgs(argv) {
  const o = { check: false, dotenv: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') o.check = true;
    else if (a === '--no-dotenv') o.dotenv = false;
    else if (['--media-dir', '--only', '--manifest', '--node-modules'].includes(a)) o[a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

function defaultMediaDir(useDotenv) {
  if (process.env.DAYLIGHT_MEDIA_PATH) return process.env.DAYLIGHT_MEDIA_PATH;
  let base = process.env.DAYLIGHT_BASE_PATH;
  if (!base && useDotenv && existsSync(join(ROOT, '.env'))) {
    const m = readFileSync(join(ROOT, '.env'), 'utf8').match(/^DAYLIGHT_BASE_PATH=(.+)$/m);
    if (m) base = m[1].trim().replace(/^["']|["']$/g, '');
  }
  return base ? join(base, 'media') : null;
}

async function fetchBytes(url) {
  if (url.startsWith('file://')) return readFileSync(fileURLToPath(url));
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function readNpm(spec, nodeModules) {
  const dirs = nodeModules ? [nodeModules] : [join(ROOT, 'node_modules'), join(ROOT, 'frontend', 'node_modules')];
  for (const d of dirs) {
    const p = join(d, spec);
    if (existsSync(p)) return readFileSync(p);
  }
  throw new Error(`npm source not found: ${spec} (run npm install)`);
}

function state(path, want) {
  if (!existsSync(path)) return 'missing';
  return sha256(readFileSync(path)) === want ? 'ok' : 'mismatch';
}

export async function runInstaller(argv, io = { out: console.log, err: console.error }) {
  let opts; let assets;
  try {
    opts = parseArgs(argv);
    const manifestPath = opts.manifest || join(ROOT, 'assets.manifest.yml');
    assets = validateManifest(yaml.load(readFileSync(manifestPath, 'utf8')));
  } catch (e) { io.err(`install:assets: ${e.message}`); return 2; }

  const mediaDir = opts.mediaDir || defaultMediaDir(opts.dotenv);
  if (!mediaDir) { io.err('install:assets: no media dir. Pass --media-dir or set DAYLIGHT_MEDIA_PATH.'); return 2; }

  if (opts.only) {
    assets = assets.filter((a) => a.id === opts.only);
    if (!assets.length) { io.err(`install:assets: no manifest entry with id "${opts.only}"`); return 1; }
  }

  let failed = 0;
  for (const a of assets) {
    try {
      const target = resolveTarget(mediaDir, a.target);
      const now = state(target, a.sha256);
      if (a.source.local) {
        if (now === 'ok') io.out(`ok       ${a.id} (owner-provided)`);
        else { io.out(`owner-provided ${a.id}: ${now === 'missing' ? 'missing' : 'sha mismatch'} at ${a.target} - ${a.source.local}`); if (opts.check) failed++; }
        continue;
      }
      if (now === 'ok') { io.out(`skip     ${a.id} (already installed)`); continue; }
      if (opts.check) { io.out(`${now === 'missing' ? 'missing ' : 'mismatch'} ${a.id} -> ${a.target}`); failed++; continue; }
      const bytes = a.source.url ? await fetchBytes(a.source.url) : readNpm(a.source.npm, opts.nodeModules);
      const got = sha256(bytes);
      if (got !== a.sha256) throw new Error(`sha256 mismatch (expected ${a.sha256}, got ${got})`);
      mkdirSync(dirname(target), { recursive: true });
      const tmp = `${target}.part`;
      writeFileSync(tmp, bytes);
      renameSync(tmp, target);
      io.out(`install  ${a.id} -> ${a.target}`);
    } catch (e) {
      failed++;
      io.err(`FAILED   ${a.id}: ${e.message}`);
      try { rmSync(`${resolveTarget(mediaDir, a.target)}.part`, { force: true }); } catch { /* nothing to clean */ }
    }
  }
  io.out(failed ? `install:assets: ${failed} problem(s)` : 'install:assets: OK');
  return failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runInstaller(process.argv.slice(2)).then((code) => process.exit(code));
}
