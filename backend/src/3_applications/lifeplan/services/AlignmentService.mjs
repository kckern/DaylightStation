export class AlignmentService {
  #lifePlanStore;
  #metricsStore;
  #cadenceService;
  #ceremonyRecordStore;
  #clock;

  constructor({ lifePlanStore, metricsStore, cadenceService, ceremonyRecordStore, clock }) {
    this.#lifePlanStore = lifePlanStore;
    this.#metricsStore = metricsStore;
    this.#cadenceService = cadenceService;
    this.#ceremonyRecordStore = ceremonyRecordStore;
    this.#clock = clock;
  }

  computeAlignment(username) {
    const plan = this.#lifePlanStore.load(username);
    if (!plan) return null;

    const today = this.#clock ? this.#clock.today() : new Date().toISOString().slice(0, 10);
    const cadence = this.#cadenceService.resolve(plan.cadence || {}, today);
    const snapshot = this.#metricsStore?.getLatest(username) || {};

    const priorities = this.#computePriorities(plan, snapshot, today);

    const dashboard = {
      valueDrift: snapshot.correlation != null ? {
        correlation: snapshot.correlation,
        status: snapshot.status,
        allocation: snapshot.allocation,
      } : null,
      goalProgress: plan.getActiveGoals().map(g => ({
        id: g.id,
        name: g.name,
        state: g.state,
        progress: g.getProgress(),
      })),
      beliefConfidence: this.#getBeliefSummaries(plan.beliefs),
      ceremonyAdherence: this.#getCeremonyAdherence(username),
      cadencePosition: cadence,
    };

    const briefingContext = {
      plan: plan.toJSON(),
      snapshot,
      recentFeedback: (plan.feedback || []).slice(-5).map(f => f.toJSON()),
    };

    return {
      priorities,
      dashboard,
      briefingContext,
      _meta: { computedAt: this.#clock ? this.#clock.now().toISOString() : new Date().toISOString(), username },
    };
  }

  #computePriorities(plan, snapshot, today) {
    const items = [];

    // 1. Dormant beliefs
    for (const belief of plan.beliefs) {
      if (belief.isDormant() && !belief.isTerminal()) {
        items.push({
          type: 'dormant_belief',
          title: `Test belief: "${belief.if} → ${belief.then}"`,
          reason: 'Untested for 60+ days',
          urgency: 'medium',
          related_value: null,
        });
      }
    }

    // 2. Active goals with approaching deadlines
    for (const goal of plan.getActiveGoals()) {
      if (goal.deadline && goal.state === 'committed') {
        const daysUntil = (new Date(goal.deadline) - new Date(today)) / 86400000;
        if (daysUntil <= 30) {
          items.push({
            type: 'goal_deadline',
            title: `"${goal.name}" deadline in ${Math.ceil(daysUntil)} days`,
            reason: `Progress: ${Math.round(goal.getProgress() * 100)}%`,
            urgency: daysUntil <= 7 ? 'critical' : 'high',
            related_value: goal.quality,
          });
        }
      }
    }

    // 3. Anti-goals with approaching proximity
    for (const ag of plan.anti_goals || []) {
      if (ag.proximity === 'approaching' || ag.proximity === 'imminent') {
        items.push({
          type: 'anti_goal_warning',
          title: `Warning: "${ag.nightmare}"`,
          reason: `Proximity: ${ag.proximity}`,
          urgency: ag.proximity === 'imminent' ? 'critical' : 'high',
          related_value: null,
        });
      }
    }

    // 4. Drift correction
    if (snapshot.status === 'drifting' || snapshot.status === 'reconsidering') {
      items.push({
        type: 'drift_alert',
        title: `Value drift detected (${snapshot.status})`,
        reason: `Correlation: ${(snapshot.correlation || 0).toFixed(2)}`,
        urgency: snapshot.status === 'reconsidering' ? 'high' : 'medium',
        related_value: null,
      });
    }

    // Score and rank
    return items
      .map(item => ({ ...item, score: this.#scoreItem(item, plan.values) }))
      .sort((a, b) => b.score - a.score);
  }

  #scoreItem(item, values) {
    let score = 0;

    // Urgency scoring
    const urgencyScores = { critical: 100, high: 70, medium: 40, low: 10 };
    score += urgencyScores[item.urgency] || 0;

    // Value alignment boost
    if (item.related_value && values.length > 0) {
      const value = values.find(v => v.id === item.related_value);
      if (value && value.rank) {
        score += Math.max(0, (values.length - value.rank + 1) * 10);
      }
    }

    return score;
  }

  #getBeliefSummaries(beliefs) {
    return beliefs.map(b => ({
      id: b.id,
      if: b.if,
      then: b.then,
      state: b.state,
      confidence: b.confidence,
      effectiveConfidence: b.getEffectiveConfidence(),
      foundational: b.foundational,
    }));
  }

  #getCeremonyAdherence(username) {
    if (!this.#ceremonyRecordStore) return null;
    const records = this.#ceremonyRecordStore.getRecords(username);
    return { total: records.length };
  }
}
