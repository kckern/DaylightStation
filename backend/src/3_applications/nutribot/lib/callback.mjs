// backend/src/3_applications/nutribot/lib/callback.mjs

/**
 * Encode action and params into callback data string
 * @param {string} action - Action identifier
 * @param {Object} params - Additional parameters
 * @returns {string} JSON-encoded callback data
 */
export function encodeCallback(action, params = {}) {
  const payload = { a: action, ...params };
  return JSON.stringify(payload);
}

/**
 * Decode callback data string into action and params
 * @param {string} data - Callback data string
 * @returns {Object} Decoded object with 'a' property for action
 */
export function decodeCallback(data) {
  try {
    if (typeof data === 'string' && data.startsWith('{')) {
      return JSON.parse(data);
    }
    return { legacy: true, raw: data };
  } catch (err) {
    return { legacy: true, raw: data, error: err.message };
  }
}

/**
 * Common callback actions
 */
export const CallbackActions = {
  ACCEPT_LOG: 'accept_log',
  REJECT_LOG: 'reject_log',
  DELETE_LOG: 'delete_log',
  REVISE_ITEM: 'revise_item',
  DATE_SELECT: 'date_select',
  PORTION_ADJUST: 'portion_adjust',
  CONFIRM_ALL: 'confirm_all'
};
