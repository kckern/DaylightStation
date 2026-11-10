import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessions = [{
  startTime: Date.now() - 3_600_000,
  totalRings: 300,
  participants: {
    user_1: {
      displayName: 'User_1',
      rings: 300,
      zoneMinutes: { active: 20, warm: 10, cool: 5 },
    },
  },
}];
const MOVE = [
  { id: 'ring-contests', label: 'Ring contests', color: '#1e88e5', cell: { state: 'leading', week: 0, streak: null, parts: [] } },
  { id: 'moved-days', label: 'Moved 5 days', color: '#ff8800', cell: { state: 'pending', week: 0, streak: { have: 2, need: 5, left: 3, reach: 'on-track', ruleId: 'moved-days' }, parts: [] } },
  { id: 'strong-days', label: '100+ rings on 3 days', color: '#8e44ad', cell: { state: 'earned', week: 1, streak: null, parts: [] } },
];
const STANDINGS = { mode: 'live', contestClosed: false, learners: [{ learnerId: 'user_1', learnerName: 'User_1', silver: 27, weekRings: 300, gem: 'leading', move: MOVE }] };
let standings = STANDINGS;
vi.mock("../../../../../../__capabilities/screen-host/browser/data/useScreenData.js", () => ({
  useScreenData: (key) => (key === 'standings' ? standings : { sessions, total: 1 }),
}));
vi.mock("../../useFitnessScreen.js", () => ({
  useFitnessScreen: () => ({
    roster: [
      { id: 'user_1', name: 'User_1', group_label: 'Dad' },
      { id: 'user_2', name: 'User_2' },
    ],
    householdLabel: 'Kern Family',
    compareWeeks: 4,
    zoneRingRates: { active: 1, warm: 2, hot: 3, fire: 5 },
  }),
}));

import FitnessMomentum, { dayLabel, hasGemToShow } from "./FitnessMomentum.jsx";

