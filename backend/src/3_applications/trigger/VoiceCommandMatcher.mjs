/**
 * VoiceCommandMatcher — which of a location's configured voice commands does
 * a transcript ask for?
 *
 *   1. exact keyword ("play jazz" → play_jazz): no model, always trusted;
 *   2. otherwise one typed-decision `choice` over the command ids (their
 *      descriptions as option text) plus 'none'. Accepted only at or above
 *      the confidence floor; below it the answer is logged as a near miss
 *      and treated as no match.
 *
 * Never throws: a missing or failing decision model is "no match".
 * Layer: APPLICATION (3_applications/trigger). Owns the question.
 */
import { choice } from '#apps/common/ports/IDecisionGateway.mjs';
import { VoiceResolver, voiceKeyword } from '#domains/trigger/services/VoiceResolver.mjs';

const NONE = 'none';
const DEFAULT_CONFIDENCE_FLOOR = 0.6;
const DEFAULT_TIMEOUT_MS = 1500;
const LOG_TRANSCRIPT_CHARS = 200;

const INSTRUCTIONS = 'Someone in the house said `said`. Which listed command were they asking for? '
  + 'Choose "none" if they asked for something not listed, were not giving a command, '
  + 'or the words could mean more than one listed command.';
const NONE_DESCRIPTION = 'None of these: not a request for any listed command';

const miss = (reason, extra = {}) => ({ command: null, via: null, confidence: null, reason, ...extra });

export class VoiceCommandMatcher {
  #decisionGateway; #confidenceFloor; #timeoutMs; #clock; #logger;

  /**
   * @param {Object} deps
   * @param {Object} [deps.decisionGateway] - IDecisionGateway
   * @param {number} [deps.confidenceFloor=0.6] - default floor; a location's routing.confidenceFloor overrides it
   * @param {number} [deps.timeoutMs=1500]
   * @param {Function} [deps.clock]
   * @param {Object} [deps.logger]
   */
  constructor({ decisionGateway = null, confidenceFloor = DEFAULT_CONFIDENCE_FLOOR, timeoutMs = DEFAULT_TIMEOUT_MS, clock = () => Date.now(), logger = console } = {}) {
    this.#decisionGateway = decisionGateway?.isConfigured?.() === false ? null : decisionGateway;
    this.#confidenceFloor = confidenceFloor;
    this.#timeoutMs = timeoutMs;
    this.#clock = clock;
    this.#logger = logger;
  }

  get hasDecisionModel() { return !!this.#decisionGateway; }

  /**
   * @param {Object} params
   * @param {string} params.location
   * @param {string} params.transcript
   * @param {Object} params.locationConfig - registry.voice.locations[location]
   * @param {boolean} [params.useModel=true] - false = exact keyword only
   * @returns {Promise<{ command: string|null, via: 'exact'|'jev'|null, confidence: number|null, reason: string|null, jevCommand?: string|null, model?: string|null }>}
   */
  async match({ location, transcript, locationConfig, useModel = true }) {
    const keyword = voiceKeyword(transcript);
    // hasOwn, not `commands[keyword]`: "constructor" or "__proto__" would
    // otherwise find an inherited Object member and count as an exact match.
    if (keyword && Object.hasOwn(locationConfig?.commands ?? {}, keyword)) {
      this.#logger.debug?.('trigger.voice.match', { location, command: keyword, via: 'exact' });
      return { command: keyword, via: 'exact', confidence: null, reason: null };
    }
    if (!useModel) return miss('model-off');
    if (!this.#decisionGateway) return miss('no-decision-model');

    const commands = VoiceResolver.commandOptions(locationConfig);
    if (Object.keys(commands).length === 0) return miss('no-commands');
    const options = { ...commands, [NONE]: NONE_DESCRIPTION };
    const floor = locationConfig?.routing?.confidenceFloor ?? this.#confidenceFloor;
    const startedAt = this.#clock();

    let result;
    try {
      result = await this.#decisionGateway.evaluate(
        { said: transcript },
        { command: choice(INSTRUCTIONS, options) },
        { timeout: this.#timeoutMs },
      );
    } catch (error) {
      this.#logger.warn?.('trigger.voice.decision_failed', { location, error: error.message, elapsedMs: this.#clock() - startedAt });
      return miss('decision-failed');
    }

    const answer = result?.answers?.command ?? {};
    const picked = typeof answer.choice === 'string' ? answer.choice : null;
    const confidence = Number.isFinite(answer.confidence) ? answer.confidence : null;
    const reason = !picked || !Object.hasOwn(options, picked) ? 'outside-options'
      : picked === NONE ? 'none'
      : confidence === null || confidence < floor ? 'low-confidence'
      : null;
    const logData = {
      location,
      transcript: String(transcript).slice(0, LOG_TRANSCRIPT_CHARS),
      jevCommand: picked,
      confidence,
      floor,
      reason,
      model: result?.model ?? null,
      elapsedMs: this.#clock() - startedAt,
    };

    if (reason === 'low-confidence') {
      this.#logger.info?.('trigger.voice.near_miss', logData);
    } else {
      this.#logger.info?.('trigger.voice.match', { ...logData, command: reason ? null : picked, via: reason ? null : 'jev' });
    }
    if (reason) return miss(reason, { confidence, jevCommand: picked });
    return { command: picked, via: 'jev', confidence, reason: null, model: result?.model ?? null };
  }
}

export default VoiceCommandMatcher;
