/**
 * Lifeplan Lifecycle Simulation Harness
 *
 * Provides a controlled environment for longitudinal testing
 * of life plan state over multiple cycles.
 */

import { LifePlan } from '#domains/lifeplan/entities/LifePlan.mjs';
import { GoalStateService } from '#domains/lifeplan/services/GoalStateService.mjs';
import { BeliefEvaluator } from '#domains/lifeplan/services/BeliefEvaluator.mjs';
import { BeliefCascadeProcessor } from '#domains/lifeplan/services/BeliefCascadeProcessor.mjs';
import { CadenceService } from '#domains/lifeplan/services/CadenceService.mjs';
import { DependencyResolver } from '#domains/lifeplan/services/DependencyResolver.mjs';
import { ValueDriftCalculator } from '#domains/lifeplan/services/ValueDriftCalculator.mjs';

export class LifeplanSimulation {
  #plan;
  #clock;
  #goalStateService;
  #beliefEvaluator;
  #beliefCascadeProcessor;
  #cadenceService;
  #dependencyResolver;
  #snapshots;
  #lifelogOverrides;

  constructor(planData, startDate = '2025-01-01') {
    this.#plan = new LifePlan(planData);
    this.#clock = { now: () => new Date(this._currentDate) };
    this._currentDate = startDate;
    this.#goalStateService = new GoalStateService();
    this.#beliefEvaluator = new BeliefEvaluator();
    this.#beliefCascadeProcessor = new BeliefCascadeProcessor();
    this.#cadenceService = new CadenceService();
    this.#dependencyResolver = new DependencyResolver();
    this.#snapshots = [];
    this.#lifelogOverrides = {};
  }

  get plan() { return this.#plan; }
  get currentDate() { return this._currentDate; }
  get snapshots() { return this.#snapshots; }

  tick(days = 1) {
    const current = new Date(this._currentDate);
    current.setDate(current.getDate() + days);
    this._currentDate = current.toISOString().slice(0, 10);
  }

  runCycle(daysPerCycle = 7) {
    for (let d = 0; d < daysPerCycle; d++) {
      this.tick(1);
    }
    this.#snapshots.push(this.snapshot());
  }

  runCycles(n, daysPerCycle = 7) {
    for (let i = 0; i < n; i++) {
      this.runCycle(daysPerCycle);
    }
    return this.#snapshots;
  }

  transitionGoal(goalId, newState, reason) {
    const goal = this.#plan.goals.find(g => g.id === goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);
    this.#goalStateService.transition(goal, newState, reason, this.#clock);
  }

  injectEvidence(beliefId, evidence) {
    const belief = this.#plan.getBeliefById(beliefId);
    if (!belief) throw new Error(`Belief ${beliefId} not found`);
    this.#beliefEvaluator.evaluateEvidence(belief, {
      ...evidence,
      date: evidence.date || this._currentDate,
    });
  }

  injectLifeEvent(event) {
    if (!this.#plan.life_events) this.#plan.life_events = [];
    this.#plan.life_events.push({
      ...event,
      occurred_date: event.occurred_date || this._currentDate,
    });
  }

  injectLifelogOverride(source, data) {
    this.#lifelogOverrides[source] = data;
  }

  processCascade(beliefId) {
    const belief = this.#plan.getBeliefById(beliefId);
    if (!belief) return [];
    return this.#beliefCascadeProcessor.processRefutation(
      belief,
      this.#plan.beliefs,
      this.#plan.values || [],
      this.#plan.qualities || [],
      this.#plan.purpose
    );
  }

  checkDependencies(goalId) {
    const goal = this.#plan.goals.find(g => g.id === goalId);
    if (!goal) return false;
    const deps = goal.dependencies || [];
    return this.#dependencyResolver.isGoalReady(goal, deps, this.#plan.goals, this.#plan.life_events || []);
  }

  snapshot() {
    return {
      date: this._currentDate,
      goals: this.#plan.goals.map(g => ({
        id: g.id, name: g.name, state: g.state,
        progress: g.getProgress?.() || 0,
      })),
      beliefs: this.#plan.beliefs.map(b => ({
        id: b.id, state: b.state,
        confidence: b.confidence,
        effectiveConfidence: b.getEffectiveConfidence?.() || b.confidence,
      })),
      values: (this.#plan.values || []).map(v => ({
        id: v.id, name: v.name, rank: v.rank,
        alignment_state: v.alignment_state,
      })),
      activeGoalCount: this.#plan.getActiveGoals?.()?.length || 0,
      lifelogOverrides: Object.keys(this.#lifelogOverrides),
    };
  }
}
