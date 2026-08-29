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
}
