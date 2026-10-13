const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEFAULTS = { quiet_hours: { enabled: false, start: '21:00', end: '07:00' }, cooldowns: { default: 60 } };

function validationError(message) {
  const e = new Error(message);
  e.code = 'VALIDATION';
  return e;
}

export class NotificationConfigService {
  #repository;
  #logger;

  constructor({ repository, logger = console }) {
    if (!repository?.load || !repository?.save) throw new Error('NotificationConfigService: repository required');
    this.#repository = repository;
    this.#logger = logger;
  }

  getConfig() {
    // The repository performs a fresh read so admin edits written by
    // updateConfig() are immediately visible without a frozen cache.
    const c = this.#repository.load();
    return {
      quiet_hours: { ...DEFAULTS.quiet_hours, ...(c.quiet_hours || {}) },
      cooldowns: { ...DEFAULTS.cooldowns, ...(c.cooldowns || {}) },
    };
  }

  updateConfig(data = {}) {
    const qh = data.quiet_hours || {};
    if (!TIME_RE.test(qh.start ?? '') || !TIME_RE.test(qh.end ?? '')) {
      throw validationError('quiet_hours start/end must be "HH:MM" 24-hour times');
    }
    const cooldowns = data.cooldowns || {};
    for (const [k, v] of Object.entries(cooldowns)) {
      if (!Number.isInteger(v) || v < 0) throw validationError(`cooldown for "${k}" must be a non-negative integer (minutes)`);
    }
    const next = {
      quiet_hours: { enabled: !!qh.enabled, start: qh.start, end: qh.end },
      cooldowns: { default: 60, ...cooldowns },
    };
    this.#repository.save(next);
    this.#logger?.info?.('notification.config.updated', {});
    return this.getConfig();
  }
}
