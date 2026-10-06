// frontend/src/modules/Media/session/PlayerBridge.origin.test.jsx
// The play/log origin: a routine or another device that started the item
// rides the Player's play prop (and so play/log); a person here does not.
// Harness copied from PlayerBridge.test.jsx
// Guards the PlayerBridge header contract: "The tree shape is identical
// whether hidden or portal-hosted, so navigating to/from Now Playing never
// remounts the Player (audio continues across all views)."
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { PlayerHostProvider } from './PlayerHostProvider.jsx';
import { LocalSessionContext } from './LocalSessionContext.js';
import { createLocalSessionController } from './LocalSessionController.js';
import { applyCommandEnvelope } from '../externalControl/commandHandler.js';

// Count how many times the platform Player is actually mounted. A remount is
// what destroys the media element mid-play() and produces the browser's
// "The play() request was interrupted because the media was removed from the
// document" AbortError.
const mountSpy = vi.fn();
let latestPlayerProps = null;
let mediaElement = null;
let mountedContentId = null;
let mountedMediaGeneration = 0;
let appliedShader = null;
let mountedMediaRegistration = null;
let mountedOperationObserver = null;
let beginRendererBoundary = null;
vi.mock('../../Player/Player.jsx', () => ({
  default: React.forwardRef(function MockPlayer(props, ref) {
    latestPlayerProps = props;
    React.useImperativeHandle(ref, () => ({
      play: () => mediaElement?.play?.(),
      pause: () => mediaElement?.pause?.(),
      seek: (seconds) => { if (mediaElement) mediaElement.currentTime = seconds; },
      setPlaybackRate: (rate) => { if (mediaElement) mediaElement.playbackRate = rate; },
      setShader: (shader) => { appliedShader = shader; },
      getMediaElement: () => mediaElement,
      getMountedContentId: () => mountedContentId,
      getMountedMediaGeneration: () => mountedMediaGeneration,
      getMountedMediaRegistration: () => mountedMediaRegistration,
      subscribeMountedMediaOperations: (observer) => {
        mountedOperationObserver = observer;
        return { observerId: 'media-player-bridge', unsubscribe: () => { mountedOperationObserver = null; } };
      },
      beginRendererBoundary: (request) => beginRendererBoundary?.(request) ?? { ok: true, operationId: request.operationId },
    }));
    React.useEffect(() => { mountSpy(); }, []);
    return <audio data-testid="mock-player" />;
  }),
}));

// Imported after the mock so PlayerBridge picks up the mocked Player.
const { PlayerBridge } = await import('./PlayerBridge.jsx');


function makeRealController() {
  return createLocalSessionController({
    clientId: 'bridge-client',
    randomUuid: () => 'bridge-session',
    nowFn: () => new Date('2026-09-14T00:00:00.000Z'),
  });
}

function Harness({ controller }) {
  return (
    <LocalSessionContext.Provider value={{ controller }}>
      <PlayerHostProvider>
        <PlayerBridge />
      </PlayerHostProvider>
    </LocalSessionContext.Provider>
  );
}

describe('PlayerBridge play/log origin', () => {
  beforeEach(() => { latestPlayerProps = null; mountSpy.mockClear(); });

  it('passes a routine origin from the command that started the item', () => {
    const controller = makeRealController();
    render(<Harness controller={controller} />);
    act(() => {
      expect(applyCommandEnvelope(controller, {
        commandId: 'routine-play-1',
        command: 'queue',
        params: { op: 'play-now', contentId: 'plex:routine', clearRest: true },
        origin: { kind: 'routine', id: 'automation:kitchen_button_1', name: 'Kitchen Button 1' },
        ts: '2026-09-14T00:00:00.000Z',
      })).toEqual({ ok: true });
    });
    expect(latestPlayerProps.play.contentId).toBe('plex:routine');
    expect(latestPlayerProps.play.origin).toEqual({ kind: 'routine', id: 'automation:kitchen_button_1', name: 'Kitchen Button 1' });
  });

  it('reports no origin for a person playing on this device', () => {
    const controller = makeRealController();
    render(<Harness controller={controller} />);
    act(() => { controller.queue.playNow({ contentId: 'plex:here', title: 'Here' }, { clearRest: true }); });
    expect(latestPlayerProps.play.contentId).toBe('plex:here');
    expect(latestPlayerProps.play).not.toHaveProperty('origin');
  });
});
