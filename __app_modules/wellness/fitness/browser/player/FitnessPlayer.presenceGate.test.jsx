import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';

const fixture = vi.hoisted(() => ({ presence: null, context: null, identity: null, duck: 1, cueAudio: null, videoVolume: null, playerHandle: null }));
vi.mock('../context/FitnessContext.jsx', () => ({ useFitness: () => fixture.context, useFitnessContext: () => fixture.context }));
vi.mock('../identity/useIdentity.js', () => ({ useIdentity: () => fixture.identity }));
vi.mock('@/lib/kioskEnv.js', () => ({ isKioskEnv: () => true }));
vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async () => ({})),
  DaylightMediaPath: (path) => path,
  DaylightImagePath: (path) => path,
}));
vi.mock('@/lib/logging/Logger.js', () => {
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() };
  logger.child = () => logger;
  return { default: () => logger, getLogger: () => logger };
});
// Playback is the external boundary: expose the actual player's autoplay decision
// without loading streaming media, and use its advance callback for item changes.
vi.mock('../../../../media/media/browser/playback.mjs', () => ({
  Player: React.forwardRef(({ play, advance, onProgress }, ref) => {
    React.useImperativeHandle(ref, () => fixture.playerHandle, [fixture.playerHandle]);
    return (
    <div data-testid="playback" data-autoplay={String(play.autoplay)} data-content-id={play.contentId}>
      <button onClick={advance}>Advance playback</button>
      <button onClick={() => onProgress({ currentTime: 1, duration: 600, paused: false })}>Playback progress</button>
    </div>
  );
  }),
}));
vi.mock('../../../../../__capabilities/playback/browser/controller.mjs', () => ({
  usePlayerController: () => ({ seek: vi.fn(), getCurrentTime: () => 0, getDuration: () => 600, pause: vi.fn(), play: vi.fn() }),
}));
vi.mock('../../../../../__capabilities/screen-host/browser/data.mjs', () => ({ useScreenDataRefetch: () => null }));
// These panels own unrelated chart/demo dependencies, including recharts. The real
// FitnessPlayer, pause arbiter, progress enforcer, frame, and UnlockPrompt stay live.
vi.mock('./FitnessSidebar.jsx', () => ({ default: () => null }));
vi.mock('./FitnessPlayerFooter.jsx', () => ({ default: React.forwardRef(() => null) }));
// Keep the real cycling lock, resolver and unlock control; isolate only the unused demo.
vi.mock('../widgets/CycleChallengeDemo/CycleChallengeDemo.jsx', () => ({ default: () => null }));
// No overlay app is open; avoid initializing the unrelated widget registry.
vi.mock('./FitnessModuleContainer.jsx', () => ({ default: () => null }));
vi.mock('./overlays/GovernanceAudioPlayer.jsx', () => ({
  default: ({ trackKey }) => <audio aria-label={`Governance cue ${trackKey}`} />,
}));
vi.mock('../widgets/FitnessChart/index.jsx', () => ({ default: () => null }));
vi.mock('./SessionCameraCapture.jsx', () => ({ default: () => null }));
vi.mock('../hooks/fitness/usePlayerFrameCapture.js', () => ({ default: () => {} }));
vi.mock('../hooks/fitness/useRenderProfiler.js', () => ({ useRenderProfiler: () => {} }));
vi.mock('../hooks/fitness/useContentMode.js', () => ({ default: () => ({ resolved: true, captureDisabled: false, studyUx: false }) }));
vi.mock('../components/useMediaAmplifier.js', () => ({ useMediaAmplifier: () => ({ boostLevel: 1, setBoost: vi.fn() }) }));
vi.mock('../nav/useFitnessVolumeControls.js', () => ({ useFitnessVolumeControls: () => ({ videoVolume: fixture.videoVolume }) }));
// Cue element is the browser-media boundary; the real duck hook owns volume changes.
vi.mock('./hooks/audioCuePlayer.js', () => ({
  installCueAudioUnlock: () => () => {},
  getCueAudioElement: () => fixture.cueAudio,
  isCueAudioUnlocked: () => true,
}));


import FitnessPlayer from './FitnessPlayer.jsx';
import { DaylightAPI } from '@/lib/api.mjs';
import { __resetPresenceGateStore, refreshPresence } from '../hooks/usePresenceGate.js';

// Presence gate (fitness config `presence_gate`) at the player: starting an
// item while the supervising adult is away needs an admin fingerprint; an item
// already playing is never interrupted when he leaves.
const ITEM = { id: 'episode-1', plex: '1001', contentId: 'plex:1001', title: 'Episode', duration: 600, mediaUrl: '/test/e1.mp4' };
const NEXT = { ...ITEM, id: 'episode-2', plex: '1002', contentId: 'plex:1002', mediaUrl: '/test/e2.mp4' };
const UNGOVERNED = { isGoverned: false, status: null, videoLocked: false, challenge: null, deadline: null, requirements: [] };
const GATE_CFG = { enabled: true, entity: 'binary_sensor.adult_home', gate: ['play', 'show'], unlock_minutes: 30 };
const presence = (home, extra = {}) => ({ enabled: true, home, state: home ? 'on' : 'off', reason: null, ...extra });

const node = (items = [ITEM]) => <MemoryRouter><FitnessPlayer playQueue={items} setPlayQueue={vi.fn()} /></MemoryRouter>;
const presenceCalls = () => DaylightAPI.mock.calls.filter(([url]) => String(url).includes('/fitness/presence'));

