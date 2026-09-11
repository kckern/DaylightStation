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
import { EventBusSchoolRealtimeAdapter } from '#adapters/eventbus/EventBusSchoolRealtimeAdapter.mjs';

/**
 * @param {object} args
 * @param {object} args.datastore Language-study persistence.
 * @param {object} args.eventBus The shared bus; adapted to the School realtime port here.
 * @param {Function} [args.readProgramEnrollment] Learner's ladder enrollment, if any.
 * @param {string|null} [args.timezone]
 * @param {Function|null} [args.readGate] Resolved access gate; absent means open.
 * @param {object} [args.logger]
 */
export function createLanguageStudyService({
  datastore,
  eventBus,
  readProgramEnrollment = null,
  timezone = null,
  readGate = null,
  logger = console,
}) {
  if (!datastore) throw new Error('createLanguageStudyService requires datastore');
  if (!eventBus) throw new Error('createLanguageStudyService requires eventBus');
  return new SentenceLadderService({
    datastore,
    readProgramEnrollment,
    timezone,
    readGate,
    logger,
    realtime: new EventBusSchoolRealtimeAdapter({ eventBus }),
  });
}

export default createLanguageStudyService;
