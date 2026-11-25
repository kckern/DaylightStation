// frontend/src/lib/ui/observeVisualViewport.test.js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { observeVisualViewport } from './observeVisualViewport.js';

const descriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport');
afterEach(() => {
  if (descriptor) Object.defineProperty(window, 'visualViewport', descriptor); else delete window.visualViewport;
});
const install = vv => Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });

describe('observeVisualViewport', () => {
  it('calls update immediately and on visualViewport resize/scroll and window resize', () => {
    const vv = new EventTarget();
    install(vv);
    const update = vi.fn();
    const stop = observeVisualViewport(update);
    expect(update).toHaveBeenCalledTimes(1);
    vv.dispatchEvent(new Event('resize'));
    vv.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    expect(update).toHaveBeenCalledTimes(4);
    stop();
  });

  it('stop removes every listener', () => {
    const vv = new EventTarget();
    install(vv);
    const update = vi.fn();
    const stop = observeVisualViewport(update);
    stop();
    update.mockClear();
    vv.dispatchEvent(new Event('resize'));
    vv.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    expect(update).not.toHaveBeenCalled();
  });

  it('still watches window resize when the browser has no visualViewport', () => {
    install(undefined);
    const update = vi.fn();
    const stop = observeVisualViewport(update);
    expect(update).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('resize'));
    expect(update).toHaveBeenCalledTimes(2);
    stop();
    window.dispatchEvent(new Event('resize'));
    expect(update).toHaveBeenCalledTimes(2);
  });
});
