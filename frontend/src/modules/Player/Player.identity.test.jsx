/**
 * Player media identity — a source is identified by its CONTENT, not its object identity.
 *
 * On 2026-08-16 the piano kiosk opened 495 Plex transcode sessions in four minutes for
 * one lecture. The Player identified a source by OBJECT IDENTITY (a WeakMap keyed on the
 * object), so a caller that rebuilt an equivalent `play` literal on re-render minted a new
 * media guid, which changed `singlePlayerKey`, which fully remounted SinglePlayer, which
 * opened a fresh transcode session. The same churn reset `remountState.nonce` to 0 on every
 * pass, so the remount backoff and the five-attempt cap never engaged.
 *
 * These tests pin the property that was violated. SinglePlayer is stubbed so a MOUNT is
 * observable directly — a mount is the remount, and the remount is what opened the session.
 * `plexClientSession` is asserted alongside it because that string is what actually reaches
 * Plex as the session identifier.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

// Every mount appends its plexClientSession here; every render appends to `renders`.
// Mount count is the assertion that matters: React only remounts when the `key` changes.
const mounts = [];
const renders = [];

vi.mock('./components/SinglePlayer.jsx', async () => {
  const { useEffect } = await import('react');
  return {
    SinglePlayer: ({ plexClientSession }) => {
      renders.push(plexClientSession);
      useEffect(() => {
        mounts.push(plexClientSession);
        // deliberately empty deps: this counts MOUNTS ONLY (the test's whole purpose, see docblock above)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return <div data-testid="single-player-stub" />;
    }
  };
});

// The Player and its queue controller both hit the config/queue endpoints on mount.
// Reject so `playQueue` stays empty and `activeSource` remains the `play` prop itself,
// which is the single-item path the piano kiosk uses.
vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.reject(new Error('offline in test')))
}));

import Player from './Player.jsx';

beforeEach(() => {
  mounts.length = 0;
  renders.length = 0;
});

afterEach(() => {
  cleanup();
});

describe('Player — media identity is derived from content', () => {
  it('does not remount when the caller hands it a fresh but equivalent play literal', async () => {
    const { rerender } = render(<Player play={{ contentId: 'plex:694719' }} />);
    await waitFor(() => expect(mounts).toHaveLength(1));
    const firstSession = mounts[0];
    expect(firstSession).toBeTruthy();

    // Baseline the count before re-rendering. Mounting alone renders the stub three
    // times as effects settle, so an absolute threshold like `renders.length > 1`
    // already holds here and would wait on a condition the re-render never has to
    // satisfy — leaving the mount assertion below to pass without proof that the
    // re-render reached the child at all.
    const rendersBeforeRerender = renders.length;

    // A different object carrying the same content — the exact shape PianoVideoPlayer
    // produced on every poll tick, and the shape SingalongPlayer still produces.
    rerender(<Player play={{ contentId: 'plex:694719' }} />);
    await waitFor(() => expect(renders.length).toBeGreaterThan(rendersBeforeRerender));

    expect(mounts).toHaveLength(1);
    expect(renders.at(-1)).toBe(firstSession);
  });

  it('does remount when the content actually changes', async () => {
    const { rerender } = render(<Player play={{ contentId: 'plex:694719' }} />);
    await waitFor(() => expect(mounts).toHaveLength(1));
    const firstSession = mounts[0];

    rerender(<Player play={{ contentId: 'plex:694720' }} />);
    await waitFor(() => expect(mounts).toHaveLength(2));

    expect(mounts[1]).not.toBe(firstSession);
  });
});
