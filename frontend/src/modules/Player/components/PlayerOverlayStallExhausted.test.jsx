import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { PlayerOverlayStallExhausted } from './PlayerOverlayStallExhausted.jsx';

describe('PlayerOverlayStallExhausted', () => {
  it('does not render when exhausted=false', () => {
    const { container } = render(
      <PlayerOverlayStallExhausted exhausted={false} secondsStalled={5} onRestart={() => {}} onDismiss={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders with restart and dismiss CTAs when exhausted=true', () => {
    const { getByRole, getByText } = render(
      <PlayerOverlayStallExhausted exhausted={true} secondsStalled={20} onRestart={() => {}} onDismiss={() => {}} />
    );
    expect(getByText(/stuck/i)).toBeInTheDocument();
    expect(getByRole('button', { name: /restart/i })).toBeInTheDocument();
    expect(getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('calls onRestart when restart button clicked', () => {
    const onRestart = vi.fn();
    const { getByRole } = render(
      <PlayerOverlayStallExhausted exhausted={true} secondsStalled={20} onRestart={onRestart} onDismiss={() => {}} />
    );
    fireEvent.click(getByRole('button', { name: /restart/i }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss when dismiss button clicked', () => {
    const onDismiss = vi.fn();
    const { getByRole } = render(
      <PlayerOverlayStallExhausted exhausted={true} secondsStalled={20} onRestart={() => {}} onDismiss={onDismiss} />
    );
    fireEvent.click(getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
