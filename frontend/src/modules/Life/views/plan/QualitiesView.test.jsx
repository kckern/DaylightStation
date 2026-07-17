import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../hooks/useLifePlan.js', () => ({
  useLifePlan: () => ({ plan: { qualities: [] }, loading: false, error: null }),
}));
import { QualitiesView } from './QualitiesView.jsx';

const wrap = (ui) => render(<MantineProvider><MemoryRouter>{ui}</MemoryRouter></MantineProvider>);

describe('QualitiesView empty state', () => {
  it('offers a coach path instead of dead-ending', () => {
    wrap(<QualitiesView />);
    expect(screen.getByText(/talk to your coach/i)).toBeInTheDocument();
  });
});
