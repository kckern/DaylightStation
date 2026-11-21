import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { PlayerOverlayLoading } from './PlayerOverlayLoading.jsx';
import { setIntroCovering } from '../../player-support/introCover.js';

const baseProps = {
  shouldRender: true,
  isVisible: true,
  waitingToPlay: true,
  seconds: 0,
  status: 'loading',
};

describe('PlayerOverlayLoading — covering intro', () => {
  afterEach(() => setIntroCovering(false));

  it('hides the plain spinner while an intro is covering', () => {
    setIntroCovering(true);
    const { container } = render(<PlayerOverlayLoading {...baseProps} />);
    expect(container.querySelector('.loading-overlay')).toBeNull();
  });

  it('keeps the exhausted recovery UI over a covering intro', () => {
    setIntroCovering(true);
    const { container } = render(<PlayerOverlayLoading {...baseProps} isExhausted />);
    expect(container.querySelector('.loading-overlay')).not.toBeNull();
  });

  it('keeps the held recovery UI over a covering intro', () => {
    setIntroCovering(true);
    const { container } = render(<PlayerOverlayLoading {...baseProps} held />);
    expect(container.querySelector('.loading-overlay')).not.toBeNull();
  });

  it('keeps the source-healing wait (notice and Skip) over a covering intro', () => {
    setIntroCovering(true);
    const { container, getByTestId } = render(
      <PlayerOverlayLoading {...baseProps} sourceNotice="Fixing this video… · 0:05" onSkipSource={vi.fn()} />,
    );
    expect(container.querySelector('.loading-overlay')).not.toBeNull();
    expect(getByTestId('player-source-notice')).toBeInTheDocument();
    expect(getByTestId('player-source-skip')).toBeInTheDocument();
  });

  it('keeps the link notice over a covering intro', () => {
    setIntroCovering(true);
    const { getByTestId } = render(<PlayerOverlayLoading {...baseProps} linkNotice="Slow connection" />);
    expect(getByTestId('player-link-notice')).toBeInTheDocument();
  });

  it('shows the spinner when no intro is covering', () => {
    setIntroCovering(false);
    const { container } = render(<PlayerOverlayLoading {...baseProps} />);
    expect(container.querySelector('.loading-overlay')).not.toBeNull();
  });
});
