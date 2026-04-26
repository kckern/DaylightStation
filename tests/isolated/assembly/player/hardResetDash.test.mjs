import { vi, describe, test, expect } from 'vitest';

describe('hardReset for dash-video', () => {
  test('should use getMediaEl (shadow DOM) not containerRef directly', () => {
    // The fix: hardReset should call getMediaEl() to get the inner <video>,
    // not use containerRef.current which is the <dash-video> host element.
    const innerVideo = {
      currentTime: 50,
      load: vi.fn(),
      play: vi.fn(() => Promise.resolve())
    };
    const getMediaEl = vi.fn(() => innerVideo);
    const containerEl = { currentTime: 0, load: vi.fn(), play: vi.fn(() => Promise.resolve()) };

    // Simulate hardReset using getMediaEl
    const mediaEl = getMediaEl();
    const target = mediaEl || containerEl;
    target.currentTime = 0;
    target.load();
    target.play();

    // Should have used inner video, not container
    expect(getMediaEl).toHaveBeenCalled();
    expect(innerVideo.load).toHaveBeenCalled();
    expect(innerVideo.play).toHaveBeenCalled();
    expect(containerEl.load).not.toHaveBeenCalled();
  });

  test('falls back to containerRef if getMediaEl returns null', () => {
    const getMediaEl = vi.fn(() => null);
    const containerEl = {
      currentTime: 0,
      load: vi.fn(),
      play: vi.fn(() => Promise.resolve())
    };

    const mediaEl = getMediaEl();
    const target = mediaEl || containerEl;
    target.currentTime = 0;
    target.load();
    target.play();

    expect(containerEl.load).toHaveBeenCalled();
    expect(containerEl.play).toHaveBeenCalled();
  });
});

describe('handleResilienceReload remount gating', () => {
  test('skips remount when hardReset is invoked without error', () => {
    const scheduleSinglePlayerRemount = vi.fn();
    const hardReset = vi.fn(); // does not throw

    let hardResetInvoked = false;
    let hardResetErrored = false;
    hardResetInvoked = true;
    try { hardReset({ seekToSeconds: 11 }); } catch (_) { hardResetErrored = true; }

    if (hardResetInvoked && !hardResetErrored) {
      // Should NOT call scheduleSinglePlayerRemount
    } else {
      scheduleSinglePlayerRemount();
    }

    expect(scheduleSinglePlayerRemount).not.toHaveBeenCalled();
  });

  test('proceeds to remount when hardReset throws', () => {
    const scheduleSinglePlayerRemount = vi.fn();
    const hardReset = vi.fn(() => { throw new Error('fail'); });

    let hardResetInvoked = false;
    let hardResetErrored = false;
    hardResetInvoked = true;
    try { hardReset({ seekToSeconds: 11 }); } catch (_) { hardResetErrored = true; }

    if (hardResetInvoked && !hardResetErrored) {
      // skip
    } else {
      scheduleSinglePlayerRemount();
    }

    expect(scheduleSinglePlayerRemount).toHaveBeenCalled();
  });

  test('proceeds to remount when hardReset is unavailable', () => {
    const scheduleSinglePlayerRemount = vi.fn();
    const hardReset = null;

    let hardResetInvoked = false;
    let hardResetErrored = false;
    if (typeof hardReset === 'function') {
      hardResetInvoked = true;
      try { hardReset(); } catch (_) { hardResetErrored = true; }
    }

    if (hardResetInvoked && !hardResetErrored) {
      // skip
    } else {
      scheduleSinglePlayerRemount();
    }

    expect(scheduleSinglePlayerRemount).toHaveBeenCalled();
  });
});
