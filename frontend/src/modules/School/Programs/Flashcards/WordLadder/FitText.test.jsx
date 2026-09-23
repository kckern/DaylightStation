import { render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FitText } from './FitText.jsx';
import { fitFontSize } from './fitFontSize.js';

vi.mock('./fitFontSize.js', () => ({ fitFontSize: vi.fn() }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };
});
afterEach(() => {
  fitFontSize.mockReset();
  delete document.fonts;
});

describe('FitText', () => {
  it('leaves the fitted size on the element, not the last trial size', () => {
    // The search's last probe (120px) is not the answer (32px); 32px is also the
    // initial state, so React has no re-render to overwrite the trial size with.
    fitFontSize.mockImplementation(({ measure }) => { measure(120); return { px: 32, clamped: false }; });
    const { container } = render(<div><FitText role="term" text="가위" lang="ko" /></div>);
    expect(container.querySelector('.wl-fit').style.fontSize).toBe('32px');
  });

  it('does not measure a detached element when fonts finish loading after unmount', async () => {
    let ready;
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: new Promise((resolve) => { ready = resolve; }) } });
    fitFontSize.mockImplementation(() => ({ px: 32, clamped: false }));
    const { unmount } = render(<div><FitText role="term" text="가위" lang="ko" /></div>);
    const calls = fitFontSize.mock.calls.length;
    unmount();
    ready();
    await Promise.resolve(); await Promise.resolve();
    expect(fitFontSize.mock.calls.length).toBe(calls);
  });
});
