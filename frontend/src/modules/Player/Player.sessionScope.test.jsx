/**
 * Player session scoping — two live Players never share one playback session.
 *
 * Since 2026-08-16 the media guid is derived from CONTENT (that is what stops a
 * re-rendering caller from remounting the video), which means two Players showing
 * the same lecture compute the same identity. Two Players CAN be mounted at once:
 * a menu selection mounts one on the nav stack — MenuWidget is a layout widget, so
 * it renders inside the overlay provider's children — while a media:play action
 * mounts a second in the fullscreen slot, and that action's dismissOverlay clears
 * only the overlay slot. If they shared `itemSessionKey` they would share the seek
 * intent behind usePlaybackSession (one consuming the other's resume position) and
 * the recovery ledger's attempt budget (either unmount wiping the survivor's cap).
 *
 * The discriminator has to be per INSTANCE, not per mount of the media element:
 * the five-attempt cap accumulates across remounts, and a remount happens below the
 * Player, so a ref seeded once is exactly the right lifetime. The second test pins
 * that lifetime — it is the assumption the whole scheme rests on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

// SinglePlayer is stubbed so the session key the Player hands down is observable,
// and so a MOUNT (the remount that a key change causes) can be counted directly.
const mounts = [];
const renders = [];

vi.mock('./components/SinglePlayer.jsx', async () => {
  const { useEffect } = await import('react');
  return {
    SinglePlayer: ({ resilienceSessionKey }) => {
      renders.push(resilienceSessionKey);
      useEffect(() => {
        mounts.push(resilienceSessionKey);
      }, []);
      return <div data-testid="single-player-stub" />;
    }
  };
});

vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.reject(new Error('offline in test')))
}));

import Player from './Player.jsx';

const instanceOf = (sessionKey) => String(sessionKey).split('#')[1];
const contentOf = (sessionKey) => String(sessionKey).split('#')[0];

beforeEach(() => {
  mounts.length = 0;
  renders.length = 0;
});

afterEach(() => {
  cleanup();
});

describe('Player — per-instance session scope', () => {
  it('gives two simultaneously mounted Players on the same content different item sessions', async () => {
    const { rerender } = render(
      <>
        <Player play={{ contentId: 'plex:694719' }} />
        <Player play={{ contentId: 'plex:694719' }} />
      </>
    );
    await waitFor(() => expect(mounts).toHaveLength(2));

    // The two Players must be telling the ledger and the playback session store
    // that they are different players …
    expect(mounts[0]).not.toBe(mounts[1]);
    expect(instanceOf(mounts[0])).toBeTruthy();
    expect(instanceOf(mounts[1])).toBeTruthy();
    // … while still agreeing about what is playing.
    expect(contentOf(mounts[0])).toBe(contentOf(mounts[1]));

    // Neither Player may pay for that isolation with a churning player key: a
    // re-render with equivalent-but-new literals must not remount either one.
    const rendersBeforeRerender = renders.length;
    rerender(
      <>
        <Player play={{ contentId: 'plex:694719' }} />
        <Player play={{ contentId: 'plex:694719' }} />
      </>
    );
    await waitFor(() => expect(renders.length).toBeGreaterThan(rendersBeforeRerender));
    expect(mounts).toHaveLength(2);
  });

  it('keeps one instance id across a remount, because the remount happens below the Player', async () => {
    const { rerender } = render(<Player play={{ contentId: 'plex:694719' }} />);
    await waitFor(() => expect(mounts).toHaveLength(1));

    // A content change remounts SinglePlayer (a second mount) while the Player
    // itself stays put — the lifetime the recovery ledger's attempt cap needs.
    rerender(<Player play={{ contentId: 'plex:694720' }} />);
    await waitFor(() => expect(mounts).toHaveLength(2));

    expect(contentOf(mounts[0])).not.toBe(contentOf(mounts[1]));
    expect(instanceOf(mounts[0])).toBeTruthy();
    expect(instanceOf(mounts[1])).toBe(instanceOf(mounts[0]));
  });
});
