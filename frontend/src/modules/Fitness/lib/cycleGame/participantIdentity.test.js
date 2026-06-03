import { describe, it, expect } from 'vitest';
import { resolveParticipantIdentity } from './participantIdentity.js';

describe('resolveParticipantIdentity', () => {
  it('treats a plain user slug as a real (non-ghost) rider', () => {
    const r = resolveParticipantIdentity('milo', 'Milo');
    expect(r.isGhost).toBe(false);
    expect(r.sourceId).toBe('milo');
    expect(r.displayName).toBe('Milo');
    expect(r.avatarSrc).toBe('/api/v1/static/img/users/milo');
  });

  it('resolves a ghost id to its source user face and flags it as a ghost', () => {
    const r = resolveParticipantIdentity('ghost:20260603120000:felix', 'Felix');
    expect(r.isGhost).toBe(true);
    expect(r.sourceId).toBe('felix');
    expect(r.avatarSrc).toBe('/api/v1/static/img/users/felix');
    expect(r.displayName).toBe('Felix');
  });

  it('falls back to the whole id when a ghost id has no source segment', () => {
    const r = resolveParticipantIdentity('ghost:malformed', undefined);
    expect(r.isGhost).toBe(true);
    expect(r.sourceId).toBe('ghost:malformed');
    expect(r.displayName).toBe('ghost:malformed');
  });

  it('falls back to the source id when no display name is given', () => {
    const r = resolveParticipantIdentity('kc', undefined);
    expect(r.displayName).toBe('kc');
  });
});
