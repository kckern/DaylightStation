import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const midi = vi.hoisted(() => ({
  sendVoice: vi.fn(),
  sendControlChange: vi.fn(),
  sendLocalControl: vi.fn(),
}));

vi.mock('./PianoMidiContext.jsx', () => ({ usePianoMidi: () => midi }));

const DEVICE_ID = 'suzuki-mdg-400';
vi.mock('./PianoConfig.jsx', () => ({
  usePianoKioskConfig: () => ({
    pianoId: 'default',
    config: { device: DEVICE_ID },
  }),
}));

import { PianoSoundProvider, usePianoSound } from './PianoSoundContext.jsx';
import { getDeviceProfile } from './devices/suzukiMdg400.js';

const device = getDeviceProfile(DEVICE_ID);
const secondVoice = device.voiceGroups[0].voices[1];

function Harness() {
  const { device: dev, deviceVoice, selectVoice, effects, setEffect, resync, activeName } = usePianoSound();
  return (
    <div>
      <span data-testid="active">{activeName}</span>
      <span data-testid="voice">{deviceVoice?.name}</span>
      <button onClick={() => selectVoice(secondVoice)}>select-second</button>
      <button onClick={() => setEffect('reverb', { level: 100 })}>bump-reverb</button>
      <button onClick={resync}>resync</button>
      {dev && <span data-testid="has-device">yes</span>}
      {effects && <span data-testid="reverb-level">{effects.reverb.level}</span>}
    </div>
  );
}

const renderSound = () => render(<PianoSoundProvider><Harness /></PianoSoundProvider>);

describe('PianoSoundContext', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defaults to the device profile and its first voice', () => {
    renderSound();
    expect(screen.getByTestId('has-device').textContent).toBe('yes');
    expect(screen.getByTestId('voice').textContent).toBe(device.voiceGroups[0].voices[0].name);
    expect(screen.getByTestId('active').textContent).toBe(device.voiceGroups[0].voices[0].name);
  });

  it('selectVoice sends the program/bank over MIDI and restores local control', () => {
    renderSound();
    fireEvent.click(screen.getByText('select-second'));
    expect(midi.sendLocalControl).toHaveBeenCalledWith(true);
    expect(midi.sendVoice).toHaveBeenCalledWith(secondVoice.pc, secondVoice.bank || 0);
    expect(screen.getByTestId('voice').textContent).toBe(secondVoice.name);
    expect(screen.getByTestId('active').textContent).toBe(secondVoice.name);
  });

  it('setEffect patches state and sends the CC', () => {
    renderSound();
    fireEvent.click(screen.getByText('bump-reverb'));
    expect(midi.sendControlChange).toHaveBeenCalledWith(device.effects.reverb.levelCC, 100);
    expect(screen.getByTestId('reverb-level').textContent).toBe('100');
  });

  it('resync re-sends the current voice and reverb/chorus effects', () => {
    renderSound();
    fireEvent.click(screen.getByText('select-second'));
    vi.clearAllMocks();
    fireEvent.click(screen.getByText('resync'));
    expect(midi.sendLocalControl).toHaveBeenCalledWith(true);
    expect(midi.sendVoice).toHaveBeenCalledWith(secondVoice.pc, secondVoice.bank || 0);
    expect(midi.sendControlChange).toHaveBeenCalledWith(device.effects.reverb.typeCC, device.effects.reverb.defaultType);
    expect(midi.sendControlChange).toHaveBeenCalledWith(device.effects.reverb.levelCC, 64);
  });

  it('the fallback outside a provider stubs the retired rendered-voice members inertly', () => {
    // usePianoSound() falls back to FALLBACK when there's no provider — assert
    // the retired rendered-voice bridge surface is inert, not wired to anything.
    let value;
    function Probe() { value = usePianoSound(); return null; }
    render(<Probe />);
    expect(value.sources).toEqual([]);
    expect(value.active).toBeNull();
    expect(value.hasInstruments).toBe(false);
    expect(value.bridgeLink).toBeNull();
    expect(typeof value.select).toBe('function');
    expect(typeof value.setGain).toBe('function');
    expect(typeof value.setReverb).toBe('function');
  });
});
