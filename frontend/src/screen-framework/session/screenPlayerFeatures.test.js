import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createScreenPlayerFeatures } from './screenPlayerFeatures.js';
import { createScreenSessionControls } from './screenSessionControls.js';
import { validateSessionControls } from '@shared-contracts/media/sessionControls.mjs';

const playing = (contentId = 'plex:1', state = 'playing') => ({
  state, position: 120, currentItem: { contentId, title: 'Film', queueItemId: 'q1' },
  queue: { currentIndex: 0, items: [{ contentId, title: 'Film', queueItemId: 'q1' }, { contentId: 'plex:2', queueItemId: 'q2' }] },
});
const doorbell = { kind: 'routine', name: 'Doorbell' };

function setup(snapshot = playing()) {
  let current = snapshot;
  const ports = {
    getSnapshot: () => current,
    pausePlayback: vi.fn(),
    resumePlayback: vi.fn(),
    restoreSnapshot: vi.fn(async () => ({ ok: true })),
    setTracks: vi.fn(() => ({ ok: true })),
    musicCommand: vi.fn(() => ({ ok: true })),
  };
  const features = createScreenPlayerFeatures({ ownerId: 'livingroom-tv', ports });
  return { features, ports, setSnapshot: (s) => { current = s; } };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

describe('Show briefly (PLAY.8a)', () => {
  it('puts the camera over what is playing and says what interrupted and from where (AC1, AC3)', () => {
    const { features, ports } = setup();
    expect(features.beginBrief({ kind: 'camera', cameraId: 'doorbell', title: 'Front door', origin: doorbell, seconds: 30 }).ok).toBe(true);
    expect(ports.pausePlayback).toHaveBeenCalledTimes(1);
    expect(features.toPublished().brief).toMatchObject({
      kind: 'camera', cameraId: 'doorbell', label: 'Front door · from Doorbell', remainingSeconds: 30,
      returnTo: { contentId: 'plex:1', title: 'Film' },
    });
  });

  it('time running out returns the programme at its spot (AC2)', async () => {
    const { features, ports } = setup();
    features.beginBrief({ kind: 'camera', cameraId: 'doorbell', origin: doorbell, seconds: 30 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(features.toPublished().brief).toBeNull();
    expect(ports.resumePlayback).toHaveBeenCalledTimes(1);
    expect(ports.restoreSnapshot).not.toHaveBeenCalled();
  });

  it('closing it restores item, spot and queue when the programme is no longer loaded (AC2)', async () => {
    const before = playing();
    const { features, ports, setSnapshot } = setup(before);
    features.beginBrief({ kind: 'clip', contentId: 'plex:9', title: 'Clip' });
    setSnapshot({ state: 'idle', queue: { currentIndex: -1, items: [] } });
    const out = await features.handleSession('close-brief', {});
    expect(out).toEqual({ ok: true, returned: 'restored' });
    expect(ports.restoreSnapshot).toHaveBeenCalledWith(before, { autoplay: true, reason: 'brief-return' });
  });

  it('a paused programme comes back paused', async () => {
    const { features, ports } = setup(playing('plex:1', 'paused'));
    features.beginBrief({ kind: 'camera', cameraId: 'c' });
    expect(ports.pausePlayback).not.toHaveBeenCalled();
    await features.endBrief('closed');
    expect(ports.resumePlayback).not.toHaveBeenCalled();
  });

  it('a second interruption keeps the first programme to return to', async () => {
    const { features, ports, setSnapshot } = setup();
    features.beginBrief({ kind: 'camera', cameraId: 'a', seconds: 30 });
    setSnapshot(playing('plex:1', 'paused'));
    features.beginBrief({ kind: 'camera', cameraId: 'b', seconds: 30 });
    expect(features.toPublished().brief).toMatchObject({ cameraId: 'b', returnTo: { contentId: 'plex:1' } });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ports.resumePlayback).toHaveBeenCalledTimes(1); // it WAS playing before the first
  });

  it('a new start on the screen supersedes it: nothing comes back', async () => {
    const { features, ports } = setup();
    features.beginBrief({ kind: 'camera', cameraId: 'a', seconds: 30 });
    features.supersedeBrief('media:queue-op');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ports.resumePlayback).not.toHaveBeenCalled();
    expect(features.toPublished().brief).toBeNull();
  });

  it('on an idle screen it simply closes', async () => {
    const { features, ports } = setup({ state: 'idle', queue: { currentIndex: -1, items: [] } });
    features.beginBrief({ kind: 'camera', cameraId: 'a' });
    expect(features.toPublished().brief.returnTo).toBeNull();
    expect(await features.endBrief('closed')).toEqual({ ok: true, returned: 'nothing' });
    expect(ports.restoreSnapshot).not.toHaveBeenCalled();
  });

  it('close-brief with nothing up is refused', async () => {
    const { features } = setup();
    expect(await features.handleSession('close-brief', {})).toMatchObject({ ok: false, code: 'NO_BRIEF' });
  });
});

describe('Stop and sleep under a brief — the programme is never resurrected', () => {
  it('a Stop supersedes the brief: nothing returns', async () => {
    const { features, ports } = setup();
    features.beginBrief({ kind: 'camera', cameraId: 'a', seconds: 30 });
    features.onPlaybackStopped('stop');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(features.toPublished().brief).toBeNull();
    expect(ports.resumePlayback).not.toHaveBeenCalled();
    expect(ports.restoreSnapshot).not.toHaveBeenCalled();
  });

  it('a time-out after the programme was stopped returns nothing, but a person closing it still asks for it back', async () => {
    const { features, ports, setSnapshot } = setup();
    features.beginBrief({ kind: 'camera', cameraId: 'a', seconds: 30 });
    setSnapshot({ state: 'ready', currentItem: { contentId: 'plex:1', queueItemId: 'q1' }, queue: { currentIndex: 0, items: [{ contentId: 'plex:1', queueItemId: 'q1' }] } });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ports.resumePlayback).not.toHaveBeenCalled();
    expect(ports.restoreSnapshot).not.toHaveBeenCalled();
  });

  it('stop also stops music behind unless asked to keep it; display sleep ends a brief', () => {
    const { features, ports } = setup();
    ports.stopMusic = vi.fn();
    features.setMusicState({ contentId: 'plex:5', state: 'playing' });
    features.onPlaybackStopped('stop', { stopMusic: false });
    expect(ports.stopMusic).not.toHaveBeenCalled();
    features.onPlaybackStopped('stop');
    expect(ports.stopMusic).toHaveBeenCalledTimes(1);
  });

  it('the sleep timer\'s stop reaches the extension', async () => {
    const { features, ports } = setup();
    ports.stopMusic = vi.fn();
    features.setMusicState({ contentId: 'plex:5', state: 'playing' });
    features.beginBrief({ kind: 'camera', cameraId: 'a', seconds: 30 });
    const controls = createScreenSessionControls({ ownerId: 'tv', ports: { getSnapshot: () => playing(), stopPlayback: vi.fn(), setFade: vi.fn() } });
    controls.attachExtension(features);
    await controls.handleSession('sleep-timer', { minutes: 0.01 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(features.toPublished().brief).toBeNull();
    expect(ports.stopMusic).toHaveBeenCalled();
    controls.dispose();
  });
});

describe('tracks and music behind', () => {
  it('forwards a track choice to the playback owner', async () => {
    const { features, ports } = setup();
    expect(await features.handleSession('set-tracks', { subtitle: '7' })).toEqual({ ok: true });
    expect(ports.setTracks).toHaveBeenCalledWith({ subtitle: '7' });
    ports.setTracks.mockReturnValueOnce({ ok: false, code: 'UNKNOWN_TRACK' });
    expect(await features.handleSession('set-tracks', { subtitle: '8' })).toMatchObject({ ok: false, code: 'UNKNOWN_TRACK' });
    expect(await features.handleSession('set-tracks', {})).toMatchObject({ ok: false, code: 'INVALID_SESSION_COMMAND' });
  });

  it('publishes the track state it is given', () => {
    const { features } = setup();
    const state = { contentId: 'plex:1', source: 'plex', audio: [], subtitles: [{ id: '7', label: 'English' }], selected: { audio: null, subtitle: null } };
    features.setTrackState(state);
    expect(features.toPublished().tracks).toBe(state);
  });

  it('steers music separately and publishes its state', async () => {
    const { features, ports } = setup();
    expect(await features.handleSession('music-behind', { op: 'start', contentId: 'plex:500', title: 'Album' })).toEqual({ ok: true });
    expect(ports.musicCommand).toHaveBeenCalledWith('start', expect.objectContaining({ contentId: 'plex:500' }));
    features.setMusicState({ contentId: 'plex:500', title: 'Album', state: 'playing' });
    expect(features.toPublished().musicBehind).toMatchObject({ state: 'playing' });
  });
});

describe('attached to the screen session controls', () => {
  it('routes the feature actions and publishes valid controls', async () => {
    const { features, ports } = setup();
    const controls = createScreenSessionControls({ ownerId: 'livingroom-tv', ports: { getSnapshot: () => playing() } });
    controls.attachExtension(features);
    const changed = vi.fn();
    controls.subscribe(changed);
    expect(await controls.handleSession('set-tracks', { subtitle: 'off' })).toEqual({ ok: true });
    expect(ports.setTracks).toHaveBeenCalledWith({ subtitle: 'off' });
    features.beginBrief({ kind: 'camera', cameraId: 'a', origin: doorbell, seconds: 30 });
    expect(changed).toHaveBeenCalled();
    const published = controls.toPublished();
    expect(published.brief.label).toBe('Camera · from Doorbell');
    expect(validateSessionControls(published)).toEqual({ valid: true, errors: [] });
    expect(await controls.handleSession('sleep-timer', { minutes: 5 })).toEqual({ ok: true });
    controls.dispose();
  });

  it('without an extension the published controls are exactly the P1 set', () => {
    const controls = createScreenSessionControls({ ownerId: 'x' });
    expect(Object.keys(controls.toPublished()).sort()).toEqual(
      ['addOnly', 'countdown', 'endOfQueue', 'endOfQueueStatus', 'notes', 'sleepResume', 'sleepTimer', 'stopAfterCurrent'],
    );
  });
});
