import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { EntitySwitch } from './EntitySwitch.jsx';

const entity = stateClass => ({ id: 'lamp', name: 'Kitchen lamp', stateClass, controllable: true });
const view = (item, onToggle) => <MantineProvider><EntitySwitch entity={item} onToggle={onToggle} /></MantineProvider>;

describe('EntitySwitch', () => {
  it('clears a failed action alert once a later reading confirms its target state', async () => {
    const onToggle = vi.fn().mockResolvedValue(false);
    const tree = render(view(entity('on'), onToggle));

    fireEvent.click(screen.getByRole('switch', { name: 'Kitchen lamp: turn off' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain("Couldn't turn off Kitchen lamp");

    tree.rerender(view(entity('off'), onToggle));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());

    tree.rerender(view(entity('on'), onToggle));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not show a failure if the confirming reading arrives before the write rejects', async () => {
    let rejectWrite;
    const onToggle = vi.fn(() => new Promise(resolve => { rejectWrite = () => resolve(false); }));
    const tree = render(view(entity('on'), onToggle));

    fireEvent.click(screen.getByRole('switch', { name: 'Kitchen lamp: turn off' }));
    await waitFor(() => expect(rejectWrite).toBeTypeOf('function'));
    tree.rerender(view(entity('off'), onToggle));
    await act(async () => rejectWrite());

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('waits for a non-pending reading before retiring a matching target', async () => {
    const onToggle = vi.fn().mockResolvedValue(false);
    const tree = render(view(entity('on'), onToggle));
    fireEvent.click(screen.getByRole('switch', { name: 'Kitchen lamp: turn off' }));
    await screen.findByRole('alert');

    tree.rerender(view({ ...entity('off'), pending: true }, onToggle));
    expect(screen.getByRole('alert')).toBeTruthy();

    tree.rerender(view(entity('off'), onToggle));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
