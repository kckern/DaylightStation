/**
 * Contact-sheet navigation: find the first (or last) frame where content is
 * present by moving a sheet of evenly spaced frames around the timeline.
 *
 * A view is `{ f0, step }`: tiles show frames f0, f0+step, … (tiles count
 * fixed per search). After each look the decision model gives one verdict
 * per tile (true = content present, false = absent, null = abstain); `next()`
 * turns those verdicts into a move:
 *
 *   zoom    the boundary lies between two tiles: a finer sheet spanning them
 *   earlier the boundary is before this sheet
 *   later   the boundary is after this sheet
 *   done    step 1 and a clean transition: the exact frame
 *   giveup  swept the whole range and never saw the content (reason 'not-found')
 *   unknown guards tripped (budget, revisit, out of range, abstain at the edge)
 *
 * Pure: no I/O. The caller renders views and asks the questions.
 */

/**
 * @param {{ kind: 'start'|'end', expectedFrame: number, minFrame: number, maxFrame: number,
 *           tiles?: number, initialStep?: number, maxMoves?: number }} opts
 */
export function createSheetSearch({ kind, expectedFrame, minFrame, maxFrame, tiles = 12, initialStep = 12, maxMoves = 16, yes = YES, no = NO, f0: startAt = null }) {
  if (kind !== 'start' && kind !== 'end') throw new Error(`kind must be start|end, got ${kind}`);
  if (tiles < 3) throw new Error('need at least 3 tiles');
  const span = (tiles - 1) * initialStep;
  // An explicit first sheet (an edge search's bracket) wins over centring on the expectation
  const f0 = startAt != null ? Math.max(minFrame, startAt) : clamp(Math.round(expectedFrame - span / 2), minFrame, Math.max(minFrame, maxFrame - span));
  return {
    kind, tiles, minFrame, maxFrame, maxMoves, yes, no,
    view: { f0, step: initialStep },
    moves: 0,
    visited: [key({ f0, step: initialStep })],
    origin: { f0, step: initialStep }, // where the outward sweep is measured from
    sweep: 0, // index into the +1, -1, +2, -2, … sheet offsets tried after empty sheets
    path: [],
    obs: [], // confident observations across all looks: { f, present }
  };
}

/** Frames shown by a view. */
export function viewFrames(search, view = search.view) {
  return Array.from({ length: search.tiles }, (_, i) => view.f0 + i * view.step).filter((f) => f <= search.maxFrame);
}

/** Bands for reading probabilities: >= YES present, <= NO absent, between = unsure. */
export const YES = 0.65;
export const NO = 0.35;
/** At single-frame steps, an unsure stretch this short is settled at the 0.5 crossing. */
export const SOFT_MAX_FRAMES = 8;
/** A search that cannot settle but has the boundary bracketed this tightly returns the midpoint, soft. */
export const BRACKET_MAX_FRAMES = 24;

function toProb(v) {
  if (v === true) return 1;
  if (v === false) return 0;
  if (v == null) return 0.5;
  return Number(v);
}

/**
 * Apply one look's answers.
 * @param {object} search - from createSheetSearch (not mutated)
 * @param {Array<number|boolean|null>} verdicts - per tile, in tile order: a probability that the
 *   content is present (booleans and null are read as 1 / 0 / 0.5)
 * @returns {{ search: object, action: string, frame?: number, reason?: string }}
 */
export function nextMove(search, verdicts) {
  const r = stepMove(search, verdicts);
  if (r.action !== 'unknown') return r;
  const b = bracket(r.search);
  if (b && b.width <= BRACKET_MAX_FRAMES) {
    const frame = Math.round((b.absent + b.present) / 2 + (search.kind === 'start' ? 0.5 : -0.5));
    return { search: r.search, action: 'done', frame, soft: true, uncertainty: Math.ceil(b.width / 2), reason: `bracketed-${r.reason}` };
  }
  return r;
}

