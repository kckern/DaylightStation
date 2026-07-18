// frontend/src/modules/Piano/PianoKiosk/modes/Composer/Gallery.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Gallery } from './Gallery.jsx';

describe('Gallery', () => {
  it('lists songs and opens one', async () => {
    const list = vi.fn().mockResolvedValue([{ id: 'a', title: 'Tune A' }]);
    const onOpen = vi.fn();
    render(<Gallery list={list} onOpen={onOpen} onNew={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Tune A')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Tune A'));
    expect(onOpen).toHaveBeenCalledWith('a');
  });
  it('offers a start-a-new-song CTA when empty', async () => {
    const onNew = vi.fn();
    render(<Gallery list={vi.fn().mockResolvedValue([])} onOpen={vi.fn()} onNew={onNew} />);
    const cta = await screen.findByRole('button', { name: /start a new one/i });
    fireEvent.click(cta);
    expect(onNew).toHaveBeenCalled();
  });
});
