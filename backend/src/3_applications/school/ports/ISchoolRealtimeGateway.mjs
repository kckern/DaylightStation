/**
 * Semantic realtime boundary used by School workflows.
 *
 * Topic names, event-bus method names, and wire payload decoding belong to
 * the adapter. School applications only describe facts they observe or
 * announcements they need to make.
 */
export class ISchoolRealtimeGateway {
  onLanguageDayCompleted(_handler) { throw new Error('onLanguageDayCompleted must be implemented'); }
  onApprovedLaunchDispatched(_handler) { throw new Error('onApprovedLaunchDispatched must be implemented'); }
  onFitnessActivityAccepted(_handler) { throw new Error('onFitnessActivityAccepted must be implemented'); }
  onFitnessActivityAssessed(_handler) { throw new Error('onFitnessActivityAssessed must be implemented'); }
  onPianoLessonCompleted(_handler) { throw new Error('onPianoLessonCompleted must be implemented'); }
  onPianoChallengeCompleted(_handler) { throw new Error('onPianoChallengeCompleted must be implemented'); }
  onSessionOutcomeRecorded(_handler) { throw new Error('onSessionOutcomeRecorded must be implemented'); }
  onPrintSheet(_readerConfig, _handler) { throw new Error('onPrintSheet must be implemented'); }
  languageDayCompleted(_fact) { throw new Error('languageDayCompleted must be implemented'); }
  sessionOutcomeRecorded(_fact) { throw new Error('sessionOutcomeRecorded must be implemented'); }
  completionStateObserved(_fact) { throw new Error('completionStateObserved must be implemented'); }
  schoolCeremony(_announcement) { throw new Error('schoolCeremony must be implemented'); }
  programDayBypassChanged(_announcement) { throw new Error('programDayBypassChanged must be implemented'); }
  storyReadRecorded(_announcement) { throw new Error('storyReadRecorded must be implemented'); }
  readingRoomChanged(_location, _announcement) { throw new Error('readingRoomChanged must be implemented'); }
  printAgendaReady(_announcement) { throw new Error('printAgendaReady must be implemented'); }
  printScanResolved(_announcement) { throw new Error('printScanResolved must be implemented'); }
}

export default ISchoolRealtimeGateway;
