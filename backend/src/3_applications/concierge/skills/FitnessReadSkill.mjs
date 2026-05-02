export class FitnessReadSkill {
  static name = 'fitness_read';

  #fit;
  #logger;
  #config;

  constructor({ fitness, logger = console, config = {} }) {
    if (!fitness?.recentWorkouts) throw new Error('FitnessReadSkill: fitness (IFitnessRead) required');
    this.#fit = fitness;
    this.#logger = logger;
    this.#config = { ...config };
  }

  get name() { return FitnessReadSkill.name; }
  getConfig() { return { ...this.#config }; }

  getPromptFragment(_s) {
    return `## Fitness
- \`recent_workouts\` lists workouts in the last N days.
- \`fitness_summary\` totals minutes and types of activity over a period.`;
  }

  getTools() {
    const fit = this.#fit;
    const log = this.#logger;
    return [
      {
        name: 'recent_workouts',
        description: 'List recent workouts (default: last 7 days).',
        parameters: {
          type: 'object',
          properties: { days: { type: 'number' }, limit: { type: 'number' } },
        },
        async execute({ days = 7, limit = 10 }) {
          const workouts = await fit.recentWorkouts({ days, limit });
          log.info?.('concierge.skill.fitness.workouts', { days, count: workouts.length });
          return { workouts };
        },
      },
      {
        name: 'fitness_summary',
        description: 'Summary of activity totals over the past N days (default: 30).',
        parameters: { type: 'object', properties: { period_days: { type: 'number' } } },
        async execute({ period_days = 30 }) {
          const summary = await fit.fitnessSummary({ periodDays: period_days });
          log.info?.('concierge.skill.fitness.summary', { periodDays: period_days });
          return summary;
        },
      },
    ];
  }
}

export default FitnessReadSkill;
