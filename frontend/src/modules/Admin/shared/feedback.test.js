import { describe, it, expect, vi, beforeEach } from 'vitest';

const { showMock, logSpy } = vi.hoisted(() => ({
  showMock: vi.fn(),
  logSpy: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: (...args) => showMock(...args) },
}));

vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => logSpy }),
}));

import {
  notifySuccess,
  notifyFailure,
  notifyPartial,
  runWithFeedback,
} from './feedback.js';

beforeEach(() => {
  showMock.mockClear();
  logSpy.info.mockClear();
  logSpy.warn.mockClear();
  logSpy.error.mockClear();
  logSpy.debug.mockClear();
});

describe('notifySuccess', () => {
  it('shows a green toast with the given title and message', () => {
    notifySuccess({ title: 'Played', message: 'white now playing' });
    expect(showMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Played',
      message: 'white now playing',
      color: 'green',
      autoClose: 3000,
    }));
  });
});

describe('notifyFailure', () => {
  it('shows a red toast that does NOT auto-close', () => {
    notifyFailure({ title: 'Play failed', message: 'white: unreachable' });
    expect(showMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Play failed',
      message: 'white: unreachable',
      color: 'red',
      autoClose: false,
    }));
  });
});

describe('notifyPartial', () => {
  it('shows a yellow toast listing applied and skipped', () => {
    notifyPartial({
      title: 'Play partial',
      applied: ['red', 'blue'],
      skipped: [{ color: 'white', reason: 'unreachable' }],
    });
    const call = showMock.mock.calls[0][0];
    expect(call.color).toBe('yellow');
    expect(call.title).toBe('Play partial');
    expect(call.message).toContain('red, blue');
    expect(call.message).toContain('white: unreachable');
    expect(call.autoClose).toBe(7000);
  });
});

describe('runWithFeedback', () => {
  it('returns { ok: true, result } when fn resolves and shows a success toast', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true, applied: ['red'], skipped: [] });
    const out = await runWithFeedback(fn, {
      logger: logSpy,
      eventName: 'playback-hub.play',
      successTitle: 'Played',
      successMessage: (r) => `applied: ${r.applied.join(',')}`,
      partialFromResult: (r) => ({
        applied: r.applied,
        skipped: r.skipped,
        isPartial: r.skipped?.length > 0,
      }),
    });

    expect(out).toEqual({ ok: true, result: { ok: true, applied: ['red'], skipped: [] } });
    expect(showMock).toHaveBeenCalledWith(expect.objectContaining({ color: 'green' }));
    expect(logSpy.info).toHaveBeenCalledWith('playback-hub.play.success', expect.any(Object));
  });

  it('shows a partial toast when partialFromResult flags isPartial', async () => {
    const fn = vi.fn().mockResolvedValue({
      ok: true,
      applied: ['red'],
      skipped: [{ color: 'white', reason: 'unreachable' }],
    });
    const out = await runWithFeedback(fn, {
      logger: logSpy,
      eventName: 'playback-hub.play',
      successTitle: 'Played',
      partialTitle: 'Play partial',
      partialFromResult: (r) => ({
        applied: r.applied,
        skipped: r.skipped,
        isPartial: r.skipped.length > 0,
      }),
    });

    expect(out.ok).toBe(true);
    expect(showMock).toHaveBeenCalledWith(expect.objectContaining({ color: 'yellow' }));
    expect(logSpy.warn).toHaveBeenCalledWith('playback-hub.play.partial', expect.any(Object));
  });

  it('returns { ok: false, error } and shows a failure toast on throw', async () => {
    const err = new Error('HTTP 502');
    const fn = vi.fn().mockRejectedValue(err);
    const out = await runWithFeedback(fn, {
      logger: logSpy,
      eventName: 'playback-hub.play',
      failureTitle: 'Play failed',
    });

    expect(out).toEqual({ ok: false, error: err });
    expect(showMock).toHaveBeenCalledWith(expect.objectContaining({
      color: 'red',
      title: 'Play failed',
      message: 'HTTP 502',
    }));
    expect(logSpy.error).toHaveBeenCalledWith('playback-hub.play.failure', expect.objectContaining({
      message: 'HTTP 502',
    }));
  });

  it('logs an info event when the fn starts (in-flight signal)', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true });
    await runWithFeedback(fn, {
      logger: logSpy,
      eventName: 'playback-hub.play',
    });
    expect(logSpy.info).toHaveBeenCalledWith('playback-hub.play.started', expect.any(Object));
  });
});
