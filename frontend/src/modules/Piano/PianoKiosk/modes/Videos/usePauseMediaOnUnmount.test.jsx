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

  // The leak this hook exists to prevent. The engine swaps its media element
  // mid-playback (stall recovery's soft-reinit, remount, the transient null
  // gap useResolvedMediaEl documents). Whoever holds only the LATEST element
  // leaves the outgoing one detached and still emitting audio — no DOM node,
  // no React tree, no controls bound to it. That is the "audio playing from
  // nowhere, can't find it, can't stop it" incident.
  it('pauses the outgoing element as soon as the element identity changes', () => {
    const a = { pause: vi.fn() }; const b = { pause: vi.fn() };
    const { rerender } = render(<Probe el={a} />);
    rerender(<Probe el={b} />);
    expect(a.pause).toHaveBeenCalledTimes(1); // paused at the swap, not left running
    expect(b.pause).not.toHaveBeenCalled();   // the live one keeps playing
  });

  it('pauses every element it has ever seen on unmount', () => {
    const a = { pause: vi.fn() }; const b = { pause: vi.fn() }; const c = { pause: vi.fn() };
    const { rerender, unmount } = render(<Probe el={a} />);
    rerender(<Probe el={b} />);
    rerender(<Probe el={c} />);
    unmount();
    expect(a.pause).toHaveBeenCalled();
    expect(b.pause).toHaveBeenCalled();
    expect(c.pause).toHaveBeenCalledTimes(1);
  });

  // useResolvedMediaEl re-emits through null between elements, and a re-emitted
  // identical element must not be treated as a new one.
  it('survives a transient null gap and does not double-pause on re-emit', () => {
    const a = { pause: vi.fn() };
    const { rerender, unmount } = render(<Probe el={a} />);
    rerender(<Probe el={null} />);
    rerender(<Probe el={a} />);
    unmount();
    expect(a.pause).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when there is no element', () => {
    const { unmount } = render(<Probe el={null} />);
    expect(() => unmount()).not.toThrow();
  });

  it('keeps pausing the rest when one element throws', () => {
    const bad = { pause: vi.fn(() => { throw new Error('detached'); }) };
    const good = { pause: vi.fn() };
    const { rerender, unmount } = render(<Probe el={bad} />);
    rerender(<Probe el={good} />);
    expect(() => unmount()).not.toThrow();
    expect(good.pause).toHaveBeenCalled();
  });
});
