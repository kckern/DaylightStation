import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TransportBar } from './TransportBar.jsx';

const baseProps = () => ({
  isPlaying: false,
  canPlay: true,
  onTogglePlay: vi.fn(),
  positionRef: { current: { normalized: 0, bar: 0, beat: 0, blockIndex: -1 } },
  bpm: 100,
  onBpm: vi.fn(),
  keyLabel: 'C',
  onKeyNudge: vi.fn(),
  metronome: false,
  onToggleMetronome: vi.fn(),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TransportBar', () => {
  it('disables play when canPlay is false, enables it when true', () => {
    const props = baseProps();
    const { rerender } = render(<TransportBar {...props} canPlay={false} />);
    const play = screen.getByRole('button', { name: /play/i });
    expect(play).toBeDisabled();
    rerender(<TransportBar {...props} canPlay />);
    expect(screen.getByRole('button', { name: /play/i })).not.toBeDisabled();
  });

  it('shows Stop while playing and fires onTogglePlay on tap', () => {
    const props = baseProps();
    render(<TransportBar {...props} isPlaying />);
    const stop = screen.getByRole('button', { name: /stop/i });
    fireEvent.click(stop);
    expect(props.onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it('BPM steppers emit bpm ±4 (clamping is the reducer’s job)', () => {
    const props = baseProps();
    render(<TransportBar {...props} bpm={100} />);
    fireEvent.click(screen.getByLabelText('tempo down'));
    expect(props.onBpm).toHaveBeenLastCalledWith(96);
    fireEvent.click(screen.getByLabelText('tempo up'));
    expect(props.onBpm).toHaveBeenLastCalledWith(104);
  });

  it('tap tempo averages the last intervals into a SET_BPM emit', () => {
    const props = baseProps();
    const times = [0, 500, 1000, 1500];
    let i = 0;
    render(<TransportBar {...props} now={() => times[Math.min(i++, times.length - 1)]} />);
    const tap = screen.getByLabelText('tap tempo');
    fireEvent.click(tap); // t=0 — first tap, no emit yet
    expect(props.onBpm).not.toHaveBeenCalled();
    fireEvent.click(tap); // 500ms interval → 120bpm
    fireEvent.click(tap);
    fireEvent.click(tap);
    expect(props.onBpm).toHaveBeenLastCalledWith(120);
  });

  it('a ≥2s gap between taps resets the measurement (no emit on the fresh tap)', () => {
    const props = baseProps();
    const times = [0, 5000];
    let i = 0;
    render(<TransportBar {...props} now={() => times[Math.min(i++, times.length - 1)]} />);
    const tap = screen.getByLabelText('tap tempo');
    fireEvent.click(tap);
    fireEvent.click(tap); // 5s later — window resets, this is tap #1 again
    expect(props.onBpm).not.toHaveBeenCalled();
  });

  it('key steppers nudge ±1 and show the current key label', () => {
    const props = baseProps();
    render(<TransportBar {...props} keyLabel="E♭" />);
    expect(screen.getByLabelText('key').textContent).toContain('E♭');
    fireEvent.click(screen.getByLabelText('key down'));
    expect(props.onKeyNudge).toHaveBeenLastCalledWith(-1);
    fireEvent.click(screen.getByLabelText('key up'));
    expect(props.onKeyNudge).toHaveBeenLastCalledWith(1);
  });

  it('metronome toggle latches (aria-pressed) and fires its callback', () => {
    const props = baseProps();
    const { rerender } = render(<TransportBar {...props} />);
    const metro = screen.getByLabelText('metronome');
    expect(metro).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(metro);
    expect(props.onToggleMetronome).toHaveBeenCalledTimes(1);
    rerender(<TransportBar {...props} metronome />);
    expect(screen.getByLabelText('metronome')).toHaveAttribute('aria-pressed', 'true');
  });

  it('record button fires onRecord and pulses (is-armed) while a capture session is open', () => {
    const props = { ...baseProps(), onRecord: vi.fn() };
    const { rerender } = render(<TransportBar {...props} />);
    const rec = screen.getByLabelText('record');
    expect(rec).toBeEnabled();
    expect(rec).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(rec);
    expect(props.onRecord).toHaveBeenCalledTimes(1);
    rerender(<TransportBar {...props} recActive />);
    expect(screen.getByLabelText('record')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('record')).toHaveClass('is-armed');
  });

  it('reads bar:beat from positionRef while playing (1-based display)', async () => {
    const props = baseProps();
    props.positionRef = { current: { normalized: 0.5, bar: 2, beat: 1, blockIndex: -1 } };
    render(<TransportBar {...props} isPlaying />);
    await waitFor(() => expect(screen.getByLabelText('position').textContent).toBe('3:2'));
  });

  it('rests the readout at 1:1 when stopped', () => {
    const props = baseProps();
    props.positionRef = { current: { normalized: 0.5, bar: 7, beat: 3, blockIndex: -1 } };
    render(<TransportBar {...props} isPlaying={false} />);
    expect(screen.getByLabelText('position').textContent).toBe('1:1');
  });
});
