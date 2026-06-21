import { decodeSeries } from './TimelineService.mjs';
import { FrameDescriptor } from '#domains/fitness/value-objects/FrameDescriptor.mjs';
import { cssColorForStrap } from '#domains/fitness/strapColors.mjs';

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
  buildFrames(session, { speedup, outputFps, resolveName = null, resolveColor = null, resolveGroupLabel = null, cadenceDevices = null, cadenceColors = null }) {
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
    const idColors = assignIdentityColors(roster.map(p => p.id));
    const chartBase = buildChart(decoded, roster, resolveColor);
    const cadenceBases = buildCadenceBases(decoded, cadenceDevices, cadenceColors);
    // 2+ riders → prefer each user's short GROUP LABEL (e.g. "Dad" for kckern),
    // mirroring the live UI's shouldPreferGroupLabels. Solo session keeps full names.
    const preferGroup = roster.length >= 2;
    const tz = typeof session?.timezone === 'string' ? session.timezone : null;

    const frames = [];
    for (let i = 0; i < frameCount; i++) {
      const elapsedRealMs = (i / outputFps) * speedup * 1000;
      const wallClockMs = startMs + elapsedRealMs;
      const tickIndex = Math.floor((elapsedRealMs / 1000) / intervalSec);

      const camera = nearestByTimestamp(cameraCaptures, wallClockMs);
      const player = nearestByTimestamp(playerCaptures, wallClockMs);
      const media = activeMedia(mediaEvents, wallClockMs);

      const participants = roster.map((p, idx) => ({
        id: p.id,
        displayName: pickName(p, preferGroup, resolveGroupLabel, resolveName),
        color: colorForParticipant(p, idColors, resolveColor),
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
        coins: coinsAt(coinCurve, tickIndex, totalCoins, i, frameCount),
        chart: chartFor(chartBase, participants, tickIndex),
        cadence: cadenceAt(cadenceBases, tickIndex),
        timezone: tz
      }));
    }
    return frames;
  }
}

// Identity palette + assignment — MUST mirror the frontend SSOT
// (frontend/src/modules/Fitness/lib/participantColors.js) so the recap uses each
// user's SAME assigned colour as the live UI. Colours are assigned by SORTED
// participant id, so a given roster always yields the same colours.
const IDENTITY_PALETTE = ['#b388ff', '#ff6fd8', '#00bfa5', '#8c9eff', '#a1887f', '#26c6da'];
function assignIdentityColors(ids) {
  const clean = [...new Set((ids || []).filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b));
  const map = new Map();
  clean.forEach((id, i) => map.set(id, IDENTITY_PALETTE[i % IDENTITY_PALETTE.length]));
  return map;
}

// Participant label: when a group is present, prefer the resolved GROUP LABEL
// (e.g. "Dad"); otherwise the persisted display name, the injected resolver, then
// the slug. resolveGroupLabel returns the id unchanged when there's no profile, so
// that case falls through to the normal name.
function pickName(p, preferGroup, resolveGroupLabel, resolveName) {
  const base = p.display_name || p.displayName || (resolveName ? resolveName(p.id) : null) || p.id;
  if (preferGroup && resolveGroupLabel) {
    const g = resolveGroupLabel(p.id);
    if (g && g !== p.id) return g;
  }
  return base;
}

// A participant's display colour: an explicit roster colour, else their real
// assigned strap colour (resolved from the HR device), else the identity fallback.
function colorForParticipant(p, idColors, resolveColor) {
  return p.color
    || (resolveColor ? resolveColor(p.hrDeviceId ?? p.hr_device) : null)
    || idColors.get(p.id);
}

// Simplified FitnessChart payload: per-participant cumulative-coins series (the
// "race" the chart visualises). The series arrays are shared across every frame
// (cheap); only `tick` + the per-participant live zone change frame to frame.
const COIN_RATE = { rest: 0, c: 0, cool: 0, a: 1, active: 1, w: 3, warm: 3, h: 5, hot: 5, m: 7, max: 7, f: 7, fire: 7 };
function cumulativeFromZone(zones) {
  if (!Array.isArray(zones)) return null;
  const out = []; let run = 0;
  for (const z of zones) { run += COIN_RATE[String(z).toLowerCase()] ?? 0; out.push(run); }
  return out;
}
function buildChart(decoded, roster, resolveColor = null) {
  if (!roster.length) return null;
  const idColors = assignIdentityColors(roster.map(p => p.id));
  const series = roster.map(p => {
    let coins = decoded[`${p.id}:coins`];
    if (!Array.isArray(coins) || !coins.length) coins = cumulativeFromZone(decoded[`${p.id}:zone`]) || [];
    return { id: p.id, color: colorForParticipant(p, idColors, resolveColor), coins };
  });
  const totalTicks = series.reduce((m, s) => Math.max(m, s.coins.length), 0);
  let maxCoins = 0;
  for (const s of series) for (const v of s.coins) if (v != null && v > maxCoins) maxCoins = v;
  return (totalTicks && maxCoins > 0) ? { totalTicks, maxCoins, series } : null;
}
function chartFor(base, participants, tick) {
  if (!base) return null;
  return {
    tick,
    totalTicks: base.totalTicks,
    maxCoins: base.maxCoins,
    series: base.series.map((s, i) => ({ id: s.id, color: s.color, coins: s.coins, zone: participants[i]?.zone ?? null }))
  };
}

// Cadence/equipment: each `bike:{deviceId}:rpm` series → its equipment name + the
// bike's assigned cadence colour (fitness.yml devices.cadence + device_colors.cadence).
// The equipment icon (rendered later) identifies WHICH device each RPM belongs to.
function buildCadenceBases(decoded, cadenceDevices, cadenceColors) {
  if (!cadenceDevices) return null;
  const get = (map, id) => (map ? (map[id] ?? map[Number(id)]) : undefined);
  const bases = [];
  for (const key of Object.keys(decoded)) {
    const m = key.match(/^bike:(.+):rpm$/);
    if (!m || !Array.isArray(decoded[key])) continue;
    const deviceId = m[1];
    const equipment = get(cadenceDevices, deviceId) || null;
    if (!equipment) continue;
    bases.push({ deviceId, series: decoded[key], equipment, color: cssColorForStrap(get(cadenceColors, deviceId)) || null });
  }
  return bases.length ? bases : null;
}
function cadenceAt(bases, tick) {
  if (!bases) return null;
  const out = [];
  for (const b of bases) {
    const rpm = b.series[tick];
    if (rpm == null || rpm <= 0) continue;
    out.push({ deviceId: b.deviceId, equipment: b.equipment, color: b.color, rpm });
  }
  return out.length ? out : null;
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
