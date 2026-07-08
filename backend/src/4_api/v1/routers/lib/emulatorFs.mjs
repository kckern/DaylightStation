import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import yaml from 'js-yaml';
import { safeSegment } from './emulatorPaths.mjs';

const CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gb': 'application/octet-stream',
  '.gbc': 'application/octet-stream',
  '.srm': 'application/octet-stream',
  '.state': 'application/octet-stream',
};

function contentTypeFor(p) {
  return CONTENT_TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

function enoent(msg) {
  const e = new Error(msg || 'not found');
  e.code = 'ENOENT';
  return e;
}

function findGame(cfg, system, gameId) {
  const game = (cfg?.games ?? []).find((g) => g.id === gameId && g.system === system);
  if (!game) throw enoent(`unknown game ${system}/${gameId}`);
  return game;
}

/**
 * Resolve the real (messy) ROM filename for a game under emulationDir/{system}/.
 * The relative filename comes from the manifest (cfg), so it may contain spaces
 * and brackets — which is why it is NEVER taken from the URL.
 */
export function resolveRomPath(emulationDir, cfg, system, gameId) {
  safeSegment(system);
  safeSegment(gameId);
  const game = findGame(cfg, system, gameId);
  if (!game.rom) throw enoent(`no rom for ${system}/${gameId}`);
  return path.join(emulationDir, system, game.rom);
}

/**
 * Resolve cover/bezel art path from the manifest relative filename.
 */
export function resolveArtPath(emulationDir, cfg, system, gameId, kind) {
  safeSegment(system);
  safeSegment(gameId);
  if (kind !== 'cover' && kind !== 'bezel') throw new Error('unsafe path segment');
  const game = findGame(cfg, system, gameId);
  const rel = kind === 'cover' ? game.boxart : game.bezel;
  if (!rel) throw enoent(`no ${kind} for ${system}/${gameId}`);
  return path.join(emulationDir, system, rel);
}

/**
 * Per-user save we WRITE uses the safe slug filename `{gameId}.srm`.
 */
export function resolveSavePath(emulationDir, system, gameId, user) {
  safeSegment(system);
  safeSegment(gameId);
  safeSegment(user);
  return path.join(emulationDir, system, 'saves', user, `${gameId}.srm`);
}

/**
 * Per-user state we WRITE uses safe slug names `{gameId}/{slot}.state`.
 */
export function resolveStatePath(emulationDir, system, gameId, slot, user) {
  safeSegment(system);
  safeSegment(gameId);
  safeSegment(slot, { dot: true });
  safeSegment(user);
  return path.join(emulationDir, system, 'states', user, gameId, `${slot}.state`);
}

/**
 * Read a binary file. With { range } returns a sliced stream; otherwise the
 * full buffer. Throws Error with .code === 'ENOENT' for missing files.
 *
 * @returns {{ buffer?: Buffer, stream?: Readable, size: number, contentType: string, range?: object }}
 */
export function readBinary(absPath, { range } = {}) {
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch (err) {
    if (err.code === 'ENOENT') throw enoent();
    throw err;
  }
  const contentType = contentTypeFor(absPath);
  if (range) {
    const start = Math.max(0, range.start);
    const end = Math.min(range.end, stat.size - 1);
    const stream = fs.createReadStream(absPath, { start, end });
    return { stream, size: stat.size, contentType, range: { start, end } };
  }
  return { buffer: fs.readFileSync(absPath), size: stat.size, contentType };
}

// The exact core-load call in the vendored loader.js (prod, non-debug branch).
// Stable across EmulatorJS builds; if it ever changes, makeLoaderReentrant
// leaves the loader untouched rather than guessing.
export const CORE_LOAD_CALL = 'await loadScript("emulator.min.js");';
const GUARD_MARKER = 'typeof window.EmulatorJS === "undefined"';

/**
 * Make the vendored EmulatorJS loader re-entrant.
 *
 * loader.js unconditionally re-loads emulator.min.js each time it runs. That
 * script declares `class EJS_STORAGE` (and the `EmulatorJS` class) at top level,
 * so re-running the loader in the SAME page realm — which happens on every
 * game-switch — throws "redeclaration of let EJS_STORAGE", aborting the fresh
 * core mid-eval. The canvas still paints from the abandoned instance, but the
 * new instance's gamepad→simulateInput wiring never attaches, so input silently
 * dies on every game after the first (observed: green "consumed" LED dark,
 * `emulator.input.summary gap:true`).
 *
 * The `EmulatorJS` class stays resident after the first load (it's assigned to
 * `window.EmulatorJS`), so the core never needs re-loading. Guarding the core
 * load behind `window.EmulatorJS` lets the loader be re-run to re-instantiate a
 * fresh game with the resident class — game 2 boots as clean as game 1.
 *
 * Idempotent + defensive: returns the source unchanged if already guarded or if
 * the expected call isn't found (a re-vendored loader we don't recognize).
 *
 * @param {string} source  loader.js contents
 * @returns {string}
 */
export function makeLoaderReentrant(source) {
  if (typeof source !== 'string') return source;
  if (source.includes(GUARD_MARKER)) return source;      // already guarded
  if (!source.includes(CORE_LOAD_CALL)) return source;   // unrecognized loader — leave as-is
  return source.replace(
    CORE_LOAD_CALL,
    `if (${GUARD_MARKER}) { ${CORE_LOAD_CALL} }`,
  );
}

/**
 * Build a reader for the vendored EmulatorJS engine bundle living under
 * engineDir. The relPath is expected to already be segment-validated by the
 * route, but we still resolve it under engineDir and reject any path that
 * escapes the directory (defense in depth). Reads use the same stat+read
 * approach as readBinary and map missing files to .code === 'ENOENT'.
 *
 * `loader.js` is served through makeLoaderReentrant so re-running it per game
 * doesn't re-declare the core's top-level classes (see that function).
 *
 * @param {string} engineDir  Absolute path to the _engine bundle directory.
 * @returns {(relPath: string) => { buffer: Buffer, size: number, contentType: string }}
 */
export function makeReadEngineFile(engineDir) {
  const root = path.resolve(engineDir);
  return function readEngineFile(relPath) {
    const abs = path.resolve(root, relPath);
    // Ensure the resolved path stays inside engineDir (no traversal escape).
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw enoent();
    }
    const result = readBinary(abs);
    if (path.basename(relPath) === 'loader.js' && result.buffer) {
      const patched = makeLoaderReentrant(result.buffer.toString('utf8'));
      const buffer = Buffer.from(patched, 'utf8');
      return { buffer, size: buffer.length, contentType: result.contentType };
    }
    return result;
  };
}

