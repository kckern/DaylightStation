const MAX_PLAUSIBLE_RPM = 200;
const EMA_ALPHA = 0.4;
// Hard contract: zero within 5 s of last fresh sample. Decay starts at 1.5 s
// and reaches 0 by 4 s (well inside the 5 s ceiling).
const STALE_THRESHOLD_MS = 1500;
const LOST_SIGNAL_MS     = 4000;

export class CadenceFilter {
  constructor() {
    this._ema = null;
    this._lastUpdateTs = null;
    this._lastFreshValue = null;
  }

  update({ rpm, ts }) {
    const flags = {
      implausible: false,
      smoothed: false,
      stale: false,
      lostSignal: false
    };
    let raw = rpm;

    if (!Number.isFinite(raw) || raw < 0 || raw > MAX_PLAUSIBLE_RPM) {
      flags.implausible = true;
      raw = 0;
    }

    let value;
    if (this._ema === null) {
      value = raw;
    } else {
      value = EMA_ALPHA * raw + (1 - EMA_ALPHA) * this._ema;
      flags.smoothed = true;
    }
    this._ema = value;
    this._lastUpdateTs = ts;
    this._lastFreshValue = value;

    return { rpm: value, ts, flags };
  }

  tick(nowTs) {
    const flags = {
      implausible: false,
      smoothed: false,
      stale: false,
      lostSignal: false
    };
    if (this._lastUpdateTs === null || this._ema === null) {
      return { rpm: 0, ts: nowTs, flags: { ...flags, lostSignal: true } };
    }
    const gap = nowTs - this._lastUpdateTs;
    if (gap >= LOST_SIGNAL_MS) {
      this._ema = 0;
      this._lastFreshValue = 0;
      return { rpm: 0, ts: nowTs, flags: { ...flags, lostSignal: true } };
    }
    if (gap >= STALE_THRESHOLD_MS) {
      // Linear decay across the (STALE → LOST) window so the value visibly
      // drops toward 0 instead of holding flat. By definition this branch
      // only runs when STALE ≤ gap < LOST, so the divisor is non-zero.
      const decayProgress = (gap - STALE_THRESHOLD_MS)
                          / (LOST_SIGNAL_MS - STALE_THRESHOLD_MS);
      const decayed = this._lastFreshValue * (1 - decayProgress);
      return { rpm: Math.max(0, decayed), ts: nowTs, flags: { ...flags, stale: true } };
    }
    return { rpm: this._ema, ts: nowTs, flags };
  }
}

export default CadenceFilter;
