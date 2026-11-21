import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { usePlaybackSession } from './usePlaybackSession.js';

it('moves to the new session key while an older player still publishes volume changes', () => {
  const { result, rerender } = renderHook(({ key }) => usePlaybackSession({ sessionKey: key }), { initialProps: { key: 'first' } });
  const first = result.current;
  act(() => first.setVolume(0.4));
  rerender({ key: 'second' });
  act(() => result.current.setVolume(0.8));
  act(() => first.setVolume(0.1));
  expect(result.current.volume).toBe(0.8);
  rerender({ key: 'first' });
  expect(result.current.volume).toBe(0.1);
});
