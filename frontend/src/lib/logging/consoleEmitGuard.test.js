// frontend/src/lib/logging/consoleEmitGuard.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fakeLogger = { log: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('./singleton.js', () => ({
  getDaylightLogger: () => fakeLogger,
  getChildLogger: () => fakeLogger,
  default: () => fakeLogger,
}));

const { isEmittingToConsole, withConsoleEmit } = await import('./consoleEmitGuard.js');
const { interceptConsole } = await import('./consoleInterceptor.js');

describe('consoleEmitGuard', () => {
  it('is off outside an emit and restores the previous value after', () => {
    expect(isEmittingToConsole()).toBe(false);
    expect(withConsoleEmit(() => isEmittingToConsole())).toBe(true);
    expect(isEmittingToConsole()).toBe(false);
  });

  it('clears the flag even when the console call throws', () => {
    expect(() => withConsoleEmit(() => { throw new Error('boom'); })).toThrow('boom');
    expect(isEmittingToConsole()).toBe(false);
  });
});

describe('consoleInterceptor does not re-ingest the logger own output', () => {
  let restore;
  beforeEach(() => {
    Object.values(fakeLogger).forEach((fn) => fn.mockClear());
    restore = interceptConsole();
  });
  afterEach(() => { restore?.(); });

  it('forwards an ordinary app warning', () => {
    fakeLogger.warn.mockClear();
    console.warn('a real app warning');
    expect(fakeLogger.warn).toHaveBeenCalledTimes(1);
    expect(fakeLogger.warn).toHaveBeenCalledWith('console.warn', {
      args: ['a real app warning'],
    });
  });

  it('drops the console write the logger itself makes', () => {
    fakeLogger.warn.mockClear();
    // Exactly what Logger.js devOutput does for a warn-level event.
    withConsoleEmit(() => console.warn('[Logger] audio-shader.dimensions {"x":-10000}'));
    // Without the guard this shipped a second `console.warn` event carrying the
    // first event's formatted text — doubling every warn and error.
    expect(fakeLogger.warn).not.toHaveBeenCalled();
  });

  it('drops the logger own errors too, and resumes forwarding after', () => {
    fakeLogger.error.mockClear();
    withConsoleEmit(() => console.error('[Logger] playback.queue-init-timeout {}'));
    expect(fakeLogger.error).not.toHaveBeenCalled();

    console.error('a real app error');
    expect(fakeLogger.error).toHaveBeenCalledTimes(1);
  });
});
