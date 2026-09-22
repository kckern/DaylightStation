import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AimLabel } from './AimLabel.jsx';

const office = { id: 'office-tv', name: 'Office TV', room: 'Office' };

describe('AimLabel', () => {
  it.each(['Play', 'Add to queue', 'Open', 'Move to', 'Play next'])(
    'keeps the same explicit aim beside the %s verb',
    (verb) => {
      render(<div><button>{verb}</button><AimLabel targetIds={['office-tv']} devices={[office]} /></div>);
      expect(screen.getByTestId('aim-label')).toHaveTextContent('Office TV');
      expect(screen.getByTestId('aim-label')).toHaveTextContent('Office');
    }
  );

  it('names this device and its human name for a local aim', () => {
    render(<AimLabel targetIds={[]} devices={[]} localName="Kitchen iPad" />);
    expect(screen.getByTestId('aim-label')).toHaveTextContent('This device');
    expect(screen.getByTestId('aim-label')).toHaveTextContent('Kitchen iPad');
  });

  it('uses a stable screen count for a multi-screen aim', () => {
    render(<AimLabel targetIds={['office-tv', 'den-tv']} devices={[office]} />);
    expect(screen.getByTestId('aim-label')).toHaveTextContent('2 screens');
  });

  it('makes a busy origin visible before a tap', () => {
    render(<AimLabel targetIds={['office-tv']} devices={[office]} busyOrigin="Family room tablet" />);
    expect(screen.getByTestId('aim-busy-origin')).toHaveTextContent('Busy');
    expect(screen.getByTestId('aim-busy-origin')).toHaveTextContent('Family room tablet');
  });

  it('states the remembered stop/keep behavior while local playback is active', () => {
    const { rerender } = render(
      <AimLabel targetIds={['office-tv']} devices={[office]} localPlaying mode="transfer" />
    );
    expect(screen.getByTestId('aim-behavior')).toHaveTextContent('move playback');
    rerender(<AimLabel targetIds={['office-tv']} devices={[office]} localPlaying mode="fork" />);
    expect(screen.getByTestId('aim-behavior')).toHaveTextContent('keep playing here');
  });
});
