import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import StudioReviewPrompt from './StudioReviewPrompt.jsx';

const take = {
  durationMs: 65000,
  events: [
    { t: 0, type: 'note_on', note: 60 }, { t: 100, type: 'note_off', note: 60 },
    { t: 200, type: 'note_on', note: 64 }, { t: 300, type: 'note_off', note: 64 },
  ],
};

describe('StudioReviewPrompt', () => {
  it('renders nothing without a take', () => {
    const { container } = render(<StudioReviewPrompt take={null} onSave={vi.fn()} onDiscard={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the take summary (duration + note count)', () => {
    render(<StudioReviewPrompt take={take} onSave={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByText(/1:05/)).toBeTruthy();
    expect(screen.getByText(/2 notes/)).toBeTruthy();
  });

  it('fires onSave and onDiscard from the buttons', () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    render(<StudioReviewPrompt take={take} onSave={onSave} onDiscard={onDiscard} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save take' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});
