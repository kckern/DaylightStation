import React, { createRef, StrictMode } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetPlayerQueueOpRegistryForTests, getPlayerQueueOpRegistry } from './lib/queueOpRegistry.js';

const frames = [];
let autoController = true;
function makeMedia(tag = 'video') {
  const node = document.createElement(tag);
  Object.defineProperties(node, {
    paused: { configurable: true, writable: true, value: false },
    duration: { configurable: true, value: 120 },
    readyState: { configurable: true, value: 4 },
  });
  node.play = vi.fn(() => { node.paused = false; return Promise.resolve(); });
  node.pause = vi.fn(() => { node.paused = true; });
  return node;
}
function makeController(node) {
  return {
    getMediaEl: () => node,
    play: vi.fn(() => node.play()),
    pause: vi.fn(() => node.pause()),
    toggle: vi.fn(() => node.paused ? node.play() : node.pause()),
  };
}

vi.mock('./components/SinglePlayer.jsx', () => ({
  SinglePlayer: props => {
    const frameRef = React.useRef(null);
    if (!frameRef.current) {
      const readalong = props.contentId.startsWith('readalong:');
      const node = makeMedia(readalong ? 'audio' : 'video');
      frameRef.current = { node, readalong, controller: makeController(node), props };
    }
    const frame = frameRef.current;
    frame.props = props;
    React.useEffect(() => { frames.push(frame); }, []);
    React.useEffect(() => {
      // Readalong only registers its accessor; it never publishes onMediaRef.
      if (!frame.readalong) props.onMediaRef(frame.node, { contentId: props.contentId });
    }, [props.onMediaRef, props.contentId, frame]);
    React.useEffect(() => {
      props.onRegisterMediaAccess({ getMediaEl: () => frame.node });
    }, [props.onRegisterMediaAccess, frame]);
    React.useEffect(() => {
      if (frame.readalong || !autoController) return;
      const release = props.onController(frame.controller);
      return typeof release === 'function' ? release : undefined;
    }, [props.onController, frame]);
    return <div />;
  },
}));
vi.mock('../../../../frontend/src/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async () => ({ items: [], audio: null })),
}));

import Player from './Player.jsx';

beforeEach(() => { frames.length = 0; autoController = true; __resetPlayerQueueOpRegistryForTests(); });
afterEach(cleanup);

const start = async (props = {}, strict = false) => {
  const ref = createRef();
  const player = <Player ref={ref} play={[{ contentId: 'files:video-a' }]} {...props} />;
  const view = render(strict ? <StrictMode>{player}</StrictMode> : player);
  await waitFor(() => expect(frames.length).toBeGreaterThan(0));
  return { ref, ...view };
};
const dispatch = op => act(() => { expect(getPlayerQueueOpRegistry().dispatch({ op })).toBe(true); });

