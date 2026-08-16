function clampLevel(value, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(1, Math.trunc(parsed))) : 1;
}

// A series entry used to be a bare 'win'/'loss'/'draw' string — that was the
// whole shape before help ceilings existed, and Connect Four/Checkers already
// have real players with that exact shape sitting in their persisted YAML.
// Coercing it here (rather than requiring the repository to migrate on write)
// means a legacy file loads with the same wins tally it had the day before
// this feature shipped: every old entry is treated as counted, because under
// the old rules every recorded game counted. Only entries written going
// forward can carry counted: false, and only once a caller actually supplies
// helpCeilings or ranked: false.
function normalizeSeriesEntry(entry) {
  if (typeof entry === 'string') {
    return { result: entry === 'win' || entry === 'loss' ? entry : 'draw', counted: true };
  }
  const result = entry?.result === 'win' || entry?.result === 'loss' ? entry.result : 'draw';
  return { result, counted: entry?.counted !== false };
}

/**
 * Does a game at `resolvedLevel`, played with this much help, count toward
 * promotion?
 *
 * Mirrors `countsTowardPromotion` in shared/gaming/chess/ladder.mjs — same two
 * gates (ranked, then help ceilings with the same unrestricted-level carve-out
 * and the same strictly-greater-than breach test), ported so the generic
 * ladder can carry chess's policy once chess migrates onto it (see the
 * piano-game-platform-integration plan). A ceiling of `undefined` in
 * `helpCeilings` means that dimension was never configured for this game and
 * so is unlimited — distinct from chess's own defaults, which are finite
 * (max_best_moves: 0 etc.) because chess always ships a policy. The generic
 * ladder has no opinion of its own; a caller that wants a chess-like ceiling
 * must say so.
 */
function withinHelpCeilings(resolvedLevel, help, helpCeilings) {
  if (!helpCeilings) return true;
  const unrestrictedBelowLevel = Number(helpCeilings.unrestricted_below_level || 0);
  // The bottom of the ladder teaches the game, not the discipline — same
  // rationale as chess's own carve-out, expressed in this ladder's own
  // (1-based) level numbering. See OpponentLadder's class comment.
  if (resolvedLevel < unrestrictedBelowLevel) return true;
  const { max_hints: maxHints, max_best_moves: maxBestMoves, max_takebacks: maxTakebacks } = helpCeilings;
  if (maxBestMoves != null && Number(help?.best_moves || 0) > Number(maxBestMoves)) return false;
  if (maxHints != null && Number(help?.hints || 0) > Number(maxHints)) return false;
  if (maxTakebacks != null && Number(help?.takebacks || 0) > Number(maxTakebacks)) return false;
  return true;
}

/**
 * Pure aggregate that owns unlock and promotion invariants for opponent
 * ladders.
 *
 * Levels here are 1-based (the first opponent is level 1), unlike chess's
 * 0-based engine skill levels in shared/gaming/chess/ladder.mjs. That matters
 * for `helpCeilings.unrestricted_below_level`: this ladder reads it in its own
 * (1-based) numbering, so a caller porting a chess-style policy across the two
 * systems must add 1 to the threshold, not copy it verbatim. This ladder does
 * not do that conversion itself — it only knows its own numbering.
 */
export class OpponentLadder {
  constructor({ opponents, progress = null, winsRequired = 3, seriesLength = 5, helpCeilings = null }) {
    if (!Array.isArray(opponents) || opponents.length === 0) throw new Error('OpponentLadder: opponents required');
    this.opponents = opponents.map((opponent, index) => Object.freeze({ ...opponent, level: index + 1 }));
    this.winsRequired = clampLevel(winsRequired, seriesLength);
    this.seriesLength = Math.max(this.winsRequired, Number(seriesLength) || 5);
    this.unlockedThrough = clampLevel(progress?.unlockedThrough, this.opponents.length);
    this.series = Array.isArray(progress?.series)
      ? progress.series.slice(-this.seriesLength).map(normalizeSeriesEntry)
      : [];
    this.helpCeilings = helpCeilings ? { ...helpCeilings } : null;
  }

  resolve(requestedLevel) {
    const level = Math.min(clampLevel(requestedLevel, this.opponents.length), this.unlockedThrough);
    return { level, opponent: this.opponents[level - 1] };
  }

  /**
   * Would a game at `playedLevel`, played with this much help, count toward
   * promotion? Exported as a predicate (not just baked into `record`) so a
   * caller can warn a player before the game ends — "that takeback just cost
   * you the promotion" is a useful thing to say mid-game, not just after.
   */
  countsToward(playedLevel, { help = {}, ranked = true } = {}) {
    if (!ranked) return false;
    const resolved = this.resolve(playedLevel);
    return withinHelpCeilings(resolved.level, help, this.helpCeilings);
  }

  record(result, playedLevel, { help = {}, ranked = true } = {}) {
    const resolved = this.resolve(playedLevel);
    const resultValue = result === 'win' ? 'win' : result === 'loss' ? 'loss' : 'draw';
    const counted = this.countsToward(playedLevel, { help, ranked });
    // Recorded either way — an unranked or help-heavy game is not evidence
    // this rung is beaten, but it is still evidence the player showed up, and
    // dropping it entirely would make the "last N games" window lie about how
    // many games were actually played. Mirrors `applyGameToProgress` in
    // shared/gaming/chess/ladder.mjs, which keeps every game and lets
    // `counted` do the filtering.
    const series = [...this.series, { result: resultValue, counted }].slice(-this.seriesLength);
    const wins = series.filter((entry) => entry.counted && entry.result === 'win').length;
    const promoted = resolved.level === this.unlockedThrough
      && wins >= this.winsRequired
      && this.unlockedThrough < this.opponents.length;
    return new OpponentLadder({
      opponents: this.opponents,
      winsRequired: this.winsRequired,
      seriesLength: this.seriesLength,
      helpCeilings: this.helpCeilings,
      progress: { unlockedThrough: promoted ? this.unlockedThrough + 1 : this.unlockedThrough, series: promoted ? [] : series },
    });
  }

  snapshot() {
    const current = this.opponents[this.unlockedThrough - 1];
    return {
      unlocked_through: this.unlockedThrough,
      wins_required: this.winsRequired,
      series_length: this.seriesLength,
      series: [...this.series],
      wins: this.series.filter((entry) => entry.counted && entry.result === 'win').length,
      current,
      opponents: this.opponents.map((opponent) => ({ ...opponent, unlocked: opponent.level <= this.unlockedThrough })),
    };
  }
}

export default OpponentLadder;
