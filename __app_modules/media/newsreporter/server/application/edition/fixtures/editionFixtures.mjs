/** Shared fixtures for the edition reporter tests. */

export function sampleEditionConfig(overrides = {}) {
  return {
    enabled: true,
    kind: 'edition',
    title: 'The Daylight Ledger',
    schedule: '30 5 * * *',
    deliver: { printer: 'office', fallback: false, once_per_day: true, expires_after: '12:00' },
    length: { target_cm: 50, max_cm: 60 },
    model: null,
    voice: 'Wry, plain-spoken.',
    news: {
      user: 'reader',
      pages: ['mainstream'],
      max_age_hours: 18,
      dedupe_editions: 3,
      lead: { enabled: true, sentences: 4 },
      categories: [
        { id: 'us', label: 'Nation', stories: 3, balance: 'lean' },
        { id: 'world', label: 'World', stories: 3 },
        { id: 'tech', label: 'Technology', sources: ['arstechnica', 'bbc'], stories: 2 },
        { id: 'local', label: 'Utah', sources: ['ksl'], stories: 2, optional: true },
      ],
    },
    day: {
      weather: { show: 'always' },
      calendar: { show: 'always', max: 5 },
      todoist: { show: 'always', max: 4 },
      yesterday: { show: 'rotate', weight: 2, parts: ['strava', 'health'] },
      school: { show: 'weekdays' },
      reflective: { show: 'rotate', weight: 1, parts: ['immich', 'journal', 'gratitude'] },
      rotation: { slots: 1 },
    },
    ...overrides,
  };
}
