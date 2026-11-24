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

/** A full edition layout (renderer input), written to read like a real morning. */
export function sampleLayout() {
  return {
    masthead: {
      title: 'The Daylight Ledger',
      tagline: 'All the news that fits the roll',
      dateLabel: 'Tuesday, November 24, 2026',
      number: 142,
      weatherLabel: '41°/22°',
    },
    blocks: [
      { type: 'weather', condition: 'Light snow', high: 41, low: 22, precipPct: 65, note: 'Snow tapers by noon; roads slick before 9.' },
      {
        type: 'agenda', label: 'Today',
        items: [
          { time: '9:00 AM', text: 'Staff sync' },
          { time: '12:30 PM', text: 'Lunch with the planning committee at the usual place' },
          { time: null, text: 'Thanksgiving time off starts' },
        ],
      },
      {
        type: 'tasks', label: 'To do',
        items: [
          { text: 'Renew vehicle registration', overdue: true },
          { text: 'Order the turkey', overdue: false },
        ],
      },
      {
        type: 'lead',
        headline: 'Chipmaker reinstates its chief after a weekend of pressure',
        body: "The board voted late Sunday to bring back its founder, two days after removing him over an undisclosed relationship. Investors cheered: the stock recovered most of Friday's fall in after-hours trading. Officials in Washington said they had urged the reversal; the company would not say whether that mattered. Questions about the board's own process are not going away.",
        sources: ['BBC News', 'Reuters', 'WSJ'],
      },
      {
        type: 'section', label: 'Nation',
        stories: [
          {
            headline: 'Senate clears the stopgap with hours to spare',
            body: 'The bill funds the government through January 30 and leaves the harder fights over spending levels for the new year. Both leaders called it a win; neither sounded thrilled.',
            sources: ['AP', 'Fox News'],
          },
          {
            headline: "Holiday travel expected to break last year's record",
            body: 'Airlines project more than three million passengers on Sunday alone. Forecasters warn of storms across the Midwest midweek.',
            sources: ['CBS News'],
          },
        ],
      },
      {
        type: 'section', label: 'World',
        stories: [
          {
            headline: 'NATO chief vows defence against threats in orbit',
            body: 'German media reported plans for a nuclear-armed satellite. Moscow called the reports provocations and denied any such program; NATO did not confirm the claim.',
            sources: ['BBC News', 'Al Jazeera'],
          },
        ],
      },
      {
        type: 'section', label: 'Technology',
        stories: [
          {
            headline: 'A browser engine nobody expected takes its first steps',
            body: 'An independent team shipped an alpha that renders most of the top thousand sites. It is slow and proud of it.',
            sources: ['Ars Technica'],
          },
        ],
      },
      {
        type: 'briefs', label: 'In brief',
        items: [
          { text: 'Mortgage rates dip for a third straight week.', source: 'WSJ' },
          { text: 'A rare bird draws crowds to a Salt Lake City parking lot.', source: 'KSL' },
        ],
      },
      { type: 'note', label: 'Yesterday', text: '42 min ride, 6.1 mi, avg 132 bpm. 9,840 steps.' },
      { type: 'note', label: 'School', text: 'Sam 5 of 6 done, 3 silver. Riley 6 of 6 done.' },
      { type: 'note', label: 'From the photos', text: 'Five years ago today: the lake house, everyone in hats.' },
      { type: 'footer', text: 'Composed 5:31 AM from 214 headlines · 9 stories' },
    ],
  };
}
