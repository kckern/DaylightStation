/**
 * Journalist voice memo intake: the `/memo` alias.
 * @module api/handlers/journalist/memo
 *
 * POST /api/v1/journalist/memo is the route the Journalist voice intake began
 * as. `/api/v1/journalist/voice` is the same intake under the quick-input
 * contract's names. Both are the shared quick-input route
 * (__capabilities/quick-input); this file only keeps the names the alias was
 * built with: `memoId` in answers and events, `invalid_memo_id`, the
 * `journalist.memo.*` events, the `memos` daily limit.
 * Contract: __docs/reference/journalist/journalist-domain.md (Quick-input intake).
 */

import {
  quickInputRoute, quickInputPreflight, QUICK_INPUT_KINDS,
} from '../../../../../../__capabilities/quick-input/server/api.mjs';

export const MEMO_MAX_BYTES = QUICK_INPUT_KINDS.voice.maxBytes;

/** The names the alias answers and logs with. */
const MEMO_NAMING = Object.freeze({
  events: 'journalist.memo',
  idFields: ['memoId'],
  logIdField: 'memoId',
  invalidId: 'invalid_memo_id',
  messages: {
    unavailable: 'Voice memos are unavailable on this backend right now',
    device_not_allowed: 'X-Daylight-Device must name a device that is allowed to send memos for this user',
    unknown_user: 'No Journalist conversation exists for this user',
    invalid_memo_id: 'X-Daylight-Memo-Id is required: 1 to 64 characters of A-Z a-z 0-9 _ -',
    too_large: 'The audio is over the size limit',
    daily_limit: 'The daily voice memo allowance for this user is used up',
    empty_body: 'The audio body is empty',
    unreadable_body: 'The audio body could not be read',
  },
});

/** The Journalist's memo operations, in the terms the shared route asks in. */
function memoEndpoint(journalistApi) {
  return {
    available: () => journalistApi.canSubmitMemo(),
    deviceAllowed: (deviceId, username) => journalistApi.memoDeviceAllowed(deviceId, username),
    conversationFor: (username) => journalistApi.memoConversationFor(username),
    admission: ({ username, inputId, bytes }) => journalistApi.memoAdmission({ username, memoId: inputId, bytes }),
    submit: async ({ conversationId, username, inputId, body, mimeType, recordedAt }) => {
      const { memoId: _named, ...result } = await journalistApi.submitMemo({
        conversationId, username, memoId: inputId, audioBuffer: body, mimeType, recordedAt,
      }) || {};
      return result;
    },
  };
}

/** The answer to a CORS preflight for the memo route: no. */
export function journalistMemoPreflight({ logger = console } = {}) {
  return quickInputPreflight({ logger, naming: MEMO_NAMING });
}

/**
 * The middleware chain for the memo route.
 *
 * @param {Object} journalistApi - Semantic Journalist operations
 * @param {Object} [options]
 * @param {Object} [options.logger]
 * @param {number} [options.maxBytes]
 * @returns {Function[]} Express middleware, in order
 */
export function journalistMemoRoute(journalistApi, options = {}) {
  const { logger = console, maxBytes = MEMO_MAX_BYTES } = options;
  return quickInputRoute(memoEndpoint(journalistApi), { kind: 'voice', logger, maxBytes, naming: MEMO_NAMING });
}

export default journalistMemoRoute;
