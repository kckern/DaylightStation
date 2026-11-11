import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import DistanceChart from "./DistanceChart.jsx";

// viewBox geometry mirrors the component (fixed): H=200, PAD_T=22, PAD_B=22.
const TOP_Y = 22;      // a rider at the goal maps here (top inset)
const FLOOR_Y = 178;   // H - PAD_B (bottom axis)

const yOf = (line) => parseFloat(line.getAttribute('points').trim().split(',')[1]);
const xsOf = (line) => line.getAttribute('points').trim().split(' ').map((p) => parseFloat(p.split(',')[0]));

describe('DistanceChart panel', () => {
  it('renders one lane line per rider', () => {
    const { container } = render(<DistanceChart
      riderIds={['a', 'b']}
      riders={{ a: { displayName: 'A', cumulativeDistanceM: 1500, distanceSeries: [500, 1000, 1500] }, b: { displayName: 'B', cumulativeDistanceM: 900, distanceSeries: [300, 600, 900] } }}
      riderLive={{ a: {}, b: {} }}
      winCondition="distance" goalM={3000}
    />);
    expect(container.querySelectorAll('[data-testid="race-line"]').length).toBe(2);
  });

  // ── Fixed Y to the goal (distance races) ──────────────────────────────────
  it('maps a rider AT the goal to the top edge from the very first tick (fixed Y)', () => {
    const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 1000, distanceSeries: [1000] } };
    const { container } = render(
      <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
        winCondition="distance" goalM={1000} elapsedS={1} />
    );
    const y = yOf(container.querySelector('[data-testid="race-line"]'));
    expect(y).toBeLessThanOrEqual(TOP_Y + 2); // pinned at the top inset, tick 1
  });
  it('maps a rider at half the goal to the vertical middle (fixed linear Y)', () => {
    const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 1500, distanceSeries: [1500] } };
    const { container } = render(
      <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
        winCondition="distance" goalM={3000} elapsedS={1} />
    );
    const y = yOf(container.querySelector('[data-testid="race-line"]'));
    const mid = (TOP_Y + FLOOR_Y) / 2;
    expect(Math.abs(y - mid)).toBeLessThan(4); // ~50% up, no Y zoom, from tick 1
  });
  it('keeps the Y domain FIXED — an early leader does NOT get zoomed to mid-height', () => {
    // 240 m of a 5 km goal → sits near the floor (climbing), never rescaled up.
    const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 240, distanceSeries: [240] } };
    const { container } = render(
      <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
        winCondition="distance" goalM={5000} elapsedS={5} />
    );
    const y = yOf(container.querySelector('[data-testid="race-line"]'));
    // 240/5000 = 4.8% up → y ≈ FLOOR_Y - 7.5, close to the bottom (NOT mid-chart).
    expect(y).toBeGreaterThan(FLOOR_Y - 14);
  });

  // ── Goal line + label always visible (distance races) ─────────────────────
  it('shows the goal line + labelled target from tick 1 of a distance race', () => {
    const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 10, distanceSeries: [10] } };
    const { container, getByTestId } = render(
      <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
        winCondition="distance" goalM={2500} elapsedS={1} />
    );
    const goal = container.querySelector('.cycle-race-screen__goal');
    expect(goal).toBeTruthy();
    expect(parseFloat(goal.getAttribute('y1'))).toBeLessThanOrEqual(TOP_Y + 2); // line at top
    expect(getByTestId('chart-goal-label').textContent).toContain('2.50 km');
  });
  it('omits the goal line for a TIME race (no fixed finish)', () => {
    const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 500, distanceSeries: [500] } };
    const { container, queryByTestId } = render(
      <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
        winCondition="time" goalM={3000} elapsedS={5} />
    );
    expect(container.querySelector('.cycle-race-screen__goal')).toBeNull();
    expect(queryByTestId('chart-goal-label')).toBeNull();
  });

  // ── Axis labels (HTML overlay) ────────────────────────────────────────────
  it('renders 2-3 distance Y labels and m:ss X labels', () => {
    const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 600, distanceSeries: [600] } };
    const { getByTestId } = render(
      <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
        winCondition="distance" goalM={1000} elapsedS={40} />
    );
    const y = getByTestId('chart-axis-y');
    const x = getByTestId('chart-axis-x');
    const yLabels = y.querySelectorAll('.cg-chart__axis-label');
    const xLabels = x.querySelectorAll('.cg-chart__axis-label');
    expect(yLabels.length).toBeGreaterThanOrEqual(2);
    expect(yLabels.length).toBeLessThanOrEqual(3);
    expect(y.textContent).toMatch(/\d+\s?(m|km)/); // distance values
    expect(xLabels.length).toBeGreaterThanOrEqual(2);
    expect(x.textContent).toMatch(/\d+:\d\d/);      // m:ss
  });

  // ── Continuous window — no 2× snap between consecutive ticks ───────────────
  // Distance races keep the continuous x zoom (time races show the whole race).
  it('grows the X window continuously (no 2× jump) across consecutive ticks in a distance race', () => {
    const tipX = (elapsedS) => {
      const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 40, distanceSeries: [10, 40] } };
      const { container } = render(
        <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
          winCondition="distance" goalM={3000} elapsedS={elapsedS} />
      );
      return Math.max(...xsOf(container.querySelector('[data-testid="race-line"]')));
    };
    // Bracket the OLD stepped threshold (elapsed 18 = 0.9·20 doubled the window,
    // halving every x position). Continuous growth barely moves them.
    const a = tipX(17);
    const b = tipX(18);
    expect(b / a).toBeGreaterThan(0.75); // old 2× step would put this near 0.5
    expect(b / a).toBeLessThan(1.3);
  });

  // ── A chart with a target (time races span the whole race) ────────────────
  const labelsOf = (el) => [...el.querySelectorAll('.cg-chart__axis-label')];
  const toMetres = (text) => {
    const m = String(text).match(/([\d.]+)\s*(km|m)/);
    return m ? parseFloat(m[1]) * (m[2] === 'km' ? 1000 : 1) : NaN;
  };
  it('a time race shows the whole race on the x axis from the first frame', () => {
    const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 300, distanceSeries: Array.from({ length: 60 }, (_, i) => (i + 1) * 5) } };
    const { getByTestId } = render(
      <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
        winCondition="time" timeCapS={300} elapsedS={60} />
    );
    const x = labelsOf(getByTestId('chart-axis-x')).map((l) => l.textContent);
    expect(x[0]).toBe('0:00');
    expect(x[x.length - 1]).toBe('5:00');
    // The line covers the first fifth of the plot, not ~85% of it.
    const tip = Math.max(...xsOf(getByTestId('distance-chart').querySelector('[data-testid="race-line"]')));
    expect(tip).toBeLessThan(16 + 548 * 0.25);
  });
  it('axis labels are evenly spaced and include both ends', () => {
    const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 600, distanceSeries: [200, 400, 600] } };
    const { getByTestId } = render(
      <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
        winCondition="time" timeCapS={420} elapsedS={140} />
    );
    const xs = labelsOf(getByTestId('chart-axis-x'));
    expect(xs.map((l) => l.textContent)).toEqual(['0:00', '3:30', '7:00']);
    const lefts = xs.map((l) => parseFloat(l.style.left));
    expect(lefts[1] - lefts[0]).toBeCloseTo(lefts[2] - lefts[1], 6);
    const ys = labelsOf(getByTestId('chart-axis-y'));
    const tops = ys.map((l) => parseFloat(l.style.top));
    expect(ys.length).toBe(3);
    expect(tops[0] - tops[1]).toBeCloseTo(tops[1] - tops[2], 6);
    expect(ys[0].textContent).toBe('0 m');
  });

  // Solo: the rival's whole recording is drawn ahead of the rider.
  const RIVAL = 'ghost:par:par';
  const rivalRec = Array.from({ length: 60 }, (_, i) => (i + 1) * 25); // 5 m/s at 5 s, to 1500 m at 300 s
  const soloRiders = (over = {}) => ({
    a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 120, distanceSeries: Array.from({ length: 20 }, (_, i) => (i + 1) * 6) },
    [RIVAL]: {
      userId: RIVAL, displayName: 'Par', isGhost: true, cumulativeDistanceM: 100,
      distanceSeries: Array.from({ length: 20 }, (_, i) => (i + 1) * 5),
      ghostRecordedSeries: rivalRec, ghostIntervalS: 5, ...over
    }
  });
  it('solo: draws the rival trace past the rider\'s last point; not drawn outside solo', () => {
    const solo = render(
      <DistanceChart riderIds={['a', RIVAL]} riders={soloRiders()} riderLive={{ a: {}, [RIVAL]: {} }}
        winCondition="time" timeCapS={300} elapsedS={20} mode="solo" />
    );
    const trace = solo.getByTestId('rival-trace');
    const riderTip = Math.max(...xsOf(solo.container.querySelectorAll('[data-testid="race-line"]')[0]));
    expect(Math.max(...xsOf(trace))).toBeGreaterThan(riderTip + 300);
    expect(trace.getAttribute('stroke-dasharray')).toBeTruthy();
    // The rival's live marker (its replayed lane and tag) still shows.
    expect(solo.container.querySelectorAll('[data-testid="race-line"]').length).toBe(2);
    expect(solo.getAllByTestId('chart-tag').length).toBe(2);
    solo.unmount();
    const side = render(
      <DistanceChart riderIds={['a', RIVAL]} riders={soloRiders()} riderLive={{ a: {}, [RIVAL]: {} }}
        winCondition="time" timeCapS={300} elapsedS={20} mode="sidebar" />
    );
    expect(side.queryByTestId('rival-trace')).toBeNull();
  });
  it('solo time race: the y window reaches the rival\'s final distance from the start', () => {
    const { getByTestId } = render(
      <DistanceChart riderIds={['a', RIVAL]} riders={soloRiders()} riderLive={{ a: {}, [RIVAL]: {} }}
        winCondition="time" timeCapS={300} elapsedS={20} mode="solo" />
    );
    const top = labelsOf(getByTestId('chart-axis-y')).map((l) => toMetres(l.textContent));
    expect(Math.max(...top)).toBeGreaterThanOrEqual(1500);
    // The trace's end sits inside the plot, not clamped against the top edge.
    const ys = getByTestId('rival-trace').getAttribute('points').trim().split(' ').map((p) => parseFloat(p.split(',')[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(22 - 0.05);
  });
  it('solo distance race: the trace ends on the goal line at the rival\'s finish time', () => {
    // Goal 600 m: the rival crosses at 120 s. Elapsed 110 s → window 129.4 s.
    const riders = soloRiders();
    const { getByTestId } = render(
      <DistanceChart riderIds={['a', RIVAL]} riders={riders} riderLive={{ a: {}, [RIVAL]: {} }}
        winCondition="distance" goalM={600} elapsedS={110} mode="solo" />
    );
    const pts = getByTestId('rival-trace').getAttribute('points').trim().split(' ').map((p) => p.split(',').map(Number));
    const [lx, ly] = pts[pts.length - 1];
    expect(ly).toBeCloseTo(22, 0); // the goal sits at the top of a distance race
    const winT = 180; // niceCeilTime(110 / 0.85 = 129.4): the open time axis snaps to whole minutes
    expect(lx).toBeCloseTo(16 + (120 / winT) * 548, 0);
  });
  it('solo never switches to the log scale, even with the rival bunched', () => {
    const riders = soloRiders({ cumulativeDistanceM: 119, distanceSeries: Array.from({ length: 20 }, (_, i) => (i + 1) * 6 - 1) });
    const { queryByTestId } = render(
      <DistanceChart riderIds={['a', RIVAL]} riders={riders} riderLive={{ a: {}, [RIVAL]: {} }}
        winCondition="time" timeCapS={300} elapsedS={20} mode="solo" />
    );
    expect(queryByTestId('chart-log-chip')).toBeNull();
  });

  // ── Log crowding mode (time races only) + chip ────────────────────────────
  it('switches to leader-anchored log + shows the "zoomed on leaders" chip when a time race crowds', () => {
    const riders = {
      lead:   { displayName: 'L', cumulativeDistanceM: 2500, distanceSeries: [2500] },
      second: { displayName: 'S', cumulativeDistanceM: 2480, distanceSeries: [2480] },
      slow:   { displayName: 'W', cumulativeDistanceM: 500,  distanceSeries: [500]  },
    };
    const { container, getByTestId } = render(
      <DistanceChart riderIds={['lead', 'second', 'slow']} riders={riders}
        riderLive={{ lead: {}, second: {}, slow: {} }}
        winCondition="time" goalM={5000} elapsedS={1} />
    );
    expect(getByTestId('chart-log-chip')).toBeTruthy();
    // Zero-anchored log keeps the slow rider well off the bottom axis.
    const lines = container.querySelectorAll('[data-testid="race-line"]');
    const slowY = yOf(lines[2]);
    expect(slowY).toBeLessThan(FLOOR_Y - 12);
  });
  // 2026-07-02 fix: the chip used to be absolutely positioned at the plot's
  // top-right corner — exactly where a leader's terminus tag sits in log mode
  // (leader gap=0 clamps to the layoutTags floor, ~11% from the top, and their
  // tag drifts rightward toward the current-time edge as the race runs) —
  // visually colliding with it. It now lives in the header row, structurally
  // outside the plot overlay, so it can never overlap chart content.
  it('renders the log-mode chip inside the header, not the plot overlay (no tag/marker collision)', () => {
    const riders = {
      lead:   { displayName: 'L', cumulativeDistanceM: 2500, distanceSeries: [2500] },
      second: { displayName: 'S', cumulativeDistanceM: 2480, distanceSeries: [2480] },
    };
    const { getByTestId } = render(
      <DistanceChart riderIds={['lead', 'second']} riders={riders}
        riderLive={{ lead: {}, second: {} }} winCondition="time" goalM={5000} elapsedS={1} />
    );
    const header = getByTestId('chart-header');
    const chip = getByTestId('chart-log-chip');
    expect(header.contains(chip)).toBe(true);
  });
  it('never enters log mode for a distance race (fixed linear scale, no chip)', () => {
    const riders = {
      lead:   { displayName: 'L', cumulativeDistanceM: 2500, distanceSeries: [2500] },
      second: { displayName: 'S', cumulativeDistanceM: 2480, distanceSeries: [2480] },
    };
    const { queryByTestId } = render(
      <DistanceChart riderIds={['lead', 'second']} riders={riders}
        riderLive={{ lead: {}, second: {} }} winCondition="distance" goalM={5000} elapsedS={1} />
    );
    expect(queryByTestId('chart-log-chip')).toBeNull();
  });

  // ── Terminus tags: avatar + gap-behind-leader ─────────────────────────────
  it('renders a rider avatar and gap-behind-leader on each terminus tag', () => {
    const riders = {
      a: { userId: 'alice', displayName: 'Alice', cumulativeDistanceM: 1500, distanceSeries: [1500] },
      b: { userId: 'bob', displayName: 'Bob', cumulativeDistanceM: 900, distanceSeries: [900] },
    };
    const { getAllByTestId } = render(
      <DistanceChart riderIds={['a', 'b']} riders={riders} riderLive={{ a: {}, b: {} }}
        winCondition="distance" goalM={3000} elapsedS={1} />
    );
    const avatars = getAllByTestId('chart-tag-avatar');
    expect(avatars.length).toBe(2);
    expect(avatars[0].getAttribute('src')).toContain('/api/v1/static/img/users/');
    const gaps = getAllByTestId('chart-tag-gap').map((g) => g.textContent);
    expect(gaps).toContain('1.50 km');   // leader shows total distance
    expect(gaps).toContain('−600 m');    // trailer shows gap behind leader
  });
  // ── Parked riders (idle past the park window) leave the framing ───────────
  it('a parked rider ahead on distance is not the leader the gaps are measured from', () => {
    const riders = {
      a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 900, distanceSeries: [900] },
      b: { userId: 'b', displayName: 'B', cumulativeDistanceM: 500, distanceSeries: [500] },
      c: { userId: 'c', displayName: 'C', cumulativeDistanceM: 400, distanceSeries: [400] },
    };
    const { getAllByTestId } = render(
      <DistanceChart riderIds={['a', 'b', 'c']} riders={riders}
        riderLive={{ a: { parked: true }, b: {}, c: {} }}
        winCondition="distance" goalM={3000} elapsedS={1} />
    );
    const tags = getAllByTestId('chart-tag');
    const gaps = getAllByTestId('chart-tag-gap').map((g) => g.textContent);
    expect(gaps).toContain('500 m');   // b leads the un-parked field
    expect(gaps).toContain('−100 m');  // c is measured from b, not from parked a
    expect(gaps).not.toContain('−500 m');
    // The parked rider's tag keeps their own distance, dimmed.
    const parkedTag = tags.find((t) => t.textContent.includes('900 m'));
    expect(parkedTag.className).toContain('is-parked');
    expect(tags.filter((t) => t.className.includes('is-leader'))).toHaveLength(1);
    expect(tags.find((t) => t.className.includes('is-leader')).className).not.toContain('is-parked');
  });

  it('draws a parked lane at reduced opacity', () => {
    const riders = {
      a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 900, distanceSeries: [900] },
      b: { userId: 'b', displayName: 'B', cumulativeDistanceM: 500, distanceSeries: [500] },
    };
    const { container } = render(
      <DistanceChart riderIds={['a', 'b']} riders={riders} riderLive={{ a: { parked: true }, b: {} }}
        winCondition="distance" goalM={3000} elapsedS={1} />
    );
    const [lineA, lineB] = container.querySelectorAll('[data-testid="race-line"]');
    expect(Number(lineA.getAttribute('opacity'))).toBeCloseTo(0.4);
    expect(Number(lineB.getAttribute('opacity'))).toBe(1);
  });

  it('a parked rider far ahead does not stretch a time race window or trip the log scale', () => {
    const riders = {
      far:  { displayName: 'F', cumulativeDistanceM: 2000, distanceSeries: [2000] },
      lead: { displayName: 'L', cumulativeDistanceM: 100,  distanceSeries: [100] },
      next: { displayName: 'N', cumulativeDistanceM: 60,   distanceSeries: [60] },
    };
    const { queryByTestId, getByTestId } = render(
      <DistanceChart riderIds={['far', 'lead', 'next']} riders={riders}
        riderLive={{ far: { parked: true }, lead: {}, next: {} }}
        winCondition="time" goalM={3000} elapsedS={10} />
    );
    expect(queryByTestId('chart-log-chip')).toBeNull();
    expect(getByTestId('chart-axis-y').textContent).not.toMatch(/km/);
  });

  it('a parked rider bunched with an active one does not trip the log scale', () => {
    // Without the parked rider the two active riders are 80 m apart in a 150 m
    // window: linear. Counting the parked rider 2 m off the leader would read
    // as a crowded field and flip to the log scale.
    const riders = {
      lead:   { displayName: 'L', cumulativeDistanceM: 100, distanceSeries: [100] },
      parked: { displayName: 'P', cumulativeDistanceM: 98,  distanceSeries: [98] },
      next:   { displayName: 'N', cumulativeDistanceM: 20,  distanceSeries: [20] },
    };
    const { queryByTestId } = render(
      <DistanceChart riderIds={['lead', 'parked', 'next']} riders={riders}
        riderLive={{ lead: {}, parked: { parked: true }, next: {} }}
        winCondition="time" goalM={3000} elapsedS={10} />
    );
    expect(queryByTestId('chart-log-chip')).toBeNull();
  });

  it('ghost-treats the terminus avatar for a ghost rider', () => {
    const riders = {
      me:    { userId: 'me', displayName: 'Me', cumulativeDistanceM: 1200, distanceSeries: [1200] },
      ghost: { userId: 'ghost:R1:pb', displayName: 'PB', cumulativeDistanceM: 1000, distanceSeries: [1000], isGhost: true },
    };
    const { container } = render(
      <DistanceChart riderIds={['me', 'ghost']} riders={riders} riderLive={{ me: {}, ghost: {} }}
        winCondition="distance" goalM={3000} elapsedS={1} />
    );
    const ghostTag = [...container.querySelectorAll('.cycle-race-screen__tag')]
      .find((t) => t.className.includes('is-ghost'));
    expect(ghostTag).toBeTruthy();
    expect(ghostTag.querySelector('.cg-ghost')).toBeTruthy();
    // ghost id resolves to the source user for the avatar URL (no 404 nesting).
    expect(ghostTag.querySelector('img').getAttribute('src')).toContain('/api/v1/static/img/users/pb');
  });

  // ── Degenerate / empty series ─────────────────────────────────────────────
  it('renders without crashing before any rider has moved (empty + zero series)', () => {
    const riders = {
      a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 0, distanceSeries: [] },
      b: { userId: 'b', displayName: 'B', cumulativeDistanceM: 0, distanceSeries: [0, 0, 0] },
    };
    const { getByTestId } = render(
      <DistanceChart riderIds={['a', 'b']} riders={riders} riderLive={{ a: {}, b: {} }}
        winCondition="distance" goalM={3000} elapsedS={0} />
    );
    expect(getByTestId('distance-chart')).toBeTruthy();
    // goal line still present (fixed target visible before movement)
    expect(getByTestId('chart-goal-label')).toBeTruthy();
  });
  it('renders with an empty field (no riders) without crashing', () => {
    const { getByTestId } = render(
      <DistanceChart riderIds={[]} riders={{}} riderLive={{}}
        winCondition="time" goalM={3000} elapsedS={0} />
    );
    expect(getByTestId('distance-chart')).toBeTruthy();
  });

  // ── Preserved behaviours from T6 ──────────────────────────────────────────
  it('freezes a finished rider’s lane at the goal-crossing time (does not crawl right)', () => {
    const aSeries = [400, 700, 950, 1000, 1000, 1000, 1000];
    const bSeries = [200, 350, 480, 540, 580, 600, 600];
    const riders = {
      a: { displayName: 'A', cumulativeDistanceM: 1000, finishTimeS: 3, distanceSeries: aSeries },
      b: { displayName: 'B', cumulativeDistanceM: 600, distanceSeries: bSeries },
    };
    const { container } = render(
      <DistanceChart riderIds={['a', 'b']} riders={riders}
        riderLive={{ a: {}, b: {} }} winCondition="distance" goalM={1000} elapsedS={6} />
    );
    const lines = container.querySelectorAll('[data-testid="race-line"]');
    const aXs = xsOf(lines[0]);
    const bXs = xsOf(lines[1]);
    expect(aXs.length).toBe(4);
    expect(Math.max(...aXs)).toBeLessThan(Math.max(...bXs));
  });
  it('decimates a long series so the vertex count stays bounded (~600/rider)', () => {
    const series = Array.from({ length: 2000 }, (_, i) => (i + 1) * 2);
    const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 4000, distanceSeries: series } };
    const { container } = render(
      <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
        winCondition="time" goalM={5000} elapsedS={1999} />
    );
    const line = container.querySelector('[data-testid="race-line"]');
    const pts = line.getAttribute('points').trim().split(' ');
    expect(pts.length).toBeLessThanOrEqual(601);
    expect(pts.length).toBeGreaterThan(300);
  });
  it('renders a header strip with the clock (≥2.4rem hero) and time-race leader copy', () => {
    const { getByTestId } = render(
      <DistanceChart riderIds={['a']} riders={{ a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 50, distanceSeries: [50] } }}
        riderLive={{ a: {} }} winCondition="time" goalM={3000} elapsedS={5}
        clockSeconds={55} maxDistanceM={50} />
    );
    const hdr = getByTestId('chart-header');
    expect(hdr.textContent).toContain('0:55');
    expect(hdr.textContent.toLowerCase()).toContain('time left');
    expect(hdr.textContent).toContain('Leader'); // "Leader 50 m"
  });

  // ── 2026-07-02 fix: tags/markers reproject through the live eased window ──
  // every animation frame, instead of lerping between two STATIC per-tick
  // percentage snapshots (each computed under a DIFFERENT tick's window) —
  // which could only agree with the line at the tick boundaries (f=0/1) and
  // would drift apart from it mid-transition. Drives the shared motion clock
  // by hand (fake rAF + a controllable performance.now) to a mid-frame
  // fraction and asserts the tag sits EXACTLY on its own line's tip.
  describe('motion-clock frame sync (tag/line desync fix)', () => {
    let frames; let seq; let nowMs; let nowSpy;

    const flush = () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((cb) => cb(nowMs));
    };
    // Last (x,y) pair of an SVG polyline's `points` attribute, as % of the
    // (fixed, 600x200) viewBox — the same units chart-tag left/top use.
    const tipPct = (line) => {
      const pts = line.getAttribute('points').trim().split(' ').filter(Boolean);
      const [x, y] = pts[pts.length - 1].split(',').map(Number);
      return { leftPct: (x / 600) * 100, topPct: (y / 200) * 100 };
    };

    it('keeps a terminus tag glued to its own line tip mid-frame during an active window change', () => {
      frames = new Map(); seq = 0; nowMs = 0;
      vi.stubGlobal('requestAnimationFrame', (cb) => { seq += 1; frames.set(seq, cb); return seq; });
      vi.stubGlobal('cancelAnimationFrame', (id) => { frames.delete(id); });
      nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
      try {
        const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 100, distanceSeries: [100] } };
        const { container, rerender } = render(
          <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
            winCondition="distance" goalM={1000} elapsedS={1} />
        );
        // Let tick 1's (trivial, single-sample) motion land before advancing.
        nowMs = 1000; flush();

        // Tick 2: a big jump in elapsed time — the T auto-zoom window grows
        // between ticks, so mid-frame the line/tag must reproject under an
        // ACTIVELY EASING window, not just a newly-arrived data point.
        const riders2 = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 900, distanceSeries: [100, 900] } };
        rerender(
          <DistanceChart riderIds={['a']} riders={riders2} riderLive={{ a: {} }}
            winCondition="distance" goalM={1000} elapsedS={25} />
        );

        // Mid-transition: fraction 0.5 through the 1000ms tick interval.
        nowMs = 1500; flush();

        const line = container.querySelector('[data-testid="race-line"]');
        const tag = container.querySelector('[data-testid="chart-tag"]');
        const lineTip = tipPct(line);
        const tagLeftPct = parseFloat(tag.style.left);
        const tagTopPct = parseFloat(tag.style.top);

        expect(tagLeftPct).toBeCloseTo(lineTip.leftPct, 1);
        expect(tagTopPct).toBeCloseTo(lineTip.topPct, 1);
      } finally {
        vi.unstubAllGlobals();
        nowSpy.mockRestore();
      }
    });
  });
});

