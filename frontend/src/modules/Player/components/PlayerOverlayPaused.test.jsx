import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../lib/playbackLogger.js', () => ({ playbackLog: vi.fn() }));
vi.mock('../../../assets/icons/pause.svg', () => ({ default: 'pause.svg' }));

const { PlayerOverlayPaused } = await import('./PlayerOverlayPaused.jsx');
const { playbackLog } = await import('../lib/playbackLogger.js');

const BASE = {
  shouldRender: true,
  isVisible: true,
  pauseOverlayActive: true,
  seconds: 42,
  stalled: false,
  waitingToPlay: false,
  togglePauseOverlay: () => {},
};

describe('PlayerOverlayPaused', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    playbackLog.mockClear();
    // React logs hook-order corruption via console.error (a DEV-only "Internal React
    // error: Expected static flag was missing. Please notify the React team." warning)
    // rather than always throwing synchronously — confirmed by direct reproduction: gating
    // hook calls behind an early return and flipping that condition on a mounted instance
    // (0 hooks -> N hooks) produces exactly this console.error in React 18.3.1, with no
    // hooks reset since the component effectively re-mounts its hook list. Spy on it so
    // the regression tests below can assert it silently, i.e. that no such corruption
    // occurs against the fixed (unconditional-hooks) implementation.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders the pause scrim by default', () => {
    const { container } = render(<PlayerOverlayPaused {...BASE} />);
    expect(container.querySelector('.loading-overlay.paused')).not.toBeNull();
  });

  it('renders nothing when suppressPauseOverlay is set', () => {
    const { container } = render(<PlayerOverlayPaused {...BASE} suppressPauseOverlay />);
    expect(container.querySelector('.loading-overlay.paused')).toBeNull();
  });

  it('still renders nothing when suppressed during a stall', () => {
    const { container } = render(<PlayerOverlayPaused {...BASE} stalled suppressPauseOverlay />);
    expect(container.querySelector('.loading-overlay.paused')).toBeNull();
  });

  // Regression coverage: PlayerOverlayPaused stays mounted across renders where
  // suppressPauseOverlay / suppressForBlackout flip (e.g. contentMode.studyUx resolving
  // asynchronously, or a queue advance in/out of blackout). If either flag ever gates a
  // hook call with an early return, calling a different number of hooks than the previous
  // render is a Rules-of-Hooks violation (see react-dom.development.js's hook bookkeeping,
  // e.g. the `didRenderTooFewHooks` check) — undefined behavior in React, and confirmed by
  // direct reproduction (outside this suite) to corrupt the fiber's hook list with a
  // "Please notify the React team" internal warning on the 0-hooks -> N-hooks direction. A
  // fresh `render()` per case would remount the component and reset hook bookkeeping,
  // hiding this bug entirely — these tests must reuse `rerender` from a single `render()`
  // call to actually exercise the update path.
  it('does not crash and hides the scrim when suppressPauseOverlay flips false -> true on a mounted instance', () => {
    const { container, rerender } = render(<PlayerOverlayPaused {...BASE} suppressPauseOverlay={false} />);
    expect(container.querySelector('.loading-overlay.paused')).not.toBeNull();

    expect(() => {
      rerender(<PlayerOverlayPaused {...BASE} suppressPauseOverlay />);
    }).not.toThrow();

    expect(container.querySelector('.loading-overlay.paused')).toBeNull();
  });

  // This direction (0 hooks -> N hooks on re-render) is the one confirmed by direct
  // reproduction to log React's "Internal React error: Expected static flag was missing"
  // against the broken (early-return-before-hooks) placement — a DEV-only symptom of hook
  // list corruption, not a synchronous throw. Assert it stays silent against the fix.
  it('does not crash, shows the scrim, and logs no React hook-order warning when suppressPauseOverlay flips true -> false on a mounted instance', () => {
    const { container, rerender } = render(<PlayerOverlayPaused {...BASE} suppressPauseOverlay />);
    expect(container.querySelector('.loading-overlay.paused')).toBeNull();

    expect(() => {
      rerender(<PlayerOverlayPaused {...BASE} suppressPauseOverlay={false} />);
    }).not.toThrow();

    expect(container.querySelector('.loading-overlay.paused')).not.toBeNull();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('does not crash when suppressForBlackout flips on a mounted instance (same latent hook-order shape)', () => {
    const { container, rerender } = render(<PlayerOverlayPaused {...BASE} suppressForBlackout={false} />);
    expect(container.querySelector('.loading-overlay.paused')).not.toBeNull();

    expect(() => {
      rerender(<PlayerOverlayPaused {...BASE} suppressForBlackout />);
    }).not.toThrow();
    expect(container.querySelector('.loading-overlay.paused')).toBeNull();

    expect(() => {
      rerender(<PlayerOverlayPaused {...BASE} suppressForBlackout={false} />);
    }).not.toThrow();
    expect(container.querySelector('.loading-overlay.paused')).not.toBeNull();
  });

  // Same discriminating direction/shape as the suppressPauseOverlay case above (mount
  // already-suppressed, i.e. 0 hooks reached on the first render, then rerender into the
  // hooks-reached branch) — confirmed by direct reproduction to be the reliable trigger for
  // React's "Internal React error: Expected static flag was missing" corruption warning
  // against the broken (early-return-before-hooks) placement.
  it('does not crash and logs no React hook-order warning when suppressForBlackout flips true -> false on a freshly-mounted instance', () => {
    const { container, rerender } = render(<PlayerOverlayPaused {...BASE} suppressForBlackout />);
    expect(container.querySelector('.loading-overlay.paused')).toBeNull();

    expect(() => {
      rerender(<PlayerOverlayPaused {...BASE} suppressForBlackout={false} />);
    }).not.toThrow();

    expect(container.querySelector('.loading-overlay.paused')).not.toBeNull();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('preserves blackout logging behaviour: no playbackLog call while suppressForBlackout is true', () => {
    render(<PlayerOverlayPaused {...BASE} suppressForBlackout />);
    expect(playbackLog).not.toHaveBeenCalled();
  });
});
