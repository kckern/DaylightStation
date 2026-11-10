import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';

vi.mock('../../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
import { DaylightAPI } from '../../../../../../frontend/src/lib/api.mjs';
import SettingsPanel from './SettingsPanel.jsx';
import { previewStore } from './previewStore.js';

const PROFILE = {
  categories: {
    language: { effect: 'mute' },
    'language/childish': { effect: 'off' },
    'language/slurs': { effect: 'bleep' },
    'violence_blood_gore/graphic': { effect: 'full-blur' },
    sex_nudity_immodesty: { effect: 'full-blur' },
    sex_any: { effect: 'full-blur' },
  },
  scenes: { violence_blood_gore: { blackout: { picture: 2 } }, sex_nudity_immodesty: { blackout: { picture: 2 } }, sex_any: { skip: { situation: 3 } } },
};

describe('SettingsPanel', () => {
  let refresh;
  beforeEach(() => {
    act(() => previewStore.reset());
    vi.restoreAllMocks();
    DaylightAPI.mockReset();
    refresh = vi.spyOn(previewStore, 'refresh').mockResolvedValue(undefined);
    act(() => previewStore.publish({ ratingKey: '77', profile: PROFILE, override: {} }));
  });

  it('shows the current settings and defaults to This film', () => {
    render(<SettingsPanel />);
    const on = (group, button) => within(screen.getByRole('group', { name: group })).getByRole('button', { name: button }).getAttribute('aria-pressed');
    for (const g of ['Profanity', 'Blasphemy', 'Sexual language']) expect(on(g, 'Mute')).toBe('true');
    expect(on('Slurs', 'Bleep')).toBe('true');
    expect(on('Childish words', 'Off')).toBe('true');
    expect(within(screen.getByRole('group', { name: 'Sexual content' })).getByRole('button', { name: 'Skip' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'This film' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('a choice PUTs the film route with only the change, then refreshes', async () => {
    DaylightAPI.mockResolvedValue({});
    render(<SettingsPanel />);
    fireEvent.click(within(screen.getByRole('group', { name: 'Violence' })).getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(DaylightAPI).toHaveBeenCalledWith('/api/v1/content-filter/77/settings', { settings: { violence: 'skip' } }, 'PUT');
  });

  it('Everywhere PUTs the profile route', async () => {
    DaylightAPI.mockResolvedValue({});
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Everywhere' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Profanity' })).getByRole('button', { name: 'Bleep' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(DaylightAPI).toHaveBeenCalledWith('/api/v1/content-filter/profiles/family/settings', { settings: { language: { profanity: 'bleep' } } }, 'PUT');
  });

  it('Reset this film DELETEs and refreshes; disabled with no film settings', async () => {
    DaylightAPI.mockResolvedValue({});
    const { rerender } = render(<SettingsPanel />);
    expect(screen.getByRole('button', { name: 'Reset this film' }).disabled).toBe(true);
    act(() => previewStore.publish({ override: { profilePatch: { categories: {} } } }));
    rerender(<SettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset this film' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(DaylightAPI).toHaveBeenCalledWith('/api/v1/content-filter/77/settings', {}, 'DELETE');
  });

  it('a failed write shows the error and does not refresh', async () => {
    DaylightAPI.mockRejectedValue(new Error('boom'));
    render(<SettingsPanel />);
    fireEvent.click(within(screen.getByRole('group', { name: 'Nudity' })).getByRole('button', { name: 'Off' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('boom'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('after a save the refetched profile and override drive the checked and Reset states', async () => {
    DaylightAPI.mockResolvedValue({});
    refresh.mockImplementation(async () => previewStore.publish({
      profile: { ...PROFILE, scenes: { ...PROFILE.scenes, violence_blood_gore: { skip: { picture: 2 } } } },
      override: { profilePatch: { categories: {} } },
    }));
    render(<SettingsPanel />);
    const violence = screen.getByRole('group', { name: 'Violence' });
    expect(within(violence).getByRole('button', { name: 'Blackout' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Reset this film' }).disabled).toBe(true);
    fireEvent.click(within(violence).getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(within(violence).getByRole('button', { name: 'Skip' }).getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByRole('button', { name: 'Reset this film' }).disabled).toBe(false);
  });
});

describe('SettingsPanel bleep volume', () => {
  beforeEach(() => {
    act(() => previewStore.reset());
    DaylightAPI.mockReset();
    vi.spyOn(previewStore, 'refresh').mockResolvedValue(undefined);
    act(() => previewStore.publish({ ratingKey: '77', profile: { ...PROFILE, bleepLevel: 0.3 }, override: {} }));
  });
  it('shows the effective level and steps it for this film or everywhere', async () => {
    DaylightAPI.mockResolvedValue({});
    render(<SettingsPanel />);
    expect(screen.getByTestId('bleep-level').textContent).toBe('30%');
    fireEvent.click(screen.getByRole('button', { name: 'Louder bleep' }));
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledWith('/api/v1/content-filter/77/settings', { settings: { bleepLevel: 0.35 } }, 'PUT'));
    fireEvent.click(screen.getByRole('button', { name: 'Everywhere' }));
    fireEvent.click(screen.getByRole('button', { name: 'Quieter bleep' }));
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledWith('/api/v1/content-filter/profiles/family/settings', { settings: { bleepLevel: 0.25 } }, 'PUT'));
  });
});
