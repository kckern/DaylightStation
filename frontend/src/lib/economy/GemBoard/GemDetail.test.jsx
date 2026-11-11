import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import GemDetail, {
  weekDays, streakLine, detailParts, formatMeasure, clockTime, contestHeadline, doneLine, dayName, gemsLine, listWords,
} from './GemDetail.jsx';
import { inkOn } from './AreaIcon.jsx';

afterEach(cleanup);
const WINDOWS = { school: { from: '2026-11-02', to: '2026-11-08' } };
const base = { state: 'none', week: 0, lifetime: 0, progress: null, left: null, reach: null, days: [], items: [], score: null, note: null };
const row = { id: 'reading', label: 'Reading', color: '#f2c94c', area: 'school' };
const ann = { learnerId: 'ann', name: 'Ann' };
const raceScore = (value, extra = {}) => ({
  mine: 1e6 / value, best: 1e6 / 314, value, unit: 'seconds', course: 'Sprint 1500',
  standings: [{ learnerId: 'ann', name: 'Ann', value: 314, leader: true }, { learnerId: 'ben', name: 'Ben', value: 457, leader: false }],
  ...extra,
});

describe('GemDetail formatting', () => {
  it('lays the week out Monday to Sunday', () => {
    expect(weekDays('2026-11-02').map((d) => d.letter).join('')).toBe('MTWTFSS');
    expect(weekDays('2026-11-02').map((d) => d.short)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('reads a race time as a clock does, never a raw number', () => {
    expect(clockTime(313.8)).toBe('5:14');
    expect(clockTime(59)).toBe('0:59');
    expect(clockTime(3725)).toBe('1:02:05');
    expect(formatMeasure(1e6 / 3186.5268295784863, 'seconds')).toBe('5:14');
  });

  it('every value goes out with its unit', () => {
    expect(formatMeasure(1260, 'rings')).toBe('1,260 rings');
    expect(formatMeasure(1, 'rings')).toBe('1 ring');
    expect(formatMeasure(2340.4, 'metres')).toBe('2,340 m');
    expect(formatMeasure(35.6, 'rings-vs-usual')).toBe('36 rings more than usual');
    expect(formatMeasure(-2802, 'rings-vs-usual')).toBe('2,802 rings fewer than usual');
    expect(formatMeasure(0.2, 'rings-vs-usual')).toBe('same as usual');
    expect(formatMeasure(3186.5268295784863, 'points')).toBe('3,187');
    expect(formatMeasure(null, 'rings')).toBeNull();
  });

  it('names days in words', () => {
    expect(dayName('2026-11-03')).toBe('Tuesday');
    expect(dayName('2026-11-03', '2026-11-03')).toBe('today');
    expect(dayName('2026-11-03', '2026-11-04')).toBe('yesterday');
    expect(listWords(['Monday', 'Tuesday', 'Friday'])).toBe('Monday, Tuesday and Friday');
    expect(doneLine({ days: [{ day: '2026-11-02', state: 'done' }, { day: '2026-11-03', state: 'short' }] }, '2026-11-02', '2026-11-05')).toBe('Done on Monday');
    expect(doneLine({ days: [{ day: '2026-11-02', state: 'done' }, { day: '2026-11-04', state: 'done' }] }, '2026-11-02', '2026-11-04')).toBe('Done on Monday and today');
    expect(doneLine({ days: [] }, '2026-11-02', '2026-11-04')).toBe('No days done yet');
  });

  it('says how a day-count stands', () => {
    expect(streakLine({ ...base, state: 'pending', progress: { have: 2, need: 4 }, left: 2, reach: 'on-track' })).toBe('2 of 4 days · 2 more to go');
    expect(streakLine({ ...base, state: 'pending', progress: { have: 2, need: 4 }, left: 2, reach: 'tight' })).toBe('2 of 4 days · 2 more to go, every day left');
    expect(streakLine({ ...base, state: 'pending', progress: { have: 0, need: 5 }, left: 1, reach: 'out' })).toBe('0 of 5 days · can’t make it this week');
    expect(streakLine({ ...base, state: 'earned', progress: { have: 4, need: 4 } })).toBe('Earned!');
    expect(streakLine({ ...base, state: 'none', progress: { have: 2, need: 4 } })).toBe('2 of 4 days');
    expect(streakLine({ ...base, state: 'none', progress: { have: 0, need: 1 } })).toBe('0 of 1 day');
  });

  it('a contest says who leads, with what, and on which course', () => {
    expect(contestHeadline({ state: 'leading', score: raceScore(314) }, 'Ann')).toBe('Ann leads with 5:14 on Sprint 1500');
    expect(contestHeadline({ state: 'none', score: raceScore(457) }, 'Ben')).toBe('Ann leads with 5:14 on Sprint 1500');
    expect(contestHeadline({ state: 'won', score: raceScore(314) }, 'Ann')).toBe('Ann won with 5:14 on Sprint 1500');
    const tied = { unit: 'rings', standings: [{ learnerId: 'a', name: 'Ann', value: 410, leader: true }, { learnerId: 'b', name: 'Ben', value: 410, leader: true }] };
    expect(contestHeadline({ state: 'leading', score: tied }, 'Ann')).toBe('Ann and Ben are tied for first with 410 rings');
    const under = { unit: 'rings-vs-usual', standings: [{ learnerId: 'a', name: 'Ann', value: -120, leader: false }] };
    expect(contestHeadline({ state: 'none', score: under }, 'Ann')).toBe('Nobody is above their usual rings yet');
  });

  it('says what the cell holds in words', () => {
    expect(gemsLine({ week: 2, held: 2 })).toBe('2 gems this week');
    expect(gemsLine({ week: 0, held: 1 })).toBe('Holding 1 gem while leading');
    expect(gemsLine({ week: 1, held: 2 })).toBe('1 gem this week, and 1 more while leading');
    expect(gemsLine({ week: 0, held: 0 })).toBe('No gem yet this week');
  });

  it('picks a readable ink for each area colour: whichever contrasts more (dark on all three area colours)', () => {
    expect(inkOn('#f2c94c')).toBe('#14171f');
    expect(inkOn('#1e88e5')).toBe('#14171f');
    expect(inkOn('#2e9e5b')).toBe('#14171f');
    expect(inkOn('#123456')).toBe('#ffffff');
    expect(inkOn('not a colour')).toBe('#ffffff');
  });
});

describe('GemDetail', () => {
  it('heads the box with the area badge, the gem name, the child and what they hold; closes large and plainly', () => {
    const cell = { state: 'earned', week: 1, held: 1, parts: [
      { ...base, ruleId: 'reader-week', label: 'Story time on 4 days', cadence: 'weekly', state: 'pending', progress: { have: 1, need: 4 }, left: 3, reach: 'on-track', days: [{ day: '2026-11-03', state: 'done' }] },
      { ...base, ruleId: 'book-finished', label: 'Book finished', cadence: 'milestone', state: 'earned', week: 1, lifetime: 4, items: [{ day: '2026-11-03', label: 'Frog and Toad' }] },
    ] };
    const onClose = vi.fn();
    const { container } = render(<GemDetail row={row} learner={ann} cell={cell} windows={WINDOWS} today="2026-11-05" onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Ann, Reading' });
    expect(dialog.hasAttribute('aria-modal')).toBe(false);
    expect(document.activeElement).toBe(screen.getByLabelText('Close'));
    expect(container.querySelector('.gem-detail__badge .area-icon--school')).toBeTruthy();
    expect(container.querySelector('.gem-detail__badge').style.color).toBe('#14171f'); // dark ink on citrine
    expect(container.querySelector('.gem-detail__row').textContent).toBe('Reading');
    expect(container.querySelector('.gem-detail__who').textContent).toBe('Ann · 1 gem this week');
    expect(container.textContent).not.toContain('×');
    expect(container.textContent).toContain('1 of 4 days · 3 more to go');
    expect(container.textContent).toContain('Done on Tuesday');
    expect(container.querySelector('.gem-detail__items li').textContent).toBe('Frog and Toadon Tuesday');
    const days = [...container.querySelectorAll('.gem-detail__day')];
    expect(days.map((d) => d.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(days.map((d) => d.className.replace('gem-detail__day', '').trim())).toEqual(['', 'is-done', '', 'is-today', 'is-ahead', 'is-ahead', 'is-ahead']);
    expect(days[1].style.color).toBe('#14171f');
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledWith('tap');
  });

  it('a race reads as a time on the course, with everyone’s times best first — never the raw score', () => {
    const racing = { id: 'racing', label: 'Cycle Race', color: '#2e9e5b', area: 'games' };
    const cell = { state: 'leading', week: 1, held: 2, parts: [
      { ...base, ruleId: 'race-champion', label: 'Best race', cadence: 'contest', state: 'leading', score: raceScore(314) },
      { ...base, ruleId: 'race-pb', label: 'New personal best', cadence: 'milestone', state: 'earned', week: 1, items: [{ day: '2026-11-03', label: 'New best on Sprint 1500' }] },
    ] };
    const { container } = render(<GemDetail row={racing} learner={ann} cell={cell} windows={WINDOWS} today="2026-11-05" onClose={() => {}} />);
    expect(container.textContent).toContain('Ann leads with 5:14 on Sprint 1500');
    expect([...container.querySelectorAll('.gem-detail__standings li')].map((li) => li.textContent)).toEqual(['1Ann5:14', '2Ben7:37']);
    expect(container.querySelector('.gem-detail__standings li.is-mine').textContent).toBe('1Ann5:14');
    expect(container.textContent).toContain('New best on Sprint 1500on Tuesday');
    expect(container.textContent).not.toMatch(/\d{4}\.\d/);
    expect(container.querySelector('.gem-detail__who').textContent).toBe('Ann · 1 gem this week, and 1 more while leading');
  });

  it('most improved reads in rings over or under the usual week', () => {
    const score = { mine: -120, best: 36, value: -120, unit: 'rings-vs-usual', course: null, standings: [
      { learnerId: 'ben', name: 'Ben', value: 36, leader: true }, { learnerId: 'ann', name: 'Ann', value: -120, leader: false }] };
    const cell = { state: 'none', week: 0, parts: [{ ...base, ruleId: 'most-improved', label: 'Most improved rings', cadence: 'contest', score }] };
    const { container } = render(<GemDetail row={{ id: 'ring-contests', label: 'Most Rings', color: '#1e88e5', area: 'move' }} learner={ann} cell={cell} windows={WINDOWS} today="2026-11-04" onClose={() => {}} />);
    expect(container.textContent).toContain('Ben leads with 36 rings more than usual');
    expect([...container.querySelectorAll('.gem-detail__standings li')].map((li) => li.textContent)).toEqual(['1Ben36 more', '2Ann120 fewer']);
  });

  it('a contest without the child in it says so', () => {
    const cell = { state: 'none', week: 0, parts: [{ ...base, ruleId: 'race-champion', label: 'Best race', cadence: 'contest', score: raceScore(314) }] };
    const { container } = render(<GemDetail row={row} learner={{ learnerId: 'cal', name: 'Cal' }} cell={cell} windows={WINDOWS} today="2026-11-04" onClose={() => {}} />);
    expect(container.textContent).toContain('Cal: no score yet this week');
  });

  it('marks days in the part’s own colour, falling back to the row’s; a short day is outlined, a done today is both', () => {
    const days = [{ day: '2026-11-02', state: 'short' }, { day: '2026-11-04', state: 'done' }];
    const cell = { state: 'pending', week: 0, parts: [
      { ...base, ruleId: 'p', label: 'P', cadence: 'weekly', color: '#1e88e5', state: 'pending', progress: { have: 1, need: 4 }, left: 4, reach: 'on-track', days },
      { ...base, ruleId: 'q', label: 'Q', cadence: 'weekly', state: 'pending', progress: { have: 1, need: 4 }, left: 4, reach: 'on-track', days },
    ] };
    const { container } = render(<GemDetail row={{ ...row, color: '#2e9e5b' }} learner={ann} cell={cell} windows={WINDOWS} today="2026-11-04" onClose={() => {}} />);
    const marks = [...container.querySelectorAll('.gem-detail__day')];
    expect(marks[0].className).toBe('gem-detail__day is-short');
    expect(marks[0].style.borderColor).toBe('#1e88e5');
    expect(marks[2].className).toBe('gem-detail__day is-done is-today');
    expect(marks[2].style.background).toBe('#1e88e5');
    expect(marks[9].style.background).toBe('#2e9e5b');
  });

  it('skips a part that is off, says so when the evidence could not be read, and closes on a tap outside the card', () => {
    const cell = { state: 'unknown', week: 0, parts: [
      { ...base, ruleId: 'off', label: 'Switched off', cadence: 'weekly', state: 'disabled', lifetime: 2 },
      { ...base, ruleId: 'green-week', label: 'Green week', cadence: 'weekly', state: 'unknown' },
      { ...base, ruleId: 'book-finished', label: 'Book finished', cadence: 'milestone', state: 'pending', lifetime: 3 },
      { ...base, ruleId: 'old-books', label: 'Other weeks', cadence: 'milestone', lifetime: 3 },
    ] };
    const onClose = vi.fn();
    const { container } = render(<GemDetail row={row} learner={ann} cell={cell} windows={WINDOWS} today="2026-11-04" onClose={onClose} />);
    expect(container.textContent).not.toContain('Switched off');
    expect(container.textContent).toContain('Can’t tell yet');
    expect(container.textContent).toContain('None yet this week');
    expect(container.textContent).not.toContain('Other weeks');
    fireEvent.click(container.querySelector('.gem-detail__backdrop'));
    expect(onClose).toHaveBeenCalledWith('tap');
  });

  it('picks the parts with something to say: the same rule decides which cells open', () => {
    const p = (extra) => ({ ...base, ruleId: 'r', label: 'R', cadence: 'weekly', ...extra });
    expect(detailParts({ parts: [p({ state: 'disabled', lifetime: 3 })] })).toEqual([]);
    expect(detailParts({ parts: [p({})] })).toEqual([]);
    expect(detailParts({ parts: [] })).toEqual([]);
    expect(detailParts(undefined)).toEqual([]);
    expect(detailParts({ parts: [p({ cadence: 'contest', score: { mine: 3, best: 9 } })] })).toHaveLength(1);
    expect(detailParts({ parts: [p({ days: [{ day: '2026-11-02', state: 'short' }] })] })).toHaveLength(1);
    expect(detailParts({ parts: [p({ cadence: 'milestone', lifetime: 2 })] })).toHaveLength(0);
    expect(detailParts({ parts: [p({ state: 'unknown' }), p({ ruleId: 'q' })] }).map((x) => x.ruleId)).toEqual(['r']);
  });

  it('days after the rule’s last day are closed, not ahead; with no last day named they stay ahead', () => {
    const run = { ...base, ruleId: 'ring-days', label: '100+ rings on 5 days', cadence: 'weekly', state: 'pending', progress: { have: 1, need: 5 }, left: 3, reach: 'out', days: [{ day: '2026-11-03', state: 'done' }] };
    const classes = (part, today = '2026-11-04') => {
      const { container } = render(<GemDetail row={row} learner={ann} cell={{ state: 'pending', week: 0, parts: [part] }} windows={WINDOWS} today={today} onClose={() => {}} />);
      const out = [...container.querySelectorAll('.gem-detail__day')].map((d) => d.className.replace('gem-detail__day', '').trim());
      cleanup();
      return out;
    };
    expect(classes({ ...run, lastDay: '2026-11-07' })).toEqual(['', 'is-done', 'is-today', 'is-ahead', 'is-ahead', 'is-ahead', 'is-closed']);
    expect(classes({ ...run, lastDay: null })).toEqual(['', 'is-done', 'is-today', 'is-ahead', 'is-ahead', 'is-ahead', 'is-ahead']);
    expect(classes({ ...run, lastDay: '2026-11-07' }, '2026-11-08')[6]).toBe('is-today is-closed');
  });

  it('a row that is one rule under the same name (any case) prints the name once', () => {
    const one = { ...base, ruleId: 'green-week', label: 'Green week', cadence: 'weekly', state: 'earned', week: 1 };
    const green = { id: 'green-week', label: 'Green Week', color: '#f2c94c', area: 'school' };
    const same = render(<GemDetail row={green} learner={ann} cell={{ state: 'earned', week: 1, parts: [one] }} windows={WINDOWS} today="2026-11-04" onClose={() => {}} />);
    expect(same.container.querySelector('.gem-detail__part-label')).toBeNull();
    expect(same.container.textContent).toContain('Earned!');
    cleanup();
    const two = render(<GemDetail row={green} learner={ann} cell={{ state: 'earned', week: 1, parts: [one, { ...one, ruleId: 'x', label: 'Other' }] }} windows={WINDOWS} today="2026-11-04" onClose={() => {}} />);
    expect(two.container.querySelectorAll('.gem-detail__part-label')).toHaveLength(2);
  });
});
