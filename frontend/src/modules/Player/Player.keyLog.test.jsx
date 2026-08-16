/**
 * Player key-change logging — Tier 1.3.
 *
 * During the 2026-08-16 storm the frontend recorded three `player-remount`
 * events while roughly three hundred remounts happened. The other ~297 came
 * through `singlePlayerKey`, and nothing on that path said a word; the real
 * count had to be recovered from Plex's own server log. These tests pin the
 * line that closes that gap, and in particular pin `changedComponent` — without
 * it a key diff cannot tell a content change apart from a recovery loop, which
 * is the distinction the whole incident turned on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

const renders = [];
const sampled = [];

vi.mock('./components/SinglePlayer.jsx', async () => {
  const { useEffect } = await import('react');
  return {
    SinglePlayer: ({ plexClientSession }) => {
      useEffect(() => {}, []);
      renders.push(plexClientSession);
      return <div data-testid="single-player-stub" />;
    }
  };
});

vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.reject(new Error('offline in test')))
}));

// The storm log is a neighbour of the event under test; recording playbackLog
// keeps it assertable while muting the rest of the player's chatter.
vi.mock('./lib/playbackLogger.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, playbackLog: vi.fn() };
});

// Defined inside the factory: vi.mock is hoisted above every const in the file.
vi.mock('../../lib/logging/Logger.js', () => {
  const stub = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    log: () => {},
    sampled: (event, data, options) => { sampled.push({ event, data, options }); },
    child: () => stub
  };
  return { __esModule: true, getLogger: () => stub, default: () => stub };
});

import Player from './Player.jsx';
import { playbackLog } from './lib/playbackLogger.js';

const MAX_MOUNTS = 10; // mirrors REMOUNT_STORM_MAX_MOUNTS in Player.jsx
const BASE_TIME = new Date('2026-08-16T11:32:00Z').getTime();

const keyChanges = () => sampled.filter((s) => s.event === 'playback.player-key-changed');
const stormLogs = () => playbackLog.mock.calls.filter(([event]) => event === 'player-remount-storm');

const churn = async (rerender, contentId) => {
  const before = renders.length;
  rerender(<Player play={{ contentId }} />);
  await waitFor(() => expect(renders.length).toBeGreaterThan(before));
};

beforeEach(() => {
  renders.length = 0;
  sampled.length = 0;
  playbackLog.mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(BASE_TIME);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Player — key change logging', () => {
  it('says which input re-keyed the player, and what the key was on each side', async () => {
    const { rerender } = render(<Player play={{ contentId: 'plex:800000' }} />);
    await waitFor(() => expect(renders.length).toBeGreaterThan(0));

    vi.setSystemTime(BASE_TIME + 5000);
    await churn(rerender, 'plex:800001');

    await waitFor(() => expect(keyChanges().length).toBeGreaterThan(0));
    const change = keyChanges().at(-1);
    expect(change.data.changedComponent).toBe('guid');
    expect(typeof change.data.from).toBe('string');
    expect(typeof change.data.to).toBe('string');
    expect(change.data.from).not.toBe(change.data.to);
    // The nonce half of the key is the only half `player-remount` ever covered,
    // so the guid half has to be readable straight off this line.
    expect(change.data.to.endsWith(':0')).toBe(true);
  });

  it('is rate limited, because the failure it instruments is a storm', async () => {
    const { rerender } = render(<Player play={{ contentId: 'plex:810000' }} />);
    await waitFor(() => expect(renders.length).toBeGreaterThan(0));
    vi.setSystemTime(BASE_TIME + 5000);
    await churn(rerender, 'plex:810001');

    await waitFor(() => expect(keyChanges().length).toBeGreaterThan(0));
    expect(keyChanges().at(-1).options).toMatchObject({ maxPerMinute: 20, aggregate: true });
  });

  it('stays quiet when a re-render leaves the key alone', async () => {
    const { rerender } = render(<Player play={{ contentId: 'plex:820000' }} />);
    await waitFor(() => expect(renders.length).toBeGreaterThan(0));
    const before = keyChanges().length;

    // An equivalent play literal: same content, so the key does not move.
    await churn(rerender, 'plex:820000');
    expect(keyChanges()).toHaveLength(before);
  });

  it('logs only admitted keys, so the storm brake is not counted twice', async () => {
    const { rerender } = render(<Player play={{ contentId: 'plex:830000' }} />);
    await waitFor(() => expect(renders.length).toBeGreaterThan(0));

    for (let i = 1; i < 15; i += 1) {
      await churn(rerender, `plex:${830000 + i}`);
    }

    expect(stormLogs()).toHaveLength(1);
    // Ten admitted keys means nine transitions between them. The four rejected
    // keys are already reported by `player-remount-storm`; re-reporting them
    // here would inflate exactly the count a diagnostician came for.
    expect(keyChanges()).toHaveLength(MAX_MOUNTS - 1);
    expect(keyChanges().every((c) => c.data.changedComponent === 'guid')).toBe(true);
  });
});
