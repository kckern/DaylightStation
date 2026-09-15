import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommonMediaController } from './useCommonMediaController.js';

vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn(() => Promise.resolve({})) }));

function makeMedia({ currentTime = 44, duration = 90 } = {}) {
  const listeners = new Map();
  let paused = true;
  const node = {
    tagName: 'AUDIO', dataset: {}, shadowRoot: null, readyState: 3,
    duration, ended: false, seeking: false, error: null, networkState: 1,
    buffered: { length: 1, start: () => 0, end: () => duration },
    addEventListener: (type, fn) => {
      const set = listeners.get(type) ?? new Set();
      set.add(fn); listeners.set(type, set);
    },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
    setAttribute: () => {}, getAttribute: () => null,
    play: vi.fn(() => { paused = false; return Promise.resolve(); }),
    pause: vi.fn(() => { paused = true; }),
    fire(type) {
      if (type === 'seeking') this.seeking = true;
      if (type === 'seeked') this.seeking = false;
      for (const fn of [...(listeners.get(type) ?? [])]) fn({ type });
    },
  };
  Object.defineProperties(node, {
    currentTime: { configurable: true, writable: true, value: currentTime },
    paused: { configurable: true, get: () => paused },
  });
  return node;
}

function Harness({ node, operation, onReady }) {
  const api = useCommonMediaController({
    start: 3,
    meta: { assetId: 'short-audio', contentId: 'plex:short-audio', title: 'Short' },
    type: 'files', isAudio: true, isVideo: false,
    remountDiagnostics: { remountClass: 'owner-operation', rendererOperation: operation },
    onMediaRef: (_node, ownership) => onReady({ api, ownership }),
  });
  api.containerRef.current = node;
  return null;
}

beforeEach(() => {
  useCommonMediaController.__appliedStartByKey = Object.create(null);
  useCommonMediaController.__lastSeekByKey = { 'short-audio': 55 };
  useCommonMediaController.__lastPosByKey = { 'short-audio': 56 };
});
afterEach(() => cleanup());

describe('useCommonMediaController renderer operation', () => {
  it('uses an immutable actual-node token and waits for native seeking then seeked before play', () => {
    const node = makeMedia();
    let ready = null;
    render(<Harness node={node} operation={{
      operationId: 'positive-target', expectedContentId: 'plex:short-audio', targetSeconds: 17, autoplay: true,
    }} onReady={(value) => { ready = value; }} />);
    expect(ready.ownership.rendererToken).toMatchObject({
      operationId: 'positive-target', node, resolvedContentId: 'plex:short-audio',
    });
    expect(Object.isFrozen(ready.ownership.rendererToken)).toBe(true);

    act(() => node.fire('loadedmetadata'));
    expect(node.currentTime).toBe(44);
    act(() => ready.api.beginMountedPlaybackOperation(ready.ownership.rendererToken));
    expect(node.currentTime).toBe(17);
    expect(node.play).not.toHaveBeenCalled();
    act(() => node.fire('seeked'));
    expect(node.play).not.toHaveBeenCalled();
    act(() => { node.fire('seeking'); node.fire('seeked'); });
    expect(node.play).toHaveBeenCalledTimes(1);
  });

  it('applies explicit zero to short audio, remains paused, and leaves global resume maps untouched', () => {
    const node = makeMedia();
    let ready = null;
    render(<Harness node={node} operation={{
      operationId: 'paused-zero', expectedContentId: 'plex:short-audio', targetSeconds: 0, autoplay: false,
    }} onReady={(value) => { ready = value; }} />);

    act(() => {
      node.fire('loadedmetadata');
      ready.api.beginMountedPlaybackOperation(ready.ownership.rendererToken);
    });

    expect(node.currentTime).toBe(0);
    expect(node.paused).toBe(true);
    expect(node.play).not.toHaveBeenCalled();
    expect(useCommonMediaController.__lastSeekByKey['short-audio']).toBe(55);
    expect(useCommonMediaController.__lastPosByKey['short-audio']).toBe(56);
    expect(useCommonMediaController.__appliedStartByKey['short-audio']).toBeUndefined();
  });
});
