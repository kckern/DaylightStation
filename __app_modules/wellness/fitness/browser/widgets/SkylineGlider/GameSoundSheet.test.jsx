import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import GameSoundSheet from './GameSoundSheet.jsx';

describe('GameSoundSheet (shared by Skyline Glider and Skyline Invaders)', () => {
  it('draws the readout, the house touch volume strip and a mute key under the given class prefix', () => {
    const onLevel = vi.fn();
    const onToggleMute = vi.fn();
    const { container } = render(<GameSoundSheet level={60} muted={false} onLevel={onLevel} onToggleMute={onToggleMute} classPrefix="skyline-invaders" testIdPrefix="skyline-invaders-sound" />);
    expect(container.querySelector('input[type="range"]')).toBeNull();
    expect(container.querySelector('.skyline-invaders__readout')).not.toBeNull();
    expect(container.querySelector('.skyline-invaders__volume .touch-volume')).not.toBeNull();
    expect(screen.getByTestId('skyline-invaders-sound-readout')).toHaveTextContent('Volume 60');
    const keys = container.querySelectorAll('.touch-volume-button');
    expect(keys).toHaveLength(11);
    fireEvent.click(keys[3], { detail: 0 });
    expect(onLevel).toHaveBeenCalledWith(30);
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(onToggleMute).toHaveBeenCalledTimes(1);
  });

  it('leaves the mute key out when the game draws its own', () => {
    const { container } = render(<GameSoundSheet level={60} muted onLevel={vi.fn()} onToggleMute={vi.fn()} showMute={false} />);
    expect(screen.queryByRole('button', { name: /^(Mute|Unmute)$/ })).toBeNull();
    expect(screen.getByTestId('skyline-sound-readout')).toHaveTextContent('Muted');
    expect(container.querySelectorAll('.touch-volume-button.on')).toHaveLength(0);
  });
});
