/** Semantic realtime capabilities used by DoNow workflows. */
export class IDoNowRealtimeGateway {
  observeMidiActivity(_handler) { throw new Error('observeMidiActivity must be implemented'); }
  observePlaybackActivity(_handler) { throw new Error('observePlaybackActivity must be implemented'); }
  publishDispatchCompleted(_event) { throw new Error('publishDispatchCompleted must be implemented'); }
  launchFitness(_command) { throw new Error('launchFitness must be implemented'); }
  launchPiano(_command) { throw new Error('launchPiano must be implemented'); }
  launchPianoCourseLesson(_command) { throw new Error('launchPianoCourseLesson must be implemented'); }
  launchSchool(_command) { throw new Error('launchSchool must be implemented'); }
}

export default IDoNowRealtimeGateway;
