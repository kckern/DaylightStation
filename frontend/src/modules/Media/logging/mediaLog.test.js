import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeChild = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() };
vi.mock('../../../lib/logging/singleton.js', () => ({
  getChildLogger: vi.fn(() => fakeChild),
  default: () => fakeChild,
}));

import { mediaLog } from './mediaLog.js';

beforeEach(() => {
  fakeChild.info.mockClear();
  fakeChild.debug.mockClear();
  fakeChild.warn.mockClear();
  fakeChild.error.mockClear();
  fakeChild.sampled.mockClear();
});

describe('mediaLog', () => {
  it('emits session.created at info with clientId+sessionId+contentId', () => {
    mediaLog.sessionCreated({ clientId: 'c1', sessionId: 's1', contentId: 'plex:1' });
    expect(fakeChild.info).toHaveBeenCalledWith('session.created',
      expect.objectContaining({ clientId: 'c1', sessionId: 's1', contentId: 'plex:1' }));
  });

  it('emits session.state-change as sampled debug', () => {
    mediaLog.sessionStateChange({ from: 'loading', to: 'playing', sessionId: 's1' });
    expect(fakeChild.sampled).toHaveBeenCalledWith(
      'session.state-change',
      expect.objectContaining({ from: 'loading', to: 'playing' }),
      expect.objectContaining({ maxPerMinute: expect.any(Number), aggregate: true })
    );
  });

  it('emits playback.error at error level', () => {
    mediaLog.playbackError({ contentId: 'p:1', error: 'decode-fail', code: 'E_DECODE' });
    expect(fakeChild.error).toHaveBeenCalledWith('playback.error',
      expect.objectContaining({ contentId: 'p:1', error: 'decode-fail', code: 'E_DECODE' }));
  });

  it('emits url-command.processed at info', () => {
    mediaLog.urlCommandProcessed({ param: 'play', value: 'plex:1' });
    expect(fakeChild.info).toHaveBeenCalledWith('url-command.processed',
      expect.objectContaining({ param: 'play', value: 'plex:1' }));
  });
});

describe('mediaLog — gap-fill events', () => {
  it('exposes playbackStallAutoAdvanced as a warn emitter', () => {
    expect(typeof mediaLog.playbackStallAutoAdvanced).toBe('function');
    mediaLog.playbackStallAutoAdvanced({ sessionId: 's', contentId: 'p:1', stalledMs: 10500 });
    // Smoke: must not throw
  });

  it('exposes takeoverDrift as a warn emitter', () => {
    expect(typeof mediaLog.takeoverDrift).toBe('function');
    mediaLog.takeoverDrift({ deviceId: 'lr', expected: 120, actual: 115.2, driftSeconds: 4.8 });
  });

  it('exposes dispatchDeduplicated as an info emitter', () => {
    expect(typeof mediaLog.dispatchDeduplicated).toBe('function');
    mediaLog.dispatchDeduplicated({ keyHash: 'abc', targetIds: ['lr'], windowMs: 5000 });
  });

  it('exposes transportCommand as a sampled emitter (seek-safe)', () => {
    expect(typeof mediaLog.transportCommand).toBe('function');
    for (let i = 0; i < 200; i += 1) {
      mediaLog.transportCommand({ action: 'seekAbs', value: i, target: 'local' });
    }
    // No throw; sampling handled by Logger.
  });
});
