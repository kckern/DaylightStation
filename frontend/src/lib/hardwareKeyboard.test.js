import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiMock = vi.fn();
vi.mock('./api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));
vi.mock('./logging/Logger.js', () => ({
  default: () => ({ child: () => ({ debug() {}, info() {}, warn() {}, error() {} }) }),
}));

/** Fresh module state per case — the detector caches, which is the point of it. */
async function load({ pointerFine = false, deviceId = null, remembered = false } = {}) {
  vi.resetModules();
  window.localStorage.clear();
  if (remembered) window.localStorage.setItem('ds_hardware_keyboard', '1');
  window.matchMedia = (q) => ({
    matches: q.includes('pointer: fine') ? pointerFine : false,
    media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {},
  });
  if (deviceId) window.__DAYLIGHT_DEVICE_ID = deviceId;
  else delete window.__DAYLIGHT_DEVICE_ID;
  return import('./hardwareKeyboard.js');
}

/** A key a HID keyboard sends and neither a TV remote nor an Android IME can. */
const press = (code, extra = {}) => window.dispatchEvent(
  new KeyboardEvent('keydown', { code, key: code.slice(-1).toLowerCase(), ...extra }),
);

beforeEach(() => { apiMock.mockReset(); apiMock.mockResolvedValue({ ok: true, keyboard: false }); });

describe('hardwareKeyboard', () => {
  it('says no on a touch panel with no evidence either way', async () => {
    const { hasHardwareKeyboard } = await load();
    expect(hasHardwareKeyboard()).toBe(false);
  });

  it('says yes where there is a mouse — a desktop still implies a keyboard', async () => {
    const { hasHardwareKeyboard } = await load({ pointerFine: true });
    expect(hasHardwareKeyboard()).toBe(true);
  });

  it('learns from a keypress, tells its watchers, and remembers it next time', async () => {
    const mod = await load();
    const seen = vi.fn();
    mod.watchHardwareKeyboard(seen);
    expect(mod.hasHardwareKeyboard()).toBe(false);

    press('KeyA');

    expect(mod.hasHardwareKeyboard()).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem('ds_hardware_keyboard')).toBe('1');

    // A second key is not a second discovery.
    press('KeyB');
    expect(seen).toHaveBeenCalledTimes(1);

    const next = await load({ remembered: true });
    expect(next.hasHardwareKeyboard()).toBe(true);
  });

  it('ignores the keys an on-screen keyboard and a TV remote can forge', async () => {
    const mod = await load();
    mod.watchHardwareKeyboard(() => {});
    // Android IMEs report every letter as keyCode 229 / key Unidentified.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: '', key: 'Unidentified', keyCode: 229 }));
    // A D-pad remote sends exactly these, and has no letters at all.
    for (const code of ['ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Backspace']) press(code);
    expect(mod.hasHardwareKeyboard()).toBe(false);
  });

  it('takes the fleet registry at its word for a named device', async () => {
    apiMock.mockResolvedValue({ ok: true, device: 'portal', keyboard: true });
    const mod = await load({ deviceId: 'portal' });
    const seen = vi.fn();
    mod.watchHardwareKeyboard(seen);
    await vi.waitFor(() => expect(mod.hasHardwareKeyboard()).toBe(true));
    expect(apiMock).toHaveBeenCalledWith('api/v1/device/self/input');
    expect(seen).toHaveBeenCalled();
  });

  it('does not ask the registry about a browser it cannot name', async () => {
    const mod = await load();
    mod.watchHardwareKeyboard(() => {});
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('stays silent rather than claiming hardware when the lookup fails', async () => {
    apiMock.mockRejectedValue(new Error('offline'));
    const mod = await load({ deviceId: 'portal' });
    mod.watchHardwareKeyboard(() => {});
    await vi.waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(mod.hasHardwareKeyboard()).toBe(false);
  });
});
