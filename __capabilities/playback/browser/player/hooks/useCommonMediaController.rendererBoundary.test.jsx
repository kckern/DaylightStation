import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommonMediaController } from './useCommonMediaController.js';
import { createRecoveryIdentity } from '../lib/recovery/recoveryIdentity.js';
import * as Logger from '../../../../../frontend/src/lib/logging/Logger.js';

vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn(() => Promise.resolve({})) }));

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

// One array for the whole file: the controller caches its child logger at
// module level, so the spy must be in place before the first test logs.
const logEvents = [];
const logChild = {
  info: (e, d) => logEvents.push(['info', e, d]),
  warn: (e, d) => logEvents.push(['warn', e, d]),
  error: (e, d) => logEvents.push(['error', e, d]),
  debug: () => {},
  sampled: () => {},
};

beforeEach(() => {
  logEvents.length = 0;
  vi.spyOn(Logger, 'getLogger').mockReturnValue({ ...logChild, child: () => logChild });
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

// A stall jolt (stall-jolt-refresh-url) claims a new renderer generation and
// refreshes the URL on the SAME <video>. On 2026-11-24 the video then reached
// its end and nothing advanced: the terminal binding still held the old target.
function IdentityHarness({ node, identity, onEnd }) {
  const api = useCommonMediaController({
    meta: { assetId: 'plex:workout', title: 'Workout' },
    type: 'dash_video', isVideo: true,
    recoveryIdentity: identity,
    onEnd,
  });
  api.containerRef.current = node;
  return null;
}

function makeVideo() {
  const node = makeMedia({ currentTime: 80, duration: 90 });
  node.tagName = 'VIDEO';
  return node;
}

function endVideo(node) {
  node.currentTime = 90;
  node.ended = true;
  node.fire('ended');
}

describe('useCommonMediaController terminal binding across a same-element URL refresh', () => {
  it('advances on `ended` once the same element has started loading the new renderer', () => {
    const identity = createRecoveryIdentity({ ownerId: 'fitness-player' });
    const node = makeVideo();
    const onEnd = vi.fn();
    render(<IdentityHarness node={node} identity={identity} onEnd={onEnd} />);

    act(() => { identity.beginRenderer(identity.getTarget()); });
    act(() => node.fire('loadstart'));
    act(() => endVideo(node));

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(logEvents.map(([, e]) => e)).toContain('playback.terminal-rebound');
  });

  it('refuses `ended` from an element the new renderer has not taken over, and says why', () => {
    const identity = createRecoveryIdentity({ ownerId: 'fitness-player' });
    const node = makeVideo();
    const onEnd = vi.fn();
    render(<IdentityHarness node={node} identity={identity} onEnd={onEnd} />);

    act(() => { identity.beginRenderer(identity.getTarget()); });
    act(() => endVideo(node));

    expect(onEnd).not.toHaveBeenCalled();
    const rejected = logEvents.find(([level, e]) => level === 'warn' && e === 'playback.terminal-rejected');
    expect(rejected?.[2]).toMatchObject({ reason: 'stale-target', via: 'native-ended', bound: 0, current: 1 });
  });

  it('does not adopt a target whose user intent moved on', () => {
    const identity = createRecoveryIdentity({ ownerId: 'fitness-player' });
    const node = makeVideo();
    const onEnd = vi.fn();
    render(<IdentityHarness node={node} identity={identity} onEnd={onEnd} />);

    act(() => { identity.beginVisit(); });
    act(() => node.fire('loadstart'));
    act(() => endVideo(node));

    expect(onEnd).not.toHaveBeenCalled();
  });
});
