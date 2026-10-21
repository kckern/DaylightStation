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
  constructor({ configService, logger = console }) {
    this.configService = configService;
    this.logger = logger;
  }

  policy() { return this.configService.getHouseholdAppConfig?.(null, 'economy') || {}; }

  catalog() {
    const doc = this.policy();
    // Never guess a payout mode: anything unrecognised is off, and says so.
    let mode = doc.mode ?? 'off';
    if (!MODES.has(mode)) {
      this.logger.warn?.('economy.catalog.unknown-mode', { mode, fallback: 'off' });
      mode = 'off';
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
}