describe('Player controller lifetime', () => {
  it('pauses and resumes the current readalong after a video queue item', async () => {
    const { ref } = await start({ play: [
      { contentId: 'files:video-a' }, { contentId: 'readalong:scripture/chapter' }, { contentId: 'files:video-b' },
    ] });
    const old = frames.at(-1);
    dispatch('skip-next');
    await waitFor(() => expect(frames.at(-1).readalong).toBe(true));
    const audio = frames.at(-1).node;
    expect(ref.current.getMediaElement()).toBe(audio);
    dispatch('toggle');
    expect(audio.paused).toBe(true);
    dispatch('toggle');
    expect(audio.paused).toBe(false);
    dispatch('pause');
    expect(audio.paused).toBe(true);
    dispatch('play');
    expect(audio.paused).toBe(false);
    expect(old.controller.toggle).not.toHaveBeenCalled();
    expect(old.controller.pause).not.toHaveBeenCalled();
    dispatch('skip-next');
    await waitFor(() => expect(frames.at(-1).props.contentId).toBe('files:video-b'));
    const replacement = frames.at(-1);
    const audioPauses = audio.pause.mock.calls.length;
    dispatch('toggle');
    expect(replacement.node.paused).toBe(true);
    dispatch('play');
    expect(replacement.node.paused).toBe(false);
    dispatch('pause');
    expect(replacement.node.paused).toBe(true);
    expect(audio.pause).toHaveBeenCalledTimes(audioPauses);
  });

  it('a late callback or release from a retired renderer cannot replace the current controller', async () => {
    const onController = vi.fn();
    const { ref, rerender } = await start({ onController });
    const old = frames.at(-1);
    const registerOld = old.props.onController;
    let releaseOld;
    act(() => { releaseOld = registerOld(old.controller); });
    rerender(<Player ref={ref} play={[{ contentId: 'files:video-b' }]} onController={onController} />);
    await waitFor(() => expect(frames.at(-1).props.contentId).toBe('files:video-b'));
    const replacement = frames.at(-1);
    const notifications = onController.mock.calls.length;
    act(() => { registerOld(old.controller); releaseOld?.(); releaseOld?.(); });
    expect(ref.current.getMediaController()).toBe(replacement.controller);
    expect(onController).toHaveBeenCalledTimes(notifications);
    dispatch('toggle');
    expect(replacement.node.paused).toBe(true);
    expect(old.controller.toggle).not.toHaveBeenCalled();
  });

  it('releases only the exact registration, including repeated release in one renderer lifetime', async () => {
    autoController = false;
    const { ref } = await start();
    const { props, node } = frames.at(-1);
    const first = makeController(node);
    const second = makeController(node);
    let releaseFirst, releaseSecond;
    act(() => { releaseFirst = props.onController(first); releaseSecond = props.onController(second); });
    expect(releaseFirst).toBeTypeOf('function');
    expect(releaseSecond).toBeTypeOf('function');
    act(() => { releaseFirst(); releaseFirst(); });
    dispatch('toggle');
    expect(second.toggle).toHaveBeenCalledTimes(1);
    expect(first.toggle).not.toHaveBeenCalled();
    act(() => { releaseSecond(); releaseSecond(); });
    expect(ref.current.getMediaController()).toBeNull();
    dispatch('toggle');
    expect(node.paused).toBe(false);
    expect(second.toggle).toHaveBeenCalledTimes(1);
  });

  it('rejects controller callbacks from before native-node epoch replacement synchronously', async () => {
    autoController = false;
    const { ref } = await start();
    const oldRegister = frames.at(-1).props.onController;
    const oldController = makeController(frames.at(-1).node);
    const newNode = makeMedia();
    act(() => {
      oldRegister(oldController);
      frames.at(-1).props.onMediaRef(newNode, { contentId: 'files:video-a' });
      // No passive effect has run yet: retirement must already be observable.
      expect(ref.current.getMediaController()).toBeNull();
    });
    const current = makeController(newNode);
    act(() => frames.at(-1).props.onController(current));
    act(() => oldRegister(oldController));
    expect(ref.current.getMediaController()).toBe(current);
    dispatch('toggle');
    expect(newNode.paused).toBe(true);
    expect(oldController.toggle).not.toHaveBeenCalled();
  });

  it('rejects the retired controller on a same-content physical remount', async () => {
    const { ref } = await start();
    const old = frames.at(-1);
    const registerOld = old.props.onController;
    act(() => expect(ref.current.beginRendererBoundary({
      operationId: 'controller-same-content', expectedContentId: 'files:video-a',
      targetSeconds: 0, autoplay: false, format: 'video', requireObserver: false,
    })).toMatchObject({ ok: true }));
    await waitFor(() => expect(frames.at(-1).node).not.toBe(old.node));
    const current = frames.at(-1);
    act(() => registerOld(old.controller));
    expect(ref.current.getMediaController()).toBe(current.controller);
    dispatch('toggle');
    expect(current.node.paused).toBe(true);
    expect(old.controller.toggle).not.toHaveBeenCalled();
  });

  it('keeps current transport usable after Strict Mode repeats setup and cleanup', async () => {
    const { ref } = await start({}, true);
    const current = frames.at(-1);
    expect(ref.current.getMediaController()).toBe(current.controller);
    dispatch('toggle');
    expect(current.node.paused).toBe(true);
    dispatch('toggle');
    expect(current.node.paused).toBe(false);
  });
});
