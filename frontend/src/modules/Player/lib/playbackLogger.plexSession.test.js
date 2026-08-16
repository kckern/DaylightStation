// Tier 2, Task 2.1 — the frontend half.
//
// Diagnosing the 2026-08-16 transcode storm meant reading Plex's own server log
// inside its container, because no line we wrote shared a key with it. These
// tests pin the identifier into the playback logger's context so every
// subsequent playback line carries the key Plex logs.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setPlexSessionIdentity,
  resetPlaybackLoggerContext,
  configurePlaybackLogger,
  playbackLog,
} from './playbackLogger.js';

const PLEX_ID = '008c56a342:0-AbCdEfGhIj-x50258f1f';

function captureLines() {
  const lines = [];
  configurePlaybackLogger({
    level: 'debug',
    enabled: true,
    sinks: [(entry) => lines.push(entry)],
  });
  return lines;
}

describe('setPlexSessionIdentity', () => {
  beforeEach(() => {
    resetPlaybackLoggerContext();
  });

  it('puts the identifier on every subsequent playback line', () => {
    const lines = captureLines();
    setPlexSessionIdentity(PLEX_ID);

    playbackLog('some-later-event', { a: 1 });

    expect(lines).toHaveLength(1);
    expect(lines[0].context.plexClientIdentifier).toBe(PLEX_ID);
    expect(lines[0].context.plexClientIdentifierState).toBe('threaded');
  });

  it('distinguishes "no session was sent" from "not a Plex stream"', () => {
    // null: the play response WAS a Plex stream but no ?session= reached the
    // backend, so Plex mints a fresh random client per request.
    expect(setPlexSessionIdentity(null)).toMatchObject({
      plexClientIdentifier: null,
      plexClientIdentifierState: 'no-session-sent',
    });

    // undefined: the field was absent — this item does not go through Plex.
    expect(setPlexSessionIdentity(undefined)).toMatchObject({
      plexClientIdentifier: null,
      plexClientIdentifierState: 'not-a-plex-stream',
    });
  });

  it('does not leave a previous item’s identifier attached to the next one', () => {
    setPlexSessionIdentity(PLEX_ID);
    const after = setPlexSessionIdentity(undefined);

    expect(after.plexClientIdentifier).toBeNull();
    expect(after.plexClientIdentifierState).toBe('not-a-plex-stream');
  });
});

describe('fetchMediaInfo adopts the identifier from the play response', () => {
  beforeEach(() => {
    vi.resetModules();
    resetPlaybackLoggerContext();
  });

  it('carries the backend’s plexClientIdentifier into later lines', async () => {
    vi.doMock('../../../lib/api.mjs', () => ({
      DaylightAPI: vi.fn(async () => ({
        id: 'plex:694719',
        mediaUrl: `/api/v1/proxy/plex/stream/694719?session=${encodeURIComponent('008c56a342:0#AbCdEfGhIj')}`,
        plexClientIdentifier: PLEX_ID,
      })),
    }));

    const { fetchMediaInfo } = await import('./api.js');
    const logger = await import('./playbackLogger.js');
    logger.resetPlaybackLoggerContext();

    await fetchMediaInfo({ contentId: 'plex:694719', session: '008c56a342:0#AbCdEfGhIj' });

    const lines = [];
    logger.configurePlaybackLogger({ level: 'debug', enabled: true, sinks: [(e) => lines.push(e)] });
    logger.playbackLog('a-later-playback-event', {});

    expect(lines[0].context.plexClientIdentifier).toBe(PLEX_ID);
  });
});
