import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { stepToLevel } from './volumeCurve.js';

const mix = vi.hoisted(() => ({
  pianoLevel: 1, mediaLevel: 1, setPianoLevel: vi.fn(), setMediaLevel: vi.fn(),
}));
vi.mock('./PianoMixContext.jsx', () => ({ usePianoMix: () => mix }));

import VolumeModal from './VolumeModal.jsx';

beforeEach(() => {
  mix.pianoLevel = 1;
  mix.mediaLevel = 1;
  mix.setPianoLevel.mockClear();
  mix.setMediaLevel.mockClear();
});

describe('VolumeModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<VolumeModal open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders both Media and MIDI steppers when open', () => {
    render(<VolumeModal open onClose={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Media Volume' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'MIDI Volume' })).toBeTruthy();
  });

  it('calls onClose when the scrim is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<VolumeModal open onClose={onClose} />);
    fireEvent.click(container.querySelector('.piano-volume-modal__scrim'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose from the close button', () => {
    const onClose = vi.fn();
    render(<VolumeModal open onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close volume'));
    expect(onClose).toHaveBeenCalled();
  });

  it('tapping a Media segment calls setMediaLevel with the curve-mapped level (default log)', () => {
    render(<VolumeModal open onClose={vi.fn()} />);
    const media = within(screen.getByRole('group', { name: 'Media Volume' }));
    fireEvent.click(media.getByRole('button', { name: 'Med' }));
    expect(mix.setMediaLevel).toHaveBeenCalledWith(stepToLevel(2, 'log'));
  });

  it('tapping a MIDI segment calls setPianoLevel with the curve-mapped level (default log)', () => {
    render(<VolumeModal open onClose={vi.fn()} />);
    const midi = within(screen.getByRole('group', { name: 'MIDI Volume' }));
    fireEvent.click(midi.getByRole('button', { name: 'High' }));
    expect(mix.setPianoLevel).toHaveBeenCalledWith(stepToLevel(3, 'log'));
  });

  it('highlights the segment nearest the current level', () => {
    mix.mediaLevel = stepToLevel(3, 'log'); // High
    render(<VolumeModal open onClose={vi.fn()} />);
    const media = within(screen.getByRole('group', { name: 'Media Volume' }));
    expect(media.getByRole('button', { name: 'High' })).toHaveAttribute('aria-pressed', 'true');
    expect(media.getByRole('button', { name: 'Med' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('Off segment is highlighted for a 0 level', () => {
    mix.pianoLevel = 0;
    render(<VolumeModal open onClose={vi.fn()} />);
    const midi = within(screen.getByRole('group', { name: 'MIDI Volume' }));
    expect(midi.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('the Log/Linear toggle re-maps future taps to the linear curve', () => {
    render(<VolumeModal open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Linear' }));
    const media = within(screen.getByRole('group', { name: 'Media Volume' }));
    fireEvent.click(media.getByRole('button', { name: 'Med' }));
    expect(mix.setMediaLevel).toHaveBeenCalledWith(stepToLevel(2, 'linear'));
    expect(mix.setMediaLevel).toHaveBeenCalledWith(0.5);
  });

  it('defaults to the Log curve (Log button pressed, Linear not)', () => {
    render(<VolumeModal open onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Log' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Linear' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('switching the curve changes which segment is highlighted for the same stored level', () => {
    // A level that lands exactly on the log "Med" step (0.5^2.5 ≈ 0.177) is
    // much closer to linear's "Low" (0.25) than linear's "Med" (0.5) — so
    // re-mapping the curve should move the highlight from Med to Low.
    mix.mediaLevel = stepToLevel(2, 'log');
    render(<VolumeModal open onClose={vi.fn()} />);
    const media = within(screen.getByRole('group', { name: 'Media Volume' }));
    expect(media.getByRole('button', { name: 'Med' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Linear' }));

    const mediaAfter = within(screen.getByRole('group', { name: 'Media Volume' }));
    expect(mediaAfter.getByRole('button', { name: 'Low' })).toHaveAttribute('aria-pressed', 'true');
    expect(mediaAfter.getByRole('button', { name: 'Med' })).toHaveAttribute('aria-pressed', 'false');
  });
});
