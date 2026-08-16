/**
 * Player remount storm brake — wiring coverage.
 *
 * `remountStormGuard.test.js` pins the arithmetic; this pins the line that calls
 * it. The brake sits on `singlePlayerKey` rather than on forceSinglePlayerRemount
 * because that is where the 2026-08-16 damage came from: only three of roughly
 * three hundred teardowns went through the explicit remount path, and the rest
 * were React reconciliation reacting to a key that would not hold still. Each of
 * those teardowns opened a Plex transcode session — 495 in four minutes.
 *
 * Content changes drive the churn here because that is the cheapest way to move
 * the key from a test. In production the churn came from an identity that changed
 * without the content changing, which is why a tripped guard is re-armed by the
 * clock and not by a content change.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

const mounts = [];
const renders = [];

vi.mock('./components/SinglePlayer.jsx', async () => {
  const { useEffect } = await import('react');
  return {
    SinglePlayer: ({ plexClientSession }) => {
      renders.push(plexClientSession);
      useEffect(() => {
        mounts.push(plexClientSession);
      }, []);
      return <div data-testid="single-player-stub" />;
    }
  };
});

vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.reject(new Error('offline in test')))
}));

// Record events instead of emitting them: the storm log is an assertion target,
// and the rest of the player's logging is noise in this file.
vi.mock('./lib/playbackLogger.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, playbackLog: vi.fn() };
});

import Player from './Player.jsx';
import { playbackLog } from './lib/playbackLogger.js';

// Mirrors REMOUNT_STORM_MAX_MOUNTS / REMOUNT_STORM_WINDOW_MS in Player.jsx.
const MAX_MOUNTS = 10;
const WINDOW_MS = 30000;
const BASE_TIME = new Date('2026-08-16T11:32:00Z').getTime();

const stormLogs = () => playbackLog.mock.calls.filter(([event]) => event === 'player-remount-storm');

/** Re-render with new content and wait for that render to reach the child. */
const churn = async (rerender, contentId) => {
  const before = renders.length;
  rerender(<Player play={{ contentId }} />);
  await waitFor(() => expect(renders.length).toBeGreaterThan(before));
};

beforeEach(() => {
  mounts.length = 0;
  renders.length = 0;
  playbackLog.mockClear();
  // Only Date is faked — waitFor still needs real timers to make progress.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(BASE_TIME);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Player — remount storm brake', () => {
  it('stops rebuilding the player once key churn outruns the cap, and says so once', async () => {
    const { rerender } = render(<Player play={{ contentId: 'plex:900000' }} />);
    await waitFor(() => expect(mounts).toHaveLength(1));

    // Fifteen distinct keys inside the window, with the clock standing still.
    for (let i = 1; i < 15; i += 1) {
      await churn(rerender, `plex:${900000 + i}`);
    }

    expect(mounts).toHaveLength(MAX_MOUNTS);
    expect(stormLogs()).toHaveLength(1);
    expect(stormLogs()[0][2]).toMatchObject({ level: 'error' });
    expect(stormLogs()[0][1]).toMatchObject({ frozenKey: expect.any(String) });
  });

  it('leaves normal, spaced-out content changes alone', async () => {
    const { rerender } = render(<Player play={{ contentId: 'plex:910000' }} />);
    await waitFor(() => expect(mounts).toHaveLength(1));

    for (let i = 1; i < 15; i += 1) {
      vi.setSystemTime(BASE_TIME + i * 5000);
      await churn(rerender, `plex:${910000 + i}`);
    }

    expect(mounts).toHaveLength(15);
    expect(stormLogs()).toHaveLength(0);
  });

  it('re-arms one window after the trip so a viewer is never stranded', async () => {
    const { rerender } = render(<Player play={{ contentId: 'plex:920000' }} />);
    await waitFor(() => expect(mounts).toHaveLength(1));

    for (let i = 1; i < 15; i += 1) {
      await churn(rerender, `plex:${920000 + i}`);
    }
    expect(mounts).toHaveLength(MAX_MOUNTS);

    // The churn stops; one window later the next selection plays.
    vi.setSystemTime(BASE_TIME + WINDOW_MS + 1);
    await churn(rerender, 'plex:920999');

    await waitFor(() => expect(mounts).toHaveLength(MAX_MOUNTS + 1));
    expect(mounts.at(-1)).not.toBe(mounts.at(-2));
  });
});
