const DEFAULT_CADENCE = {
  unit: { duration_days: 1, alias: 'day' },
  cycle: { duration_days: 7, alias: 'week' },
  phase: { duration_days: 30, alias: 'month' },
  season: { duration_days: 90, alias: 'quarter' },
  era: { duration_days: 365, alias: 'year' },
};

const LEVELS = ['unit', 'cycle', 'phase', 'season', 'era'];

const MS_PER_DAY = 86400000;
const DEFAULT_TZ = 'UTC';
// 2024-12-30 is a Monday — default cycles align to human weeks (audit A-3.1)
const DEFAULT_EPOCH = '2024-12-30';

/**
 * Cadence math over LOCAL calendar days.
 *
 * All period arithmetic uses integer "day serials": an instant is first
 * converted to its (Y, M, D) calendar date in the service timezone, then to
 * `Date.UTC(y, m-1, d) / MS_PER_DAY`. This keeps evening completions in the
 * household's own day (audit A-2.3), removes fractional-day dual-due windows,
 * and derives periodId years from the local calendar (audit A-4.4).
 */
export class CadenceService {
  #timezone;
  #formatter;

  /**
   * @param {Object} [options]
   * @param {string} [options.timezone] - IANA timezone (e.g. 'America/Los_Angeles'). Defaults to UTC.
   *   An unrecognized timezone falls back to UTC (fail-fast probe here rather than a
   *   RangeError on first use; the composition root warns about invalid values).
   */
  constructor({ timezone } = {}) {
    this.#timezone = timezone || DEFAULT_TZ;
    try {
      this.#formatter = this.#buildFormatter(this.#timezone);
    } catch {
      this.#timezone = DEFAULT_TZ;
      this.#formatter = this.#buildFormatter(DEFAULT_TZ);
    }
  }

  #buildFormatter(timeZone) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  resolve(cadenceConfig, today) {
    const config = this.#normalizeConfig(cadenceConfig);
    const { serial, year } = this.#inputDay(today);
    const result = {};

    for (const level of LEVELS) {
      const cfg = config[level];
      const { periodIndex, startSerial } = this.#periodPosition(cfg, serial);
      result[level] = {
        periodIndex,
        periodId: this.#formatPeriodId(level, periodIndex, year),
        // UTC instant representing the local day the period starts on
        startDate: new Date(startSerial * MS_PER_DAY),
        durationDays: cfg.duration_days,
        alias: cfg.alias,
      };
    }

    return result;
  }

  currentPeriodId(level, cadenceConfig, today) {
    const resolved = this.resolve(cadenceConfig, today);
    return resolved[level]?.periodId || null;
  }

  isCeremonyDue(ceremonyTiming, cadenceConfig, today, lastCeremonyDate) {
    const config = this.#normalizeConfig(cadenceConfig);

    // Parse timing like "start_of_cycle", "end_of_unit"
    const [position, , level] = ceremonyTiming.split('_');
    if (!level || !config[level]) return false;

    const cfg = config[level];
    const { serial: todaySerial } = this.#inputDay(today);
    const { startSerial } = this.#periodPosition(cfg, todaySerial);

    if (lastCeremonyDate) {
      const { serial: lastSerial } = this.#inputDay(lastCeremonyDate);
      // If ceremony already done this period, not due
      if (lastSerial >= startSerial) return false;
    }

    if (position === 'start') {
      // Due on first local day of period
      return todaySerial === startSerial;
    }

    if (position === 'end') {
      // Due on last local day of period
      return todaySerial === startSerial + cfg.duration_days - 1;
    }

    return false;
  }

  getNextCeremonyTime(ceremonyTiming, cadenceConfig, today) {
    const config = this.#normalizeConfig(cadenceConfig);

    const [position, , level] = ceremonyTiming.split('_');
    if (!level || !config[level]) return null;

    const cfg = config[level];
    const { serial: todaySerial } = this.#inputDay(today);
    const { startSerial } = this.#periodPosition(cfg, todaySerial);

    // Returned Dates are UTC instants REPRESENTING the local calendar day
    // (serial * MS_PER_DAY = UTC midnight of that date), same convention as
    // resolve().startDate. In a non-UTC zone this is NOT the local day's
    // start instant — callers must treat it as a day marker, not a
    // schedulable point in time.
    if (position === 'start') {
      // First day of the next period
      return new Date((startSerial + cfg.duration_days) * MS_PER_DAY);
    }

    if (position === 'end') {
      const endSerial = startSerial + cfg.duration_days - 1;
      if (todaySerial < endSerial) return new Date(endSerial * MS_PER_DAY);
      // Already on/past end day, next period's end
      return new Date((endSerial + cfg.duration_days) * MS_PER_DAY);
    }

    return null;
  }

  // today/lastCeremonyDate inputs → integer day serial + local year.
  // Date-only strings ('YYYY-MM-DD') are calendar dates, not instants —
  // parsing them as instants (UTC midnight) would misfile them onto the
  // previous local day in any timezone west of UTC. Instants (Date objects
  // or datetime strings) are projected into the service timezone.
  #inputDay(value) {
    if (typeof value === 'string') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [y, m, d] = value.split('-').map(Number);
        return { serial: Date.UTC(y, m - 1, d) / MS_PER_DAY, year: y };
      }
      return this.#daySerial(new Date(value));
    }
    return this.#daySerial(value);
  }

  // (Y, M, D) of the instant in the service timezone → integer day serial + local year
  #daySerial(date) {
    const parts = this.#formatter.formatToParts(date);
    const get = (type) => Number(parts.find((p) => p.type === type).value);
    const year = get('year');
    return { serial: Date.UTC(year, get('month') - 1, get('day')) / MS_PER_DAY, year };
  }

  // Position of a day serial on a level's period grid
  #periodPosition(cfg, serial) {
    const periodIndex = Math.floor((serial - cfg.epochSerial) / cfg.duration_days);
    return { periodIndex, startSerial: cfg.epochSerial + periodIndex * cfg.duration_days };
  }

  // Epochs are calendar dates, not instants — parse as plain Y/M/D.
  // Accepts 'YYYY-MM-DD' strings or Date objects (YAML parses bare dates
  // to Dates at UTC midnight, so the UTC calendar date is the intended one).
  #epochSerial(epoch) {
    const str = epoch instanceof Date ? epoch.toISOString() : String(epoch);
    const [y, m, d] = str.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d) / MS_PER_DAY;
  }

  #normalizeConfig(cadenceConfig) {
    const config = {};
    for (const level of LEVELS) {
      const userCfg = cadenceConfig?.[level] || {};
      const defaults = DEFAULT_CADENCE[level];
      config[level] = {
        duration_days: this.#parseDuration(userCfg.duration) || defaults.duration_days,
        alias: userCfg.alias || defaults.alias,
        epochSerial: this.#epochSerial(userCfg.epoch || DEFAULT_EPOCH),
      };
    }
    return config;
  }

  #parseDuration(durationStr) {
    if (!durationStr) return null;
    if (typeof durationStr === 'number') return durationStr;
    const match = durationStr.match(/^(\d+)\s*(day|days|week|weeks)$/i);
    if (!match) return null;
    const num = parseInt(match[1], 10);
    return match[2].toLowerCase().startsWith('week') ? num * 7 : num;
  }

  #formatPeriodId(level, index, localYear) {
    const prefix = level.charAt(0).toUpperCase();
    return `${localYear}-${prefix}${index}`;
  }
}
