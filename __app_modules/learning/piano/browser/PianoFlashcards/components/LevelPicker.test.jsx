import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LevelPicker } from './LevelPicker.jsx';

const LEVELS = [
  { name: 'Middle C', card_type: 'note' },
  { name: 'Major triads', card_type: 'chord' },
];

describe('LevelPicker', () => {
  it('is a focused modal with a visible close control and marked current level', () => {
    render(<LevelPicker levels={LEVELS} currentLevel={1} onSelect={vi.fn()} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Choose level' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();
    expect(screen.getByRole('button', { name: /Major triads/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Close level picker' })).toBeInTheDocument();
  });

  it('closes on Escape and the close button', () => {
    const onClose = vi.fn();
    render(<LevelPicker levels={LEVELS} currentLevel={0} onSelect={vi.fn()} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close level picker' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('selects a level without hiding its note or chord kind', () => {
    const onSelect = vi.fn();
    render(<LevelPicker levels={LEVELS} currentLevel={0} onSelect={onSelect} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Major triads/ }));
    expect(onSelect).toHaveBeenCalledWith(1);
    expect(screen.getByText('Chords')).toBeInTheDocument();
  });
});
