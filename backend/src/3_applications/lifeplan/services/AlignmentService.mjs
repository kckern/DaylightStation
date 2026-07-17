export class AlignmentService {
  #lifePlanStore;
  #metricsStore;
  #cadenceService;
  #ceremonyRecordStore;
  #ceremonyDueResolver;
  #clock;

  constructor({ lifePlanStore, metricsStore, cadenceService, ceremonyRecordStore, ceremonyDueResolver, clock }) {
    this.#lifePlanStore = lifePlanStore;
    this.#metricsStore = metricsStore;
    this.#cadenceService = cadenceService;
    this.#ceremonyRecordStore = ceremonyRecordStore;
    this.#ceremonyDueResolver = ceremonyDueResolver;
    this.#clock = clock;
  }

  computeAlignment(username) {
    const plan = this.#lifePlanStore.load(username);
    if (!plan) return null;

    const today = this.#clock ? this.#clock.today() : new Date().toISOString().slice(0, 10);
    const cadence = this.#cadenceService.resolve(plan.cadence || {}, today);
    const snapshot = this.#metricsStore?.getLatest(username) || {};

    const { stage, completeness } = this.#computeStage(plan);
    const priorities = this.#computePriorities(plan, snapshot, today, cadence, username);

    const dashboard = {
      stage,
      completeness,
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

  #computeStage(plan) {
    const valueCount = plan.values?.length || 0;
    const goalCount = plan.getActiveGoals?.().length || 0;
    const beliefCount = plan.beliefs?.length || 0;
    const hasPurpose = !!plan.purpose?.statement;
    const completeness = { hasPurpose, valueCount, goalCount, beliefCount };
    const active = hasPurpose && valueCount >= 2 && goalCount >= 1;
    return { stage: active ? 'active' : 'scaffolding', completeness };
  }

  #computePriorities(plan, snapshot, today, cadence, username) {
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
        related_value: v ? v.id : null,
      });
    }

    // plan_gap — nudge the user toward the next setup step for a sparse plan.
    if (!plan.purpose?.statement) {
      items.push({ type: 'plan_gap', title: 'Name your purpose', reason: 'One sentence on what this is all for', urgency: 'medium', gap: 'purpose', related_value: null });
    } else if ((plan.values?.length || 0) < 2) {
      items.push({ type: 'plan_gap', title: 'Add a couple of core values', reason: 'The plan needs values to track alignment', urgency: 'medium', gap: 'values', related_value: null });
    } else if ((plan.getActiveGoals?.().length || 0) === 0) {
      items.push({ type: 'plan_gap', title: 'Set your first goal', reason: 'Turn your values into something concrete', urgency: 'medium', gap: 'goals', related_value: null });
    }

    // ceremony_due — one per ceremony due today (dueness SSOT: CeremonyDueResolver).
    if (this.#ceremonyDueResolver && cadence) {
      const hasRecord = (type, periodId) => this.#ceremonyRecordStore?.hasRecord?.(username, type, periodId) || false;
      const due = this.#ceremonyDueResolver.listDue({
        plan, cadencePosition: cadence, cadenceConfig: plan.cadence || {}, today, hasRecord,
      });
      for (const d of due) {
        items.push({ type: 'ceremony_due', title: d.title, reason: 'Due today', urgency: 'high', ceremonyType: d.type, related_value: null });
      }
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
        worst = { id, name: value?.name || id, statedRank: s + 1, observedRank: o + 1, drop };
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
