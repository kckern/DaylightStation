export class NewsReporterConfigProjection {
  constructor({ configService, defaultTimezone = 'America/Denver' }) { this.configService = configService; this.defaultTimezone = defaultTimezone; }
  reporter(id) { return (this.configService.getHouseholdAppConfig(null, 'newsreporter') || {})[id] || null; }
  timezone() { return this.configService.getHouseholdTimezone?.() ?? this.configService.getTimezone?.() ?? this.defaultTimezone; }
}
