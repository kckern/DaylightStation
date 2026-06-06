export const GROUP_MAX_GAP_MS = 4 * 60 * 60 * 1000; // 4h ceiling

const rosterSet = (s) => new Set(Object.keys(s.participants || {}));
const hasVideo  = (s) => !!(s.media && s.media.primary);

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
      s.date !== cur.date ||
      (startMs - cur._lastEndMs) > maxGapMs;

    if (mustBreak) {
      cur = { id: `group:${s.sessionId}`, isGroup: true, date: s.date,
              startTime: startMs, endTime: endMs, segments: [], _lastEndMs: endMs,
              _hasVideo: hasVideo(s), _coins: 0, _prevEnd: endMs };
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
  // Singletons keep their real id; merged groups use the `group:` id. Both `id` and
  // `sessionId` carry the SAME value so the frontend list (which keys clicks/selection on
  // `sessionId`) can open a merged group's detail — the detail route handles `group:` ids.
  const finalId = single ? g.segments[0].sessionId : g.id;
  return {
    id: finalId,
    sessionId: finalId,
    isGroup: !single,
    date: g.date,
    startTime: g.startTime,
    endTime: g.endTime,
    durationMs: g.endTime - g.startTime,
    segments: g.segments,
    participants,
    totalCoins: g._coins,
    media: g._hasVideo ? g.segments[0].media : null,
    activities: [], // filled later by SessionGroupingService
  };
}
