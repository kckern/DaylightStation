/**
 * Generates fake Strava activity data
 */

export function generateStravaActivities(user, options = {}) {
  const { count = 10, startDate = new Date() } = options;
  const activities = [];

  for (let i = 0; i < count; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() - i);

    activities.push({
      id: `strava-${user}-${i}`,
      user,
      type: ['Run', 'Ride', 'Swim'][i % 3],
      name: `${user}'s ${['Morning', 'Afternoon', 'Evening'][i % 3]} Workout`,
      start_date: date.toISOString(),
      elapsed_time: 1800 + Math.random() * 3600,
      distance: 5000 + Math.random() * 10000,
      average_heartrate: 120 + Math.random() * 40,
      max_heartrate: 160 + Math.random() * 30,
    });
  }

  return activities;
}
