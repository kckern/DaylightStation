#!/usr/bin/env node
/**
 * prepare-public-assets — derive the generated, gitignored frontend assets.
 *
 * Runs as the frontend `prebuild` hook (and by hand: `npm run prepare:assets`
 * in frontend/). Nothing it writes is tracked; every output is rebuilt from an
 * npm package already in the lockfile, or synthesised with ffmpeg:
 *
 *   wasm   @tensorflow/tfjs-backend-wasm/dist/*.wasm  -> public/
 *   shaka  shaka-player compiled bundle                -> public/crt-lab/vendor/shaka.js
 *   flags  flag-icons 4x3 SVGs (codes in flag-codes.json) -> geography/flags/
 *   icons  @iconify-json/solar via icons.manifest.json -> piano ui/icons/svg/generated/
 *   media  ffmpeg testsrc2/smptebars clips             -> crt-lab/media, filter-poc
 *
 * Failure policy: a missing npm package is always fatal (the build would ship a
 * blank registry). A missing ffmpeg only warns, unless PREPARE_ASSETS_STRICT=1
 * (the Dockerfile sets it): a dev box without ffmpeg can still build.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FRONTEND_ROOT = resolve(HERE, '..');
export const REPO_ROOT = resolve(FRONTEND_ROOT, '..');

export const PATHS = {
  wasmNames: ['tfjs-backend-wasm.wasm', 'tfjs-backend-wasm-simd.wasm', 'tfjs-backend-wasm-threaded-simd.wasm'],
  publicDir: 'frontend/public',
  shaka: 'frontend/public/crt-lab/vendor/shaka.js',
  crtMedia: 'frontend/public/crt-lab/media',
  filterClip: 'frontend/public/filter-poc/clip.webm',
  flagsDir: '__app_modules/learning/school/browser/geography/flags',
  flagCodes: '__app_modules/learning/school/browser/geography/flag-codes.json',
  iconsDir: '__app_modules/learning/piano/browser/ui/icons',
};

const defaultLog = (level, event, data) => {
  // CLI-only sink: the structured browser logger does not exist in a build script.
  process.stderr.write(`[prepare-assets] ${level} ${event} ${JSON.stringify(data ?? {})}\n`);
};

export class PrepareError extends Error {}

function ensureDir(file) {
  mkdirSync(dirname(file), { recursive: true });
}

function copyIfChanged(from, to) {
  if (!existsSync(from)) throw new PrepareError(`source missing: ${from}`);
  if (existsSync(to) && statSync(to).size === statSync(from).size
    && readFileSync(to).equals(readFileSync(from))) return false;
  ensureDir(to);
  copyFileSync(from, to);
  return true;
}

function pkgDir(frontendRoot, name) {
  const req = createRequire(join(frontendRoot, 'package.json'));
  try {
    return dirname(req.resolve(`${name}/package.json`));
  } catch {
    // Some packages (shaka-player) do not export package.json.
    const dir = join(frontendRoot, 'node_modules', name);
    if (existsSync(join(dir, 'package.json'))) return dir;
    throw new PrepareError(`npm package not installed: ${name} (run npm ci in frontend/)`);
  }
}

export function prepareWasm({ frontendRoot = FRONTEND_ROOT } = {}) {
  const dist = join(pkgDir(frontendRoot, '@tensorflow/tfjs-backend-wasm'), 'dist');
  return PATHS.wasmNames.map((n) => {
    const to = join(frontendRoot, 'public', n);
    copyIfChanged(join(dist, n), to);
    return to;
  });
}

export function prepareShaka({ frontendRoot = FRONTEND_ROOT } = {}) {
  const from = join(pkgDir(frontendRoot, 'shaka-player'), 'dist', 'shaka-player.compiled.js');
  const to = join(frontendRoot, 'public', 'crt-lab', 'vendor', 'shaka.js');
  copyIfChanged(from, to);
  return [to];
}

export function prepareFlags({ repoRoot = REPO_ROOT, frontendRoot = FRONTEND_ROOT } = {}) {
  const codes = JSON.parse(readFileSync(join(repoRoot, PATHS.flagCodes), 'utf8'));
  const src = join(pkgDir(frontendRoot, 'flag-icons'), 'flags', '4x3');
  return codes.map((iso) => {
    const to = join(repoRoot, PATHS.flagsDir, `${iso}.svg`);
    copyIfChanged(join(src, `${iso}.svg`), to);
    return to;
  });
}

/** Render one manifest row to a standalone 1em currentColor SVG. */
export function renderIcon(entry, solar) {
  const icon = solar.icons[entry.solar];
  if (!icon) throw new PrepareError(`solar icon not found: ${entry.solar}`);
  const w = icon.width ?? solar.width ?? 24;
  const h = icon.height ?? solar.height ?? 24;
  const body = entry.mirror ? `<g transform="translate(${w} 0) scale(-1 1)">${icon.body}</g>` : icon.body;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

export function prepareIcons({ repoRoot = REPO_ROOT, frontendRoot = FRONTEND_ROOT } = {}) {
  const manifest = JSON.parse(readFileSync(join(repoRoot, PATHS.iconsDir, 'icons.manifest.json'), 'utf8'));
  const solarPath = join(pkgDir(frontendRoot, '@iconify-json/solar'), 'icons.json');
  const solar = JSON.parse(readFileSync(solarPath, 'utf8'));
  const outDir = join(repoRoot, PATHS.iconsDir, 'svg', 'generated');
  rmSync(outDir, { recursive: true, force: true }); // drop icons removed from the manifest
  mkdirSync(outDir, { recursive: true });
  return Object.entries(manifest.icons).map(([id, entry]) => {
    const to = join(outDir, `${id}.svg`);
    writeFileSync(to, renderIcon(entry, solar));
    return to;
  });
}

function haveFfmpeg(ffmpeg) {
  return spawnSync(ffmpeg, ['-version'], { stdio: 'ignore' }).status === 0;
}

const MEDIA = (root) => [
  {
    out: join(root, PATHS.crtMedia, 'testcard-480.mp4'),
    args: ['-f', 'lavfi', '-i', 'smptebars=size=640x480:rate=25', '-t', '8', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '30', '-movflags', '+faststart'],
  },
  {
    out: join(root, PATHS.crtMedia, 'motion-480.mp4'),
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=25', '-t', '8', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '30', '-movflags', '+faststart'],
  },
  {
    out: join(root, PATHS.filterClip),
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=192x108:rate=8', '-t', '20', '-pix_fmt', 'yuv420p', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40'],
  },
];

