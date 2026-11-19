import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { FeedPlayerProvider, useFeedPlayer } from './FeedPlayerContext.jsx';

it.each([
  ['the previous renderer is still mounted', { id: 'other' }],
  ['the native timeline has ended', { native: 30 }],
  ['the clock has no original-content mapping', { position: null }],
  ['the original clock and decoder use different origins', {
    position: 4325, timeline: { rendererStartSeconds: 0, contentStartSeconds: 4320 },
  }],
  ['the source is live', { live: true }],
])('keeps the regular launch for Resume previous when %s', (_reason, options) => {
  const { result } = renderHook(useFeedPlayer, { wrapper: FeedPlayerProvider });
  act(() => result.current.play({ title: 'First' }, 'first'));
  result.current.playerRef.current = {
    getMountedContentId: () => options.id ?? 'first',
    getNowPlaying: () => ({ item: { isLive: options.live, contentTimeline: options.timeline } }),
    getContentTime: () => 'position' in options ? options.position : 5,
    getCurrentTime: () => options.native ?? 5,
    getDuration: () => 30,
  };
  act(() => result.current.play({ title: 'Second' }, 'second'));
  act(() => result.current.resumePaused());
  expect(result.current.activeMedia).toMatchObject({ contentId: 'first', position: null });
});
