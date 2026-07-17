import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';

const setPurpose = vi.fn(() => Promise.reject(new Error('Plan not found')));
vi.mock('../../hooks/useLifePlan.js', () => ({
  useLifePlan: () => ({
    plan: { purpose: null },
    loading: false,
    isEmpty: true,
    updateSection: vi.fn(),
    setPurpose,
  }),
}));
import { PurposeView } from './PurposeView.jsx';

const wrap = (ui) => render(<MantineProvider><MemoryRouter>{ui}</MemoryRouter></MantineProvider>);

describe('PurposeView', () => {
  it('shows an error and keeps the editor open when the save fails', async () => {
    wrap(<PurposeView />);
    fireEvent.click(screen.getByTestId('edit'));
    const box = await screen.findByRole('textbox');
    fireEvent.change(box, { target: { value: 'To raise kind kids.' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    // Editor stays open (textbox still present) so the input isn't lost.
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});
