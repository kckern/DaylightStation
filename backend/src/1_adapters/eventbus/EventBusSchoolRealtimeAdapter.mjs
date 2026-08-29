import { ISchoolRealtimeGateway } from '#apps/school/ports/ISchoolRealtimeGateway.mjs';

const DEFAULT_PRINT_TOPIC = 'omr';

function printTopics(config = {}) {
  const readers = config?.scanners || {};
  return [...new Set([DEFAULT_PRINT_TOPIC, ...Object.values(readers).map((entry) => entry?.topic).filter(Boolean)])];
}

function decodePrintSheet(marks) {
  const columns = Array.isArray(marks) ? marks : [];
  const candidates = [];
  let anyDigit = false;
  let testId = '';
  for (let index = 0; index < 7; index += 1) {
    const digits = [];
    const mask = columns[index] | 0;
    for (let digit = 0; digit <= 9; digit += 1) if (mask & (1 << (9 - digit))) digits.push(digit);
    candidates.push(digits);
    if (digits.length === 1) { testId += String(digits[0]); anyDigit = true; }
    else { testId += '?'; if (digits.length > 1) anyDigit = true; }
  }
  const answers = {};
  const letters = ['A', 'B', 'C', 'D', 'E'];
  const read = (mask, topBit, question) => {
    const selected = letters.filter((_, offset) => mask & (1 << (topBit - offset)));
    if (selected.length === 1) answers[question] = selected[0];
    else if (selected.length > 1) answers[question] = selected;
  };
  for (let index = 0; index < 25; index += 1) {
    const mask = columns[index + 7];
    if (!mask) continue;
    read(mask, 10, index + 1);
    read(mask, 4, index + 26);
  }
  const decoded = { testId: anyDigit ? testId : null, answers };
  if (decoded.testId?.includes('?')) decoded.testIdCandidates = candidates;
  return decoded;
}

/** Anti-corruption adapter between School facts and the shared event bus. */
export class EventBusSchoolRealtimeAdapter extends ISchoolRealtimeGateway {
  #bus;
  constructor({ eventBus } = {}) {
    super();
    if (!eventBus) throw new Error('EventBusSchoolRealtimeAdapter requires eventBus');
    this.#bus = eventBus;
  }

  #on(topic, handler, map = (value) => value) {
    return this.#bus.subscribe(topic, (wire) => {
      const fact = map(wire);
      return fact == null ? undefined : handler(fact);
    });
  }
  #publish(topic, payload) { return (this.#bus.publish ?? this.#bus.broadcast)?.call(this.#bus, topic, payload); }
  #broadcast(topic, payload) { return (this.#bus.broadcast ?? this.#bus.publish)?.call(this.#bus, topic, payload); }

  onLanguageDayCompleted(handler) { return this.#on('school.language.day-complete', handler); }
  onApprovedLaunchDispatched(handler) {
    return this.#on('donow', handler, (wire) => wire?.type === 'donow.dispatched'
      && wire.approved === true && wire.requestedBy === 'school-scan' ? {
        sessionId: wire.ref, surface: wire.surface, approvalId: wire.approvalId ?? null,
      } : null);
  }
  onFitnessActivityAccepted(handler) { return this.#on('fitness.school-attempt.accepted', handler); }
  onFitnessActivityAssessed(handler) { return this.#on('fitness.school-attempt.assessed', handler); }
  onPianoLessonCompleted(handler) { return this.#on('piano.lesson.completed', handler); }
  onPianoChallengeCompleted(handler) { return this.#on('piano.school-challenge.completed', handler); }
  onSessionOutcomeRecorded(handler) { return this.#on('school.session.outcome-recorded', handler); }
  onPrintSheet(config, handler) {
    const unsubscribers = printTopics(config).map((topic) => this.#on(topic, handler, (wire) => (
      wire?.event === 'sheet' && Array.isArray(wire.marks) ? decodePrintSheet(wire.marks) : null
    )));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe?.());
  }

  languageDayCompleted(fact) { return this.#publish('school.language.day-complete', fact); }
  sessionOutcomeRecorded(fact) { return this.#publish('school.session.outcome-recorded', fact); }
  completionStateObserved(fact) { return this.#publish('school.completion.state-observed', fact); }
  schoolCeremony(announcement) { return this.#broadcast('school', { event: 'piano-lesson-complete', ...announcement }); }
  programDayBypassChanged(announcement) { return this.#broadcast('school', { event: 'program-day-bypass-changed', ...announcement }); }
  storyReadRecorded(announcement) { return this.#broadcast('school', { event: 'story-read', ...announcement }); }
  readingRoomChanged(location, { kind, ...announcement }) { return this.#broadcast(`reading:${location}`, { event: kind, ...announcement }); }
  printAgendaReady(announcement) { return this.#broadcast('omr', { event: 'agenda-suppressed', ...announcement }); }
  printScanResolved({ kind, ...announcement }) { return this.#broadcast(DEFAULT_PRINT_TOPIC, { event: kind, ...announcement }); }
}

export default EventBusSchoolRealtimeAdapter;
