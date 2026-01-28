/**
 * YamlSessionDatastore - YAML-based session persistence
 *
 * Implements ISessionDatastore port for fitness session storage.
 * Sessions are stored at: households/{hid}/apps/fitness/sessions/{YYYY-MM-DD}/{sessionId}.yml
 * Screenshots at: {mediaRoot}/apps/fitness/households/{hid}/sessions/{YYYY-MM-DD}/{sessionId}/screenshots/
 */
import path from 'path';
import moment from 'moment-timezone';
import {
  ensureDir,
  dirExists,
  loadYamlSafe,
  saveYaml,
  listYamlFiles,
  listDirsMatching,
  deleteYaml
} from '#system/utils/FileIO.mjs';
import { ISessionDatastore } from '#apps/fitness/ports/ISessionDatastore.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Derive session date from sessionId
 * @param {string} sessionId - YYYYMMDDHHmmss format
 * @returns {string|null} YYYY-MM-DD date string
 */
function deriveSessionDate(sessionId) {
  if (!sessionId || sessionId.length < 8) return null;
  return `${sessionId.slice(0, 4)}-${sessionId.slice(4, 6)}-${sessionId.slice(6, 8)}`;
}

/**
 * Parse timestamp to unix milliseconds
 * @param {unknown} value - Timestamp value (number or string)
 * @param {string} timezone - Timezone for parsing strings
 * @returns {number|null}
 */
function parseToUnixMs(value, timezone = 'UTC') {
  if (Number.isFinite(Number(value))) return Number(value);
  if (typeof value !== 'string') return null;
  const tz = timezone || 'UTC';
  const parsed = moment.tz(value, 'YYYY-MM-DD h:mm:ss a', tz);
  const ms = parsed?.valueOf?.();
  return Number.isFinite(ms) ? ms : null;
}

