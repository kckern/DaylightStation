export class CalendarReadSkill {
  static name = 'calendar_read';

  #cal;
  #logger;
  #config;

  constructor({ calendar, logger = console, config = {} }) {
    if (!calendar?.getEvents) throw new Error('CalendarReadSkill: calendar (ICalendarRead) required');
    this.#cal = calendar;
    this.#logger = logger;
    this.#config = { lookback_days: 0, lookahead_days: 7, default_calendars: null, ...config };
  }

  get name() { return CalendarReadSkill.name; }
  getConfig() { return { ...this.#config }; }

  getPromptFragment(_s) {
    return `## Calendar
Use \`get_calendar_events\` to read events. Default range is the next 7 days; you can specify dates explicitly.`;
  }

  getTools() {
    const cal = this.#cal;
    const cfg = this.#config;
    const log = this.#logger;
    return [
      {
        name: 'get_calendar_events',
        description: 'Read calendar events in a time range (default: next 7 days).',
        parameters: {
          type: 'object',
          properties: {
            range_from: { type: 'string', description: 'ISO start (default: now)' },
            range_to: { type: 'string', description: 'ISO end (default: +7d)' },
            limit: { type: 'number' },
          },
        },
        async execute({ range_from, range_to, limit = 20 }) {
          const from = range_from ?? new Date().toISOString();
          const to = range_to ?? new Date(Date.now() + cfg.lookahead_days * 86_400_000).toISOString();
          const start = Date.now();
          const events = await cal.getEvents({ rangeFrom: from, rangeTo: to, limit, calendars: cfg.default_calendars });
          log.info?.('concierge.skill.calendar.read', { range: `${from}..${to}`, count: events.length, latencyMs: Date.now() - start });
          return { events };
        },
      },
    ];
  }
}

export default CalendarReadSkill;
