// frontend/src/modules/Health/CoachChat/chips/Chip.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Chip } from './Chip.jsx';

function renderInMantine(ui) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('Chip', () => {
  it('renders the label', () => {
    renderInMantine(<Chip label="Last 30 days" chipKey="period" />);
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
  });

  it('falls back gracefully for unknown chipKey', () => {
    renderInMantine(<Chip label="Foo" chipKey="bogus" />);
    expect(screen.getByText('Foo')).toBeInTheDocument();
  });

  it('applies the correct mantine color via data attribute', () => {
    renderInMantine(<Chip label="Workout May 4" chipKey="workout" />);
    const chip = screen.getByText('Workout May 4').closest('[data-chip-key]');
    expect(chip?.getAttribute('data-chip-key')).toBe('workout');
  });
});
