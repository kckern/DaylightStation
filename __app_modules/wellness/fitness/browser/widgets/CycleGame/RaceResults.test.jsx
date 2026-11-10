import { describe, it, expect, vi } from 'vitest';
import { render, within, fireEvent, screen, cleanup } from '@testing-library/react';
import RaceResults from "./RaceResults.jsx";

const standings = [
  { userId: 'user_3', placement: 1, finishTimeS: 252, distanceM: 3000 },
  { userId: 'user_2', placement: 2, finishTimeS: null, distanceM: 2710 }
];
const riders = {
  user_3: { displayName: 'User_3' },
  user_2: { displayName: 'User_2' }
};

describe('RaceResults', () => {
  it('renders a row per standing in placement order with names', () => {
    const { getAllByTestId } = render(<RaceResults standings={standings} riders={riders} winCondition="distance" animate={false} />);
    const rows = getAllByTestId('result-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('User_3');
    expect(rows[0].textContent).toContain('1');
  });
  it('shows a stopped rider with the distance they rode, never DNF', () => {
    const { getByTestId, queryByText } = render(
      <RaceResults animate={false} winCondition="time" stopped={['b']}
        standings={[{ userId: 'a', placement: 1, distanceM: 900 }, { userId: 'b', placement: 2, distanceM: 412 }]}
        riders={{ a: { displayName: 'A' }, b: { displayName: 'B' } }} />
    );
    expect(queryByText('DNF')).toBeNull();
    expect(getByTestId('result-row-b').textContent).toContain('Stopped at 412 m');
    expect(getByTestId('race-results').textContent).not.toMatch(/DNF|Did Not Finish|False start/);
  });
  it('shows an overtime rider their REAL distance plus an OT tag, and an OT legend — never DNF', () => {
    const { getByTestId } = render(
      <RaceResults standings={standings} riders={riders} winCondition="distance" overtime={['user_2']} animate={false} />
    );
    const row = getByTestId('result-row-user_2');
    expect(row.textContent).toContain('2.71 km'); // real distance (2710 m), not masked
    expect(row.textContent).not.toContain('DNF');
    expect(row.textContent).toContain('OT');
    expect(getByTestId('race-results-legend').textContent).toContain('Still riding when the race closed');
  });
  it('stopped wins over overtime if a rider is somehow flagged both (defensive): Stopped at, no OT tag', () => {
    const { getByTestId } = render(
      <RaceResults standings={standings} riders={riders} winCondition="distance" stopped={['user_2']} overtime={['user_2']} animate={false} />
    );
    const row = getByTestId('result-row-user_2');
    expect(row.textContent).toContain('Stopped at 2.71 km');
    expect(row.querySelector('.race-results__ot-tag')).toBeNull();
  });
  it('renders no legend when there are no overtime riders', () => {
    const { queryByTestId } = render(<RaceResults standings={standings} riders={riders} winCondition="distance" />);
    expect(queryByTestId('race-results-legend')).toBeNull();
  });
  it('shows time for distance races and distance for time races', () => {
    const dist = render(<RaceResults standings={standings} riders={riders} winCondition="distance" animate={false} />);
    expect(within(dist.container).getByTestId('result-row-user_3').textContent).toContain('4:12'); // 252s
    const time = render(<RaceResults standings={standings} riders={riders} winCondition="time" animate={false} />);
    expect(within(time.container).getByTestId('result-row-user_3').textContent).toContain('3.00 km'); // 3000 m
  });
  it('crowns the time-race winner even though time races never stamp finishTimeS', () => {
    // Realistic time-race standings: NOBODY has a finishTimeS (the cap ends the race).
    const timeStandings = [
      { userId: 'user_3', placement: 1, finishTimeS: null, distanceM: 3000 },
      { userId: 'user_2', placement: 2, finishTimeS: null, distanceM: 2710 }
    ];
    const { container } = render(
      <RaceResults standings={timeStandings} riders={riders} winCondition="time" animate={false} />
    );
    const row = within(container).getByTestId('result-row-user_3').closest('li');
    expect(row.className).toContain('is-winner');
    expect(row.querySelector('.race-results__crown svg')).not.toBeNull();
  });
  it('renders an exit button that calls onExit', () => {
    const onExit = vi.fn();
    const { getByTestId } = render(
      <RaceResults standings={standings} riders={riders} winCondition="distance" animate={false} onExit={onExit} />
    );
    fireEvent.click(getByTestId('race-results-exit'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
  it('renders ladder notes when provided, nothing otherwise', () => {
    const { rerender } = render(<RaceResults standings={[]} riders={{}}
      ladderNotes={['User_3: 2nd this week — 0:04 behind Dad', 'Dad: Ladder lead this week!']} />);
    const box = screen.getByTestId('race-results-ladder');
    expect(box.textContent).toContain('User_3: 2nd this week');
    expect(box.textContent).toContain('Ladder lead');
    rerender(<RaceResults standings={[]} riders={{}} ladderNotes={[]} />);
    expect(screen.queryByTestId('race-results-ladder')).toBeNull();
  });
  it('shows the not-saved banner only when saveFailed', () => {
    const { rerender } = render(<RaceResults standings={[]} riders={{}} saveFailed />);
    expect(screen.getByTestId('race-results-save-failed').textContent).toContain('could not be saved');
    rerender(<RaceResults standings={[]} riders={{}} saveFailed={false} />);
    expect(screen.queryByTestId('race-results-save-failed')).toBeNull();
  });

  describe('Rematch / Exit / hold', () => {
    it('renders Rematch before Exit, primary, and calls its handler', () => {
      const onRematch = vi.fn();
      const { getByTestId } = render(<RaceResults standings={standings} riders={riders} animate={false} onRematch={onRematch} onExit={() => {}} />);
      const re = getByTestId('race-results-rematch');
      const ex = getByTestId('race-results-exit');
      expect(re.className).toContain('is-primary');
      expect(re.textContent).toContain('Rematch');
      expect(re.compareDocumentPosition(ex) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      fireEvent.click(re);
      expect(onRematch).toHaveBeenCalledTimes(1);
    });
    it('shows no Rematch without the prop', () => {
      const { queryByTestId } = render(<RaceResults standings={standings} riders={riders} animate={false} onExit={() => {}} />);
      expect(queryByTestId('race-results-rematch')).toBeNull();
      expect(queryByTestId('race-results-exit')).not.toBeNull();
    });
    it('fires onHold once for two pointer downs, and for a keydown only if first', () => {
      const onHold = vi.fn();
      const { getByTestId } = render(<RaceResults standings={standings} riders={riders} animate={false} onHold={onHold} />);
      fireEvent.pointerDown(getByTestId('race-results'));
      fireEvent.pointerDown(getByTestId('result-row-user_3'));
      expect(onHold).toHaveBeenCalledTimes(1);
      fireEvent.keyDown(getByTestId('race-results'), { key: 'a' });
      expect(onHold).toHaveBeenCalledTimes(1);
    });
    it('fires onHold on a first keydown', () => {
      const onHold = vi.fn();
      const { getByTestId } = render(<RaceResults standings={standings} riders={riders} animate={false} onHold={onHold} />);
      fireEvent.keyDown(getByTestId('race-results'), { key: 'a' });
      expect(onHold).toHaveBeenCalledTimes(1);
    });
  });

  describe('countdown', () => {
    it('shows Back to lobby for the whole dwell, aria-live off', () => {
      const { getByTestId } = render(<RaceResults standings={standings} riders={riders} animate={false} secondsLeft={30} />);
      const el = getByTestId('race-results-countdown');
      expect(el.textContent).toContain('Back to lobby in 30');
      expect(el.getAttribute('aria-live')).toBe('off');
    });
    it('shows nothing when secondsLeft is null (held)', () => {
      const { queryByTestId } = render(<RaceResults standings={standings} riders={riders} animate={false} secondsLeft={null} />);
      expect(queryByTestId('race-results-countdown')).toBeNull();
    });
  });

  describe('comparisons', () => {
    const cmps = { user_3: { isBest: true, vsBest: null, vsLast: null, better: true } };
    it('renders the comparison line under a live rider, emphasising First ride', () => {
      const { getByTestId } = render(<RaceResults standings={standings} riders={riders} winCondition="distance" animate={false} comparisons={cmps} />);
      const el = getByTestId('result-compare-user_3');
      expect(el.textContent).toContain('First ride at this length');
      expect(el.querySelector('.is-emphasis')).not.toBeNull();
    });
    it('emphasises New best and shows the delta', () => {
      const c = { user_3: { isBest: true, vsBest: -27, vsLast: null, better: true } };
      const { getByTestId } = render(<RaceResults standings={standings} riders={riders} winCondition="distance" animate={false} comparisons={c} />);
      const el = getByTestId('result-compare-user_3');
      expect(el.textContent).toContain('New best');
      expect(el.textContent).toContain('27 s faster');
      expect(el.querySelector('.is-emphasis').textContent).toBe('New best');
    });
    it('does not emphasise a plain delta line', () => {
      const c = { user_3: { isBest: false, vsBest: 27, vsLast: -12, better: false } };
      const { getByTestId } = render(<RaceResults standings={standings} riders={riders} winCondition="distance" animate={false} comparisons={c} />);
      const el = getByTestId('result-compare-user_3');
      expect(el.textContent).toContain('27 s off your best');
      expect(el.querySelector('.is-emphasis')).toBeNull();
    });
    it('renders nothing for an empty result, a ghost, a stopped rider, or no entry', () => {
      const ghostRiders = { ...riders, 'ghost:user_2:1': { displayName: 'User_2', isGhost: true } };
      const st = [standings[0], { userId: 'ghost:user_2:1', placement: 2, finishTimeS: 260, distanceM: 3000 },
        { userId: 'user_9', placement: 3, finishTimeS: null, distanceM: 100 }];
      const c = {
        user_3: { isBest: false, vsBest: null, vsLast: null, better: false },
        'ghost:user_2:1': cmps.user_3, user_9: cmps.user_3
      };
      const { queryByTestId } = render(<RaceResults standings={st} riders={{ ...ghostRiders, user_9: { displayName: 'U9' } }}
        winCondition="distance" stopped={['user_9']} animate={false} comparisons={c} />);
      expect(queryByTestId('result-compare-user_3')).toBeNull();
      expect(queryByTestId('result-compare-ghost:user_2:1')).toBeNull();
      expect(queryByTestId('result-compare-user_9')).toBeNull();
    });
  });

  describe('versus sentence', () => {
    const g = 'ghost:user_2:1';
    const gr = { user_3: { displayName: 'Rider A' }, [g]: { displayName: 'Rider B 👻', isGhost: true } };
    const mk = (a, b) => [{ userId: 'user_3', placement: a.p, finishTimeS: a.t, distanceM: a.d }, { userId: g, placement: b.p, finishTimeS: b.t, distanceM: b.d }];
    const r = (st, wc) => render(<RaceResults standings={st} riders={gr} winCondition={wc} animate={false} rivalId={g} rivalLabel="your best" />);
    it('distance win', () => {
      const { getByTestId } = r(mk({ p: 1, t: 240, d: 3000 }, { p: 2, t: 252, d: 3000 }), 'distance');
      expect(getByTestId('race-results-versus').textContent).toBe('You beat your best by 12 s');
    });
    it('distance loss', () => {
      const { getByTestId } = r(mk({ p: 2, t: 260, d: 3000 }, { p: 1, t: 252, d: 3000 }), 'distance');
      expect(getByTestId('race-results-versus').textContent).toBe('your best finished 8 s ahead');
    });
    it('distance with a missing finish time uses metres at the close', () => {
      const { getByTestId } = r(mk({ p: 1, t: null, d: 2500 }, { p: 2, t: 252, d: 2380 }), 'distance');
      expect(getByTestId('race-results-versus').textContent).toBe('You beat your best by 120 m');
      cleanup();
      const b = r(mk({ p: 2, t: null, d: 2380 }, { p: 1, t: null, d: 2500 }), 'distance');
      expect(b.getByTestId('race-results-versus').textContent).toBe('your best finished 120 m ahead');
    });
    it('time win and loss', () => {
      const w = r(mk({ p: 1, t: null, d: 3000 }, { p: 2, t: null, d: 2710 }), 'time');
      expect(w.getByTestId('race-results-versus').textContent).toBe('You went 290 m further than your best');
      cleanup();
      const l = r(mk({ p: 2, t: null, d: 2710 }, { p: 1, t: null, d: 3000 }), 'time');
      expect(l.getByTestId('race-results-versus').textContent).toBe('your best went 290 m further');
    });
    it('shows two rows, never a one-row podium, and no versus without a rival', () => {
      const { getAllByTestId } = r(mk({ p: 1, t: 240, d: 3000 }, { p: 2, t: 252, d: 3000 }), 'distance');
      expect(getAllByTestId('result-row')).toHaveLength(2);
      cleanup();
      const { queryByTestId } = render(<RaceResults standings={standings} riders={riders} animate={false} />);
      expect(queryByTestId('race-results-versus')).toBeNull();
    });
    it('skips the sentence when the rider is stopped', () => {
      const { queryByTestId } = render(<RaceResults standings={mk({ p: 2, t: null, d: 100 }, { p: 1, t: 252, d: 3000 })} riders={gr}
        stopped={['user_3']} winCondition="distance" animate={false} rivalId={g} rivalLabel="par pace" />);
      expect(queryByTestId('race-results-versus')).toBeNull();
    });
  });

  describe('icons, no emoji', () => {
    const EMOJI = /\p{Extended_Pictographic}/u;
    it('has no emoji, including a ghost row with a trailing ghost emoji', () => {
      const g = 'ghost:user_2:1';
      const { getByTestId, container } = render(<RaceResults animate={false} winCondition="distance" rivalId={g} rivalLabel="your best"
        standings={[{ userId: 'user_3', placement: 1, finishTimeS: 240, distanceM: 3000 }, { userId: g, placement: 2, finishTimeS: 252, distanceM: 3000 }]}
        riders={{ user_3: { displayName: 'Rider A' }, [g]: { displayName: 'Rider B 👻', isGhost: true } }} />);
      expect(getByTestId('race-results').textContent).not.toMatch(EMOJI);
      expect(getByTestId(`result-row-${g}`).textContent).toContain('Rider B');
      expect(container.querySelector('.race-results__ghost-mark svg')).not.toBeNull();
      expect(container.querySelectorAll('.race-results__placement svg').length).toBeGreaterThanOrEqual(2);
    });
    it('renders a medal for places 1-3 and a ringed number for the rest', () => {
      const st = [1, 2, 3, 4].map((p) => ({ userId: `u${p}`, placement: p, finishTimeS: 100 + p, distanceM: 1000 }));
      const rs = Object.fromEntries(st.map((s) => [s.userId, { displayName: `N${s.userId}` }]));
      const { getByTestId } = render(<RaceResults standings={st} riders={rs} animate={false} />);
      expect(getByTestId('result-row-u1').querySelector('[data-medal="1"]')).not.toBeNull();
      expect(getByTestId('result-row-u3').querySelector('[data-medal="3"]')).not.toBeNull();
      expect(getByTestId('result-row-u4').querySelector('[data-medal="4"]').textContent).toBe('4');
    });
  });

  describe('fit rules', () => {
    const many = (n) => {
      const st = Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, placement: i + 1, finishTimeS: 100 + i, distanceM: 1000 }));
      const rs = Object.fromEntries(st.map((s) => [s.userId, { displayName: `N${s.userId}`, lapSplits: [30] }]));
      return { st, rs };
    };
    it('is dense at 5+ rows and not at 4; hides splits at 4+ rows but shows them at 2', () => {
      const four = many(4);
      const a = render(<RaceResults standings={four.st} riders={four.rs} lapLengthM={500} animate={false} />);
      expect(a.getByTestId('race-results').className).not.toContain('race-results--dense');
      a.unmount();
      const five = many(5);
      const b = render(<RaceResults standings={five.st} riders={five.rs} lapLengthM={500} animate={false} />);
      expect(b.getByTestId('race-results').className).toContain('race-results--dense');
      expect(b.queryByTestId('race-results-splits')).toBeNull();
      b.unmount();
      const two = many(2);
      const c = render(<RaceResults standings={two.st} riders={two.rs} lapLengthM={500} animate={false} />);
      expect(c.queryByTestId('race-results-splits')).not.toBeNull();
    });
  });
});
