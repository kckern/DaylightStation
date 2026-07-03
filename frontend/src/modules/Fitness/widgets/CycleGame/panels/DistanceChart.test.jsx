import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import DistanceChart from './DistanceChart.jsx';

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
  it('grows the X window continuously (no 2× jump) across consecutive ticks in a time race', () => {
    const rightmostGridX = (elapsedS) => {
      const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 40, distanceSeries: [40] } };
      const { container } = render(
        <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
          winCondition="time" goalM={3000} elapsedS={elapsedS} />
      );
      const xs = [...container.querySelectorAll('.cycle-race-screen__gridline--x')]
        .map((l) => parseFloat(l.getAttribute('x1')));
      return Math.max(...xs);
    };
    // Bracket the OLD stepped threshold (elapsed 18 = 0.9·20 doubled the window,
    // halving every x-gridline position). Continuous growth barely moves them.
    const a = rightmostGridX(17);
    const b = rightmostGridX(18);
    expect(b / a).toBeGreaterThan(0.75); // old 2× step would put this near 0.5
    expect(b / a).toBeLessThan(1.3);
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
