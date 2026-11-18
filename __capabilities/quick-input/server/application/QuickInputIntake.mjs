/**
 * Quick Input Intake
 * @module quick-input/application/QuickInputIntake
 *
 * One input captured away from the chat (a recording, a typed note, a photo)
 * handed to a bot exactly once. The intake owns what is the same for every
 * bot and kind: one input id is processed once, a retry finishes what an
 * earlier attempt left undone, the day's allowance is kept, and the time the
 * input was captured is believed only when it can be. What a bot does with
 * the input is its kind handler.
 *
 * A kind handler:
 *
 *   lookup?(input)  -> state | null
 *       Has the bot already stored this input? The state it returns is what
 *       the replies need (for a journal entry, its text). A handler with no
 *       lookup is asked nothing: the ledger's own record decides.
 *
 *   process(input)  -> { state?, summary? }
 *                    | { nothing: 'empty_transcription' | 'unusable_input', notify? }
 *                    | { unavailable: true }
 *       Take the input in and store it. `summary` is added to the accepted
 *       answer. `nothing` means there was nothing usable in it; `notify`, if
 *       given, tells the user so and may fail without failing the input.
 *       `unavailable` means a service the bot needs is not configured; the
 *       input is not stored and may be sent again.
 *       Throwing means the attempt failed and may be tried again.
 *
 *   replies?: [{ step, send(input, state) }]
 *       What is sent to the user afterwards, in order. Each is noted in the
 *       ledger when it has gone, so a retry sends only the ones that have not.
 *
 * `input` is { conversationId, username, inputId, body, mimeType, capturedAt }
 * where `capturedAt` is a Date when the client's recorded time was believed
 * and null otherwise.
 */

import { recordedTime } from './recordedTime.mjs';

export class QuickInputIntake {
  #bot;
  #kind;
  #handler;
  #ledger;
  #clock;
  #logger;
  #events;
  #describe;
  // Inputs being processed right now, so a retry that arrives while the
  // first attempt is still running joins it and does not start a second.
  #inFlight = new Map();

  /**
   * @param {Object} deps
   * @param {string} deps.bot - 'journalist' | 'nutribot'
   * @param {string} deps.kind - 'voice' | 'text' | 'photo'
   * @param {Object} deps.handler - The bot's kind handler (see above)
   * @param {import('./QuickInputLedger.mjs').QuickInputLedger} deps.ledger - This bot's ledger
   * @param {() => number} [deps.clock] - Epoch ms
   * @param {Object} [deps.logger]
   * @param {string} [deps.events] - Prefix of the log events this intake emits
   * @param {(input: Object) => Object} [deps.describe] - The fields an event names the input by
   */
  constructor({ bot, kind, handler, ledger, clock = Date.now, logger = {}, events = 'quick_input', describe = null } = {}) {
    if (!bot) throw new Error('bot is required');
    if (!kind) throw new Error('kind is required');
    if (typeof handler?.process !== 'function') throw new Error('handler is required');
    if (!ledger?.record || !ledger?.admission) throw new Error('ledger is required');
    this.#bot = bot;
    this.#kind = kind;
    this.#handler = handler;
    this.#ledger = ledger;
    this.#clock = clock;
    this.#logger = logger;
    this.#events = events;
    this.#describe = describe || (({ inputId, username }) => ({ inputId, username, bot, kind }));
  }

