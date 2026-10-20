/**
 * Ensures the concrete Strava client is authorized for a household user.
 *
 * Strava rotates refresh tokens: the token returned by a refresh replaces the
 * stored one. The rotated token is saved through the same auth store and file
 * shape StravaHarvester uses, so the next refresh (here or in the harvester)
 * starts from the current token.
 */
export class StravaActivityAccessGateway {
  /**
   * @param {Object} deps
   * @param {Object} deps.client - Strava client { hasAccessToken, refreshToken }
   * @param {Object} deps.configService - Fallback source of user auth (cached at boot)
   * @param {Object} [deps.authStore] - Auth store { load(username, service), save(username, service, data) }
   * @param {() => boolean} [deps.canRefreshTokens] - Whether this process may rotate the refresh token
   * @param {Object} [deps.logger]
   */
  constructor({ client, configService, authStore = null, canRefreshTokens = () => true, logger = console } = {}) {
    if (!client?.hasAccessToken || !client?.refreshToken || !configService?.getUserAuth) {
      throw new Error('StravaActivityAccessGateway requires client and configService');
    }
    this.client = client;
    this.configService = configService;
    this.authStore = authStore;
    this.canRefreshTokens = canRefreshTokens;
    this.logger = logger;
  }

  async ensure(username) {
    if (this.client.hasAccessToken()) return;
    if (!this.canRefreshTokens()) {
      this.logger.info?.('strava.client.token_writer_disabled', { username });
      throw new Error(`Activity access unavailable for user: ${username} (token refresh disabled in this process)`);
    }
    // Strava rotates the refresh token; refreshing without a place to keep the
    // new one would strand the stored token.
    if (!this.authStore?.save) {
      this.logger.warn?.('strava.client.no_token_store', { username });
      throw new Error(`Activity access unavailable for user: ${username} (no token store)`);
    }
    // Read the store first: configService caches auth at boot and never reloads.
    const auth = (await this.authStore?.load?.(username, 'strava'))
      || this.configService.getUserAuth('strava', username)
      || {};
    if (!auth.refresh) throw new Error(`Activity access unavailable for user: ${username}`);

    const tokenData = await this.client.refreshToken(auth.refresh);
    if (tokenData) {
      try {
        await this.authStore.save(username, 'strava', {
          ...auth,
          refresh: tokenData.refresh_token || auth.refresh,
          access_token: tokenData.access_token,
          expires_at: tokenData.expires_at,
        });
      } catch (error) {
        this.logger.error?.('strava.auth.token_persist_failed', { username, error: error?.message });
        throw error;
      }
    }
  }
}

export default StravaActivityAccessGateway;
