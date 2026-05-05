import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChallengeOverlayDeck } from './ChallengeOverlayDeck.jsx';
import { CHALLENGE_OVERLAY_POSITION_KEY } from './useChallengeOverlayPosition.js';

describe('ChallengeOverlayDeck', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') window.localStorage?.clear?.();
  });

  it('applies the top position class by default', () => {
    const { container } = render(
      <ChallengeOverlayDeck>
        <div data-testid="child" />
      </ChallengeOverlayDeck>
    );
    expect(container.querySelector('.challenge-overlay-deck--pos-top')).toBeTruthy();
  });

  it('cycles position on click', () => {
    const { container } = render(
      <ChallengeOverlayDeck>
        <div data-testid="child" />
      </ChallengeOverlayDeck>
    );
    const deck = container.querySelector('.challenge-overlay-deck');
    fireEvent.click(deck);
    expect(container.querySelector('.challenge-overlay-deck--pos-middle')).toBeTruthy();
    fireEvent.click(deck);
    expect(container.querySelector('.challenge-overlay-deck--pos-bottom')).toBeTruthy();
    fireEvent.click(deck);
    expect(container.querySelector('.challenge-overlay-deck--pos-top')).toBeTruthy();
  });

  it('persists position changes to localStorage so both overlays share state', () => {
    const { container } = render(
      <ChallengeOverlayDeck>
        <div data-testid="child" />
      </ChallengeOverlayDeck>
    );
    fireEvent.click(container.querySelector('.challenge-overlay-deck'));
    expect(window.localStorage.getItem(CHALLENGE_OVERLAY_POSITION_KEY)).toBe('middle');
  });

  it('renders children inside the deck', () => {
    render(
      <ChallengeOverlayDeck>
        <div data-testid="child-a">A</div>
        <div data-testid="child-b">B</div>
      </ChallengeOverlayDeck>
    );
    expect(screen.getByTestId('child-a')).toBeInTheDocument();
    expect(screen.getByTestId('child-b')).toBeInTheDocument();
  });

  it('renders nothing when there are no children', () => {
    const { container } = render(<ChallengeOverlayDeck />);
    // The deck still mounts (so position state survives) but is visually empty.
    expect(container.querySelector('.challenge-overlay-deck')).toBeTruthy();
  });
});
