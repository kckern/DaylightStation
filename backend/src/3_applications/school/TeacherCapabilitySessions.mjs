import { randomBytes } from 'node:crypto';
import { GuestForbiddenError } from '#domains/school/errors.mjs';

export const TEACHER_SESSION_COOKIE = 'daylight_teacher_session';
export const TEACHER_SESSION_IDLE_MS = 10 * 60_000;
export const TEACHER_SESSION_ABSOLUTE_MS = 30 * 60_000;
export const TEACHER_STEP_UP_MS = 2 * 60_000;

const token = () => randomBytes(32).toString('base64url');
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const STEP_UP_ACTIONS = new Set([
  'agenda.dispatch', 'attempts.regrade', 'sessions.grade-adjust',
  'sessions.grade-adjustment.retract', 'artifact.postview', 'report-card.close',
]);

export function teacherResource(action, context = {}) {
  if (action === 'agenda.dispatch') return text(context.learnerId);
  if (action === 'attempts.regrade') return text(context.bankId);
  if (action === 'sessions.grade-adjust') return text(context.sessionId);
  if (action === 'sessions.grade-adjustment.retract') {
    const sessionId = text(context.sessionId);
    const adjustmentId = text(context.adjustmentId);
    return sessionId && adjustmentId ? `${sessionId}/${adjustmentId}` : null;
  }
  if (action === 'artifact.postview') return text(context.artifactId);
  if (action === 'report-card.close') return context.supersede === true
    ? `${context.learnerId ?? ''}/${context.periodId ?? ''}` : null;
  return null;
}

export function requiresTeacherStepUp(action, context = {}) {
  return teacherResource(action, context) !== null;
}

/** Process-local capabilities; restart intentionally locks every browser. */
export class TeacherCapabilitySessions {
  #teacherGate; #clock; #sessions = new Map(); #grants = new Map();
  constructor({ teacherGate, clock = () => new Date() } = {}) {
    if (!teacherGate) throw new Error('TeacherCapabilitySessions requires teacherGate');
    this.#teacherGate = teacherGate;
    this.#clock = clock;
  }

  unlock({ userId, pin }) {
    this.#teacherGate.assert({ userId, pin, action: 'teacher.auth.unlock' });
    const now = this.#clock().getTime();
    this.#prune(now);
    const capabilityToken = token();
    this.#sessions.set(capabilityToken, { userId, issuedAt: now, lastUsedAt: now });
    return { capabilityToken, userId, idleExpiresAt: new Date(now + TEACHER_SESSION_IDLE_MS).toISOString(),
      absoluteExpiresAt: new Date(now + TEACHER_SESSION_ABSOLUTE_MS).toISOString() };
  }

  status(capabilityToken, { touch = false } = {}) {
    const now = this.#clock().getTime();
    this.#prune(now);
    const row = this.#sessions.get(capabilityToken);
    if (!row) return { active: false };
    if (touch) row.lastUsedAt = now;
    return { active: true, userId: row.userId,
      idleExpiresAt: new Date(row.lastUsedAt + TEACHER_SESSION_IDLE_MS).toISOString(),
      absoluteExpiresAt: new Date(row.issuedAt + TEACHER_SESSION_ABSOLUTE_MS).toISOString() };
  }

  lock(capabilityToken) {
    const row = this.#sessions.get(capabilityToken);
    this.#sessions.delete(capabilityToken);
    for (const [grantToken, grant] of this.#grants) {
      if (grant.capabilityToken === capabilityToken) this.#grants.delete(grantToken);
    }
    return { locked: Boolean(row) };
  }

  stepUp({ capabilityToken, pin, action, resource }) {
    const session = this.status(capabilityToken, { touch: true });
    if (!session.active) throw new GuestForbiddenError('The teacher session has expired. Unlock it again.');
    const normalizedAction = text(action);
    const normalizedResource = text(resource);
    if (!STEP_UP_ACTIONS.has(normalizedAction) || !normalizedResource) {
      throw new GuestForbiddenError('A valid step-up action and resource are required.');
    }
    this.#teacherGate.assert({ userId: session.userId, pin, action: 'teacher.auth.step-up',
      context: { requestedAction: normalizedAction, resource: normalizedResource } });
    const grantToken = token();
    const now = this.#clock().getTime();
    this.#grants.set(grantToken, { capabilityToken, action: normalizedAction, resource: normalizedResource, expiresAt: now + TEACHER_STEP_UP_MS });
    return { grantToken, action: normalizedAction, resource: normalizedResource,
      expiresAt: new Date(now + TEACHER_STEP_UP_MS).toISOString() };
  }

  authorize({ capabilityToken, stepUpToken = null, userId, action, context = {} }) {
    const session = this.status(capabilityToken, { touch: true });
    if (!session.active || session.userId !== userId) return false;
    if (!requiresTeacherStepUp(action, context)) return true;
    const grant = this.#grants.get(stepUpToken);
    // Consume any presented grant, successful or not, so probing cannot reuse it.
    if (stepUpToken) this.#grants.delete(stepUpToken);
    const now = this.#clock().getTime();
    return Boolean(grant && grant.capabilityToken === capabilityToken && grant.action === action
      && grant.resource === teacherResource(action, context) && grant.expiresAt > now);
  }

  #prune(now) {
    for (const [capabilityToken, row] of this.#sessions) {
      if (now - row.lastUsedAt >= TEACHER_SESSION_IDLE_MS || now - row.issuedAt >= TEACHER_SESSION_ABSOLUTE_MS) {
        this.#sessions.delete(capabilityToken);
      }
    }
    for (const [grantToken, grant] of this.#grants) {
      if (grant.expiresAt <= now || !this.#sessions.has(grant.capabilityToken)) this.#grants.delete(grantToken);
    }
  }
}

export default TeacherCapabilitySessions;
