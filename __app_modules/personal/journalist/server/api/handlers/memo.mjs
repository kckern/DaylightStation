/**
 * Journalist voice memo intake.
 * @module api/handlers/journalist/memo
 *
 * POST /api/v1/journalist/memo — raw audio in, one journal entry out, through
 * the steps a Telegram voice message takes.
 * Contract: __docs/reference/journalist/journalist-domain.md (Voice memo intake).
 *
 * This route guards itself. It writes to a person's journal, echoes into
 * their chat and spends transcription money, so it refuses from the request's
 * headers alone, before a byte of the body is read: a caller from another web
 * origin, a device that is not bound to the user, a memo past the user's
 * daily allowance. app.mjs keeps the app-wide CORS handler and body parsers
 * off this path (`exceptPaths`) so those refusals come first.
 */

import express from 'express';
import { sendInternalError } from '#api/utils/internalError.mjs';

// Whisper's own upload ceiling.
export const MEMO_MAX_BYTES = 25 * 1024 * 1024;

const MEMO_ID = /^[A-Za-z0-9_-]{1,64}$/;

// The containers the voice path can name for the transcriber. Anything else
// would be sent on under the wrong file extension and fail there.
const AUDIO_TYPES = new Set([
  'audio/mp4', 'audio/m4a', 'audio/mpeg', 'audio/mp3',
  'audio/ogg', 'audio/webm', 'audio/wav', 'audio/x-wav',
]);

const MESSAGES = {
  cross_origin: 'This route does not take requests from other web origins',
  unavailable: 'Voice memos are unavailable on this backend right now',
  user_required: 'The user query parameter is required',
  device_not_allowed: 'X-Daylight-Device must name a device that is allowed to send memos for this user',
  unknown_user: 'No Journalist conversation exists for this user',
  invalid_memo_id: 'X-Daylight-Memo-Id is required: 1 to 64 characters of A-Z a-z 0-9 _ -',
  unsupported_media_type: `Content-Type must be one of: ${[...AUDIO_TYPES].join(', ')}`,
  too_large: 'The audio is over the size limit',
  daily_limit: 'The daily voice memo allowance for this user is used up',
  empty_body: 'The audio body is empty',
  unreadable_body: 'The audio body could not be read',
  empty_transcription: 'Nothing intelligible was found in the audio',
  processing_failed: 'The memo could not be processed',
};

const bareType = (header) => String(header || '').split(';')[0].trim().toLowerCase();

/**
 * A browser names the page it is calling from in `Origin`; the phone app is
 * not a browser and sends none. A request that carries one is let through
 * only when it is this app's own origin, that is, the host it was sent to.
 */
function fromAnotherOrigin(req) {
  const origin = req.get('Origin');
  if (origin === undefined) return false;
  try {
    return new URL(origin).host.toLowerCase() !== String(req.get('Host') || '').toLowerCase();
  } catch {
    return true;
  }
}

/**
 * The answer to a CORS preflight for the memo route: no. With no
 * `Access-Control-Allow-*` header on it, a browser will not send the request.
 */
export function journalistMemoPreflight({ logger = console } = {}) {
  return (req, res) => {
    logger.info?.('journalist.memo.rejected', { reason: 'cross_origin', status: 403, memoId: null, username: null, preflight: true });
    return res.status(403).json({ ok: false, error: 'cross_origin', message: MESSAGES.cross_origin });
  };
}

/**
 * The middleware chain for the memo route: a gate that refuses a request from
 * its headers alone, the body reader, then the submit step.
 *
 * @param {Object} journalistApi - Semantic Journalist operations
 * @param {Object} [options]
 * @param {Object} [options.logger]
 * @param {number} [options.maxBytes]
 * @returns {Function[]} Express middleware, in order
 */
