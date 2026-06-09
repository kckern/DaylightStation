// tests/isolated/assembly/infrastructure/logging/loggly.test.mjs
import { vi } from 'vitest';

// Mock winston + winston-loggly-bulk so no network/bulk machinery runs.
const mocks = vi.hoisted(() => {
  const winstonLog = vi.fn();
  const logglyCtor = vi.fn();
  const logglyOn = vi.fn();
  return { winstonLog, logglyCtor, logglyOn };
});

vi.mock('winston-loggly-bulk', () => ({
  Loggly: class {
    constructor(options) {
      mocks.logglyCtor(options);
    }
    on(eventName, handler) {
      mocks.logglyOn(eventName, handler);
    }
  }
}));

vi.mock('winston', () => ({
  default: {
    createLogger: vi.fn(() => ({ log: mocks.winstonLog })),
    format: { json: vi.fn(() => ({})) }
  }
}));

import { createLogglyTransport } from '#backend/src/0_system/logging/transports/loggly.mjs';

describe('LogglyTransport', () => {
  let stderrWrite;

  const validOptions = { token: 'tok-123', subdomain: 'myhouse' };

  const makeEvent = (overrides = {}) => ({
    ts: '2026-06-09T10:00:00.000',
    level: 'info',
    event: 'test.event',
    message: 'hello',
    data: { foo: 'bar' },
    context: { app: 'fitness', source: 'backend', sessionId: 'sess-1' },
    tags: ['t1'],
    ...overrides
  });

  beforeEach(() => {
    mocks.winstonLog.mockClear();
    mocks.logglyCtor.mockClear();
    mocks.logglyOn.mockClear();
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrWrite.mockRestore();
  });

  describe('when not configured', () => {
    test('missing token returns a no-op disabled transport', () => {
      const transport = createLogglyTransport({ subdomain: 'myhouse' });

      expect(transport.name).toBe('loggly-disabled');
      expect(() => transport.send(makeEvent())).not.toThrow();
      expect(mocks.winstonLog).not.toHaveBeenCalled();
      expect(mocks.logglyCtor).not.toHaveBeenCalled();
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('Missing token or subdomain'));
    });

    test('missing subdomain returns a no-op disabled transport', () => {
      const transport = createLogglyTransport({ token: 'tok-123' });

      expect(transport.name).toBe('loggly-disabled');
      expect(mocks.logglyCtor).not.toHaveBeenCalled();
    });
  });

  describe('configuration', () => {
    test('constructs the bulk transport with token, subdomain, tags and buffer size', () => {
      createLogglyTransport({ ...validOptions, tags: ['daylight', 'prod'], bufferSize: 25 });

      expect(mocks.logglyCtor).toHaveBeenCalledWith(expect.objectContaining({
        token: 'tok-123',
        subdomain: 'myhouse',
        tags: ['daylight', 'prod'],
        json: true,
        isBulk: true,
        bufferOptions: expect.objectContaining({ size: 25 })
      }));
    });

    test('defaults tags to ["daylight"] and bufferSize to 50', () => {
      createLogglyTransport(validOptions);

      expect(mocks.logglyCtor).toHaveBeenCalledWith(expect.objectContaining({
        tags: ['daylight'],
        bufferOptions: expect.objectContaining({ size: 50 })
      }));
    });

    test('registers an error handler that writes to stderr without throwing', () => {
      createLogglyTransport(validOptions);

      const errorRegistration = mocks.logglyOn.mock.calls.find(([name]) => name === 'error');
      expect(errorRegistration).toBeDefined();

      const handler = errorRegistration[1];
      expect(() => handler(new Error('ETIMEDOUT'))).not.toThrow();
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('[LogglyTransport] Error: ETIMEDOUT'));
    });
  });

  describe('send', () => {
    test('forwards the event with level, name and flattened metadata fields', () => {
      const transport = createLogglyTransport(validOptions);
      transport.send(makeEvent({ level: 'warn', event: 'rate.limit' }));

      expect(mocks.winstonLog).toHaveBeenCalledWith('warn', 'rate.limit', expect.objectContaining({
        ts: '2026-06-09T10:00:00.000',
        message: 'hello',
        data: { foo: 'bar' },
        context: expect.objectContaining({ app: 'fitness' }),
        tags: ['t1'],
        _event: 'rate.limit',
        _source: 'backend',
        _app: 'fitness',
        _level: 'warn'
      }));
    });

    test('counts events sent in status', () => {
      const transport = createLogglyTransport(validOptions);
      transport.send(makeEvent());
      transport.send(makeEvent());

      expect(transport.getStatus().eventsSent).toBe(2);
    });
  });

  describe('startup-metric throttling', () => {
    const startupMetric = (extra = {}, contextExtra = {}) => makeEvent({
      event: 'playback.media-metric',
      data: { metric: 'startup_duration_ms', value: 100, waitKey: 'wait-1', ...extra },
      context: { app: 'tv', source: 'frontend', ...contextExtra }
    });

    test('sends the first sample and drops intermediate ones for the same key', () => {
      const transport = createLogglyTransport(validOptions);

      transport.send(startupMetric());          // first → sent
      transport.send(startupMetric());          // intermediate → dropped
      transport.send(startupMetric());          // intermediate → dropped

      expect(mocks.winstonLog).toHaveBeenCalledTimes(1);
    });

    test('sends the final sample once and drops further finals', () => {
      const transport = createLogglyTransport(validOptions);

      transport.send(startupMetric());                    // first → sent
      transport.send(startupMetric());                    // dropped
      transport.send(startupMetric({ final: true }));     // final → sent
      transport.send(startupMetric({ final: true }));     // duplicate final → dropped

      expect(mocks.winstonLog).toHaveBeenCalledTimes(2);
    });

    test('isFinal flag is honored like final', () => {
      const transport = createLogglyTransport(validOptions);

      transport.send(startupMetric());                    // first → sent
      transport.send(startupMetric({ isFinal: true }));   // final → sent

      expect(mocks.winstonLog).toHaveBeenCalledTimes(2);
    });

    test('different waitKeys are throttled independently', () => {
      const transport = createLogglyTransport(validOptions);

      transport.send(startupMetric({ waitKey: 'a' }));
      transport.send(startupMetric({ waitKey: 'b' }));
      transport.send(startupMetric({ waitKey: 'a' })); // dropped
      transport.send(startupMetric({ waitKey: 'b' })); // dropped

      expect(mocks.winstonLog).toHaveBeenCalledTimes(2);
    });

    test('falls back to sessionId then a global key when waitKey is absent', () => {
      const transport = createLogglyTransport(validOptions);

      transport.send(startupMetric({ waitKey: undefined }, { sessionId: 's1' })); // sent
      transport.send(startupMetric({ waitKey: undefined }, { sessionId: 's1' })); // dropped

      transport.send(startupMetric({ waitKey: undefined }, { sessionId: undefined })); // global key → sent
      transport.send(startupMetric({ waitKey: undefined }, { sessionId: undefined })); // dropped

      expect(mocks.winstonLog).toHaveBeenCalledTimes(2);
    });

    test('non-startup metrics are never throttled', () => {
      const transport = createLogglyTransport(validOptions);

      transport.send(makeEvent({ event: 'playback.media-metric', data: { metric: 'buffer_ms' } }));
      transport.send(makeEvent({ event: 'playback.media-metric', data: { metric: 'buffer_ms' } }));

      expect(mocks.winstonLog).toHaveBeenCalledTimes(2);
    });

    test('throttle state map is cleared past 2000 keys (no unbounded growth)', () => {
      const transport = createLogglyTransport(validOptions);

      transport.send(startupMetric({ waitKey: 'key-0' }));
      transport.send(startupMetric({ waitKey: 'key-0' })); // dropped, state remembered

      // Push the map over the 2000-key threshold
      for (let i = 1; i <= 2001; i++) {
        transport.send(startupMetric({ waitKey: `key-${i}` }));
      }

      mocks.winstonLog.mockClear();
      // After the clear, key-0 is treated as new again — first sample is sent
      transport.send(startupMetric({ waitKey: 'key-0' }));
      expect(mocks.winstonLog).toHaveBeenCalledTimes(1);
    });
  });

  describe('flush and getStatus', () => {
    test('flush resolves and records lastFlush timestamp', async () => {
      const transport = createLogglyTransport(validOptions);

      expect(transport.getStatus().lastFlush).toBeNull();
      await transport.flush();
      expect(transport.getStatus().lastFlush).toEqual(expect.any(String));
    });

    test('getStatus exposes config without leaking the raw token', () => {
      const transport = createLogglyTransport({ ...validOptions, tags: ['x'], bufferSize: 10 });

      const status = transport.getStatus();
      expect(status).toEqual({
        name: 'loggly',
        status: 'ok',
        eventsSent: 0,
        lastFlush: null,
        config: {
          subdomain: 'myhouse',
          tags: ['x'],
          bufferSize: 10,
          hasToken: true
        }
      });
      expect(JSON.stringify(status)).not.toContain('tok-123');
    });
  });
});
