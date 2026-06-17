import { decodeSeries } from './TimelineService.mjs';
import { FrameDescriptor } from '#domains/fitness/value-objects/FrameDescriptor.mjs';

/**
 * Pure domain service: maps persisted session data into an ordered list of
 * FrameDescriptors for a time-lapse render. No I/O — all inputs via parameters.
 *
 * Series-key conventions (verified against real session YAML):
 *   - per-participant HR:   `{participantId}:hr`   (e.g. `kckern:hr`)
 *   - per-participant zone: `{participantId}:zone`
 *   - bike cadence:         `bike:{deviceId}:rpm`  (e.g. `bike:7138:rpm`)
 */
export class TimelapseFrameMapper {
  /**
   * @param {object} session - plain session data (as from datastore.findById)
   * @param {{speedup:number, outputFps:number}} spec
   * @returns {FrameDescriptor[]}
   */
  buildFrames(session, { speedup, outputFps }) {
    const captures = session?.snapshots?.captures || [];
    if (!captures.length) return [];

    const startMs = toMs(session.startTime);
    const endMs = toMs(session.endTime);
    const durationSec = Math.max(0, (endMs - startMs) / 1000);
    if (!(durationSec > 0)) return [];

    const outputDurationSec = durationSec / speedup;
    const frameCount = Math.ceil(outputDurationSec * outputFps);

    const intervalSec = session?.timeline?.interval_seconds || 5;
    const decoded = decodeSeries(session?.timeline?.series || {});
    const rpmKey = Object.keys(decoded).find(k => k.endsWith(':rpm')) || null;
    const mediaEvents = (session?.timeline?.events || [])
      .filter(e => e?.type === 'media' && Number.isFinite(toMs(e.timestamp)))
      .sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));
    const roster = session?.roster || [];

    const sortedCaptures = [...captures].sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));

    const frames = [];
    for (let i = 0; i < frameCount; i++) {
      const elapsedRealMs = (i / outputFps) * speedup * 1000;
      const wallClockMs = startMs + elapsedRealMs;
      const tickIndex = Math.floor((elapsedRealMs / 1000) / intervalSec);

      const camera = nearestByTimestamp(sortedCaptures, wallClockMs);
      const media = activeMedia(mediaEvents, wallClockMs);

      const participants = roster.map(p => ({
        id: p.id,
        displayName: p.displayName || p.display_name || p.id,
        color: p.color || null,
        avatarRef: p.avatarRef || p.avatar || null,
        hr: valueAtTick(decoded, hrKeyFor(decoded, p.id), tickIndex),
        zone: valueAtTick(decoded, `${p.id}:zone`, tickIndex)
      }));

      frames.push(new FrameDescriptor({
        frameIndex: i,
        wallClockMs,
        elapsedRealMs,
        cameraTimestamp: camera ? toMs(camera.timestamp) : null,
        playerContentId: media?.data?.contentId || null,
        playerOffsetMs: media ? Math.max(0, wallClockMs - toMs(media.timestamp)) : null,
        title: media?.data?.title || null,
        participants,
        zone: zoneAtTick(decoded, roster, tickIndex),
        rpm: rpmKey ? valueAtTick(decoded, rpmKey, tickIndex) : null
      }));
    }
    return frames;
  }
}

function toMs(t) {
  if (Number.isFinite(t)) return t;
  const n = Date.parse(t);
  return Number.isFinite(n) ? n : NaN;
}
function nearestByTimestamp(sorted, t) {
  if (!sorted.length) return null;
  let best = sorted[0], bestD = Math.abs(toMs(sorted[0].timestamp) - t);
  for (const c of sorted) {
    const d = Math.abs(toMs(c.timestamp) - t);
    if (d < bestD) { best = c; bestD = d; }
  }
  return best;
}
function activeMedia(events, t) {
  let active = null;
  for (const e of events) { if (toMs(e.timestamp) <= t) active = e; else break; }
  return active;
}
function hrKeyFor(decoded, participantId) {
  if (decoded[`${participantId}:hr`]) return `${participantId}:hr`;
  return Object.keys(decoded).find(k => k.endsWith(':hr')) || null;
}
function valueAtTick(decoded, key, tick) {
  if (!key) return null;
  const arr = decoded[key];
  if (!Array.isArray(arr)) return null;
  const v = arr[tick];
  return v == null ? null : v;
}
// Zone is per-participant; for the single bottom-strip zone label prefer the
// first roster participant's zone, falling back to any `:zone` series.
function zoneAtTick(decoded, roster, tick) {
  for (const p of roster) {
    const v = valueAtTick(decoded, `${p.id}:zone`, tick);
    if (v != null) return v;
  }
  const key = Object.keys(decoded).find(k => k.endsWith(':zone'));
  return key ? valueAtTick(decoded, key, tick) : null;
}
