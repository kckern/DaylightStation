export class Dependency {
  constructor(data = {}) {
    this.type = data.type;             // prerequisite | recommended | life_event | resource
    this.blocked_goal = data.blocked_goal;
    this.requires_goal = data.requires_goal || null;
    this.awaits_event = data.awaits_event || null;
    this.resource = data.resource || null;
    this.threshold = data.threshold || null;
    this.current = data.current || null;
    this.status = data.status || 'pending';  // pending | satisfied
    this.reason = data.reason || null;
    this.overridden = data.overridden || false;
  }

  isSatisfied() {
    if (this.overridden) return true;
    return this.status === 'satisfied';
  }

}
