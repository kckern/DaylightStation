/**
 * Read side of the household economy catalog (`household/economy/config.yml`,
 * registered as the `economy` app). Every call reads the served snapshot, so a
 * `system reload` takes effect without a restart.
 *
 * `policy()` is the raw doc, for the legacy keyed `earn`/`spend` maps.
 * `catalog()` is the same doc with every section filled, so payout, week close,
 * passes and digest can read it without null checks.
 */
const MODES = new Set(['off', 'dry-run', 'live']);

const isMap = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

export class EconomyConfigProjection {
  #lastWarnedMode;

  constructor({ configService, logger = console }) {
    this.configService = configService;
    this.logger = logger;
  }

  policy() { return this.configService.getHouseholdAppConfig?.(null, 'economy') || {}; }

  catalog() {
    const doc = this.policy();
    // Never guess a payout mode: anything unrecognised is off, and says so.
    // Only an absent key is quietly off; a bare `mode:` (null) warns. Payouts
    // read this on every outcome, so a bad value warns once until it changes.
    let mode = doc.mode === undefined ? 'off' : doc.mode;
    if (!MODES.has(mode)) {
      if (this.#lastWarnedMode !== mode) {
        this.logger.warn?.('economy.catalog.unknown-mode', { mode, fallback: 'off' });
        this.#lastWarnedMode = mode;
      }
      mode = 'off';
    } else {
      this.#lastWarnedMode = undefined;
    }
    const weekClose = isMap(doc.week_close) ? doc.week_close : {};
    const digest = isMap(doc.digest) ? doc.digest : {};
    return {
      ...doc,
      mode,
      rules_source: doc.rules_source ?? 'earn-rules',
      week_close: {
        ...weekClose,
        cron: weekClose.cron ?? null,
        convert: Array.isArray(weekClose.convert) ? weekClose.convert : [],
      },
      passes: isMap(doc.passes) ? doc.passes : {},
      digest: { ...digest, cron: digest.cron ?? null, zero_days_alert: digest.zero_days_alert ?? null },
    };
  }

  hasUser(userId) { return !!this.configService.getUserProfile?.(userId); }

  /** The household's users that have a profile, so a wallet (the week close's off-roster pass). */
  users() { return (this.configService.getHouseholdUsers?.() ?? []).filter((id) => this.hasUser(id)); }
}
