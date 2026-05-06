/**
 * SessionService - Session CRUD and listing operations
 *
 * Application service that orchestrates session operations through ISessionStore port.
 * Uses Session entity for domain logic and TimelineService for series encoding.
 */

import { Session } from '#domains/fitness/entities/Session.mjs';
import { prepareTimelineForApi, prepareTimelineForStorage, mergeTimelines } from '#domains/fitness/services/TimelineService.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

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
  // Detect v3 format: has session block or version marker
  const isV3 = (data.version === 3 || (data.session && typeof data.session === 'object'));

  if (!isV3) {
    // Even for non-v3, merge root events into timeline.events if timeline.events is empty
    if (Array.isArray(data.events) && data.events.length > 0) {
      const timelineEvents = data.timeline?.events || [];
      if (!timelineEvents.length) {
        data.timeline = {
          ...(data.timeline || {}),
          events: data.events
        };
      }
    }
    return data;
  }

  const session = data.session || {};

  // Merge root events into timeline.events (frontend sends events at root, not timeline.events)
  const rootEvents = Array.isArray(data.events) ? data.events : [];
  const timelineEvents = data.timeline?.events || [];
  const mergedEvents = timelineEvents.length > 0 ? timelineEvents : rootEvents;

  // Preserve timeline metadata (interval_seconds, tick_count, encoding)
  const timelineBase = data.timeline || {};

  // Parse timestamps: prefer session.start/end (readable), fall back to root startTime/endTime
  const startTime = parseTimestamp(session.start) || parseTimestamp(data.startTime) || data.startTime;
  const endTime = parseTimestamp(session.end) || parseTimestamp(data.endTime) || data.endTime;

  return {
    ...data,
    // Extract sessionId from nested session block or root
    sessionId: session.id || data.sessionId,
    startTime,
    endTime,
    durationMs: session.duration_seconds != null
      ? session.duration_seconds * 1000
      : data.durationMs,
    // Convert participants object to roster array
    roster: convertParticipantsToRoster(data.participants) || data.roster || [],
    // Timeline: preserve all metadata + merge events
    timeline: {
      ...timelineBase,
      series: timelineBase.series || {},
      events: mergedEvents
    },
    // Preserve v3 fields for round-trip through Session entity
    events: rootEvents,
    participants: data.participants || {},
    entities: data.entities || [],
    treasureBox: data.treasureBox || null,
    session: data.session,
    version: data.version || 3
  };
}

export class SessionService {
  constructor({ sessionStore, defaultHouseholdId = null, logger = null }) {
    this.sessionStore = sessionStore;
    this.defaultHouseholdId = defaultHouseholdId;
    this.logger = logger;
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
      session.replaceTimeline(prepareTimelineForApi(session.timeline, tz));
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
    return this.sessionStore.findByDate(date, hid);
  }

  /**
   * List sessions in date range
   * @param {string} startDate - Start date YYYY-MM-DD
   * @param {string} endDate - End date YYYY-MM-DD
   * @param {string} householdId - Household ID
   */
  async listSessionsInRange(startDate, endDate, householdId) {
    const hid = this.resolveHouseholdId(householdId);
    return this.sessionStore.findInRange(startDate, endDate, hid);
  }

  /**
   * Save/update a session
   * @param {Object} sessionData - Raw session data (v2 or v3 format)
   * @param {string} householdId - Household ID
   */
  /**
   * Append a voice memo to a historical session's persisted YAML.
   *
   * Used by the /voice_memo route when the target session is no longer
   * actively running (retroactive capture from the session-history
   * detail view). For an actively running session, the frontend's
   * voiceMemoManager handles in-memory persistence and the next tick
   * save writes to YAML — so the route skips this call in that case
   * to avoid double-writes / races.
   *
   * @param {string} sessionId
   * @param {string} householdId
   * @param {Object} memo
   * @returns {Promise<Object|null>}
   */
  async appendVoiceMemo(sessionId, householdId, memo) {
    const hid = this.resolveHouseholdId(householdId);
    return this.sessionStore.appendVoiceMemo(sessionId, hid, memo);
  }

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
    session.replaceTimeline(prepareTimelineForStorage(session.timeline));

