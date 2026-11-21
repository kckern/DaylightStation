import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SkylineSoundOverlay from './SkylineSoundOverlay.jsx';

describe('SkylineSoundOverlay', () => {
  it('shows the level, steps it by touch, and closes on Done', () => {
    const sound = { level: 60, muted: false, onLevel: vi.fn(), onToggleMute: vi.fn() };
    const onClose = vi.fn();
    const { container } = render(<SkylineSoundOverlay sound={sound} onClose={onClose}/>);
    expect(screen.getByRole('dialog', { name: 'Sound' })).toBeInTheDocument();
    expect(screen.getByTestId('skyline-sound-readout')).toHaveTextContent('Volume 60');
    fireEvent.click(container.querySelectorAll('.touch-volume-button')[10]);
    expect(sound.onLevel).toHaveBeenCalledWith(100);
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(sound.onToggleMute).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('skyline-sound-done'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
