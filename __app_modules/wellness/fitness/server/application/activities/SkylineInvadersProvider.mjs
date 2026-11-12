const SLACK_MS = 90_000;
export class SkylineInvadersProvider {
  type = 'skyline-invaders';
  constructor({ runService } = {}) {
    if (!runService) throw new Error('SkylineInvadersProvider requires runService');
    this.runService = runService;
  }
  async loadOverlapping(startMs, endMs, date, householdId) {
    const records = await this.runService.listByDate(date, householdId) || [];
    return records.map((record) => ({
      startMs: Date.parse(record.run.started_at), endMs: Date.parse(record.run.ended_at),
      participants: [record.rider.user_id, ...(record.run.partner_id ? [record.run.partner_id] : [])],
      meta: { runId: record.run.id, levelId: record.run.level_id, status: record.run.status, durationS: record.run.duration_s, score: record.run.score, kills: record.run.kills, stars: record.run.stars },
    })).filter((item) => Number.isFinite(item.startMs) && item.startMs >= startMs - SLACK_MS && item.startMs <= endMs + SLACK_MS).sort((a, b) => a.startMs - b.startMs);
  }
}
