import { describe, it, expect, vi } from 'vitest';
import { cleanupDashElement } from './dashCleanup.js';

const mediaStub = () => ({
  pause: vi.fn(),
  src: '',
  removeAttribute: vi.fn(),
  load: vi.fn(),
});

const dashStub = (inner) => ({
  api: { destroy: vi.fn() },
  shadowRoot: { querySelector: () => inner },
});

describe('cleanupDashElement', () => {
  it('destroys the dash.js player and pauses the shadow-DOM media element', () => {
    const inner = mediaStub();
    const el = dashStub(inner);
    cleanupDashElement(el);
    expect(el.api.destroy).toHaveBeenCalledTimes(1);
    expect(inner.pause).toHaveBeenCalledTimes(1);
    expect(inner.removeAttribute).toHaveBeenCalledWith('src');
    expect(inner.load).toHaveBeenCalledTimes(1);
  });

  // The native branch of VideoPlayer renders a plain <video> under the SAME
  // containerRef and the SAME dashElementKey, so this cleanup runs for it too.
  // A native <video> has no shadowRoot, so resolving the media element only via
  // shadowRoot returned null and the function bailed BEFORE pausing anything —
  // a file-served lecture kept emitting audio after its element was replaced,
  // with no DOM node and no controls bound to it.
  it('pauses a native media element that has no shadowRoot', () => {
    const el = mediaStub();
    cleanupDashElement(el);
    expect(el.pause).toHaveBeenCalledTimes(1);
    expect(el.removeAttribute).toHaveBeenCalledWith('src');
    expect(el.load).toHaveBeenCalledTimes(1);
  });

  it('revokes a blob URL before clearing the source', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const el = mediaStub();
    el.src = 'blob:http://localhost/abc';
    cleanupDashElement(el);
    expect(revoke).toHaveBeenCalledWith('blob:http://localhost/abc');
    revoke.mockRestore();
  });

  it('is a no-op for null', () => {
    expect(() => cleanupDashElement(null)).not.toThrow();
  });

  it('does not throw when the element is already detached', () => {
    const el = { pause: () => { throw new Error('detached'); } };
    expect(() => cleanupDashElement(el)).not.toThrow();
  });

  it('ignores a non-media container that cannot be paused', () => {
    const el = { shadowRoot: { querySelector: () => null } };
    expect(() => cleanupDashElement(el)).not.toThrow();
  });
});
