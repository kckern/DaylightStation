import { render, fireEvent, screen } from '@testing-library/react';

// PianoMixProvider itself needs a PianoMidiProvider ancestor (usePianoMidi
// throws without one) — mock the MIDI link so these tests exercise the real
// PianoMixProvider (real state, real curve math) without wiring Web MIDI.
// Mirrors the pattern in ../PianoMixContext.test.jsx.
const midi = vi.hoisted(() => ({ outputConnected: false, sendControlChange: vi.fn() }));
vi.mock('../PianoMidiContext.jsx', () => ({ usePianoMidi: () => midi }));
vi.mock('../../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }),
}));

import { PianoMixProvider } from '../PianoMixContext.jsx';
import VolumeControl from './VolumeControl.jsx';

describe('VolumeControl', () => {
  it('opens the volume sheet on tap and reports onOpenChange', () => {
    const onOpenChange = vi.fn();
    render(<PianoMixProvider><VolumeControl onOpenChange={onOpenChange} /></PianoMixProvider>);
    expect(screen.queryByRole('dialog', { name: 'Volume' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Volume' }));
    expect(screen.getByRole('dialog', { name: 'Volume' })).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close Volume' }));
    expect(screen.queryByRole('dialog', { name: 'Volume' })).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('disabled blocks opening', () => {
    render(<PianoMixProvider><VolumeControl disabled /></PianoMixProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Volume' }));
    expect(screen.queryByRole('dialog', { name: 'Volume' })).toBeNull();
  });
});
