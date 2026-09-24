/**
 * Processes life events and their impact on goals, beliefs, values.
 *
 * Reads the persisted model (LifeEvent / Dependency / YamlLifePlanStore): an
 * event's `status` and `actual_date`, and top-level `plan.dependencies` of
 * `type: 'life_event'` that name the goal they block (`blocked_goal`) and the
 * event they await (`awaits_event`, an event id) - the same rule
 * DependencyResolver applies. The older spellings (`state`, `occurred_date`,
 * a dependency inside the goal matched by `event_type`) are still honoured.
 */
const statusOf = event => event?.status ?? event?.state;
const occurredOn = event => event.actual_date ?? event.occurred_date ?? event.date;

function awaits(dep, event) {
  if (dep?.type !== 'life_event') return false;
  if (dep.awaits_event) return dep.awaits_event === event.id;
  return dep.event_type != null && dep.event_type === event.type;
}

export class LifeEventProcessor {
  processEvent(lifeEvent, plan) {
    const impacts = [];
    const goals = plan.goals || [];
    const status = statusOf(lifeEvent);

    const blocking = [
      ...(plan.dependencies || []).map(dep => [goals.find(g => g.id === dep.blocked_goal), dep]),
      ...goals.flatMap(goal => (goal.dependencies || []).map(dep => [goal, dep])),
    ];
    for (const [goal, dep] of blocking) {
      if (!goal || !awaits(dep, lifeEvent)) continue;
      if (status === 'occurred') {
        impacts.push({
          target: 'goal',
          target_id: goal.id,
          action: 'dependency_resolved',
          description: `Life event "${lifeEvent.name}" resolved dependency for goal "${goal.name}"`,
        });
      } else if (status === 'cancelled') {
        impacts.push({
          target: 'goal',
          target_id: goal.id,
          action: 'dependency_cancelled',
          description: `Life event "${lifeEvent.name}" was cancelled, blocking goal "${goal.name}"`,
        });
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
    return (plan.life_events || []).filter(e => statusOf(e) === 'anticipated');
  }

  getRecentEvents(plan, daysSince = 30, now) {
    if (now === undefined || now === null) throw new Error('now is required to get recent life events');
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - daysSince);

    return (plan.life_events || []).filter(e => {
      if (statusOf(e) !== 'occurred') return false;
      return new Date(occurredOn(e)) >= cutoff;
    });
  }
}
