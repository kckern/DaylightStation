import { Chess } from 'chess.js';

/**
 * Measuring how strong an opponent actually is, rather than what its label says.
 *
 * A rung's config says `skill: 0` and the roster says "Caterpie". Neither is a
 * strength. This asks every candidate opponent the same set of questions —
 * positions drawn from games the children really played — and scores each answer
 * against a full-strength reference, so rungs, presets and the children
 * themselves all come out on one comparable scale.
 *
 * Real positions rather than a standard test suite, deliberately: the ladder
 * only has to be correctly ordered over the kind of position this house's games
 * actually reach.
 */

const EVAL_CAP_CP = 1000;

/**
 * Positions sampled from archived games.
 *
 * Opening plies are skipped because book moves say nothing about strength, and
 * sampling every Nth ply spreads the set across all three phases instead of
 * over-weighting the openings, which are the part every game has most of.
 */
export function samplePositions(records, { limit = 80, skipOpeningPlies = 8, every = 3 } = {}) {
  const positions = [];
  for (const record of records) {
    const board = new Chess(record.initial_fen || undefined);
    let ply = 0;
    for (const move of (record.moves || []).filter((entry) => !entry.undone)) {
      ply += 1;
      if (ply > skipOpeningPlies && ply % every === 0 && !board.isGameOver()) {
        positions.push(board.fen());
      }
      try {
        board.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
      } catch {
        break; // a corrupt record stops contributing, it does not abort the run
      }
    }
  }
  if (positions.length <= limit) return positions;
  // Even stride rather than the first N: taking the head would draw every
  // position from the earliest games and measure the ladder against whatever
  // the children happened to play in one week.
  const stride = positions.length / limit;
  return Array.from({ length: limit }, (unused, index) => positions[Math.floor(index * stride)]);
}

function toNumber(score) {
  if (!score || score.terminal) return null;
  if (score.mate != null) return score.mate > 0 ? EVAL_CAP_CP : -EVAL_CAP_CP;
  if (score.cp == null) return null;
  return Math.max(-EVAL_CAP_CP, Math.min(EVAL_CAP_CP, score.cp));
}

/**
 * Score one candidate over the position set.
 *
 * `chooseMove(fen, index)` is whatever the candidate is — a configured ladder
 * rung, a homegrown preset, a bare skill level. Anything that answers a position
 * with a move can be measured, which is the point: comparing a Stockfish rung
 * against the homegrown opponent is exactly the comparison the ladder needs and
 * the two share no code. The index is passed so an engine-backed candidate can
 * derive a distinct game id per position and keep one position's search from
 * warming the next.
 *
 * ACPL here is only comparable WITHIN one run. The absolute number depends on
 * how sharp the sampled positions happen to be, so a candidate measured against
 * one position set cannot be compared with a number from another — which is why
 * every candidate in a run shares one set and one baseline.
 */
export async function measureCandidate({ positions, baseline, analyst, chooseMove, onProgress = null }) {
  let totalLoss = 0;
  let counted = 0;
  let blunders = 0;
  for (let index = 0; index < positions.length; index += 1) {
    const fen = positions[index];
    const before = baseline[index];
    if (before == null) continue;
    const move = await chooseMove(fen, index);
    if (!move) continue;
    const board = new Chess(fen);
    try {
      board.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
    } catch {
      continue;
    }
    const after = toNumber(await analyst.evaluate(board.fen()));
    if (after == null) continue;
    // `before` is from the mover's point of view; after the move it is the
    // opponent's turn, so their score negated is what the mover ended up with.
    const loss = Math.max(0, before - -after);
    totalLoss += loss;
    counted += 1;
    if (loss >= 300) blunders += 1;
    onProgress?.(index + 1, positions.length);
  }
  return {
    acpl: counted ? Math.round(totalLoss / counted) : 0,
    blunderRate: counted ? Math.round((100 * blunders) / counted) : 0,
    counted,
  };
}

/**
 * The reference: how good each position is for the side to move.
 *
 * Computed once and shared by every candidate, both because it is the expensive
 * half and because a candidate scored against its own reference would not be
 * comparable with the others.
 */
export async function computeBaseline(positions, analyst, { onProgress = null } = {}) {
  const baseline = [];
  for (let index = 0; index < positions.length; index += 1) {
    // `evaluate` returns white-positive; the mover's own view is what a loss is
    // measured against.
    const score = toNumber(await analyst.evaluate(positions[index]));
    const turn = positions[index].split(' ')[1] === 'b' ? 'b' : 'w';
    baseline.push(score == null ? null : (turn === 'w' ? score : -score));
    onProgress?.(index + 1, positions.length);
  }
  return baseline;
}

/**
 * Which measured candidates are actually distinguishable.
 *
 * Two rungs whose ACPL differs by less than the noise floor are one rung wearing
 * two names, and a ladder built from them promises a child progress it cannot
 * deliver. Candidates are collapsed into bands from the weakest down.
 */
export function distinctRungs(results, { minGapCp = 25 } = {}) {
  const ordered = [...results].sort((a, b) => b.acpl - a.acpl);
  const bands = [];
  // Compared against the PREVIOUS candidate, not against the band's first
  // member. Anchoring on the first admitted anything within one gap of it and
  // split the rest arbitrarily — it once reported skill 0 and skill 20 as the
  // same strength while placing skill 4 in a band of its own. Single linkage
  // instead: a long, evenly-spaced run collapses into one band, which is the
  // honest reading of a ladder whose rungs are each a step too small to feel.
  let previous = null;
  for (const result of ordered) {
    if (previous !== null && Math.abs(previous - result.acpl) < minGapCp) {
      bands[bands.length - 1].members.push(result.id);
    } else {
      bands.push({ acpl: result.acpl, members: [result.id] });
    }
    previous = result.acpl;
  }
  return bands;
}

/**
 * Whether the reference was deep enough to believe the result.
 *
 * A candidate that plays at or above the reference's own standard scores near
 * zero loss, so a reference that is too shallow reports every strong candidate
 * as identical — and "all one band" then means "the yardstick ran out", not
 * "the ladder is flat". Those two readings call for opposite actions (deepen
 * the reference vs. rebuild the ladder), so the difference cannot be left for
 * the reader to notice.
 */
export function saturationWarning(bands, results, { floorCp = 60 } = {}) {
  if (bands.length > 1) return null;
  if (results.length < 2) return null;
  const strongest = Math.min(...results.map((result) => result.acpl));
  if (strongest > floorCp) return null;
  return `all ${results.length} candidates landed in one band at ~${strongest} ACPL — `
    + 'the reference is probably too shallow to separate them, rather than the candidates being '
    + 'equal. Re-run with a higher --depth before concluding anything about their spacing.';
}

export default { samplePositions, measureCandidate, computeBaseline, distinctRungs };
