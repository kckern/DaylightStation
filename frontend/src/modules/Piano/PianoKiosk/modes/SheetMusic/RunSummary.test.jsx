import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RunSummary from './RunSummary.jsx';

const measures = [{ index: 0 }, { index: 1 }, { index: 2 }];
const grades = { 0: { grade: 'green' }, 1: { grade: 'green' }, 2: { grade: 'red' } };

describe('RunSummary', () => {
  it('does not render when closed', () => {
    const { container } = render(
      <RunSummary open={false} grades={grades} measures={measures} onClose={() => {}} onReplay={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows R/Y/G counts and fires onReplay / onClose', () => {
    const onClose = vi.fn();
    const onReplay = vi.fn();
    render(<RunSummary open grades={grades} measures={measures} onClose={onClose} onReplay={onReplay} />);

    expect(screen.getByLabelText(/green measures/i)).toHaveTextContent('2');
    expect(screen.getByLabelText(/yellow measures/i)).toHaveTextContent('0');
    expect(screen.getByLabelText(/red measures/i)).toHaveTextContent('1');
    // per-measure strip: one chip per measure
    expect(document.querySelectorAll('.piano-score-run-chip').length).toBe(3);

    fireEvent.click(screen.getByRole('button', { name: /replay/i }));
    expect(onReplay).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('an empty run says there is nothing to grade, never a congratulation', () => {
    render(<RunSummary open grades={{}} measures={measures} onClose={() => {}} onReplay={() => {}} />);
    expect(screen.queryByText(/nicely done/i)).toBeNull();
    expect(screen.getByText(/nothing to grade/i)).toBeTruthy();
    // The strip still shows every measure, all ungraded.
    expect(document.querySelectorAll('.piano-score-run-chip--none').length).toBe(3);
  });

  // ── Polish tempo tiers (wave-3 H) ──────────────────────────────────────────
  it('shows the run score with tier and the four tier bests', () => {
    render(<RunSummary open grades={grades} measures={measures} onClose={vi.fn()} onReplay={vi.fn()}
      runScore={87} tier="medium" bucket="rh" mixedTempo={false} completed
      tierBests={{ slow: 78, medium: 84, full: null, overclocked: null }} />);
    expect(screen.getByText(/87/)).toBeInTheDocument();
    expect(screen.getByText(/medium/i)).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBe(2);   // full + overclocked unset
    // The strip is scoped to ONE hands bucket — say which, or a right-hand best
    // reads as a both-hands one.
    expect(screen.getByText(/right hand/i)).toBeInTheDocument();
    // The tier the run just earned is marked, so the user can see which cell moved.
    expect(document.querySelectorAll('.piano-score-run-tier--current').length).toBe(1);
  });

  it('a voided run is labelled mixed tempo', () => {
    render(<RunSummary open grades={grades} measures={measures} onClose={vi.fn()} onReplay={vi.fn()}
      runScore={64} tier="medium" mixedTempo tierBests={{}} bucket="both" />);
    expect(screen.getByText(/mixed tempo/i)).toBeInTheDocument();
    // A voided run belongs to no tier: nothing is marked and no best was banked.
    expect(screen.queryByText(/^medium$/i)).toBeNull();
    expect(document.querySelectorAll('.piano-score-run-tier--current').length).toBe(0);
    expect(screen.getAllByText('—').length).toBe(4);
  });

  it('a partial run (pause / silent-stop) marks NO tier cell — it banked nothing and belongs to no column', () => {
    render(<RunSummary open grades={grades} measures={measures} onClose={vi.fn()} onReplay={vi.fn()}
      runScore={87} tier="medium" bucket="both" mixedTempo={false} completed={false}
      tierBests={{ slow: 78, medium: 84, full: null, overclocked: null }} />);
    expect(document.querySelectorAll('.piano-score-run-tier--current').length).toBe(0);
  });

  it('an ungraded run shows no score headline (nothing to report), and the bests strip is opt-in', () => {
    // Play → immediate Pause: runScore is null. A headline reading "null" or "0"
    // would be a grade the user never earned.
    const { rerender } = render(
      <RunSummary open grades={{}} measures={measures} onClose={vi.fn()} onReplay={vi.fn()}
        runScore={null} tier="full" bucket="both" tierBests={{}} />,
    );
    expect(document.querySelector('.piano-score-run-score')).toBeNull();
    // …and a caller that passes no tierBests at all (Learn-era callers) gets no strip.
    rerender(<RunSummary open grades={{}} measures={measures} onClose={vi.fn()} onReplay={vi.fn()} />);
    expect(document.querySelector('.piano-score-run-tiers')).toBeNull();
  });

  it('shows Drill worst section only when drillable, and fires onDrill (J6)', () => {
    const onDrill = vi.fn();
    const { rerender } = render(
      <RunSummary open grades={grades} measures={measures} onClose={() => {}} onReplay={() => {}} drillable onDrill={onDrill} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /drill worst section/i }));
    expect(onDrill).toHaveBeenCalled();
    // Not drillable (all green) → no button.
    rerender(
      <RunSummary open grades={{ 0: { grade: 'green' } }} measures={measures} onClose={() => {}} onReplay={() => {}} drillable={false} onDrill={onDrill} />,
    );
    expect(screen.queryByRole('button', { name: /drill worst section/i })).toBeNull();
  });
});
