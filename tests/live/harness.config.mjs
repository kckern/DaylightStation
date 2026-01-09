/**
 * Live test harness configuration
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

    // Backfill-capable services (support BACKFILL_SINCE env var)
    strava: {
      supportsBackfill: true
    },
    lastfm: {
      supportsBackfill: true
    },
    letterboxd: {
      supportsBackfill: true
    },
    goodreads: {
      supportsBackfill: true
    },
  }
};
