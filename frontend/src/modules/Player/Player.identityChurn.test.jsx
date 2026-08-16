/**
 * Player identity-churn detection — Task 4.8.
 *
 * The counter is unit-tested in lib/identityChurn.test.js. What these tests pin
 * is the wiring: that the Player actually feeds it, that a churn burst produces
 * exactly one warn, and that the line carries a COUNT — which is the one thing
 * the storm brake's own `frozenKey`/`rejectedKey` pair cannot give you. A pair
 * of samples says churn is happening; on 2026-08-16 the width was the diagnosis.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

const renders = [];
const warns = [];

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

vi.mock('./lib/playbackLogger.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, playbackLog: vi.fn() };
});

// Defined inside the factory: vi.mock is hoisted above every const in the file.
vi.mock('../../lib/logging/Logger.js', () => {
  const stub = {
    debug: () => {},
    info: () => {},
    warn: (event, data) => { warns.push({ event, data }); },
    error: () => {},
    log: () => {},
    sampled: () => {},
    child: () => stub
  };
  return { __esModule: true, getLogger: () => stub, default: () => stub };
});

import Player from './Player.jsx';
import { playbackLog } from './lib/playbackLogger.js';
import { CHURN_DISTINCT_THRESHOLD } from './lib/identityChurn.js';

const BASE_TIME = new Date('2026-08-16T11:32:00Z').getTime();

const churnLines = () => warns.filter((w) => w.event === 'playback.identity-churn');

const churn = async (rerender, contentId) => {
  const before = renders.length;
  rerender(<Player play={{ contentId }} />);
  await waitFor(() => expect(renders.length).toBeGreaterThan(before));
};

beforeEach(() => {
  renders.length = 0;
  warns.length = 0;
  playbackLog.mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(BASE_TIME);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Player — identity churn detection', () => {
  it('says nothing while the caller keeps handing it the same content', async () => {
    const { rerender } = render(<Player play={{ contentId: 'plex:900000' }} />);
    await waitFor(() => expect(renders.length).toBeGreaterThan(0));

    for (let i = 0; i < 20; i += 1) {
      await churn(rerender, 'plex:900000');
    }
    expect(churnLines()).toHaveLength(0);
  });

  it('flags a cardinality explosion exactly once, naming both churning halves', async () => {
    const { rerender } = render(<Player play={{ contentId: 'plex:910000' }} />);
    await waitFor(() => expect(renders.length).toBeGreaterThan(0));

    for (let i = 1; i <= 40; i += 1) {
      await churn(rerender, `plex:${910000 + i}`);
    }

    // One line for the whole burst. Forty would be a second storm.
    expect(churnLines()).toHaveLength(1);
    const line = churnLines()[0].data;
    expect(line.churningDimensions).toEqual(['waitKey', 'guid']);
    expect(line.distinct.waitKey).toBeGreaterThan(CHURN_DISTINCT_THRESHOLD);
    expect(line.distinct.guid).toBeGreaterThan(CHURN_DISTINCT_THRESHOLD);
    expect(line.samples.waitKey.length).toBeGreaterThan(0);
  });

  it('reports a COUNT, which is what the storm brake\'s own log cannot give you', async () => {
    // The brake freezes the key after 10 admitted mounts and logs `frozenKey` /
    // `rejectedKey` — a pair of samples. A pair says churn is happening; it does
    // not say how wide. On 2026-08-16 the width (480 distinct in three minutes)
    // was the diagnosis, and it had to be uniq'd out of a log by hand.
    const { rerender } = render(<Player play={{ contentId: 'plex:920000' }} />);
    await waitFor(() => expect(renders.length).toBeGreaterThan(0));

    for (let i = 1; i <= 30; i += 1) {
      await churn(rerender, `plex:${920000 + i}`);
    }

    // The brake is on...
    expect(playbackLog.mock.calls.filter(([e]) => e === 'player-remount-storm')).toHaveLength(1);
    // ...and the churn line carries the number the brake's log never had, for
    // the guid half that `player-remount` never covered at all.
    expect(churnLines()).toHaveLength(1);
    const line = churnLines()[0].data;
    expect(line.churningDimensions).toContain('guid');
    expect(typeof line.distinct.guid).toBe('number');
    expect(line.distinct.guid).toBeGreaterThan(CHURN_DISTINCT_THRESHOLD);
  });
});
