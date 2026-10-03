import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBridgeHealth, createWebSocketSupervisor } from '../src/webSocketSupervisor.mjs';

class FakeClock {
  now = 0;
  nextId = 1;
  timers = new Map();

  setTimeout = (fn, ms) => this.#add(fn, ms, false);
  clearTimeout = (id) => this.timers.delete(id);
  setInterval = (fn, ms) => this.#add(fn, ms, true);
  clearInterval = (id) => this.timers.delete(id);

  #add(fn, ms, repeat) {
    const id = this.nextId++;
    this.timers.set(id, { at: this.now + ms, fn, ms, repeat });
    return id;
  }

  advance(ms) {
    const target = this.now + ms;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      const [id, timer] = due;
      this.now = timer.at;
      if (timer.repeat) timer.at += timer.ms;
      else this.timers.delete(id);
      timer.fn();
    }
    this.now = target;
  }
}

class FakeSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = FakeSocket.CONNECTING;
  sent = [];
  terminated = 0;
  pings = 0;

  send(value) { this.sent.push(value); }
  ping() { this.pings += 1; }
  terminate() {
    this.terminated += 1;
    this.readyState = FakeSocket.CLOSED;
    this.emit('close');
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.emit('open');
  }
}

function setup(overrides = {}) {
  const clock = new FakeClock();
  const sockets = [];
  const exits = [];
  const supervisor = createWebSocketSupervisor({
    url: 'wss://daylight.test/ws',
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    socketStates: FakeSocket,
    now: () => clock.now,
    timers: clock,
    exit: (code) => exits.push(code),
    logger: { info() {}, warn() {}, error() {} },
    onOpen() {},
    onMessage() {},
    ...overrides,
  });
  return { clock, sockets, exits, supervisor };
}

test('a WebSocket handshake stuck in CONNECTING is terminated and retried', () => {
  const { clock, sockets, supervisor } = setup();
  supervisor.start();
  assert.equal(sockets.length, 1);

  clock.advance(10_000);
  assert.equal(sockets[0].terminated, 1);

  clock.advance(999);
  assert.equal(sockets.length, 1);
  clock.advance(1);
  assert.equal(sockets.length, 2);
});

test('retry delay grows exponentially and caps at 30 seconds', () => {
  const { clock, sockets, supervisor } = setup();
  supervisor.start();

  const expectedDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
  for (const delay of expectedDelays) {
    const current = sockets.at(-1);
    current.emit('error', new Error('offline'));
    current.readyState = FakeSocket.CLOSED;
    current.emit('close');
    clock.advance(delay - 1);
    assert.equal(sockets.at(-1), current);
    clock.advance(1);
    assert.notEqual(sockets.at(-1), current);
  }
});

test('a synchronous socket-construction failure enters the retry loop', () => {
  const clock = new FakeClock();
  let calls = 0;
  const supervisor = createWebSocketSupervisor({
    url: 'wss://daylight.test/ws',
    createSocket: () => {
      calls += 1;
      if (calls === 1) throw new Error('constructor failed');
      return new FakeSocket();
    },
    socketStates: FakeSocket,
    now: () => clock.now,
    timers: clock,
    exit() {},
    logger: { info() {}, warn() {}, error() {} },
    onOpen() {},
    onMessage() {},
  });

  assert.doesNotThrow(() => supervisor.start());
  assert.equal(supervisor.getStatus().retryScheduled, true);
  clock.advance(1_000);
  assert.equal(calls, 2);
  assert.equal(supervisor.getStatus().phase, 'connecting');
});

test('an open socket with no replies is terminated and recovery begins', () => {
  const { clock, sockets, supervisor } = setup();
  supervisor.start();
  sockets[0].open();

  clock.advance(20_000);
  assert.equal(sockets[0].terminated, 1);
  clock.advance(1_000);
  assert.equal(sockets.length, 2);
});

test('a recovered connection logs the completed outage duration', () => {
  const messages = [];
  const { clock, sockets, supervisor } = setup({
    logger: {
      info: (message) => messages.push(message),
      warn() {},
      error() {},
    },
  });
  supervisor.start();
  clock.advance(7_000);
  sockets[0].open();

  assert.deepEqual(messages, ['WebSocket connection operational after 7000ms outage']);
});

test('events from an obsolete socket cannot replace or retry over the active socket', () => {
  const { clock, sockets, supervisor } = setup();
  supervisor.start();
  const first = sockets[0];
  first.emit('error', new Error('offline'));
  clock.advance(1_000);
  const second = sockets[1];
  second.open();

  first.emit('close');
  clock.advance(2_000);
  assert.equal(sockets.length, 2);
  assert.equal(supervisor.getClient(), second);
  assert.equal(supervisor.getStatus().phase, 'open');
});

test('the watchdog restarts recovery when no socket or retry deadline exists', () => {
  const { clock, sockets, supervisor } = setup();
  supervisor.start();
  sockets[0].open();
  sockets[0].readyState = FakeSocket.CLOSED;

  clock.advance(30_000);
  assert.equal(sockets.length, 2);
});

test('a successful connection resets outage duration and attempt count', () => {
  const { clock, sockets, supervisor } = setup();
  supervisor.start();
  sockets[0].emit('error', new Error('offline'));
  clock.advance(1_000);
  clock.advance(4_000);
  sockets[1].open();

  assert.deepEqual(supervisor.getStatus(), {
    connected: true,
    phase: 'open',
    retryScheduled: false,
    attempts: 0,
    outageMs: 0,
  });
});

test('continuous disconnection exits after 120 seconds', () => {
  const { clock, exits, supervisor } = setup();
  supervisor.start();
  clock.advance(119_999);
  assert.deepEqual(exits, []);
  clock.advance(1);
  assert.deepEqual(exits, [1]);
});

test('a backend outage shorter than 120 seconds does not invoke the exit failsafe', () => {
  const { clock, sockets, exits, supervisor } = setup();
  supervisor.start();
  clock.advance(60_000);
  sockets.at(-1).open();
  clock.advance(120_000);
  assert.deepEqual(exits, []);
});

test('bridge health is unavailable until its event channel is open', () => {
  assert.deepEqual(buildBridgeHealth({
    connected: false, phase: 'retrying', retryScheduled: true, attempts: 4, outageMs: 45_000,
  }), {
    httpStatus: 503,
    body: {
      status: 'unhealthy',
      websocket: { connected: false, phase: 'retrying', retryScheduled: true, attempts: 4, outageMs: 45_000 },
    },
  });
});

test('bridge health is healthy only after subscriptions complete', () => {
  assert.deepEqual(buildBridgeHealth({
    connected: true, phase: 'open', retryScheduled: false, attempts: 0, outageMs: 0,
  }), {
    httpStatus: 200,
    body: {
      status: 'healthy',
      websocket: { connected: true, phase: 'open', retryScheduled: false, attempts: 0, outageMs: 0 },
    },
  });
});
