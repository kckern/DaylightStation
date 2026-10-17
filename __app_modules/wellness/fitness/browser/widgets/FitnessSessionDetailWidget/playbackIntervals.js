import { msToTickX } from './timelineOverlay.js';

const STATES = new Set(['waiting', 'playing', 'warning', 'governance_paused', 'paused', 'buffering', 'unknown', 'none']);
const videoEvents = events => events.filter(e => e?.type === 'media' && e.data?.contentType !== 'track' && !e.data?.artist);
const unknown = (startMs, endMs, contentId = null, title = null) => ({ startMs, endMs, state: 'unknown', reason: 'unknown', contentId, title, playbackRunId: null, evidence: null, firstPlaying: false });

/** Pure historical reduction. Only pairs of observed transitions prove coverage;
 * neither a selection nor the remainder of a crashed run proves actual playing. */
export function buildPlaybackIntervals(sessionData, axis) {
  const src = sessionData?.timeline ? sessionData : (sessionData?.session || sessionData);
  const events = Array.isArray(src?.timeline?.events) ? src.timeline.events : [];
  const videos = videoEvents(events);
  const limit = Math.max(0, (axis?.effectiveTicks - 1) * axis?.intervalMs);
  if (!Number.isFinite(limit) || !Number.isFinite(axis?.sessionStartMs)) return [];
  const segments = src?.segments?.length ? src.segments : [{ sourceStartMs: axis.sessionStartMs, offsetMs: 0, durationMs: limit }];
  if (segments.some(s => !Number.isFinite(s.sourceStartMs))) {
    return videos.length ? [unknown(0, limit)] : [];
  }
  const result = [];
  for (const segment of segments) {
    const origin = segment.sourceStartMs;
    const offset = segment.offsetMs;
    const end = Math.min(limit, offset + segment.durationMs);
    const absoluteEnd = origin + end - offset;
    const baselines = videos.flatMap(e => {
      const d = e.data;
      if (!Number.isFinite(d.start) || d.start >= absoluteEnd || (Number.isFinite(d.end) && d.end <= origin)) return [];
      return [unknown(Math.max(offset, offset + d.start - origin), Math.min(end, Number.isFinite(d.end) ? offset + d.end - origin : end), d.contentId, [d.grandparentTitle, d.title].filter(Boolean).join(' · '))];
    });
    const runs = new Map(); const seen = new Set();
    for (const evt of [...events].sort((a,b) => (a?.timestamp || 0) - (b?.timestamp || 0))) {
      const d = evt?.data;
      if (evt?.type !== 'playback_state' || d?.version !== 1 || !d.playbackRunId || !d.contentId
          || !STATES.has(d.state) || !['begin','change','end'].includes(d.observation)
          || !Number.isFinite(evt.timestamp) || evt.timestamp < origin || evt.timestamp > absoluteEnd) continue;
      const key = JSON.stringify(evt);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!runs.has(d.playbackRunId)) runs.set(d.playbackRunId, []);
      runs.get(d.playbackRunId).push(evt);
    }
    const candidates = [];
    for (const [playbackRunId, run] of runs) {
      if (run[0]?.data.observation !== 'begin') continue;
      let played = false;
      const beganWaiting = run[0].data.state === 'waiting';
      for (let i = 0; i < run.length; i++) {
        const e = run[i]; const d = e.data;
        if (d.observation === 'end') break;
        const startMs = Math.max(offset, offset + e.timestamp - origin);
        const endMs = Math.min(end, run[i+1] ? offset + run[i+1].timestamp - origin : startMs);
        const playing = d.state === 'playing' || d.state === 'warning';
        const firstPlaying = playing && !played && beganWaiting;
        played ||= playing;
        if (!(endMs > startMs)) continue;
        const title = baselines.find(b => b.contentId === d.contentId)?.title || d.contentId;
        candidates.push({ startMs, endMs, state: d.state, reason: d.reason || null, contentId: d.contentId,
          playbackRunId, evidence: d.evidence ? { ...d.evidence } : null, title, firstPlaying });
      }
    }
    const points = [...new Set([...baselines, ...candidates].flatMap(s => [s.startMs, s.endMs]))].sort((a,b) => a-b);
    for (let i = 0; i < points.length-1; i++) {
      const startMs = points[i]; const endMs = points[i+1];
      const covering = xs => xs.filter(s => s.startMs <= startMs && s.endMs >= endMs).at(-1);
      const match = covering(candidates) || covering(baselines);
      if (!match) continue;
      const item = { ...match, startMs, endMs, firstPlaying: match.firstPlaying && startMs === match.startMs };
      const prev = result.at(-1);
      // Do not join across observation runs or segment seams.
      if (prev && startMs !== offset && prev.endMs === startMs && prev.state === item.state && prev.reason === item.reason
          && prev.playbackRunId === item.playbackRunId && prev.contentId === item.contentId
          && JSON.stringify(prev.evidence) === JSON.stringify(item.evidence)) prev.endMs = endMs;
      else result.push(item);
    }
  }
  return result;
}

export function projectPlaybackIntervals(intervals, opts) {
  const clamp = x => Math.min((opts.marginLeft || 0) + opts.plotWidth, Math.max(opts.marginLeft || 0, x));
  return intervals.map(interval => {
    const x = clamp(msToTickX(interval.startMs, opts));
    return { ...interval, x, width: Math.max(0, clamp(msToTickX(interval.endMs, opts)) - x) };
  });
}
