const SLACK_MS = 90_000;
export class SkylineGliderProvider {
  type = 'skyline-glider';
  constructor({ runService } = {}) {
    if (!runService) throw new Error('SkylineGliderProvider requires runService');
    this.runService = runService;
  }
  async loadOverlapping(startMs, endMs, date, householdId) {
    const records = await this.runService.listByDate(date, householdId) || [];
    return records.map((record) => ({
      startMs: Date.parse(record.run.started_at), endMs: Date.parse(record.run.ended_at),
      participants: [record.rider.user_id],
      meta: { runId: record.run.id, courseId: record.run.course_id, status: record.run.status, durationS: record.run.duration_s, collectibles: record.collectibles.length },
    })).filter((item) => Number.isFinite(item.startMs) && item.startMs >= startMs - SLACK_MS && item.startMs <= endMs + SLACK_MS).sort((a, b) => a.startMs - b.startMs);
  }
}
