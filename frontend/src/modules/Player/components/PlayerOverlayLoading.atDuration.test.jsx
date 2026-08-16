import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { PlayerOverlayLoading } from './PlayerOverlayLoading.jsx';

// playbackLog is not relevant to the at-duration suppression check — silence it
// to keep the test focused on the visible surface. (The mediaDiagnostics mock
// that used to sit here went with the dead diagnostics poll, 2026-08-16.)
vi.mock('../lib/playbackLogger.js', () => ({ playbackLog: vi.fn() }));

const baseProps = {
  shouldRender: true,
  isVisible: true,
  status: 'seeking',
  overlayLoggingActive: false,
  waitKey: 'test-overlay',
  seconds: 441.76
};

describe('PlayerOverlayLoading at-duration suppression', () => {
  it('renders the loading overlay during a mid-stream seek', () => {
    const { container } = render(
      <PlayerOverlayLoading
        {...baseProps}
        mediaDetails={{ hasElement: true, currentTime: 100, duration: 441.76, paused: false }}
      />
    );
    expect(container.querySelector('.loading-overlay')).not.toBeNull();
    expect(container.querySelector('.loading-spinner')).not.toBeNull();
  });

  it('does NOT render the loading overlay when paused at duration (audit 2026-05-23)', () => {
    const { container } = render(
      <PlayerOverlayLoading
        {...baseProps}
        mediaDetails={{ hasElement: true, currentTime: 441.76, duration: 441.76, paused: true }}
      />
    );
    expect(container.querySelector('.loading-overlay')).toBeNull();
  });

  it('does NOT render the overlay when paused within thresholdSeconds of duration', () => {
    const { container } = render(
      <PlayerOverlayLoading
        {...baseProps}
        mediaDetails={{ hasElement: true, currentTime: 441.4, duration: 441.76, paused: true }}
      />
    );
    expect(container.querySelector('.loading-overlay')).toBeNull();
  });

  it('still renders when at duration but NOT paused (e.g. live progression past end)', () => {
    const { container } = render(
      <PlayerOverlayLoading
        {...baseProps}
        mediaDetails={{ hasElement: true, currentTime: 441.76, duration: 441.76, paused: false }}
      />
    );
    expect(container.querySelector('.loading-overlay')).not.toBeNull();
  });
});
