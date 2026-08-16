/**
 * General file-log sink policy.
 *
 * WHY THIS EXISTS: the dispatcher's general transports used to be console
 * (always), Loggly (never — no token is configured in production) and a file
 * (only outside Docker). In production that left stdout as the single general
 * sink, so the 2026-08-16 piano remount storm — 495 Plex transcode sessions in
 * four minutes on a child's kiosk — was readable from `docker logs` and
 * nowhere else, and the container truncated that log on its next restart about
 * 90 minutes later. Evidence for a production incident survived 90 minutes.
 *
 * The durable sink is therefore unconditional. `dev.log` remains a dev-only
 * extra rather than a substitute: the Playwright harnesses tail it at that
 * exact repo-root path, and `npm run dev` does not tee, so this transport is
 * its only writer.
 *
 * ┌─ CONSTRAINT: the default path is inside a Dropbox-synced folder ─────────┐
 * │ On prod, `media/` is bind-mounted from a Dropbox tree and there is no    │
 * │ `.dropboxignore` covering it (only `data/` has one), so everything       │
 * │ written here syncs. An append-and-rotate log is the worst shape for      │
 * │ that: the file is rewritten continuously, and Dropbox keeps version      │
 * │ history for each revision. The on-disk ceiling below bounds the host;    │
 * │ it does NOT bound the account-side cost, which is invisible from the     │
 * │ host and is the reason these numbers are deliberately small.             │
 * │                                                                          │
 * │ BEFORE RAISING maxSize OR maxFiles: confirm where the log actually       │
 * │ lands. If it is still on the synced volume, raising them multiplies a    │
 * │ cost you cannot see from here. Both the path and the bounds are          │
 * │ configurable (see below) precisely so the log can be moved off the       │
 * │ synced volume instead of being made smaller.                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Kept separate from backend/index.js so the policy can be asserted without
 * booting a server; index.js still owns the wiring (the addTransport calls).
 */

import path from 'path';

/**
 * Defaults for the durable backend log: 10 MB per generation × 3 generations,
 * a 30 MB ceiling. At a measured 63 MB/day of container stdout that is roughly
 * eleven hours of history — chosen for the Dropbox constraint above rather
 * than for how much history is useful, which is more.
 *
 * The kiosk's own events do not depend on this window: Task 0.1 routes them
 * through the session-file transport, which keeps 14 days per app. This sink
 * covers backend-side events and any surface that is still untagged.
 */
export const BACKEND_LOG_MAX_SIZE = 10 * 1024 * 1024;
export const BACKEND_LOG_MAX_FILES = 3;

/** dev.log predates this and keeps its own sizing: a developer's checkout is
 *  not the media volume, and its harnesses expect the file they have always
 *  had. */
export const DEV_LOG_MAX_SIZE = 50 * 1024 * 1024;
export const DEV_LOG_MAX_FILES = 3;

const MB = 1024 * 1024;

/**
 * Accept a configured number only when it is a positive, finite value.
 * A typo in YAML (`maxSizeMb: ten`, `maxFiles: 0`) must not silently produce a
 * transport that rotates on every line or never rotates at all; fall back to
 * the default and let the operator notice the file behaving as it always did.
 */
function positiveNumber(value, fallback) {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Resolve the file sinks the dispatcher should carry, in registration order.
 *
 * @param {object} options
 * @param {boolean} options.isDocker - true when running as the container
 * @param {string} options.mediaDir - the media root (holds `logs/`)
 * @param {string} options.repoRoot - checkout root, where dev.log lives
 * @param {object} [options.config] - `logging.fileSink` from system.yml:
 *   `path` (absolute; overrides the default location — this is the knob for
 *   moving the log off the Dropbox-synced volume without a code change),
 *   `maxSizeMb`, `maxFiles`. Anything absent or unusable falls back to the
 *   constants above.
 * @returns {Array<{filename: string, format: string, maxSize: number, maxFiles: number, colorize: boolean}>}
 */
export function resolveGeneralFileSinks({ isDocker, mediaDir, repoRoot, config = null }) {
  if (!mediaDir) {
    throw new Error('resolveGeneralFileSinks requires a mediaDir');
  }

  const configuredPath = typeof config?.path === 'string' && config.path.trim()
    ? config.path.trim()
    : null;

  const sinks = [{
    filename: configuredPath || path.join(mediaDir, 'logs', 'backend.log'),
    format: 'json',
    maxSize: positiveNumber(config?.maxSizeMb, BACKEND_LOG_MAX_SIZE / MB) * MB,
    maxFiles: positiveNumber(config?.maxFiles, BACKEND_LOG_MAX_FILES),
    colorize: false,
  }];

  if (!isDocker && repoRoot) {
    sinks.push({
      filename: path.join(repoRoot, 'dev.log'),
      format: 'json',
      maxSize: DEV_LOG_MAX_SIZE,
      maxFiles: DEV_LOG_MAX_FILES,
      colorize: false,
    });
  }

  return sinks;
}

export default resolveGeneralFileSinks;
