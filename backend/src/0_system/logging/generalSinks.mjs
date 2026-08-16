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
 * Kept separate from backend/index.js so the policy can be asserted without
 * booting a server; index.js still owns the wiring (the addTransport calls).
 */

import path from 'path';

/**
 * Sized against a measured 63 MB/day of container stdout on prod: 25 MB per
 * generation and 8 generations is a hard ceiling of 200 MB — roughly three to
 * four days of history, on a media volume with 450 GB free. Explicit rather
 * than defaulted, so the ceiling is a decision someone made and can revisit.
 */
export const BACKEND_LOG_MAX_SIZE = 25 * 1024 * 1024;
export const BACKEND_LOG_MAX_FILES = 8;

/** dev.log predates this and keeps its own sizing: a developer's checkout is
 *  not the media volume, and its harnesses expect the file they have always
 *  had. */
export const DEV_LOG_MAX_SIZE = 50 * 1024 * 1024;
export const DEV_LOG_MAX_FILES = 3;

/**
 * Resolve the file sinks the dispatcher should carry, in registration order.
 *
 * @param {object} options
 * @param {boolean} options.isDocker - true when running as the container
 * @param {string} options.mediaDir - the media root (holds `logs/`)
 * @param {string} options.repoRoot - checkout root, where dev.log lives
 * @returns {Array<{filename: string, format: string, maxSize: number, maxFiles: number, colorize: boolean}>}
 */
export function resolveGeneralFileSinks({ isDocker, mediaDir, repoRoot }) {
  if (!mediaDir) {
    throw new Error('resolveGeneralFileSinks requires a mediaDir');
  }

  const sinks = [{
    filename: path.join(mediaDir, 'logs', 'backend.log'),
    format: 'json',
    maxSize: BACKEND_LOG_MAX_SIZE,
    maxFiles: BACKEND_LOG_MAX_FILES,
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
