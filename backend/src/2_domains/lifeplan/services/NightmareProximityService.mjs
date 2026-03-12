/**
 * Evaluates proximity to anti-goals (nightmare futures).
 * Anti-goals are futures the user explicitly wants to avoid.
 */
export class NightmareProximityService {
  evaluateProximity(antiGoals, plan) {
    const alerts = [];

    for (const ag of (antiGoals || [])) {
      const proximity = this.#calculateProximity(ag, plan);

      if (proximity.score > 0.5) {
        alerts.push({
          antiGoal_id: ag.id,
          name: ag.name,
          description: ag.description,
          proximity: proximity.score,
          triggers: proximity.triggers,
          severity: proximity.score > 0.8 ? 'critical' : proximity.score > 0.65 ? 'warning' : 'watch',
        });
      }
    }

    return alerts.sort((a, b) => b.proximity - a.proximity);
  }

  #calculateProximity(antiGoal, plan) {
    const triggers = [];
    let score = 0;
    let factors = 0;

    // Check indicator conditions
    for (const indicator of (antiGoal.indicators || [])) {
      factors++;

      if (indicator.type === 'value_drift') {
        const value = (plan.values || []).find(v => v.id === indicator.value_id);
        if (value?.alignment_state === 'reconsidering') {
          score += 1;
          triggers.push(`Value "${value.name}" in reconsidering state`);
        } else if (value?.alignment_state === 'drifting') {
          score += 0.5;
          triggers.push(`Value "${value.name}" drifting`);
        }
      }

      if (indicator.type === 'goal_failure') {
        const goal = (plan.goals || []).find(g => g.id === indicator.goal_id);
        if (goal?.state === 'failed') {
          score += 1;
          triggers.push(`Goal "${goal.name}" failed`);
        } else if (goal?.state === 'abandoned') {
          score += 0.7;
          triggers.push(`Goal "${goal.name}" abandoned`);
        }
      }

      if (indicator.type === 'belief_refuted') {
        const belief = (plan.beliefs || []).find(b => b.id === indicator.belief_id);
        if (belief?.state === 'refuted' || belief?.state === 'cascade_refuted') {
          score += 1;
          triggers.push(`Belief "${belief.id}" refuted`);
        }
      }
    }

    return {
      score: factors > 0 ? score / factors : 0,
      triggers,
    };
  }
}
