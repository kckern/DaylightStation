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
});
