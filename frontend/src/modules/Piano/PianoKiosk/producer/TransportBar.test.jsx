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

  it('locked (capture open): tempo steppers, tap, and key steppers disable with the lock tooltip', () => {
    const props = baseProps();
    const { rerender } = render(<TransportBar {...props} />);
    for (const label of ['tempo down', 'tempo up', 'tap tempo', 'key down', 'key up']) {
      expect(screen.getByLabelText(label)).toBeEnabled();
    }
    rerender(<TransportBar {...props} locked />);
    for (const label of ['tempo down', 'tempo up', 'tap tempo', 'key down', 'key up']) {
      const btn = screen.getByLabelText(label);
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute('title', 'Locked while recording');
    }
    // Play, click, and record stay live — only pitch/tempo geometry is frozen.
    expect(screen.getByLabelText('metronome')).toBeEnabled();
    expect(screen.getByLabelText('record')).toBeEnabled();
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

  it('cycles the bar WITHIN the loop and shows the bar count (design §4)', async () => {
    const props = baseProps();
    // Global bar 9 in an 8-bar loop → loop-local bar 1 (9 % 8 = 1 → display 2).
    props.positionRef = { current: { normalized: 0.1, bar: 9, beat: 0, blockIndex: -1 } };
    render(<TransportBar {...props} isPlaying loopBars={8} />);
    await waitFor(() => expect(screen.getByLabelText('position').textContent).toBe('2:1 · 8 bars'));
  });

  it('falls back to the raw climbing bar with no loop length (loopBars 0)', async () => {
    const props = baseProps();
    props.positionRef = { current: { normalized: 0.5, bar: 12, beat: 2, blockIndex: -1 } };
    render(<TransportBar {...props} isPlaying loopBars={0} />);
    await waitFor(() => expect(screen.getByLabelText('position').textContent).toBe('13:3'));
  });
});
