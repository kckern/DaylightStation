import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StandingsTower, { ordinal, gapToAboveText, buildStandingsGroups } from './StandingsTower.jsx';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';

describe('ordinal', () => {
  it('formats 1st/2nd/3rd/4th and the 11-13 / 21 exceptions', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(21)).toBe('21st');
  });
});

describe('gapToAboveText — gap math for both win conditions (audit UX §4.1)', () => {
  it('distance races: a raw metre gap', () => {
    expect(gapToAboveText({ winCondition: 'distance', gapM: 12, abovePaceKmh: 0 })).toBe('−12 m');
  });
  it('time races: the metre gap projected through the pace above into a time-behind estimate', () => {
    // 40 m at 36 km/h (= 10 m/s) takes 4 s to close.
    expect(gapToAboveText({ winCondition: 'time', gapM: 40, abovePaceKmh: 36 })).toBe('−0:04');
  });
  it('time races fall back to a metre gap when the pace above is unusable (stopped/boxed)', () => {
    expect(gapToAboveText({ winCondition: 'time', gapM: 12, abovePaceKmh: 0 })).toBe('−12 m');
  });
  it('clamps a negative gap (sort noise) to zero', () => {
    expect(gapToAboveText({ winCondition: 'distance', gapM: -5, abovePaceKmh: 0 })).toBe('−0 m');
  });
});

