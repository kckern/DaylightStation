import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import CycleRaceScreen from './CycleRaceScreen.jsx';

const BANDS = [{ id: 'warmup', min: 0, color: '#5b6470' }, { id: 'cruising', min: 40, color: '#2ecc71' }];
const props = {
  winCondition: 'distance',
  goalM: 3000,
  elapsedS: 75,
  cadenceBands: BANDS,
  lapLengthM: 100,
  riders: {
    user_3: { userId: 'user_3', displayName: 'User_3', cumulativeDistanceM: 1500, distanceSeries: [500, 1000, 1500] },
    user_2: { userId: 'user_2', displayName: 'User_2', cumulativeDistanceM: 900, distanceSeries: [300, 600, 900] }
  },
  riderLive: {
    user_3: { rpm: 92, heartRate: 168, zoneId: 'hot', zoneColor: '#e67e22', multiplier: 2 },
    user_2: { rpm: 78, heartRate: 140, zoneId: 'warm', zoneColor: '#f1c40f', multiplier: 1.5 }
  }
};

// 4-rider fixture for wide-mode tests
const base4RiderProps = {
  ...props,
  riders: {
    user_3: { userId: 'user_3', displayName: 'User_3', cumulativeDistanceM: 1500, distanceSeries: [500, 1000, 1500] },
    user_2: { userId: 'user_2', displayName: 'User_2', cumulativeDistanceM: 900, distanceSeries: [300, 600, 900] },
    ann: { userId: 'ann', displayName: 'Ann', cumulativeDistanceM: 1200, distanceSeries: [400, 800, 1200] },
    bo: { userId: 'bo', displayName: 'Bo', cumulativeDistanceM: 600, distanceSeries: [200, 400, 600] }
  },
  riderLive: {
    user_3: { rpm: 92 }, user_2: { rpm: 78 }, ann: { rpm: 85 }, bo: { rpm: 70 }
  }
};

