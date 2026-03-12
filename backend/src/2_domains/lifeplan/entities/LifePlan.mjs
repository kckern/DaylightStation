import { Goal } from './Goal.mjs';
import { Belief } from './Belief.mjs';
import { Value } from './Value.mjs';
import { Quality } from './Quality.mjs';
import { Rule } from './Rule.mjs';
import { Purpose } from './Purpose.mjs';
import { Dependency } from './Dependency.mjs';
import { LifeEvent } from './LifeEvent.mjs';
import { AntiGoal } from './AntiGoal.mjs';
import { Milestone } from './Milestone.mjs';
import { Cycle } from './Cycle.mjs';
import { CeremonyRecord } from './CeremonyRecord.mjs';
import { FeedbackEntry } from './FeedbackEntry.mjs';

export class LifePlan {
  constructor(data = {}) {
    this.purpose = data.purpose ? new Purpose(data.purpose) : null;
    this.goals = (data.goals || []).map(g => new Goal(g));
    this.beliefs = (data.beliefs || []).map(b => new Belief(b));
    this.values = (data.values || []).map(v => new Value(v));
    this.qualities = (data.qualities || []).map(q => new Quality(q));
    this.rules = (data.rules || []).map(r => new Rule(r));
    this.dependencies = (data.dependencies || []).map(d => new Dependency(d));
    this.life_events = (data.life_events || []).map(e => new LifeEvent(e));
    this.anti_goals = (data.anti_goals || []).map(a => new AntiGoal(a));
    this.cycles = (data.cycles || []).map(c => new Cycle(c));
    this.ceremony_records = (data.ceremony_records || []).map(r => new CeremonyRecord(r));
    this.feedback = (data.feedback || []).map(f => new FeedbackEntry(f));
  }

  getGoalsByState(state) {
    return this.goals.filter(g => g.state === state);
  }

  getActiveGoals() {
    return this.goals.filter(g => !g.isTerminal());
  }

  getBeliefById(id) {
    return this.beliefs.find(b => b.id === id) || null;
  }

  getGoalById(id) {
    return this.goals.find(g => g.id === id) || null;
  }

  getValueById(id) {
    return this.values.find(v => v.id === id) || null;
  }

  getQualityById(id) {
    return this.qualities.find(q => q.id === id) || null;
  }

  toJSON() {
    return {
      purpose: this.purpose?.toJSON() || null,
      goals: this.goals.map(g => g.toJSON()),
      beliefs: this.beliefs.map(b => b.toJSON()),
      values: this.values.map(v => v.toJSON()),
      qualities: this.qualities.map(q => q.toJSON()),
      rules: this.rules.map(r => r.toJSON()),
      dependencies: this.dependencies.map(d => d.toJSON()),
      life_events: this.life_events.map(e => e.toJSON()),
      anti_goals: this.anti_goals.map(a => a.toJSON()),
      cycles: this.cycles.map(c => c.toJSON()),
      ceremony_records: this.ceremony_records.map(r => r.toJSON()),
      feedback: this.feedback.map(f => f.toJSON()),
    };
  }
}
