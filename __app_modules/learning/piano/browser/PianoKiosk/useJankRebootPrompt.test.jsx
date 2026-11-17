import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useJankRebootPrompt } from './useJankRebootPrompt.js';
import RebootPromptModal from './RebootPromptModal.jsx';

vi.mock('../../../../../frontend/src/lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ warn() {}, error() {}, info() {} }) }) }));
const healthy = { deviceId: 'test-piano', payload: 'candidate', bootCount: 12, bootIdentitySource: 'settings.global.boot_count', lastBeatAgoMs: 100, beatCount: 2, liveness: 'alive', responsiveness: 'healthy', lastVisibility: 'visible', nativeRecoveryAllowed: true };
let clock, rafs, nextRaf;
function frame(ms) {
  clock += ms;
  act(() => { const pending = [...rafs.values()]; rafs.clear(); pending.forEach(cb => cb(clock)); });
}
beforeEach(() => {
  clock = 0; rafs = new Map(); nextRaf = 0;
  localStorage.clear();
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(Date, 'now').mockImplementation(() => 1_000_000 + clock);
  vi.stubGlobal('requestAnimationFrame', cb => { const id = ++nextRaf; rafs.set(id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', id => rafs.delete(id));
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete window.fully; });

describe('visible degradation', () => {
  it('rerenders do not reset sixty seconds of visible degradation', () => {
    const { result, rerender } = renderHook(() => useJankRebootPrompt());
    for (let i = 0; i < 60; i++) { frame(1000); rerender(); }
    const after60000 = result.current;
    const activeRafLoops = rafs.size;
    expect(after60000.open).toBe(true);
    expect(activeRafLoops).toBe(1);
  });
  it('wall clock jumps do not expire an in-process snooze', () => {
    const { result } = renderHook(() => useJankRebootPrompt());
    for (let i = 0; i < 60; i++) frame(1000);
    act(() => result.current.onDismiss());
    Date.now.mockReturnValue(9_000_000);
    frame(1000);
    expect(result.current.open).toBe(false);
  });
  it('counts elapsed visible time instead of one second per callback', () => {
    const { result } = renderHook(() => useJankRebootPrompt());
    for (let i = 0; i < 6; i++) frame(10_000);
    expect(result.current.open).toBe(true);
  });
  it('resets degradation across hidden time and preserves the one hour snooze', () => {
    const { result } = renderHook(() => useJankRebootPrompt());
    frame(30_000);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    frame(120_000);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    frame(30_000); expect(result.current.open).toBe(false);
    frame(30_000); expect(result.current.open).toBe(true);
    act(() => result.current.onDismiss());
    frame(3_599_000); expect(result.current.open).toBe(false);
    frame(1000); expect(result.current.open).toBe(true);
  });
});

describe('requested recovery', () => {
  it('missing or rejected reboot keeps a visible failure and retry', async () => {
    let recovery;
    function Harness({ reboot }) { recovery = useJankRebootPrompt({ reboot, readStatus: async () => healthy }); return <RebootPromptModal {...recovery} />; }
    const mounted = render(<Harness />);
    for (let i = 0; i < 60; i++) frame(1000);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /reboot now/i })); });
    expect(screen.getByText(/could not restart/i)).toBeTruthy();
    expect(recovery.recoveryVerified).toBe(false);
    mounted.rerender(<Harness reboot={async () => { throw new Error('denied'); }} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /retry/i })); });
    expect(screen.getByText(/could not restart/i)).toBeTruthy();
    expect(recovery.recoveryVerified).toBe(false);
    mounted.rerender(<Harness reboot={() => false} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /retry/i })); });
    expect(screen.getByText(/could not restart/i)).toBeTruthy();
    expect(localStorage.getItem('piano.jankReboot.request')).toBe(null);
  });
  it('request is verified only by new boot identity and a fresh page beat', async () => {
    const readStatus = vi.fn().mockResolvedValue(healthy);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: readStatus })));
    window.fully = { reboot: () => true };
    const first = renderHook(() => useJankRebootPrompt());
    await act(async () => { await first.result.current.onReboot(); });
    const acceptedCommandOnly = { verified: first.result.current.recoveryVerified };
    expect(acceptedCommandOnly.verified).toBe(false);
    first.unmount();
    readStatus.mockResolvedValue({ ...healthy, bootCount: 13, lastBeatAgoMs: 30_000, liveness: 'dead' });
    const oldBeat = renderHook(() => useJankRebootPrompt());
    await act(async () => {});
    expect(oldBeat.result.current.recoveryVerified).toBe(false);
    oldBeat.unmount();
    readStatus.mockResolvedValue({ ...healthy, bootCount: 13 });
    const second = renderHook(() => useJankRebootPrompt());
    await act(async () => {});
    const newBootAndPage = { verified: second.result.current.recoveryVerified };
    expect(newBootAndPage.verified).toBe(true);
  });
  it('Stop during a game or reboot never resumes child content', async () => {
    const childContentLaunch = vi.fn();
    const { result } = renderHook(() => useJankRebootPrompt({ reboot: childContentLaunch, readStatus: async () => ({ ...healthy, activeGame: 'chess', nativeRecoveryAllowed: false }) }));
    await act(async () => { await result.current.onReboot(); });
    expect(childContentLaunch).not.toHaveBeenCalled();
    expect(result.current.recoveryVerified).toBe(false);
  });
  it('reads the existing local bridge endpoint without credentials and fails visibly when unavailable', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('CORS or bridge unavailable'));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useJankRebootPrompt({ reboot: () => true }));
    await act(async () => { await result.current.onReboot(); });
    expect(fetch).toHaveBeenCalledWith('http://localhost:8770/kiosk', expect.objectContaining({ method: 'GET', credentials: 'omit' }));
    expect(result.current.open).toBe(true);
    expect(result.current.recoveryVerified).toBe(false);
    expect(result.current.recovery.status).toBe('failed');
  });
});

