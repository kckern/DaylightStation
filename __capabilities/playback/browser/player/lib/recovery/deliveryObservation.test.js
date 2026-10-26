import { describe, expect, it } from 'vitest';
import { normalizeDeliveryObservation, createDeliveryObserver } from './deliveryObservation.js';
import { createRecoveryIdentity } from './recoveryIdentity.js';

const target = Object.freeze({ ownerId: 'owner', visitId: 'visit', intentRevision: 2, rendererGeneration: 4 });
const context = { target, requestId: 'request-1', sequence: 1, clock: { wallMs: 10000, monotonicMs: 1000 } };
const dashRequest = (extra = {}) => ({ type: 'MediaSegment', mediaType: 'video', startTime: 12, duration: 3,
  startDate: new Date(10100), firstByteDate: new Date(10300), endDate: new Date(10800),
  bytesLoaded: 900, retryAttempts: 0, url: '/private?token=secret', ...extra });
const hlsFrag = (extra = {}) => ({ type: 'main', sn: 4, start: 12, duration: 3,
  stats: { loading: { start: 1100, first: 1300, end: 1800 }, loaded: 900, retry: 0 }, ...extra });

describe('normalizeDeliveryObservation', () => {
  it.each([
    ['dash', { type: 'fragmentLoadingCompleted', request: dashRequest(), response: new ArrayBuffer(900) }],
    ['hls', { type: 'hlsFragLoaded', frag: hlsFrag(), payload: new ArrayBuffer(900), networkDetails: { status: 200 } }],
  ])('normalizes actual %s request timing without scheduler idle or private fields', (engine, event) => {
    const result = normalizeDeliveryObservation(engine, event, context);
    expect(result).toMatchObject({ target, requestId: 'request-1', sequence: 1, kind: 'video',
      mediaStartSeconds: 12, mediaDurationSeconds: 3, requestStartMs: 1100, firstByteMs: 1300,
      endMs: 1800, firstByteDurationMs: 200, transferDurationMs: 500, requestDurationMs: 700,
      bytes: 900, retries: 0, outcome: 'complete' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('uses installed DASH endDate, keeps its synthesized first-byte fallback unknown', () => {
    const result = normalizeDeliveryObservation('dash', { type: 'fragmentLoadingCompleted',
      request: dashRequest({ firstByteDate: new Date(10100), retryAttempts: 2 }), response: new ArrayBuffer(900) }, context);
    expect(result).toMatchObject({ firstByteMs: null, firstByteDurationMs: null, transferDurationMs: null,
      requestDurationMs: 700, retries: 2, status: null });
  });

  it('keeps missing, default-zero and invalid timing/size/status unknown', () => {
    const result = normalizeDeliveryObservation('hls', { type: 'hlsFragLoaded', frag: hlsFrag({
      stats: { loading: { start: 0, first: 0, end: 0 } } }) }, context);
    expect(result).toMatchObject({ requestStartMs: null, firstByteMs: null, endMs: null, bytes: null,
      retries: null, status: null, firstByteDurationMs: null, transferDurationMs: null, requestDurationMs: null });
  });

  it.each([
    ['dash', { type: 'fragmentLoadingCompleted', request: dashRequest(), error: { code: 1 } }, 'failed'],
    ['dash', { type: 'fragmentLoadingAbandoned', request: dashRequest() }, 'aborted'],
    ['hls', { type: 'hlsError', details: 'fragLoadTimeOut', frag: hlsFrag(), response: { code: 504 } }, 'failed'],
    ['hls', { type: 'hlsError', details: 'aborted', frag: hlsFrag() }, 'aborted'],
    ['hls', { type: 'hlsFragLoadEmergencyAborted', frag: hlsFrag() }, 'aborted'],
  ])('retains %s terminal %s as %s', (engine, event, outcome) => {
    expect(normalizeDeliveryObservation(engine, event, context)).toMatchObject({ outcome, target, sequence: 1 });
  });

  it.each([
    ['native-hls', { type: 'loadeddata' }],
    ['dash', { type: 'manifestLoaded' }],
    ['dash', { type: 'fragmentLoadingStarted', request: dashRequest() }],
    ['dash', { type: 'fragmentLoadingCompleted', request: dashRequest({ type: 'InitializationSegment' }) }],
    ['hls', { type: 'hlsFragLoaded', frag: hlsFrag({ sn: 'initSegment' }) }],
    ['hls', { type: 'hlsError', details: 'bufferStalledError', frag: hlsFrag() }],
    ['health-probe', { ok: true, status: 200 }],
  ])('does not fabricate fragment evidence for %s %j', (engine, event) => {
    expect(normalizeDeliveryObservation(engine, event, context)).toBeNull();
  });

  it('uses low latency HLS part timing and interval rather than the aggregate fragment', () => {
    const part = { start: 14, duration: 0.5, stats: { loaded: 200, retry: 1,
      loading: { start: 2000, first: 2100, end: 2400 } } };
    expect(normalizeDeliveryObservation('hls', { type: 'hlsFragLoaded', frag: hlsFrag(), part }, context))
      .toMatchObject({ mediaStartSeconds: 14, mediaDurationSeconds: 0.5, requestStartMs: 2000,
        firstByteDurationMs: 100, transferDurationMs: 300, bytes: 200, retries: 1 });
  });
});

describe('source-bound delivery observer', () => {
  const setup = () => {
    const identity = createRecoveryIdentity({ ownerId: 'owner', createVisitId: () => 'visit' });
    return { identity, observer: createDeliveryObserver({ engine: 'dash', identity, clock: context.clock }) };
  };
  const deliver = (observer, request) => {
    observer.observe({ type: 'fragmentLoadingStarted', request });
    return observer.observe({ type: 'fragmentLoadingCompleted', request, response: new ArrayBuffer(900) });
  };
  it('captures full identity at start, rejects stale completions and permits new same-node intent requests', () => {
    const { identity, observer } = setup();
    const old = dashRequest();
    observer.observe({ type: 'fragmentLoadingStarted', request: old });
    identity.acceptUserIntent('pause');
    expect(observer.observe({ type: 'fragmentLoadingCompleted', request: old })).toBeNull();
    expect(deliver(observer, dashRequest())).toMatchObject({ target: { intentRevision: 1, rendererGeneration: 1 }, sequence: 2 });
  });
  it('does not rebind old-engine requests after a replacement claim, even before its node disappears', () => {
    const { identity, observer } = setup();
    identity.beginRenderer(identity.getTarget());
    expect(deliver(observer, dashRequest())).toBeNull();
  });
  it('rejects an unobserved start, duplicate completion and disposed binding', () => {
    const { observer } = setup();
    const request = dashRequest();
    expect(observer.observe({ type: 'fragmentLoadingCompleted', request })).toBeNull();
    const first = deliver(observer, request);
    expect(first).toMatchObject({ sequence: 1, newlyDeliveredMediaSeconds: 3 });
    expect(observer.observe({ type: 'fragmentLoadingCompleted', request })).toBeNull();
    observer.dispose();
    expect(deliver(observer, dashRequest())).toBeNull();
  });
  it('unions retries/overlap per media kind without counting zero or unknown bytes as supply', () => {
    const { observer } = setup();
    expect(deliver(observer, dashRequest())).toMatchObject({ newlyDeliveredMediaSeconds: 3 });
    expect(deliver(observer, dashRequest())).toMatchObject({ newlyDeliveredMediaSeconds: 0 });
    expect(deliver(observer, dashRequest({ startTime: 14 }))).toMatchObject({ newlyDeliveredMediaSeconds: 2 });
    expect(deliver(observer, dashRequest({ mediaType: 'audio' }))).toMatchObject({ newlyDeliveredMediaSeconds: 3 });
    const zero = dashRequest({ startTime: 18, bytesLoaded: 0 });
    observer.observe({ type: 'fragmentLoadingStarted', request: zero });
    expect(observer.observe({ type: 'fragmentLoadingCompleted', request: zero, response: new ArrayBuffer(0) }))
      .toMatchObject({ bytes: 0, newlyDeliveredMediaSeconds: 0 });
    const unknown = dashRequest({ startTime: 18, bytesLoaded: NaN });
    observer.observe({ type: 'fragmentLoadingStarted', request: unknown });
    expect(observer.observe({ type: 'fragmentLoadingCompleted', request: unknown })).toMatchObject({ bytes: null, newlyDeliveredMediaSeconds: null });
    expect(deliver(observer, dashRequest({ startTime: 18 }))).toMatchObject({ newlyDeliveredMediaSeconds: 3 });
  });
  it('does not credit failed transfers and preserves null timing without counting gaps between requests', () => {
    const { observer } = setup();
    const failed = dashRequest();
    observer.observe({ type: 'fragmentLoadingStarted', request: failed });
    expect(observer.observe({ type: 'fragmentLoadingCompleted', request: failed, error: {} })).toMatchObject({ newlyDeliveredMediaSeconds: 0 });
    expect(deliver(observer, dashRequest({ startDate: new Date(20100), firstByteDate: new Date(20300), endDate: new Date(20800) })))
      .toMatchObject({ requestDurationMs: 700, newlyDeliveredMediaSeconds: 3 });
  });
});