export function prepareMedia({ repoRoot = REPO_ROOT, ffmpeg = 'ffmpeg', strict = false, log = defaultLog } = {}) {
  if (!haveFfmpeg(ffmpeg)) {
    if (strict) throw new PrepareError('ffmpeg not found (required: PREPARE_ASSETS_STRICT=1)');
    log('warn', 'prepare-assets.media.skipped', { reason: 'ffmpeg-missing' });
    return [];
  }
  return MEDIA(repoRoot).map(({ out, args }) => {
    if (existsSync(out) && statSync(out).size > 0) return out;
    ensureDir(out);
    const r = spawnSync(ffmpeg, ['-y', '-v', 'error', ...args, out], { encoding: 'utf8' });
    if (r.status !== 0) {
      rmSync(out, { force: true });
      throw new PrepareError(`ffmpeg failed for ${out}: ${r.stderr}`);
    }
    return out;
  });
}

const STEPS = { wasm: prepareWasm, shaka: prepareShaka, flags: prepareFlags, icons: prepareIcons, media: prepareMedia };

export function prepareAll({ only, strict = process.env.PREPARE_ASSETS_STRICT === '1', log = defaultLog, ...opts } = {}) {
  const result = {};
  for (const [name, fn] of Object.entries(STEPS)) {
    if (only && !only.includes(name)) continue;
    const files = fn({ strict, log, ...opts });
    result[name] = files.length;
    log('info', 'prepare-assets.step', { step: name, files: files.length });
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  try {
    prepareAll({ only: onlyArg ? onlyArg.slice(7).split(',') : undefined });
  } catch (err) {
    defaultLog('error', 'prepare-assets.failed', { message: err.message });
    process.exit(1);
  }
}
