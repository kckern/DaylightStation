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

describe('resolveParticipantIdentity — ghost dereference', () => {
  it('resolves a first-generation ghost to its source user', () => {
    const r = resolveParticipantIdentity('ghost:20260604055230:user_1', 'KC');
    expect(r.isGhost).toBe(true);
    expect(r.sourceId).toBe('user_1');
    expect(r.avatarSrc).toBe('/api/v1/static/img/users/user_1');
  });

  it('resolves a SECOND-generation ghost back to the original user (not "ghost")', () => {
    const r = resolveParticipantIdentity('ghost:R2:ghost:R1:user_1', 'KC');
    expect(r.isGhost).toBe(true);
    expect(r.sourceId).toBe('user_1');
    expect(r.avatarSrc).toBe('/api/v1/static/img/users/user_1');
  });

  it('resolves a ghost of a hyphenated guest id', () => {
    const r = resolveParticipantIdentity('ghost:R1:guest-adult', 'Guest (Adult)');
    expect(r.sourceId).toBe('guest-adult');
  });

  it('falls back to the full id when the source segment is empty', () => {
    const r = resolveParticipantIdentity('ghost:R1:', 'x');
    expect(r.sourceId).toBe('ghost:R1:');
  });
});
