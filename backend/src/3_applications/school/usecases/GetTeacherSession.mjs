import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';
import { reduceSession } from '#domains/school/sessions/sessionEvents.mjs';

/** Read models for the teacher history and session inspector surfaces. */
export class GetTeacherSession {
  #sessions;
  constructor({ sessions } = {}) {
    if (!sessions) throw new Error('GetTeacherSession requires sessions');
    this.#sessions = sessions;
  }

  async execute({ sessionId } = {}) {
    if (typeof sessionId !== 'string' || !sessionId.trim()) throw new ValidationError('sessionId is required');
    const events = await this.#sessions.readEvents(sessionId);
    if (!events.length) throw new EntityNotFoundError('session', sessionId);
    const state = reduceSession(events);
    return {
      schema: 'school.teacher-session/v1',
      sessionId,
      revision: events.reduce((max, event) => Math.max(max, Number(event?.seq) || 0), 0),
      state,
      events,
      artifactIds: [...state.issuedArtifacts],
    };
  }
}

export class GetLearnerTimeline {
  #sessions;
  constructor({ sessions } = {}) {
    if (!sessions) throw new Error('GetLearnerTimeline requires sessions');
    this.#sessions = sessions;
  }

  async execute({ learnerId, limit = 50, before = null, unitId = null } = {}) {
    if (typeof learnerId !== 'string' || !learnerId.trim()) throw new ValidationError('learnerId is required');
    const safeLimit = Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 50));
    const rows = await this.#sessions.listForLearner(learnerId);
    const filtered = rows
      .filter((row) => !unitId || row.unitId === unitId)
      .filter((row) => !before || String(row.updatedAt ?? '') < before)
      .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
    const page = filtered.slice(0, safeLimit);
    return {
      schema: 'school.learner-timeline/v1', learnerId, items: page,
      nextCursor: filtered.length > page.length ? page.at(-1)?.updatedAt ?? null : null,
    };
  }
}

export default GetTeacherSession;