describe('expired recovery correlation', () => {
 it('expires in process to an explicit manual retry and re-reads safety before retry', async () => {
  const reboot = vi.fn().mockReturnValue(true), readStatus = vi.fn().mockResolvedValue(healthy);
  let recovery;
  function Harness() { recovery = useJankRebootPrompt({ reboot, readStatus }); return <RebootPromptModal {...recovery} />; }
  render(<Harness />);
  await act(async () => { await recovery.onReboot(); });
  frame(600001);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check recovery' })); });
  expect(screen.getByText(/could not verify the earlier restart/i)).toBeTruthy();
  expect(localStorage.getItem('piano.jankReboot.request')).toBeNull();
  expect(reboot).toHaveBeenCalledTimes(1);
  readStatus.mockResolvedValue({ ...healthy, nativeRecoveryAllowed: false });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry reboot' })); });
  expect(readStatus).toHaveBeenCalledTimes(2);
  expect(reboot).toHaveBeenCalledTimes(1);
  expect(recovery.recovery.status).toBe('failed');
 });
 it.each(['expired','invalid','malformed','false','zero'])('offers manual retry after remount of %s persisted correlation', async kind => {
  const record = { deviceId: healthy.deviceId, bootCount: 12, bootIdentitySource: healthy.bootIdentitySource, requestedAtMs: 399999 };
  if (kind === 'invalid') record.requestedAtMs = 'invalid';
  localStorage.setItem('piano.jankReboot.request', kind==='malformed' ? '{' : kind==='false' ? 'false' : kind==='zero' ? '0' : JSON.stringify(record));
  const reboot = vi.fn().mockReturnValue(true), readStatus = vi.fn().mockResolvedValue(healthy);
  function Harness() { return <RebootPromptModal {...useJankRebootPrompt({ reboot, readStatus })} />; }
  render(<Harness />); await act(async () => {});
  expect(screen.getByRole('button', { name: 'Retry reboot' })).toBeTruthy();
  expect(readStatus).not.toHaveBeenCalled();expect(reboot).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry reboot' })); });
  expect(readStatus).toHaveBeenCalledTimes(1);expect(reboot).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.getItem('piano.jankReboot.request')).requestedAtMs).toBe(Date.now());
 });
});
