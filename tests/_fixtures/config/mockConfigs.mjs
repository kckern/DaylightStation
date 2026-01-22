/**
 * Mock Config Objects for Tests
 *
 * Provides realistic config structures for unit tests.
 */

export const defaultMockConfig = {
  system: {
    dataDir: '/test/data',
    configDir: '/test/data/system',
    mediaDir: '/test/media',
    env: 'test',
    defaultHouseholdId: 'test-household',
    timezone: 'UTC',
    server: {
      port: 3333
    },
    paths: {
      media: '/test/media',
      watchState: '/test/data/history/media_memory',
      img: '/test/media/img'
    },
    scheduler: {
      enabled: false
    }
  },
  secrets: {
    OPENAI_API_KEY: 'test-openai-key',
    LOGGLY_TOKEN: null,
    LOGGLY_SUBDOMAIN: null
  },
  households: {
    'test-household': {
      head: 'test-user',
      users: ['test-user'],
      timezone: 'UTC'
    }
  },
  users: {
    'test-user': {
      name: 'Test User',
      household_id: 'test-household'
    }
  },
  auth: {
    users: {
      'test-user': {
        strava: { client_id: 'test-strava-id' },
        withings: { client_id: 'test-withings-id' }
      }
    },
    households: {
      'test-household': {
        plex: { token: 'test-plex-token', server_url: 'http://localhost:32400' },
        homeassistant: { token: 'test-ha-token', host: 'http://localhost:8123' }
      }
    }
  },
  apps: {},
  identityMappings: {}
};

/**
 * Config with Plex configured
 */
export const plexMockConfig = {
  ...defaultMockConfig,
  auth: {
    ...defaultMockConfig.auth,
    households: {
      'test-household': {
        plex: {
          token: 'test-plex-token',
          server_url: 'http://localhost:32400'
        }
      }
    }
  }
};

/**
 * Config with multiple users
 */
export const multiUserMockConfig = {
  ...defaultMockConfig,
  users: {
    'alice': { name: 'Alice', household_id: 'test-household' },
    'bob': { name: 'Bob', household_id: 'test-household' },
    'charlie': { name: 'Charlie', household_id: 'test-household' }
  },
  households: {
    'test-household': {
      head: 'alice',
      users: ['alice', 'bob', 'charlie'],
      timezone: 'America/Los_Angeles'
    }
  }
};
