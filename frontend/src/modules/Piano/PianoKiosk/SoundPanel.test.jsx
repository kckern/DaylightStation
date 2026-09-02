import { Profiler } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const applyBundle = vi.fn();
let currentBundle = { voice: { pc: 0, bank: 0, name: 'Grand' }, reverb: { type: 4, level: 50, on: true }, chorus: { type: 2, level: 64, on: false } };
vi.mock('./usePianoSoundBundle.js', () => ({ usePianoSoundBundle: () => ({ currentBundle, applyBundle }) }));
const saveFavorite = vi.fn(async () => ({ ok: true }));
const removeFavorite = vi.fn(async () => ({ ok: true }));
let presetState;
vi.mock('./usePianoPreset.js', () => ({
  soundVoiceKey: (value) => value?.voice?.pc == null ? null : `${value.voice.pc}:${value.voice.bank || 0}`,
  sameSoundPreset: (a, b) => JSON.stringify({ voice: a?.voice, reverb: a?.reverb, chorus: a?.chorus }) === JSON.stringify({ voice: b?.voice, reverb: b?.reverb, chorus: b?.chorus }),
  usePianoPreset: () => presetState,
}));
let shortlist;
vi.mock('./PianoConfig.jsx', () => ({ usePianoKioskConfig: () => ({ config: { shortlist: { voices: shortlist } } }) }));
const groups = [
  { group: 'Piano', voices: [{ pc: 0, bank: 0, name: 'Grand' }, { pc: 1, bank: 0, name: 'Bright' }] },
  { group: 'Strings', voices: [{ pc: 40, bank: 0, name: 'Violin' }, { pc: 42, bank: 0, name: 'Cello' }] },
  { group: 'Brass', voices: [{ pc: 56, bank: 0, name: 'Trumpet' }] },
];
vi.mock('./usePianoSound.js', () => ({ usePianoSound: () => ({ device: { voiceGroups: groups, effects: { reverb: { types: [{ value: 4, label: 'Hall' }, { value: 5, label: 'Large Hall' }] }, chorus: { types: [{ value: 2, label: 'Chorus 3' }] } } } }) }));
const setPianoLevel = vi.fn();
vi.mock('./usePianoMix.js', () => ({ usePianoMix: () => ({ pianoLevel: 0.75, setPianoLevel }) }));
const midi = vi.hoisted(() => ({ sendNote: vi.fn(() => true) }));
vi.mock('./PianoMidiContext.jsx', () => ({ usePianoMidi: () => midi }));
const connection = vi.hoisted(() => ({ health: { state: 'ready', output: { state: 'up' } } }));
vi.mock('./usePianoConnection.js', () => ({ usePianoConnection: () => connection }));
vi.mock('../ui/icons/Icon.jsx', () => ({ default: () => <span className="piano-icon" aria-hidden /> }));
vi.mock('../../../lib/api.mjs', () => ({ DaylightMediaPath: (path) => path }));
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }));
vi.mock('../../../lib/logging/Logger.js', () => ({ default: () => ({ child: () => log }), getLogger: () => ({ child: () => log }) }));

import SoundPanel from './SoundPanel.jsx';

const grid = () => screen.getByRole('group', { name: 'Instruments' });
const rail = () => screen.getByRole('group', { name: 'Instrument families' });

beforeEach(() => {
  applyBundle.mockReset(); log.info.mockClear(); saveFavorite.mockClear(); removeFavorite.mockClear(); setPianoLevel.mockClear(); midi.sendNote.mockReset().mockReturnValue(true);
  connection.health = { state: 'ready', output: { state: 'up' } };
  shortlist = [{ pc: 0, name: 'Grand' }, { pc: 40, bank: 0, name: 'Violin' }];
  currentBundle = { voice: { pc: 0, bank: 0, name: 'Grand' }, reverb: { type: 4, level: 50, on: true }, chorus: { type: 2, level: 64, on: false } };
  presetState = { preset: { favorites: [] }, saveFavorite, removeFavorite, canSave: true, persistenceState: 'idle', retryLastSound: vi.fn(), maxFavorites: 8, playerName: 'Alex' };
});

