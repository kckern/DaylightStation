import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import GemDetail, { weekDays, streakLine } from './GemDetail.jsx';

afterEach(cleanup);
const WINDOWS = { school: { from: '2026-11-02', to: '2026-11-08' } };
const base = { state: 'none', week: 0, lifetime: 0, progress: null, left: null, reach: null, days: [], items: [], score: null, note: null };
const row = { id: 'reading', label: 'Reading', color: '#f2c94c' };
const ann = { learnerId: 'a', name: 'Ann' };

describe('GemDetail', () => {
  it('lays the week out Monday to Sunday', () => {
    expect(weekDays('2026-11-02').map((d) => d.letter).join('')).toBe('MTWTFSS');
    expect(weekDays('2026-11-02')[6].day).toBe('2026-11-08');
  });

  it('says how a day-count stands', () => {
    expect(streakLine({ ...base, state: 'pending', progress: { have: 2, need: 4 }, left: 3, reach: 'on-track' })).toBe('2 of 4 days · 3 days left');
    expect(streakLine({ ...base, state: 'pending', progress: { have: 3, need: 4 }, left: 2, reach: 'on-track' })).toBe('3 of 4 days · 2 days left');
    expect(streakLine({ ...base, state: 'pending', progress: { have: 2, need: 4 }, left: 1, reach: 'on-track' })).toBe('2 of 4 days · 1 day left');
    expect(streakLine({ ...base, state: 'pending', progress: { have: 2, need: 4 }, left: 2, reach: 'tight' })).toBe('2 of 4 days · needs every day left');
    expect(streakLine({ ...base, state: 'pending', progress: { have: 0, need: 5 }, left: 1, reach: 'out' })).toBe('0 of 5 days · out of reach this week');
    expect(streakLine({ ...base, state: 'earned', progress: { have: 4, need: 4 } })).toBe('Earned');
    expect(streakLine({ ...base, state: 'none', progress: { have: 2, need: 4 } })).toBe('2 of 4 days');
  });

  it('shows which days counted, the books finished and the lifetime count', () => {
    const cell = { state: 'earned', week: 1, parts: [
      { ...base, ruleId: 'reader-week', label: 'Story time 4 days', cadence: 'weekly', state: 'pending', progress: { have: 1, need: 4 }, left: 4, reach: 'on-track', days: [{ day: '2026-11-03', state: 'done' }] },
      { ...base, ruleId: 'book-finished', label: 'Book finished', cadence: 'milestone', state: 'earned', week: 1, lifetime: 4, items: [{ day: '2026-11-03', label: 'Frog and Toad' }] },
    ] };
    const onClose = vi.fn();
    const { container } = render(<GemDetail row={row} learner={ann} cell={cell} windows={WINDOWS} today="2026-11-04" onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Ann, Reading' })).toBeTruthy();
    const days = [...container.querySelectorAll('.gem-detail__day')];
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.className.replace('gem-detail__day', '').trim())).toEqual(['', 'is-done', 'is-today', 'is-ahead', 'is-ahead', 'is-ahead', 'is-ahead']);
    expect(container.textContent).toContain('1 of 4 days · 4 days left');
    expect(container.textContent).toContain('Frog and Toad · Tue');
    expect(container.textContent).toContain('4 in all');
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledWith('tap');
  });

  it('a contest part reads leading with the score; an empty cell says not this week', () => {
    const lead = { state: 'leading', week: 0, parts: [{ ...base, ruleId: 'ring-contest', label: 'Most rings this week', cadence: 'contest', state: 'leading', score: { mine: 320, best: 320 } }] };
    const a = render(<GemDetail row={row} learner={ann} cell={lead} windows={WINDOWS} today="2026-11-04" onClose={() => {}} />);
    expect(a.container.textContent).toContain('Leading so far');
    expect(a.container.textContent).toContain('320 — best 320');
    cleanup();
    const b = render(<GemDetail row={row} learner={ann} cell={{ state: 'none', week: 0, parts: [{ ...base, ruleId: 'x', label: 'X', cadence: 'weekly' }] }} windows={WINDOWS} today="2026-11-04" onClose={() => {}} />);
    expect(b.container.textContent).toContain('Not this week');
  });

  it('a score with no best shows just the learner’s number; a scored part that is not leading says so', () => {
    const cell = { state: 'none', week: 0, parts: [{ ...base, ruleId: 'ring-contest', label: 'Most rings this week', cadence: 'contest', score: { mine: 320, best: null } }] };
    const { container } = render(<GemDetail row={row} learner={ann} cell={cell} windows={WINDOWS} today="2026-11-04" onClose={() => {}} />);
    expect(container.textContent).toContain('Not leading');
    expect(container.querySelector('.gem-detail__score').textContent).toBe('320');
    expect(container.textContent).not.toContain('best');
  });

  it('marks days in the part’s own colour, falling back to the row’s; a short day is outlined, a done today is both', () => {
    const days = [{ day: '2026-11-02', state: 'short' }, { day: '2026-11-04', state: 'done' }];
    const cell = { state: 'pending', week: 0, parts: [
      { ...base, ruleId: 'p', label: 'P', cadence: 'weekly', color: 'rgb(1, 2, 3)', state: 'pending', progress: { have: 1, need: 4 }, left: 4, reach: 'on-track', days },
      { ...base, ruleId: 'q', label: 'Q', cadence: 'weekly', state: 'pending', progress: { have: 1, need: 4 }, left: 4, reach: 'on-track', days },
    ] };
    const { container } = render(<GemDetail row={{ ...row, color: 'rgb(9, 9, 9)' }} learner={ann} cell={cell} windows={WINDOWS} today="2026-11-04" onClose={() => {}} />);
    const marks = [...container.querySelectorAll('.gem-detail__day')];
    expect(marks[0].className).toBe('gem-detail__day is-short');
    expect(marks[0].style.borderColor).toBe('rgb(1, 2, 3)');
    expect(marks[2].className).toBe('gem-detail__day is-done is-today');
    expect(marks[2].style.background).toBe('rgb(1, 2, 3)');
    expect(marks[9].style.background).toBe('rgb(9, 9, 9)');
  });

  it('skips a part that is off, says so when the evidence could not be read, and closes on a tap outside the card', () => {
    const cell = { state: 'unknown', week: 0, parts: [
      { ...base, ruleId: 'off', label: 'Switched off', cadence: 'weekly', state: 'disabled', lifetime: 2 },
      { ...base, ruleId: 'green-week', label: 'Green week', cadence: 'weekly', state: 'unknown' },
      { ...base, ruleId: 'book-finished', label: 'Book finished', cadence: 'milestone', lifetime: 3 },
    ] };
    const onClose = vi.fn();
    const { container } = render(<GemDetail row={row} learner={ann} cell={cell} windows={WINDOWS} today="2026-11-04" onClose={onClose} />);
    expect(container.textContent).not.toContain('Switched off');
    expect(container.textContent).toContain('Can’t tell yet');
    expect(container.textContent).toContain('None this week');
    expect(container.textContent).toContain('3 in all');
    fireEvent.click(container.querySelector('.gem-detail__backdrop'));
    expect(onClose).toHaveBeenCalledWith('tap');
  });
});