describe('CycleRaceScreen', () => {
  it('renders sidebar mode for ≤3 riders with chart, pov, standings tower', () => {
    const { getByTestId } = render(<CycleRaceScreen {...props} />);
    expect(getByTestId('race-layout').dataset.mode).toBe('sidebar');
    expect(getByTestId('distance-chart')).toBeInTheDocument();
    expect(getByTestId('race-pov')).toBeInTheDocument();
    expect(getByTestId('standings-tower')).toBeInTheDocument();
  });
  it('renders wide mode (no oval, tower docked as a column) for 4+ riders', () => {
    const { getByTestId, queryByTestId } = render(<CycleRaceScreen {...base4RiderProps} />);
    expect(getByTestId('race-layout').dataset.mode).toBe('wide');
    expect(queryByTestId('zone-oval')).toBeNull();
    expect(getByTestId('standings-tower')).toBeInTheDocument();
  });
  it('renders one speedometer per rider', () => {
    const { container } = render(<CycleRaceScreen {...props} />);
    expect(container.querySelectorAll('.cycle-speedometer').length).toBe(2);
  });
  it('renders a distance line per rider', () => {
    const { container } = render(<CycleRaceScreen {...props} />);
    expect(container.querySelectorAll('[data-testid="race-line"]').length).toBe(2);
  });
  it('starts a penalty-boxed late starter\'s line to the right of the origin (no flat zero line)', () => {
    const riders = {
      // boxed for the first 2 ticks (distance 0), then accelerates away
      boxed: { userId: 'boxed', displayName: 'Boxed', cumulativeDistanceM: 300, distanceSeries: [0, 0, 150, 300], isGhost: false }
    };
    const { container } = render(
      <CycleRaceScreen winCondition="distance" goalM={1000} elapsedS={4} riders={riders} riderLive={{ boxed: {} }} />
    );
    const line = container.querySelector('[data-testid="race-line"]');
    expect(line).toBeTruthy();
    const firstX = parseFloat(line.getAttribute('points').trim().split(' ')[0].split(',')[0]);
    // plotStartIndex anchors at index 1 (the last zero before movement), so the
    // line must NOT begin at the origin (x=0).
    expect(firstX).toBeGreaterThan(0);
  });
  it('draws no line for a rider who never left the penalty box (all-zero series)', () => {
    const riders = {
      stuck: { userId: 'stuck', displayName: 'Stuck', cumulativeDistanceM: 0, distanceSeries: [0, 0, 0], isGhost: false }
    };
    const { container } = render(
      <CycleRaceScreen winCondition="distance" goalM={1000} elapsedS={3} riders={riders} riderLive={{ stuck: {} }} />
    );
    expect(container.querySelector('[data-testid="race-line"]')).toBeNull();
  });
  it('mounts an ambient background video only when a Plex id is set', () => {
    const off = render(<CycleRaceScreen {...props} />);
    expect(off.queryByTestId('cycle-race-bg')).toBeNull();
    const on = render(<CycleRaceScreen {...props} backgroundPlexId="plex:123456" />);
    const vid = within(on.container).getByTestId('cycle-race-bg');
    expect(vid.tagName.toLowerCase()).toBe('video');
    expect(vid.getAttribute('src')).toContain('plex/123456');
  });
  it('renders an officiating-event marker per event on the chart', () => {
    const events = [
      { id: 1, type: 'dnf', riderId: 'user_2', seriesIndex: 2, distanceM: 900 },
      { id: 2, type: 'penalty', riderId: 'user_3', seriesIndex: 0, distanceM: 0 }
    ];
    const { getAllByTestId, getByTestId } = render(<CycleRaceScreen {...props} events={events} />);
    expect(getByTestId('race-event-markers')).toBeTruthy();
    expect(getAllByTestId(/^race-event-marker-/)).toHaveLength(2);
    expect(getByTestId('race-event-marker-dnf')).toBeTruthy();
    expect(getByTestId('race-event-marker-penalty')).toBeTruthy();
  });
  it('ignores events for riders not on the chart', () => {
    const events = [{ id: 1, type: 'dnf', riderId: 'ghost-nobody', seriesIndex: 1, distanceM: 100 }];
    const { queryByTestId } = render(<CycleRaceScreen {...props} events={events} />);
    expect(queryByTestId('race-event-markers')).toBeNull();
  });
  it('shows a false-start banner naming penalized riders', () => {
    const penalized = {
      ...props,
      riderLive: {
        user_3: { ...props.riderLive.user_3 },
        user_2: { ...props.riderLive.user_2, penalized: true }
      }
    };
    const { getByTestId, queryByTestId, rerender } = render(<CycleRaceScreen {...penalized} />);
    const banner = getByTestId('cycle-race-penalty-banner');
    expect(banner.textContent.toUpperCase()).toContain('FALSE START');
    expect(banner.textContent).toContain('User_2');
    expect(banner.textContent).not.toContain('User_3');
    // clears once nobody is penalized
    rerender(<CycleRaceScreen {...props} />);
    expect(queryByTestId('cycle-race-penalty-banner')).toBeNull();
  });
  it('hides the speedometer row when showSpeedos is false', () => {
    const riders = { a: { userId: 'a', displayName: 'A', distanceSeries: [10, 20], cumulativeDistanceM: 20, finishTimeS: null, isGhost: false } };
    const { container } = render(
      <CycleRaceScreen winCondition="distance" goalM={100} elapsedS={2} riders={riders} riderLive={{ a: {} }} showSpeedos={false} />
    );
    // No speedometer gauges rendered when showSpeedos=false (zone slot is empty)
    expect(container.querySelector('.cycle-speedometer')).toBeNull();
  });
  it('scales each speedometer to the rider\'s per-equipment max RPM', () => {
    const riders = { a: { userId: 'a', displayName: 'A', distanceSeries: [0], cumulativeDistanceM: 0, finishTimeS: null, isGhost: false } };
    const { getByText } = render(
      <CycleRaceScreen winCondition="distance" goalM={1000} elapsedS={1}
        riders={riders} riderLive={{ a: { rpm: 0, maxRpm: 250 } }} />
    );
    // A 250-max gauge scales tick spacing (label every 75) → "225" appears; the
    // 120 default (labels to 120) never reaches it.
    expect(getByText('225')).toBeTruthy();
  });
});