export class YamlSessionDatastore extends ISessionDatastore {
  /**
   * @param {Object} config
   * @param {string} config.dataRoot - Base data directory
   * @param {string} config.mediaRoot - Base media directory
   */
  constructor(config) {
    super();
    if (!config.dataRoot) throw new InfrastructureError('YamlSessionDatastore requires dataRoot', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataRoot'
      });
    this.dataRoot = config.dataRoot;
    this.mediaRoot = config.mediaRoot || path.join(process.cwd(), 'media');
  }

  /**
   * Get storage paths for a session
   * @param {string} sessionId
   * @param {string} householdId
   * @returns {{sessionDate: string, sessionsDir: string, sessionFilePath: string, screenshotsDir: string}}
   */
  getStoragePaths(sessionId, householdId) {
    const sessionDate = deriveSessionDate(sessionId);
    if (!sessionDate) return null;

    const sessionsDir = path.join(
      this.dataRoot,
      'households',
      householdId,
      'apps',
      'fitness',
      'sessions',
      sessionDate
    );

    const sessionFilePath = path.join(sessionsDir, sessionId);

    const screenshotsDir = path.join(
      this.mediaRoot,
      'apps',
      'fitness',
      'households',
      householdId,
      'sessions',
      sessionDate,
      sessionId,
      'screenshots'
    );

    // Relative path for API responses
    const screenshotsRelativeBase = `apps/fitness/households/${householdId}/sessions/${sessionDate}/${sessionId}/screenshots`;

    return {
      sessionDate,
      sessionsDir,
      sessionFilePath,
      screenshotsDir,
      screenshotsRelativeBase
    };
  }

  /**
   * Save a session
   * @param {Object} session - Session entity or plain object
   * @param {string} householdId
   * @returns {Promise<void>}
   */
  async save(session, householdId) {
    const data = typeof session.toJSON === 'function' ? session.toJSON() : session;
    const paths = this.getStoragePaths(data.sessionId, householdId);
    if (!paths) throw new InfrastructureError('Invalid sessionId', {
        code: 'VALIDATION_ERROR'
      });

    ensureDir(paths.sessionsDir);
    ensureDir(paths.screenshotsDir);
    saveYaml(paths.sessionFilePath, data);
  }

  /**
   * Find session by ID
   * @param {string} sessionId
   * @param {string} householdId
   * @returns {Promise<Object|null>}
   */
  async findById(sessionId, householdId) {
    const paths = this.getStoragePaths(sessionId, householdId);
    if (!paths) return null;

    const data = loadYamlSafe(paths.sessionFilePath);
    if (!data) return null;

    // Parse timestamps to unix ms for API compatibility
    const tz = typeof data.timezone === 'string' ? data.timezone : 'UTC';
    const startMs = parseToUnixMs(data.startTime, tz);
    const endMs = parseToUnixMs(data.endTime, tz);
    if (startMs != null) data.startTime = startMs;
    if (endMs != null) data.endTime = endMs;

    // Parse event timestamps
    if (data.timeline?.events && Array.isArray(data.timeline.events)) {
      data.timeline.events = data.timeline.events.map(evt => {
        if (!evt || typeof evt !== 'object') return evt;
        const ts = parseToUnixMs(evt.timestamp, tz);
        if (ts == null) return evt;
        return { ...evt, timestamp: ts };
      });
    }

    // Compatibility: synthesize roster from v2 participants if missing
    if ((!Array.isArray(data.roster) || data.roster.length === 0) &&
        data.participants && typeof data.participants === 'object') {
      data.roster = Object.entries(data.participants)
        .map(([slug, entry]) => {
          if (!entry || typeof entry !== 'object') return null;
          return {
            name: entry.display_name || slug,
            hrDeviceId: entry.hr_device || null,
            isGuest: entry.is_guest === true,
            isPrimary: entry.is_primary === true
          };
        })
        .filter(Boolean);
    }

    return data;
  }

  /**
   * List all dates that have sessions
   * @param {string} householdId
   * @returns {Promise<string[]>}
   */
  async listDates(householdId) {
    const sessionsRoot = path.join(
      this.dataRoot,
      'households',
      householdId,
      'apps',
      'fitness',
      'sessions'
    );

    return listDirsMatching(sessionsRoot, /^\d{4}-\d{2}-\d{2}$/)
      .sort()
      .reverse();
  }

  /**
   * Find sessions by date
   * @param {string} date - YYYY-MM-DD format
   * @param {string} householdId
   * @returns {Promise<Object[]>}
   */
  async findByDate(date, householdId) {
    const sessionsDir = path.join(
      this.dataRoot,
      'households',
      householdId,
      'apps',
      'fitness',
      'sessions',
      date
    );

    if (!dirExists(sessionsDir)) return [];

    const baseNames = listYamlFiles(sessionsDir);
    const sessions = [];

    for (const baseName of baseNames) {
      const basePath = path.join(sessionsDir, baseName);
      const data = loadYamlSafe(basePath);
      if (!data) continue;

      const tz = typeof data.timezone === 'string' ? data.timezone : 'UTC';
      const startTime = parseToUnixMs(data.startTime, tz);
      const endTime = parseToUnixMs(data.endTime, tz);

      sessions.push({
        sessionId: data.sessionId || baseName,
        startTime: startTime || null,
        endTime: endTime || null,
        durationMs: Number.isFinite(Number(data.durationMs))
          ? Number(data.durationMs)
          : (startTime && endTime ? Math.max(0, endTime - startTime) : null),
        rosterCount: Array.isArray(data.roster) && data.roster.length
          ? data.roster.length
          : (data.participants && typeof data.participants === 'object'
              ? Object.keys(data.participants).length
              : 0),
        timezone: data.timezone
      });
    }

    // Sort by startTime descending
    return sessions.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
  }

  /**
   * Find sessions in date range
   * @param {string} startDate - YYYY-MM-DD
   * @param {string} endDate - YYYY-MM-DD
   * @param {string} householdId
   * @returns {Promise<Object[]>}
   */
  async findInRange(startDate, endDate, householdId) {
    const dates = await this.listDates(householdId);
    const filtered = dates.filter(d => d >= startDate && d <= endDate);

    const sessions = [];
    for (const date of filtered) {
      const dateSessions = await this.findByDate(date, householdId);
      sessions.push(...dateSessions);
    }

    return sessions.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
  }

  /**
   * Find active (not ended) sessions
   * @param {string} householdId
   * @returns {Promise<Object[]>}
   */
  async findActive(householdId) {
    // Check recent dates for active sessions
    const dates = await this.listDates(householdId);
    const recentDates = dates.slice(0, 7); // Last 7 days

    const active = [];
    for (const date of recentDates) {
      const sessions = await this.findByDate(date, householdId);
      for (const summary of sessions) {
        if (summary.endTime === null) {
          const session = await this.findById(summary.sessionId, householdId);
          if (session) active.push(session);
        }
      }
    }

    return active;
  }

  /**
   * Delete a session
   * @param {string} sessionId
   * @param {string} householdId
   * @returns {Promise<void>}
   */
  async delete(sessionId, householdId) {
    const paths = this.getStoragePaths(sessionId, householdId);
    if (!paths) return;

    deleteYaml(paths.sessionFilePath);
  }
}

export default YamlSessionDatastore;
