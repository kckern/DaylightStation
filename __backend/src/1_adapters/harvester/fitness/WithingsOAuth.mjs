/** Withings OAuth2: the authorize URL and the authorization-code exchange. */
const AUTHORIZE_URL = 'https://account.withings.com/oauth2_user/authorize2';
const TOKEN_URL = 'https://wbsapi.withings.net/v2/oauth2';

export class WithingsOAuth {
  #http; #clientId; #clientSecret; #now;

  constructor({ httpClient, clientId, clientSecret, now = () => new Date() } = {}) {
    if (!httpClient || !clientId || !clientSecret) {
      throw new TypeError('WithingsOAuth requires httpClient, clientId and clientSecret');
    }
    this.#http = httpClient;
    this.#clientId = clientId;
    this.#clientSecret = clientSecret;
    this.#now = now;
  }

  authorizeUrl({ redirectUri, state, scope = 'user.metrics' }) {
    const q = new URLSearchParams({ response_type: 'code', client_id: this.#clientId, scope, redirect_uri: redirectUri, state });
    return `${AUTHORIZE_URL}?${q}`;
  }

  /** Withings codes live about 30 seconds: call this straight from the callback. */
  async exchangeCode({ code, redirectUri }) {
    let res;
    try {
      res = await this.#http.post(TOKEN_URL, {
        action: 'requesttoken',
        grant_type: 'authorization_code',
        client_id: this.#clientId,
        client_secret: this.#clientSecret,
        code,
        redirect_uri: redirectUri,
      });
    } catch (err) {
      // Transport errors carry no request body today; scrub the secret anyway
      // so a future client that echoes the body can't leak it into a page or log.
      const msg = String(err?.message || 'request failed').split(this.#clientSecret).join('[redacted]');
      throw new Error(`Withings token request failed: ${msg}`);
    }
    const data = res?.data || {};
    if (data.status !== 0 || !data.body?.refresh_token) {
      throw new Error(`Withings rejected the code: ${data.error || `status ${data.status}`}`);
    }
    const b = data.body;
    return {
      userid: String(b.userid),
      access_token: b.access_token,
      refresh_token: b.refresh_token,
      scope: b.scope,
      token_type: b.token_type,
      expires_at: new Date(this.#now().getTime() + b.expires_in * 1000).toISOString(),
    };
  }
}

export default WithingsOAuth;
