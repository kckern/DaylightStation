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

// Shared FitnessPlayer test harness (copied from FitnessPlayer.presenceGate.test.jsx).
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

// Playback budget cover (unattended-governed-playback). 2026-11-10: a child sat on
// "Checking playback allowance… Waiting for playback allowance" with no way
// forward. The cover now says what is happening and always offers the admin
// fingerprint unlock (same registerAdmin as the presence gate) and Back.
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
const budget = (status, extra = {}) => ({ blocked: true, status, remainingMs: 0, grantOverride: vi.fn(() => true), ...extra });

describe('FitnessPlayer playback budget cover', () => {
  beforeEach(() => { fixture.context.fitnessConfiguration = {}; });

  it.each([
    ['checking', 'Checking playback allowance…', /grown-up can unlock this video now/],
    ['unavailable', 'Playback allowance unavailable', /could not be read; trying again/],
    ['exhausted', 'Unattended playback limit reached', /join the workout to continue, or unlock/],
  ])('%s: explains itself and offers Unlock and Back (never a bare "waiting")', async (status, title, body) => {
    fixture.context.playbackBudget = budget(status);
    render(node());
    const cover = await screen.findByTestId('playback-budget-overlay');
    expect(cover.getAttribute('data-status')).toBe(status);
    expect(cover.textContent).toContain(title);
    expect(cover.textContent).toMatch(body);
    expect(cover.textContent).not.toContain('Waiting for playback allowance');
    expect(screen.getByTestId('playback-budget-unlock')).toBeVisible();
    expect(screen.getByTestId('playback-budget-back')).toBeVisible();
    expect(autoplay()).toBe('false');
  });

  it('Unlock asks for an admin fingerprint; a match lifts the budget for this item', async () => {
    const verdict = deferred();
    fixture.identity.registerAdmin = vi.fn(() => verdict.promise);
    fixture.context.playbackBudget = budget('checking');
    render(node());
    fireEvent.pointerDown(await screen.findByTestId('playback-budget-unlock'));
    expect(fixture.identity.registerAdmin).toHaveBeenCalledExactlyOnceWith('playback_budget');
    expect(screen.getByRole('dialog', { name: 'Fingerprint unlock' })).toBeVisible();
    expect(screen.queryByTestId('playback-budget-overlay')).toBeNull(); // the prompt is on top, not under the cover
    await act(async () => { verdict.resolve({ matched: true, userId: 'kckern' }); });
    expect(fixture.context.playbackBudget.grantOverride).toHaveBeenCalledExactlyOnceWith({ userId: 'kckern' });
    expect(fixture.identity.clearUnlock).toHaveBeenCalled();
  });

  it('a cancelled or failed fingerprint lifts nothing and puts the cover back', async () => {
    const verdict = deferred();
    fixture.identity.registerAdmin = vi.fn(() => verdict.promise);
    fixture.context.playbackBudget = budget('exhausted');
    render(node());
    fireEvent.pointerDown(await screen.findByTestId('playback-budget-unlock'));
    await act(async () => { verdict.resolve({ matched: false, reason: 'cancelled' }); });
    expect(fixture.context.playbackBudget.grantOverride).not.toHaveBeenCalled();
    expect(await screen.findByTestId('playback-budget-overlay')).toBeVisible();
  });

  it('a budget that is not blocking shows no cover', async () => {
    fixture.context.playbackBudget = { blocked: false, status: 'held', remainingMs: 0, grantOverride: vi.fn() };
    render(node());
    await waitFor(() => expect(screen.getByTestId('playback')).toBeTruthy());
    expect(screen.queryByTestId('playback-budget-overlay')).toBeNull();
  });
});
const autoplay = () => screen.getByTestId('playback').getAttribute('data-autoplay');
