import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PianoMidiWakeService } from '#apps/devices/services/PianoMidiWakeService.mjs';

function makeClock() {
  let now = 1_700_000_000_000;
  return { now: () => now, advance: (ms) => { now += ms; } };
}

/** Minimal EventEmitter-ish fake WS that records instances + lets tests emit. */
function makeWsFactory() {
  const instances = [];
  class FakeWs {
    constructor(url) {
      this.url = url;
      this.handlers = {};
      this.closed = false;
      instances.push(this);
    }
    on(event, cb) { this.handlers[event] = cb; return this; }
    emit(event, arg) { this.handlers[event]?.(arg); }
    close() { this.closed = true; this.emit('close'); }
  }
  return { FakeWs, instances };
}

function makeDeviceService() {
  const setScreen = vi.fn().mockResolvedValue({ ok: true });
  const device = { setScreen };
  return {
    setScreen,
    deviceService: { get: vi.fn(() => device) },
  };
}

const NOTE_ON = Buffer.from(JSON.stringify({ type: 'note.on', note: 60, velocity: 100 }));
const NOTE_OFF = Buffer.from(JSON.stringify({ type: 'note.off', note: 60 }));

describe('PianoMidiWakeService', () => {
  let clock; let ws; let devices; let svc;

  beforeEach(() => {
    clock = makeClock();
    ws = makeWsFactory();
    devices = makeDeviceService();
    svc = new PianoMidiWakeService({
      deviceService: devices.deviceService,
      deviceId: 'yellow-room-tablet',
      bridgeUrl: 'ws://tablet:8770',
      clock,
      cooldownMs: 8000,
      WebSocketImpl: ws.FakeWs,
      logger: { info() {}, warn() {}, error() {} },
    });
  });

  it('opens a WS to the bridge on start', () => {
    svc.start();
    expect(ws.instances).toHaveLength(1);
    expect(ws.instances[0].url).toBe('ws://tablet:8770');
  });

  it('wakes the screen on a note.on', async () => {
    svc.start();
    ws.instances[0].emit('open');
    ws.instances[0].emit('message', NOTE_ON);
    await Promise.resolve(); await Promise.resolve();
    expect(devices.setScreen).toHaveBeenCalledTimes(1);
    expect(devices.setScreen).toHaveBeenCalledWith(true);
  });

  it('ignores non note.on frames', async () => {
    svc.start();
    ws.instances[0].emit('message', NOTE_OFF);
    ws.instances[0].emit('message', Buffer.from(JSON.stringify({ type: 'status' })));
    ws.instances[0].emit('message', Buffer.from('not json'));
    await Promise.resolve();
    expect(devices.setScreen).not.toHaveBeenCalled();
  });

  it('debounces a burst of notes to one wake per cooldown window', async () => {
    svc.start();
    const w = ws.instances[0];
    w.emit('open');
    // three notes in quick succession → one wake
    w.emit('message', NOTE_ON);
    await Promise.resolve(); await Promise.resolve();
    clock.advance(100); w.emit('message', NOTE_ON);
    clock.advance(100); w.emit('message', NOTE_ON);
    await Promise.resolve();
    expect(devices.setScreen).toHaveBeenCalledTimes(1);

    // after the cooldown elapses, the next note wakes again
    clock.advance(8000);
    w.emit('message', NOTE_ON);
    await Promise.resolve(); await Promise.resolve();
    expect(devices.setScreen).toHaveBeenCalledTimes(2);
  });

  it('reconnects with a fresh socket after the socket closes', () => {
    vi.useFakeTimers();
    try {
      svc.start();
      expect(ws.instances).toHaveLength(1);
      ws.instances[0].emit('close');
      vi.advanceTimersByTime(1000); // backoffBaseMs
      expect(ws.instances).toHaveLength(2);
      expect(ws.instances[1].url).toBe('ws://tablet:8770');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop() closes the socket and halts reconnects', () => {
    vi.useFakeTimers();
    try {
      svc.start();
      const w = ws.instances[0];
      svc.stop();
      expect(w.closed).toBe(true);
      // a close event after stop must NOT schedule a reconnect
      w.emit('close');
      vi.advanceTimersByTime(60000);
      expect(ws.instances).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
