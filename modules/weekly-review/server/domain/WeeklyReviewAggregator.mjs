// backend/src/2_domains/weekly-review/WeeklyReviewAggregator.mjs

const MIN_COLUMN_WEIGHT = 0.5;

export class WeeklyReviewAggregator {
  static aggregate(photoDays, calendarDays, fitnessByDate = {}, weatherByDate = {}) {
    const calendarByDate = new Map();
    for (const day of calendarDays) {
      calendarByDate.set(day.date, day.events || []);
    }

    const maxPhotoCount = Math.max(1, ...photoDays.map(d => d.photoCount));

    const days = photoDays.map(photoDay => {
      const date = new Date(`${photoDay.date}T12:00:00Z`);
      const contentScore = photoDay.photoCount + (calendarByDate.get(photoDay.date)?.length || 0);
      const columnWeight = Math.max(MIN_COLUMN_WEIGHT, contentScore / maxPhotoCount);

      return {
        date: photoDay.date,
        label: date.toLocaleDateString('en-US', { weekday: 'short' }),
        dayOfWeek: date.getDay(),
        calendar: calendarByDate.get(photoDay.date) || [],
        photos: photoDay.photos,
        photoCount: photoDay.photoCount,
        sessions: photoDay.sessions,
        fitness: fitnessByDate[photoDay.date] || [],
        weather: weatherByDate[photoDay.date] || null,
        columnWeight,
      };
    });

    return { days };
  }
}
