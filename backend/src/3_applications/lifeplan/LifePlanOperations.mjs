const CEREMONY_CADENCE = {
  unit_intention: 'unit', unit_capture: 'unit',
  cycle_retro: 'cycle', phase_review: 'phase',
  season_alignment: 'season', era_vision: 'era',
};

const RECURRENCE = {
  day: 'FREQ=DAILY', week: 'FREQ=WEEKLY', month: 'FREQ=MONTHLY',
  quarter: 'FREQ=MONTHLY;INTERVAL=3', year: 'FREQ=YEARLY',
};

/** Application boundary for life-plan queries, commands, and workflows. */
export class LifePlanOperations {
  constructor({
    plans,
    goalStates,
    beliefEvaluator,
    cadence,
    ceremony = null,
    feedback = null,
    retrospective = null,
    authoring = null,
    drift = null,
    serviceAvailability = {},
    clock = { now: () => new Date() },
  }) {
    this.plans = plans;
    this.goalStates = goalStates;
    this.beliefEvaluator = beliefEvaluator;
    this.cadence = cadence;
    this.ceremony = ceremony;
    this.feedback = feedback;
    this.retrospective = retrospective;
    this.authoring = authoring;
    this.drift = drift;
    this.serviceAvailability = serviceAvailability;
    this.clock = clock;
  }

  get authoringAvailable() { return !!this.authoring; }
  get ceremonyAvailable() { return !!this.ceremony; }
  get feedbackAvailable() { return !!this.feedback; }
  get retrospectiveAvailable() { return !!this.retrospective; }

  readPlan(username) { return this.plans.load(username); }

  createPlan(username) {
    if (this.plans.load(username)) return { created: false };
    this.authoring.createPlan(username);
    return { created: true };
  }

  addGoal(username, input) { return this.authoring.addGoal(username, input); }
  addValue(username, input) { return this.authoring.addValue(username, input); }
  setPurpose(username, input) { return this.authoring.setPurpose(username, input); }
  addBelief(username, input) { return this.authoring.addBelief(username, input); }

  updateSection(username, section, data) {
    const plan = this.plans.load(username);
    if (!plan) return { kind: 'missing-plan' };
    if (plan[section] === undefined) return { kind: 'unknown-section' };
    if (Array.isArray(plan[section])) plan[section] = data;
    else if (typeof plan[section] === 'object' && plan[section] !== null) Object.assign(plan[section], data);
    else plan[section] = data;
    this.plans.save(username, plan);
    return { kind: 'updated' };
  }

  listGoals(username, state) {
    const plan = this.plans.load(username);
    if (!plan) return [];
    return state ? plan.getGoalsByState(state) : plan.goals;
  }

  findGoal(username, goalId) { return this.plans.load(username)?.getGoalById(goalId) || null; }

  transitionGoal(username, goalId, state, reason) {
    const plan = this.plans.load(username);
    const goal = plan?.getGoalById(goalId);
    if (!goal) return null;
    const previousState = goal.state;
    this.goalStates.transition(goal, state, reason, this.clock.now());
    this.plans.save(username, plan);
    return { goal, previousState };
  }

  listBeliefs(username) { return this.plans.load(username)?.beliefs || []; }

  addBeliefEvidence(username, beliefId, evidence) {
    const plan = this.plans.load(username);
    const belief = plan?.getBeliefById(beliefId);
    if (!belief) return null;
    this.beliefEvaluator.evaluateEvidence(belief, evidence, this.clock.now());
    this.plans.save(username, plan);
    return belief;
  }

  readCadence(username) {
    const config = this.plans.load(username)?.cadence || {};
    return { config, current: this.cadence.resolve(config, new Date()) };
  }

  updateCadence(username, changes) {
    const plan = this.plans.load(username);
    if (!plan) return false;
    plan.cadence = { ...(plan.cadence || {}), ...changes };
    this.plans.save(username, plan);
    return true;
  }

  readCeremony(username, type) {
    if (!this.plans.load(username)) return { planExists: false, content: null };
    return { planExists: true, content: this.ceremony.getCeremonyContent(type, username) };
  }

  completeCeremony(username, type, input) {
    if (!this.plans.load(username)) return { planExists: false, completed: false };
    return { planExists: true, completed: this.ceremony.completeCeremony(type, username, input) };
  }

  recordFeedback(username, input) { return this.feedback.recordObservation(username, input); }
  readFeedback(username, period) { return this.feedback.getFeedback(username, period); }
  generateRetrospective(username, period) { return this.retrospective.generateRetro(username, period); }

  readCeremonySchedule(username) {
    const plan = this.plans.load(username);
    if (!plan) return null;
    const cadenceConfig = plan.cadence || {};
    return Object.entries(plan.ceremonies || {}).flatMap(([type, config]) => {
      if (!config.enabled) return [];
      const level = CEREMONY_CADENCE[type];
      const cadenceUnit = cadenceConfig[level] || level;
      return [{ type, level, cadenceUnit, rrule: RECURRENCE[cadenceUnit] || null }];
    });
  }

  healthChecks(username) {
    const checks = {};
    try {
      const plan = this.plans.load(username);
      checks.plan = {
        loaded: !!plan,
        goalCount: plan?.goals?.length || 0,
        beliefCount: plan?.beliefs?.length || 0,
        valueCount: plan?.values?.length || 0,
      };
    } catch {
      checks.plan = { loaded: false, error: 'Failed to load plan' };
    }
    try {
      const latest = this.drift?.getLatestSnapshot?.(username);
      checks.metrics = {
        hasSnapshot: !!latest,
        lastTimestamp: latest?.timestamp || null,
        ageMs: latest?.timestamp ? Date.now() - new Date(latest.timestamp).getTime() : null,
      };
    } catch {
      checks.metrics = { hasSnapshot: false };
    }
    try {
      const ceremonies = this.plans.load(username)?.ceremonies || {};
      const enabledTypes = Object.entries(ceremonies).filter(([, item]) => item?.enabled).map(([type]) => type);
      checks.ceremonies = { enabledCount: enabledTypes.length, types: enabledTypes };
    } catch {
      checks.ceremonies = { enabledCount: 0 };
    }
    checks.services = { ...this.serviceAvailability };
    return checks;
  }
}

export default LifePlanOperations;
