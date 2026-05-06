import { describe, it, expect } from 'vitest';

import { FitnessSession } from './FitnessSession.js';

describe('FitnessSession._getCurrentContentId pre-session fallback', () => {
  it('returns null when no session, no snapshot content, no pending id', () => {
    const session = new FitnessSession();
    expect(session._getCurrentContentId()).toBeNull();
  });

  it('returns the pending contentId when set, even before session starts', () => {
    const session = new FitnessSession();
    session.setPendingContentId('plex:606203');
    expect(session._getCurrentContentId()).toBe('plex:606203');
  });

  it('prefers snapshot.mediaPlaylists.video[0].contentId when populated', () => {
    const session = new FitnessSession();
    session.setPendingContentId('plex:000000'); // hint that should lose
    session.snapshot.mediaPlaylists.video = [{ contentId: 'plex:606203' }];
    expect(session._getCurrentContentId()).toBe('plex:606203');
  });

  it('clearing pending id resets fallback to null', () => {
    const session = new FitnessSession();
    session.setPendingContentId('plex:606203');
    session.setPendingContentId(null);
    expect(session._getCurrentContentId()).toBeNull();
  });

  it('prefixes a bare snapshot id with plex: when no contentId field is set', () => {
    const session = new FitnessSession();
    // Real play-queue items currently only have .id (bare plex id), no .contentId
    session.snapshot.mediaPlaylists.video = [{ id: '664042' }];
    expect(session._getCurrentContentId()).toBe('plex:664042');
  });

  it('passes through an already-prefixed snapshot id unchanged', () => {
    const session = new FitnessSession();
    session.snapshot.mediaPlaylists.video = [{ id: 'plex:664042' }];
    expect(session._getCurrentContentId()).toBe('plex:664042');
  });

  it('prefixes a bare pending content id with plex:', () => {
    const session = new FitnessSession();
    session.setPendingContentId('664042');
    expect(session._getCurrentContentId()).toBe('plex:664042');
  });

  it('passes through an already-prefixed pending content id unchanged', () => {
    const session = new FitnessSession();
    session.setPendingContentId('plex:664042');
    expect(session._getCurrentContentId()).toBe('plex:664042');
  });

  it('round-trips a bare id through setPendingContentId → _getCurrentContentId as plex-prefixed', () => {
    // Regression guard for the integration contract: even if a caller passes
    // an unprefixed id (current play-queue items have only head.id, no
    // contentId), the value read back via _getCurrentContentId is canonical.
    // (Storage is bare; normalization happens on read.)
    const session = new FitnessSession();
    session.setPendingContentId('664042');
    expect(session._getCurrentContentId()).toBe('plex:664042');
  });
});
