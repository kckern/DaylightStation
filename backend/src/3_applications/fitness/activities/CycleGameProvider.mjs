const WINDOW_SLACK_MS = 90 * 1000; // a race may start a touch before/after the session edge

// SINGLE place in the codebase that interprets the UTC race.date string.
export function raceEpochMs(record) {
  const ms = Date.parse(record?.race?.date);
  return Number.isFinite(ms) ? ms : null;
}

function toItem(record) {
  const startMs = raceEpochMs(record);
  if (startMs == null) return null;
  const parts = Object.entries(record.participants || {});
  const distances = {};
  let winnerId = null;
  for (const [id, p] of parts) {
    distances[id] = p.final_distance_m ?? 0;
    if (p.placement === 1) winnerId = id;
  }
  const capS = record?.race?.time_cap_s || 0;
  return {
    startMs,
    endMs: startMs + capS * 1000,
    participants: parts.map(([id]) => id),
    meta: { raceId: record?.race?.id, winnerId, distances,
            timeCapS: capS, backgroundPlexId: record?.race?.background_plex_id ?? null },
  };
}

export class CycleGameProvider {
  type = 'cycle-game';
  constructor({ cycleRaceService } = {}) {
    if (!cycleRaceService) throw new Error('CycleGameProvider requires cycleRaceService');
    this.cycleRaceService = cycleRaceService;
  }
  async loadOverlapping(startMs, endMs, dateStr, householdId) {
    const records = (await this.cycleRaceService.listByDate(dateStr, householdId)) || [];
    return records
      .map(toItem)
      .filter((it) => it && it.startMs >= startMs - WINDOW_SLACK_MS && it.startMs <= endMs + WINDOW_SLACK_MS)
      .sort((a, b) => a.startMs - b.startMs);
  }
}

export default CycleGameProvider;
