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
   * @param {{speedup:number, outputFps:number, resolveName?:(slug:string)=>string}} spec
   * @returns {FrameDescriptor[]}
   */
  buildFrames(session, { speedup, outputFps, resolveName = null }) {
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

    // Camera and player frames are both captured client-side (realtime UI grab),
    // tagged by role. Untagged captures are treated as camera for backward compat.
    const byTs = (a, b) => toMs(a.timestamp) - toMs(b.timestamp);
    const cameraCaptures = captures.filter(c => (c.role || 'camera') === 'camera').sort(byTs);
    const playerCaptures = captures.filter(c => c.role === 'player').sort(byTs);
    if (!cameraCaptures.length) return [];

    // Animated coin total: treasureBox holds only the final totalCoins, so we
    // reconstruct a plausible accrual curve by weighting each tick by active
    // participation and normalizing the cumulative curve to end at totalCoins.
    const totalCoins = Number.isFinite(session?.treasureBox?.totalCoins) ? session.treasureBox.totalCoins : 0;
    const coinCurve = buildCoinCurve(decoded, roster, totalCoins);

    const frames = [];
    for (let i = 0; i < frameCount; i++) {
      const elapsedRealMs = (i / outputFps) * speedup * 1000;
      const wallClockMs = startMs + elapsedRealMs;
      const tickIndex = Math.floor((elapsedRealMs / 1000) / intervalSec);

      const camera = nearestByTimestamp(cameraCaptures, wallClockMs);
      const player = nearestByTimestamp(playerCaptures, wallClockMs);
      const media = activeMedia(mediaEvents, wallClockMs);

      const participants = roster.map(p => ({
        id: p.id,
        // Honor the persisted resolver output first (display_name), then the
        // injected backend resolver (userService), then the slug — mirrors
        // FitnessReceiptRenderer's name chain.
        displayName: p.display_name || p.displayName || (resolveName ? resolveName(p.id) : null) || p.id,
        color: p.color || null,
        avatarRef: p.avatarRef || p.avatar || p.id,
        hr: valueAtTick(decoded, hrKeyFor(decoded, p.id), tickIndex),
        zone: valueAtTick(decoded, `${p.id}:zone`, tickIndex)
      }));

      frames.push(new FrameDescriptor({
        frameIndex: i,
        wallClockMs,
        elapsedRealMs,
        cameraTimestamp: camera ? toMs(camera.timestamp) : null,
        playerTimestamp: player ? toMs(player.timestamp) : null,
        playerContentId: media?.data?.contentId || null,
        title: media?.data?.title || null,
        showTitle: media?.data?.grandparentTitle || media?.data?.showTitle || null,
        participants,
        zone: zoneAtTick(decoded, roster, tickIndex),
        rpm: rpmKey ? valueAtTick(decoded, rpmKey, tickIndex) : null,
        coins: coinsAt(coinCurve, tickIndex, totalCoins, i, frameCount)
      }));
    }
    return frames;
  }
}

// Per-tick earning weight by zone, accumulated and normalized to totalCoins.
const ZONE_WEIGHT = { cool: 0.3, active: 1, warm: 1, hot: 1.2, max: 1.5 };
function buildCoinCurve(decoded, roster, totalCoins) {
  if (!(totalCoins > 0)) return null;
  const zoneArrays = roster.map(p => decoded[`${p.id}:zone`]).filter(Array.isArray);
  const len = zoneArrays.reduce((m, a) => Math.max(m, a.length), 0);
  if (!len) return null;
  const cum = new Array(len);
  let running = 0;
  for (let t = 0; t < len; t++) {
    for (const arr of zoneArrays) {
      const z = arr[t];
      if (z == null) continue;
      running += ZONE_WEIGHT[String(z).toLowerCase()] ?? 1;
    }
    cum[t] = running;
  }
  return { cum, total: running || 1 };
}
function coinsAt(curve, tick, totalCoins, frameIndex, frameCount) {
  if (!(totalCoins > 0)) return null;
  if (!curve) {
    // Linear fallback when no zone data is available.
    return Math.round(totalCoins * (frameCount > 1 ? frameIndex / (frameCount - 1) : 1));
  }
  const idx = Math.min(curve.cum.length - 1, Math.max(0, tick));
  return Math.round(totalCoins * (curve.cum[idx] / curve.total));
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
