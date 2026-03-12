const DEFAULT_CADENCE = {
  unit: { duration_days: 1, alias: 'day' },
  cycle: { duration_days: 7, alias: 'week' },
  phase: { duration_days: 30, alias: 'month' },
  season: { duration_days: 90, alias: 'quarter' },
  era: { duration_days: 365, alias: 'year' },
};

const LEVELS = ['unit', 'cycle', 'phase', 'season', 'era'];

export class CadenceService {
  resolve(cadenceConfig, today) {
    const config = this.#normalizeConfig(cadenceConfig);
    const todayDate = typeof today === 'string' ? new Date(today) : today;
    const result = {};

    for (const level of LEVELS) {
      const cfg = config[level];
      const periodIndex = this.#periodIndex(todayDate, cfg.duration_days, cfg.epoch);
      result[level] = {
        periodIndex,
        periodId: this.#formatPeriodId(level, periodIndex, todayDate),
        startDate: this.#periodStartDate(todayDate, cfg.duration_days, cfg.epoch),
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
    const todayDate = typeof today === 'string' ? new Date(today) : today;

    // Parse timing like "start_of_cycle", "end_of_unit"
    const [position, , level] = ceremonyTiming.split('_');
    if (!level || !config[level]) return false;

    const cfg = config[level];
    const periodStart = this.#periodStartDate(todayDate, cfg.duration_days, cfg.epoch);

    if (lastCeremonyDate) {
      const lastDate = typeof lastCeremonyDate === 'string' ? new Date(lastCeremonyDate) : lastCeremonyDate;
      // If ceremony already done this period, not due
      if (lastDate >= periodStart) return false;
    }

    if (position === 'start') {
      // Due on first day of period
      return todayDate.getTime() === periodStart.getTime()
        || this.#daysDiff(periodStart, todayDate) < 1;
    }

    if (position === 'end') {
      // Due on last day of period
      const periodEnd = new Date(periodStart.getTime() + (cfg.duration_days - 1) * 86400000);
      return this.#daysDiff(todayDate, periodEnd) < 1;
    }

    return false;
  }

  getNextCeremonyTime(ceremonyTiming, cadenceConfig, today) {
    const config = this.#normalizeConfig(cadenceConfig);
    const todayDate = typeof today === 'string' ? new Date(today) : today;

    const [position, , level] = ceremonyTiming.split('_');
    if (!level || !config[level]) return null;

    const cfg = config[level];
    const periodStart = this.#periodStartDate(todayDate, cfg.duration_days, cfg.epoch);

    if (position === 'start') {
      // Next period start
      return new Date(periodStart.getTime() + cfg.duration_days * 86400000);
    }

    if (position === 'end') {
      const periodEnd = new Date(periodStart.getTime() + (cfg.duration_days - 1) * 86400000);
      if (todayDate < periodEnd) return periodEnd;
      // Already past end, next period's end
      return new Date(periodEnd.getTime() + cfg.duration_days * 86400000);
    }

    return null;
  }

  #normalizeConfig(cadenceConfig) {
    const config = {};
    for (const level of LEVELS) {
      const userCfg = cadenceConfig?.[level] || {};
      const defaults = DEFAULT_CADENCE[level];
      config[level] = {
        duration_days: this.#parseDuration(userCfg.duration) || defaults.duration_days,
        alias: userCfg.alias || defaults.alias,
        epoch: userCfg.epoch ? new Date(userCfg.epoch) : new Date('2025-01-01'),
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

  #periodIndex(today, durationDays, epoch) {
    const ms = today.getTime() - epoch.getTime();
    return Math.floor(ms / (durationDays * 86400000));
  }

  #periodStartDate(today, durationDays, epoch) {
    const idx = this.#periodIndex(today, durationDays, epoch);
    return new Date(epoch.getTime() + idx * durationDays * 86400000);
  }

  #formatPeriodId(level, index, today) {
    const year = today.getFullYear();
    const prefix = level.charAt(0).toUpperCase();
    return `${year}-${prefix}${index}`;
  }

  #daysDiff(a, b) {
    return Math.abs((b.getTime() - a.getTime()) / 86400000);
  }
}
