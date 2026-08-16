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
 * ┌─ STANDING FACTS about the default path ──────────────────────────────────┐
 * │ `media/logs/` is the sanctioned home for heavy logs. On prod `media/` is  │
 * │ bind-mounted from a Dropbox tree with no `.dropboxignore` covering it, so │
 * │ everything written here syncs — and that cost is accepted, decided by the │
 * │ owner, not a hazard to design around. Do not shrink these numbers to      │
 * │ dodge it, and do not add a `.dropboxignore` to an already-synced folder:  │
 * │ excluding a synced directory can remove the remote copy, and this repo    │
 * │ has history of exactly that nearly destroying live data.                  │
 * │                                                                           │
 * │ The real bound is the rotation ceiling below. It is sized against the     │
 * │ measured intake, so changing maxSize or maxFiles changes a deliberate     │
 * │ decision about how much history the next incident gets — which is the     │
 * │ only question worth weighing here.                                        │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Kept separate from backend/index.js so the policy can be asserted without
 * booting a server; index.js still owns the wiring (the addTransport calls).
 */

import path from 'path';

/**
 * Defaults for the durable backend log: 25 MB per generation × 8 generations,
 * a 200 MB ceiling. At a measured 63 MB/day of backend stdout that is roughly
 * three to four days, on a volume with 450 GB free.
 *
 * Three to four days rather than a handful of hours because this sink carries
 * the lines that diagnose an incident — `plex.stream.mint`, `http.response` —
 * and household problems are reported the next morning by whoever hit them,
 * not within the hour. A window that expires before anyone thinks to look is
 * a window that was never really there.
 *
 * The kiosk's own events do not depend on this window: they route through the
 * session-file transport, which keeps 14 days per app. This sink covers
 * backend-side events and any surface that is still untagged.
 */
export const BACKEND_LOG_MAX_SIZE = 25 * 1024 * 1024;
export const BACKEND_LOG_MAX_FILES = 8;

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
