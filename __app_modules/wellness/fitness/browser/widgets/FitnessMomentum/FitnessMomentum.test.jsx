import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

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
const GEMS = [
  { area: 'move', held: 2, color: '#8e5bd0' },
  { area: 'school', held: 3, color: '#2e9e5b' },
  { area: 'games', held: 1, color: '#ff7a2f' },
];
const STANDINGS = { mode: 'live', contestClosed: false, learners: [{ learnerId: 'user_1', learnerName: 'User_1', silver: 27, weekRings: 300, gem: 'leading', gems: GEMS }] };
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

import FitnessMomentum from "./FitnessMomentum.jsx";

describe('FitnessMomentum', () => {
  beforeEach(() => { standings = STANDINGS; });

  it('rail: a count under every token, plain gems in area colour, no area icons', () => {
    const { container } = render(<FitnessMomentum />);
    const rail = container.querySelectorAll('.fitness-momentum__card')[0].querySelector('button.fitness-momentum__rail');
    expect(rail.querySelector('.fitness-momentum__silver .fitness-momentum__count').textContent).toBe('27');
    const chips = [...rail.querySelectorAll('.fitness-momentum__chip')];
    expect(chips.map((c) => c.dataset.area)).toEqual(['move', 'school', 'games']);
    expect(chips.map((c) => c.querySelector('.fitness-momentum__count').textContent)).toEqual(['2', '3', '1']);
    expect(chips.every((c) => c.querySelector('.gem-icon.fitness-momentum__gem'))).toBe(true);
    expect(rail.querySelector('.area-icon')).toBeNull();
    expect(rail.querySelector('.gem-glyph')).toBeNull();
    expect(rail.getAttribute('aria-label')).toBe('Dad: 27 silver. Move: 2 gems this week. School: 3 gems this week. Games: 1 gem this week. Open the gem board');
  });

  it('the Gems chip is the legend: one gem per area with its name', () => {
    const chip = render(<FitnessMomentum />).container.querySelector('.fitness-momentum__gems-chip');
    expect([...chip.querySelectorAll('[data-area]')].map((n) => n.textContent)).toEqual(['Move', 'School', 'Games']);
    expect(chip.querySelectorAll('.gem-icon')).toHaveLength(3);
    expect(chip.getAttribute('aria-label')).toBe('Open the gem board');
  });

  it('a child with nothing earned shows silver only', () => {
    standings = { ...STANDINGS, learners: [{ ...STANDINGS.learners[0], gems: [] }] };
    const rail = render(<FitnessMomentum />).container.querySelector('button.fitness-momentum__rail');
    expect([...rail.children].map((el) => el.className)).toEqual(['fitness-momentum__silver']);
    expect(rail.getAttribute('aria-label')).toBe('Dad: 27 silver. Open the gem board');
    standings = { ...STANDINGS, learners: [{ ...STANDINGS.learners[0], gems: undefined }] };
    const bare = render(<FitnessMomentum />).container.querySelectorAll('button.fitness-momentum__rail')[0];
    expect(bare.querySelector('.fitness-momentum__chip')).toBeNull();
  });

  it('in-progress, leading and zero cells never render', () => {
    // The rail reads only the held roll-up: an old payload's per-cell list,
    // a zero, a negative, an unknown area or the old `earned` key earns no chip.
    standings = { ...STANDINGS, learners: [{ ...STANDINGS.learners[0],
      move: [{ id: 'ring-contests', label: 'Ring contests', color: '#8e5bd0', cell: { state: 'leading', week: 0, streak: null, parts: [] } }],
      gems: [{ area: 'move', held: 0, color: '#8e5bd0' }, { area: 'school', held: -1, color: '#2e9e5b' }, { area: 'art', held: 2, color: '#123456' }, { area: 'school', earned: 4, color: '#2e9e5b' }, { area: 'games', held: 1, color: '#ff7a2f' }] }] };
    const { container } = render(<FitnessMomentum />);
    const rail = container.querySelector('button.fitness-momentum__rail');
    expect([...rail.querySelectorAll('.fitness-momentum__chip')].map((c) => c.dataset.area)).toEqual(['games']);
    expect(container.querySelector('.fitness-momentum__card .gem-glyph__word')).toBeNull();
    expect(container.querySelector('.fitness-momentum__card .gem-glyph__ring')).toBeNull();
  });

  it('leaves someone without a wallet an empty rail, so the cards keep one height', () => {
    const { container } = render(<FitnessMomentum />);
    const card = container.querySelectorAll('.fitness-momentum__card')[1];
    expect(card.querySelector('button')).toBeNull();
    expect(card.querySelector('.fitness-momentum__rail--empty')).toBeTruthy();
  });

  it('opens the Gem Board from the rail', () => {
    const { container } = render(<FitnessMomentum />);
    expect(document.querySelector('.gem-board')).toBeNull();
    fireEvent.click(container.querySelector('button.fitness-momentum__rail'));
    expect(document.querySelector('.gem-board')).toBeTruthy();
  });

  it('stacks avatar, this week\'s rings, the bars, then the rail', () => {
    const { container } = render(<FitnessMomentum />);
    const card = container.querySelectorAll('.fitness-momentum__card')[0];
    expect(card.querySelector('.fitness-momentum__who .fitness-momentum__name').textContent).toBe('Dad');
    expect([...card.children].map((el) => el.className.split(' ')[0])).toEqual(['fitness-momentum__who', 'fitness-momentum__hero', 'fitness-momentum__weeks', 'fitness-momentum__rail']);
  });

  it('heads each card with this week\'s rings, and draws no per-bar numbers or dates', () => {
    const { container } = render(<FitnessMomentum />);
    const [dad, other] = container.querySelectorAll('.fitness-momentum__card');
    expect(dad.querySelector('.fitness-momentum__hero .ring-icon')).toBeTruthy();
    expect(dad.querySelector('.fitness-momentum__hero').textContent).toBe('300');
    expect(other.querySelector('.fitness-momentum__hero').textContent).toBe('0');
    expect(container.querySelector('.fitness-momentum__weektop')).toBeNull();
    expect(container.querySelector('.fitness-momentum__weeklabel')).toBeNull();
  });

  it('has no rail buttons when standings are missing or the economy is off', () => {
    standings = null;
    expect(render(<FitnessMomentum />).container.querySelector('button.fitness-momentum__rail')).toBeNull();
    standings = { mode: 'off', contestClosed: false, learners: [] };
    expect(render(<FitnessMomentum />).container.querySelector('button.fitness-momentum__rail')).toBeNull();
  });

  it('labels the week and renders one card per member', () => {
    const { container, getByText } = render(<FitnessMomentum />);
    expect(getByText(/Kern Family/)).toBeTruthy();
    expect(container.querySelector('.fitness-momentum__window').textContent).toBe('· this week');
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

describe('FitnessMomentum stylesheet', () => {
  it('the week bars and chips are never partly transparent', () => {
    const css = readFileSync(new URL('./FitnessMomentum.scss', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    expect(css).toMatch(/&__weekbar/);
    for (const m of css.matchAll(/opacity\s*:\s*([^;}]+)/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(1);
  });
});
