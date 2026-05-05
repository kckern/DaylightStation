const MAX_PLAUSIBLE_RPM = 200;

export class CadenceFilter {
  update({ rpm, ts }) {
    const flags = { implausible: false, smoothed: false, stale: false };
    let value = rpm;

    if (!Number.isFinite(value) || value < 0 || value > MAX_PLAUSIBLE_RPM) {
      flags.implausible = true;
      value = 0;
    }

    return { rpm: value, ts, flags };
  }
}

export default CadenceFilter;
