import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

vi.mock('../../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
import { DaylightAPI } from '../../../../../../frontend/src/lib/api.mjs';
import WorkshopPanel from './WorkshopPanel.jsx';
import { previewStore } from './previewStore.js';

function setup(partial) {
  act(() => previewStore.publish({ ratingKey: '77', scenes: [{ id: 'sc1', cues: ['a'] }], override: {}, ...partial }));
  return render(<WorkshopPanel />);
}

describe('WorkshopPanel', () => {
  let refresh;
  beforeEach(() => {
    act(() => previewStore.reset());
    vi.restoreAllMocks();
    DaylightAPI.mockReset();
    refresh = vi.spyOn(previewStore, 'refresh').mockResolvedValue(undefined);
  });

  it('renders nothing with no selection', () => {
    const { container } = setup({ selected: null });
    expect(container.textContent).toBe('');
  });

  it('Draft with AI shows the returned text', async () => {
    DaylightAPI.mockResolvedValue({ card: { text: 'They escape.' } });
    setup({ selected: { id: 'sc1', kind: 'scene', in: 100 } });
    fireEvent.click(screen.getByRole('button', { name: 'Draft with AI' }));
    await waitFor(() => expect(screen.getByTestId('workshop-card').textContent).toBe('They escape.'));
    expect(DaylightAPI).toHaveBeenCalledWith('/api/v1/content-filter/77/scenes/sc1/card', {}, 'POST');
  });

  it('a failed draft shows the error and does not refresh', async () => {
    DaylightAPI.mockRejectedValue(new Error('500'));
    setup({ selected: { id: 'sc1', kind: 'scene', in: 100 } });
    fireEvent.click(screen.getByRole('button', { name: 'Draft with AI' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Could not draft a card/));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('Approve PUTs the card then refreshes', async () => {
    DaylightAPI.mockResolvedValueOnce({ card: { text: 'They escape.' } }).mockResolvedValueOnce({ ruling: {} });
    setup({ selected: { id: 'sc1', kind: 'scene', in: 100 } });
    fireEvent.click(screen.getByRole('button', { name: 'Draft with AI' }));
    await screen.findByText('They escape.');
    refresh.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(DaylightAPI).toHaveBeenLastCalledWith('/api/v1/content-filter/77/scenes/sc1', { card: { approve: true, text: 'They escape.' } }, 'PUT');
  });

  it('scene effect buttons PUT the ruling; a failure shows the text and skips refresh', async () => {
    DaylightAPI.mockResolvedValueOnce({ ruling: {} }).mockRejectedValueOnce(new Error('boom'));
    setup({ selected: { id: 'sc1', kind: 'scene', in: 100 } });
    fireEvent.click(screen.getByRole('button', { name: 'Tags only' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(DaylightAPI).toHaveBeenCalledWith('/api/v1/content-filter/77/scenes/sc1', { effect: 'off' }, 'PUT');
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('boom'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a selected cue offers Off/Mute/Bleep/Blur/Skip and PUTs to the cue route', async () => {
    DaylightAPI.mockResolvedValue({ ruling: {} });
    setup({ selected: { id: 'va1', label: 'A word', effect: 'mute', in: 5, out: 6 } });
    for (const n of ['Off', 'Mute', 'Bleep', 'Blur', 'Skip']) expect(screen.getByRole('button', { name: n })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bleep' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(DaylightAPI).toHaveBeenCalledWith('/api/v1/content-filter/77/cues/va1', { effect: 'bleep' }, 'PUT');
  });
});
