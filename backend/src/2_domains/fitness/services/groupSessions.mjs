export const GROUP_MAX_GAP_MS = 4 * 60 * 60 * 1000; // 4h ceiling

const rosterSet = (s) => new Set(Object.keys(s.participants || {}));
const hasVideo  = (s) => !!(s.media && s.media.primary);

// Sport strings Strava reports for cycling (the only sport cycle-game races belong to).
const CYCLING_SPORT = /ride|cycl|bike|velomobile|handcycle/i;
/**
 * A Strava-imported workout of a NON-cycling sport (a run, walk, swim, hike…). Such a
 * session is a complete activity in its own right — it must never merge into a continuous
 * cycle-game block, or it gets relabeled "N races" once races are matched by time overlap.
 * Treated like a video session: it stands alone.
 */
export const isForeignSport = (s) => {
  const sport = s?.strava?.sportType || s?.strava?.type;
  return !!sport && !CYCLING_SPORT.test(sport);
};

export function groupSessions(sessions, { maxGapMs = GROUP_MAX_GAP_MS } = {}) {
  const sorted = [...(sessions || [])].sort((a, b) => a.startTime - b.startTime);
  const groups = [];
  let cur = null, union = null;

  for (const s of sorted) {
    const startMs = s.startTime;
    const endMs   = s.startTime + (s.durationMs || 0);
    const newRoster = rosterSet(s);

    // A new group starts on: a video session (stands alone + separates), a calendar-day
    // change, or a gap exceeding the ceiling. Roster changes do NOT split — rotating
    // riders across a continuous no-video block stay one merged session.
    const mustBreak =
      !cur ||
      cur._hasVideo || hasVideo(s) ||
      cur._hasForeign || isForeignSport(s) ||
      s.date !== cur.date ||
      (startMs - cur._lastEndMs) > maxGapMs;

    if (mustBreak) {
      cur = { id: `group:${s.sessionId}`, isGroup: true, date: s.date,
              startTime: startMs, endTime: endMs, segments: [], _lastEndMs: endMs,
              _hasVideo: hasVideo(s), _hasForeign: isForeignSport(s), _coins: 0, _prevEnd: endMs, _sessions: [] };
      union = new Set(newRoster);
      groups.push(cur);
    } else {
      for (const r of newRoster) union.add(r);
      cur.endTime = endMs;
      cur._lastEndMs = endMs;
    }

    cur.segments.push({
      sessionId: s.sessionId, start: startMs, end: endMs, durationMs: s.durationMs || 0,
      participants: s.participants || {}, coins: s.totalCoins || 0,
      gapBeforeMs: cur.segments.length === 0 ? 0 : Math.max(0, startMs - cur._prevEnd),
      media: s.media || null, stravaActivityId: s.stravaActivityId ?? null,
    });
    cur._prevEnd = endMs;
    cur._coins += s.totalCoins || 0;
    cur._union = union;
    cur._sessions.push(s);
  }

  return groups.map(finalize);
}

function finalize(g) {
  const participants = {};
  for (const r of g._union) {
    const seg = g.segments.find((x) => x.participants[r]);
    participants[r] = seg ? seg.participants[r] : { displayName: r };
  }
  const single = g.segments.length === 1;
  const sessions = g._sessions || [];
  // Singletons keep their real id; merged groups use the `group:` id. Both `id` and
  // `sessionId` carry the SAME value so the frontend list (which keys clicks/selection on
  // `sessionId`) can open a merged group's detail — the detail route handles `group:` ids.
  const finalId = single ? g.segments[0].sessionId : g.id;

  // Carry through the passthrough/summary fields the list card needs (voice memos, suffer,
  // strava, timezone). A singleton spreads its whole original session so NOTHING is lost;
  // a merged group concatenates memos and aggregates suffer across its segments.
  const base = single ? { ...sessions[0] } : {};
  const voiceMemos = sessions.flatMap((s) => (Array.isArray(s.voiceMemos) ? s.voiceMemos : []));
  let maxSufferScore = null;
  for (const s of sessions) {
    if (s.maxSufferScore != null) maxSufferScore = Math.max(maxSufferScore ?? -Infinity, s.maxSufferScore);
  }
  const totalSufferScore = sessions.reduce((a, s) => a + (s.totalSufferScore || 0), 0);

  return {
    ...base,
    id: finalId,
    sessionId: finalId,
    isGroup: !single,
    date: g.date,
    startTime: g.startTime,
    endTime: g.endTime,
    // Active time = the sum of the segments' own durations, NOT the wall-clock span
    // (start→end), which counts the idle gaps between blocks. The card should read how
    // long they actually worked out (e.g. 85m of riding), matching the merged-detail's
    // active total — not the 229m clock span from first start to last finish.
    durationMs: g.segments.reduce((sum, x) => sum + (x.durationMs || 0), 0),
    segments: g.segments,
    participants,
    totalCoins: g._coins,
    media: g._hasVideo ? g.segments[0].media : null,
    timezone: sessions[0]?.timezone,
    voiceMemos,
    maxSufferScore,
    totalSufferScore,
    // strava/notes are per-session — keep them only for singletons (a merged block has no single source)
    stravaActivityId: single ? (sessions[0]?.stravaActivityId ?? null) : null,
    strava: single ? (sessions[0]?.strava ?? null) : null,
    stravaNotes: single ? (sessions[0]?.stravaNotes ?? null) : null,
    activities: [], // filled later by SessionGroupingService
  };
}
