import { GoalState } from '../value-objects/GoalState.mjs';

export class Goal {
  constructor(data = {}) {
    this.id = data.id;
    this.name = data.name;
    this.state = data.state || 'dream';
    this.quality = data.quality || null;
    this.why = data.why || null;
    this.sacrifice = data.sacrifice || null;
    this.deadline = data.deadline || null;
    this.metrics = data.metrics || [];
    this.audacity = data.audacity || null;
    this.milestones = data.milestones || [];
    this.state_history = data.state_history || [];
    this.dependencies = data.dependencies || [];
    this.avoids_nightmare = data.avoids_nightmare || null;
    this.nightmare_proximity = data.nightmare_proximity || null;
    this.retrospective = data.retrospective || null;
    this.achieved_date = data.achieved_date || null;
    this.failed_date = data.failed_date || null;
    this.abandoned_reason = data.abandoned_reason || null;
    this.paused_reason = data.paused_reason || null;
    this.resume_conditions = data.resume_conditions || null;
  }

  transition(newState, reason, timestamp) {
    if (!GoalState.canTransition(this.state, newState)) {
      throw new Error(
        `Goal "${this.id}" cannot transition from "${this.state}" to "${newState}". ` +
        `Valid transitions: ${GoalState.getValidTransitions(this.state).join(', ') || 'none (terminal)'}`
      );
    }

    if (!timestamp) throw new Error('timestamp is required for goal transition');

    this.state_history.push({
      from: this.state,
      to: newState,
      reason,
      timestamp,
    });

    this.state = newState;
  }

  isTerminal() {
    return GoalState.isTerminal(this.state);
  }

  getProgress() {
    if (!this.metrics || this.metrics.length === 0) return 0;

    const sum = this.metrics.reduce((acc, m) => {
      if (!m.target || m.target === 0) return acc;
      return acc + Math.min(m.current / m.target, 1);
    }, 0);

    return Math.min(sum / this.metrics.length, 1);
  }

}
