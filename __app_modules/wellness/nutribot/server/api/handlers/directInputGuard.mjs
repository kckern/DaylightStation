/**
 * Guard for the direct-input routes.
 * @module nutribot/handlers/directInputGuard
 *
 * `/upc`, `/image` and the earlier shape of `/text` log food and can call
 * paid models on a plain HTTP request, by any method. Each is mounted behind
 * this guard:
 *
 *   before   From the headers alone, ahead of any body parser: a request from
 *            another web origin or another site is refused, and so is a body
 *            declared larger than these routes ever need.
 *   after    Once the small body is parsed (the user may be named in it): who
 *            the caller is and which user it may act for, that the user has a
 *            Nutribot conversation, and the user's daily allowance.
 *
 * The rules themselves are NutribotDirectInput (application/services).
 * Reference: __docs/reference/nutrition/README.md (Direct-input routes).
 */

import { isCrossOriginRequest, isCrossSiteFetch } from '../../../../../../__capabilities/quick-input/server/api.mjs';

// A code, an image address or a line of text. Nothing these routes take is larger.
export const DIRECT_INPUT_MAX_BYTES = 64 * 1024;

const INPUT_ID = /^[A-Za-z0-9_-]{1,64}$/;

const MESSAGES = {
  cross_origin: 'This route does not take requests from other web origins',
  unavailable: 'This route is unavailable on this backend right now',
  user_required: 'The user parameter is required',
  device_not_allowed: 'X-Daylight-Device must name a device that is allowed to send to Nutribot for this user',
  unknown_user: 'This user has no conversation with Nutribot',
  invalid_input_id: 'X-Daylight-Input-Id, when sent, is 1 to 64 characters of A-Z a-z 0-9 _ -',
  too_large: 'The body is over the size limit',
  daily_limit: 'The daily Nutribot allowance for this user is used up',
};

const named = (...values) => values.find((value) => typeof value === 'string' && value.trim())?.trim() || null;

/** Answer a request the user's day has no room for. */
export function refuseForToday(res, { limit, retryAfterSeconds }) {
  res.set('Retry-After', String(retryAfterSeconds));
  return res.status(429).json({
    ok: false, error: 'daily_limit', message: MESSAGES.daily_limit, limit, retryAfterSeconds,
  });
}

/**
 * @param {Object|null} access - NutribotDirectInput; null refuses every request
 * @param {Object} options
 * @param {string} options.route - 'upc' | 'image' | 'text'
 * @param {Object} [options.logger]
 * @returns {{preflight: Function, before: Function, after: Function}}
 */
export function directInputGuard(access, { route, logger = console } = {}) {
  const refuse = (req, res, status, reason, extra = {}) => {
    logger.info?.('nutribot.direct.rejected', {
      route, reason, status, method: req.method,
      username: req.directInput?.username ?? null,
      deviceId: named(req.get('X-Daylight-Device')),
    });
    return res.status(status).json({ ok: false, error: reason, message: MESSAGES[reason], ...extra });
  };

  // With no Access-Control-Allow-* header on the answer, a browser will not send the request.
  const preflight = (req, res) => refuse(req, res, 403, 'cross_origin');

  const before = (req, res, next) => {
    // A GET carries no Origin, so a link or an image tag on another site is
    // told by the browser's own fetch metadata.
    if (isCrossOriginRequest(req) || isCrossSiteFetch(req)) return refuse(req, res, 403, 'cross_origin');
    const declared = Number(req.get('Content-Length'));
    if (Number.isFinite(declared) && declared > DIRECT_INPUT_MAX_BYTES) {
      return refuse(req, res, 413, 'too_large', { maxBytes: DIRECT_INPUT_MAX_BYTES });
    }
    return next();
  };

  const after = (req, res, next) => {
    if (!access) return refuse(req, res, 403, 'device_not_allowed');
    if (!access.available()) return refuse(req, res, 503, 'unavailable');

    const deviceHeader = req.get('X-Daylight-Device');
    const decision = access.authorize({
      route,
      deviceId: named(deviceHeader),
      hasAppHeader: named(deviceHeader) !== null,
      sessionUser: named(req.user?.sub),
      // `member` is the name the runbooks give callers for this parameter.
      requestedUser: named(req.body?.user, req.query?.user, req.body?.member, req.query?.member),
    });
    if (!decision.allowed) return refuse(req, res, decision.status, decision.reason);
    req.directInput = { username: decision.username };

    const context = access.context(decision.username);
    if (!context) return refuse(req, res, 404, 'unknown_user');

    const idHeader = req.get('X-Daylight-Input-Id');
    if (idHeader !== undefined && !INPUT_ID.test(idHeader)) return refuse(req, res, 400, 'invalid_input_id');
    const inputId = idHeader || null;

    const declared = Number(req.get('Content-Length'));
    const admission = access.admission({
      route, username: decision.username, inputId, bytes: Number.isFinite(declared) && declared > 0 ? declared : 0,
    });
    if (!admission.allowed) {
      logger.info?.('nutribot.direct.rejected', { route, reason: 'daily_limit', status: 429, method: req.method, username: decision.username, deviceId: named(deviceHeader) });
      return refuseForToday(res, admission);
    }

    logger.info?.('nutribot.direct.admitted', {
      route, method: req.method, via: decision.via, username: decision.username, deviceId: named(deviceHeader), hasInputId: Boolean(inputId),
    });
    req.directInput = {
      username: decision.username,
      via: decision.via,
      userId: context.userId,
      conversationId: context.conversationId,
      // Runs the route's operation counted against the user's day.
      run: (command) => access.run({
        route, username: decision.username, conversationId: context.conversationId, inputId, command,
      }),
    };
    return next();
  };

  return { preflight, before, after };
}

export default directInputGuard;
