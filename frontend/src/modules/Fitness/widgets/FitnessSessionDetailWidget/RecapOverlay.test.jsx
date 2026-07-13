import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import RecapOverlay from './RecapOverlay.jsx';

describe('RecapOverlay', () => {
  it('renders a video with the given src', () => {
    const { container } = render(
      <RecapOverlay src="/api/v1/proxy/media/video/fitness/x.mp4" onClose={() => {}} />
    );
    const video = container.querySelector('video');
    expect(video).toBeTruthy();
    expect(video.getAttribute('src')).toContain('video/fitness/x.mp4');
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(<RecapOverlay src="x.mp4" onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on backdrop tap but not on the video itself', () => {
    const onClose = vi.fn();
    const { container } = render(<RecapOverlay src="x.mp4" onClose={onClose} />);
    fireEvent.pointerDown(container.querySelector('.recap-overlay__video'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(container.querySelector('.recap-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
