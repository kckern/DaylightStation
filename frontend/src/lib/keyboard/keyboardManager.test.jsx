import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAdvancedKeyboardHandler } from './keyboardManager.js';

/**
 * Minimal harness: renders a throwaway component that calls the hook.
 * @param {object} config - forwarded to useAdvancedKeyboardHandler
 */
function Harness({ config }) {
  useAdvancedKeyboardHandler(config);
  return null;
}

/**
 * Dispatch a KeyboardEvent on window.
 * `trusted` simulates a real user keypress — jsdom creates events with
 * isTrusted=false by default, so we override the property via
 * Object.defineProperty. Real browsers only set isTrusted=true for
 * events originating from actual user input, which is exactly the
 * distinction the production fix relies on.
 */
function dispatchKey(key, { trusted = true } = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  if (trusted) {
    Object.defineProperty(event, 'isTrusted', { value: true, configurable: true });
  }
  window.dispatchEvent(event);
}

describe('useAdvancedKeyboardHandler double-click detection', () => {
  let actionHandlers;
  const config = () => ({
    keyMappings: {
      ArrowLeft: 'seekBackward',
      ArrowRight: 'seekForward',
    },
    actionHandlers,
    enableDoubleClick: true,
    doubleClickDelay: 350,
  });

  beforeEach(() => {
    actionHandlers = {
      seekBackward: vi.fn(),
      seekForward: vi.fn(),
      previousTrack: vi.fn(),
      nextTrack: vi.fn(),
    };
  });

  it('promotes two rapid *trusted* ArrowLeft presses to previousTrack', () => {
    render(<Harness config={config()} />);

    dispatchKey('ArrowLeft', { trusted: true });
    dispatchKey('ArrowLeft', { trusted: true });

    expect(actionHandlers.previousTrack).toHaveBeenCalledTimes(1);
  });

  it('promotes two rapid *trusted* ArrowRight presses to nextTrack', () => {
    render(<Harness config={config()} />);

    dispatchKey('ArrowRight', { trusted: true });
    dispatchKey('ArrowRight', { trusted: true });

    expect(actionHandlers.nextTrack).toHaveBeenCalledTimes(1);
  });

  it('does NOT promote rapid *synthetic* ArrowLeft presses (e.g. from keypad rew button)', () => {
    render(<Harness config={config()} />);

    dispatchKey('ArrowLeft', { trusted: false });
    dispatchKey('ArrowLeft', { trusted: false });
    dispatchKey('ArrowLeft', { trusted: false });

    expect(actionHandlers.previousTrack).not.toHaveBeenCalled();
    expect(actionHandlers.seekBackward).toHaveBeenCalledTimes(3);
  });

  it('does NOT promote rapid *synthetic* ArrowRight presses (e.g. from keypad fwd button)', () => {
    render(<Harness config={config()} />);

    dispatchKey('ArrowRight', { trusted: false });
    dispatchKey('ArrowRight', { trusted: false });
    dispatchKey('ArrowRight', { trusted: false });

    expect(actionHandlers.nextTrack).not.toHaveBeenCalled();
    expect(actionHandlers.seekForward).toHaveBeenCalledTimes(3);
  });

  it('does NOT promote a mixed trusted+synthetic burst', () => {
    // If the first press is a real user ArrowLeft and the second is a synthetic
    // rew dispatch, the synthetic one should not latch onto the trusted first
    // press to form a "double-click".
    render(<Harness config={config()} />);

    dispatchKey('ArrowLeft', { trusted: true });
    dispatchKey('ArrowLeft', { trusted: false });

    expect(actionHandlers.previousTrack).not.toHaveBeenCalled();
    expect(actionHandlers.seekBackward).toHaveBeenCalledTimes(2);
  });
});
