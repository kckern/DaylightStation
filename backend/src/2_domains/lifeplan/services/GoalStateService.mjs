export class GoalStateService {
  transition(goal, newState, reason, clock) {
    const timestamp = clock ? clock.now().toISOString() : new Date().toISOString();
    goal.transition(newState, reason, timestamp);
  }

  checkDependencies(goal, dependencies) {
    const blocking = dependencies.filter(d => d.blocked_goal === goal.id);
    return blocking.every(d => d.isSatisfied());
  }

  validateCommitmentGate(goal) {
    const required = ['why', 'sacrifice', 'deadline', 'metrics'];
    const missing = required.filter(field => {
      const val = goal[field];
      if (Array.isArray(val)) return val.length === 0;
      return !val;
    });
    return { valid: missing.length === 0, missing };
  }

  evaluateProgress(goal, clock) {
    if (!goal.deadline) {
      return { status: 'no_deadline', progress: goal.getProgress() };
    }

    const now = clock ? clock.now() : new Date();
    const deadline = new Date(goal.deadline);
    const commitStart = this.#getCommitDate(goal) || now;

    const totalMs = deadline.getTime() - commitStart.getTime();
    const elapsedMs = now.getTime() - commitStart.getTime();

    if (totalMs <= 0) {
      return { status: 'overdue', progress: goal.getProgress() };
    }

    const timeRatio = Math.min(elapsedMs / totalMs, 1);
    const progress = goal.getProgress();

    if (progress >= timeRatio * 0.8) return { status: 'on_track', progress, timeRatio };
    if (progress >= timeRatio * 0.5) return { status: 'at_risk', progress, timeRatio };
    return { status: 'behind', progress, timeRatio };
  }

  #getCommitDate(goal) {
    const commitEntry = goal.state_history.find(h => h.to === 'committed');
    return commitEntry ? new Date(commitEntry.timestamp) : null;
  }
}
