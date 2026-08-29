import { Session } from '#domains/fitness/entities/Session.mjs';

/** Project a Session for application-facing result/event records. */
export function serializeSession(session) {
  // Some ports return an already-shaped storage/read DTO. Preserve it exactly;
  // only domain Session instances need projection at this application boundary.
  if (typeof session?.getDurationMs !== 'function') {
    return typeof session?.toJSON === 'function' ? session.toJSON() : session;
  }
  const hasV3Session = !!session.session;
  const hasV3Participants = Object.keys(session.participants).length > 0;
  const result = { version: session.version, sessionId: session.sessionId.toString() };
  if (hasV3Session) result.session = session.session;
  if (session.timezone) result.timezone = session.timezone;
  if (hasV3Participants) result.participants = session.participants;
  if (!hasV3Session) {
    result.startTime = session.startTime;
    result.endTime = session.endTime;
    result.durationMs = session.durationMs;
  }
  if (!hasV3Participants) result.roster = session.roster;
  result.timeline = session.timeline;
  if (session.events.length > 0 && !(session.timeline?.events?.length > 0)) result.events = session.events;
  if (session.treasureBox) result.treasureBox = session.treasureBox;
  if (session.summary) result.summary = session.summary;
  if (session.strava) result.strava = session.strava;
  if (session.strava_notes) result.strava_notes = session.strava_notes;
  if (session.finalized) result.finalized = session.finalized;
  if (session.provisional) result.provisional = session.provisional;
  if (session.entities.length > 0) result.entities = session.entities;
  const hasSnapshots = session.snapshots &&
    ((Array.isArray(session.snapshots.captures) && session.snapshots.captures.length > 0) || session.snapshots.updatedAt != null);
  if (hasSnapshots) result.snapshots = session.snapshots;
  if (session.metadata && Object.keys(session.metadata).length > 0) result.metadata = session.metadata;
  if (session.timelapse) result.timelapse = session.timelapse;
  if (session.strength?.runs?.length > 0) result.strength = session.strength;
  return result;
}

/** Reconstitute a Session from an adapter record, including the legacy `id` key. */
export function reconstituteSession(record) {
  return new Session({ ...record, sessionId: record.sessionId || record.id });
}
