import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import ModeSheet from './ModeSheet.jsx';
import { MODES } from './practiceModes.js';

describe('ModeSheet', () => {
  it('offers the four modes with icons, current one lit, and picks', () => {
    const onPick = vi.fn(); const onClose = vi.fn();
    render(<ModeSheet open mode="listen" onPick={onPick} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Mode' })).toBeInTheDocument();
    expect(MODES.map((m) => m.id)).toEqual(['listen', 'learn', 'polish', 'perform']);
    const listen = screen.getByRole('button', { name: 'Listen' });
    expect(listen).toHaveAttribute('aria-pressed', 'true');
    expect(listen.querySelector('.piano-icon')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Polish' }));
    expect(onPick).toHaveBeenCalledWith('polish');
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    render(<ModeSheet open={false} mode="listen" onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog', { name: 'Mode' })).toBeNull();
  });

  it('only the current mode is lit; the rest are not pressed', () => {
    render(<ModeSheet open mode="polish" onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Polish' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Listen' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Learn' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Perform' })).toHaveAttribute('aria-pressed', 'false');
  });
});
