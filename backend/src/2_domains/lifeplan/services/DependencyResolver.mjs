export class DependencyResolver {
  isGoalReady(goal, dependencies, goals, lifeEvents = []) {
    const blocking = dependencies.filter(d => d.blocked_goal === goal.id);
    return blocking.every(d => this.#isDependencySatisfied(d, goals, lifeEvents));
  }

  #isDependencySatisfied(dep, goals, lifeEvents) {
    if (dep.overridden) return true;
    if (dep.status === 'satisfied') return true;

    switch (dep.type) {
      case 'prerequisite': {
        const required = goals.find(g => g.id === dep.requires_goal);
        return required?.state === 'achieved';
      }
      case 'recommended': {
        // Recommended deps are soft — only blocked if not overridden (checked above)
        const required = goals.find(g => g.id === dep.requires_goal);
        return required?.state === 'achieved';
      }
      case 'life_event': {
        const event = lifeEvents.find(e => e.id === dep.awaits_event);
        return event?.status === 'occurred';
      }
      case 'resource': {
        return (dep.current ?? 0) >= (dep.threshold ?? 0);
      }
      default:
        return false;
    }
  }
}