export function journalistMemoRoute(journalistApi, options = {}) {
  const { logger = console, maxBytes = MEMO_MAX_BYTES } = options;
  const parseBody = express.raw({ type: [...AUDIO_TYPES], limit: maxBytes });

  const refuse = (req, res, status, reason, extra = {}) => {
    const memo = req.memo || {};
    const level = status >= 500 ? 'warn' : 'info';
    logger[level]?.('journalist.memo.rejected', {
      reason, status, memoId: memo.memoId ?? null, username: memo.username ?? null,
      ...(memo.deviceId ? { deviceId: memo.deviceId } : {}),
    });
    return res.status(status).json({ ok: false, error: reason, message: MESSAGES[reason], ...extra });
  };

  const refuseForToday = (req, res, { limit, retryAfterSeconds }) => {
    res.set('Retry-After', String(retryAfterSeconds));
    return refuse(req, res, 429, 'daily_limit', { limit, retryAfterSeconds });
  };

  // Cheapest and least revealing first: nothing is said about a user to a
  // caller that may not write for them.
  const gate = (req, res, next) => {
    if (fromAnotherOrigin(req)) return refuse(req, res, 403, 'cross_origin');
    if (!journalistApi.canSubmitMemo()) return refuse(req, res, 503, 'unavailable');

    const username = typeof req.query.user === 'string' ? req.query.user.trim() : '';
    if (!username) return refuse(req, res, 400, 'user_required');
    req.memo = { username };

    // Read from the header itself: a User-Agent is not a device identity.
    const deviceId = String(req.get('X-Daylight-Device') || '').trim();
    if (!deviceId || !journalistApi.memoDeviceAllowed(deviceId, username)) {
      return refuse(req, res, 403, 'device_not_allowed');
    }
    req.memo.deviceId = deviceId;

    const conversationId = journalistApi.memoConversationFor(username);
    if (!conversationId) return refuse(req, res, 404, 'unknown_user');

    const memoId = req.get('X-Daylight-Memo-Id') || '';
    if (!MEMO_ID.test(memoId)) return refuse(req, res, 400, 'invalid_memo_id');

    const mimeType = bareType(req.get('Content-Type'));
    const declared = Number(req.get('Content-Length'));
    const declaredBytes = Number.isFinite(declared) && declared > 0 ? declared : 0;
    // Passed on as the number sent; the use case decides whether to believe it.
    const recordedHeader = req.get('X-Daylight-Recorded-At');
    const recordedAt = recordedHeader === undefined || recordedHeader === '' ? null : Number(recordedHeader);
    req.memo = { username, deviceId, conversationId, memoId, mimeType, recordedAt, startedAt: Date.now() };

    if (!AUDIO_TYPES.has(mimeType)) return refuse(req, res, 415, 'unsupported_media_type');
    if (declaredBytes > maxBytes) return refuse(req, res, 413, 'too_large', { maxBytes });

    const admission = journalistApi.memoAdmission({ username, memoId, bytes: declaredBytes });
    if (!admission.allowed) return refuseForToday(req, res, admission);
    return next();
  };

  const readBody = (req, res, next) => parseBody(req, res, (error) => {
    if (!error) return next();
    if (error.type === 'entity.too.large' || error.status === 413) return refuse(req, res, 413, 'too_large', { maxBytes });
    return refuse(req, res, 400, 'unreadable_body');
  });

  const submit = async (req, res) => {
    const { username, deviceId, conversationId, memoId, mimeType, recordedAt, startedAt } = req.memo;
    const audioBuffer = Buffer.isBuffer(req.body) ? req.body : null;
    if (!audioBuffer || audioBuffer.length === 0) return refuse(req, res, 400, 'empty_body');

    // Sizes and ids only: the audio and its words never go to the log.
    const bytes = audioBuffer.length;
    logger.info?.('journalist.memo.received', { memoId, username, deviceId, mimeType, bytes, recordedAt });

    let result;
    try {
      result = await journalistApi.submitMemo({ conversationId, username, memoId, audioBuffer, mimeType, recordedAt });
    } catch (error) {
      logger.error?.('journalist.memo.failed', {
        memoId, username, bytes, durationMs: Date.now() - startedAt,
        error: error?.message, code: error?.code ?? null,
      });
      return sendInternalError(res, { ok: false, error: 'processing_failed', memoId });
    }

    const durationMs = Date.now() - startedAt;
    if (result.kind === 'accepted') {
      logger.info?.('journalist.memo.accepted', {
        memoId, username, bytes, transcriptionLength: result.transcriptionLength, durationMs,
      });
      return res.status(200).json({ ok: true, memoId, duplicate: false, transcriptionLength: result.transcriptionLength });
    }
    if (result.kind === 'duplicate' || result.kind === 'resumed') {
      // `resumed`: already journaled; this call sent replies an earlier attempt did not.
      logger.info?.('journalist.memo.duplicate', { memoId, username, bytes, durationMs, resumed: result.kind === 'resumed' });
      return res.status(200).json({ ok: true, memoId, duplicate: true });
    }
    if (result.kind === 'daily_limit') return refuseForToday(req, res, result);

    logger.info?.('journalist.memo.rejected', { reason: 'empty_transcription', status: 422, memoId, username });
    return res.status(422).json({ ok: false, error: 'empty_transcription', memoId });
  };

  return [gate, readBody, submit];
}

export default journalistMemoRoute;