function stepMove(search, verdicts) {
  const frames = viewFrames(search);
  if (verdicts.length !== frames.length) throw new Error(`expected ${frames.length} verdicts, got ${verdicts.length}`);
  const { view } = search;
  const probs = verdicts.map(toProb);
  const Y0 = search.yes ?? YES; const N0 = search.no ?? NO;
  const obs = [...(search.obs || [])];
  frames.forEach((fr, i) => { if (probs[i] >= Y0) obs.push({ f: fr, present: true }); else if (probs[i] <= N0) obs.push({ f: fr, present: false }); });
  const record = (action, extra = {}) => ({ ...search, obs, path: [...search.path, { view, probs, action, ...extra }] });

  // Read the sheet in search order: for an end search, walk it backwards so
  // "the boundary" is always where absent turns into present.
  const order = search.kind === 'start' ? frames.map((_, i) => i) : frames.map((_, i) => frames.length - 1 - i);
  const p = order.map((i) => probs[i]);
  const f = order.map((i) => frames[i]);
  const towardOutside = search.kind === 'start' ? 'earlier' : 'later';

  const Y = search.yes ?? YES; const N = search.no ?? NO;
  if (view.step === 1) {
    const cp = changePoint(p, { yes: Y, no: N });
    if (cp) {
      return { search: record('done', { frame: f[cp.k], soft: cp.soft }), action: 'done', frame: f[cp.k], ...(cp.soft ? { soft: true } : {}) };
    }
  }

  const firstYes = p.findIndex((x) => x >= Y);
  if (firstYes < 0) {
    // No confident yes. A weak lean (> 0.5) is worth zooming toward; otherwise nothing is here.
    if (p.every((x) => x <= N)) return sweep(search, record);
    return { search: record('unknown'), action: 'unknown', reason: 'all-unsure' };
  }
  // Last confident no before the first yes
  let lastNo = -1;
  for (let i = firstYes - 1; i >= 0; i--) if (p[i] <= N) { lastNo = i; break; }
  if (lastNo < 0) {
    // Present (or unsure) right up to the outer edge: the boundary is further out.
    // Keep the first confident yes on the new sheet so the change stays in view.
    return shift(search, record, towardOutside, f[firstYes]);
  }
  const after = p.slice(firstYes);
  const flicker = after.some((x, i) => x <= N && after.slice(i).some((y) => y >= Y));
  const extra = flicker ? { reason: 'flicker' } : {};

  if (view.step === 1) {
    if (firstYes === lastNo + 1) return { search: record('done', { frame: f[firstYes] }), action: 'done', frame: f[firstYes], ...extra };
    // Unsure frames between the last no and the first yes: settle at the 0.5 crossing if short
    if (firstYes - lastNo - 1 > SOFT_MAX_FRAMES) return { search: record('unknown'), action: 'unknown', reason: 'wide-unsure' };
    let k = firstYes;
    const mid = (Y + N) / 2;
    for (let i = lastNo + 1; i < firstYes; i++) if (p[i] >= mid) { k = i; break; }
    return { search: record('done', { frame: f[k], soft: true }), action: 'done', frame: f[k], soft: true, ...extra };
  }
  const lo = Math.min(f[lastNo], f[firstYes]);
  const hi = Math.max(f[lastNo], f[firstYes]);
  const step = Math.max(1, Math.ceil((hi - lo) / (search.tiles - 1)));
  if (step === 1 && view.step > 1) {
    // Single frames: centre the sheet on the bracket so both sides stay in view
    const f0 = Math.round((lo + hi) / 2 - (search.tiles - 1) / 2);
    return go(search, record, 'zoom', { f0, step: 1 }, extra);
  }
  if (step === view.step && lo === view.f0) {
    // The unsure stretch fills the sheet: zooming cannot narrow it
    if (hi - lo + 1 <= search.tiles && step > 1) return go(search, record, 'zoom', { f0: lo, step: 1 }, extra);
    return { search: record('unknown'), action: 'unknown', reason: 'wide-unsure' };
  }
  return go(search, record, 'zoom', { f0: lo, step }, extra);
}

/**
 * Tightest bracket of the boundary from every confident observation so far:
 * for a start search, the latest absent frame before the earliest present one
 * (mirrored for an end search). Null when one side has not been seen.
 */
