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
    const nowMs = this.#clock ? this.#clock.now().getTime() : Date.now();

    // 1. Dormant beliefs
    for (const belief of plan.beliefs) {
      if (belief.isDormant(nowMs) && !belief.isTerminal()) {
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

    // anti_goal_warning intentionally suppressed: AntiGoal.proximity is a static,
    // never-computed field (default 'distant'); firing off it latches a critical
    // alarm with no clearing path. Re-enable once NightmareProximityService computes
    // proximity on a schedule. See 2026-07-17 UX audit §4.

    // 4. Drift correction. Deliberately an allowlist: 'insufficient_data'
    // snapshots (values that map to <2 lifelog categories) must NOT raise a
    // drift alert — treat them like a missing snapshot (audit A-3.2c).
    if (snapshot.status === 'drifting' || snapshot.status === 'reconsidering') {
      const v = this.#mostDriftedValue(plan, snapshot);
      items.push({
        type: 'drift_alert',
        title: v ? `${v.name} matters to you, but it's getting little of your time`
                 : `Your time and your values are pulling apart`,
        reason: v ? `You rank it #${v.statedRank}, but it lands #${v.observedRank} in where your time actually goes`
                  : `Recent activity doesn't match your stated priorities`,
        urgency: snapshot.status === 'reconsidering' ? 'high' : 'medium',
        related_value: v ? (plan.values || []).find((x) => x.name === v.name)?.id ?? null : null,
      });
    }

    // Score and rank
    return items
      .map(item => ({ ...item, score: this.#scoreItem(item, plan.values) }))
      .sort((a, b) => b.score - a.score);
  }

  #mostDriftedValue(plan, snapshot) {
    const stated = snapshot.statedOrder || [];
    const observed = snapshot.observedOrder || [];
    let worst = null;
    for (const id of stated) {
      const s = stated.indexOf(id);
      const o = observed.indexOf(id);
      if (o < 0) continue;
      const drop = o - s;
      if (!worst || drop > worst.drop) {
        const value = (plan.values || []).find((v) => v.id === id);
        worst = { name: value?.name || id, statedRank: s + 1, observedRank: o + 1, drop };
      }
    }
    return worst && worst.drop > 0 ? worst : null;
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
