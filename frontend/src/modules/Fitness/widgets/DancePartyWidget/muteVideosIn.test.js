import { describe, it, expect, afterEach, vi } from 'vitest';
import { muteVideosIn } from './muteVideosIn.js';

describe('muteVideosIn', () => {
  let container;
  let cleanup;

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    container?.remove();
    container = null;
  });

  function makeContainer() {
    container = document.createElement('div');
    document.body.appendChild(container);
    return container;
  }

  it('mutes a <video> already present at call time', () => {
    const c = makeContainer();
    const video = document.createElement('video');
    c.appendChild(video);

    cleanup = muteVideosIn(c);

    expect(video.muted).toBe(true);
  });

  it('mutes a <video> added after the initial sweep (playlist advance)', async () => {
    const c = makeContainer();
    cleanup = muteVideosIn(c);

    const video = document.createElement('video');
    c.appendChild(video);

    // MutationObserver fires asynchronously (microtask).
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    expect(video.muted).toBe(true);
  });

  it('re-mutes a replacement <video> nested under a wrapper', async () => {
    const c = makeContainer();
    cleanup = muteVideosIn(c);

    const wrapper = document.createElement('div');
    const video = document.createElement('video');
    wrapper.appendChild(video);
    c.appendChild(wrapper);

    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    expect(video.muted).toBe(true);
  });

  it('disconnects the observer on cleanup (no further mutes)', async () => {
    const c = makeContainer();
    cleanup = muteVideosIn(c);
    cleanup();
    cleanup = null;

    const video = document.createElement('video');
    video.muted = false;
    c.appendChild(video);

    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    // Observer was disconnected, so a node added afterward is untouched.
    expect(video.muted).toBe(false);
  });

  it('returns a no-op cleanup when given no container', () => {
    const fn = muteVideosIn(null);
    expect(typeof fn).toBe('function');
    expect(() => fn()).not.toThrow();
  });
});
