/**
 * Live test harness configuration
 */

export default {
  defaults: {
    delayBetweenServices: 1000,
    delayBetweenTests: 500,
    timeout: 60000,
  },

  services: {
    // Productivity
    todoist: { timeout: 60000 },
    clickup: { timeout: 60000 },
    github: { timeout: 90000 },

    // Social
    lastfm: { timeout: 60000 },
    reddit: { timeout: 60000 },
    letterboxd: { timeout: 60000 },
    goodreads: { timeout: 60000 },
    foursquare: { timeout: 60000 },

    // Communication
    gmail: { timeout: 90000 },
    gcal: { timeout: 90000 },

    // Finance
    buxfer: { timeout: 60000 },
    shopping: { timeout: 120000 },

    // Fitness
    strava: { timeout: 90000 },
    withings: { timeout: 60000, delayBetweenTests: 2000 },

    // Other
    weather: { timeout: 60000 },
  }
};
