/**
 * Quick-input intake route.
 * @module quick-input/api/quickInputRoute
 *
 * POST <bot>/<kind> — one raw input (audio, text, an image) in, handed to a
 * bot once. Every quick-input route of every bot is this one middleware
 * chain, so they answer alike. Reference: __docs/reference/core/quick-input.md.
 *
 * The route guards itself. It writes for a person, replies into their chat
 * and spends model money, so it refuses from the request's headers alone,
 * before a byte of the body is read: a caller from another web origin, a
 * device that is not bound to the user, an input past the user's daily
 * allowance. app.mjs keeps the app-wide CORS handler and body parsers off
 * these paths (`exceptPaths`) so those refusals come first.
 *
 * What the route needs from a bot (the `endpoint`):
 *   available()                               -> boolean
 *   deviceAllowed(deviceId, username)         -> boolean
 *   conversationFor(username)                 -> string | null
 *   admission({ username, inputId, bytes })   -> { allowed, limit?, retryAfterSeconds? }
 *   submit({ conversationId, username, inputId, body, mimeType, recordedAt })
 *       -> { kind: 'accepted' | 'duplicate' | 'resumed' | 'empty_transcription'
 *                 | 'unusable_input' | 'daily_limit' | 'unavailable', ... }
 */

import express from 'express';
import { sendInternalError } from '#api/utils/internalError.mjs';

const INPUT_ID = /^[A-Za-z0-9_-]{1,64}$/;
// The input id header, and the name the Journalist voice intake started with.
const ID_HEADERS = ['X-Daylight-Input-Id', 'X-Daylight-Memo-Id'];

/** What each kind of input may be, and how large. */
export const QUICK_INPUT_KINDS = Object.freeze({
  voice: Object.freeze({
    // The containers the voice path can name for the transcriber. Anything
    // else would be sent on under the wrong file extension and fail there.
    types: Object.freeze([
      'audio/mp4', 'audio/m4a', 'audio/mpeg', 'audio/mp3',
      'audio/ogg', 'audio/webm', 'audio/wav', 'audio/x-wav',
    ]),
    // The transcriber's own upload ceiling.
    maxBytes: 25 * 1024 * 1024,
    noun: 'audio',
  }),
  text: Object.freeze({
    types: Object.freeze(['text/plain']),
    maxBytes: 16 * 1024,
    noun: 'text',
  }),
  photo: Object.freeze({
    types: Object.freeze(['image/jpeg', 'image/png', 'image/webp']),
    maxBytes: 15 * 1024 * 1024,
    noun: 'image',
  }),
});

const DEFAULT_MESSAGES = {
  cross_origin: 'This route does not take requests from other web origins',
  unavailable: 'This input is unavailable on this backend right now',
  user_required: 'The user query parameter is required',
  device_not_allowed: 'X-Daylight-Device must name a device that is allowed to send this input for this user',
  unknown_user: 'This user has no conversation with this bot',
  invalid_input_id: 'X-Daylight-Input-Id is required: 1 to 64 characters of A-Z a-z 0-9 _ -',
  too_large: 'The body is over the size limit',
  daily_limit: 'The daily quick-input allowance for this user is used up',
  empty_body: 'The body is empty',
  unreadable_body: 'The body could not be read',
};

const bareType = (header) => String(header || '').split(';')[0].trim().toLowerCase();

/**
 * A browser names the page it is calling from in `Origin`; the phone app is
 * not a browser and sends none. A request that carries one is let through
 * only when it is this app's own origin, that is, the host it was sent to.
 */
export function isCrossOriginRequest(req) {
  const origin = req.get('Origin');
  if (origin === undefined) return false;
  try {
    return new URL(origin).host.toLowerCase() !== String(req.get('Host') || '').toLowerCase();
  } catch {
    return true;
  }
}

/**
 * A cross-site GET (an image tag, a link, a form) carries no `Origin`, but a
 * browser still says where the request came from in `Sec-Fetch-Site`, a
 * header page script cannot set. `same-origin` is this app's own page and
 * `none` is an address typed by hand; a client that is not a browser sends
 * neither. For a route that can be reached by GET.
 */
export function isCrossSiteFetch(req) {
  const site = String(req.get('Sec-Fetch-Site') || '').toLowerCase();
  return site === 'cross-site' || site === 'same-site';
}

/** Whether the bytes begin the way the declared image type does. */
function looksLikeImage(body, mimeType) {
  if (mimeType === 'image/jpeg') return body.length > 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  if (mimeType === 'image/png') return body.length > 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === 'image/webp') return body.length > 12 && body.toString('latin1', 0, 4) === 'RIFF' && body.toString('latin1', 8, 12) === 'WEBP';
  return false;
}

/** Text as it was typed, or null when the bytes are not UTF-8. */
function utf8(body) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return null;
  }
}

