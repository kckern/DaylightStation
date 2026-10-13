import { describe, expect, it, vi } from 'vitest';
import { SchoolPianoChallengeCompletionService } from './SchoolPianoChallengeCompletionService.mjs';

function subject(seed = {}, config = {}) {
  const records = new Map(Object.entries(seed));
  const datastore = {
    getPreferences: vi.fn((id) => records.has(id) ? structuredClone(records.get(id)) : null),
    savePreferences: vi.fn((id, value) => { records.set(id, structuredClone(value)); return true; }),
  };
  const service = new SchoolPianoChallengeCompletionService({
    datastore, config: () => config, timezone: 'America/Los_Angeles', clock: () => new Date('2026-08-28T20:00:00.000Z'),
  });
  return { service, datastore, records };
}
function thrown(action) { try { action(); } catch (error) { return error; } throw new Error('expected action to throw'); }

describe('SchoolPianoChallengeCompletionService', () => {
  it('exposes only a complete descriptor matching the owed course lesson', () => {
    const { service } = subject({}, { schoolChallenges: [{
      id: 'user_5-c-major', courseId: 'plex:100', lessonId: 'plex:10',
      ask: { tier: 1 }, materialSpec: { kind: 'keys', notes: 3 }, framing: 'Play C major.',
    }] });
    expect(service.descriptorFor({ courseId: 'plex:100', lessonId: 'plex:10' }))
      .toMatchObject({ id: 'user_5-c-major', framing: 'Play C major.' });
    expect(service.descriptorFor({ courseId: 'plex:100', lessonId: 'plex:11' })).toBeNull();
  });

  it('records configured School challenge evidence without overwriting unrelated piano preferences', () => {
    const config = { schoolChallenges: [{ id: 'school-c-major', courseId: 'plex:100', lessonId: 'plex:10', ask: { tier: 1 }, materialSpec: { kind: 'keys', notes: 3 } }] };
    const { service, records } = subject({ user_5: { topPaneLayout: 'triptych' } }, config);
    const result = service.recordPassed({ learnerId: 'user_5', descriptorId: 'school-c-major', assessmentId: 'attempt-1', score: 0.9 });
    expect(result).toMatchObject({ descriptorId: 'school-c-major', duplicate: false, studyDay: '2026-08-28' });
    expect(records.get('user_5')).toMatchObject({ topPaneLayout: 'triptych', pianoChallenge: { schoolCompletions: { '2026-08-28': { 'school-c-major': { assessmentId: 'attempt-1', score: 0.9 } } } } });
    expect(service.completed({ learnerId: 'user_5', descriptorId: 'school-c-major' })).toBe(true);
  });

  it('is idempotent for the same assessment and refuses a competing completion', () => {
    const config = { schoolChallenges: [{ id: 'school-c-major', courseId: 'plex:100', lessonId: 'plex:10', ask: { tier: 1 }, materialSpec: { kind: 'keys', notes: 3 } }] };
    const { service } = subject({ user_5: {} }, config);
    service.recordPassed({ learnerId: 'user_5', descriptorId: 'school-c-major', assessmentId: 'attempt-1', score: 1 });
    expect(service.recordPassed({ learnerId: 'user_5', descriptorId: 'school-c-major', assessmentId: 'attempt-1', score: 1 })).toMatchObject({ duplicate: true });
    expect(thrown(() => service.recordPassed({ learnerId: 'user_5', descriptorId: 'school-c-major', assessmentId: 'attempt-2', score: 1 }))).toMatchObject({ name: 'ConflictError' });
  });

  it('refuses a descriptor that is no longer configured', () => {
    const { service } = subject({ user_5: {} });
    expect(thrown(() => service.recordPassed({ learnerId: 'user_5', descriptorId: 'removed', assessmentId: 'attempt-1', score: 1 }))).toMatchObject({ name: 'NotFoundError' });
  });
});
