/**
 * Nutribot quick inputs
 * @module nutribot/application/services/nutribotQuickInputs
 *
 * What Nutribot does with an input captured away from the chat: the kind
 * handlers it plugs into the shared quick-input intake, and the endpoint each
 * route talks to. A recording, a typed meal and a photo each become the event
 * a Telegram message of that kind becomes and go to NutribotInputRouter, the
 * point where Telegram and the web capture already meet. From there on the
 * path is the existing one: an open flow in the chat (a revision) takes what
 * is said next, a new meal is logged, committed and given its receipt.
 *
 * There is no response context, so every reply (status, receipt, the
 * Undo/Edit buttons, "I couldn't identify any food") goes to the user's
 * Nutribot conversation, as it does for a Telegram message.
 *
 * Audio and images are handed over as bytes: a recording as the
 * `{ buffer, mimeType }` pair the voice path takes in place of a Telegram
 * file id, a photo as `imageBuffer`.
 */

import {
  QuickInputIntake, QuickInputLedger, QuickInputEndpoint, boundUsers, localDayParts,
} from '../../../../../../__capabilities/quick-input/server/public.mjs';
import { getMealTimeFromHour } from '../../../../health/server/nutrition-values.mjs';

const BOT = 'nutribot';

/**
 * What the router's answer means for the input.
 * The capture use cases report a refusal as a result with a code and do not
 * throw; a code this does not know is treated as a failure that may be retried.
 */
function outcomeOf(routed) {
  const result = routed?.result ?? routed ?? {};
  const code = result.code ?? routed?.code ?? null;
  if (code === 'AI_UNAVAILABLE' || code === 'VOICE_UNAVAILABLE') return { unavailable: true };
  if (code === 'NO_FOOD') return { nothing: 'unusable_input' };
  if (code === 'EMPTY_TRANSCRIPTION') return { nothing: 'empty_transcription' };
  if (routed?.ok === false || result.success === false) {
    // The code only: a refusal's message can quote what was said.
    throw new Error(`Nutribot did not take the input: ${code || 'refused'}`);
  }
  return {};
}

/**
 * @param {Object} deps
 * @param {boolean} [deps.available] - Whether Nutribot's AI gateway is there to read an input
 * @param {Object|null} deps.inputRouter - NutribotInputRouter (handleText, handleVoice, handleImage)
 * @param {Object|null} deps.ledgerStore - Where the ledger is kept
 * @param {{inputs?: number, bytes?: number}} [deps.limits] - Daily allowance
 * @param {(username: string) => string} [deps.timezone]
 * @param {(deviceKey: string) => Object|null|undefined} deps.deviceConfig - A device's entry in the devices file
 * @param {(username: string) => string} deps.resolveConversationId
 * @param {() => number} [deps.clock]
 * @param {Object} [deps.logger]
 * @returns {{endpoints: {voice: QuickInputEndpoint, text: QuickInputEndpoint, photo: QuickInputEndpoint}, ledger: QuickInputLedger|null}}
 */
export function createNutribotQuickInputs({
  available = true, inputRouter, ledgerStore, limits = {}, timezone = () => undefined,
  deviceConfig, resolveConversationId, clock = Date.now, logger = {},
} = {}) {
  // The ledger is the user's Nutribot day. The direct-input routes count
  // against it too, so it exists whenever there is somewhere to keep it.
  const ledger = ledgerStore ? new QuickInputLedger({ store: ledgerStore, limits, timezone, clock }) : null;
  // An input needs Nutribot's AI gateway, its input router and the ledger. Without them the routes answer 503.
  const ready = Boolean(available && inputRouter && ledger);

  // A meal belongs to the day and the meal it was captured at, not to the
  // moment it was uploaded. `date` and `bucket` are the inputs the router
  // already takes for that from the web capture. With no believable captured
  // time neither is sent, and the bot files the input as it files a Telegram
  // message: today, by the clock.
  const captured = (input) => {
    if (!input.capturedAt) return {};
    const { date, hour } = localDayParts(input.capturedAt, timezone(input.username));
    return { date, bucket: getMealTimeFromHour(hour) };
  };
  const event = (input, type, payload) => ({
    platform: 'quick-input',
    type,
    userId: input.username,
    conversationId: input.conversationId,
    messageId: null,
    payload: { ...payload, ...captured(input) },
  });

  const handlers = {
    voice: {
      process: async (input) => outcomeOf(await inputRouter.handleVoice(
        event(input, 'voice', { fileId: { buffer: input.body, mimeType: input.mimeType } }), null,
      )),
    },
    text: {
      process: async (input) => outcomeOf(await inputRouter.handleText(
        event(input, 'text', { text: input.body.toString('utf8').trim() }), null,
      )),
    },
    photo: {
      process: async (input) => outcomeOf(await inputRouter.handleImage(
        event(input, 'image', { fileId: null, imageBuffer: input.body }), null,
      )),
    },
  };

  const endpoints = Object.fromEntries(Object.entries(handlers).map(([kind, handler]) => [kind, new QuickInputEndpoint({
    intake: ready ? new QuickInputIntake({ bot: BOT, kind, handler, ledger, clock, logger }) : null,
    deviceUsers: (deviceKey) => boundUsers(deviceConfig?.(deviceKey), BOT, kind),
    resolveConversationId,
    logger,
  })]));

  return { endpoints, ledger };
}

export default createNutribotQuickInputs;
