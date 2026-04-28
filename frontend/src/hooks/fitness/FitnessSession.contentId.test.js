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
});
