/**
 * Sentence Ladder composition.
 *
 * This module exists because of a defect it now makes impossible. The service
 * consumes School's realtime PORT (`ISchoolRealtimeGateway`); the raw event bus
 * is a transport and has none of that vocabulary. Composition used to build the
 * service inline and pass `eventBus`, which JavaScript silently dropped — the
 * service's `realtime` stayed null, `#emitDayComplete` returned at its first
 * guard on every saved attempt, and `school.language.day-complete` was never
 * published once. `CloseLanguageDay` subscribed at the other end and waited
 * months for a fact nobody sent, so a finished language day earned nothing.
 *
 * Naming the translation here, behind a factory that REFUSES a missing bus,
 * turns that silent mis-wiring into a startup failure and gives the
 * composition contract registry something it can actually exercise.
 */
import { SentenceLadderService } from '#apps/school/SentenceLadderService.mjs';
import { SentenceMeaningJudge } from '#apps/school/SentenceMeaningJudge.mjs';
import { EventBusSchoolRealtimeAdapter } from '#adapters/eventbus/EventBusSchoolRealtimeAdapter.mjs';
import { NodeApplicationScheduler } from '#adapters/scheduling/NodeApplicationScheduler.mjs';

const MEANING_TIMEOUT_DEFAULT_MS = 1500;
const MEANING_TIMEOUT_MIN_MS = 100;
const MEANING_TIMEOUT_MAX_MS = 5000;

/**
 * `language.meaning_judge.timeout_ms`, bounded. The learner waits on this
 * before their attempt is stored, so a typo (60000, "1.5s") must not stall
 * every interpretation answer; out of range or not a number → the default,
 * with one warning naming the bad value.
 */
function meaningTimeoutMs(config, logger) {
  const raw = config?.timeout_ms;
  if (raw == null) return MEANING_TIMEOUT_DEFAULT_MS;
  if (Number.isFinite(raw) && raw >= MEANING_TIMEOUT_MIN_MS && raw <= MEANING_TIMEOUT_MAX_MS) return raw;
  logger.warn?.('school.language.meaning-judge.timeout-invalid', {
    timeout_ms: raw, min: MEANING_TIMEOUT_MIN_MS, max: MEANING_TIMEOUT_MAX_MS, using: MEANING_TIMEOUT_DEFAULT_MS,
  });
  return MEANING_TIMEOUT_DEFAULT_MS;
}

/**
 * @param {object} args
 * @param {object} args.datastore Language-study persistence.
 * @param {object} args.eventBus The shared bus; adapted to the School realtime port here.
 * @param {Function} [args.readProgramEnrollment] Learner's ladder enrollment, if any.
 * @param {string|null} [args.timezone]
 * @param {Function|null} [args.readGate] Resolved access gate; absent means open.
 * @param {object|null} [args.languageTranscription] The SAME transcription
 *   service the router is given, or null without an AI gateway. Passed as the
 *   object rather than as a boolean so there is no second flag to set wrongly:
 *   whether a rung may be answered by voice and whether the microphone is
 *   drawn now come from one value. A service that offered the rung on a
 *   deployment that cannot transcribe would hand a child a rung with no way in
 *   and no way past.
 * @param {object|null} [args.decisionGateway] IDecisionGateway; without one no
 *   meaning score is recorded and rows are exactly as before.
 * @param {{enabled?: boolean, timeout_ms?: number}|null} [args.meaningJudgeConfig]
 *   `language.meaning_judge` from the school household config. On by default
 *   wherever a gateway exists; `enabled: false` turns it off. `timeout_ms`
 *   is honoured within 100..5000, otherwise the 1500 default (warned once).
 * @param {object} [args.logger]
 */
export function createLanguageStudyService({
  datastore,
  eventBus,
  readProgramEnrollment = null,
  timezone = null,
  readGate = null,
  languageTranscription = null,
  decisionGateway = null,
  meaningJudgeConfig = null,
  logger = console,
}) {
  if (!datastore) throw new Error('createLanguageStudyService requires datastore');
  if (!eventBus) throw new Error('createLanguageStudyService requires eventBus');
  const meaningJudge = decisionGateway && meaningJudgeConfig?.enabled !== false
    ? new SentenceMeaningJudge({
      decisionGateway,
      timeoutMs: meaningTimeoutMs(meaningJudgeConfig, logger),
      // The application layer may not hold global timers; the deadline runs
      // on the injected scheduler.
      scheduler: new NodeApplicationScheduler(),
      logger,
    })
    : null;
  return new SentenceLadderService({
    datastore,
    readProgramEnrollment,
    timezone,
    readGate,
    // Boolean HERE, not in the application layer: the service may not hold an
    // adapter, and all it needs to know is whether the alternative exists.
    voiceAnswer: Boolean(languageTranscription),
    meaningJudge: meaningJudge?.enabled ? meaningJudge : null,
    logger,
    realtime: new EventBusSchoolRealtimeAdapter({ eventBus }),
  });
}

export default createLanguageStudyService;
