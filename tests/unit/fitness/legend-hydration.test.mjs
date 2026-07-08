// tests/unit/fitness/legend-hydration.test.mjs
import { describe, it, expect } from '@jest/globals';
import { resolveHistoricalParticipant } from '#frontend/modules/Fitness/widgets/FitnessChart/resolveHistoricalParticipant.js';

describe('resolveHistoricalParticipant', () => {
  it('returns displayMap entry when it has a non-slug displayName', () => {
    const displayMap = new Map([
      ['user_1', { displayName: 'User_1', avatarSrc: '/avatars/kc.png', id: 'user_1' }]
    ]);
    const sessionMeta = new Map();
    const out = resolveHistoricalParticipant('user_1', { displayMap, sessionMeta });
    expect(out.name).toBe('User_1');
    expect(out.avatarUrl).toBe('/avatars/kc.png');
    expect(out.profileId).toBe('user_1');
  });

  it('falls back to sessionMeta when displayMap misses', () => {
    const displayMap = new Map();
    const sessionMeta = new Map([['user_4', { name: 'user_4', displayName: 'User_4' }]]);
    const out = resolveHistoricalParticipant('user_4', { displayMap, sessionMeta });
    expect(out.name).toBe('User_4');
    expect(out.avatarUrl).toContain('/static/img/users/user_4');
    expect(out.profileId).toBe('user_4');
  });

  it('prefers sessionMeta.name when sessionMeta.displayName is missing', () => {
    const displayMap = new Map();
    const sessionMeta = new Map([['user_2', { name: 'User_2' }]]);
    const out = resolveHistoricalParticipant('user_2', { displayMap, sessionMeta });
    expect(out.name).toBe('User_2');
  });

  it('falls back to capitalized slug when neither displayMap nor sessionMeta has info', () => {
    const displayMap = new Map();
    const sessionMeta = new Map();
    const out = resolveHistoricalParticipant('user_3', { displayMap, sessionMeta });
    expect(out.name).toBe('User_3');
    expect(out.avatarUrl).toContain('/static/img/users/user_3');
    expect(out.profileId).toBe('user_3');
  });

  it('returns raw slug when slug is a single character', () => {
    const out = resolveHistoricalParticipant('x', { displayMap: new Map(), sessionMeta: new Map() });
    expect(out.name).toBe('X');
  });

  it('handles missing/null slug gracefully', () => {
    const out = resolveHistoricalParticipant(null, { displayMap: new Map(), sessionMeta: new Map() });
    expect(out.name).toBe('Unknown');
    expect(out.profileId).toBe(null);
  });

  it('prefers displayMap over sessionMeta when both present', () => {
    const displayMap = new Map([['user_4', { displayName: 'User_4 B.', avatarSrc: '/dm/user_4.png', id: 'user_4' }]]);
    const sessionMeta = new Map([['user_4', { displayName: 'User_4 (session)' }]]);
    const out = resolveHistoricalParticipant('user_4', { displayMap, sessionMeta });
    expect(out.name).toBe('User_4 B.');
    expect(out.avatarUrl).toBe('/dm/user_4.png');
  });
});
