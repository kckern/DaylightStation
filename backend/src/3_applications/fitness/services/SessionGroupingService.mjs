import { groupSessions } from '#domains/fitness/services/groupSessions.mjs';
import { mergeTimelines } from '#domains/fitness/services/TimelineService.mjs';

export class SessionGroupingService {
  constructor({ activityRegistry = null, sessionService = null, logger = console } = {}) {
    this.activityRegistry = activityRegistry;
    this.sessionService = sessionService;
    this.logger = logger;
  }

  async getGroupDetail(groupId, householdId) {
    if (!this.sessionService) return null;
    const raw = String(groupId).replace(/^group:/, '');
    if (raw.length < 8) return null;
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    const summaries = await this.sessionService.listSessionsByDate(date, householdId);
    const groups = groupSessions(summaries);
    const group = groups.find((g) => g.id === groupId);
    if (!group) return null;

    const tickCountOf = (tl) => (tl?.tick_count != null
      ? tl.tick_count
      : Math.max(0, ...Object.values(tl?.series || {}).map((a) => (Array.isArray(a) ? a.length : 0))));

    const members = [];
    for (const seg of group.segments) {
      const full = await this.sessionService.getSession(seg.sessionId, householdId, { decodeTimeline: true });
      const timeline = full?.timeline || { series: {}, events: [], tick_count: 0 };
      members.push({ seg, timeline });
    }
    if (!members.length) return null;

    const intervalSec = members[0].timeline.interval_seconds || 5;
    const intervalMs = intervalSec * 1000;

    let merged = members[0].timeline;
    let offsetTicks = tickCountOf(members[0].timeline);
    const segments = [{ sessionId: members[0].seg.sessionId, offsetMs: 0, durationMs: members[0].seg.durationMs, gapBeforeMs: 0 }];
    const segBounds = [{ start: members[0].seg.start, end: members[0].seg.end, offsetMs: 0 }];
    const seams = [];

    for (let i = 1; i < members.length; i++) {
      const { seg, timeline } = members[i];
      const offsetMs = offsetTicks * intervalMs;
      merged = mergeTimelines(merged, timeline, 0);
      segments.push({ sessionId: seg.sessionId, offsetMs, durationMs: seg.durationMs, gapBeforeMs: seg.gapBeforeMs });
      segBounds.push({ start: seg.start, end: seg.end, offsetMs });
      seams.push({ atMs: offsetMs, gapMs: seg.gapBeforeMs });
      offsetTicks += tickCountOf(timeline);
    }
    const totalDurationMs = offsetTicks * intervalMs;

    let activities = [];
    if (this.activityRegistry) {
      try { activities = await this.activityRegistry.enrich(group, householdId); }
      catch (e) { this.logger?.warn?.('fitness.group.detail.enrich.failed', { id: groupId, error: e?.message }); }
    }
    const rebase = (item) => {
      const b = segBounds.find((x) => item.startMs >= x.start && item.startMs <= x.end);
      if (!b) return item;
      const rel = item.startMs - b.start;
      const dur = (item.endMs ?? item.startMs) - item.startMs;
      return { ...item, axisStartMs: b.offsetMs + rel, axisEndMs: b.offsetMs + rel + dur };
    };
    activities = activities.map((a) => ({ ...a, items: (a.items || []).map(rebase) }));

    return {
      id: groupId, sessionId: groupId, isGroup: true, date,
      startTime: group.startTime, endTime: group.endTime, durationMs: totalDurationMs,
      participants: group.participants, totalCoins: group.totalCoins,
      media: null, segments, seams, activities, timeline: merged,
    };
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
