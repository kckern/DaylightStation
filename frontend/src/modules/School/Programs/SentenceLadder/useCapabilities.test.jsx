import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));
vi.mock('./languageLog.js', () => ({
  languageLog: { capability: vi.fn() },
}));

const LANGUAGES = { source: 'EN', target: 'KR' };

/**
 * The Portal: a touch panel, a microphone, and a Bluetooth keyboard the web
 * platform cannot see. Every case here is that device unless it says otherwise.
 */
function asTouchPanel({ fleetName = null } = {}) {
  window.localStorage.clear();
  window.matchMedia = (q) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {},
  });
  navigator.mediaDevices = { enumerateDevices: async () => [{ kind: 'audioinput' }] };
  if (fleetName) window.__DAYLIGHT_DEVICE_ID = fleetName;
  else delete window.__DAYLIGHT_DEVICE_ID;
}

async function mount() {
  vi.resetModules();
  const { useCapabilities } = await import('./useCapabilities.js');
  function Harness() {
    const { capabilities, ready } = useCapabilities('glossika-korean', LANGUAGES);
    return <p data-testid="caps">{ready ? capabilities.textInput.join(',') || '(none)' : 'pending'}</p>;
  }
  render(<Harness />);
  const caps = () => screen.getByTestId('caps').textContent;
  await waitFor(() => expect(caps()).not.toBe('pending'));
  return caps;
}

beforeEach(() => {
  apiMock.mockReset().mockResolvedValue({ ok: true, device: null, keyboard: false });
});

describe('useCapabilities — which scripts this device can type', () => {
  it('claims nothing on a touch panel with no keyboard anywhere in evidence', async () => {
    asTouchPanel();
    const caps = await mount();
    expect(caps()).toBe('(none)');
  });

  // THE PORTAL BUG. `devices.yml` has declared this panel's bonded Bluetooth
  // keyboard since 2026-09-09; the ladder still hid Dictation and
  // Interpretation because `pointer: fine` — a question about a MOUSE — was
  // false. A child sat in front of a Korean keyboard reading "continue on
  // another device".
  it('claims both scripts when the fleet registry declares this panel a keyboard', async () => {
    asTouchPanel({ fleetName: 'portal' });
    apiMock.mockResolvedValue({ ok: true, device: 'portal', keyboard: true });
    const caps = await mount();
    await waitFor(() => expect(caps()).toBe('EN,KR'));
  });

  it('claims both scripts the moment someone types on an undeclared device', async () => {
    asTouchPanel();
    const caps = await mount();
    expect(caps()).toBe('(none)');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a' }));
    });

    await waitFor(() => expect(caps()).toBe('EN,KR'));
  });

  // The conservative floor, unchanged: a target script with no in-page composer
  // stays withheld however good the evidence for the keyboard is. Offering
  // dictation there is the dead end the whole capability system exists to
  // prevent.
  it('still withholds a target script it has no composer for', async () => {
    asTouchPanel({ fleetName: 'portal' });
    apiMock.mockResolvedValue({ ok: true, device: 'portal', keyboard: true });
    vi.resetModules();
    const { useCapabilities } = await import('./useCapabilities.js');
    function Harness() {
      const { capabilities, ready } = useCapabilities('corpus-jp', { source: 'EN', target: 'JP' });
      return <p data-testid="caps">{ready ? capabilities.textInput.join(',') || '(none)' : 'pending'}</p>;
    }
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('caps').textContent).toBe('EN'));
  });

  // A grown-up's declaration outranks all three signals, in both directions.
  it('lets a stored override overrule the evidence', async () => {
    asTouchPanel({ fleetName: 'portal' });
    apiMock.mockResolvedValue({ ok: true, device: 'portal', keyboard: true });
    window.localStorage.setItem(
      'school.language.capabilities',
      JSON.stringify({ 'glossika-korean': { microphone: true, textInput: [] } }),
    );
    const caps = await mount();
    await new Promise((r) => setTimeout(r, 20));
    expect(caps()).toBe('(none)');
  });
});
