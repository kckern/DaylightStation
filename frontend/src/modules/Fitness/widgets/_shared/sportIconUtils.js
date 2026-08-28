// sportIconUtils.js — pure helpers shared by SportIcon.jsx and callers that
// need its seeded color or label without the icon component itself, split
// out so Fast Refresh can hot-reload the icon component on its own.

/**
 * Generate a deterministic hue from a string (sessionId).
 * Returns a hue 0-360 for use in HSL colors.
 */
export function seededHue(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

/**
 * Format a Strava type into a human-readable label.
 */
export function formatSportType(type) {
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
