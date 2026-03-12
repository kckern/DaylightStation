export class RetroService {
  #lifePlanStore;
  #feedbackService;
  #driftService;

  constructor({ lifePlanStore, feedbackService, driftService }) {
    this.#lifePlanStore = lifePlanStore;
    this.#feedbackService = feedbackService;
    this.#driftService = driftService;
  }

  generateRetro(username, period) {
    const plan = this.#lifePlanStore.load(username);
    if (!plan) return null;

    const feedback = this.#feedbackService.getFeedback(username, period);

    const goals = plan.goals || [];
    const goalSummary = {
      total: goals.length,
      active: goals.filter(g => !['achieved', 'failed', 'abandoned'].includes(g.state)).length,
      achieved: goals.filter(g => g.state === 'achieved').length,
      failed: goals.filter(g => g.state === 'failed').length,
      goals: goals.map(g => ({ id: g.id, name: g.name, state: g.state, progress: g.progress })),
    };

    const beliefs = plan.beliefs || [];
    const beliefSummary = {
      total: beliefs.length,
      confirmed: beliefs.filter(b => b.state === 'confirmed').length,
      refuted: beliefs.filter(b => b.state === 'refuted').length,
      testing: beliefs.filter(b => b.state === 'testing').length,
      beliefs: beliefs.map(b => ({ id: b.id, state: b.state, confidence: b.confidence })),
    };

    const drift = this.#driftService.getLatestSnapshot(username);

    const rules = [];
    for (const q of (plan.qualities || [])) {
      for (const r of (q.rules || [])) {
        rules.push({ trigger: r.trigger, action: r.action, effectiveness: r.effectiveness, quality: q.name });
      }
    }

    return {
      period,
      feedback,
      goalSummary,
      beliefSummary,
      drift,
      ruleEffectiveness: rules,
    };
  }
}
