import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const applyBundle = vi.fn();
const saveDefault = vi.fn();
const addFavorite = vi.fn();

const currentBundle = {
  voice: { pc: 0, bank: 0, name: 'Acoustic Grand' },
  reverb: { type: 4, level: 64, on: true },
  chorus: { type: 2, level: 32, on: false },
  volume: 0.8,
};

const favoriteBundle = {
  voice: { pc: 0, bank: 0, name: 'Acoustic Grand' },
  reverb: { type: 5, level: 90, on: true },
  chorus: { type: 0, level: 0, on: false },
  volume: 0.9,
};

// House shortlist deliberately includes Acoustic Grand (a dup of the favorite,
// by pc:bank) so the panel's dedup behavior is exercised — buildFunnel is
// expected to filter it back out.
const shortlistVoices = [
  { pc: 0, bank: 0, name: 'Acoustic Grand' },
  { pc: 40, bank: 0, name: 'Violin' },
];

const deviceVoiceGroups = [
  { group: 'Piano', voices: [{ no: 1, name: 'Acoustic Grand', pc: 0, bank: 0 }] },
  { group: 'Strings', voices: [
    { no: 41, name: 'Violin', pc: 40, bank: 0 },
    { no: 43, name: 'Cello', pc: 42, bank: 0 },
  ] },
];

const deviceEffects = {
  reverb: { label: 'Reverb', typeCC: 80, levelCC: 91, defaultType: 4, types: [{ value: 4, label: 'Hall' }, { value: 0, label: 'Room' }] },
  chorus: { label: 'Chorus', typeCC: 81, levelCC: 93, defaultType: 2, types: [{ value: 2, label: 'Chorus 3' }, { value: 0, label: 'Chorus 1' }] },
};

vi.mock('./usePianoSoundBundle.js', () => ({
  usePianoSoundBundle: () => ({ currentBundle, applyBundle }),
}));
vi.mock('./usePianoPreset.js', () => ({
  usePianoPreset: () => ({ preset: { favorites: [favoriteBundle] }, saveDefault, addFavorite }),
}));
vi.mock('./PianoConfig.jsx', () => ({
  usePianoKioskConfig: () => ({ config: { shortlist: { voices: shortlistVoices } }, pianoId: 'default' }),
}));
vi.mock('./PianoSoundContext.jsx', () => ({
  usePianoSound: () => ({ device: { voiceGroups: deviceVoiceGroups, effects: deviceEffects } }),
}));
vi.mock('./icons/Icon.jsx', () => ({ default: () => null }));

import SoundPanel from './SoundPanel.jsx';

beforeEach(() => {
  applyBundle.mockClear();
  saveDefault.mockClear();
  addFavorite.mockClear();
});

describe('SoundPanel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<SoundPanel open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows Your Favorites and applies the full favorite bundle on tap', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Acoustic Grand/ }));
    expect(applyBundle).toHaveBeenCalledWith(favoriteBundle);
  });

  it('shows the house shortlist deduped against favorites (no duplicate tile)', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    // Acoustic Grand appears once only (favorites), not again in the shortlist,
    // and Browse-all is still collapsed so it can't be a second source either.
    expect(screen.getAllByRole('button', { name: /Acoustic Grand/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Violin/ })).toBeTruthy();
  });

  it('applies voice+currentBundle tone on a shortlist tap', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Violin/ }));
    expect(applyBundle).toHaveBeenCalledWith({ ...currentBundle, voice: { pc: 40, bank: 0, name: 'Violin' } });
  });

  it('hides Browse-all behind a toggle', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Cello/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /browse all/i }));
    // Grouped-by-family (per design §4a) — switch to the Strings family to reach Cello.
    fireEvent.change(screen.getByLabelText('Voice family'), { target: { value: 'Strings' } });
    expect(screen.getByRole('button', { name: /Cello/ })).toBeTruthy();
  });

  it('applies a voice picked from Browse-all the same way as the shortlist', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /browse all/i }));
    fireEvent.change(screen.getByLabelText('Voice family'), { target: { value: 'Strings' } });
    fireEvent.click(screen.getByRole('button', { name: /Cello/ }));
    expect(applyBundle).toHaveBeenCalledWith({ ...currentBundle, voice: { pc: 42, bank: 0, name: 'Cello' } });
  });

  it('re-asserts the full bundle when a tone control changes (reverb depth)', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Reverb depth/i), { target: { value: '80' } });
    expect(applyBundle).toHaveBeenCalledWith({ ...currentBundle, reverb: { ...currentBundle.reverb, level: 80 } });
  });

  it('volume control operates on the 0-1 scale, not 0-127', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    const slider = screen.getByLabelText(/Volume/i);
    expect(slider.max).toBe('1');
    fireEvent.change(slider, { target: { value: '0.5' } });
    expect(applyBundle).toHaveBeenCalledWith({ ...currentBundle, volume: 0.5 });
  });

  it('Save as my default calls saveDefault with the current bundle', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Save as my default/i }));
    expect(saveDefault).toHaveBeenCalledWith(currentBundle);
  });

  it('Add to favorites calls addFavorite with the current bundle', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Add to favorites/i }));
    expect(addFavorite).toHaveBeenCalledWith(currentBundle);
  });

  it('has no operator/destructive controls on the player surface', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.queryByText(/Panic/i)).toBeNull();
    expect(screen.queryByText(/Reload app/i)).toBeNull();
    expect(screen.queryByText(/MIDI monitor/i)).toBeNull();
    expect(screen.queryByText(/Bluetooth/i)).toBeNull();
    expect(screen.queryByText(/Local On|Local Off/i)).toBeNull();
    expect(screen.queryByText(/Restart audio/i)).toBeNull();
  });
});