export function bracket(search) {
  const obs = search.obs || [];
  const present = obs.filter((o) => o.present).map((o) => o.f);
  if (!present.length) return null;
  if (search.kind === 'start') {
    const p = Math.min(...present);
    const a = obs.filter((o) => !o.present && o.f < p).map((o) => o.f);
    if (!a.length) return null;
    const absent = Math.max(...a);
    return { absent, present: p, width: p - absent };
  }
  const p = Math.max(...present);
  const a = obs.filter((o) => !o.present && o.f > p).map((o) => o.f);
  if (!a.length) return null;
  const absent = Math.min(...a);
  return { absent, present: p, width: absent - p };
}

/**
 * Best absent -> present split of a single-frame sheet (in search order),
 * read from probabilities: maximise agreement with a step function at 0.5.
 * Needs both sides on the sheet: some tile below 0.5 before the split and
 * some above after it, with a clear margin. `soft` when tiles near the split
 * are unsure.
 * @returns {{ k: number, soft: boolean }|null}
 */
export function changePoint(p, { yes = YES, no = NO, minScore = 0.6 } = {}) {
  const mid = (yes + no) / 2;
  // minScore is stated for the default 0.35-0.65 band; scale it to this band's width
  const need = minScore * (Math.max(0.05, yes - no) / (YES - NO));
  let best = null;
  for (let k = 1; k < p.length; k++) {
    let score = 0;
    for (let i = 0; i < p.length; i++) score += i < k ? mid - p[i] : p[i] - mid;
    if (!best || score > best.score) best = { k, score };
  }
  if (!best || best.score < need) return null;
  const before = p.slice(0, best.k); const after = p.slice(best.k);
  if (Math.min(...before) > mid || Math.max(...after) < mid) return null;
  if (Math.max(...after) < yes && Math.min(...before) > no) return null; // no confident side at all
  const near = p.slice(Math.max(0, best.k - 2), best.k + 2);
  return { k: best.k, soft: near.some((x) => x > no && x < yes) };
}

/**
 * Nothing on this sheet: step outward from the original sheet, alternating
 * sides (+1, -1, +2, -2 … sheets), skipping offsets outside the range. When no
 * offset is left, give up.
 */
function sweep(search, record) {
  const span = (search.tiles - 1) * search.origin.step;
  for (let i = search.sweep; i < 64; i++) {
    const n = Math.floor(i / 2) + 1;
    const offset = (i % 2 === 0 ? n : -n) * span;
    const f0 = search.origin.f0 + offset;
    if (f0 + span < search.minFrame || f0 > search.maxFrame) continue;
    const view = { f0: Math.max(search.minFrame, f0), step: search.origin.step };
    if (search.visited.includes(key(view))) continue;
    return go({ ...search, sweep: i + 1 }, record, offset > 0 ? 'later' : 'earlier', view);
  }
  return { search: record('giveup'), action: 'giveup', reason: 'not-found' };
}

function shift(search, record, dir, anchor = null) {
  const span = (search.tiles - 1) * search.view.step;
  let f0 = dir === 'earlier' ? search.view.f0 - span : search.view.f0 + span;
  // With an anchor, the anchor frame becomes the new sheet's inner edge
  if (anchor != null) f0 = dir === 'earlier' ? anchor - span : anchor;
  if (f0 + span < search.minFrame || f0 > search.maxFrame) {
    return { search: record('unknown'), action: 'unknown', reason: 'out-of-range' };
  }
  return go(search, record, dir, { f0: clamp(f0, search.minFrame - span, search.maxFrame), step: search.view.step });
}

function go(search, record, action, view, extra = {}) {
  const k = key(view);
  if (search.moves + 1 > search.maxMoves) return { search: record('unknown'), action: 'unknown', reason: 'budget' };
  if (search.visited.includes(k)) return { search: record('unknown'), action: 'unknown', reason: 'revisit' };
  const base = record(action, extra);
  return { search: { ...base, view: clampView(search, view), moves: search.moves + 1, visited: [...search.visited, k] }, action, ...extra };
}

function clampView(search, view) {
  return { f0: Math.max(search.minFrame, view.f0), step: view.step };
}

function key(view) {
  return `${view.f0}:${view.step}`;
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}
