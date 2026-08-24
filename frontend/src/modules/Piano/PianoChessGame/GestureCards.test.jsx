import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import GestureCards from './GestureCards.jsx';

describe('gesture cards', () => {
  it('draws the keys and a compact label for each gesture', () => {
    const { container } = render(<GestureCards gestures={[{ id: 'octave', pressed: [0, 12], title: 'Put it back' }]} />);
    expect(screen.getByText('Put it back')).toBeInTheDocument();
    expect(container.querySelector('.gesture-card__keys')).toBeTruthy();
  });

  it('marks a gesture that has to be played more than once', () => {
    const { container } = render(
      <GestureCards gestures={[{ id: 'takeback', pressed: [0, 12], repeat: 2, title: 'Take it back', note: '3 left' }]} />,
    );
    expect(container.querySelector('.gesture-card__repeat').textContent).toBe('×2');
  });

  it('says nothing about repeats for a gesture played once', () => {
    const { container } = render(
      <GestureCards gestures={[{ id: 'octave', pressed: [0, 12], title: 'Put it back' }]} />,
    );
    expect(container.querySelector('.gesture-card__repeat')).toBe(null);
  });
});
