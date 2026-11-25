import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ActionLog } from './ActionLog.jsx';

const wrap = (ui) => render(<MantineProvider>{ui}</MantineProvider>);

describe('ActionLog loading state', () => {
  it('shows the shared loading state while the log loads, then the empty message', async () => {
    const pending = Promise.withResolvers();
    wrap(<ActionLog loadLog={() => pending.promise} onUndo={() => {}} />);
    const loading = screen.getByLabelText('Loading what was done');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    pending.resolve({ entries: [] });
    await waitFor(() => expect(screen.getByText('Nothing in the last week.')).toBeInTheDocument());
    expect(screen.queryByLabelText('Loading what was done')).toBeNull();
  });
});
