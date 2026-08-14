function clampLevel(value, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(1, Math.trunc(parsed))) : 1;
}

/** Pure aggregate that owns unlock and promotion invariants for opponent ladders. */
export class OpponentLadder {
  constructor({ opponents, progress = null, winsRequired = 3, seriesLength = 5 }) {
    if (!Array.isArray(opponents) || opponents.length === 0) throw new Error('OpponentLadder: opponents required');
    this.opponents = opponents.map((opponent, index) => Object.freeze({ ...opponent, level: index + 1 }));
    this.winsRequired = clampLevel(winsRequired, seriesLength);
    this.seriesLength = Math.max(this.winsRequired, Number(seriesLength) || 5);
    this.unlockedThrough = clampLevel(progress?.unlockedThrough, this.opponents.length);
    this.series = Array.isArray(progress?.series) ? progress.series.slice(-this.seriesLength) : [];
  }

  resolve(requestedLevel) {
    const level = Math.min(clampLevel(requestedLevel, this.opponents.length), this.unlockedThrough);
    return { level, opponent: this.opponents[level - 1] };
  }

  record(result, playedLevel) {
    const resolved = this.resolve(playedLevel);
    const series = [...this.series, result === 'win' ? 'win' : result === 'loss' ? 'loss' : 'draw'].slice(-this.seriesLength);
    const wins = series.filter((entry) => entry === 'win').length;
    const promoted = resolved.level === this.unlockedThrough
      && wins >= this.winsRequired
      && this.unlockedThrough < this.opponents.length;
    return new OpponentLadder({
      opponents: this.opponents,
      winsRequired: this.winsRequired,
      seriesLength: this.seriesLength,
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
      wins: this.series.filter((entry) => entry === 'win').length,
      current,
      opponents: this.opponents.map((opponent) => ({ ...opponent, unlocked: opponent.level <= this.unlockedThrough })),
    };
  }
}

export default OpponentLadder;
