import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import LightRow from './LightRow.jsx';

const lights = [{ entityId: 'light.desk', label: 'Desk', on: false, available: true }];
const wrap = (onToggle) => render(<MantineProvider><LightRow lights={lights} onToggle={onToggle} /></MantineProvider>);

describe('LightRow', () => {
  it('reverts the switch and shows an error toast when the toggle fails', async () => {
    const onToggle = vi.fn(() => Promise.resolve(false));
    wrap(onToggle);
    const sw = screen.getByRole('switch');
    fireEvent.click(sw);
    expect(onToggle).toHaveBeenCalledWith('light.desk', 'on');
    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent("Couldn't reach Desk");
    await waitFor(() => expect(sw).not.toBeChecked());
  });

  it('keeps the switch and shows no toast when the toggle succeeds', async () => {
    const onToggle = vi.fn(() => Promise.resolve(true));
    wrap(onToggle);
    const sw = screen.getByRole('switch');
    fireEvent.click(sw);
    await waitFor(() => expect(onToggle).toHaveBeenCalled());
    expect(sw).toBeChecked();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