describe('DistanceChart reduced motion', () => {
  let frames; let seq; let nowMs; let nowSpy;
  const flush = () => { const p = [...frames.values()]; frames.clear(); p.forEach((cb) => cb(nowMs)); };
  const pointsAt = (reduce) => {
    frames = new Map(); seq = 0; nowMs = 0;
    vi.stubGlobal('requestAnimationFrame', (cb) => { seq += 1; frames.set(seq, cb); return seq; });
    vi.stubGlobal('cancelAnimationFrame', (id) => { frames.delete(id); });
    nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    window.matchMedia = vi.fn(() => ({ matches: reduce }));
    try {
      const mk = (series, el) => (
        <DistanceChart riderIds={['a']} riders={{ a: { userId: 'a', displayName: 'A', cumulativeDistanceM: series[series.length - 1], distanceSeries: series } }}
          riderLive={{ a: {} }} winCondition="distance" goalM={1000} elapsedS={el} />);
      const { container, rerender } = render(mk([100], 1));
      nowMs = 1000; flush();
      rerender(mk([100, 900], 25));
      nowMs = 1500; flush(); // half-way through the tick
      return container.querySelector('[data-testid="race-line"]').getAttribute('points');
    } finally {
      vi.unstubAllGlobals(); nowSpy.mockRestore(); delete window.matchMedia;
    }
  };
  it('jumps to the current tick mid-frame when reduced motion is on, and eases when it is off', () => {
    const eased = pointsAt(false);
    const jumped = pointsAt(true);
    expect(jumped).not.toBe(eased);
    // Reduced: the half-way frame already equals the end-of-tick frame.
    frames = new Map(); // (fresh run for the end-of-tick reference)
    const endOfTick = (() => {
      seq = 0; nowMs = 0;
      vi.stubGlobal('requestAnimationFrame', (cb) => { seq += 1; frames.set(seq, cb); return seq; });
      vi.stubGlobal('cancelAnimationFrame', (id) => { frames.delete(id); });
      nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
      window.matchMedia = vi.fn(() => ({ matches: false }));
      try {
        const mk = (series, el) => (
          <DistanceChart riderIds={['a']} riders={{ a: { userId: 'a', displayName: 'A', cumulativeDistanceM: series[series.length - 1], distanceSeries: series } }}
            riderLive={{ a: {} }} winCondition="distance" goalM={1000} elapsedS={el} />);
        const { container, rerender } = render(mk([100], 1));
        nowMs = 1000; flush();
        rerender(mk([100, 900], 25));
        nowMs = 2100; flush();
        return container.querySelector('[data-testid="race-line"]').getAttribute('points');
      } finally { vi.unstubAllGlobals(); nowSpy.mockRestore(); delete window.matchMedia; }
    })();
    expect(jumped).toBe(endOfTick);
  });
});

describe('DistanceChart round axis labels', () => {
  const labelTexts = (node) => [...node.querySelectorAll('.cg-chart__axis-label')].map((l) => l.textContent);
  it('a time race snaps its y window so the labels are round (0 / 300 m / 600 m)', () => {
    const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 457, distanceSeries: [0, 200, 457] } };
    const { getByTestId } = render(
      <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
        winCondition="time" timeCapS={300} elapsedS={128} />
    );
    expect(labelTexts(getByTestId('chart-axis-y'))).toEqual(['0 m', '300 m', '600 m']);
  });
  it('a distance race with an open time axis snaps its x labels to whole minutes', () => {
    const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 800, distanceSeries: [0, 400, 800] } };
    const { getByTestId } = render(
      <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
        winCondition="distance" goalM={1500} elapsedS={207} />
    );
    // 207 s / 0.85 = 243.5 s -> 300 s
    expect(labelTexts(getByTestId('chart-axis-x'))).toEqual(['0:00', '2:30', '5:00']);
  });
});
