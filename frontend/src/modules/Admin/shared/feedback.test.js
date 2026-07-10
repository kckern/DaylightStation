import { describe, it, expect, vi, beforeEach } from 'vitest';

const { showMock, hideMock, logSpy } = vi.hoisted(() => ({
  showMock: vi.fn(),
  hideMock: vi.fn(),
  logSpy: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: (...args) => showMock(...args), hide: (...args) => hideMock(...args) },
}));

vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => logSpy }),
}));

import {
  notifySuccess,
  notifyFailure,
  notifyPartial,
  runWithFeedback,
  showUndoToast,
} from './feedback.js';

beforeEach(() => {
  showMock.mockClear();
  hideMock.mockClear();
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

describe('showUndoToast', () => {
  it('shows a gray toast with the given id, title and autoClose', () => {
    showUndoToast({ id: 'undo-x', title: 'Item deleted', message: 'Removed "Foo"', onUndo: () => {}, timeoutMs: 5000 });
    expect(showMock).toHaveBeenCalledWith(expect.objectContaining({
      id: 'undo-x',
      title: 'Item deleted',
      color: 'gray',
      autoClose: 5000,
    }));
  });

  it('invokes onUndo and hides the toast when the Undo button is clicked', () => {
    const onUndo = vi.fn();
    showUndoToast({ id: 'undo-y', title: 'Deleted', message: 'gone', onUndo });
    // The message is a React element tree; find the Undo button node and fire its onClick.
    const shown = showMock.mock.calls[0][0];
    const findButton = (node) => {
      if (!node || typeof node !== 'object') return null;
      if (node.props?.['data-testid'] === 'undo-toast-button') return node;
      const kids = node.props?.children;
      const arr = Array.isArray(kids) ? kids : [kids];
      for (const k of arr) {
        const found = findButton(k);
        if (found) return found;
      }
      return null;
    };
    const btn = findButton(shown.message);
    expect(btn).toBeTruthy();
    btn.props.onClick();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(hideMock).toHaveBeenCalledWith('undo-y');
  });

  it('defaults autoClose to 7000ms', () => {
    showUndoToast({ id: 'undo-z', title: 't', message: 'm', onUndo: () => {} });
    expect(showMock).toHaveBeenCalledWith(expect.objectContaining({ autoClose: 7000 }));
  });
});
