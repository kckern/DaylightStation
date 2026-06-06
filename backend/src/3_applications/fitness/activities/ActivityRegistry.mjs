import { isForeignSport } from '#domains/fitness/services/groupSessions.mjs';

export class ActivityRegistry {
  constructor() { this.providers = []; }
  register(provider) { this.providers.push(provider); return this; }
  async enrich(group, householdId) {
    // An imported Strava workout of a non-cycling sport (run/walk/swim/…) is a complete
    // activity, not a container for game activities. Providers match purely by time
    // overlap, so without this guard a run that shares a window with cycle-game races
    // gets mislabeled "N races". Such sessions stand alone (see groupSessions), so this
    // sees their strava sport intact.
    if (isForeignSport(group)) return [];
    const activities = [];
    for (const p of this.providers) {
      const items = await p.loadOverlapping(group.startTime, group.endTime, group.date, householdId);
      if (items && items.length) activities.push({ type: p.type, count: items.length, items });
    }
    return activities;
  }
}

export default ActivityRegistry;
