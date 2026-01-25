/**
 * Live test harness configuration
 *
 * Backfill-capable services accept time-range parameters:
 * - daysBack: Number of days to look back
 * - backfillSince: YYYY-MM-DD override start date
 * - weeksAhead/weeksBack: Calendar-specific time ranges
 * - maxPages/fullSync: Pagination-based backfill
 */

export default {
  // Default settings for all services
  defaults: {
    delayBetweenServices: 1000,  // ms between services
    delayBetweenTests: 500,      // ms between tests within service
    timeout: 60000,              // test timeout in ms
  },

  // Per-service overrides
  services: {
    // Slower APIs need more delay
    withings: {
      delayBetweenTests: 2000
    },
    garmin: {
      delayBetweenTests: 2000
    },

    // Backfill-capable services (support BACKFILL_SINCE env var or params)
    strava: {
      supportsBackfill: true,
      params: ['daysBack=90', 'backfillSince=YYYY-MM-DD']
    },
    github: {
      supportsBackfill: true,
      params: ['daysBack=90', 'maxRepos=10']
    },
    clickup: {
      supportsBackfill: true,
      params: ['daysBack=7']
    },
    todoist: {
      supportsBackfill: true,
      params: ['daysBack=7']
    },
    gcal: {
      supportsBackfill: true,
      params: ['weeksAhead=6', 'weeksBack=6']
    },
    lastfm: {
      supportsBackfill: true,
      params: ['maxPages=10', 'fullSync=false']
    },
    buxfer: {
      supportsBackfill: true,
      params: ['daysBack=30', 'accounts=AccountName']
    },

    // Snapshot-based services (no time-range backfill)
    letterboxd: {
      supportsBackfill: false
    },
    goodreads: {
      supportsBackfill: false
    },
    foursquare: {
      supportsBackfill: false
    },
    reddit: {
      supportsBackfill: false
    },
    gmail: {
      supportsBackfill: false
    },
    withings: {
      supportsBackfill: false,
      delayBetweenTests: 2000
    },
    weather: {
      supportsBackfill: false
    },
    shopping: {
      supportsBackfill: false
    },
    infinity: {
      supportsBackfill: false,
      params: ['tableKey=lists']
    },
  }
};
