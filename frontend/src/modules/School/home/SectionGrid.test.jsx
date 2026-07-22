import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SectionGrid from './SectionGrid.jsx';
import { SECTIONS } from './sections.js';

describe('SectionGrid', () => {
  it('renders a tile per section and reports taps with the section id', () => {
    const onOpen = vi.fn();
    render(<SectionGrid sections={SECTIONS} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /practice/i }));
    expect(onOpen).toHaveBeenCalledWith('banks');
  });

  it('renders label and hint text on the tile', () => {
    render(<SectionGrid sections={[{ id: 'x', label: 'Label X', hint: 'Hint X' }]} onOpen={() => {}} />);
    expect(screen.getByText('Label X')).toBeInTheDocument();
    expect(screen.getByText('Hint X')).toBeInTheDocument();
  });
});
