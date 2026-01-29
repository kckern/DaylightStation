/**
 * SessionService - Session CRUD and listing operations
 *
 * Domain service that orchestrates session operations through ISessionStore port.
 * Uses Session entity for domain logic and TimelineService for series encoding.
 */

import { Session } from '../entities/Session.mjs';
import { prepareTimelineForApi, prepareTimelineForStorage } from './TimelineService.mjs';
import { ValidationError, EntityNotFoundError } from '../../core/errors/index.mjs';

/**
 * Parse a timestamp string into Unix milliseconds.
 * Accepts formats: 'YYYY-MM-DD HH:mm:ss' or 'YYYY-MM-DD H:mm:ss'
 * @param {string|number|null} timestamp
 * @returns {number|null}
 */
function parseTimestamp(timestamp) {
  if (timestamp == null) return null;
  if (typeof timestamp === 'number') return timestamp;
  if (typeof timestamp !== 'string') return null;

  // Try parsing as ISO-ish format: "2026-01-29 06:33:22"
  const normalized = timestamp.replace(' ', 'T');
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Convert v3 participants object to v1 roster array.
 * @param {Object} participants - { participantId: { display_name, is_primary, hr_device, ... } }
 * @returns {Array} - [{ name, isPrimary, hrDeviceId, ... }]
 */
function convertParticipantsToRoster(participants) {
  if (!participants || typeof participants !== 'object') return [];

  return Object.entries(participants).map(([id, meta]) => ({
    name: meta.display_name || id,
    profileId: id,
    isPrimary: meta.is_primary === true,
    isGuest: meta.is_guest === true,
    ...(meta.hr_device ? { hrDeviceId: meta.hr_device } : {})
  }));
}

/**
 * Normalize a session payload to internal structure for Session.fromJSON().
 *
 * Handles payloads with nested session block:
 *   - session.id, session.start, session.end, session.duration_seconds
 *   - participants: { id: { display_name, is_primary, hr_device, ... } }
 *   - timeline.series at root level
 *
 * Converts to internal format:
 *   - sessionId, startTime, endTime, durationMs at root
 *   - roster: [{ name, isPrimary, hrDeviceId, ... }]
 *   - timeline.series (unchanged)
 *
 * @param {Object} data - Raw session payload
 * @returns {Object} - Normalized payload
 */
function normalizePayload(data) {
  // Detect v3 format: has session.id but no root sessionId/startTime
  const isV3 = data.session && typeof data.session === 'object' && !data.startTime;

  if (!isV3) {
    return data;
  }

  const session = data.session;

  return {
    ...data,
    // Extract sessionId from nested session block
    sessionId: session.id || data.sessionId,
    // Parse timestamp strings to Unix ms
    startTime: parseTimestamp(session.start) || data.startTime,
    endTime: parseTimestamp(session.end) || data.endTime,
    durationMs: session.duration_seconds != null
      ? session.duration_seconds * 1000
      : data.durationMs,
    // Convert participants object to roster array
    roster: convertParticipantsToRoster(data.participants) || data.roster || [],
    // Timeline series should be preserved as-is (already at timeline.series)
    timeline: data.timeline || { series: {}, events: [] }
  };
}

export class SessionService {
  constructor({ sessionStore, defaultHouseholdId = null }) {
    this.sessionStore = sessionStore;
    this.defaultHouseholdId = defaultHouseholdId;
  }

  /**
   * Resolve household ID with fallback to default
   */
  resolveHouseholdId(explicit) {
    return explicit || this.defaultHouseholdId;
  }

  /**
   * Create a new session
   * @param {Object} data - Session data (startTime required)
   * @param {string} householdId - Household ID
   */
  async createSession(data, householdId) {
    const hid = this.resolveHouseholdId(householdId);

    // startTime is required - caller must provide timestamp
    if (data.startTime == null) {
      throw new ValidationError('startTime is required', {
        code: 'MISSING_START_TIME',
        field: 'startTime'
      });
    }

    const sessionId = data.sessionId || Session.generateSessionId(new Date(data.startTime));

    const session = new Session({
      sessionId,
      startTime: data.startTime,
      timezone: data.timezone || null,
      roster: data.roster || [],
      timeline: data.timeline || { series: {}, events: [] },
      snapshots: data.snapshots || { captures: [], updatedAt: null },
      metadata: { ...data.metadata, householdId: hid }
    });

    await this.sessionStore.save(session, hid);
    return session;
  }

  /**
   * Get a session by ID
   * @param {string} sessionId - Session ID (YYYYMMDDHHmmss format)
   * @param {string} householdId - Household ID
   * @param {Object} options - Options { decodeTimeline: boolean, timezone: string }
   */
  async getSession(sessionId, householdId, options = {}) {
    const hid = this.resolveHouseholdId(householdId);
    const sanitizedId = Session.sanitizeSessionId(sessionId);
    if (!sanitizedId) return null;

    const data = await this.sessionStore.findById(sanitizedId, hid);
    if (!data) return null;

    const session = Session.fromJSON(data);

    // Optionally decode timeline series for API consumption
    if (options.decodeTimeline !== false) {
      const tz = options.timezone || session.timezone || 'UTC';
      session.timeline = prepareTimelineForApi(session.timeline, tz);
    }

    return session;
  }

  /**
   * List all dates that have sessions
   * @param {string} householdId - Household ID
   * @returns {Promise<string[]>} Array of YYYY-MM-DD date strings
   */
  async listDates(householdId) {
    const hid = this.resolveHouseholdId(householdId);
    return this.sessionStore.listDates(hid);
  }

  /**
   * List sessions by date (returns summaries, not full session data)
   * @param {string} date - Date in YYYY-MM-DD format
   * @param {string} householdId - Household ID
   */
  async listSessionsByDate(date, householdId) {
    const hid = this.resolveHouseholdId(householdId);
    const sessions = await this.sessionStore.findByDate(date, hid);
    return sessions.map(s => {
      const session = Session.fromJSON(s);
      return session.toSummary();
    });
  }

  /**
   * List sessions in date range
   * @param {string} startDate - Start date YYYY-MM-DD
   * @param {string} endDate - End date YYYY-MM-DD
   * @param {string} householdId - Household ID
   */
  async listSessionsInRange(startDate, endDate, householdId) {
    const hid = this.resolveHouseholdId(householdId);
    const sessions = await this.sessionStore.findInRange(startDate, endDate, hid);
    return sessions.map(s => Session.fromJSON(s).toSummary());
  }

  /**
   * Save/update a session
   * @param {Object} sessionData - Raw session data (v2 or v3 format)
   * @param {string} householdId - Household ID
   */
  async saveSession(sessionData, householdId) {
    const hid = this.resolveHouseholdId(householdId);

    // Normalize payload to internal structure
    const normalized = normalizePayload(sessionData);

    // Handle both sessionId and legacy formats
    const rawSessionId = normalized.sessionId || normalized.session?.id;
    const sanitizedId = Session.sanitizeSessionId(rawSessionId);
    if (!sanitizedId) {
      throw new ValidationError('Valid sessionId is required', {
        code: 'INVALID_SESSION_ID',
        field: 'sessionId'
      });
    }

    // Normalize to Session entity
    const session = Session.fromJSON({
      ...normalized,
      sessionId: sanitizedId
    });

    // Encode timeline series for storage
    session.timeline = prepareTimelineForStorage(session.timeline);

    // Merge with existing file to preserve snapshots
    const existing = await this.sessionStore.findById(sanitizedId, hid);
    if (existing?.snapshots) {
      session.snapshots = existing.snapshots;
    }

    await this.sessionStore.save(session, hid);
    return session;
  }

  /**
   * End a session
   * @param {string} sessionId - Session ID
   * @param {string} householdId - Household ID
   * @param {number} endTime - End timestamp in milliseconds (required)
   */
  async endSession(sessionId, householdId, endTime) {
    if (endTime == null) {
      throw new ValidationError('endTime is required', {
        code: 'MISSING_END_TIME',
        field: 'endTime'
      });
    }
    const session = await this.getSession(sessionId, householdId, { decodeTimeline: false });
    if (!session) {
      throw new EntityNotFoundError('Session', sessionId);
    }

    session.end(endTime);
    session.timeline = prepareTimelineForStorage(session.timeline);
    await this.sessionStore.save(session, this.resolveHouseholdId(householdId));
    return session;
  }

  /**
   * Add participant to session
   * @param {string} sessionId - Session ID
   * @param {Object} participant - Participant data
   * @param {string} householdId - Household ID
   */
  async addParticipant(sessionId, participant, householdId) {
    const session = await this.getSession(sessionId, householdId, { decodeTimeline: false });
    if (!session) {
      throw new EntityNotFoundError('Session', sessionId);
    }

    session.addParticipant(participant);
    await this.sessionStore.save(session, this.resolveHouseholdId(householdId));
    return session;
  }

  /**
   * Add a snapshot to session
   * @param {string} sessionId - Session ID
   * @param {Object} capture - Capture info { filename, path, timestamp, size }
   * @param {string} householdId - Household ID
   * @param {number} timestamp - Timestamp in milliseconds (required)
   */
  async addSnapshot(sessionId, capture, householdId, timestamp) {
    if (timestamp == null) {
      throw new ValidationError('timestamp is required', {
        code: 'MISSING_TIMESTAMP',
        field: 'timestamp'
      });
    }
    const hid = this.resolveHouseholdId(householdId);
    const sanitizedId = Session.sanitizeSessionId(sessionId);
    if (!sanitizedId) {
      throw new ValidationError('Invalid sessionId', {
        code: 'INVALID_SESSION_ID',
        field: 'sessionId'
      });
    }

    // Load existing or create minimal session
    let existing = await this.sessionStore.findById(sanitizedId, hid);
    const session = existing ? Session.fromJSON(existing) : new Session({ sessionId: sanitizedId });

    // Remove duplicate by filename if exists
    if (session.snapshots?.captures) {
      session.snapshots.captures = session.snapshots.captures.filter(
        entry => entry?.filename !== capture.filename
      );
    }

    session.addSnapshot(capture, timestamp);
    await this.sessionStore.save(session, hid);
    return session;
  }

  /**
   * Get active sessions
   * @param {string} householdId - Household ID
   */
  async getActiveSessions(householdId) {
    const hid = this.resolveHouseholdId(householdId);
    const sessions = await this.sessionStore.findActive(hid);
    return sessions.map(s => Session.fromJSON(s));
  }

  /**
   * Delete a session
   * @param {string} sessionId - Session ID
   * @param {string} householdId - Household ID
   */
  async deleteSession(sessionId, householdId) {
    const hid = this.resolveHouseholdId(householdId);
    await this.sessionStore.delete(sessionId, hid);
  }

  /**
   * Get storage paths for a session (for screenshot storage, etc.)
   * @param {string} sessionId - Session ID
   * @param {string} householdId - Household ID
   */
  getStoragePaths(sessionId, householdId) {
    const hid = this.resolveHouseholdId(householdId);
    const sanitizedId = Session.sanitizeSessionId(sessionId);
    if (!sanitizedId) return null;
    return this.sessionStore.getStoragePaths(sanitizedId, hid);
  }
}

export default SessionService;
