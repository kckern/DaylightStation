/**
 * How this ride compares with the rider's history at the same type and length. Pure.
 * Distance race: value is finish time (lower wins). Time race: value is distance (higher wins).
 * Equal to the previous best is not a new best. Non-finite `previousBest`/`last` count as absent.
 *
 * @param {{winCondition?: 'distance'|'time', value?: number|null, previousBest?: number|null, last?: number|null}} [args]
 * @returns {{isBest:boolean, vsBest:number|null, vsLast:number|null, better:boolean}|null}
 *   null for a non-finite value or a winCondition other than distance/time
 */
export function resultsComparison({ winCondition = 'distance', value = null, previousBest = null, last = null } = {}) {
  if (winCondition !== 'distance' && winCondition !== 'time') return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const ok = (v) => typeof v === 'number' && Number.isFinite(v);
  const lowerWins = winCondition === 'distance';
  const diff = (ref) => (ok(ref) ? Math.round((value - ref) * 10) / 10 : null);
  const beats = (ref) => (lowerWins ? value < ref : value > ref);
  const isBest = !ok(previousBest) || beats(previousBest);
  return { isBest, vsBest: diff(previousBest), vsLast: diff(last), better: isBest };
}

/**
 * Plain-text lines for the results board, from a resultsComparison() result.
 * Seconds (distance race) and metres (time race) are rounded to whole numbers.
 *
 * @param {{isBest:boolean, vsBest:number|null, vsLast:number|null}|null} cmp
 * @param {'distance'|'time'} winCondition
 * @returns {string[]} empty when there is nothing to say
 */
export function comparisonLines(cmp, winCondition) {
  if (!cmp || (winCondition !== 'distance' && winCondition !== 'time')) return [];
  const dist = winCondition === 'distance';
  const unit = dist ? 's' : 'm';
  const whole = (v) => Math.abs(Math.round(v));
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const lines = [];
  if (cmp.isBest) {
    if (!isNum(cmp.vsBest)) return ['First ride at this length'];
    lines.push('New best', `${whole(cmp.vsBest)} ${unit} ${dist ? 'faster' : 'further'}`);
    return lines;
  }
  if (isNum(cmp.vsBest)) lines.push(`${whole(cmp.vsBest)} ${unit} ${dist ? 'off' : 'short of'} your best`);
  if (isNum(cmp.vsLast) && Math.round(cmp.vsLast) !== 0) {
    const n = whole(cmp.vsLast);
    const better = dist ? cmp.vsLast < 0 : cmp.vsLast > 0;
    const word = dist ? (better ? 'faster' : 'slower') : (better ? 'further' : 'less');
    lines.push(`${n} ${unit} ${word} than last time`);
  }
  return lines;
}

export default resultsComparison;