    // Merge with existing file to preserve snapshots
    const existing = await this.sessionStore.findById(sanitizedId, hid);
    if (existing?.snapshots) {
      session.replaceSnapshots(existing.snapshots);
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
    session.replaceTimeline(prepareTimelineForStorage(session.timeline));
    await this.sessionStore.save(session, this.resolveHouseholdId(householdId));
    return session;
  }

  /**
   * Find a resumable session for the given content ID.
   * A session is resumable if:
   * - Same date (today)
   * - Same media.primary.contentId
   * - Ended less than maxGapMs ago
   *
   * @param {string} contentId - Media content ID (e.g., "plex:674227")
   * @param {string} householdId - Household ID
   * @param {Object} [options]
   * @param {number} [options.maxGapMs=1800000] - Max gap in ms (default 30 min)
   * @returns {Promise<{resumable: boolean, session?: Object, finalized?: boolean}>}
   */
  async findResumable(contentId, householdId, { maxGapMs = 30 * 60 * 1000 } = {}) {
    if (!contentId) return { resumable: false };

    // Defensive normalization: callers (especially the frontend pre-2026-05-06)
    // may send a bare local id like '664042' instead of 'plex:664042'. The
    // session YAML always stores the prefixed form, so a bare id would never
    // match. Prefix bare numeric/string ids with 'plex:' as the fitness app
    // default.
    const normalizedContentId = String(contentId).includes(':')
      ? String(contentId)
      : `plex:${contentId}`;

    const hid = this.resolveHouseholdId(householdId);
    // Use local date (not UTC) since session dates are stored in local time
    const now_ = new Date();
    const today = `${now_.getFullYear()}-${String(now_.getMonth() + 1).padStart(2, '0')}-${String(now_.getDate()).padStart(2, '0')}`;
    const now = Date.now();

    this.logger?.info?.('fitness.resumable.check.start', { contentId: normalizedContentId, householdId: hid, today });

    let sessions;
    try {
      sessions = await this.sessionStore.findByDate(today, hid);
    } catch {
      return { resumable: false };
    }

    if (!Array.isArray(sessions) || sessions.length === 0) return { resumable: false };

    // Filter: same contentId, ended within maxGapMs, not explicitly finalized.
    // A finalized session was ended by the user via POST /sessions/:id/end — a
    // "clean split" — and must not be offered for auto-merge.
    const candidates = sessions.filter(s => {
      if (s.finalized) return false;

      const mediaId = s.media?.primary?.contentId
        || s.contentId
        || null;
      if (mediaId !== normalizedContentId) return false;

      // Must have an endTime (session is over, not active)
      const endTime = typeof s.endTime === 'number' ? s.endTime
        : (s.startTime && s.durationMs ? s.startTime + s.durationMs : null);
      if (!endTime) return false;

      return (now - endTime) < maxGapMs;
    });

    this.logger?.info?.('fitness.resumable.check.candidates', {
      contentId: normalizedContentId,
      totalSessions: sessions.length,
      candidateCount: candidates.length,
      rejected: sessions.length - candidates.length,
      candidateIds: candidates.map(c => c.sessionId || c.session?.id).filter(Boolean)
    });

    if (candidates.length === 0) {
      this.logger?.info?.('fitness.resumable.check.no_match', { contentId: normalizedContentId });
      return { resumable: false };
    }

    // Take the most recent by endTime
    candidates.sort((a, b) => {
      const endA = typeof a.endTime === 'number' ? a.endTime : (a.startTime + (a.durationMs || 0));
      const endB = typeof b.endTime === 'number' ? b.endTime : (b.startTime + (b.durationMs || 0));
      return endB - endA;
    });

    const match = candidates[0];
    const sessionId = match.sessionId || match.session?.id;

    // Load full session data for the frontend to hydrate from
    const fullSession = await this.getSession(sessionId, hid, { decodeTimeline: true });
    if (!fullSession) return { resumable: false };

    this.logger?.info?.('fitness.resumable.check.match', {
      contentId: normalizedContentId,
      matchedSessionId: sessionId,
      finalized: !!fullSession.finalized,
      ageMs: now - (typeof match.endTime === 'number' ? match.endTime : (match.startTime + (match.durationMs || 0)))
    });

    return {
      resumable: true,
      session: fullSession.toJSON(),
      finalized: !!fullSession.finalized
    };
  }

