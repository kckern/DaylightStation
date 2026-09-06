/** Read-through session view that suppresses preview writes. */
export class PreviewSchoolSessionStore {
  constructor({ sessions } = {}) {
    if (!sessions) throw new Error('PreviewSchoolSessionStore requires sessions');
    this.sessions = sessions;
  }

  listForLearner = (learnerId) => this.sessions.listForLearner(learnerId);
  readEvents = (sessionId) => this.sessions.readEvents(sessionId);
  appendEvent = async () => {};
}
/** Read-through token view that cannot mint tokens during a preview. */
export class PreviewSchoolTokenRegistry {
  constructor({ tokens } = {}) {
    if (!tokens) throw new Error('PreviewSchoolTokenRegistry requires tokens');
    this.tokens = tokens;
  }

  put = async () => {};
  liveAccessCodes = () => this.tokens.liveAccessCodes();
  // A preview must not spend a child's code any more than it may mint one. It
  // reports the record it would have bumped so a caller reading the result sees
  // the same shape, and writes nothing.
  recordUse = async (token) => this.tokens.get?.(token) ?? null;
}
