export class LifelogReadSkill {
  static name = 'lifelog_read';

  #lifelog;
  #logger;
  #config;

  constructor({ lifelog, logger = console, config = {} }) {
    if (!lifelog?.recentEntries) throw new Error('LifelogReadSkill: lifelog (ILifelogRead) required');
    this.#lifelog = lifelog;
    this.#logger = logger;
    this.#config = { default_username: 'household', max_days: 14, ...config };
  }

  get name() { return LifelogReadSkill.name; }
  getConfig() { return { ...this.#config }; }

  getPromptFragment(_s) {
    return `## Lifelog & Journal
Use \`recent_lifelog_entries\` to read what's been logged in the last few days.
Use \`query_journal\` to find specific text in recent journal entries.
Be respectful — these are personal notes.`;
  }

  getTools() {
    const ll = this.#lifelog;
    const cfg = this.#config;
    const log = this.#logger;
    return [
      {
        name: 'recent_lifelog_entries',
        description: 'Read recent lifelog entries from the past N days.',
        parameters: {
          type: 'object',
          properties: {
            days: { type: 'number' },
            kinds: { type: 'array', items: { type: 'string' } },
          },
        },
        async execute({ days = 3, kinds }) {
          const capped = Math.min(cfg.max_days, Math.max(1, days));
          const entries = await ll.recentEntries({ days: capped, kinds, username: cfg.default_username });
          log.info?.('concierge.skill.lifelog.read', { days: capped, count: entries.length });
          return { entries };
        },
      },
      {
        name: 'query_journal',
        description: 'Search recent journal entries for a phrase.',
        parameters: {
          type: 'object',
          properties: { text: { type: 'string' }, limit: { type: 'number' } },
          required: ['text'],
        },
        async execute({ text, limit = 5 }) {
          const hits = await ll.queryJournal({ text, limit, username: cfg.default_username });
          log.info?.('concierge.skill.lifelog.query', { text_length: text.length, hit_count: hits.length });
          return { hits };
        },
      },
    ];
  }
}

export default LifelogReadSkill;