/**
 * Atomic binary write: write to a temp file in the same dir, then rename.
 * Creates parent directories as needed.
 */
export async function writeBinary(absPath, buffer) {
  const dir = path.dirname(absPath);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(absPath)}.${randomBytes(6).toString('hex')}.tmp`);
  await fs.promises.writeFile(tmp, buffer);
  try {
    await fs.promises.rename(tmp, absPath);
  } catch (err) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Delete a binary file (per-user save/state) for the "start over" reset. Missing
 * files are a no-op (idempotent) so a reset before any save still succeeds.
 */
export async function deleteBinary(absPath) {
  await fs.promises.rm(absPath, { force: true });
}

/**
 * Directory names (only) under `dir`, or [] if it doesn't exist.
 */
function userDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * List user slugs that have a save for {system}/{gameId} — either a battery
 * `.srm` under saves/{user}/ or a non-empty state dir under states/{user}/.
 * Sorted + deduped. Used by GET /saves to populate the "Continue as…" row.
 */
export function listSaveUsers(emulationDir, system, gameId) {
  safeSegment(system);
  safeSegment(gameId);
  const users = new Set();

  const savesRoot = path.join(emulationDir, system, 'saves');
  for (const user of userDirs(savesRoot)) {
    if (fs.existsSync(path.join(savesRoot, user, `${gameId}.srm`))) users.add(user);
  }

  const statesRoot = path.join(emulationDir, system, 'states');
  for (const user of userDirs(statesRoot)) {
    const gameDir = path.join(statesRoot, user, gameId);
    try {
      if (fs.statSync(gameDir).isDirectory() && fs.readdirSync(gameDir).length > 0) users.add(user);
    } catch { /* absent */ }
  }

  return Array.from(users).sort();
}

/**
 * Scan emulationDir/*\/ for the per-system YAML manifest and parse it.
 * Returns an array of { system, manifest } for loadEmulatorConfig.
 * The system id is taken from the manifest's own `system` field (falling back
 * to the directory name).
 */
export function readManifests(emulationDir) {
  let dirents;
  try {
    dirents = fs.readdirSync(emulationDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const out = [];
  for (const ent of dirents) {
    if (!ent.isDirectory()) continue;
    const systemDir = path.join(emulationDir, ent.name);
    let files;
    try {
      files = fs.readdirSync(systemDir);
    } catch {
      continue;
    }
    const ymls = files.filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
    if (ymls.length === 0) continue;
    // Prefer the most specific manifest; pick the first .yml deterministically.
    ymls.sort();
    const manifestPath = path.join(systemDir, ymls[0]);
    let manifest;
    try {
      manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8')) || null;
    } catch {
      continue;
    }
    if (!manifest) continue;
    out.push({ system: manifest.system || ent.name, manifest });
  }
  return out;
}

/**
 * Build a reader for the top-level input config (emulationDir/input.yml) that
 * holds the keyboard mapping + controller catalog. Returns null when the file
 * is absent or unparseable so callers can fall back gracefully.
 *
 * @param {string} emulationDir
 * @returns {() => object|null}
 */
export function makeReadInputConfig(emulationDir) {
  const inputPath = path.join(emulationDir, 'input.yml');
  return function readInputConfig() {
    let raw;
    try {
      raw = fs.readFileSync(inputPath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
    try {
      return yaml.load(raw) ?? null;
    } catch {
      return null;
    }
  };
}

/**
 * Reader for emulationDir/settings.yml — autosaveSeconds / idleRelockMinutes /
 * adminGate. Returns null when absent/unparseable; loadEmulatorConfig defaults.
 */
export function makeReadSettingsConfig(emulationDir) {
  const settingsPath = path.join(emulationDir, 'settings.yml');
  return function readSettings() {
    let raw;
    try {
      raw = fs.readFileSync(settingsPath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
    try {
      return yaml.load(raw) ?? null;
    } catch {
      return null;
    }
  };
}

/**
 * Build a reader for the ordered console-tab list (emulationDir/consoles.yml)
 * that drives the arcade shell's bottom tabs. Accepts either a bare list or a
 * `{ consoles: [...] }` wrapper; loadEmulatorConfig normalizes both. Returns
 * null when absent/unparseable so the shell falls back to one tab per system.
 *
 * @param {string} emulationDir
 * @returns {() => (object[]|object|null)}
 */
export function makeReadConsolesConfig(emulationDir) {
  const consolesPath = path.join(emulationDir, 'consoles.yml');
  return function readConsoles() {
    let raw;
    try {
      raw = fs.readFileSync(consolesPath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
    try {
      return yaml.load(raw) ?? null;
    } catch {
      return null;
    }
  };
}
