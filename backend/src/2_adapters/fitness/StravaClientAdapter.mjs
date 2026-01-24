/**
 * StravaClientAdapter
 *
 * HTTP adapter for Strava API calls.
 * Provides the interface expected by StravaHarvester:
 * - refreshToken(refreshToken) - OAuth token refresh
 * - getActivities(params) - Fetch athlete activities
 * - getActivityStreams(activityId, keys) - Fetch activity streams
 *
 * @module adapters/fitness/StravaClientAdapter
 */

const STRAVA_BASE_URL = 'https://www.strava.com';

export class StravaClientAdapter {
  #httpClient;
  #configService;
  #currentAccessToken;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.httpClient - HTTP client (axios-compatible)
   * @param {Object} config.configService - ConfigService for OAuth credentials
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({ httpClient, configService, logger = console }) {
    if (!httpClient) {
      throw new Error('StravaClientAdapter requires httpClient');
    }
    if (!configService) {
      throw new Error('StravaClientAdapter requires configService');
    }

    this.#httpClient = httpClient;
    this.#configService = configService;
    this.#currentAccessToken = null;
    this.#logger = logger;
  }

  /**
   * Refresh OAuth token
   * @param {string} refreshToken - Current refresh token
   * @returns {Promise<Object>} Token response with access_token, refresh_token, expires_at
   */
  async refreshToken(refreshToken) {
    const clientId = this.#configService.getSecret('STRAVA_CLIENT_ID');
    const clientSecret = this.#configService.getSecret('STRAVA_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new Error('Strava OAuth credentials not configured (STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET)');
    }

    this.#logger.debug?.('strava.client.refreshToken', { hasRefreshToken: !!refreshToken });

    const response = await this.#httpClient.post(
      `${STRAVA_BASE_URL}/oauth/token`,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    // Store for subsequent API calls
    this.#currentAccessToken = response.data.access_token;

    return response.data;
  }

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
    if (!this.#currentAccessToken) {
      throw new Error('No access token available. Call refreshToken first.');
    }

    const response = await this.#httpClient.get(
      `${STRAVA_BASE_URL}/api/v3/athlete/activities`,
      {
        params: { before, after, page, per_page: perPage },
        headers: { Authorization: `Bearer ${this.#currentAccessToken}` },
      }
    );

    return response.data;
  }

  /**
   * Get activity streams (heart rate, etc.)
   * @param {number} activityId - Activity ID
   * @param {Array<string>} keys - Stream keys to fetch
   * @returns {Promise<Object>} Stream data
   */
  async getActivityStreams(activityId, keys) {
    if (!this.#currentAccessToken) {
      throw new Error('No access token available. Call refreshToken first.');
    }

    const response = await this.#httpClient.get(
      `${STRAVA_BASE_URL}/api/v3/activities/${activityId}/streams`,
      {
        params: { keys: keys.join(','), key_by_type: true },
        headers: { Authorization: `Bearer ${this.#currentAccessToken}` },
      }
    );

    return response.data;
  }

  /**
   * Set access token directly (for cases where token is already refreshed)
   * @param {string} token - Access token
   */
  setAccessToken(token) {
    this.#currentAccessToken = token;
  }

  /**
   * Check if client has an access token
   * @returns {boolean}
   */
  hasAccessToken() {
    return !!this.#currentAccessToken;
  }
}

export default StravaClientAdapter;
