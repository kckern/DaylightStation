import { describe, expect, it, vi } from 'vitest';
import { CallLeaseService } from './CallLeaseService.mjs';

const device = overrides => ({
  screenPath: '/screen/living-room',
  getState: vi.fn(async () => ({ power: { state: 'off' }, content: { currentUrl: '/screen/home' } })),
  powerOff: vi.fn(async () => ({ ok: true })), powerOn: vi.fn(async () => ({ ok: true })),
  setScreen: vi.fn(async () => ({ ok: true })),
  reboot: vi.fn(async () => ({ ok: true })), prepareForContent: vi.fn(async () => ({ ok: true })),
  loadContent: vi.fn(async () => ({ ok: true })), ...overrides,
});
const make = (dev = device()) => {
  const wake = { execute: vi.fn(async () => ({ ok: true, coldWake: true, steps: { power: { ok: true } } })) };
  const service = new CallLeaseService({ deviceService: { get: id => id === 'tv' ? dev : null }, wakeAndLoadService: wake,
    logger: { info() {}, warn() {} }, sleep: vi.fn(async () => {}) });
  return { service, dev, wake };
};

describe('CallLeaseService', () => {
  it('atomically reserves one call per device without waking on conflict', async () => {
    const { service, wake } = make();
    const [first, second] = await Promise.all([
      service.reserve({ deviceId: 'tv', attemptId: 'a1', phonePeerId: 'p1', callerId: 'u1' }),
      service.reserve({ deviceId: 'tv', attemptId: 'a2', phonePeerId: 'p2', callerId: 'u2' }),
    ]);
    expect([first.kind, second.kind].sort()).toEqual(['busy', 'ok']);
    expect(wake.execute).not.toHaveBeenCalled();
  });

  it('uses the correlated wake dispatch and disables deferred retry', async () => {
    const { service, wake } = make();
    const reserved = await service.reserve({ deviceId: 'tv', attemptId: 'a1', phonePeerId: 'p1', callerId: 'u1' });
    await service.wake(reserved.body.callId, 'u1');
    expect(wake.execute).toHaveBeenCalledWith('tv', { open: 'videocall/tv' },
      expect.objectContaining({ dispatchId: reserved.body.dispatchId, deferredRetry: false, isCancelled: expect.any(Function) }));
    expect((await service.wake(reserved.body.callId, 'u1')).kind).toBe('wake_exhausted');
  });

  it('authorizes only matching credentials and strips them from relayed messages', async () => {
    const { service } = make();
    const { body } = await service.reserve({ deviceId: 'tv', attemptId: 'a1', phonePeerId: 'p1', callerId: 'u1' });
    expect(service.authorize({ clientId: 'socket', topic: body.topic, credential: body.phoneCredential, role: 'phone', peerId: 'p1' }).ok).toBe(true);
    const checked = service.validateSignal('socket', { topic: body.topic, callId: body.callId, attemptId: 'a1',
      role: 'phone', peerId: 'p1', revision: 0, sequence: 0, type: 'ready', payload: {}, credential: 'secret' });
    expect(checked.ok).toBe(true);
    expect(checked.message).not.toHaveProperty('credential');
    expect(service.canSubscribe('other', body.topic)).toBe(false);
  });

  it('rotates phone credentials on resume', async () => {
    const { service } = make();
    const { body } = await service.reserve({ deviceId: 'tv', attemptId: 'a1', phonePeerId: 'p1', callerId: 'u1' });
    const resumed = service.resume(body.callId, 'u1');
    expect(resumed.body.phoneCredential).not.toBe(body.phoneCredential);
    expect(service.authorize({ clientId: 'old', topic: body.topic, credential: body.phoneCredential, role: 'phone', peerId: 'p1' }).ok).toBe(false);
  });

  it('rotates TV credentials and rejects an active-socket credential takeover', async () => {
    const { service } = make();
    const { body } = await service.reserve({ deviceId: 'tv', attemptId: 'a1', phonePeerId: 'p1', callerId: 'u1' });
    const first = service.joinActive({ deviceId: 'tv', declaredDeviceId: 'tv', isLocal: true });
    const second = service.joinActive({ deviceId: 'tv', declaredDeviceId: 'tv', isLocal: true });
    expect(service.authorize({ clientId: 'old-tv', topic: body.topic, credential: first.body.tvCredential,
      role: 'tv', peerId: first.body.tvPeerId }).ok).toBe(false);
    expect(service.authorize({ clientId: 'phone-a', topic: body.topic, credential: body.phoneCredential,
      role: 'phone', peerId: 'p1' }).ok).toBe(true);
    expect(service.authorize({ clientId: 'phone-b', topic: body.topic, credential: body.phoneCredential,
      role: 'phone', peerId: 'p1' })).toMatchObject({ ok: false, code: 'CREDENTIAL_IN_USE' });
    expect(second.body.tvCredential).not.toBe(first.body.tvCredential);
  });

  it('rejects out-of-phase and stale signaling and activates only after both peers verify media', async () => {
    const { service } = make();
    const { body } = await service.reserve({ deviceId: 'tv', attemptId: 'a1', phonePeerId: 'p1', callerId: 'u1' });
    const joined = service.joinActive({ deviceId: 'tv', declaredDeviceId: 'tv', isLocal: true }).body;
    service.authorize({ clientId: 'p-socket', topic: body.topic, credential: body.phoneCredential, role: 'phone', peerId: 'p1' });
    service.authorize({ clientId: 't-socket', topic: body.topic, credential: joined.tvCredential, role: 'tv', peerId: joined.tvPeerId });
    const signal = (clientId, role, peerId, type, sequence, payload = {}) => service.validateSignal(clientId, {
      topic: body.topic, callId: body.callId, attemptId: 'a1', role, peerId, revision: 0, sequence, type, payload,
    });
    expect(signal('p-socket', 'phone', 'p1', 'offer', 0).code).toBe('UNEXPECTED_PHASE');
    expect(signal('t-socket', 'tv', joined.tvPeerId, 'waiting', 0).ok).toBe(true);
    expect(signal('p-socket', 'phone', 'p1', 'offer', 0).ok).toBe(true);
    expect(signal('p-socket', 'phone', 'p1', 'offer', 0).code).toBe('STALE_SIGNAL');
    expect(signal('t-socket', 'tv', joined.tvPeerId, 'answer', 1).ok).toBe(true);
    expect(signal('p-socket', 'phone', 'p1', 'media-verified', 1, { audio: true }).ok).toBe(true);
    expect(service.get(body.callId).state).toBe('verifying_media');
    expect(signal('t-socket', 'tv', joined.tvPeerId, 'media-verified', 2, { video: true }).ok).toBe(true);
    expect(service.get(body.callId).state).toBe('active');
  });

  it('strips nested credentials from signaling payloads', async () => {
    const { service } = make();
    const { body } = await service.reserve({ deviceId: 'tv', attemptId: 'a1', phonePeerId: 'p1', callerId: 'u1' });
    service.authorize({ clientId: 'socket', topic: body.topic, credential: body.phoneCredential, role: 'phone', peerId: 'p1' });
    const checked = service.validateSignal('socket', { topic: body.topic, callId: body.callId, attemptId: 'a1',
      role: 'phone', peerId: 'p1', revision: 0, sequence: 0, type: 'ready',
      payload: { nested: { credential: 'secret', phoneCredential: 'also-secret', safe: true } } });
    expect(checked.message.payload).toEqual({ nested: { safe: true } });
  });

  it('reports recovery preparation failure and caps hard recovery', async () => {
    const { service } = make(device({ prepareForContent: vi.fn(async () => ({ ok: false, error: 'camera locked' })) }));
    const { body } = await service.reserve({ deviceId: 'tv', attemptId: 'a1', phonePeerId: 'p1', callerId: 'u1' });
    expect((await service.recover(body.callId, 'u1', 'hard')).kind).toBe('confirmation_required');
    const failed = await service.recover(body.callId, 'u1', 'hard', { confirmed: true });
    expect(failed).toMatchObject({ kind: 'failed', body: { ok: false } });
    expect((await service.recover(body.callId, 'u1', 'hard', { confirmed: true })).kind).toBe('exhausted');
  });

  it('extends the setup lease before a confirmed hard recovery waits on hardware', async () => {
    let now = 1_000;
    let finishReboot;
    const scheduled = [];
    const dev = device({ reboot: vi.fn(() => new Promise(resolve => { finishReboot = resolve; })) });
    const service = new CallLeaseService({
      deviceService: { get: () => dev }, wakeAndLoadService: { execute: vi.fn() },
      logger: { info() {}, warn() {} }, clock: () => now, sleep: vi.fn(async () => {}),
      setTimer: (fn, delay) => { const timer = { fn, delay, unref() {} }; scheduled.push(timer); return timer; },
      clearTimer: vi.fn(),
    });
    const { body } = await service.reserve({ deviceId: 'tv', attemptId: 'a1', phonePeerId: 'p1', callerId: 'u1' });
    now += 179_000;
    const recovery = service.recover(body.callId, 'u1', 'hard', { confirmed: true });
    await Promise.resolve();
    expect(scheduled.at(-1).delay).toBe(180_000);
    expect(service.get(body.callId).expiresAt).toBe(now + 180_000);
    finishReboot({ ok: true });
    expect((await recovery).kind).toBe('ok');
  });

  it('caps soft recovery and rejects overlapping device operations', async () => {
    let finish;
    const dev = device({ prepareForContent: vi.fn(() => new Promise(resolve => { finish = resolve; })) });
    const { service } = make(dev);
    const { body } = await service.reserve({ deviceId: 'tv', attemptId: 'a1', phonePeerId: 'p1', callerId: 'u1' });
    const first = service.recover(body.callId, 'u1', 'soft');
    await Promise.resolve();
    expect((await service.recover(body.callId, 'u1', 'hard', { confirmed: true })).kind).toBe('in_progress');
    finish({ ok: true }); await first;
    expect((await service.recover(body.callId, 'u1', 'soft')).kind).toBe('soft_exhausted');
  });

  it('ends idempotently and powers off only when the call woke an off TV', async () => {
    const { service, dev } = make();
    const { body } = await service.reserve({ deviceId: 'tv', attemptId: 'a1', phonePeerId: 'p1', callerId: 'u1' });
    await service.wake(body.callId, 'u1');
    const ended = await service.end(body.callId, 'u1', 'hangup');
    expect(ended.body.restoration).toMatchObject({ outcome: 'restored', action: 'power_off' });
    await service.end(body.callId, 'u1', 'again');
    expect(dev.powerOff).toHaveBeenCalledTimes(1);
  });

  it('restores after cancellation even when the in-flight wake finishes late', async () => {
    let finishWake;
    const wake = { execute: vi.fn((_id, _query, options) => new Promise(resolve => {
      finishWake = () => resolve({ ok: false, cancelled: options.isCancelled(), steps: { power: { ok: true } } });
    })) };
    const dev = device();
    const service = new CallLeaseService({ deviceService: { get: () => dev }, wakeAndLoadService: wake,
      logger: { info() {}, warn() {} } });
    const { body } = await service.reserve({ deviceId: 'tv', attemptId: 'a1', phonePeerId: 'p1', callerId: 'u1' });
    const waking = service.wake(body.callId, 'u1');
    const ending = service.end(body.callId, 'u1', 'cancelled');
    expect((await service.reserve({ deviceId: 'tv', attemptId: 'a2', phonePeerId: 'p2', callerId: 'u2' })).kind).toBe('busy');
    finishWake(); await waking; await ending;
    expect(dev.powerOff).toHaveBeenCalledTimes(1);
  });

  it('runs no later recovery device action after end and restores after the in-flight action settles', async () => {
    let finishPrepare;
    const dev = device({
      getState: vi.fn(async () => ({ power: { state: 'on' }, content: { currentUrl: '/screen/home' } })),
      prepareForContent: vi.fn(() => new Promise(resolve => { finishPrepare = resolve; })),
    });
    const { service } = make(dev);
    const { body } = await service.reserve({ deviceId: 'tv', attemptId: 'a1', phonePeerId: 'p1', callerId: 'u1' });
    const recovering = service.recover(body.callId, 'u1', 'soft');
    await Promise.resolve();
    const ending = service.end(body.callId, 'u1', 'cancelled');
    finishPrepare({ ok: true });
    const [recovery, ended] = await Promise.all([recovering, ending]);
    expect(recovery.body).toMatchObject({ ok: false, cancelled: true });
    expect(dev.loadContent).toHaveBeenCalledTimes(1);
    expect(dev.loadContent).toHaveBeenCalledWith('/screen/home', {});
    expect(ended.body.restoration).toMatchObject({ outcome: 'restored', action: 'content' });
  });

  it('restores a prior absolute URL and screen-off state without powering the device off', async () => {
    const dev = device({ getState: vi.fn(async () => ({
      power: { state: 'on' },
      content: { currentUrl: 'http://daylight.local/screen/home?mode=quiet', screenOn: false },
    })) });
    const { service } = make(dev);
    const { body } = await service.reserve({ deviceId: 'tv', attemptId: 'a1', phonePeerId: 'p1', callerId: 'u1' });
    const ended = await service.end(body.callId, 'u1');
    expect(dev.loadContent).toHaveBeenCalledWith('/screen/home', { mode: 'quiet' });
    expect(dev.setScreen).toHaveBeenCalledWith(false);
    expect(dev.powerOff).not.toHaveBeenCalled();
    expect(ended.body.restoration).toMatchObject({ outcome: 'restored', action: 'content+screen_off' });
  });

  it('leaves the TV on when prior state capture failed', async () => {
    const dev = device({ getState: vi.fn(async () => { throw new Error('unavailable'); }) });
    const { service } = make(dev);
    const { body } = await service.reserve({ deviceId: 'tv', attemptId: 'a1', phonePeerId: 'p1', callerId: 'u1' });
    const ended = await service.end(body.callId, 'u1');
    expect(dev.powerOff).not.toHaveBeenCalled();
    expect(ended.body.restoration).toMatchObject({ outcome: 'left_on', reason: 'prior_state_unknown' });
  });

  it('expires an unconnected setup lease after 180 seconds', async () => {
    let now = 1_000;
    const scheduled = [];
    const dev = device();
    const service = new CallLeaseService({
      deviceService: { get: id => id === 'tv' ? dev : null },
      wakeAndLoadService: { execute: vi.fn() }, logger: { info() {}, warn() {} },
      clock: () => now,
      setTimer: (fn, delay) => { const timer = { fn, delay, cancelled: false, unref() {} }; scheduled.push(timer); return timer; },
      clearTimer: timer => { if (timer) timer.cancelled = true; },
    });
    const { body } = await service.reserve({ deviceId: 'tv', attemptId: 'a1', phonePeerId: 'p1', callerId: 'u1' });
    expect(scheduled[0].delay).toBe(180_000);
    now += 180_001; scheduled[0].fn(); await Promise.resolve(); await Promise.resolve();
    expect(service.hasActive('tv')).toBe(false);
    expect(service.authorize({ clientId: 'late', topic: body.topic, credential: body.phoneCredential,
      role: 'phone', peerId: 'p1' }).ok).toBe(false);
  });

  it('expires an active lease when either participant is stale for 20 seconds', async () => {
    let now = 1_000;
    const scheduled = [];
    const dev = device({ getState: vi.fn(async () => ({ power: { state: 'on' }, content: { currentUrl: '/screen/home' } })) });
    const service = new CallLeaseService({
      deviceService: { get: () => dev }, wakeAndLoadService: { execute: vi.fn() },
      logger: { info() {}, warn() {} }, clock: () => now,
      setTimer: (fn, delay) => { const timer = { fn, delay, unref() {} }; scheduled.push(timer); return timer; },
      clearTimer: vi.fn(),
    });
    const { body } = await service.reserve({ deviceId: 'tv', attemptId: 'a1', phonePeerId: 'p1', callerId: 'u1' });
    const joined = service.joinActive({ deviceId: 'tv', declaredDeviceId: 'tv', isLocal: true }).body;
    service.authorize({ clientId: 'p', topic: body.topic, credential: body.phoneCredential, role: 'phone', peerId: 'p1' });
    service.authorize({ clientId: 't', topic: body.topic, credential: joined.tvCredential, role: 'tv', peerId: joined.tvPeerId });
    const send = (clientId, role, peerId, type, sequence) => service.validateSignal(clientId, {
      topic: body.topic, callId: body.callId, attemptId: 'a1', role, peerId, revision: 0, sequence, type, payload: {},
    });
    send('t', 'tv', joined.tvPeerId, 'waiting', 0); send('p', 'phone', 'p1', 'offer', 0);
    send('t', 'tv', joined.tvPeerId, 'answer', 1); send('p', 'phone', 'p1', 'media-verified', 1);
    send('t', 'tv', joined.tvPeerId, 'media-verified', 2);
    expect(service.get(body.callId).state).toBe('active');
    now += 20_001;
    scheduled.findLast(timer => timer.delay === 20_000).fn();
    await Promise.resolve(); await Promise.resolve();
    expect(service.hasActive('tv')).toBe(false);
  });

  it('does not let one participant heartbeat postpone the other participant stale deadline', async () => {
    let now = 1_000;
    const scheduled = [];
    const service = new CallLeaseService({
      deviceService: { get: () => device({ getState: vi.fn(async () => ({ power: { state: 'on' } })) }) },
      wakeAndLoadService: { execute: vi.fn() }, logger: { info() {}, warn() {} }, clock: () => now,
      setTimer: (fn, delay) => { const timer = { fn, delay, unref() {} }; scheduled.push(timer); return timer; },
      clearTimer: vi.fn(),
    });
    const { body } = await service.reserve({ deviceId: 'tv', attemptId: 'a1', phonePeerId: 'p1', callerId: 'u1' });
    const joined = service.joinActive({ deviceId: 'tv', declaredDeviceId: 'tv', isLocal: true }).body;
    service.authorize({ clientId: 'p', topic: body.topic, credential: body.phoneCredential, role: 'phone', peerId: 'p1' });
    service.authorize({ clientId: 't', topic: body.topic, credential: joined.tvCredential, role: 'tv', peerId: joined.tvPeerId });
    const send = (clientId, role, peerId, type, sequence) => service.validateSignal(clientId, {
      topic: body.topic, callId: body.callId, attemptId: 'a1', role, peerId, revision: 0, sequence, type, payload: {},
    });
    send('t', 'tv', joined.tvPeerId, 'waiting', 0); send('p', 'phone', 'p1', 'offer', 0);
    send('t', 'tv', joined.tvPeerId, 'answer', 1); send('p', 'phone', 'p1', 'media-verified', 1);
    send('t', 'tv', joined.tvPeerId, 'media-verified', 2);
    now += 5_000;
    send('p', 'phone', 'p1', 'heartbeat', 2);
    expect(scheduled.at(-1).delay).toBe(15_000);
    now += 15_001; scheduled.at(-1).fn();
    await Promise.resolve(); await Promise.resolve();
    expect(service.hasActive('tv')).toBe(false);
  });

  it('completes the mocked lease, wake, two-peer media, and restoration lifecycle', async () => {
    const { service, dev } = make();
    const { body } = await service.reserve({ deviceId: 'tv', attemptId: 'a1', phonePeerId: 'p1', callerId: 'u1' });
    expect((await service.wake(body.callId, 'u1')).kind).toBe('ok');
    const joined = service.joinActive({ deviceId: 'tv', declaredDeviceId: 'tv', isLocal: true }).body;
    expect(service.authorize({ clientId: 'p', topic: body.topic, credential: body.phoneCredential, role: 'phone', peerId: 'p1' }).ok).toBe(true);
    expect(service.authorize({ clientId: 't', topic: body.topic, credential: joined.tvCredential, role: 'tv', peerId: joined.tvPeerId }).ok).toBe(true);
    const send = (clientId, role, peerId, type, sequence) => service.validateSignal(clientId, {
      topic: body.topic, callId: body.callId, attemptId: 'a1', role, peerId, revision: 0, sequence, type, payload: {},
    });
    expect(send('t', 'tv', joined.tvPeerId, 'waiting', 0).ok).toBe(true);
    expect(send('p', 'phone', 'p1', 'offer', 0).ok).toBe(true);
    expect(send('t', 'tv', joined.tvPeerId, 'answer', 1).ok).toBe(true);
    expect(send('p', 'phone', 'p1', 'media-verified', 1).ok).toBe(true);
    expect(send('t', 'tv', joined.tvPeerId, 'media-verified', 2).ok).toBe(true);
    expect(service.get(body.callId).state).toBe('active');
    const ended = await service.end(body.callId, 'u1', 'hangup');
    expect(ended.body.restoration).toMatchObject({ outcome: 'restored', action: 'power_off' });
    expect(dev.powerOff).toHaveBeenCalledTimes(1);
  });
});
