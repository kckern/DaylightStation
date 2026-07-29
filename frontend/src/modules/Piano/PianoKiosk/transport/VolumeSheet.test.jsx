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
import VolumeSheet from './VolumeSheet.jsx';

const ui = (props) => render(
  <PianoMixProvider><VolumeSheet open onClose={() => {}} {...props} /></PianoMixProvider>
);

describe('VolumeSheet', () => {
  it('renders Media and MIDI stepper cards with the five canonical steps', () => {
    ui();
    expect(screen.getByRole('group', { name: 'Media Volume' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'MIDI Volume' })).toBeInTheDocument();
    // 5 steps × 2 channels
    expect(screen.getAllByRole('button', { name: /^(Off|Low|Med|High|Max)$/ })).toHaveLength(10);
  });

  it('offers the Log/Linear curve toggle with Log default', () => {
    ui();
    expect(screen.getByRole('button', { name: 'Log' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Linear' }));
    expect(screen.getByRole('button', { name: 'Linear' })).toHaveAttribute('aria-pressed', 'true');
  });
});
