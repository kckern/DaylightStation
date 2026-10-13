import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DrumSequencer } from './DrumSequencer.jsx';
import { drumPatternToTake, drumPreset } from './drumSequencerModel.js';

describe('drumPatternToTake', () => {
  it('emits GM-grid notes with musical accents and provenance', () => {
    const take = drumPatternToTake(new Set(['36:0', '38:4', '42:6']), 1, { preset: 'rock' });
    expect(take).toMatchObject({
      kind: 'groove', drumMode: true, lengthBars: 1, ppq: 480,
      builder: { kind: 'drums', version: 1, preset: 'rock', stepsPerBar: 16 },
    });
    expect(take.notes).toEqual([
      { ticks: 0, durationTicks: 120, midi: 36, velocity: 116 },
      { ticks: 480, durationTicks: 120, midi: 38, velocity: 112 },
      { ticks: 720, durationTicks: 120, midi: 42, velocity: 74 },
    ]);
  });

  it('repeats presets through every bar and gives multi-bar rock a pickup fill', () => {
    const active = drumPreset('rock', 2);
    expect(active.has('36:0')).toBe(true);
    expect(active.has('36:16')).toBe(true);
    expect(active.has('38:30')).toBe(true);
    expect(active.has('38:31')).toBe(true);
  });
});

describe('DrumSequencer', () => {
  it('edits one touch-friendly bar at a time and preserves hits across bar navigation', () => {
    const onCommit = vi.fn();
    render(<DrumSequencer lengthBars={2} onCommit={onCommit} onPreview={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Kick bar 1 step 1'));
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    fireEvent.click(screen.getByLabelText('Snare bar 2 step 5'));
    fireEvent.click(screen.getByRole('button', { name: 'Add drum loop' }));
    const take = onCommit.mock.calls[0][0];
    expect(take.lengthBars).toBe(2);
    expect(take.notes.map((n) => [n.midi, n.ticks])).toEqual([[36, 0], [38, 2400]]);
  });

  it('applies and previews a useful preset before commit', () => {
    const onPreview = vi.fn();
    render(<DrumSequencer lengthBars={4} onCommit={vi.fn()} onPreview={onPreview} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rock' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({
      lengthBars: 4,
      builder: expect.objectContaining({ preset: 'rock' }),
    }));
    expect(onPreview.mock.calls[0][0].notes.length).toBeGreaterThan(40);
  });

  it('supports 16 bars without rendering a 256-column unusable grid', () => {
    const { container } = render(<DrumSequencer lengthBars={16} onCommit={vi.fn()} onPreview={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: '16' })).toBeInTheDocument();
    expect(container.querySelectorAll('.piano-drumseq__cell')).toHaveLength(6 * 16);
    fireEvent.click(screen.getByRole('button', { name: '16' }));
    expect(screen.getByLabelText('Kick bar 16 step 16')).toBeInTheDocument();
    expect(screen.queryByLabelText('Kick bar 16 step 17')).toBeNull();
  });
});
