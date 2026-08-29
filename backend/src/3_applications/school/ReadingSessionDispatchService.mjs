/** Selects the one configured story-time location and invokes its semantic handler. */
export class ReadingSessionDispatchService {
  constructor({ readLocations, handler }) {
    this.readLocations = readLocations;
    this.handler = handler;
  }

  start({ learnerId, origin = 'portal' } = {}) {
    const candidates = Object.entries(this.readLocations() || {})
      .filter(([, config]) => config?.learner_action === 'reading-session');
    if (candidates.length !== 1) {
      return { status: 'reading_session_failed', message: 'Story time needs one configured reading room.' };
    }
    const [location, config] = candidates[0];
    return this.handler({
      learnerId,
      location,
      target: config?.target ?? config?.device ?? null,
      origin,
    });
  }
}

export default ReadingSessionDispatchService;
