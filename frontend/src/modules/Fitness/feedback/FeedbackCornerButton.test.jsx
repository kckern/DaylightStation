import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import FeedbackCornerButton from './FeedbackCornerButton.jsx';

describe('FeedbackCornerButton', () => {
  it('renders a labelled mic button', () => {
    render(<FeedbackCornerButton onOpen={() => {}} />);
    const btn = screen.getByTestId('fitness-feedback-trigger');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-label');
  });

  it('calls onOpen when tapped', () => {
    const onOpen = vi.fn();
    render(<FeedbackCornerButton onOpen={onOpen} />);
    fireEvent.pointerDown(screen.getByTestId('fitness-feedback-trigger'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
