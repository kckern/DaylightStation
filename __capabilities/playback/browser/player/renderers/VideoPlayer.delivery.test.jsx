import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import Player from '../Player.jsx';
import { VideoPlayer } from './VideoPlayer.jsx';
import { createRecoveryIdentity } from '../lib/recovery/recoveryIdentity.js';

const engines = vi.hoisted(() => ({ supported: true, instances: [], logs: [] }));
vi.mock('../../../../../frontend/src/lib/api.mjs', async importOriginal => ({
  ...await importOriginal(), DaylightAPI: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../../../../frontend/src/lib/logging/Logger.js', () => {
  const record = (event, data, options) => engines.logs.push({ event, data, options });
  const logger = { info: record, debug: record, warn: record, error: record, log: record, sampled: record };
  logger.child = () => logger;
  return { getLogger: () => logger, default: () => logger };
});
vi.mock('hls.js', () => ({ default: class Hls {
  static Events = { ERROR: 'hlsError', LEVEL_LOADED: 'hlsLevelLoaded', FRAG_LOADING: 'hlsFragLoading',
    FRAG_LOADED: 'hlsFragLoaded', FRAG_LOAD_EMERGENCY_ABORTED: 'hlsFragLoadEmergencyAborted' };
  static isSupported() { return engines.supported; }
  constructor() { this.listeners = new Map(); engines.instances.push(this); }
  on(event, cb) { const list = this.listeners.get(event) || []; list.push(cb); this.listeners.set(event, list); }
  emit(event, data) { for (const cb of this.listeners.get(event) || []) cb(event, data); }
  loadSource() {} attachMedia() {} destroy() {} recoverMediaError() {}
} }));

beforeEach(() => {
  engines.supported = true; engines.instances = []; engines.logs = [];
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
const frag = () => ({ type: 'main', sn: 1, start: 0, duration: 3, stats: {
  loaded: 1200, retry: 0, loading: { start: 100, first: 250, end: 600 } } });

async function mountHls() {
  await import('hls.js');
  const identity = createRecoveryIdentity({ ownerId: 'owner' });
  const observations = [];
  const resilienceBridge = { recoveryIdentity: identity };
  const onDeliveryObservation = observation => observations.push(observation);
  const media = { mediaType: 'hls_video', mediaUrl: '/movie.m3u8' };
  const props = { media, resilienceBridge, onDeliveryObservation, advance() {}, clear() {} };
  let result;
  await act(async () => { result = render(<VideoPlayer {...props} />); });
  return { ...result, props, identity, observations };
}

describe('VideoPlayer fragment delivery binding', () => {
  it('propagates engine evidence through real SinglePlayer and Player with bounded private log summaries', async () => {
    await import('hls.js');
    const identity = createRecoveryIdentity({ ownerId: 'private-owner-token', createVisitId: () => 'private-visit-token' });
    const observations = [];
    render(<Player play={{ mediaUrl: '/movie.m3u8?access_token=private-credential', mediaType: 'hls_video', format: 'hls_video' }}
      recoveryIdentity={identity} onDeliveryObservation={o => observations.push(o)} />);
    await waitFor(() => expect(engines.instances).toHaveLength(1));
    const engine = engines.instances[0];
    const request = frag();
    act(() => { engine.emit('hlsFragLoading', { frag: request }); engine.emit('hlsFragLoaded', { frag: request }); });
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ target: identity.getTarget(), newlyDeliveredMediaSeconds: 3 });
    const log = engines.logs.find(entry => entry.event === 'playback.delivery-observation');
    expect(log).toMatchObject({ data: { rendererGeneration: 0, sequence: 1, bytes: 1200 },
      options: { maxPerMinute: 12, aggregate: true } });
    expect(JSON.stringify(log)).not.toMatch(/private-|access_token|movie\.m3u8/);
  });

  it('routes HLS fragment failure and abort once without treating manifest errors as delivery', async () => {
    const { observations } = await mountHls();
    const engine = engines.instances[0];
    act(() => { engine.emit('hlsError', { details: 'manifestLoadError', response: { code: 503 } }); });
    for (const [type, details, outcome] of [['hlsError', 'fragLoadError', 'failed'],
      ['hlsFragLoadEmergencyAborted', null, 'aborted']]) {
      const request = frag();
      act(() => {
        engine.emit('hlsFragLoading', { frag: request });
        engine.emit(type, { frag: request, details, response: { code: 503 } });
        engine.emit(type, { frag: request, details, response: { code: 503 } });
      });
      expect(observations.at(-1)).toMatchObject({ outcome, newlyDeliveredMediaSeconds: 0 });
    }
    expect(observations).toHaveLength(2);
  });
  it('reports real HLS fragments, ignores manifests and stale completions across intent changes without replacing engine', async () => {
    const { props, rerender, identity, observations } = await mountHls();
    const engine = engines.instances[0];
    const stale = frag();
    act(() => { engine.emit('hlsLevelLoaded', {}); engine.emit('hlsFragLoading', { frag: stale }); });
    act(() => { identity.acceptUserIntent('pause'); rerender(<VideoPlayer {...props} resilienceBridge={{ ...props.resilienceBridge }} />); });
    act(() => { engine.emit('hlsFragLoaded', { frag: stale }); });
    expect(observations).toHaveLength(0);
    expect(engines.instances).toHaveLength(1);
    const current = frag();
    act(() => { engine.emit('hlsFragLoading', { frag: current }); engine.emit('hlsFragLoaded', { frag: current }); });
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ target: identity.getTarget(), kind: 'video', firstByteDurationMs: 150,
      transferDurationMs: 350, sequence: 2, newlyDeliveredMediaSeconds: 3 });
  });
  it('rejects outgoing callbacks after same-URL keyed replacement and unmount', async () => {
    const { props, rerender, unmount, observations } = await mountHls();
    const outgoing = engines.instances[0];
    const old = frag();
    act(() => { outgoing.emit('hlsFragLoading', { frag: old }); });
    await act(async () => { rerender(<VideoPlayer {...props} media={{ ...props.media, maxVideoBitrate: 2000 }} />); });
    act(() => { outgoing.emit('hlsFragLoaded', { frag: old }); });
    expect(observations).toHaveLength(0);
    const current = engines.instances.at(-1);
    const fresh = frag();
    act(() => { current.emit('hlsFragLoading', { frag: fresh }); current.emit('hlsFragLoaded', { frag: fresh }); });
    expect(observations).toHaveLength(1);
    unmount();
    current.emit('hlsFragLoading', { frag: frag() });
    current.emit('hlsFragLoaded', { frag: fresh });
    expect(observations).toHaveLength(1);
  });
  it('leaves native HLS functional without synthetic delivery observations', async () => {
    engines.supported = false;
    const { container, observations } = await mountHls();
    const video = container.querySelector('video');
    expect(video.getAttribute('src')).toBe('/movie.m3u8');
    act(() => { video.dispatchEvent(new Event('loadedmetadata')); video.dispatchEvent(new Event('canplay')); });
    expect(engines.instances).toHaveLength(0);
    expect(observations).toHaveLength(0);
  });
  it('subscribes DASH delivery on the existing api attach and retires it with the element', () => {
    vi.useFakeTimers();
    const identity = createRecoveryIdentity({ ownerId: 'dash-owner' });
    const observations = [];
    const props = { media: { mediaType: 'dash_video', mediaUrl: '/movie.mpd' },
      resilienceBridge: { recoveryIdentity: identity }, onDeliveryObservation: o => observations.push(o), advance() {}, clear() {} };
    const { container, rerender, unmount } = render(<VideoPlayer {...props} />);
    const node = container.querySelector('dash-video');
    const handlers = new Map();
    node.api = { on: (event, cb) => { const list = handlers.get(event) || []; list.push(cb); handlers.set(event, list); }, off() {}, reset() {} };
    act(() => { vi.advanceTimersByTime(100); });
    const emit = (event, data) => { for (const handler of handlers.get(event) || []) handler({ ...data, type: event }); };
    const request = { type: 'MediaSegment', mediaType: 'video', startTime: 0, duration: 3, bytesLoaded: 800,
      startDate: new Date(Date.now()), firstByteDate: new Date(Date.now() + 100), endDate: new Date(Date.now() + 400) };
    act(() => { emit('fragmentLoadingStarted', { request }); emit('fragmentLoadingCompleted', { request, response: new ArrayBuffer(800) }); });
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ target: identity.getTarget(), firstByteDurationMs: 100, transferDurationMs: 300 });
    const stale = { ...request };
    act(() => { emit('fragmentLoadingStarted', { request: stale }); rerender(<VideoPlayer {...props} media={{ ...props.media, maxVideoBitrate: 2000 }} />); });
    act(() => { emit('fragmentLoadingCompleted', { request: stale }); });
    unmount();
    expect(observations).toHaveLength(1);
  });
});
