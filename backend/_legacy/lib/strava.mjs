/**
 * Strava - Legacy Re-export Shim
 *
 * MIGRATION: This file wraps StravaHarvester from the adapter layer.
 * Import from '#backend/src/2_adapters/harvester/fitness/StravaHarvester.mjs' instead.
 *
 * Example:
 *   // Old (deprecated):
 *   import harvestActivities, { getAccessToken, getActivities } from '#backend/_legacy/lib/strava.mjs';
 *
 *   // New (preferred):
 *   import { StravaHarvester } from '#backend/src/2_adapters/harvester/fitness/StravaHarvester.mjs';
 */

import { StravaHarvester } from '../../src/2_adapters/harvester/fitness/StravaHarvester.mjs';
import { configService } from '../../src/0_system/config/index.mjs';
import { userDataService } from '../../src/0_system/config/UserDataService.mjs';
import axios from '../../src/0_system/http/httpClient.mjs';
import { createLogger } from '../../src/0_system/logging/logger.js';

// Logger for the shim layer
const shimLogger = createLogger({
  source: 'backend',
  app: 'strava-shim'
});

// Get default username for user-scoped data
const getDefaultUsername = () => configService.getHeadOfHousehold();

// Lazy singleton - initialized on first use
let harvesterInstance = null;

/**
 * Create a Strava API client adapter that matches StravaHarvester's expected interface
 * @returns {Object} Strava client with refreshToken, getActivities, getActivityStreams methods
 */
