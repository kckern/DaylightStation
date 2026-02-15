/**
 * Fitness Domain Types
 * 
 * Explicit domain models for fitness module concepts.
 * These types serve as the single source of truth for key concepts
 * like participant status, activity periods, and chart segments.
 * 
 * @see /docs/notes/fitness-architecture-review.md for rationale
 */

/**
 * Participant status in a fitness session.
 * Single source of truth for activity state.
 * 
 * State transitions:
 *   ABSENT → ACTIVE (first broadcast)
 *   ACTIVE → IDLE (no data for N ticks)
 *   IDLE → ACTIVE (resumed broadcasting)
 *   ACTIVE/IDLE → REMOVED (timeout exceeded)
 */
export const ParticipantStatus = Object.freeze({
  /** Never seen in this session */
  ABSENT: 'absent',
  /** Currently broadcasting HR data */
  ACTIVE: 'active',
  /** Was active but stopped broadcasting (dropout) */
  IDLE: 'idle',
  /** Removed from session after timeout */
  REMOVED: 'removed'
});

/**
 * @typedef {keyof typeof ParticipantStatus} ParticipantStatusKey
 * @typedef {typeof ParticipantStatus[ParticipantStatusKey]} ParticipantStatusValue
 */

/**
 * Check if a status indicates the participant is currently in the session
 * @param {ParticipantStatusValue} status 
 * @returns {boolean}
 */
export const isInSession = (status) => {
  return status === ParticipantStatus.ACTIVE || status === ParticipantStatus.IDLE;
};

/**
 * Check if a status indicates the participant is actively broadcasting
 * @param {ParticipantStatusValue} status 
 * @returns {boolean}
 */
export const isBroadcasting = (status) => {
  return status === ParticipantStatus.ACTIVE;
};

/**
 * Check if a status indicates a dropout period (for chart rendering)
 * @param {ParticipantStatusValue} status 
 * @returns {boolean}
 */
export const isDropout = (status) => {
  return status === ParticipantStatus.IDLE;
};

/**
 * Activity period for a participant.
 * Represents a contiguous time range with a consistent status.
 * 
 * @typedef {Object} ActivityPeriod
 * @property {number} startTick - First tick index of this period (inclusive)
 * @property {number} endTick - Last tick index of this period (inclusive)
 * @property {ParticipantStatusValue} status - Status during this period
 * @property {number} [startTimestamp] - Optional timestamp for startTick
 * @property {number} [endTimestamp] - Optional timestamp for endTick
 */

/**
 * Create an ActivityPeriod object
 * @param {number} startTick 
 * @param {number} endTick 
 * @param {ParticipantStatusValue} status 
 * @param {Object} [options]
 * @param {number} [options.startTimestamp]
 * @param {number} [options.endTimestamp]
 * @returns {ActivityPeriod}
 */
export const createActivityPeriod = (startTick, endTick, status, options = {}) => ({
  startTick,
  endTick,
  status,
  ...(options.startTimestamp != null && { startTimestamp: options.startTimestamp }),
  ...(options.endTimestamp != null && { endTimestamp: options.endTimestamp })
});

/**
 * Data point for chart rendering
 * @typedef {Object} ChartDataPoint
 * @property {number} tick - Tick index (x-axis position)
 * @property {number} value - Metric value (y-axis position)
 * @property {string} [zone] - HR zone at this point (cool, active, warm, hot, fire)
 */

/**
 * Chart segment representing a portion of a participant's line.
 * Each segment has consistent styling (solid for active, dashed for dropout).
 * 
 * @typedef {Object} ChartSegment
 * @property {string} participantId - Participant identifier
 * @property {ParticipantStatusValue} status - Status during this segment
 * @property {ChartDataPoint[]} points - Data points in this segment
 * @property {string} color - Stroke color for rendering
 * @property {boolean} isGap - Whether this is a dropout/gap segment
 * @property {string} [zone] - Primary HR zone for this segment
 */

/**
 * Segment style derived from status
 */
export const SegmentStyle = Object.freeze({
  SOLID: 'solid',
  DASHED: 'dashed'
});

/**
 * Get the visual style for a segment based on status
 * @param {ParticipantStatusValue} status 
 * @returns {typeof SegmentStyle[keyof typeof SegmentStyle]}
 */
export const getSegmentStyle = (status) => {
  return isDropout(status) ? SegmentStyle.DASHED : SegmentStyle.SOLID;
};

/**
 * Create a ChartSegment object
 * @param {Object} params
 * @param {string} params.participantId
 * @param {ParticipantStatusValue} params.status
 * @param {ChartDataPoint[]} params.points
 * @param {string} params.color
 * @param {string} [params.zone]
 * @returns {ChartSegment}
 */
export const createChartSegment = ({ participantId, status, points, color, zone }) => ({
  participantId,
  status,
  points: points || [],
  color,
  isGap: isDropout(status),
  ...(zone && { zone })
});

/**
 * Zone colors for chart rendering
 * Matches existing ZONE_COLOR_MAP but centralized here
 */
export const ZoneColors = Object.freeze({
  cool: '#6ab8ff',
  active: '#51cf66',
  warm: '#ffd43b',
  hot: '#ff922b',
  fire: '#ff6b6b',
  default: '#888888'
});

/**
 * Get color for a zone
 * @param {string|null} zone 
 * @returns {string}
 */
export const getZoneColor = (zone) => {
  return ZoneColors[zone] || ZoneColors.default;
};

/**
 * Participant summary for roster display
 * @typedef {Object} ParticipantSummary
 * @property {string} id - Unique identifier
 * @property {string} name - Display name
 * @property {string} [profileId] - User profile ID
 * @property {ParticipantStatusValue} status - Current status
 * @property {number} [lastActiveAt] - Last tick when actively broadcasting
 * @property {number} [totalBeats] - Cumulative heart beats
 * @property {string} [currentZone] - Current HR zone
 * @property {string} [avatarUrl] - Avatar image URL
 */

/**
 * Create a ParticipantSummary object
 * @param {Object} params
 * @returns {ParticipantSummary}
 */
export const createParticipantSummary = ({
  id,
  name,
  profileId,
  status = ParticipantStatus.ABSENT,
  lastActiveAt,
  totalBeats,
  currentZone,
  avatarUrl
}) => ({
  id,
  name,
  profileId: profileId || id,
  status,
  ...(lastActiveAt != null && { lastActiveAt }),
  ...(totalBeats != null && { totalBeats }),
  ...(currentZone && { currentZone }),
  ...(avatarUrl && { avatarUrl })
});
