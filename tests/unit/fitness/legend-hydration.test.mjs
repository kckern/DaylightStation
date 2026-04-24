// tests/unit/fitness/legend-hydration.test.mjs
import { describe, it, expect } from '@jest/globals';
import { resolveHistoricalParticipant } from '#frontend/modules/Fitness/widgets/FitnessChart/resolveHistoricalParticipant.js';

describe('resolveHistoricalParticipant', () => {
  it('returns displayMap entry when it has a non-slug displayName', () => {
    const displayMap = new Map([
      ['kckern', { displayName: 'KC Kern', avatarSrc: '/avatars/kc.png', id: 'kckern' }]
    ]);
    const sessionMeta = new Map();
    const out = resolveHistoricalParticipant('kckern', { displayMap, sessionMeta });
    expect(out.name).toBe('KC Kern');
    expect(out.avatarUrl).toBe('/avatars/kc.png');
    expect(out.profileId).toBe('kckern');
  });

  it('falls back to sessionMeta when displayMap misses', () => {
    const displayMap = new Map();
    const sessionMeta = new Map([['alan', { name: 'alan', displayName: 'Alan' }]]);
    const out = resolveHistoricalParticipant('alan', { displayMap, sessionMeta });
    expect(out.name).toBe('Alan');
    expect(out.avatarUrl).toContain('/static/img/users/alan');
    expect(out.profileId).toBe('alan');
  });

  it('prefers sessionMeta.name when sessionMeta.displayName is missing', () => {
    const displayMap = new Map();
    const sessionMeta = new Map([['felix', { name: 'Felix' }]]);
    const out = resolveHistoricalParticipant('felix', { displayMap, sessionMeta });
    expect(out.name).toBe('Felix');
  });

  it('falls back to capitalized slug when neither displayMap nor sessionMeta has info', () => {
    const displayMap = new Map();
    const sessionMeta = new Map();
    const out = resolveHistoricalParticipant('milo', { displayMap, sessionMeta });
    expect(out.name).toBe('Milo');
    expect(out.avatarUrl).toContain('/static/img/users/milo');
    expect(out.profileId).toBe('milo');
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
    const displayMap = new Map([['alan', { displayName: 'Alan B.', avatarSrc: '/dm/alan.png', id: 'alan' }]]);
    const sessionMeta = new Map([['alan', { displayName: 'Alan (session)' }]]);
    const out = resolveHistoricalParticipant('alan', { displayMap, sessionMeta });
    expect(out.name).toBe('Alan B.');
    expect(out.avatarUrl).toBe('/dm/alan.png');
  });
});
