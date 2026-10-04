import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import LearnProgressStrip, { learnSegmentProgressState } from './LearnProgressStrip.jsx';

const segments = [
  { id: 'empty', number: 1, label: 'Segment 1', barLabel: 'Bars 1–4', rungs: [] },
  { id: 'learning', number: 2, label: 'Segment 2', name: 'Theme', barLabel: 'Bars 5–8', inProgress: true, rungs: [{ passCount: 1 }] },
  { id: 'learned', number: 3, label: 'Segment 3', barLabel: 'Bars 9–12', complete: true, rungs: [] },
  { id: 'mastered', number: 4, label: 'Segment 4', barLabel: 'Bars 13–16', complete: true, testedOut: true, rungs: [] },
  { id: 'locked', number: 5, label: 'Segment 5', barLabel: 'Bars 17–20', locked: true, rungs: [] },
];

describe('LearnProgressStrip', () => {
  it('projects the five piece-level learning states from existing segment progress', () => {
    expect(segments.map(learnSegmentProgressState)).toEqual(['empty', 'learning', 'learned', 'mastered', 'locked']);
  });

  it('renders one numbered pill per segment with accessible state and score metadata', () => {
    render(<LearnProgressStrip segments={segments} selectedId="learning" onOpenSegment={vi.fn()} />);
    expect(screen.getByRole('navigation', { name: 'Piece learning progress' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Segment 1, Bars 1–4, Not started' })).toHaveAttribute('data-state', 'empty');
    expect(screen.getByRole('button', { name: 'Segment 2, Theme, Bars 5–8, Learning' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: 'Segment 3, Bars 9–12, Learned' })).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: 'Segment 4, Bars 13–16, Mastered' })).toHaveAttribute('data-state', 'mastered');
    expect(screen.getByRole('button', { name: 'Segment 5, Bars 17–20, Locked' })).toBeDisabled();
  });

  it('opens unlocked segments directly and ignores locked segments', () => {
    const onOpenSegment = vi.fn();
    render(<LearnProgressStrip segments={segments} onOpenSegment={onOpenSegment} />);
    fireEvent.click(screen.getByRole('button', { name: /Segment 3/ }));
    fireEvent.click(screen.getByRole('button', { name: /Segment 5/ }));
    expect(onOpenSegment).toHaveBeenCalledTimes(1);
    expect(onOpenSegment).toHaveBeenCalledWith('learned');
  });

  it('start-aligns overflowing pills so the earliest segment remains scrollable', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/Apps/PianoApp.scss'), 'utf8');
    const progressStyles = styles.slice(styles.indexOf('.piano-learn-progress'), styles.indexOf('.piano-learn-segment-rail'));
    const track = progressStyles.match(/&__track\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? '';
    expect(track).toContain('justify-content: flex-start');
    expect(track).not.toContain('justify-content: center');
  });
});
