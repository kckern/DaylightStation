import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import ControlLegend from './ControlLegend.jsx';

describe('ControlLegend', () => {
  it('on the grid, shows open + exit hints', () => {
    render(<ControlLegend level="grid" contextOpen={false} mediaType="none" playing={false} modalType={null} />);
    expect(screen.getByText(/Open/)).toBeInTheDocument();
    expect(screen.getByText(/Exit/)).toBeInTheDocument();
  });

  it('on a photo reel, shows browse + details hints', () => {
    render(<ControlLegend level="reel" contextOpen={false} mediaType="photo" playing={false} modalType={null} />);
    expect(screen.getByText(/Browse/)).toBeInTheDocument();
    expect(screen.getByText(/Details/)).toBeInTheDocument();
  });

  it('renders nothing while a modal is open (the modal owns the hints)', () => {
    const { container } = render(<ControlLegend level="grid" contextOpen={false} mediaType="none" playing={false} modalType="exitGate" />);
    expect(container.firstChild).toBeNull();
  });
});
