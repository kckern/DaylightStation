/**
 * PlexSessionAdapter — makes a DaylightStation surface a real Plex client.
 *
 * Anti-corruption layer: domain terms in (an identity, a session), Plex wire
 * format out. Nothing above this file knows that Plex spells a heartbeat
 * `/:/timeline?state=playing`.
 *
 * WHAT WAS VERIFIED (2026-09-16, against the live server) — these are the
 * reasons the calls look like this rather than like a typical Plex client:
 *
 *   - `/:/timeline` with `state=playing` creates a session that appears in
 *     `/status/sessions`, and therefore on the dashboard and to Tautulli.
 *   - **No play queue is required.** Real clients send `playQueueItemID` /
 *     `playQueueID` / `containerKey` (101 of 102 observed calls did), which
 *     makes a queue look mandatory. It is not: ratingKey + key + state + time
 *     + duration + identity is enough. We deliberately do not build queues.
 *   - Identity is fully controllable: `X-Plex-Client-Identifier` becomes
 *     `<Player machineIdentifier>` and `X-Plex-Device-Name` becomes
 *     `<Player title>` — the name a viewer sees on the dashboard.
 *   - `/:/scrobble` marks watched and writes a history row, but creates NO
 *     session. It is therefore a separate operation from closing one.
 *
 * Identity travels as QUERY PARAMETERS, not headers. These requests are issued
 * server-side on behalf of a surface, and the query form is what the proxy and
 * Plex both accept uniformly; it is also what was verified end to end.
 */

import { IPlaybackSessionGateway } from '#apps/content/ports/IPlaybackSessionGateway.mjs';

/** Plex's own identifier for the library "agent" a scrobble belongs to. */
const LIBRARY_IDENTIFIER = 'com.plexapp.plugins.library';

/**
 * `plex:674737` → `674737`. A bare id is passed through, so callers may hand us
 * either form without a second code path.
 */
export function toRatingKey(contentId) {
  const raw = String(contentId ?? '').trim();
  if (!raw) return null;
  const tail = raw.includes(':') ? raw.slice(raw.lastIndexOf(':') + 1) : raw;
  return /^\d+$/.test(tail) ? tail : null;
}

export class PlexSessionAdapter extends IPlaybackSessionGateway {
  #host;
  #token;
  #httpClient;
  #logger;

  /**
   * @param {object} config
   * @param {string} config.host - e.g. http://plex:32400
   * @param {string} config.token - server token
   * @param {object} deps
   * @param {{get: Function}} deps.httpClient
   * @param {object} [deps.logger]
   */
  constructor({ host, token } = {}, { httpClient, logger = console } = {}) {
    super();
    if (!host) throw new Error('PlexSessionAdapter requires host');
    if (!httpClient?.get) throw new Error('PlexSessionAdapter requires an httpClient with get()');
    this.#host = String(host).replace(/\/$/, '');
    this.#token = token || '';
    this.#httpClient = httpClient;
    this.#logger = logger;
  }

  #identityParams(identity) {
    const params = {
      'X-Plex-Client-Identifier': identity.clientIdentifier,
      'X-Plex-Product': identity.product,
    };
    if (identity.version) params['X-Plex-Version'] = identity.version;
    if (identity.platform) params['X-Plex-Platform'] = identity.platform;
    // What a viewer sees as the player name on the dashboard.
    if (identity.device) params['X-Plex-Device-Name'] = identity.device;
    return params;
  }

  async #timeline(identity, session, state) {
    const ratingKey = toRatingKey(session.contentId);
    if (!ratingKey) {
      // Not every surface plays Plex content; a local file has no rating key.
      // Silently doing nothing is correct, but it must be visible.
      this.#logger.debug?.('plex.session.skipped', {
        reason: 'not-a-plex-rating-key',
        contentId: session.contentId,
        surfaceId: session.surfaceId,
      });
      return;
    }

    const params = new URLSearchParams({
      ratingKey,
      key: `/library/metadata/${ratingKey}`,
      state,
      time: String(session.positionMs),
      duration: String(session.durationMs),
      ...this.#identityParams(identity),
    });
    if (this.#token) params.set('X-Plex-Token', this.#token);

    await this.#send(`/:/timeline?${params.toString()}`, {
      event: 'plex.session.timeline',
      state,
      ratingKey,
      surfaceId: session.surfaceId,
      player: identity.displayName,
    });
  }

  async #send(path, logFields) {
    try {
      await this.#httpClient.get(`${this.#host}${path}`, { headers: { Accept: 'application/json' } });
      this.#logger.debug?.(logFields.event, { ...logFields, ok: true });
    } catch (error) {
      // Reporting is never allowed to break playback. A child watching a story
      // must not be interrupted because Plex's dashboard missed a heartbeat.
      this.#logger.warn?.(`${logFields.event}.failed`, {
        ...logFields,
        error: error?.message ?? String(error),
      });
    }
  }

  async openSession(identity, session) {
    return this.#timeline(identity, session, 'playing');
  }

  async heartbeat(identity, session) {
    return this.#timeline(identity, session, session.state === 'paused' ? 'paused' : 'playing');
  }

  async closeSession(identity, session) {
    return this.#timeline(identity, session, 'stopped');
  }

  async markWatched(identity, contentId) {
    const ratingKey = toRatingKey(contentId);
    if (!ratingKey) return;
    const params = new URLSearchParams({
      key: ratingKey,
      identifier: LIBRARY_IDENTIFIER,
      ...this.#identityParams(identity),
    });
    if (this.#token) params.set('X-Plex-Token', this.#token);
    await this.#send(`/:/scrobble?${params.toString()}`, {
      event: 'plex.session.scrobble',
      ratingKey,
      player: identity.displayName,
    });
  }
}

export default PlexSessionAdapter;
