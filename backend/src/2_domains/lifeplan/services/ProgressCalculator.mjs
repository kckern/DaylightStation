/**
 * Calculates goal progress from metrics, milestones, and time.
 */
export class ProgressCalculator {
  calculateMetricProgress(goal) {
    const metrics = goal.metrics || [];
    if (metrics.length === 0) return null;

    const ratios = metrics.map(m =>
      m.target > 0 ? Math.min(m.current / m.target, 1) : 0
    );
    return ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
  }

  calculateMilestoneProgress(goal) {
    const milestones = goal.milestones || [];
    if (milestones.length === 0) return null;

    const completed = milestones.filter(m => m.completed).length;
    return completed / milestones.length;
  }

  calculateTimeProgress(goal, now) {
    if (!goal.deadline) return null;

    const history = goal.state_history || [];
    const commitEntry = history.find(h => h.to === 'committed');
    if (!commitEntry) return null;

    const startMs = new Date(commitEntry.timestamp).getTime();
    const endMs = new Date(goal.deadline).getTime();
    const nowMs = (now instanceof Date ? now : new Date(now)).getTime();

    if (endMs <= startMs) return 1;
    return Math.min((nowMs - startMs) / (endMs - startMs), 1);
  }

  calculateComposite(goal, now) {
    const metric = this.calculateMetricProgress(goal);
    const milestone = this.calculateMilestoneProgress(goal);
    const time = this.calculateTimeProgress(goal, now);

    const components = [metric, milestone].filter(c => c !== null);
    if (components.length === 0) return { progress: 0, timeRatio: time, status: 'no_metrics' };

    const progress = components.reduce((sum, c) => sum + c, 0) / components.length;
    const timeRatio = time ?? 0;

    let status = 'on_track';
    if (progress < timeRatio * 0.8) status = 'behind';
    else if (progress < timeRatio) status = 'at_risk';

    if (time !== null && time >= 1 && progress < 1) status = 'overdue';

    return { progress, timeRatio, status };
  }
}
