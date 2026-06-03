import { describe, it, expect } from 'vitest';
import { resolveParticipantIdentity } from './participantIdentity.js';

describe('resolveParticipantIdentity', () => {
  it('treats a plain user slug as a real (non-ghost) rider', () => {
    const r = resolveParticipantIdentity('user_3', 'User_3');
    expect(r.isGhost).toBe(false);
    expect(r.sourceId).toBe('user_3');
    expect(r.displayName).toBe('User_3');
    expect(r.avatarSrc).toBe('/api/v1/static/img/users/user_3');
  });

  it('resolves a ghost id to its source user face and flags it as a ghost', () => {
    const r = resolveParticipantIdentity('ghost:20260603120000:user_2', 'User_2');
    expect(r.isGhost).toBe(true);
    expect(r.sourceId).toBe('user_2');
    expect(r.avatarSrc).toBe('/api/v1/static/img/users/user_2');
    expect(r.displayName).toBe('User_2');
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
