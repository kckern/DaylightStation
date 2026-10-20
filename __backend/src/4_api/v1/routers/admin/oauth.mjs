import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 20;

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (title, body) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title><body style="font:16px system-ui;margin:3rem auto;max-width:32rem;padding:0 1rem"><h1>${escape(title)}</h1><p>${escape(body)}</p>`;
const str = (v) => (typeof v === 'string' && v ? v : null);

/**
 * Admin-only OAuth reconnect, mounted at /api/v1/admin/oauth. Currently Withings.
 *
 * /withings/connect redirects to Withings with a one-time state; Withings sends the
 * browser back to /withings/callback, which exchanges the code on the spot (Withings
 * codes expire in about 30 seconds), saves the new grant and starts a harvest.
 *
 * @param {Object} deps
 * @param {Object} deps.withingsOAuth - { authorizeUrl({redirectUri,state}), exchangeCode({code,redirectUri}) }
 * @param {Object} deps.authStore - { save(username, service, data) }
 * @param {Object} deps.harvesterService - { get(serviceId), harvest(serviceId, username) }
 * @param {Function} deps.resolveUsername - () => default username when ?user is absent
 * @param {Function} deps.redirectUri - (req) => absolute callback URL registered with Withings
 * @param {Function} deps.newState - () => unguessable one-time state (e.g. crypto.randomUUID)
 */
export function createOAuthRouter({ withingsOAuth, authStore, harvesterService, resolveUsername, redirectUri, newState, now = () => Date.now(), logger = console } = {}) {
  if (!withingsOAuth || !authStore?.save || !harvesterService || typeof resolveUsername !== 'function' || typeof redirectUri !== 'function' || typeof newState !== 'function') {
    throw new TypeError('createOAuthRouter requires withingsOAuth, authStore, harvesterService, resolveUsername, redirectUri and newState');
  }
  const router = express.Router();
  const pending = new Map(); // state -> { username, at }; insertion order = oldest first

  const prune = () => {
    for (const [k, v] of pending) if (now() - v.at > STATE_TTL_MS) pending.delete(k);
    while (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value);
  };
  const fail = (res, status, body) => res.status(status).type('html').send(page('Withings not connected', body));

  router.get('/withings/connect', (req, res) => {
    const state = newState();
    pending.set(state, { username: str(req.query.user) || resolveUsername(), at: now() });
    prune();
    res.redirect(302, withingsOAuth.authorizeUrl({ redirectUri: redirectUri(req), state }));
  });

  router.get('/withings/callback', asyncHandler(async (req, res) => {
    const code = str(req.query.code);
    const state = str(req.query.state);
    const error = req.query.error;
    if (error) return fail(res, 400, `Withings said: ${error}`);

    prune();
    const entry = state && pending.get(state);
    if (!entry || !code) return fail(res, 400, 'This link expired or was already used. Start again from Admin.');
    pending.delete(state);

    let tokens;
    try {
      tokens = await withingsOAuth.exchangeCode({ code, redirectUri: redirectUri(req) });
    } catch (err) {
      logger.error?.('oauth.withings.exchange_failed', { username: entry.username, error: err.message });
      return fail(res, 502, err.message);
    }

    try {
      await authStore.save(entry.username, 'withings', tokens);
    } catch (err) {
      logger.error?.('oauth.withings.save_failed', { username: entry.username, error: err.message });
      return fail(res, 500, `Withings accepted the login but the token could not be saved: ${err.message}`);
    }

    harvesterService.get?.('withings')?.resetAuth?.();
    logger.info?.('oauth.withings.connected', { username: entry.username });

    // Fire and forget: the page should not wait on (or fail with) the first sync.
    Promise.resolve()
      .then(() => harvesterService.harvest('withings', entry.username))
      .catch((err) => logger.warn?.('oauth.withings.first_harvest_failed', { username: entry.username, error: err?.message }));

    return res.type('html').send(page('Withings connected', 'The scale will sync in a minute. You can close this tab.'));
  }));

  return router;
}

export default createOAuthRouter;
