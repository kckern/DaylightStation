// frontend/src/modules/Media/session/PlayerBridge.test.jsx
// Guards the PlayerBridge header contract: "The tree shape is identical
// whether hidden or portal-hosted, so navigating to/from Now Playing never
// remounts the Player (audio continues across all views)."
import React, { useRef, useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { PlayerHostProvider } from './PlayerHostProvider.jsx';
import { LocalSessionContext } from './LocalSessionContext.js';
import { usePlayerHost } from './usePlayerHost.js';

// Count how many times the platform Player is actually mounted. A remount is
// what destroys the media element mid-play() and produces the browser's
// "The play() request was interrupted because the media was removed from the
// document" AbortError.
const mountSpy = vi.fn();
vi.mock('../../Player/Player.jsx', () => ({
  default: React.forwardRef(function MockPlayer(_props, _ref) {
    React.useEffect(() => { mountSpy(); }, []);
    return <audio data-testid="mock-player" />;
  }),
}));

// Imported after the mock so PlayerBridge picks up the mocked Player.
const { PlayerBridge } = await import('./PlayerBridge.jsx');

function makeController() {
  const snapshot = {
    currentItem: {
      contentId: 'plex:592837',
      title: 'Faith (Music)',
      format: 'audio',
      duration: 1729,
      thumbnail: null,
    },
    position: 0,
    config: { volume: 100 },
    state: 'loading',
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    setPlayerHandle: () => {},
    onPlayerEnded: () => {},
    onPlayerStateChange: () => {},
    onPlayerStalled: () => {},
    onPlayerPositionTick: () => {},
    onPlayerProgress: () => {},
  };
}

// A view that claims the Player host, mirroring NowPlayingView (priority 2).
function HostClaimant() {
  const ref = useRef(null);
  usePlayerHost(ref, 2);
  return <div ref={ref} data-testid="np-host" />;
}

function Harness({ controller }) {
  const [showHost, setShowHost] = useState(false);
  return (
    <LocalSessionContext.Provider value={{ controller }}>
      <PlayerHostProvider>
        <button type="button" data-testid="toggle" onClick={() => setShowHost((v) => !v)}>
          toggle
        </button>
        {showHost ? <HostClaimant /> : null}
        <PlayerBridge />
      </PlayerHostProvider>
    </LocalSessionContext.Provider>
  );
}

describe('PlayerBridge host transitions', () => {
  beforeEach(() => { mountSpy.mockClear(); });

  it('does not remount the Player when a view claims the host', () => {
    // Reproduces the 2026-08-16 mobile session: an audio track is dispatched
    // while no view holds a host claim, so the Player mounts into the
    // off-screen park (left:-10000px). A host claim then arrives.
    const { getByTestId } = render(<Harness controller={makeController()} />);
    expect(mountSpy).toHaveBeenCalledTimes(1);

    act(() => { getByTestId('toggle').click(); });

    // Contract: the Player moves into the host without being torn down.
    expect(mountSpy).toHaveBeenCalledTimes(1);
  });

  it('does not remount the Player when the host claim is released', () => {
    const { getByTestId } = render(<Harness controller={makeController()} />);
    act(() => { getByTestId('toggle').click(); });
    mountSpy.mockClear();

    act(() => { getByTestId('toggle').click(); });

    expect(mountSpy).toHaveBeenCalledTimes(0);
  });
});
