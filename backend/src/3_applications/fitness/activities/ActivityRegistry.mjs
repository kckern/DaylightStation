export class ActivityRegistry {
  constructor() { this.providers = []; }
  register(provider) { this.providers.push(provider); return this; }
  async enrich(group, householdId) {
    const activities = [];
    for (const p of this.providers) {
      const items = await p.loadOverlapping(group.startTime, group.endTime, group.date, householdId);
      if (items && items.length) activities.push({ type: p.type, count: items.length, items });
    }
    return activities;
  }
}

export default ActivityRegistry;
