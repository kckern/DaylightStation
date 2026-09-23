import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import React from 'react';
import { ProgressBar } from './ProgressBar.jsx';

const fill = (container) => container.querySelector('.progress');

describe('ProgressBar keyframe play state', () => {
  it('pauses the fill animation while playback is paused', () => {
    const { container } = render(
      <ProgressBar percent={25} durationSeconds={100} offsetSeconds={25} paused />
    );
    expect(fill(container).style.animationName).toBe('playerProgressFill');
    expect(fill(container).style.animationPlayState).toBe('paused');
  });

  it('runs the fill animation while playing, and pauses it on pause', () => {
    const { container, rerender } = render(
      <ProgressBar percent={25} durationSeconds={100} offsetSeconds={25} paused={false} />
    );
    expect(fill(container).style.animationPlayState).toBe('running');

    rerender(<ProgressBar percent={25} durationSeconds={100} offsetSeconds={25} paused />);
    expect(fill(container).style.animationPlayState).toBe('paused');
  });
});