  /**
   * Merge source session into target session.
   * Source timeline is prepended to target's with null-filled gap.
   * Source session file is deleted after merge.
   *
   * @param {string} sourceSessionId - Session to merge from (earlier)
   * @param {string} targetSessionId - Session to merge into (later, keeps its ID)
   * @param {string} householdId - Household ID
   * @returns {Promise<Object>} Merged session
   */
  async mergeSessions(sourceSessionId, targetSessionId, householdId) {
    const hid = this.resolveHouseholdId(householdId);
    const srcId = Session.sanitizeSessionId(sourceSessionId);
    const tgtId = Session.sanitizeSessionId(targetSessionId);
    if (!srcId || !tgtId) {
      throw new ValidationError('Both sourceSessionId and targetSessionId are required');
    }

    const source = await this.getSession(srcId, hid, { decodeTimeline: true });
    const target = await this.getSession(tgtId, hid, { decodeTimeline: true });
    if (!source) throw new EntityNotFoundError('Session', srcId);
    if (!target) throw new EntityNotFoundError('Session', tgtId);

    // Refuse to merge if either side was explicitly finalized. That flag is
    // set when the user hits "End Session" and means "do not auto-merge."
    if (source.finalized || target.finalized) {
      throw new ValidationError(
        'Cannot merge a finalized session',
        { code: 'SESSION_FINALIZED', sourceFinalized: !!source.finalized, targetFinalized: !!target.finalized }
      );
    }

    // Determine which is earlier
    const srcStart = source.startTime;
    const tgtStart = target.startTime;
    const [earlier, later] = srcStart <= tgtStart ? [source, target] : [target, source];

    // Calculate gap ticks
    const earlierEnd = earlier.endTime || (earlier.startTime + (earlier.durationMs || 0));
    const laterStart = later.startTime;
    const intervalMs = (earlier.timeline?.interval_seconds || 5) * 1000;
    const gapMs = Math.max(0, laterStart - earlierEnd);
    const gapTicks = Math.floor(gapMs / intervalMs);

    // Merge timelines (both already decoded from getSession with decodeTimeline: true)
    const merged = mergeTimelines(earlier.timeline, later.timeline, gapTicks);

    // Update target with merged data
    target.startTime = earlier.startTime;
    target.durationMs = (target.endTime || Date.now()) - earlier.startTime;
    target.replaceTimeline(prepareTimelineForStorage(merged));

    // Merge participants (union, target wins on conflict)
    if (earlier.participants && typeof earlier.participants === 'object') {
      for (const [key, val] of Object.entries(earlier.participants)) {
        if (!target.participants[key]) {
          target.participants[key] = val;
        }
      }
    }

    // Merge v3 events at root level
    if (Array.isArray(earlier.events) && earlier.events.length > 0) {
      target.events = [...earlier.events, ...(target.events || [])].sort(
        (a, b) => (a?.timestamp || 0) - (b?.timestamp || 0)
      );
    }

    // Merge treasureBox coins
    if (earlier.treasureBox && target.treasureBox) {
      target.treasureBox.totalCoins = (target.treasureBox.totalCoins || 0)
        + (earlier.treasureBox.totalCoins || 0);
    } else if (earlier.treasureBox && !target.treasureBox) {
      target.treasureBox = earlier.treasureBox;
    }

    // Update session block timestamps
    if (target.session) {
      target.session.duration_seconds = Math.round(target.durationMs / 1000);
    }

    // Merge strava (target wins)
    if (!target.strava && earlier.strava) target.strava = earlier.strava;
    if (!target.strava_notes && earlier.strava_notes) target.strava_notes = earlier.strava_notes;

    // Save merged target, delete source
    await this.sessionStore.save(target, hid);
    await this.sessionStore.delete(srcId, hid);

    return target;
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
    session.removeDuplicateSnapshot(capture.filename);

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
