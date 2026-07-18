import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NewSongSetup } from './NewSongSetup.jsx';

describe('NewSongSetup', () => {
  it('Skip creates a default song and reports the new id', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'new1' });
    const onCreated = vi.fn();
    render(<NewSongSetup create={create} onCreated={onCreated} />);
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new1'));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ musicxml: expect.stringContaining('score-partwise') }));
  });

  it('resets busy and shows an error when create rejects, without calling onCreated', async () => {
    const create = vi.fn().mockRejectedValue(new Error('network down'));
    const onCreated = vi.fn();
    render(<NewSongSetup create={create} onCreated={onCreated} />);
    const button = screen.getByRole('button', { name: /skip/i });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('network down'));
    expect(button).not.toBeDisabled();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
