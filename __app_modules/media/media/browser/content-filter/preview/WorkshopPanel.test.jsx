import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';

vi.mock('../../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
import { DaylightAPI } from '../../../../../../frontend/src/lib/api.mjs';
import WorkshopPanel from './WorkshopPanel.jsx';
import { previewStore } from './previewStore.js';

function setup(partial) {
  // sc1 is cut (a skip-card piece plays), so its title card is offered.
  act(() => previewStore.publish({
    ratingKey: '77', scenes: [{ id: 'sc1', cues: ['a'] }, { id: 'sc2', cues: ['b'] }],
    cues: [{ id: 'sc1', scene: 'sc1', effect: 'skip-card', in: 100, out: 120 }], override: {}, ...partial,
  }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Play it' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(DaylightAPI).toHaveBeenCalledWith('/api/v1/content-filter/77/scenes/sc1', { effect: 'off' }, 'PUT');
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('boom'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a scene that plays offers no card until it is cut', () => {
    setup({ selected: { id: 'sc2', kind: 'scene', in: 300 } });
    expect(screen.queryByRole('button', { name: 'Draft with AI' })).toBeNull();
    expect(screen.getByText(/once the scene is skipped or hidden/)).toBeTruthy();
    for (const n of ['Play it', 'Hide picture', 'Skip', 'Use settings']) expect(screen.getByRole('button', { name: n })).toBeTruthy();
  });

  it('a cue offers Use settings only once it has a ruling of its own', () => {
    setup({ selected: { id: 'va1', effect: 'mute', in: 5, out: 6 } });
    expect(screen.queryByRole('button', { name: 'Use settings' })).toBeNull();
    expect(screen.getByText('For this word')).toBeTruthy();
    cleanup();
    setup({ selected: { id: 'va1', effect: 'mute', in: 5, out: 6 }, override: { cueOverrides: { va1: { effect: 'bleep' } } } });
    expect(screen.getByRole('button', { name: 'Use settings' })).toBeTruthy();
  });

  it('a measured cue id (va123#0) is ruled by its base id', async () => {
    DaylightAPI.mockResolvedValue({ ruling: {} });
    setup({ selected: { id: 'va123#0', effect: 'mute', in: 5, out: 6 } });
    fireEvent.click(screen.getByRole('button', { name: 'Bleep' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(DaylightAPI).toHaveBeenCalledWith('/api/v1/content-filter/77/cues/va123', { effect: 'bleep' }, 'PUT');
  });

  it('a selected cue offers Off/Mute/Bleep/Blur/Skip and PUTs to the cue route', async () => {
    DaylightAPI.mockResolvedValue({ ruling: {} });
    setup({ selected: { id: 'va1', label: 'A word', effect: 'mute', in: 5, out: 6 } });
    for (const n of ['Off', 'Mute', 'Bleep', 'Blur', 'Skip']) expect(screen.getByRole('button', { name: n })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bleep' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(DaylightAPI).toHaveBeenCalledWith('/api/v1/content-filter/77/cues/va1', { effect: 'bleep' }, 'PUT');
  });

  describe('cue cards (R5)', () => {
    const skipCue = { id: 'va9', label: 'A kiss.', effect: 'skip', in: 5, out: 9 };

    it('a non-skip cue has no card controls', () => {
      setup({ selected: { id: 'va9', effect: 'mute', in: 5, out: 6 } });
      expect(screen.queryByRole('button', { name: 'Draft with AI' })).toBeNull();
    });

    it('drafts via the cue card route, approves with the text, then refreshes', async () => {
      DaylightAPI.mockResolvedValueOnce({ cardDraft: { text: 'They kiss.' } }).mockResolvedValueOnce({ ruling: {} });
      setup({ selected: skipCue });
      fireEvent.click(screen.getByRole('button', { name: 'Draft with AI' }));
      await screen.findByText('They kiss.');
      expect(DaylightAPI).toHaveBeenCalledWith('/api/v1/content-filter/77/cues/va9/card', {}, 'POST');
      refresh.mockClear();
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(DaylightAPI).toHaveBeenLastCalledWith('/api/v1/content-filter/77/cues/va9', { card: { approve: true, text: 'They kiss.' } }, 'PUT');
    });

    it('shows a stored draft and an approved card; Withdraw PUTs card:null', async () => {
      DaylightAPI.mockResolvedValue({ ruling: {} });
      setup({ selected: skipCue, override: { cueOverrides: { va9: { effect: 'skip', card: { text: 'They kiss.' } } } } });
      expect(screen.getByTestId('workshop-card').textContent).toBe('They kiss.');
      fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
      await waitFor(() => expect(refresh).toHaveBeenCalled());
      expect(DaylightAPI).toHaveBeenLastCalledWith('/api/v1/content-filter/77/cues/va9', { card: null }, 'PUT');
    });

    it('a failed cue draft shows the error and does not refresh', async () => {
      DaylightAPI.mockRejectedValue(new Error('500'));
      setup({ selected: skipCue, override: { cueOverrides: { va9: { cardDraft: { text: 'Stored draft.' } } } } });
      expect(screen.getByTestId('workshop-card').textContent).toBe('Stored draft.');
      fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Could not draft a card/));
      expect(refresh).not.toHaveBeenCalled();
    });
  });
});