describe('SoundPanel', () => {
  it('renders nothing while closed and no maintenance actions when open', () => {
    const { container, rerender } = render(<SoundPanel open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Sound' })).toBeInTheDocument();
    expect(screen.queryByText(/repair|bluetooth|reboot|stuck notes/i)).toBeNull();
  });

  it('opens on Mine when the current voice is a favourite or shortlisted, and lights it', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(within(rail()).getByRole('button', { name: 'Mine' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(rail()).getByRole('button', { name: 'Pianos' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(grid()).getByRole('button', { name: 'Grand' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(grid()).getByRole('button', { name: 'Violin' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('opens on the current voice family when it is not in Mine', () => {
    currentBundle = { ...currentBundle, voice: { pc: 56, bank: 0, name: 'Trumpet' } };
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(within(rail()).getByRole('button', { name: 'Winds & Brass' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(grid()).getByRole('button', { name: 'Trumpet' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('deduplicates Mine against favourites with a missing bank normalized to zero', () => {
    presetState.preset.favorites = [{ voice: { pc: 0, name: 'Grand' }, reverb: null, chorus: null }];
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(within(grid()).getAllByRole('button', { name: 'Grand' })).toHaveLength(1);
    expect(within(grid()).getByRole('button', { name: 'Violin' })).toBeInTheDocument();
  });

  it('recalls a saved sound whole and applies a catalog voice without touching piano level', () => {
    const saved = { voice: { pc: 42, bank: 0, name: 'Cello' }, reverb: null, chorus: null };
    presetState.preset.favorites = [saved];
    render(<SoundPanel open onClose={vi.fn()} />);
    fireEvent.click(within(grid()).getByRole('button', { name: 'Cello' }));
    expect(applyBundle).toHaveBeenCalledWith(saved);
    fireEvent.click(within(rail()).getByRole('button', { name: 'Strings' }));
    fireEvent.click(within(grid()).getByRole('button', { name: 'Violin' }));
    expect(applyBundle).toHaveBeenLastCalledWith(expect.objectContaining({ voice: expect.objectContaining({ pc: 40, bank: 0 }) }));
    expect(setPianoLevel).not.toHaveBeenCalled();
  });

  it('shows every family in the rail and switches the grid with one tap, never nesting', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(within(rail()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Mine', 'Pianos', 'Keys & Organs', 'Guitars & Bass', 'Strings', 'Voices', 'Winds & Brass', 'Synths', 'World', 'Drums & Fun']);
    fireEvent.click(within(rail()).getByRole('button', { name: 'Pianos' }));
    expect(within(grid()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Grand', 'Bright']);
    expect(screen.queryByText(/browse|done browsing/i)).toBeNull();
    expect(document.querySelector('details')).toBeNull();
  });

  it('does not claim a nearest reverb step for a noncanonical level but shows the value', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    const reverb = screen.getByRole('group', { name: 'Reverb' });
    expect(within(reverb).getAllByRole('button').every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(screen.getByText('now 39%')).toBeInTheDocument();
  });

  it('writes only level/on or type into the bundle — never a label', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    fireEvent.click(within(screen.getByRole('group', { name: 'Reverb' })).getByRole('button', { name: 'Medium' }));
    expect(applyBundle).toHaveBeenLastCalledWith(expect.objectContaining({ reverb: { type: 4, level: 64, on: true } }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Reverb type' })).getByRole('button', { name: 'Big hall' }));
    expect(applyBundle).toHaveBeenLastCalledWith(expect.objectContaining({ reverb: { type: 5, level: 50, on: true } }));
    expect(JSON.stringify(applyBundle.mock.calls)).not.toMatch(/label/);
  });

  it('always shows Chorus with its type row and no More-effects toggle', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Chorus' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Chorus type' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /more effects|less effects/i })).toBeNull();
  });

  it('sets exact device-wide levels and reports named-player persistence', () => {
    presetState.persistenceState = 'remembered';
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.getByText('Remembered for Alex')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('group', { name: 'Piano level' })).getByRole('button', { name: '25%' }));
    expect(setPianoLevel).toHaveBeenCalledWith(0.25);
  });

  it('auditions the current sound with Hear it, and explains when the piano is not connected', () => {
    const { rerender } = render(<SoundPanel open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hear it' }));
    expect(midi.sendNote).toHaveBeenCalledWith(60, 100, 0, 500);
    connection.health = { state: 'offline', output: { state: 'down' } };
    rerender(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Hear it' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Piano not connected.');
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

  it('keeps over-limit favourites visible while blocking only a ninth instrument', () => {
    presetState.preset.favorites = Array.from({ length: 9 }, (_, pc) => ({ voice: { pc, bank: 0, name: `Saved ${pc}` }, reverb: null, chorus: null }));
    currentBundle = { ...currentBundle, voice: { pc: 20, bank: 0, name: 'New' } };
    render(<SoundPanel open onClose={vi.fn()} />);
    fireEvent.click(within(rail()).getByRole('button', { name: 'Mine' }));
    expect(within(grid()).getAllByRole('button', { name: /Saved \d/ })).toHaveLength(9);
    expect(screen.getByRole('button', { name: 'Save sound' })).toBeDisabled();
  });

  it('shows Guest guidance as text instead of save actions', () => {
    presetState.canSave = false;
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.getByText('Pick a player to save sounds.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save sound|pick a player/i })).toBeNull();
  });

  it('shows an empty-state line on Mine when there is nothing saved or shortlisted', () => {
    shortlist = [];
    currentBundle = { ...currentBundle, voice: { pc: 56, bank: 0, name: 'Trumpet' } };
    render(<SoundPanel open onClose={vi.fn()} />);
    fireEvent.click(within(rail()).getByRole('button', { name: 'Mine' }));
    expect(screen.getByText('Save a sound and it will show up here.')).toBeInTheDocument();
  });
  it('shows illustration art on tiles the pack can picture and the icon on the rest', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    fireEvent.click(within(rail()).getByRole('button', { name: 'Voices' }));
    expect(within(rail()).getByRole('button', { name: 'Pianos' }).querySelector('img.piano-tbtn__art')).toHaveAttribute('src', '/static/img/music/instruments/upright-piano.svg');
    expect(within(rail()).getByRole('button', { name: 'Voices' }).querySelector('.piano-tbtn__art')).toBeNull();
    expect(within(rail()).getByRole('button', { name: 'Voices' }).querySelector('.piano-icon')).not.toBeNull();
    fireEvent.click(within(rail()).getByRole('button', { name: 'Mine' }));
    expect(within(grid()).getByRole('button', { name: 'Grand' }).querySelector('img.piano-tbtn__art')).toHaveAttribute('src', '/static/img/music/instruments/upright-piano.svg');
    expect(within(grid()).getByRole('button', { name: 'Grand' }).querySelector('.piano-icon')).toBeNull();
    fireEvent.click(within(rail()).getByRole('button', { name: 'Strings' }));
    expect(within(grid()).getByRole('button', { name: 'Violin' }).querySelector('img.piano-tbtn__art')).toHaveAttribute('src', '/static/img/music/instruments/violin-1.svg');
  });

  it('keeps the icon, not art, on tiles for voices without an illustration', () => {
    currentBundle = { ...currentBundle, voice: { pc: 52, bank: 0, name: 'Choir Aahs' } };
    shortlist = [{ pc: 52, bank: 0, name: 'Choir Aahs' }];
    render(<SoundPanel open onClose={vi.fn()} />);
    const tile = within(grid()).getByRole('button', { name: 'Choir Aahs' });
    expect(tile.querySelector('.piano-tbtn__art')).toBeNull();
    expect(tile.querySelector('.piano-icon')).not.toBeNull();
    expect(screen.getByText('Choir Aahs', { selector: 'strong' }).parentElement.querySelector('.piano-icon')).not.toBeNull();
  });
  it('applies a Mine shortlist voice onto the bundle as it is now, not as it was when the tiles were built', () => {
    const { rerender } = render(<SoundPanel open onClose={vi.fn()} />);
    currentBundle = { ...currentBundle, reverb: { ...currentBundle.reverb, level: 64 } };
    rerender(<SoundPanel open onClose={vi.fn()} />);
    fireEvent.click(within(grid()).getByRole('button', { name: 'Violin' }));
    expect(applyBundle).toHaveBeenCalledWith(expect.objectContaining({ voice: expect.objectContaining({ pc: 40 }), reverb: { type: 4, level: 64, on: true } }));
  });

  it('shows one status line, the newest message winning, with Retry only for failed persistence', async () => {
    presetState.preset.favorites = [{ ...currentBundle, reverb: { ...currentBundle.reverb, level: 64 } }];
    presetState.persistenceState = 'remembered';
    const { rerender } = render(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Remembered for Alex');
    fireEvent.click(screen.getByRole('button', { name: 'Update saved sound' }));
    expect(await screen.findByText('Sound saved.')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.queryByText('Remembered for Alex')).toBeNull();
    presetState = { ...presetState, persistenceState: 'failed' };
    rerender(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Couldn’t save');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(presetState.retryLastSound).toHaveBeenCalled();
  });

  it('latches the family at open, so saving the current voice does not flip the rail to Mine', async () => {
    currentBundle = { ...currentBundle, voice: { pc: 56, bank: 0, name: 'Trumpet' } };
    const { rerender } = render(<SoundPanel open onClose={vi.fn()} />);
    expect(within(rail()).getByRole('button', { name: 'Winds & Brass' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Save sound' }));
    expect(await screen.findByText('Sound saved.')).toBeInTheDocument();
    presetState.preset.favorites = [{ ...currentBundle }];
    rerender(<SoundPanel open onClose={vi.fn()} />);
    expect(within(rail()).getByRole('button', { name: 'Winds & Brass' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(rail()).getByRole('button', { name: 'Mine' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(grid()).getByRole('button', { name: 'Trumpet' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('lights Off whenever the effect is off, whatever level it remembers', () => {
    currentBundle = { ...currentBundle, chorus: { type: 2, level: 64, on: false } };
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(within(screen.getByRole('group', { name: 'Chorus' })).getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('now 0%')).toBeNull();
  });

  it('clears a stale Hear-it failure once the piano output is back', () => {
    midi.sendNote.mockReturnValue(false);
    const { rerender } = render(<SoundPanel open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hear it' }));
    expect(screen.getByRole('status')).toHaveTextContent('Piano not connected.');
    connection.health = { state: 'offline', output: { state: 'down' } };
    rerender(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Piano not connected.');
    connection.health = { state: 'ready', output: { state: 'up' } };
    rerender(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('logs every voice pick with where it came from', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    fireEvent.click(within(grid()).getByRole('button', { name: 'Violin' }));
    expect(log.info).toHaveBeenCalledWith('piano.sound.pick', { pc: 40, bank: 0, name: 'Violin', from: 'mine' });
    fireEvent.click(within(rail()).getByRole('button', { name: 'Strings' }));
    fireEvent.click(within(grid()).getByRole('button', { name: 'Cello' }));
    expect(log.info).toHaveBeenLastCalledWith('piano.sound.pick', { pc: 42, bank: 0, name: 'Cello', from: 'strings' });
  });
  it('keeps the favourite result when the write flips persistence in the same batch, and never offers Retry for a favourite failure', async () => {
    // saveFavorite and the last-sound write share enqueueWrite, so persistence
    // moves saving -> failed inside the same React batch as the result message.
    presetState.persistenceState = 'saving';
    saveFavorite.mockImplementationOnce(async () => { await Promise.resolve(); presetState.persistenceState = 'failed'; return { ok: false, reason: 'io' }; });
    render(<SoundPanel open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save sound' }));
    expect(await screen.findByText('Couldn’t save sound.')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByText(/Couldn’t save$/)).toBeNull();
  });

  it('keeps "Sound saved." over "Remembered for" when the write lands in the same batch', async () => {
    presetState.persistenceState = 'saving';
    saveFavorite.mockImplementationOnce(async () => { await Promise.resolve(); presetState.persistenceState = 'remembered'; return { ok: true }; });
    render(<SoundPanel open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save sound' }));
    expect(await screen.findByText('Sound saved.')).toBeInTheDocument();
    expect(screen.queryByText('Remembered for Alex')).toBeNull();
  });

  it('drops the latched family while closed, so the first frame on reopen already shows the new voice', () => {
    // Profiler onRender fires per commit, so the first snapshot after reopen is
    // the frame painted before the open effect re-latches.
    const frames = [];
    const probe = () => frames.push(screen.queryByRole('button', { name: 'Mine' })?.getAttribute('aria-pressed') ?? 'closed');
    const view = (open) => <Profiler id="sheet" onRender={probe}><SoundPanel open={open} onClose={vi.fn()} /></Profiler>;
    currentBundle = { ...currentBundle, voice: { pc: 56, bank: 0, name: 'Trumpet' } };
    const { rerender } = render(view(true));
    expect(within(rail()).getByRole('button', { name: 'Winds & Brass' })).toHaveAttribute('aria-pressed', 'true');
    rerender(view(false));
    currentBundle = { ...currentBundle, voice: { pc: 0, bank: 0, name: 'Grand' } };
    frames.length = 0;
    rerender(view(true));
    expect(frames[0]).toBe('true');
    expect(within(rail()).getByRole('button', { name: 'Mine' })).toHaveAttribute('aria-pressed', 'true');
  });
});
