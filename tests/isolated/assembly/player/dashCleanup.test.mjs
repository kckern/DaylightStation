import { vi, describe, test, expect } from 'vitest';
import { cleanupDashElement } from '#frontend/modules/Player/lib/dashCleanup.js';

describe('cleanupDashElement', () => {
  test('calls destroy() on element if available', () => {
    const el = { destroy: vi.fn(), shadowRoot: null };
    cleanupDashElement(el);
    expect(el.destroy).toHaveBeenCalled();
  });

  test('calls reset() if destroy() not available', () => {
    const el = { reset: vi.fn(), shadowRoot: null };
    cleanupDashElement(el);
    expect(el.reset).toHaveBeenCalled();
  });

  test('pauses and clears src on inner media element', () => {
    const innerVideo = {
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn(),
      src: 'http://example.com/video.mpd'
    };
    const el = {
      shadowRoot: { querySelector: vi.fn(() => innerVideo) }
    };
    cleanupDashElement(el);
    expect(el.shadowRoot.querySelector).toHaveBeenCalledWith('video, audio');
    expect(innerVideo.pause).toHaveBeenCalled();
    expect(innerVideo.removeAttribute).toHaveBeenCalledWith('src');
    expect(innerVideo.load).toHaveBeenCalled();
  });

  test('revokes blob URL on inner media element', () => {
    const revokeObjectURL = vi.fn();
    global.URL = { revokeObjectURL };
    const innerVideo = {
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn(),
      src: 'blob:http://localhost/abc123'
    };
    const el = {
      shadowRoot: { querySelector: vi.fn(() => innerVideo) }
    };
    cleanupDashElement(el);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/abc123');
    delete global.URL;
  });

  test('does not throw if element has no cleanup methods', () => {
    expect(() => cleanupDashElement({})).not.toThrow();
    expect(() => cleanupDashElement(null)).not.toThrow();
  });

  test('does not throw if shadowRoot.querySelector returns null', () => {
    const el = { shadowRoot: { querySelector: vi.fn(() => null) } };
    expect(() => cleanupDashElement(el)).not.toThrow();
  });
});
