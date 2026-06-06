const WINDOW_SLACK_MS = 90 * 1000; // a race may start a touch before/after the session edge

// SINGLE place in the codebase that interprets the UTC race.date string.
export function raceEpochMs(record) {
  const ms = Date.parse(record?.race?.date);
  return Number.isFinite(ms) ? ms : null;
}

const GHOST_PREFIX = 'ghost:';
const isGhost = (id) => String(id).startsWith(GHOST_PREFIX);

// Decoded length of an RLE series: entries are either a value (1 tick) or [value, runLength].
function decodedSeriesLen(series) {
  let arr = series;
  if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { return 0; } }
  if (!Array.isArray(arr)) return 0;
  let n = 0;
  for (const e of arr) n += (Array.isArray(e) ? (Number(e[1]) || 1) : 1);
  return n;
}

// Band duration = how long the race ACTUALLY ran, taken from the recorded data — NOT the
// time cap or win condition. A "180s time race" abandoned after 13s recorded only ~13s of
// samples; drawing it cap-wide makes its band swallow the next race ("race within race").
// Use the longest recorded series (real riders); fall back to a distance finish time, then
// the cap only when there is no recorded data at all.
function raceDurationS(record, parts) {
  const interval = record?.race?.interval_seconds || 1;
  let maxTicks = 0;
  for (const [, p] of parts) maxTicks = Math.max(maxTicks, decodedSeriesLen(p.distance_series));
  if (maxTicks > 0) return Math.max(0, (maxTicks - 1) * interval);
  let maxFinal = 0;
  for (const [, p] of parts) {
    if (Number.isFinite(p.final_time_s) && p.final_time_s > 0) maxFinal = Math.max(maxFinal, p.final_time_s);
  }
  return maxFinal > 0 ? maxFinal : (record?.race?.time_cap_s || 0);
}

function toItem(record) {
  const startMs = raceEpochMs(record);
  if (startMs == null) return null;
  const parts = Object.entries(record.participants || {}).filter(([id]) => !isGhost(id));
  const distances = {};
  let winnerId = null;
  let bestPlacement = Infinity;
  for (const [id, p] of parts) {
    distances[id] = p.final_distance_m ?? 0;
    const pl = Number.isFinite(p.placement) ? p.placement : Infinity;
    if (pl < bestPlacement) { bestPlacement = pl; winnerId = id; }
  }
  const capS = record?.race?.time_cap_s || 0;
  const durS = raceDurationS(record, parts);
  return {
    startMs,
    endMs: startMs + durS * 1000,
    participants: parts.map(([id]) => id),
    meta: { raceId: record?.race?.id, winnerId, distances,
            timeCapS: capS, durationS: durS, backgroundPlexId: record?.race?.background_plex_id ?? null },
  };
}

export class CycleGameProvider {
  type = 'cycle-game';
  constructor({ cycleRaceService } = {}) {
    if (!cycleRaceService) throw new Error('CycleGameProvider requires cycleRaceService');
    this.cycleRaceService = cycleRaceService;
  }
  async loadOverlapping(startMs, endMs, dateStr, householdId) {
    // Races are read from the single local-date folder; safe because groups never span local midnight (calendar-day boundary).
    const records = (await this.cycleRaceService.listByDate(dateStr, householdId)) || [];
    return records
      .map(toItem)
      .filter((it) => it && it.startMs >= startMs - WINDOW_SLACK_MS && it.startMs <= endMs + WINDOW_SLACK_MS)
      .sort((a, b) => a.startMs - b.startMs);
  }
}

export default CycleGameProvider;