  get bot() { return this.#bot; }
  get kind() { return this.#kind; }

  /**
   * Whether an input of `bytes` would be taken today, asked before the body is read.
   * @returns {{allowed: true} | {allowed: false, limit: 'inputs'|'bytes', retryAfterSeconds: number}}
   */
  admission({ username, inputId, bytes = 0 }) {
    return this.#ledger.admission(username, this.#kind, inputId, bytes);
  }

  /**
   * @param {Object} input
   * @param {string} input.conversationId - The user's conversation with the bot
   * @param {string} input.username
   * @param {string} input.inputId - The client's id for this input
   * @param {Buffer} input.body
   * @param {string} input.mimeType
   * @param {number|null} [input.recordedAt] - Epoch ms the input was captured
   * @returns {Promise<{kind: 'accepted', inputId: string}
   *   | {kind: 'duplicate', inputId: string}
   *   | {kind: 'resumed', inputId: string}
   *   | {kind: 'empty_transcription'|'unusable_input', inputId: string}
   *   | {kind: 'unavailable', inputId: string}
   *   | {kind: 'daily_limit', inputId: string, limit: 'inputs'|'bytes', retryAfterSeconds: number}>}
   *   `resumed`: the input was already stored and this call sent the replies
   *   an earlier attempt did not.
   */
  async execute(input) {
    const key = `${input.username}|${input.inputId}`;
    const running = this.#inFlight.get(key);
    if (running) return running;

    const work = this.#run(input).finally(() => this.#inFlight.delete(key));
    this.#inFlight.set(key, work);
    return work;
  }

  async #run({ conversationId, username, inputId, body, mimeType, recordedAt = null }) {
    const kind = this.#kind;
    const steps = this.#handler.replies || [];
    const noted = (step) => `${step}Sent`;

    const record = this.#ledger.record(username, kind, inputId);
    if (record?.outcome) return { kind: record.outcome, inputId };

    const input = { conversationId, username, inputId, body, mimeType, capturedAt: null };

    // The bot's own store is the record of what was taken in; the ledger says
    // whether the replies went out. Stored with no ledger record is finished.
    let state = this.#handler.lookup ? await this.#handler.lookup(input) : (record?.saved ? {} : null);
    if (state && (!record || steps.every(({ step }) => record[noted(step)]))) {
      return { kind: 'duplicate', inputId };
    }
    const resuming = Boolean(state);

    // The real size against the user's day. The route asks the same question
    // from the declared length before reading the body; an upload with no
    // declared length is first measured here.
    const bytes = body?.length ?? 0;
    const admission = this.#ledger.admission(username, kind, inputId, resuming ? 0 : bytes);
    if (!admission.allowed) {
      return { kind: 'daily_limit', inputId, limit: admission.limit, retryAfterSeconds: admission.retryAfterSeconds };
    }
    this.#ledger.countAttempt(username, kind, inputId, bytes, { processing: !resuming });

    // Which replies have gone out. Only a stored input can have sent any.
    const sent = resuming ? record : {};
    let summary = {};

    if (!resuming) {
      const { at, ignored } = recordedTime(recordedAt, this.#clock());
      if (ignored) {
        this.#logger.info?.(`${this.#events}.recordedAtIgnored`, { ...this.#describe(input), reason: ignored });
      }
      input.capturedAt = at;

      const outcome = await this.#handler.process(input) || {};
      if (outcome.unavailable) return { kind: 'unavailable', inputId };
      if (outcome.nothing) {
        // Noted first, so a retry of the same input does not redo the work.
        this.#ledger.mark(username, kind, inputId, { outcome: outcome.nothing });
        if (outcome.notify) {
          try {
            await outcome.notify();
          } catch (error) {
            this.#logger.warn?.(`${this.#events}.apologyFailed`, { ...this.#describe(input), error: error?.message });
          }
        }
        return { kind: outcome.nothing, inputId };
      }

      state = outcome.state ?? {};
      summary = outcome.summary ?? {};
      this.#ledger.mark(username, kind, inputId, {
        saved: true, ...Object.fromEntries(steps.map(({ step }) => [noted(step), false])),
      });
    }

    for (const { step, send } of steps) {
      if (sent[noted(step)]) continue;
      await send(input, state);
      this.#ledger.mark(username, kind, inputId, { [noted(step)]: true });
    }

    return resuming ? { kind: 'resumed', inputId } : { kind: 'accepted', inputId, ...summary };
  }
}

export default QuickInputIntake;
