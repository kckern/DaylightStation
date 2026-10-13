import fs from 'fs';
import path from 'path';

const CRITICAL_DIRS = [
  'system/state',
  'system/config',
  'household',
  'users',
];

/**
 * Validate that the app can write to critical data directories.
 * Logs warnings for any unwritable paths. Does not block startup.
 *
 * @param {object} options
 * @param {string} options.dataDir - Absolute path to data directory
 * @param {object} [options.logger] - Structured logger (falls back to console)
 */
export function validateDataPermissions({ dataDir, logger }) {
  const log = logger || console;
  const failures = [];

  for (const rel of CRITICAL_DIRS) {
    const dir = path.join(dataDir, rel);
    if (!fs.existsSync(dir)) continue;

    const testFile = path.join(dir, '.write-test');
    try {
      fs.writeFileSync(testFile, '', 'utf8');
      fs.unlinkSync(testFile);
    } catch (err) {
      const stat = safeStat(dir);
      failures.push({
        path: dir,
        error: err.code,
        owner: stat ? stat.uid : 'unknown',
        mode: stat ? '0' + (stat.mode & 0o777).toString(8) : 'unknown',
      });
    }
  }

  if (failures.length > 0) {
    const logFn = log.warn || log.error || console.error;
    const event = 'bootstrap.permission_warnings';
    const data = {
      message: `${failures.length} critical director${failures.length === 1 ? 'y is' : 'ies are'} not writable`,
      failures,
      runningAs: process.getuid?.() ?? 'unknown',
      fix: 'Run: docker exec <container> chown -R node:node /usr/src/app/data',
    };

    if (typeof logFn === 'function' && log !== console) {
      logFn.call(log, event, data);
    } else {
      console.error(`[Bootstrap] ${data.message}`, JSON.stringify(failures, null, 2));
    }
  } else {
    if (log.info) {
      log.info('bootstrap.permissions_ok', { dataDir });
    } else {
      console.log('[Bootstrap] Data directory permissions OK');
    }
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}
