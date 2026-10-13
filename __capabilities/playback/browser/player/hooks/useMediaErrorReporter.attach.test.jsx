/**
 * Regression guard for the 2026-07-21 leak fix.
 *
 * Making the transport callbacks identity-stable (to break the render-generation
 * retention chain) silently removed the accidental re-trigger that got these
 * listeners attached. At track start the media element does NOT exist yet —
 * SinglePlayer renders null until its async meta fetch resolves — so the effect
 * bails, and with a now-constant `getMediaEl` nothing ever re-ran it. The 'error'
 * listener and the load-timeout timer were never armed, which silently killed the
 * dead-stream error card + retry in FitnessMusicPlayer and DancePartyWidget.
 *
 * These tests fail if `registrationSignal` is dropped from the hook's deps.
 */
import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useMediaErrorReporter } from './useMediaErrorReporter.js';

function Harness({ getMediaEl, registrationSignal, onError, mediaLoadTimeoutMs = null }) {
  useMediaErrorReporter({
    getMediaEl,
    mediaKey: 'track-1',
    onError,
    mediaLoadTimeoutMs,
    registrationSignal
  });
  return null;
}

describe('useMediaErrorReporter — attaches once the element appears', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('attaches the error listener when the element arrives AFTER first render', () => {
    // Element is absent on mount (the real track-start case), then registers.
    let el = null;
    const getMediaEl = () => el;              // STABLE identity, as post-fix
    const onError = vi.fn();
    const access = { v: 0 };

    const { rerender } = render(
      <Harness getMediaEl={getMediaEl} registrationSignal={access} onError={onError} />
    );

    // Renderer mounts and registers: element now exists, registration identity changes.
    el = document.createElement('video');
    const addSpy = vi.spyOn(el, 'addEventListener');
    rerender(
      <Harness getMediaEl={getMediaEl} registrationSignal={{ v: 1 }} onError={onError} />
    );

    const events = addSpy.mock.calls.map(([name]) => name);
    expect(events).toContain('error');
  });

  it('arms the load-timeout for an element that appears after mount', () => {
    let el = null;
    const getMediaEl = () => el;
    const onError = vi.fn();

    const { rerender } = render(
      <Harness getMediaEl={getMediaEl} registrationSignal={{ v: 0 }}
        onError={onError} mediaLoadTimeoutMs={15000} />
    );

    // Nothing armed yet — no element.
    act(() => { vi.advanceTimersByTime(20000); });
    expect(onError).not.toHaveBeenCalled();

    el = document.createElement('video');
    rerender(
      <Harness getMediaEl={getMediaEl} registrationSignal={{ v: 1 }}
        onError={onError} mediaLoadTimeoutMs={15000} />
    );

    // Timer armed on re-attach; neither canplay nor playing arrives.
    act(() => { vi.advanceTimersByTime(15001); });
    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0]).toMatchObject({ kind: 'media-load-timeout' });
  });
});
