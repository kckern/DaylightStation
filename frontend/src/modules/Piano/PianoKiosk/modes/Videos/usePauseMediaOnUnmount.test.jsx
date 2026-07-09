import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import usePauseMediaOnUnmount from './usePauseMediaOnUnmount.js';

function Probe({ el }) { usePauseMediaOnUnmount(el); return null; }

describe('usePauseMediaOnUnmount', () => {
  it('pauses the media element on unmount', () => {
    const el = { pause: vi.fn() };
    const { unmount } = render(<Probe el={el} />);
    expect(el.pause).not.toHaveBeenCalled();
    unmount();
    expect(el.pause).toHaveBeenCalledTimes(1);
  });

  it('pauses the LATEST element after it changed (not the stale one)', () => {
    const a = { pause: vi.fn() }; const b = { pause: vi.fn() };
    const { rerender, unmount } = render(<Probe el={a} />);
    rerender(<Probe el={b} />);
    unmount();
    expect(b.pause).toHaveBeenCalledTimes(1);
    expect(a.pause).not.toHaveBeenCalled();
  });

  it('is a no-op when there is no element', () => {
    const { unmount } = render(<Probe el={null} />);
    expect(() => unmount()).not.toThrow();
  });
});