/**
 * Whether a request is addressed to a quick-input route. For a path that an
 * earlier route already answers in another shape (Nutribot's `/text`), this
 * tells the two apart: a quick input is a POST whose body is not JSON or a
 * form, and that names a device or an input id or carries a body of one of
 * the kind's types.
 */
export function isQuickInputRequest(req, kind) {
  if (req.method !== 'POST') return false;
  const type = bareType(req.get('Content-Type'));
  // A JSON or form body is the earlier shape, whatever else the request carries.
  if (type === 'application/json' || type === 'application/x-www-form-urlencoded') return false;
  if (req.get('X-Daylight-Device') !== undefined) return true;
  if (ID_HEADERS.some((name) => req.get(name) !== undefined)) return true;
  return QUICK_INPUT_KINDS[kind].types.includes(type);
}

/**
 * How a route names things in its answers and its log. The defaults are the
 * quick-input contract. The Journalist `/memo` alias keeps the names it was
 * built with.
 * @typedef {Object} QuickInputNaming
 * @property {string} [events] - Log event prefix
 * @property {string[]} [idFields] - Body fields that carry the input id
 * @property {string} [logIdField] - Log field that carries the input id
 * @property {string} [invalidId] - Error code for a missing or malformed id
 * @property {Object} [messages] - Message text by error code
 * @property {(limit: string) => string} [limitName] - Name of a daily limit in the 429 body
 * @property {Object} [logContext] - Fields added to every event
 */

/**
 * The answer to a CORS preflight for a quick-input route: no. With no
 * `Access-Control-Allow-*` header on it, a browser will not send the request.
 */
export function quickInputPreflight({ logger = console, naming = {} } = {}) {
  const events = naming.events || 'quick_input';
  const idField = naming.logIdField || 'inputId';
  const message = naming.messages?.cross_origin || DEFAULT_MESSAGES.cross_origin;
  return (req, res) => {
    logger.info?.(`${events}.rejected`, {
      ...naming.logContext, reason: 'cross_origin', status: 403, [idField]: null, username: null, preflight: true,
    });
    return res.status(403).json({ ok: false, error: 'cross_origin', message });
  };
}

/**
 * The middleware chain for a quick-input route: a gate that refuses a request
 * from its headers alone, the body reader, then the submit step.
 *
 * @param {Object} endpoint - What the bot provides (see the module comment)
 * @param {Object} options
 * @param {'voice'|'text'|'photo'} options.kind
 * @param {Object} [options.logger]
 * @param {number} [options.maxBytes] - Overrides the kind's limit
 * @param {QuickInputNaming} [options.naming]
 * @returns {Function[]} Express middleware, in order
 */
