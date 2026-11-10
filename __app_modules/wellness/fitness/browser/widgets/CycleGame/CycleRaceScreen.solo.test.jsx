import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import CycleRaceScreen from "./CycleRaceScreen.jsx";

// One live rider racing their pace rival (a ghost). The rival's recording is
// 5 m/s sampled every 5 s; the race ticks at 1 Hz, so at 20 s the rival has
// replayed 100 m. The rider is at 120 m: the rival reaches 120 m at 24 s, so
// the rider is 4 s ahead (and 20 m).
const RIVAL_ID = 'ghost:par:par';
const recorded = Array.from({ length: 60 }, (_, i) => (i + 1) * 25); // 25 m every 5 s, to 1500 m at 300 s
const replayed = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);
const riderSeries = Array.from({ length: 20 }, (_, i) => (i + 1) * 6);

function soloProps(over = {}) {
  return {
    winCondition: 'time',
    timeCapS: 300,
    elapsedS: 20,
    rivalKind: 'par',
    riders: {
      rider_a: { userId: 'rider_a', displayName: 'Rider A', cumulativeDistanceM: 120, distanceSeries: riderSeries, isGhost: false },
      [RIVAL_ID]: {
        userId: RIVAL_ID, displayName: 'Par', cumulativeDistanceM: 100, distanceSeries: replayed, isGhost: true,
        ghostRecordedSeries: recorded, ghostIntervalS: 5
      }
    },
    riderLive: {
      rider_a: { rpm: 80, placement: 1, isLeader: true },
      [RIVAL_ID]: { rpm: 75, placement: 2 }
    },
    ...over
  };
}

describe('CycleRaceScreen — solo layout', () => {
  it('one live rider and a rival: solo layout with the pace panel and no standings tower', () => {
    const { getByTestId, queryByTestId } = render(<CycleRaceScreen {...soloProps()} />);
    expect(getByTestId('race-layout').dataset.mode).toBe('solo');
    expect(getByTestId('pace-delta')).toBeInTheDocument();
    expect(queryByTestId('standings-tower')).toBeNull();
  });

  it('the pace panel reads the hand-computed gap against the rival\'s whole recording', () => {
    const { getByTestId } = render(<CycleRaceScreen {...soloProps()} />);
    const pace = getByTestId('pace-delta');
    expect(pace.className).toContain('is-ahead');
    expect(pace.querySelector('.cg-pace__headline').textContent).toBe('4 s');
    expect(pace.textContent).toMatch(/ahead/);
    expect(pace.textContent).toMatch(/vs par pace/);
  });

  it('reads behind when the rider is slower than the recording', () => {
    const p = soloProps();
    p.riders.rider_a = { ...p.riders.rider_a, cumulativeDistanceM: 75 };
    const { getByTestId } = render(<CycleRaceScreen {...p} />);
    const pace = getByTestId('pace-delta');
    // The rival passed 75 m at 15 s: the rider is 5 s behind.
    expect(pace.className).toContain('is-behind');
    expect(pace.querySelector('.cg-pace__headline').textContent).toBe('5 s');
  });

  it('names a household rival without the ghost glyph', () => {
    const p = soloProps({ rivalKind: 'household' });
    p.riders[RIVAL_ID] = { ...p.riders[RIVAL_ID], displayName: 'Rider B 👻' };
    const { getByTestId } = render(<CycleRaceScreen {...p} />);
    expect(getByTestId('pace-delta').textContent).toContain("vs Rider B's best");
    expect(getByTestId('pace-delta').textContent).not.toContain('👻');
  });

  it('nothing ranks or leads in solo: no "Leader", no ordinal, no leader medal', () => {
    const { getByTestId, queryByTestId } = render(<CycleRaceScreen {...soloProps()} />);
    const text = getByTestId('cycle-race-screen').textContent;
    expect(text).not.toMatch(/Leader/);
    expect(text).not.toMatch(/\b\d+(st|nd|rd|th)\b/);
    expect(queryByTestId('cycle-speedometer-leader-medal')).toBeNull();
    // The rider's POV badge still shows their distance.
    const badge = getByTestId('race-pov').querySelector('[data-rider="rider_a"]');
    expect(badge.textContent.trim()).toBe('120 m');
  });

  it('only the live rider gets a gauge; the rival does not', () => {
    const { container } = render(<CycleRaceScreen {...soloProps()} />);
    expect(container.querySelectorAll('.cycle-speedometer').length).toBe(1);
    expect(container.querySelector('[data-distance-readout="rider_a"].cycle-speedometer__odometer-value')).toBeTruthy();
  });

  it('a parked live rider still sees the pace panel', () => {
    const p = soloProps();
    p.riderLive.rider_a = { ...p.riderLive.rider_a, parked: true, rpm: 0 };
    const { getByTestId } = render(<CycleRaceScreen {...p} />);
    expect(getByTestId('pace-delta')).toBeInTheDocument();
    expect(getByTestId('race-layout').dataset.mode).toBe('solo');
  });

  it('without speedometers the band holds the pace panel alone', () => {
    const { getByTestId, container } = render(<CycleRaceScreen {...soloProps()} showSpeedos={false} />);
    expect(getByTestId('pace-delta')).toBeInTheDocument();
    expect(container.querySelector('.cycle-speedometer')).toBeNull();
    expect(container.querySelector('.race-layout__zone--empty')).toBeNull();
  });

  it('two live riders use the sidebar layout with the tower, even with a ghost', () => {
    const p = soloProps();
    p.riders.rider_c = { userId: 'rider_c', displayName: 'Rider C', cumulativeDistanceM: 90, distanceSeries: [30, 60, 90] };
    p.riderLive.rider_c = { rpm: 70, placement: 3 };
    const { getByTestId, queryByTestId } = render(<CycleRaceScreen {...p} />);
    expect(getByTestId('race-layout').dataset.mode).toBe('sidebar');
    expect(getByTestId('standings-tower')).toBeInTheDocument();
    expect(queryByTestId('pace-delta')).toBeNull();
    expect(getByTestId('chart-header').textContent).toMatch(/Leader/);
  });

  it('a recap (soloLayout off) stays on the sidebar layout with the tower', () => {
    const { getByTestId } = render(<CycleRaceScreen {...soloProps()} soloLayout={false} />);
    expect(getByTestId('race-layout').dataset.mode).toBe('sidebar');
    expect(getByTestId('standings-tower')).toBeInTheDocument();
  });
});
