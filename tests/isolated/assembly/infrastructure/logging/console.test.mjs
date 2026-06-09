// tests/isolated/assembly/infrastructure/logging/console.test.mjs
import { vi } from 'vitest';
import { createConsoleTransport } from '#backend/src/0_system/logging/transports/console.mjs';

const ANSI_PATTERN = /\x1b\[\d+m/;

describe('ConsoleTransport', () => {
  let stdoutWrite;
  let stderrWrite;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
  });

  const makeEvent = (overrides = {}) => ({
    ts: '2026-06-09T10:00:00.000',
    level: 'info',
    event: 'test.event',
    data: { foo: 'bar' },
    context: { app: 'myApp', source: 'backend' },
    ...overrides
  });

  test('has name "console"', () => {
    expect(createConsoleTransport().name).toBe('console');
  });

  describe('stream routing', () => {
    test('info events go to stdout', () => {
      const transport = createConsoleTransport();
      transport.send(makeEvent({ level: 'info' }));

      expect(stdoutWrite).toHaveBeenCalledTimes(1);
      expect(stderrWrite).not.toHaveBeenCalled();
    });

    test('debug events go to stdout', () => {
      const transport = createConsoleTransport();
      transport.send(makeEvent({ level: 'debug' }));

      expect(stdoutWrite).toHaveBeenCalledTimes(1);
      expect(stderrWrite).not.toHaveBeenCalled();
    });

    test('warn events go to stderr', () => {
      const transport = createConsoleTransport();
      transport.send(makeEvent({ level: 'warn' }));

      expect(stderrWrite).toHaveBeenCalledTimes(1);
      expect(stdoutWrite).not.toHaveBeenCalled();
    });

    test('error events go to stderr', () => {
      const transport = createConsoleTransport();
      transport.send(makeEvent({ level: 'error' }));

      expect(stderrWrite).toHaveBeenCalledTimes(1);
      expect(stdoutWrite).not.toHaveBeenCalled();
    });
  });

  describe('json format (default)', () => {
    test('writes the full event as a single JSON line', () => {
      const transport = createConsoleTransport();
      const event = makeEvent();
      transport.send(event);

      const output = stdoutWrite.mock.calls[0][0];
      expect(output.endsWith('\n')).toBe(true);
      expect(JSON.parse(output)).toEqual(event);
    });

    test('json output contains no ANSI color codes', () => {
      const transport = createConsoleTransport({ format: 'json', colorize: true });
      transport.send(makeEvent());

      expect(stdoutWrite.mock.calls[0][0]).not.toMatch(ANSI_PATTERN);
    });
  });

  describe('pretty format', () => {
    test('includes padded uppercase level and event name', () => {
      const transport = createConsoleTransport({ format: 'pretty', colorize: false });
      transport.send(makeEvent({ level: 'info', event: 'user.login' }));

      const output = stdoutWrite.mock.calls[0][0];
      expect(output).toContain('[INFO ]'); // padEnd(5)
      expect(output).toContain('user.login');
    });

    test('includes JSON-serialized data when data has keys', () => {
      const transport = createConsoleTransport({ format: 'pretty', colorize: false });
      transport.send(makeEvent({ data: { userId: 123 } }));

      expect(stdoutWrite.mock.calls[0][0]).toContain('{"userId":123}');
    });

    test('omits data section when data is empty', () => {
      const transport = createConsoleTransport({ format: 'pretty', colorize: false });
      transport.send(makeEvent({ data: {}, context: {} }));

      const output = stdoutWrite.mock.calls[0][0];
      expect(output).not.toContain('{}');
      expect(output.trim()).toBe('[INFO ] test.event');
    });

    test('appends app context in parentheses', () => {
      const transport = createConsoleTransport({ format: 'pretty', colorize: false });
      transport.send(makeEvent({ context: { app: 'fitness' } }));

      expect(stdoutWrite.mock.calls[0][0]).toContain('(fitness)');
    });

    test('colorize true (default) emits ANSI codes', () => {
      const transport = createConsoleTransport({ format: 'pretty' });
      transport.send(makeEvent({ level: 'error' }));

      const output = stderrWrite.mock.calls[0][0];
      expect(output).toMatch(ANSI_PATTERN);
      expect(output).toContain('\x1b[31m'); // red for error
    });

    test('colorize false emits no ANSI codes', () => {
      const transport = createConsoleTransport({ format: 'pretty', colorize: false });
      transport.send(makeEvent({ level: 'error' }));

      expect(stderrWrite.mock.calls[0][0]).not.toMatch(ANSI_PATTERN);
    });

    test('unknown level gets no color but still renders', () => {
      const transport = createConsoleTransport({ format: 'pretty', colorize: true });
      transport.send(makeEvent({ level: 'trace', data: {}, context: {} }));

      const output = stdoutWrite.mock.calls[0][0];
      expect(output).toContain('[TRACE]');
      expect(output).toContain('test.event');
    });
  });
});
