import { google } from 'googleapis';

/** Resolves OAuth credentials and constructs an authenticated Gmail SDK client. */
export class GoogleGmailClientFactory {
  constructor({ configService } = {}) {
    if (!configService) throw new Error('GoogleGmailClientFactory requires configService');
    this.configService = configService;
  }

  create = async (username) => {
    const clientId = this.configService.getSystemAuth('google', 'client_id');
    const clientSecret = this.configService.getSystemAuth('google', 'client_secret');
    const redirectUri = this.configService.getSystemAuth('google', 'redirect_uri');
    const auth = this.configService.getUserAuth?.('google', username) || {};
    const refreshToken = auth.refresh_token || this.configService.getSystemAuth('google', 'refresh_token');
    if (!(clientId && clientSecret && redirectUri && refreshToken)) {
      throw new Error('Google OAuth credentials not configured');
    }
    const oauth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth.setCredentials({ refresh_token: refreshToken });
    return google.gmail({ version: 'v1', auth: oauth });
  };
}
