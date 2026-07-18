import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StickyDurationHud } from './StickyDurationHud.jsx';

describe('StickyDurationHud', () => {
  it('shows the duration and armed state', () => {
    render(<StickyDurationHud hud={{ type: 'eighth', dots: 1, triplet: false, armed: true }} />);
    expect(screen.getByText(/eighth/i)).toBeInTheDocument();
    expect(screen.getByText(/armed/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/dotted/i)).toBeInTheDocument();
  });
  it('shows disarmed when not armed', () => {
    render(<StickyDurationHud hud={{ type: 'quarter', dots: 0, triplet: false, armed: false }} />);
    expect(screen.getByText(/disarmed/i)).toBeInTheDocument();
  });
});
