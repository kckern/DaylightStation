import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LearnLaunchpad from './LearnLaunchpad.jsx';

const segment = {
  id: 'm0-3', label: 'Segment 1', barLabel: 'Bars 1–4', playableParts: ['rh', 'lh'], complete: false,
  rungs: [
    { id: 'right', label: 'Right hand', effectiveParts: ['rh'], mode: 'free', sets: 2, reps: 3, required: 6, passCount: 6, state: 'complete' },
    { id: 'left', label: 'Left hand', effectiveParts: ['lh'], mode: 'free', sets: 2, reps: 3, required: 6, passCount: 0, state: 'current' },
    { id: 'test-out', label: 'Test out', effectiveParts: ['rh', 'lh'], mode: 'cued', sets: 1, reps: 3, required: 3, passCount: 0, state: 'available', tempoPercent: 100 },
  ],
};

describe('LearnLaunchpad', () => {
  it('presents one dominant next action and explicit review/custom choices', () => {
    render(<LearnLaunchpad segment={segment} preview={<div>engraved excerpt</div>} onLaunch={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText('engraved excerpt')).toBeTruthy();
    expect(screen.getByRole('button', { name: /up next.*left hand/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /practice again/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /make your own/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /test out/i })).toBeTruthy();
  });

  it('keeps completed drills enabled and launches them as review', () => {
    const onLaunch = vi.fn();
    render(<LearnLaunchpad segment={segment} onLaunch={onLaunch} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /practice again/i }));
    const completed = screen.getByRole('button', { name: /right hand.*complete/i });
    expect(completed).not.toBeDisabled();
    fireEvent.click(completed);
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ source: 'review', rungId: 'right' }));
  });

  it('builds custom hands, beat, and tempo with child-facing choices', () => {
    const onLaunch = vi.fn();
    render(<LearnLaunchpad segment={segment} onLaunch={onLaunch} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /make your own/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Together' }));
    fireEvent.click(screen.getByRole('button', { name: /keep a beat/i }));
    fireEvent.click(screen.getByRole('button', { name: /slow.*40%/i }));
    fireEvent.click(screen.getByRole('button', { name: /start practice/i }));
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ source: 'custom', parts: ['rh', 'lh'], mode: 'metronome', tempoPercent: 40 }));
  });

  it('launches right-hand metronome at 15% and reports the retained setup', () => {
    const onLaunch = vi.fn();
    const onChoiceChange = vi.fn();
    render(<LearnLaunchpad segment={segment} initialView="custom" initialChoice={{ parts: ['rh'], mode: 'metronome', tempoStage: 'extra-slow', tempoPercent: 15 }} onChoiceChange={onChoiceChange} onLaunch={onLaunch} />);
    expect(screen.getByRole('button', { name: 'Right hand' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /keep a beat/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /extra slow.*15%/i })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /start practice/i }));
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ parts: ['rh'], mode: 'metronome', tempoPercent: 15 }));
    expect(onChoiceChange).toHaveBeenLastCalledWith({ parts: ['rh'], mode: 'metronome', tempoStage: 'extra-slow', tempoPercent: 15 });
  });

  it('hides tempo for No beat and omits unavailable left-hand choices', () => {
    render(<LearnLaunchpad segment={{ ...segment, playableParts: ['rh'], rungs: [segment.rungs[0]] }} onLaunch={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /make your own/i }));
    expect(screen.queryByRole('button', { name: 'Left hand' })).toBeNull();
    expect(screen.queryByRole('group', { name: /tempo/i })).toBeNull();
  });

  it('renders explicit post-run choices instead of auto-dismissing', () => {
    const onResultAction = vi.fn();
    render(<LearnLaunchpad segment={segment} result={{ source: 'review', passed: true, score: 96 }} onResultAction={onResultAction} onBack={vi.fn()} />);
    const result = screen.getByRole('dialog', { name: /practice result/i });
    for (const name of [/play again/i, /change setup/i, /back to segment/i]) {
      expect(within(result).getByRole('button', { name })).toBeTruthy();
    }
  });

  it('normalizes fractional assessment scores and can reopen the custom builder', () => {
    const { unmount } = render(<LearnLaunchpad segment={segment} result={{ source: 'custom', passed: true, score: 0.96 }} onResultAction={vi.fn()} />);
    expect(screen.getByText('96%')).toBeInTheDocument();
    unmount();
    render(<LearnLaunchpad segment={segment} initialView="custom" onLaunch={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Make your own practice' })).toBeInTheDocument();
  });
});