describe('FitnessMomentum', () => {
  beforeEach(() => { standings = STANDINGS; });

  it('gives a learner a rail with silver and one glyph per Move gem, as the board draws them', () => {
    const { container } = render(<FitnessMomentum />);
    const rail = container.querySelectorAll('.fitness-momentum__card')[0].querySelector('button.fitness-momentum__rail');
    expect(rail.querySelector('.fitness-momentum__silver').textContent).toContain('27');
    const looks = [...rail.querySelectorAll('.fitness-momentum__gemslot')].map((slot) => `${slot.dataset.gem}:${slot.querySelector('.gem-glyph').dataset.look}`);
    expect(looks).toEqual(['ring-contests:holding', 'moved-days:streak', 'strong-days:lit']);
    expect(rail.getAttribute('aria-label')).toBe('Dad: 27 silver. Ring contests: leading. Moved 5 days: 2 of 5 days, on track. 100+ rings on 3 days: earned. Open the gem board');
  });

  it('leaves someone without a wallet an empty rail, so the cards keep one height', () => {
    const { container } = render(<FitnessMomentum />);
    const card = container.querySelectorAll('.fitness-momentum__card')[1];
    expect(card.querySelector('button')).toBeNull();
    expect(card.querySelector('.fitness-momentum__rail--empty')).toBeTruthy();
  });

  it('shows silver alone when the standings carry no Move gems', () => {
    standings = { ...STANDINGS, learners: [{ ...STANDINGS.learners[0], move: undefined }] };
    const rail = render(<FitnessMomentum />).container.querySelector('button.fitness-momentum__rail');
    expect(rail.textContent).toContain('27');
    expect(rail.querySelector('.gem-glyph')).toBeNull();
  });

  it('gives no slot to a gem with nothing to show, and says nothing of it', () => {
    const blank = (cell) => ({ ...MOVE[1], cell });
    const quiet = [
      { id: 'a', ...blank({ state: 'none', week: 0, streak: null, parts: [] }) },
      { ...blank({ state: 'pending', week: 0, streak: { have: 0, need: 5, left: 5, reach: 'on-track', ruleId: 'moved-days' }, parts: [] }), id: 'b' },
      { ...blank({ state: 'pending', week: 0, streak: { have: 2, need: 5, left: 1, reach: 'out', ruleId: 'moved-days' }, parts: [] }), id: 'c' },
      { ...blank({ state: 'pending', week: 0, streak: null, parts: [] }), id: 'd' },
      MOVE[2],
    ];
    for (const g of quiet.slice(0, 4)) expect(hasGemToShow(g.cell)).toBe(false);
    standings = { ...STANDINGS, learners: [{ ...STANDINGS.learners[0], move: quiet }] };
    const rail = render(<FitnessMomentum />).container.querySelector('button.fitness-momentum__rail');
    expect([...rail.children].map((el) => el.className)).toEqual(['fitness-momentum__silver', 'fitness-momentum__gemslot']);
    expect(rail.getAttribute('aria-label')).toBe('Dad: 27 silver. 100+ rings on 3 days: earned. Open the gem board');
  });

  it('opens the Gem Board from the rail', () => {
    const { container } = render(<FitnessMomentum />);
    expect(document.querySelector('.gem-board')).toBeNull();
    fireEvent.click(container.querySelector('button.fitness-momentum__rail'));
    expect(document.querySelector('.gem-board')).toBeTruthy();
  });

  it('puts the name with the avatar and the rail under the bars', () => {
    const { container } = render(<FitnessMomentum />);
    const card = container.querySelectorAll('.fitness-momentum__card')[0];
    expect(card.querySelector('.fitness-momentum__who .fitness-momentum__name').textContent).toBe('Dad');
    expect([...card.children].map((el) => el.className.split(' ')[0])).toEqual(['fitness-momentum__who', 'fitness-momentum__weeks', 'fitness-momentum__rail']);
  });

  it('has no rail buttons when standings are missing or the economy is off', () => {
    standings = null;
    expect(render(<FitnessMomentum />).container.querySelector('button.fitness-momentum__rail')).toBeNull();
    standings = { mode: 'off', contestClosed: false, learners: [] };
    expect(render(<FitnessMomentum />).container.querySelector('button.fitness-momentum__rail')).toBeNull();
  });

  it('dates each week as day then month, with no slash', () => {
    expect(dayLabel(new Date(2026, 9, 19, 4).getTime())).toBe('19 Oct');
    expect(dayLabel(new Date(2026, 10, 2, 4).getTime())).toBe('2 Nov');
    expect(dayLabel(null)).toBe('');
    const labels = [...render(<FitnessMomentum />).container.querySelectorAll('.fitness-momentum__weeklabel')].map((el) => el.textContent);
    expect(labels.length).toBe(8);
    for (const label of labels) expect(label).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/);
  });

  it('labels the hard Monday window and renders one card per member', () => {
    const { container, getByText } = render(<FitnessMomentum />);
    expect(getByText(/Kern Family/)).toBeTruthy();
    expect(getByText(/Monday–today/)).toBeTruthy();
    expect(container.querySelectorAll('.fitness-momentum__card')).toHaveLength(2);
  });

  it('resolves names through DisplayNameResolver (group label → Dad)', () => {
    const { getByText, queryByText } = render(<FitnessMomentum />);
    expect(getByText('Dad')).toBeTruthy();
    expect(queryByText('User_1')).toBeNull();
    expect(getByText('User_2')).toBeTruthy();
  });

  it('draws four weekly bars per person with the current week highlighted', () => {
    const { container } = render(<FitnessMomentum />);
    expect(container.querySelectorAll('.fitness-momentum__weekbar')).toHaveLength(8);
    expect(container.querySelectorAll('.fitness-momentum__weekbar.is-current')).toHaveLength(2);
  });

  it('shows rings as the primary metric with the canonical icon', () => {
    const { container } = render(<FitnessMomentum />);
    expect(container.querySelector('.fitness-momentum__house-rings').textContent).toContain('300');
    expect(container.querySelector('.fitness-momentum__house-rings .ring-icon')).toBeTruthy();
    expect(container.querySelector('.fitness-momentum__weekbar[title="300 rings"]')).toBeTruthy();
    expect(container.textContent).not.toMatch(/min this week|last 7 days/);
  });
});
