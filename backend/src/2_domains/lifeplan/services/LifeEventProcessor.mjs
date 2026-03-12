/**
 * Processes life events and their impact on goals, beliefs, values.
 */
export class LifeEventProcessor {
  processEvent(lifeEvent, plan) {
    const impacts = [];

    // Check goal dependencies blocked by this event type
    for (const goal of (plan.goals || [])) {
      for (const dep of (goal.dependencies || [])) {
        if (dep.type === 'life_event' && dep.event_type === lifeEvent.type) {
          if (lifeEvent.state === 'occurred') {
            impacts.push({
              target: 'goal',
              target_id: goal.id,
              action: 'dependency_resolved',
              description: `Life event "${lifeEvent.name}" resolved dependency for goal "${goal.name}"`,
            });
          } else if (lifeEvent.state === 'cancelled') {
            impacts.push({
              target: 'goal',
              target_id: goal.id,
              action: 'dependency_cancelled',
              description: `Life event "${lifeEvent.name}" was cancelled, blocking goal "${goal.name}"`,
            });
          }
        }
      }
    }

    // Check impact on values if event has impact_type
    if (lifeEvent.impact_type) {
      for (const value of (plan.values || [])) {
        if (lifeEvent.affected_values?.includes(value.id)) {
          impacts.push({
            target: 'value',
            target_id: value.id,
            action: 'impact_' + lifeEvent.impact_type,
            description: `Life event "${lifeEvent.name}" impacts value "${value.name}" (${lifeEvent.impact_type})`,
          });
        }
      }
    }

    return impacts;
  }

  getAnticipatedEvents(plan) {
    return (plan.life_events || []).filter(e => e.state === 'anticipated');
  }

  getRecentEvents(plan, daysSince = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysSince);

    return (plan.life_events || []).filter(e => {
      if (e.state !== 'occurred') return false;
      return new Date(e.occurred_date || e.date) >= cutoff;
    });
  }
}
