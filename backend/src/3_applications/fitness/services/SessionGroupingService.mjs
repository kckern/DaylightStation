import { groupSessions } from '#domains/fitness/services/groupSessions.mjs';

export class SessionGroupingService {
  constructor({ activityRegistry = null, logger = console } = {}) {
    this.activityRegistry = activityRegistry;
    this.logger = logger;
  }

  async group(sessions, householdId, { enrich = true } = {}) {
    const groups = groupSessions(sessions);
    if (!enrich || !this.activityRegistry) return groups;
    for (const g of groups) {
      if (g.media) continue; // video sessions are not activity-enriched
      try {
        g.activities = await this.activityRegistry.enrich(g, householdId);
      } catch (e) {
        this.logger?.warn?.('fitness.group.enrich.failed', { id: g.id, error: e?.message });
      }
    }
    return groups;
  }
}

export default SessionGroupingService;
