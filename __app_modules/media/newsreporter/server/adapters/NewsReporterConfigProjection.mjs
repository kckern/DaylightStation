export class NewsReporterConfigProjection {
  constructor({ configService, defaultTimezone = 'America/Denver' }) { this.configService = configService; this.defaultTimezone = defaultTimezone; }
  /** Every reporter block, keyed by id (re-read each call). */
  all() { return this.configService.getHouseholdAppConfig(null, 'newsreporter') || {}; }
  reporter(id) { return this.all()[id] || null; }
  timezone() { return this.configService.getHouseholdTimezone?.() ?? this.configService.getTimezone?.() ?? this.defaultTimezone; }
}
