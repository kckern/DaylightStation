import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const applyBundle = vi.fn();
let currentBundle = { voice: { pc: 0, bank: 0, name: 'Grand' }, reverb: { type: 1, level: 50, on: true }, chorus: { type: 2, level: 64, on: false } };
vi.mock('./usePianoSoundBundle.js', () => ({ usePianoSoundBundle: () => ({ currentBundle, applyBundle }) }));
const saveFavorite = vi.fn(async () => ({ ok: true }));
const removeFavorite = vi.fn(async () => ({ ok: true }));
let presetState;
vi.mock('./usePianoPreset.js', () => ({
  soundVoiceKey: (value) => `${value?.voice?.pc}:${value?.voice?.bank || 0}`,
  sameSoundPreset: (a, b) => JSON.stringify({ voice: a?.voice, reverb: a?.reverb, chorus: a?.chorus }) === JSON.stringify({ voice: b?.voice, reverb: b?.reverb, chorus: b?.chorus }),
  usePianoPreset: () => presetState,
}));
vi.mock('./PianoConfig.jsx', () => ({ usePianoKioskConfig: () => ({ config: { shortlist: { voices: [{ pc: 0, name: 'Grand' }, { pc: 40, bank: 0, name: 'Violin' }] } } }) }));
const groups = [{ group: 'Piano', voices: [{ pc: 0, bank: 0, name: 'Grand' }] }, { group: 'Strings', voices: [{ pc: 40, bank: 0, name: 'Violin' }, { pc: 42, bank: 0, name: 'Cello' }] }];
vi.mock('./usePianoSound.js', () => ({ usePianoSound: () => ({ device: { voiceGroups: groups, effects: { reverb: { types: [{ value: 1, label: 'Hall' }] }, chorus: { types: [{ value: 2, label: 'Wide' }] } } } }) }));
const setPianoLevel = vi.fn();
vi.mock('./usePianoMix.js', () => ({ usePianoMix: () => ({ pianoLevel: 0.75, setPianoLevel }) }));
vi.mock('../ui/icons/Icon.jsx', () => ({ default: () => <span /> }));

import SoundPanel from './SoundPanel.jsx';

beforeEach(() => {
  applyBundle.mockReset(); saveFavorite.mockClear(); removeFavorite.mockClear(); setPianoLevel.mockClear();
  currentBundle = { voice: { pc: 0, bank: 0, name: 'Grand' }, reverb: { type: 1, level: 50, on: true }, chorus: { type: 2, level: 64, on: false } };
  presetState = { preset: { favorites: [] }, saveFavorite, removeFavorite, canSave: true, persistenceState: 'idle', retryLastSound: vi.fn(), maxFavorites: 8, playerName: 'Alex' };
});

describe('SoundPanel', () => {
  it('renders nothing while closed and exposes no maintenance actions when open', () => {
    const { container, rerender } = render(<SoundPanel open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.queryByText(/repair|bluetooth|reboot|stuck notes|program change|local on/i)).toBeNull();
  });

  it('orders Current, Saved, Recommended, Browse, Effects, then Piano level', () => {
    presetState.preset.favorites = [{ ...currentBundle }];
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Current sound', 'Saved sounds', 'Recommended', 'Effects', 'Piano level']);
    expect(screen.getByRole('button', { name: 'Browse instruments' })).toBeInTheDocument();
  });

  it('uses Saved/Update/Save labels from full sound equality and keeps Remove separate', () => {
    presetState.preset.favorites = [{ ...currentBundle }];
    const { rerender } = render(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled();
    currentBundle = { ...currentBundle, reverb: { ...currentBundle.reverb, level: 64 } };
    rerender(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Update saved sound' })).toBeEnabled();
  });

  it('deduplicates Recommended with missing bank normalized to zero', () => {
    presetState.preset.favorites = [{ voice: { pc: 0, name: 'Grand' }, reverb: null, chorus: null }];
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /Grand/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Violin/ })).toBeInTheDocument();
  });

  it('recalls saved sounds and changes instruments without touching piano level', () => {
    const saved = { voice: { pc: 42, bank: 0, name: 'Cello' }, reverb: null, chorus: null };
    presetState.preset.favorites = [saved];
    render(<SoundPanel open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Cello/ }));
    expect(applyBundle).toHaveBeenCalledWith(saved);
    expect(setPianoLevel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Violin/ }));
    expect(applyBundle).toHaveBeenLastCalledWith(expect.objectContaining({ voice: expect.objectContaining({ pc: 40 }) }));
    expect(setPianoLevel).not.toHaveBeenCalled();
  });

  it('keeps Browse instruments collapsed and groups the catalog when expanded', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.queryByText('Cello')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Browse instruments' }));
    expect(screen.getByRole('button', { name: 'Done browsing' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Strings'));
    expect(screen.getByRole('button', { name: 'Cello' })).toBeInTheDocument();
  });

  it('does not claim a nearest effect step for a legacy noncanonical value', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    const room = screen.getByRole('group', { name: 'Room sound' });
    expect(within(room).getAllByRole('button').every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(screen.getByText('Current: 39%')).toBeInTheDocument();
  });

  it('opens More effects automatically when chorus is active', () => {
    currentBundle = { ...currentBundle, chorus: { ...currentBundle.chorus, on: true } };
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Chorus' })).toBeInTheDocument();
  });

  it('sets exact device-wide levels and reports named-player persistence', () => {
    presetState.persistenceState = 'remembered';
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.getByText('Remembered for Alex')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('group', { name: 'Piano level' })).getByRole('button', { name: '25%' }));
    expect(setPianoLevel).toHaveBeenCalledWith(0.25);
  });

  it('keeps over-limit data visible while blocking only a ninth instrument', () => {
    presetState.preset.favorites = Array.from({ length: 9 }, (_, pc) => ({ voice: { pc, bank: 0, name: `Saved ${pc}` }, reverb: null, chorus: null }));
    currentBundle = { ...currentBundle, voice: { pc: 20, bank: 0, name: 'New' } };
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.getAllByText(/Saved \d/)).toHaveLength(9);
    expect(screen.getByRole('button', { name: 'Save sound' })).toBeDisabled();
  });

  it('shows Guest guidance instead of save actions', () => {
    presetState.canSave = false;
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.getByText('Pick a player to save sounds.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save sound' })).toBeNull();
  });
});