export function quickInputRoute(endpoint, options = {}) {
  const { kind, logger = console, naming = {} } = options;
  const spec = QUICK_INPUT_KINDS[kind];
  if (!spec) throw new Error(`Unknown quick-input kind: ${kind}`);
  const maxBytes = options.maxBytes ?? spec.maxBytes;
  const types = new Set(spec.types);
  const parseBody = express.raw({ type: [...types], limit: maxBytes });

  const events = naming.events || 'quick_input';
  const idFields = naming.idFields || ['inputId'];
  const logIdField = naming.logIdField || 'inputId';
  const invalidId = naming.invalidId || 'invalid_input_id';
  const limitName = naming.limitName || ((limit) => limit);
  const logContext = naming.logContext || {};
  const messages = {
    ...DEFAULT_MESSAGES,
    unsupported_media_type: `Content-Type must be one of: ${[...types].join(', ')}`,
    ...naming.messages,
  };

  const ids = (inputId) => Object.fromEntries(idFields.map((field) => [field, inputId]));
  const log = (level, event, input, data) => logger[level]?.(`${events}.${event}`, {
    ...logContext, [logIdField]: input.inputId ?? null, username: input.username ?? null, ...data,
  });

  const refuse = (req, res, status, reason, extra = {}) => {
    const input = req.quickInput || {};
    log(status >= 500 ? 'warn' : 'info', 'rejected', input, {
      reason, status, ...(input.deviceId ? { deviceId: input.deviceId } : {}),
    });
    return res.status(status).json({ ok: false, error: reason, message: messages[reason], ...extra });
  };

  const refuseForToday = (req, res, { limit, retryAfterSeconds }) => {
    res.set('Retry-After', String(retryAfterSeconds));
    return refuse(req, res, 429, 'daily_limit', { limit: limitName(limit), retryAfterSeconds });
  };

  const nothingUsable = (req, res, reason) => {
    const input = req.quickInput;
    log('info', 'rejected', input, { reason, status: 422 });
    return res.status(422).json({ ok: false, error: reason, ...ids(input.inputId) });
  };

  // Cheapest and least revealing first: nothing is said about a user to a
  // caller that may not write for them.
  const gate = (req, res, next) => {
    if (isCrossOriginRequest(req)) return refuse(req, res, 403, 'cross_origin');
    if (!endpoint.available()) return refuse(req, res, 503, 'unavailable');

    const username = typeof req.query.user === 'string' ? req.query.user.trim() : '';
    if (!username) return refuse(req, res, 400, 'user_required');
    req.quickInput = { username };

    // Read from the header itself: a User-Agent is not a device identity.
    const deviceId = String(req.get('X-Daylight-Device') || '').trim();
    if (!deviceId || !endpoint.deviceAllowed(deviceId, username)) {
      return refuse(req, res, 403, 'device_not_allowed');
    }
    req.quickInput.deviceId = deviceId;

    const conversationId = endpoint.conversationFor(username);
    if (!conversationId) return refuse(req, res, 404, 'unknown_user');

    const inputId = ID_HEADERS.map((name) => req.get(name)).find((value) => value !== undefined) || '';
    if (!INPUT_ID.test(inputId)) return refuse(req, res, 400, invalidId);

    const mimeType = bareType(req.get('Content-Type'));
    const declared = Number(req.get('Content-Length'));
    const declaredBytes = Number.isFinite(declared) && declared > 0 ? declared : 0;
    // Passed on as the number sent; the intake decides whether to believe it.
    const recordedHeader = req.get('X-Daylight-Recorded-At');
    const recordedAt = recordedHeader === undefined || recordedHeader === '' ? null : Number(recordedHeader);
    req.quickInput = { username, deviceId, conversationId, inputId, mimeType, recordedAt, startedAt: Date.now() };

    if (!types.has(mimeType)) return refuse(req, res, 415, 'unsupported_media_type');
    if (declaredBytes > maxBytes) return refuse(req, res, 413, 'too_large', { maxBytes });

    const admission = endpoint.admission({ username, inputId, bytes: declaredBytes });
    if (!admission.allowed) return refuseForToday(req, res, admission);
    return next();
  };

  const readBody = (req, res, next) => parseBody(req, res, (error) => {
    if (!error) return next();
    if (error.type === 'entity.too.large' || error.status === 413) return refuse(req, res, 413, 'too_large', { maxBytes });
    return refuse(req, res, 400, 'unreadable_body');
  });

  const submit = async (req, res) => {
    const input = req.quickInput;
    const { username, deviceId, conversationId, inputId, mimeType, recordedAt, startedAt } = input;
    const body = Buffer.isBuffer(req.body) ? req.body : null;
    if (!body || body.length === 0) return refuse(req, res, 400, 'empty_body');

    if (kind === 'text') {
      const text = utf8(body);
      if (text === null) return refuse(req, res, 400, 'unreadable_body');
      if (text.trim().length === 0) return refuse(req, res, 400, 'empty_body');
    }
    // An image that does not start as its type says cannot be read by anyone;
    // say so before a model is paid to find that out.
    if (kind === 'photo' && !looksLikeImage(body, mimeType)) return nothingUsable(req, res, 'unusable_input');

    // Sizes and ids only: what was said, typed or photographed never goes to the log.
    const bytes = body.length;
    log('info', 'received', input, { deviceId, mimeType, bytes, recordedAt });

    let result;
    try {
      result = await endpoint.submit({ conversationId, username, inputId, body, mimeType, recordedAt });
    } catch (error) {
      log('error', 'failed', input, {
        bytes, durationMs: Date.now() - startedAt, error: error?.message, code: error?.code ?? null,
      });
      return sendInternalError(res, { ok: false, error: 'processing_failed', ...ids(inputId) });
    }

    const durationMs = Date.now() - startedAt;
    const { kind: outcome, inputId: _same, ...details } = result || {};

    if (outcome === 'accepted') {
      log('info', 'accepted', input, { bytes, ...details, durationMs });
      return res.status(200).json({ ok: true, ...ids(inputId), duplicate: false, ...details });
    }
    if (outcome === 'duplicate' || outcome === 'resumed') {
      // `resumed`: already stored; this call sent replies an earlier attempt did not.
      log('info', 'duplicate', input, { bytes, durationMs, resumed: outcome === 'resumed' });
      return res.status(200).json({ ok: true, ...ids(inputId), duplicate: true });
    }
    if (outcome === 'daily_limit') return refuseForToday(req, res, result);
    if (outcome === 'unavailable') return refuse(req, res, 503, 'unavailable');
    if (outcome === 'empty_transcription' || outcome === 'unusable_input') return nothingUsable(req, res, outcome);

    // An outcome this route does not know is a fault in the bot's handler.
    log('error', 'failed', input, { bytes, durationMs, error: `unknown outcome: ${String(outcome)}`, code: null });
    return sendInternalError(res, { ok: false, error: 'processing_failed', ...ids(inputId) });
  };

  return [gate, readBody, submit];
}

export default quickInputRoute;
