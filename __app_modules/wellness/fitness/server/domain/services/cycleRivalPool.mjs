/**
 * Pace-rival pool: the light listing a lone rider's rival is chosen from. Pure
 * domain logic over race index rows (see indexEntryFromRecord): no I/O.
 * The choice itself is made by the client (one rule, shared with the races it
 * already has loaded); this only narrows the index to the races that could
 * hold it and renames the fields to the client's candidate shape.
 */

const WIN_CONDITIONS = ['distance', 'time'];

/**
 * A rival-pool request as `{ winCondition, length }`, or null when it names no
 * usable race: an unknown race type, or a length (goalM for a distance race,
 * timeCapS for a time race) that is not a positive finite number. Lengths may
 * arrive as query strings.
 */
export function parseRivalPoolQuery({ winCondition = null, goalM = null, timeCapS = null } = {}) {
  if (!WIN_CONDITIONS.includes(winCondition)) return null;
  const raw = winCondition === 'distance' ? goalM : timeCapS;
  const isNumeric = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '');
  const length = isNumeric ? Number(raw) : NaN;
  if (!Number.isFinite(length) || length <= 0) return null;
  return { winCondition, length };
}

const rowLength = (row, winCondition) => {
  const raw = winCondition === 'distance' ? row.goal_m : row.time_cap_s;
  return raw == null ? NaN : Number(raw);
};

/**
 * Index rows of one race type and exact length, as rival-pool entries. Rows
 * flagged `incomplete` (ended early) are left out. Ghost and stopped riders
 * stay in, flagged: the client's selection rule skips them, and a race whose
 * only riders are skipped still counts as a race considered.
 *
 * @param {object} [args]
 * @param {Array} [args.entries] index rows
 * @param {'distance'|'time'} [args.winCondition]
 * @param {number} [args.length] goal in metres, or time cap in seconds
 * @returns {Array<{ raceId: string, date: string, winCondition: string,
 *   goalM?: number, timeCapS?: number, participants: Array<{ id: string,
 *   isGhost: boolean, stopped: boolean, finalTimeS: number|null,
 *   finalDistanceM: number, placement: number|null }> }>}
 */
export function rivalPoolEntries({ entries = [], winCondition = null, length = null } = {}) {
  if (!WIN_CONDITIONS.includes(winCondition) || !Number.isFinite(length) || length <= 0) return [];
  return (Array.isArray(entries) ? entries : [])
    .filter((row) => row && !row.incomplete && row.win_condition === winCondition
      && rowLength(row, winCondition) === length)
    .map((row) => ({
      raceId: row.id,
      date: row.date,
      winCondition,
      ...(winCondition === 'distance' ? { goalM: length } : { timeCapS: length }),
      participants: (Array.isArray(row.participants) ? row.participants : []).map((p) => ({
        id: p.userId,
        isGhost: !!p.isGhost,
        stopped: !!p.stopped,
        finalTimeS: p.final_time_s ?? null,
        finalDistanceM: p.final_distance_m ?? null,
        placement: p.placement ?? null
      }))
    }));
}
