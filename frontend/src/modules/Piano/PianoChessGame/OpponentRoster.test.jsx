import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OpponentRosterModal } from './OpponentRoster.jsx';

const ROSTER = [
  { level: 0, name: 'Bulbasaur', theme: '#3a6' },
  { level: 1, name: 'Ivysaur', theme: '#486' },
  { level: 2, name: 'Venusaur', theme: '#284' },
];

describe('OpponentRosterModal', () => {
  it('uses the shared focused modal and labels each character state', () => {
    render(<OpponentRosterModal roster={ROSTER} unlockedThrough={1} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Opponents' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();
    expect(screen.getByText('Beaten')).toBeInTheDocument();
    expect(screen.getByText('Now')).toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
  });

  it('closes from Escape, Done, and the scrim', () => {
    const onClose = vi.fn();
    const { container } = render(
      <OpponentRosterModal roster={ROSTER} unlockedThrough={1} onClose={onClose} />,
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(container.querySelector('.pg-sheet__scrim'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
