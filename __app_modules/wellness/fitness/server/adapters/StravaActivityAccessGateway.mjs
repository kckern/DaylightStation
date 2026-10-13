/** Ensures the concrete Strava client is authorized for a household user. */
export class StravaActivityAccessGateway {
  constructor({ client, configService } = {}) {
    if (!client?.hasAccessToken || !client?.refreshToken || !configService?.getUserAuth) {
      throw new Error('StravaActivityAccessGateway requires client and configService');
    }
    this.client = client;
    this.configService = configService;
  }

  async ensure(username) {
    if (this.client.hasAccessToken()) return;
    const auth = this.configService.getUserAuth('strava', username);
    if (!auth?.refresh) throw new Error(`Activity access unavailable for user: ${username}`);
    await this.client.refreshToken(auth.refresh);
  }
}

export default StravaActivityAccessGateway;
