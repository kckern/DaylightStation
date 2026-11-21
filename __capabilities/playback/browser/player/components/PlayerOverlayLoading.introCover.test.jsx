import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
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

  it('shows the spinner when no intro is covering', () => {
    setIntroCovering(false);
    const { container } = render(<PlayerOverlayLoading {...baseProps} />);
    expect(container.querySelector('.loading-overlay')).not.toBeNull();
  });
});
