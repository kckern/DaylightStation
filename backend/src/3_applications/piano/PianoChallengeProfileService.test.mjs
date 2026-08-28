import { describe, expect, it, vi } from 'vitest';
import { PianoChallengeProfileService } from './PianoChallengeProfileService.mjs';

function subject(initial = {}) {
  const values = new Map(Object.entries(initial));
  const datastore = {
    getPreferences: vi.fn((learnerId) => values.has(learnerId) ? structuredClone(values.get(learnerId)) : null),
    savePreferences: vi.fn((learnerId, value) => { values.set(learnerId, structuredClone(value)); return true; }),
  };
  return { service: new PianoChallengeProfileService({ datastore }), datastore, values };
}

function thrown(action) {
  try { action(); } catch (error) { return error; }
  throw new Error('expected action to throw');
}

describe('PianoChallengeProfileService', () => {
  it('writes only the learner-owned placement start level and preserves other preferences', () => {
    const { service, datastore, values } = subject({ kid: { topPaneLayout: 'triptych', pianoChallenge: { lastProbe: 'old' } } });
    expect(service.setStartLevel({ learnerId: 'kid', startLevel: ' L2 ' })).toEqual({ startLevel: 'L2' });
    expect(datastore.savePreferences).toHaveBeenCalledWith('kid', {
      topPaneLayout: 'triptych', pianoChallenge: { lastProbe: 'old', startLevel: 'L2' },
    });
    expect(values.get('kid').pianoChallenge.startLevel).toBe('L2');
  });

  it('does not treat an unknown learner as a new preferences directory', () => {
    const { service, datastore } = subject();
    expect(thrown(() => service.setStartLevel({ learnerId: 'unknown', startLevel: 'L1' }))).toMatchObject({ status: 400, code: 'invalid_user' });
    expect(datastore.savePreferences).not.toHaveBeenCalled();
  });

  it('rejects a blank or oversized identifier rather than persisting an unusable level', () => {
    const { service, datastore } = subject({ kid: {} });
    expect(thrown(() => service.setStartLevel({ learnerId: 'kid', startLevel: '  ' }))).toMatchObject({ status: 400, code: 'invalid_start_level' });
    expect(thrown(() => service.setStartLevel({ learnerId: 'kid', startLevel: 'x'.repeat(121) }))).toMatchObject({ status: 400, code: 'invalid_start_level' });
    expect(datastore.savePreferences).not.toHaveBeenCalled();
  });
});