function createStravaClient() {
  const baseUrl = 'https://www.strava.com';

  // Store current access token in closure
  let currentAccessToken = null;

  return {
    /**
     * Refresh OAuth token
     * @param {string} refreshToken - Current refresh token
     * @returns {Promise<Object>} Token response with access_token, refresh_token, expires_at
     */
    async refreshToken(refreshToken) {
      const clientId = configService.getSecret('STRAVA_CLIENT_ID');
      const clientSecret = configService.getSecret('STRAVA_CLIENT_SECRET');

      const response = await axios.post(`${baseUrl}/oauth/token`,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      // Store for subsequent API calls
      currentAccessToken = response.data.access_token;

      return response.data;
    },

    /**
     * Get activities with pagination
     * @param {Object} params - Query parameters
     * @param {number} params.before - Unix timestamp (end)
     * @param {number} params.after - Unix timestamp (start)
     * @param {number} params.page - Page number
     * @param {number} params.perPage - Items per page
     * @returns {Promise<Array>} Activities
     */
    async getActivities({ before, after, page, perPage }) {
      const response = await axios.get(`${baseUrl}/api/v3/athlete/activities`, {
        params: { before, after, page, per_page: perPage },
        headers: { Authorization: `Bearer ${currentAccessToken}` }
      });
      return response.data;
    },

    /**
     * Get activity streams (heart rate, etc.)
     * @param {number} activityId - Activity ID
     * @param {Array<string>} keys - Stream keys to fetch
     * @returns {Promise<Object>} Stream data
     */
    async getActivityStreams(activityId, keys) {
      const response = await axios.get(
        `${baseUrl}/api/v3/activities/${activityId}/streams`,
        {
          params: { keys: keys.join(','), key_by_type: true },
          headers: { Authorization: `Bearer ${currentAccessToken}` }
        }
      );
      return response.data;
    },

    /**
     * Set access token directly (for cases where token is already refreshed)
     * @param {string} token - Access token
     */
    setAccessToken(token) {
      currentAccessToken = token;
    }
  };
}

/**
 * Create auth store adapter for StravaHarvester
 * @returns {Object} Auth store with load/save methods
 */
function createAuthStore() {
  return {
    async load(username, provider) {
      return userDataService.getAuthToken(username, provider);
    },
    async save(username, provider, tokenData) {
      return userDataService.saveAuthToken(username, provider, tokenData);
    }
  };
}

/**
 * Create lifelog store adapter for StravaHarvester
 * @returns {Object} Lifelog store with load/save methods
 */
function createLifelogStore() {
  return {
    async load(username, path) {
      // Handle both 'strava' and 'archives/strava/...' paths
      if (path.startsWith('archives/')) {
        return userDataService.readUserData(username, `lifelog/${path}`);
      }
      return userDataService.readUserData(username, `lifelog/${path}`);
    },
    async save(username, path, data) {
      if (path.startsWith('archives/')) {
        return userDataService.writeUserData(username, `lifelog/${path}`, data);
      }
      return userDataService.writeUserData(username, `lifelog/${path}`, data);
    }
  };
}

/**
 * Get or create the singleton StravaHarvester instance
 * @returns {StravaHarvester}
 */
function getHarvester() {
  if (!harvesterInstance) {
    harvesterInstance = new StravaHarvester({
      stravaClient: createStravaClient(),
      lifelogStore: createLifelogStore(),
      authStore: createAuthStore(),
      configService,
      timezone: configService.isReady?.() ? configService.getTimezone() : 'America/Los_Angeles',
      logger: shimLogger
    });
  }
  return harvesterInstance;
}

// ============================================================
// Legacy API Exports
// ============================================================

/**
 * Get Strava access token (refreshes if needed)
 * @param {Object} logger - Logger instance (ignored, uses internal logger)
 * @param {string} [username] - Username (defaults to head of household)
 * @returns {Promise<string|false>} Access token or false on failure
 */
export const getAccessToken = async (logger, username = null) => {
  const uname = username || getDefaultUsername();
  try {
    const success = await getHarvester().refreshAccessToken(uname);
    if (success) {
      // Token was refreshed - return true to indicate success
      // (Original returned the token string, but callers typically just check truthiness)
      const authData = userDataService.getAuthToken(uname, 'strava');
      return authData?.access_token || true;
    }
    return false;
  } catch (error) {
    shimLogger.error('strava.shim.getAccessToken.error', {
      username: uname,
      error: error.message
    });
    return false;
  }
};

/**
 * Get reauthorization URL for OAuth flow
 * @returns {Promise<Object>} Object with authorization URL
 */
export const reauthSequence = async () => {
  return getHarvester().reauthSequence();
};

/**
 * Get activities from Strava
 * @param {Object} logger - Logger instance (ignored, uses internal logger)
 * @param {number} [daysBack=90] - Days of history to fetch
 * @returns {Promise<Object|false>} Object with items array, or false on failure
 */
export const getActivities = async (logger, daysBack = 90) => {
  const username = getDefaultUsername();
  try {
    // Ensure we have a valid token first
    const tokenValid = await getHarvester().refreshAccessToken(username);
    if (!tokenValid) {
      return false;
    }

    // Fetch activities
    const activities = await getHarvester().fetchActivities(username, daysBack);
    if (!activities) {
      return false;
    }

    // Return in legacy format
    return { items: activities };
  } catch (error) {
    shimLogger.error('strava.shim.getActivities.error', {
      username,
      daysBack,
      error: error.message
    });
    return false;
  }
};

/**
 * Check if Strava is in cooldown (circuit breaker open)
 * @returns {boolean|Object} false if OK, or cooldown info object
 */
export const isStravaInCooldown = () => {
  // Check if harvester exists and is in cooldown
  if (!harvesterInstance) {
    return false;
  }

  const isOpen = harvesterInstance.isInCooldown();
  if (!isOpen) {
    return false;
  }

  // Return cooldown info similar to legacy format
  const status = harvesterInstance.getStatus();
  return {
    inCooldown: true,
    remainingMins: status.remainingMins || 0
  };
};

/**
 * Harvest activities from Strava
 * Main entry point for scheduled harvesting
 *
 * @param {Object} logger - Logger instance (ignored, uses internal logger)
 * @param {string} job_id - Job identifier for logging
 * @param {number} [daysBack=90] - Days of history to fetch
 * @returns {Promise<Object>} Harvest result
 */
export default async function harvestActivities(logger, job_id, daysBack = 90) {
  const username = getDefaultUsername();

  shimLogger.info('strava.shim.harvest.start', { jobId: job_id, username, daysBack });

  try {
    // Support BACKFILL_SINCE env var like legacy
    const backfillSince = process.env.BACKFILL_SINCE;

    const result = await getHarvester().harvest(username, {
      daysBack,
      backfillSince
    });

    // Transform result to match legacy format expectations
    if (result.status === 'skipped') {
      return {
        skipped: true,
        reason: result.reason,
        remainingMins: result.remainingMins
      };
    }

    if (result.status === 'error') {
      return {
        success: false,
        error: result.reason
      };
    }

    // Success - return the summary (legacy format)
    shimLogger.info('strava.shim.harvest.complete', {
      jobId: job_id,
      count: result.count,
      dateCount: result.dateCount
    });

    return result;
  } catch (error) {
    const statusCode = error.response?.status;

    shimLogger.error('strava.shim.harvest.error', {
      jobId: job_id,
      error: error.message,
      statusCode
    });

    // Return error object similar to legacy
    if (statusCode === 429 || statusCode === 401) {
      const cooldownStatus = isStravaInCooldown();
      return {
        success: false,
        error: statusCode === 401 ? 'Auth token invalid - needs refresh' : 'Rate limit exceeded',
        statusCode,
        cooldown: cooldownStatus || null
      };
    }

    return { success: false, error: error.message };
  }
}
