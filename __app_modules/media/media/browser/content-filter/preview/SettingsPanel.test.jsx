import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';

vi.mock('../../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
import { DaylightAPI } from '../../../../../../frontend/src/lib/api.mjs';
import SettingsPanel from './SettingsPanel.jsx';
import { previewStore } from './previewStore.js';

const PROFILE = {
  categories: {
    language: { effect: 'mute' },
    'violence_blood_gore/graphic': { effect: 'full-blur' },
    sex_nudity_immodesty: { effect: 'full-blur' },
    sex_any: { effect: 'full-blur' },
  },
  scenes: { violence_blood_gore: { blackout: { picture: 2 } }, sex_nudity_immodesty: { blackout: { picture: 2 } }, sex_any: { skip: { situation: 3 } } },
};
const NOW = { language: 'mute', violence: 'blackout', nudity: 'blackout', sexual: 'skip' };

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
    const lang = screen.getByRole('group', { name: 'Language' });
    expect(within(lang).getByRole('button', { name: 'Mute' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(screen.getByRole('group', { name: 'Sexual content' })).getByRole('button', { name: 'Skip' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'This film' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('a choice PUTs the film route with all four settings, then refreshes', async () => {
    DaylightAPI.mockResolvedValue({});
    render(<SettingsPanel />);
    fireEvent.click(within(screen.getByRole('group', { name: 'Violence' })).getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(DaylightAPI).toHaveBeenCalledWith('/api/v1/content-filter/77/settings', { settings: { ...NOW, violence: 'skip' } }, 'PUT');
  });

  it('Everywhere PUTs the profile route', async () => {
    DaylightAPI.mockResolvedValue({});
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Everywhere' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Language' })).getByRole('button', { name: 'Bleep' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(DaylightAPI).toHaveBeenCalledWith('/api/v1/content-filter/profiles/family/settings', { settings: { ...NOW, language: 'bleep' } }, 'PUT');
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
});
