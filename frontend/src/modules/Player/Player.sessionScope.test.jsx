/**
 * Player session scoping — two live Players never share one playback session.
 *
 * Since 2026-08-16 the media guid is derived from CONTENT (that is what stops a
 * re-rendering caller from remounting the video), which means two Players showing
 * the same lecture compute the same identity. Two Players CAN still be mounted at
 * once in composite/preview surfaces and tests, even though screen-framework media
 * overlays now suspend the MenuWidget nav stack to forbid two audible top-level
 * Players. If legitimate simultaneous Players shared `itemSessionKey`, they would
 * share the seek intent behind usePlaybackSession (one consuming the other's resume
 * position) and the recovery ledger's attempt budget (either unmount wiping the
 * survivor's cap).
 *
 * The discriminator has to be per INSTANCE, not per mount of the media element:
 * the five-attempt cap accumulates across remounts, and a remount happens below the
 * Player, so a ref seeded once is exactly the right lifetime. The second test pins
 * that lifetime — it is the assumption the whole scheme rests on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, act } from '@testing-library/react';

// SinglePlayer is stubbed so the session keys the Player hands down are observable,
// and so a MOUNT (the remount that a key change causes) can be counted directly.
const mounts = [];
const renders = [];
const clientSessions = [];
const volumeFrames = [];

vi.mock('./components/SinglePlayer.jsx', async () => {
  const { useEffect } = await import('react');
  return {
    SinglePlayer: ({ resilienceSessionKey, plexClientSession, volume, setVolume }) => {
      renders.push(resilienceSessionKey);
      volumeFrames.push({ volume, setVolume });
      useEffect(() => {
        mounts.push(resilienceSessionKey);
        clientSessions.push(plexClientSession);
        // deliberately empty deps: this counts MOUNTS ONLY (the test's whole purpose, see docblock above)
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
  clientSessions.length = 0;
  volumeFrames.length = 0;
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

  it('presents two simultaneously mounted Players as two Plex sessions', async () => {
    // `?session=` is inert server-side today — PlexAdapter mints its own identifiers
    // and nothing reads the query param. Threading it end-to-end is the obvious next
    // observability step, and on that day a content-derived value would hand Plex one
    // identifier for two independent streams (two Players here, two devices playing
    // the same title in the field). Pinned now so wiring it later stays safe.
    render(
      <>
        <Player play={{ contentId: 'plex:694719' }} />
        <Player play={{ contentId: 'plex:694719' }} />
      </>
    );
    await waitFor(() => expect(clientSessions).toHaveLength(2));

    expect(clientSessions[0]).toBeTruthy();
    expect(clientSessions[1]).toBeTruthy();
    expect(clientSessions[0]).not.toBe(clientSessions[1]);
  });

  it('restores a volume override on a later mount of the same content', async () => {
    // The instance discriminator belongs on `itemSessionKey` ONLY. `prefsSessionKey`
    // carries volume, which is a user preference and is meant to outlive the Player
    // that set it — leave and come back to the same lecture inside one page session
    // and the volume you chose is still there. Putting the instance id on this key
    // too would mint a fresh entry per mount and silently drop the override back to
    // the default, with nothing failing to say so.
    const first = render(<Player play={{ contentId: 'plex:555001' }} />);
    await waitFor(() => expect(volumeFrames.length).toBeGreaterThan(0));
    expect(volumeFrames.at(-1).volume).toBe(1);

    await act(async () => {
      volumeFrames.at(-1).setVolume(0.35);
    });
    await waitFor(() => expect(volumeFrames.at(-1).volume).toBe(0.35));

    first.unmount();
    volumeFrames.length = 0;

    render(<Player play={{ contentId: 'plex:555001' }} />);
    await waitFor(() => expect(volumeFrames.length).toBeGreaterThan(0));
    expect(volumeFrames.at(-1).volume).toBe(0.35);
  });

  it('hands an externally supplied session through untouched', async () => {
    // FitnessMusicPlayer already mints its own (`fitness-music-<guid>`); it is unique
    // by construction and must reach the renderer character for character.
    const external = 'fitness-music-abc123';
    render(<Player play={{ contentId: 'plex:694719' }} plexClientSession={external} />);
    await waitFor(() => expect(clientSessions).toHaveLength(1));

    expect(clientSessions[0]).toBe(external);
  });
});
