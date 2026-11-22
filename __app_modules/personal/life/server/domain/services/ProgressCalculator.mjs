/**
 * Calculates goal progress from metrics, milestones, and time.
 */
function calculateMetricProgress(goal) {
  const metrics = goal.metrics || [];
  if (metrics.length === 0) return null;

  const ratios = metrics.map(metric =>
    metric.target > 0 ? Math.min(metric.current / metric.target, 1) : 0
  );
  return ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
}

function calculateMilestoneProgress(goal) {
  const milestones = goal.milestones || [];
  if (milestones.length === 0) return null;

  const completed = milestones.filter(milestone => milestone.completed).length;
  return completed / milestones.length;
}

export function calculateGoalProgress(goal) {
  const components = [calculateMetricProgress(goal), calculateMilestoneProgress(goal)]
    .filter(progress => progress !== null);
  if (components.length === 0) return null;
  return components.reduce((sum, progress) => sum + progress, 0) / components.length;
}

export class ProgressCalculator {
  calculateMetricProgress(goal) {
    return calculateMetricProgress(goal);
  }

  calculateMilestoneProgress(goal) {
    return calculateMilestoneProgress(goal);
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
    const time = this.calculateTimeProgress(goal, now);
    const progress = calculateGoalProgress(goal);

    if (progress === null) return { progress: 0, timeRatio: time, status: 'no_metrics' };

    const timeRatio = time ?? 0;

    let status = 'on_track';
    if (progress < timeRatio * 0.8) status = 'behind';
    else if (progress < timeRatio) status = 'at_risk';

    if (time !== null && time >= 1 && progress < 1) status = 'overdue';

    return { progress, timeRatio, status };
  }
}