beforeEach(() => {
  __resetPresenceGateStore();
  DaylightAPI.mockReset();
  DaylightAPI.mockImplementation(async (url) => {
    if (String(url).includes('/fitness/presence')) {
      if (fixture.presence instanceof Error) throw fixture.presence;
      return fixture.presence;
    }
    return {};
  });
  fixture.presence = presence(true);
  fixture.playerHandle = null;
  fixture.cueAudio = new EventTarget();
  fixture.cueAudio.play = vi.fn(async () => {});
  fixture.cueAudio.pause = vi.fn();
  fixture.videoVolume = { volume: 1, volumeRef: { current: 1 }, setDuck: () => {} };
  fixture.identity = {
    registerUnlock: vi.fn(() => new Promise(() => {})),
    registerAdmin: vi.fn(() => new Promise(() => {})),
    clearUnlock: vi.fn(), unlockState: 'scanning', phase: 'normal',
  };
  fixture.context = {
    fitnessConfiguration: { presence_gate: GATE_CFG },
    governanceState: UNGOVERNED, participantRoster: [], voiceMemos: [],
    voiceMemoOverlayState: { open: false }, participantDisplayMap: new Map(), zoneMetadata: {},
    activeHeartRateParticipants: [], zones: [], overlayApp: null, closeApp: vi.fn(),
    getDisplayName: (uid) => ({ displayName: uid }), pauseMusicPlayer: vi.fn(),
    setVideoPlayerPaused: vi.fn(), setGovernanceMedia: vi.fn(), setCurrentMedia: vi.fn(),
    trackRecentlyPlayed: vi.fn(), emitAppEvent: vi.fn(), setCaptureDisabled: vi.fn(), registerVideoPlayer: vi.fn(),
  };
});
afterEach(() => { cleanup(); __resetPresenceGateStore(); });

const autoplay = () => screen.getByTestId('playback').getAttribute('data-autoplay');

describe('FitnessPlayer presence gate', () => {
  it('no presence_gate config → plays as today and never asks for presence', async () => {
    fixture.context.fitnessConfiguration = {};
    render(node());
    await waitFor(() => expect(autoplay()).toBe('true'));
    expect(presenceCalls()).toHaveLength(0);
    expect(fixture.identity.registerAdmin).not.toHaveBeenCalled();
  });

  it('enabled:false → no gate, no presence request', async () => {
    fixture.context.fitnessConfiguration = { presence_gate: { ...GATE_CFG, enabled: false } };
    render(node());
    await waitFor(() => expect(autoplay()).toBe('true'));
    expect(presenceCalls()).toHaveLength(0);
  });

  it('adult home → plays, no prompt', async () => {
    render(node());
    await waitFor(() => expect(autoplay()).toBe('true'));
    expect(presenceCalls().length).toBeGreaterThan(0);
    expect(fixture.identity.registerAdmin).not.toHaveBeenCalled();
  });

  it('adult away → held and the admin unlock prompt opens', async () => {
    fixture.presence = presence(false);
    render(node());
    await waitFor(() => expect(fixture.identity.registerAdmin).toHaveBeenCalledExactlyOnceWith('presence_gate'));
    expect(autoplay()).toBe('false');
    expect(screen.getByRole('dialog', { name: 'Fingerprint unlock' })).toBeVisible();
  });

  it.each([
    ['unknown', presence(false, { state: 'unknown', reason: 'unavailable' })],
    ['unavailable', presence(false, { state: 'unavailable', reason: 'unavailable' })],
    ['fetch failure', new Error('network')],
  ])('sensor %s → gated (fail closed)', async (_label, value) => {
    fixture.presence = value;
    render(node());
    await waitFor(() => expect(fixture.identity.registerAdmin).toHaveBeenCalled());
    expect(autoplay()).toBe('false');
  });

  it('admin unlock → plays, and the grant covers the next item too', async () => {
    fixture.presence = presence(false);
    let resolveScan;
    fixture.identity.registerAdmin = vi.fn(() => new Promise((resolve) => { resolveScan = resolve; }));
    render(node([ITEM, NEXT]));
    await waitFor(() => expect(fixture.identity.registerAdmin).toHaveBeenCalled());
    await act(async () => resolveScan({ matched: true, userId: 'parent' }));
    await waitFor(() => expect(autoplay()).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: 'Advance playback' }));
    await waitFor(() => expect(screen.getByTestId('playback')).toHaveAttribute('data-content-id', 'plex:1002'));
    expect(autoplay()).toBe('true');
    expect(fixture.identity.registerAdmin).toHaveBeenCalledTimes(1);
  });

  it('adult leaves mid-video → the playing item is not interrupted; the next item is gated', async () => {
    render(node([ITEM, NEXT]));
    await waitFor(() => expect(autoplay()).toBe('true'));
    fixture.presence = presence(false);
    await act(async () => { await refreshPresence(); });
    expect(autoplay()).toBe('true');
    expect(fixture.context.setVideoPlayerPaused).not.toHaveBeenCalledWith(true);
    expect(fixture.identity.registerAdmin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Advance playback' }));
    await waitFor(() => expect(screen.getByTestId('playback')).toHaveAttribute('data-content-id', 'plex:1002'));
    expect(autoplay()).toBe('false');
    await waitFor(() => expect(fixture.identity.registerAdmin).toHaveBeenCalledWith('presence_gate'));
  });

  it('adult comes home while the prompt is up → released without a scan', async () => {
    fixture.presence = presence(false);
    render(node());
    await waitFor(() => expect(fixture.identity.registerAdmin).toHaveBeenCalled());
    fixture.presence = presence(true);
    await act(async () => { await refreshPresence(); });
    await waitFor(() => expect(autoplay()).toBe('true'));
    expect(fixture.identity.clearUnlock).toHaveBeenCalled();
  });
});
