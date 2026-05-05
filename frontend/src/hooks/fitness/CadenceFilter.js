const MAX_PLAUSIBLE_RPM = 200;
const EMA_ALPHA = 0.4;

export class CadenceFilter {
  constructor() {
    this._ema = null;
  }

  update({ rpm, ts }) {
    const flags = { implausible: false, smoothed: false, stale: false };
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

    return { rpm: value, ts, flags };
  }
}

export default CadenceFilter;
