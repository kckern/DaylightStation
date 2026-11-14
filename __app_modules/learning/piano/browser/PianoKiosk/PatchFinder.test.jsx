import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const auditionAddress = vi.fn(() => true);
const resync = vi.fn();
const sendNote = vi.fn();
const reload = vi.fn();
const writePianoConfigValue = vi.fn(async ({ keyPath }) => ({ path: keyPath.join('.') }));
let tap = { state: 'listening', changes: [], clear: () => {} };
let patches = {};

const grand = { no: 1, name: 'Acoustic Grand', pc: 0, bank: 0 };
const bright = { no: 2, name: 'Bright Acoustic', pc: 1, bank: 0 };
const device = { voiceGroups: [{ group: 'Piano', voices: [grand, bright] }] };

vi.mock('./PianoConfig.jsx', () => ({
  usePianoKioskConfig: () => ({ pianoId: 'default' }),
  usePianoRosterOptional: () => ({ reload }),
}));
vi.mock('./PianoMidiContext.jsx', () => ({ usePianoMidi: () => ({ sendNote }) }));
vi.mock('./usePianoSound.js', () => ({
  usePianoSound: () => ({ device, deviceVoice: grand, voicePatches: patches, auditionAddress, resync }),
}));
vi.mock('./useBridgeMidiTap.js', () => ({ useBridgeMidiTap: () => tap }));
vi.mock('./pianoConfigWrite.js', () => ({ writePianoConfigValue: (...a) => writePianoConfigValue(...a) }));

import PatchFinder from './PatchFinder.jsx';

const value = (label) => screen.getByLabelText(`${label} value`);

describe('PatchFinder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    [auditionAddress, resync, sendNote, reload, writePianoConfigValue].forEach((f) => f.mockClear());
    tap = { state: 'listening', changes: [], clear: () => {} };
    patches = {};
  });

  afterEach(() => { vi.useRealTimers(); });

  it('starts on the selected voice at its catalog address', () => {
    render(<PatchFinder onBack={() => {}} />);
    expect(screen.getByText('Acoustic Grand', { selector: '.pf-target__name' })).toBeTruthy();
    expect(value('Program').value).toBe('0');
    expect(value('Bank LSB').value).toBe('0');
    expect(screen.getByRole('button', { name: /Save as/ }).disabled).toBe(true);
  });

  it('steps an address, sends it, and plays the phrase', () => {
    render(<PatchFinder onBack={() => {}} />);
    fireEvent.click(screen.getByLabelText('Bank LSB up'));
    expect(auditionAddress).toHaveBeenLastCalledWith({ msb: 0, lsb: 1, pc: 0 });
    act(() => { vi.advanceTimersByTime(3000); });
    expect(sendNote).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Next ›'));
    expect(auditionAddress).toHaveBeenLastCalledWith({ msb: 0, lsb: 1, pc: 1 });
    fireEvent.click(screen.getByText('‹ Prev'));
    fireEvent.click(screen.getByText('‹ Prev'));
    expect(auditionAddress).toHaveBeenLastCalledWith({ msb: 0, lsb: 1, pc: 127 });
  });

  it('accepts a typed value and ignores an out-of-range one', () => {
    render(<PatchFinder onBack={() => {}} />);
    const input = value('Bank MSB');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '121' } });
    fireEvent.blur(input);
    expect(auditionAddress).toHaveBeenLastCalledWith({ msb: 121, lsb: 0, pc: 0 });
    auditionAddress.mockClear();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '300' } });
    fireEvent.blur(input);
    expect(auditionAddress).not.toHaveBeenCalled();
  });

  it('saves the auditioned address as the voice patch and reloads config', async () => {
    render(<PatchFinder onBack={() => {}} />);
    fireEvent.click(screen.getByLabelText('Bank LSB up'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save as Acoustic Grand' })); });
    expect(writePianoConfigValue).toHaveBeenCalledWith({
      pianoId: 'default', keyPath: ['voicePatches', '0:0'], value: { msb: 0, lsb: 1, pc: 0, name: 'Acoustic Grand' },
    });
    expect(reload).toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toMatch(/Saved: Acoustic Grand = Bank 0\/1 · Prog 0/);
  });

  it('saving the catalog address over a patch removes the patch', async () => {
    patches = { '0:0': { msb: 0, lsb: 3, pc: 0 } };
    render(<PatchFinder onBack={() => {}} />);
    expect(value('Bank LSB').value).toBe('3');
    fireEvent.click(screen.getByText('Back to catalog address'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Use catalog for/ })); });
    expect(writePianoConfigValue).toHaveBeenCalledWith({ pianoId: 'default', keyPath: ['voicePatches', '0:0'], value: undefined });
  });

  it('adopts an address the keyboard sent', () => {
    tap = { state: 'listening', changes: [{ ch: 1, msb: 0, lsb: 5, pc: 0, at: 1 }], clear: () => {} };
    render(<PatchFinder onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try' }));
    expect(auditionAddress).toHaveBeenLastCalledWith({ msb: 0, lsb: 5, pc: 0 });
    expect(value('Bank LSB').value).toBe('5');
  });

  it('picking another voice loads its address; leaving restores the selected voice', () => {
    const { unmount } = render(<PatchFinder onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Bright Acoustic/ }));
    expect(auditionAddress).toHaveBeenLastCalledWith({ msb: 0, lsb: 0, pc: 1 });
    unmount();
    expect(resync).toHaveBeenCalledTimes(1);
  });
});