describe('buildStandingsGroups — classification', () => {
  it('splits dnf into its own group, sorted by distance covered (best progress first)', () => {
    const riders = { a: { cumulativeDistanceM: 100 }, b: { cumulativeDistanceM: 300 } };
    const riderLive = { a: { dnf: true }, b: { dnf: true } };
    const { dnfRows, activeRows, finishedRows, overtimeRows } = buildStandingsGroups({ riderIds: ['a', 'b'], riders, riderLive });
    expect(activeRows).toHaveLength(0);
    expect(finishedRows).toHaveLength(0);
    expect(overtimeRows).toHaveLength(0);
    expect(dnfRows.map((r) => r.id)).toEqual(['b', 'a']);
  });
  it('dnf takes priority over overtime when (implausibly) both flags are set', () => {
    const riders = { a: { cumulativeDistanceM: 50 } };
    const riderLive = { a: { dnf: true, overtime: true } };
    const { dnfRows, overtimeRows } = buildStandingsGroups({ riderIds: ['a'], riders, riderLive });
    expect(dnfRows.map((r) => r.id)).toEqual(['a']);
    expect(overtimeRows).toHaveLength(0);
  });
  it('a rider with no live/persisted placement falls back to distance-desc ordering', () => {
    const riders = { a: { cumulativeDistanceM: 40 }, b: { cumulativeDistanceM: 90 } };
    const { activeRows } = buildStandingsGroups({ riderIds: ['a', 'b'], riders, riderLive: {} });
    expect(activeRows.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('StandingsTower — 4-rider fixture (ghost + finished + overtime + active)', () => {
  const riderIds = ['dad', 'milo', 'ghost:r1:felix', 'ot1'];
  const riders = {
    dad: { userId: 'dad', displayName: 'Dad', cumulativeDistanceM: 500, finishTimeS: 120, lapSplits: [30, 72], isGhost: false },
    milo: { userId: 'milo', displayName: 'Milo', cumulativeDistanceM: 488, finishTimeS: null, isGhost: false },
    'ghost:r1:felix': { userId: 'ghost:r1:felix', displayName: 'Felix', cumulativeDistanceM: 476, finishTimeS: null, isGhost: true },
    ot1: { userId: 'ot1', displayName: 'Ann', cumulativeDistanceM: 300, finishTimeS: null, isGhost: false }
  };
  const riderLive = {
    dad: { placement: 1, finished: true, avatarSrc: '/img/dad' },
    milo: { placement: 2, finished: false, speedKmh: 36, avatarSrc: '/img/milo' },
    'ghost:r1:felix': { placement: 3, finished: false, speedKmh: 30, avatarSrc: '/img/felix' },
    ot1: { placement: 4, finished: false, overtime: true, avatarSrc: '/img/ann' }
  };

  it('pins the finished rider to the top (flag + final time) and orders the rest by live rank', () => {
    render(
      <StandingsTower riderIds={riderIds} riders={riders} riderLive={riderLive}
        winCondition="distance" lapLengthM={100} elapsedS={84} lapLabel="Lap 3" />
    );
    const rows = screen.getAllByTestId('tower-row');
    expect(rows.map((r) => r.dataset.rider)).toEqual(['dad', 'milo', 'ghost:r1:felix', 'ot1']);

    const ranks = rows.map((r) => r.querySelector('[data-testid="tower-rank"]').textContent);
    expect(ranks).toEqual(['1st', '2nd', '3rd', '4th']);

    // Finished (pinned) row: flag + final metric (distance race → finish time).
    expect(rows[0].querySelector('.cg-tower__flag')).toBeTruthy();
    expect(rows[0].querySelector('[data-testid="tower-metric"]').textContent).toContain('2:00');

    // Leader of the still-racing pack shows their own total, not a gap.
    expect(rows[1].querySelector('[data-testid="tower-metric"]').textContent).toContain('488 m');

    // Ghost, 12 m behind milo → gap-to-next-above in metres (audit UX §4.1 example).
    expect(rows[2].querySelector('[data-testid="tower-metric"]').textContent).toContain('−12 m');
    expect(rows[2].querySelector('.cg-tower__avatar').className).toContain('cg-ghost');

    // Overtime row: dimmed, real distance kept, tagged OT — not folded into DNF.
    expect(rows[3].className).toContain('cg-tower__row--dim');
    expect(rows[3].querySelector('[data-testid="tower-metric"]').textContent).toContain('300 m');
    expect(rows[3].querySelector('[data-testid="tower-metric"]').textContent).toContain('OT');
  });

  it('assigns lane colors by the ORIGINAL rider order, matching every other panel', () => {
    render(<StandingsTower riderIds={riderIds} riders={riders} riderLive={riderLive} winCondition="distance" />);
    const rows = screen.getAllByTestId('tower-row');
    const laneOf = (row) => row.querySelector('.cg-tower__lane').style.background;
    expect(laneOf(rows.find((r) => r.dataset.rider === 'dad'))).toBe(LINE_COLORS[0]);
    expect(laneOf(rows.find((r) => r.dataset.rider === 'milo'))).toBe(LINE_COLORS[1]);
  });

  it('folds the oval\'s Last/Now lap strip into a compact header row', () => {
    render(
      <StandingsTower riderIds={riderIds} riders={riders} riderLive={riderLive}
        winCondition="distance" lapLengthM={100} elapsedS={84} lapLabel="Lap 3" />
    );
    const header = screen.getByTestId('tower-lap-header');
    expect(header.textContent).toContain('Lap 3');
    expect(screen.getByTestId('tower-lap-last').textContent).toContain('0:42'); // 72 - 30
    expect(screen.getByTestId('tower-lap-now').textContent).toContain('0:12'); // 84 - 72
  });

  it('omits the lap header entirely when laps are off', () => {
    render(<StandingsTower riderIds={riderIds} riders={riders} riderLive={riderLive} winCondition="distance" lapLengthM={0} />);
    expect(screen.queryByTestId('tower-lap-header')).toBeNull();
  });
});

describe('StandingsTower — shared placement (dead heat, audit game-design #8)', () => {
  it('renders the SAME ordinal for two riders tied at placement 1', () => {
    const riders = {
      a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 500, finishTimeS: 100 },
      b: { userId: 'b', displayName: 'B', cumulativeDistanceM: 500, finishTimeS: 100.03 }
    };
    const riderLive = { a: { placement: 1, finished: true }, b: { placement: 1, finished: true } };
    render(<StandingsTower riderIds={['a', 'b']} riders={riders} riderLive={riderLive} winCondition="distance" />);
    const ranks = screen.getAllByTestId('tower-rank').map((el) => el.textContent);
    expect(ranks).toEqual(['1st', '1st']);
  });
});

describe('StandingsTower — time win condition', () => {
  it('projects the active gap through the leading rider\'s pace', () => {
    const riders = {
      lead: { userId: 'lead', displayName: 'Lead', cumulativeDistanceM: 500 },
      trail: { userId: 'trail', displayName: 'Trail', cumulativeDistanceM: 460 }
    };
    const riderLive = { lead: { placement: 1, speedKmh: 36 }, trail: { placement: 2 } };
    render(<StandingsTower riderIds={['lead', 'trail']} riders={riders} riderLive={riderLive} winCondition="time" />);
    const metrics = screen.getAllByTestId('tower-metric').map((el) => el.textContent);
    expect(metrics[0]).toContain('500 m'); // leader shows total distance covered
    expect(metrics[1]).toContain('0:04'); // 40 m / 10 m/s
  });
});
