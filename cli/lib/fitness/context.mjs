/**
 * Shared bootstrap for `fitness.cli.mjs` subcommands.
 *
 * Every fitness/strava script used to carry its own near-identical copy of the
 * `isDocker` / `dotenv.config()` / `baseDir` / FileIO-with-yaml-fallback block.
 * This module is that block, once.
 *
 * @module cli/lib/fitness/context
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import dotenv from 'dotenv';
import YAML from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root — three levels up from cli/lib/fitness/. */
export const projectRoot = path.resolve(__dirname, '..', '..', '..');

let cached = null;

/**
 * Build (once per process) the context object handed to every subcommand.
 *
 * Path resolution order, matching the pre-consolidation scripts:
 *   1. `/usr/src/app` when running inside the daylight-station container
 *   2. `DAYLIGHT_BASE_PATH` from the environment or `.env`
 *   3. the repo root
 *
 * @returns {{
 *   projectRoot: string,
 *   baseDir: string,
 *   dataDir: string,
 *   mediaDir: string,
 *   isDocker: boolean,
 *   username: string,
 *   fitnessHistoryDir: string,
 *   loadYamlSafe: (p: string) => any,
 *   saveYaml: (p: string, data: any) => void
 * }}
 */
/**
 * The ONE place the fitness history tree is named.
 *
 * Thirteen CLI scripts each spelled this join out themselves, bypassing
 * ConfigService entirely, so relocating 107 MB of sessions meant a
 * thirteen-line edit with no single reviewable decision. Everything routes
 * through here now — `dataDir` is the `<root>/data` directory.
 */
export function fitnessHistoryDir(dataDir) {
  return path.join(dataDir, 'household', 'fitness', 'log');
}

export function getContext() {
  if (cached) return cached;

  // quiet: the old scripts let dotenv print a banner to stdout, which corrupted
  // `--json` output badly enough that callers had to grep for the first line
  // starting with '{'. Keep stdout clean.
  dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true });

  const isDocker = existsSync('/.dockerenv');
  const baseDir = isDocker
    ? '/usr/src/app'
    : (process.env.DAYLIGHT_BASE_PATH || projectRoot);
  const dataDir = path.join(baseDir, 'data');
  const mediaDir = path.join(baseDir, 'media');

  cached = {
    projectRoot,
    baseDir,
    dataDir,
    mediaDir,
    isDocker,
    username: process.env.DAYLIGHT_USER || 'user_1',
    fitnessHistoryDir: fitnessHistoryDir(dataDir),
    loadYamlSafe,
    saveYaml,
  };
  return cached;
}

/**
 * Serialization options every YAML write in this CLI must use.
 *
 * `lineWidth: 0` disables folding — the default (80) would wrap the long
 * RLE-encoded timeline series strings across lines, rewriting session files
 * that were only meant to be patched. Matches FileIO.saveYaml's `lineWidth: -1`.
 *
 * `version: '1.1'` is the one that bites silently. The `yaml` package defaults
 * to YAML 1.2, whose core schema has no timestamp type, so it emits
 * `date: 2026-06-27` bare where js-yaml (YAML 1.1, what the backend reads
 * sessions back with) wrote `date: '2026-06-27'`. js-yaml then resolves the
 * bare form to a Date, `TimelineService.parseToUnixMs` takes its numeric
 * short-circuit instead of the tz-aware branch, and every timestamp in the
 * file shifts by the UTC offset. Pinning 1.1 restores the quoting.
 */
const YAML_OUT = { lineWidth: 0, version: '1.1' };

/**
 * Read a YAML file, appending `.yml` when the path has no YAML extension.
 * Returns `null` rather than throwing when the file is missing or malformed —
 * callers decide whether absence is fatal.
 *
 * @param {string} p
 * @returns {any|null}
 */
export function loadYamlSafe(p) {
  try {
    return YAML.parse(readFileSync(withYamlExt(p), 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Write a YAML file, creating parent directories and appending `.yml` when the
 * path has no YAML extension.
 *
 * @param {string} p
 * @param {any} data
 */
export function saveYaml(p, data) {
  const full = withYamlExt(p);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, YAML.stringify(data, YAML_OUT));
}

function withYamlExt(p) {
  return p.endsWith('.yml') || p.endsWith('.yaml') ? p : `${p}.yml`;
}

/**
 * Path to a stored session YAML.
 *
 * @param {Object} ctx - from `getContext()`
 * @param {string} date - YYYY-MM-DD
 * @param {string} sessionId - 14-digit session id
 * @returns {string}
 */
export function sessionPath(ctx, date, sessionId) {
  return path.join(ctx.fitnessHistoryDir, date, `${sessionId}.yml`);
}

/** @param {string} date @returns {boolean} */
export function isValidDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

/** @param {string} id @returns {boolean} */
export function isValidSessionId(id) {
  return /^\d{14}$/.test(id);
}

/**
 * Thrown by subcommands for expected failures (bad args, missing files).
 * The dispatcher prints `.message` without a stack trace and exits non-zero.
 */
export class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}
