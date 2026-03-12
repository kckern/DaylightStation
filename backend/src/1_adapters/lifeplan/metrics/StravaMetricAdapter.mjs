/**
 * Extracts fitness metrics from Strava lifelog data.
 */
export class StravaMetricAdapter {
  #userLoadFile;

  constructor({ userLoadFile }) {
    this.#userLoadFile = userLoadFile;
  }

  getMetricValue(username, measure, date) {
    const data = this.#userLoadFile?.(username, 'strava');
    if (!data) return null;

    // Strava data keyed by date
    const dayData = Array.isArray(data)
      ? data.find(d => d.date === date || d.start_date?.startsWith(date))
      : data[date];

    if (!dayData) return null;

    switch (measure) {
      case 'distance_km': return (dayData.distance || 0) / 1000;
      case 'duration_minutes': return (dayData.moving_time || dayData.elapsed_time || 0) / 60;
      case 'calories': return dayData.calories || 0;
      case 'elevation_m': return dayData.total_elevation_gain || 0;
      case 'sessions': return 1;
      default: return dayData[measure] ?? null;
    }
  }
}
