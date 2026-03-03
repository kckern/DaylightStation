import React from 'react';

/**
 * Generate a deterministic hue from a string (sessionId).
 * Returns a hue 0-360 for use in HSL colors.
 */
function seededHue(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

/**
 * Format a Strava type into a human-readable label.
 */
function formatSportType(type) {
  if (!type) return null;
  const labels = {
    Run: 'Run',
    Ride: 'Ride',
    WeightTraining: 'Weight Training',
    Workout: 'Workout',
    Yoga: 'Yoga',
    Walk: 'Walk',
    Hike: 'Hike',
    Swim: 'Swim',
    MountainBikeRide: 'Mountain Bike',
    VirtualRide: 'Virtual Ride',
    TrailRun: 'Trail Run',
    VirtualRun: 'Virtual Run',
  };
  return labels[type] || type.replace(/([A-Z])/g, ' $1').trim();
}

const SPORT_ICONS = {
  Run: (
    <path d="M26 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm6.5 14.5-4-2.5-5.5 1 3 7-4.5 5.5L16 42h4l3.5-8 4 4V42h4V35l-4.5-6 1.5-4 3.5 3h5v-4h-3l-2-3.5z" fill="currentColor" />
  ),
  Ride: (
    <path d="M34 14l-2.5 2.5L35 20h-5l-4.5-4.5-7.5 7.5 4.5 4.5V34h3v-8l-3.5-3.5 5-5L30 16l2 3h4v-3l-2-2zM14 23a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 3a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm20-3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 3a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM28 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8z" fill="currentColor" />
  ),
  WeightTraining: (
    <path d="M6 20h6v8H6zm30 0h6v8h-6zM2 21h4v6H2zm38 0h6v6h-6zM12 22h24v4H12z" fill="currentColor" opacity="0.85" />
  ),
  Yoga: (
    <path d="M24 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm-8 32l6-14 2 6h-4v2h5l1 6h3l-1-6h5v-2h-4l2-6 6 14h3L31 18h-2l-5 2-5-2h-2L9 36h3z" fill="currentColor" />
  ),
  Walk: (
    <path d="M24 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm2 10h-4l-5 10 3.5 1.5L23 20v8l-5 14h4l3.5-10L29 42h4l-5-14v-8l2.5 5.5L34 24l-5-10h-3z" fill="currentColor" />
  ),
  Hike: (
    <path d="M24 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm2 10h-4l-5 10 3.5 1.5L23 20v8l-5 14h4l3.5-10L29 42h4l-5-14v-8l2.5 5.5L34 24l-5-10h-3zM38 18l-4 8h8l-4-8z" fill="currentColor" />
  ),
  Swim: (
    <path d="M8 30c2 0 3-1.5 4-3s2-3 4-3 3 1.5 4 3 2 3 4 3 3-1.5 4-3 2-3 4-3 3 1.5 4 3 2 3 4 3v3c-3 0-5-1.5-6-3s-2-3-2-3-1 1.5-2 3-3 3-6 3-5-1.5-6-3-2-3-2-3-1 1.5-2 3-3 3-6 3v-3zm0 8c2 0 3-1.5 4-3s2-3 4-3 3 1.5 4 3 2 3 4 3 3-1.5 4-3 2-3 4-3 3 1.5 4 3 2 3 4 3v3c-3 0-5-1.5-6-3s-2-3-2-3-1 1.5-2 3-3 3-6 3-5-1.5-6-3-2-3-2-3-1 1.5-2 3-3 3-6 3v-3zM36 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-2 1l-14 5 2 3 8-3-3 7H12v3h18l4-12z" fill="currentColor" />
  ),
  Workout: (
    <>
      <rect x="6" y="20" width="6" height="8" rx="1.5" fill="currentColor" opacity="0.5" />
      <rect x="36" y="20" width="6" height="8" rx="1.5" fill="currentColor" opacity="0.5" />
      <rect x="2" y="21" width="4" height="6" rx="1" fill="currentColor" opacity="0.35" />
      <rect x="42" y="21" width="4" height="6" rx="1" fill="currentColor" opacity="0.35" />
      <rect x="12" y="22" width="24" height="4" rx="1" fill="currentColor" opacity="0.4" />
    </>
  ),
};

function resolveIconType(stravaType) {
  if (!stravaType) return 'Workout';
  if (SPORT_ICONS[stravaType]) return stravaType;
  const aliases = {
    MountainBikeRide: 'Ride',
    VirtualRide: 'Ride',
    EBikeRide: 'Ride',
    GravelRide: 'Ride',
    TrailRun: 'Run',
    VirtualRun: 'Run',
  };
  return aliases[stravaType] || 'Workout';
}

/**
 * Sport-type SVG icon with sessionId-seeded background color.
 *
 * @param {Object} props
 * @param {string} props.type - Strava activity type
 * @param {string} props.sessionId - Seeds the background color
 * @param {string} [props.className]
 * @param {'poster'|'detail'} [props.variant='poster']
 */
export default function SportIcon({ type, sessionId, className = '', variant = 'poster' }) {
  const iconKey = resolveIconType(type);
  const hue = seededHue(sessionId || 'default');
  const bgColor = `hsl(${hue}, 35%, 25%)`;
  const iconColor = `hsl(${hue}, 40%, 70%)`;

  return (
    <div
      className={`sport-icon sport-icon--${variant} ${className}`}
      style={{
        backgroundColor: bgColor,
        color: iconColor,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: variant === 'poster' ? '4px' : '8px',
        aspectRatio: variant === 'poster' ? '2/3' : undefined,
        width: '100%',
        height: '100%',
      }}
    >
      <svg viewBox="0 0 48 48" fill="none" style={{ width: variant === 'poster' ? '60%' : '40%', height: 'auto' }}>
        {SPORT_ICONS[iconKey] || SPORT_ICONS.Workout}
      </svg>
    </div>
  );
}

export { seededHue, resolveIconType, formatSportType, SPORT_ICONS };
