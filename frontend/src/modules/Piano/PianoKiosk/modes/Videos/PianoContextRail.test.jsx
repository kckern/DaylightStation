import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PianoContextRail from './PianoContextRail.jsx';

describe('PianoContextRail', () => {
  it('renders program identity, ring, and a tappable ancestor', () => {
    const onClick = vi.fn();
    render(<PianoContextRail program="Piano With Jonny" ancestors={[{ label: 'Season 1', onClick }]}
      ring={{ percent: 21, label: '21%' }} />);
    expect(screen.getByText('Piano With Jonny')).toBeTruthy();
    expect(screen.getByText('21%')).toBeTruthy();
    fireEvent.click(screen.getByText((content) => content.includes('Season 1')));
    expect(onClick).toHaveBeenCalled();
  });
  it('renders a Continue button that fires onContinue', () => {
    const onContinue = vi.fn();
    render(<PianoContextRail program="P" continue={{ kicker: 'Continue', title: 'Essential Exercises', sub: 'Lesson 3' }} onContinue={onContinue} />);
    fireEvent.click(screen.getByText('Essential Exercises').closest('button'));
    expect(onContinue).toHaveBeenCalled();
  });
});
