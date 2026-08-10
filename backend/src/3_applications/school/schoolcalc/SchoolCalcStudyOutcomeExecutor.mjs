import { createEvent, reduceSession } from '#domains/school/sessions/sessionEvents.mjs';

/** Late-bound bridge that terminally settles the generic agenda work session. */
export class SchoolCalcStudyOutcomeExecutor {
  #sessions = null;

  bind({ sessions } = {}) {
    if (!sessions?.readEvents || !sessions?.appendEvent) throw new Error('Study outcome executor requires work sessions');
    this.#sessions = sessions;
    return this;
  }

  async execute({ studySession, percent, passingPercent, resultDigest, at, transport } = {}) {
    if (!this.#sessions) throw new Error('SchoolCalc study outcome executor is not bound');
    const sessionId = studySession.workSessionId;
    let state = reduceSession(await this.#sessions.readEvents(sessionId));
    if (!state.sessionId) throw new Error(`SchoolCalc work session '${sessionId}' is unavailable`);
    if (state.terminal) return { status: 'duplicate', result: state.outcome?.result ?? null };
    const append = async (type, fields = {}) => {
      const built = createEvent({ type, at, sessionId, ...fields });
      if (built.errors.length) throw new Error(`SchoolCalc could not ${type}: ${built.errors.join('; ')}`);
      await this.#sessions.appendEvent(sessionId, built.event);
      state = reduceSession(await this.#sessions.readEvents(sessionId));
    };
    if (state.state === 'created') await append('issued', { artifactId: studySession.artifact.artifactId });
    if (['issued', 'reprinted'].includes(state.state)) await append('submitted', { transport: transport === 'qr' ? 'screen' : 'screen' });
    if (state.state === 'submitted') await append('graded', {
      attemptIds: [`schoolcalc:${resultDigest}`], percent, passingPercent,
    });
    const passed = percent >= passingPercent;
    if (state.state === 'graded') await append('outcome_recorded', {
      outcomeId: `schoolcalc:${studySession.studySessionId}`, result: passed ? 'passed' : 'needs_remediation',
      reason: passed ? 'met_passing_score' : 'below_passing',
    });
    if (state.state === 'outcome_recorded') {
      if (passed) await append('rewarded', { txnId: `schoolcalc:${studySession.studySessionId}`, amount: 0 });
      else await append('remediation_opened', {
        newSessionId: `agenda:${studySession.studySessionId}`, variant: 1,
      });
    }
    return { status: 'settled', result: passed ? 'passed' : 'failed', percent };
  }
}

export default SchoolCalcStudyOutcomeExecutor;
