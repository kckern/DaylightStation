import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createPositionChannel } from '../session/positionChannel.js';
import { usePlaybackPosition } from './usePlaybackPosition.js';

it('keeps the last painted sample while hidden and reads the current controller on return', () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const first = { position: createPositionChannel() };
  const second = { position: createPositionChannel() };
  const display = renderHook(({ controller }) => usePlaybackPosition(controller), {
    initialProps: { controller: first },
  });
  const setVisibility = value => {
    visibility.mockReturnValue(value);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
  };
  try {
    act(() => first.position.set(2));
    expect(display.result.current.seconds).toBe(2);
    setVisibility('hidden');

    act(() => first.position.set(3));
    display.rerender({ controller: first });
    expect(first.position.get().seconds).toBe(3);
    expect(display.result.current.seconds).toBe(2);

    second.position.set(5);
    display.rerender({ controller: second });
    expect(display.result.current.seconds).toBe(5);
    act(() => second.position.set(7));
    expect(display.result.current.seconds).toBe(5);

    setVisibility('visible');
    expect(display.result.current.seconds).toBe(7);
    act(() => first.position.set(8));
    expect(display.result.current.seconds).toBe(7);
    act(() => second.position.set(9));
    expect(display.result.current.seconds).toBe(9);
  } finally {
    display.unmount();
    visibility.mockRestore();
  }
});
