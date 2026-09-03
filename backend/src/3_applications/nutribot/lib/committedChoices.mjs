// backend/src/3_applications/nutribot/lib/committedChoices.mjs

/**
 * Committed-capture presenter (the "message seam").
 *
 * AI captures are logged immediately as unsettled, so the outgoing message must
 * never offer Accept. The five LogFoodFrom* use cases each build their own
 * `[Accept | Revise | Discard]` row and send it themselves, from inside the use
 * case, before returning — so the only place that can rewrite every one of them
 * without touching five files is the responseContext the router hands them.
 *
 * This module owns two things:
 *   1. the committed keyboard vocabulary (Undo / Edit), and
 *   2. a responseContext decorator that swaps an Accept row for it in flight.
 *
 * Callback codes are the EXISTING ones — no new commands:
 *   'x' -> REJECT_LOG  (Undo; DiscardFoodLog now deletes a committed log)
 *   'r' -> REVISE_ITEM (Edit)
 */

/** Legacy short code the LogFoodFrom* use cases stamp on their Accept button. */
export const ACCEPT_CMD = 'a';
/** Undo reuses the discard/reject command. */
export const UNDO_CMD = 'x';
/** Edit reuses the revise command. */
export const EDIT_CMD = 'r';

const METHODS_WITH_OPTIONS = { sendMessage: 1, sendPhoto: 2 };

/**
 * Build the keyboard shown on an already-committed capture.
 * @param {string} logUuid
 * @returns {Array<Array<{text: string, callback_data: string}>>}
 */
export function buildCommittedChoices(logUuid) {
  return [
    [
      { text: '↩️ Undo', callback_data: JSON.stringify({ cmd: UNDO_CMD, id: logUuid }) },
      { text: '✏️ Edit', callback_data: JSON.stringify({ cmd: EDIT_CMD, id: logUuid }) },
    ],
  ];
}

function parseCallbackData(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('{')) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Find the log id an Accept button in `choices` refers to.
 * @param {any} choices
 * @returns {string|null}
 */
export function findAcceptedLogId(choices) {
  if (!Array.isArray(choices)) return null;
  for (const row of choices) {
    if (!Array.isArray(row)) continue;
    for (const button of row) {
      const decoded = parseCallbackData(button?.callback_data);
      const action = decoded?.cmd ?? decoded?.a;
      if (action === ACCEPT_CMD && decoded?.id) return String(decoded.id);
    }
  }
  return null;
}

/**
 * Replace a keyboard that offers Accept with the committed (Undo/Edit) keyboard.
 *
 * Note this replaces ALL rows, not just the row the Accept button sits in — every
 * current sender emits the Accept row as its only row, and a committed capture has
 * no other affordance to preserve. Choices carrying no Accept button (UPC portion
 * picker, image retry, report controls) pass through untouched.
 *
 * @param {any} choices
 * @returns {{ choices: any, rewrittenLogId: string|null }}
 */
export function rewriteChoices(choices) {
  const logId = findAcceptedLogId(choices);
  if (!logId) return { choices, rewrittenLogId: null };
  return { choices: buildCommittedChoices(logId), rewrittenLogId: logId };
}

function rewriteOptions(options) {
  if (!options || typeof options !== 'object' || !('choices' in options)) {
    return { options, rewrittenLogId: null };
  }
  const { choices, rewrittenLogId } = rewriteChoices(options.choices);
  if (!rewrittenLogId) return { options, rewrittenLogId: null };
  return { options: { ...options, choices }, rewrittenLogId };
}

/**
 * Wrap a responseContext so every outgoing message that would offer Accept
 * offers Undo/Edit instead. Everything else on the context (deleteMessage,
 * createStatusIndicator, transcription helpers, adapter-specific extras) is
 * passed straight through, still bound to the original context.
 *
 * LIMIT: only `sendMessage`, `sendPhoto` and `updateMessage` are rewritten. A
 * keyboard sent through the OBJECT RETURNED BY `createStatusIndicator(...)` — or
 * any other nested handle — escapes the rewrite silently, because the proxy only
 * sees calls made on the context itself. No sender does that today; if one starts,
 * wrap that handle here too rather than adding buttons at the call site.
 *
 * @param {Object|null} responseContext
 * @param {Object} [options]
 * @param {(logId: string, method: string) => void} [options.onRewrite] - notified per rewritten message
 * @returns {Object|null} decorated context (or the original when there is none)
 */
export function withCommittedChoices(responseContext, { onRewrite } = {}) {
  if (!responseContext) return responseContext;

  const wrap = (fn, method, optionsIndex) => (...args) => {
    const { options, rewrittenLogId } = rewriteOptions(args[optionsIndex]);
    if (rewrittenLogId) {
      args[optionsIndex] = options;
      onRewrite?.(rewrittenLogId, method);
    }
    return fn.apply(responseContext, args);
  };

  return new Proxy(responseContext, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (prop === 'updateMessage') return wrap(value, prop, 1);
      const optionsIndex = METHODS_WITH_OPTIONS[prop];
      if (optionsIndex !== undefined) return wrap(value, prop, optionsIndex);
      return value.bind(target);
    },
  });
}

export default withCommittedChoices;
