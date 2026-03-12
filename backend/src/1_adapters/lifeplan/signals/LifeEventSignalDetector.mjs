/**
 * Scans calendar and other sources for potential life event signals.
 * Returns suggested events for user confirmation.
 */
export class LifeEventSignalDetector {
  constructor(config = {}) {
    this.patterns = config.patterns || DEFAULT_PATTERNS;
  }

  detectFromLifelog(lifelogDays) {
    const suggestions = [];

    for (const [date, day] of Object.entries(lifelogDays || {})) {
      const calendarData = day.sources?.calendar || day.categories?.calendar?.calendar;
      if (!calendarData) continue;

      const events = Array.isArray(calendarData) ? calendarData : calendarData.events || [];

      for (const event of events) {
        const summary = (event.summary || event.name || '').toLowerCase();

        for (const pattern of this.patterns) {
          if (pattern.keywords.some(kw => summary.includes(kw))) {
            suggestions.push({
              date,
              type: pattern.type,
              name: event.summary || event.name,
              source: 'calendar',
              pattern: pattern.type,
              confidence: pattern.confidence || 0.7,
            });
          }
        }
      }
    }

    return suggestions;
  }
}

const DEFAULT_PATTERNS = [
  { type: 'relocation', keywords: ['moving day', 'new apartment', 'house closing'], confidence: 0.8 },
  { type: 'job_change', keywords: ['first day', 'onboarding', 'resignation', 'last day'], confidence: 0.7 },
  { type: 'health_event', keywords: ['surgery', 'hospital', 'doctor follow-up', 'diagnosis'], confidence: 0.8 },
  { type: 'family_event', keywords: ['wedding', 'birth', 'funeral', 'anniversary'], confidence: 0.9 },
  { type: 'travel', keywords: ['flight', 'departure', 'arrival', 'hotel check'], confidence: 0.6 },
  { type: 'education', keywords: ['graduation', 'orientation', 'first class', 'exam'], confidence: 0.7 },
];
