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
    const firstCount = tickCountOf(members[0].timeline);
    let offsetTicks = firstCount;
    const segments = [{ sessionId: members[0].seg.sessionId, offsetMs: 0, durationMs: members[0].seg.durationMs, gapBeforeMs: 0 }];
    const segBounds = [{ start: members[0].seg.start, end: members[0].seg.end, offsetMs: 0 }];
    // tick ranges per segment on the compressed axis — used to make cumulative series continuous
    const segTicks = [{ startTick: 0, count: firstCount }];
    const seams = [];

    for (let i = 1; i < members.length; i++) {
      const { seg, timeline } = members[i];
      const offsetMs = offsetTicks * intervalMs;
      merged = mergeTimelines(merged, timeline, 0);
      const count = tickCountOf(timeline);
      segments.push({ sessionId: seg.sessionId, offsetMs, durationMs: seg.durationMs, gapBeforeMs: seg.gapBeforeMs });
      segBounds.push({ start: seg.start, end: seg.end, offsetMs });
      segTicks.push({ startTick: offsetTicks, count });
      seams.push({ atMs: offsetMs, gapMs: seg.gapBeforeMs });
      offsetTicks += count;
    }
    const totalDurationMs = offsetTicks * intervalMs;

    // Cumulative series (coins/beats/rotations totals) restart at 0 in each member session.
    // After concatenation they'd reset at every seam — offset each segment by the prior
    // running total so the cumulative line stays continuous across the time breaks.
    // Instantaneous series (heart-rate/rpm/zone) are left untouched.
    const CUMULATIVE_METRICS = new Set(['beats', 'coins', 'rotations']);
    const isCumulativeKey = (key) => CUMULATIVE_METRICS.has(String(key).split(':').pop());
    for (const [key, arr] of Object.entries(merged.series || {})) {
      if (!Array.isArray(arr) || !isCumulativeKey(key)) continue;
      let carry = 0;
      for (const { startTick, count } of segTicks) {
        let segLast = carry;
        const end = Math.min(startTick + count, arr.length);
        for (let t = startTick; t < end; t++) {
          const v = arr[t];
          if (v != null && Number.isFinite(v)) { arr[t] = v + carry; segLast = arr[t]; }
        }
        carry = segLast;
      }
    }

    let activities = [];
    if (this.activityRegistry) {
      try { activities = await this.activityRegistry.enrich(group, householdId); }
      catch (e) { this.logger?.warn?.('fitness.group.detail.enrich.failed', { id: groupId, error: e?.message }); }
    }
    const distTo = (x, ms) => (ms < x.start ? x.start - ms : (ms > x.end ? ms - x.end : 0));
    const rebase = (item) => {
      // Prefer the segment that contains the race; if a race fell in a compressed gap
      // (its session's recorded start/end didn't bracket it — happens at block edges),
      // snap to the NEAREST segment so it still renders at the right seam instead of
      // vanishing. rel is clamped into the segment so it can't land outside the axis.
      let b = segBounds.find((x) => item.startMs >= x.start && item.startMs <= x.end);
      if (!b) {
        for (const x of segBounds) { if (!b || distTo(x, item.startMs) < distTo(b, item.startMs)) b = x; }
      }
      if (!b) return item;
      // Clamp the band to its segment's compressed bounds so a race that ran slightly past
      // its session's recorded end can't bleed across the seam into the next segment (which
      // would look like a "race within race" once the idle gap is compressed out).
      const segSpan = Math.max(0, b.end - b.start);
      const segStartAxis = b.offsetMs;
      const segEndAxis = b.offsetMs + segSpan;
      const rel = Math.max(0, Math.min(item.startMs - b.start, segSpan));
      const dur = Math.max(0, (item.endMs ?? item.startMs) - item.startMs);
      const axisStartMs = segStartAxis + rel;
      const axisEndMs = Math.min(axisStartMs + dur, segEndAxis);
      return { ...item, axisStartMs, axisEndMs };
    };
    activities = activities.map((a) => ({ ...a, items: (a.items || []).map(rebase) }));
    // Defense in depth: after rebasing onto the compressed axis, no race band may nest inside
    // another. Edge cases (a race straddling a session boundary, an orphan snapped to a seam,
    // gap compression) can still produce a band that runs into the next one — truncate the
    // earlier band's end to the next band's start so "race within race" can never render.
    for (const a of activities) {
      const its = (a.items || []).filter((i) => Number.isFinite(i.axisStartMs)).sort((x, y) => x.axisStartMs - y.axisStartMs);
      for (let i = 0; i < its.length - 1; i++) {
        if (its[i].axisEndMs > its[i + 1].axisStartMs) its[i].axisEndMs = its[i + 1].axisStartMs;
      }
    }

    return {
      id: groupId, sessionId: groupId, isGroup: true, date,
      startTime: group.startTime, endTime: group.endTime, durationMs: totalDurationMs,
      // `start` / `duration_seconds` mirror the normal-session shape the detail header reads
      start: group.startTime,
      duration_seconds: Math.round(totalDurationMs / 1000),
      participants: group.participants, totalCoins: group.totalCoins,
      media: null, segments, seams, activities, timeline: merged,
    };
  }

  /**
   * Activities (e.g. cycle-game races) overlapping a single, non-grouped session —
   * the same enrichment group()/getGroupDetail attach, so the per-session DETAIL
   * shows races + bands consistently with the session LIST. Without this, the
   * detail endpoint returns a bare session (no `activities`), so the widget header
   * falls back to "Workout" and the timeline renders no race bands.
   *
   * Returns a raw activities array: items keep absolute startMs/endMs. There is no
   * gap compression for a single session, so the single-session timeline rebases
   * the bands against its own axis origin (sessionStartMs) on the client. [] when
   * the session has media, isn't a standalone session, or no registry is wired.
   *
   * @param {string} sessionId
   * @param {string} householdId
   * @returns {Promise<Array>} activities array (possibly empty)
   */
  async enrichSession(sessionId, householdId) {
    if (!this.activityRegistry || !this.sessionService) return [];
    const id = String(sessionId);
    if (id.length < 8) return [];
    const date = `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}`;
    const summaries = await this.sessionService.listSessionsByDate(date, householdId);
    const groups = groupSessions(summaries);
    // Only standalone sessions land here; multi-session groups are fetched via their
    // group: id (getGroupDetail). A singleton group's id is the sessionId itself.
    const group = groups.find((g) => String(g.id) === id);
    if (!group || group.media) return [];
    try {
      return await this.activityRegistry.enrich(group, householdId);
    } catch (e) {
      this.logger?.warn?.('fitness.session.enrich.failed', { id, error: e?.message });
      return [];
    }
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
