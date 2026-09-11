import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The module exports a singleton; each test needs its own.
const freshService = async () => {
  vi.resetModules();
  vi.doMock('../lib/logging/Logger.js', () => ({
    default: () => ({ child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }),
  }));
  const mod = await import('./WebSocketService.js');
  return mod.default ?? mod.wsService ?? mod.WebSocketService;
};

describe('degraded-mode auto-reload', () => {
  let reload;
  beforeEach(() => {
    vi.useFakeTimers();
    reload = vi.fn();
    // jsdom's location.reload is non-configurable in some versions; replace the
    // whole accessor so the timer's call is observable either way.
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } });
  });
  afterEach(() => { vi.useRealTimers(); vi.doUnmock('../lib/logging/Logger.js'); });

  const degrade = (service) => {
    service.degradedMode = true;
    service._startAutoReloadTimer();
  };

  it('reloads a kiosk left in degraded mode, which is the only self-repair it has', async () => {
    const service = await freshService();
    degrade(service);
    vi.advanceTimersByTime(180_000);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('a held suppressor withholds the reload, and RELEASING it re-arms', async () => {
    const service = await freshService();
    const release = service.suppressAutoReload('call');
    degrade(service);
    vi.advanceTimersByTime(180_000);
    expect(reload).not.toHaveBeenCalled();

    // This is the regression. `useCallSignaling` used to flip a tab-wide boolean
    // off here and never flip it back, so a kiosk that had taken ONE video call
    // spent the rest of its uptime unable to repair itself. Releasing must
    // restore the reload for a connection that is STILL degraded.
    release();
    vi.advanceTimersByTime(180_000);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('counts holders, so one release cannot unlock another holder’s suppression', async () => {
    const service = await freshService();
    const releaseCall = service.suppressAutoReload('call');
    const releasePlayback = service.suppressAutoReload('playback');
    degrade(service);

    releaseCall();
    vi.advanceTimersByTime(180_000);
    expect(reload).not.toHaveBeenCalled();
    expect(service.autoReloadSuppressed).toBe(true);

    releasePlayback();
    vi.advanceTimersByTime(180_000);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('releasing twice cannot drive the count negative under a live holder', async () => {
    const service = await freshService();
    const release = service.suppressAutoReload('call');
    const other = service.suppressAutoReload('playback');
    release(); release(); release();
    expect(service.autoReloadSuppressed).toBe(true);
    other();
    expect(service.autoReloadSuppressed).toBe(false);
  });

  it('a successful connection clears a pending reload rather than firing it late', async () => {
    const service = await freshService();
    degrade(service);
    vi.advanceTimersByTime(120_000);
    service._clearAutoReloadTimer();
    service.degradedMode = false;
    vi.advanceTimersByTime(600_000);
    expect(reload).not.toHaveBeenCalled();
  });
});
