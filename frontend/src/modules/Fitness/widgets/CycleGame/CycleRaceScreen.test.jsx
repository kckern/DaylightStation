import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import CycleRaceScreen from './CycleRaceScreen.jsx';

const BANDS = [{ id: 'warmup', min: 0, color: '#5b6470' }, { id: 'cruising', min: 40, color: '#2ecc71' }];
const props = {
  winCondition: 'distance',
  goalM: 3000,
  elapsedS: 75,
  cadenceBands: BANDS,
  riders: {
    milo: { userId: 'milo', displayName: 'Milo', cumulativeDistanceM: 1500, distanceSeries: [500, 1000, 1500] },
    felix: { userId: 'felix', displayName: 'Felix', cumulativeDistanceM: 900, distanceSeries: [300, 600, 900] }
  },
  riderLive: {
    milo: { rpm: 92, heartRate: 168, zoneId: 'hot', zoneColor: '#e67e22', multiplier: 2 },
    felix: { rpm: 78, heartRate: 140, zoneId: 'warm', zoneColor: '#f1c40f', multiplier: 1.5 }
  }
};

describe('CycleRaceScreen', () => {
  it('shows the race clock (elapsed for a distance race)', () => {
    const { getByTestId } = render(<CycleRaceScreen {...props} />);
    expect(getByTestId('race-clock').textContent).toContain('1:15');
  });
  it('shows the time remaining for a time race (count down)', () => {
    const { getByTestId } = render(<CycleRaceScreen {...props} winCondition="time" timeCapS={300} goalM={undefined} elapsedS={75} />);
    expect(getByTestId('race-clock').textContent).toContain('3:45'); // 300-75
  });
  it('renders one speedometer per rider', () => {
    const { container } = render(<CycleRaceScreen {...props} />);
    expect(container.querySelectorAll('.cycle-speedometer').length).toBe(2);
  });
  it('renders a distance line per rider', () => {
    const { container } = render(<CycleRaceScreen {...props} />);
    expect(container.querySelectorAll('[data-testid="race-line"]').length).toBe(2);
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
      { id: 1, type: 'dnf', riderId: 'felix', seriesIndex: 2, distanceM: 900 },
      { id: 2, type: 'penalty', riderId: 'milo', seriesIndex: 0, distanceM: 0 }
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
        milo: { ...props.riderLive.milo },
        felix: { ...props.riderLive.felix, penalized: true }
      }
    };
    const { getByTestId, queryByTestId, rerender } = render(<CycleRaceScreen {...penalized} />);
    const banner = getByTestId('cycle-race-penalty-banner');
    expect(banner.textContent.toUpperCase()).toContain('FALSE START');
    expect(banner.textContent).toContain('Felix');
    expect(banner.textContent).not.toContain('Milo');
    // clears once nobody is penalized
    rerender(<CycleRaceScreen {...props} />);
    expect(queryByTestId('cycle-race-penalty-banner')).toBeNull();
  });
  it('hides the speedometer row when showSpeedos is false', () => {
    const riders = { a: { userId: 'a', displayName: 'A', distanceSeries: [10, 20], cumulativeDistanceM: 20, finishTimeS: null, isGhost: false } };
    const { container } = render(
      <CycleRaceScreen winCondition="distance" goalM={100} elapsedS={2} riders={riders} riderLive={{ a: {} }} showSpeedos={false} />
    );
    expect(container.querySelector('.cycle-race-screen__speedos')).toBeNull();
  });
  it('scales each speedometer to the rider\'s per-equipment max RPM', () => {
    const riders = { a: { userId: 'a', displayName: 'A', distanceSeries: [0], cumulativeDistanceM: 0, finishTimeS: null, isGhost: false } };
    const { getByText } = render(
      <CycleRaceScreen winCondition="distance" goalM={1000} elapsedS={1}
        riders={riders} riderLive={{ a: { rpm: 0, maxRpm: 250 } }} />
    );
    // A 250-max gauge labels ticks every 30 RPM → "240" appears; the 120 default never reaches it.
    expect(getByText('240')).toBeTruthy();
  });
  it('shows a medal + finish time on the roster for a finished distance-race rider', () => {
    const riders = {
      a: { userId: 'a', displayName: 'Ann', distanceSeries: [1000], cumulativeDistanceM: 1000, finishTimeS: 252, isGhost: false },
      b: { userId: 'b', displayName: 'Bo', distanceSeries: [600], cumulativeDistanceM: 600, finishTimeS: null, isGhost: false }
    };
    const { getByTestId } = render(
      <CycleRaceScreen winCondition="distance" goalM={1000} elapsedS={260}
        riders={riders} riderLive={{ a: {}, b: {} }} />
    );
    const roster = getByTestId('race-roster');
    const rows = roster.querySelectorAll('.cycle-race-screen__roster-row');
    // Finisher Ann shows 1st-place medal + her 4:12 finish time; she's the top row.
    expect(rows[0].textContent).toContain('🥇');
    expect(rows[0].textContent).toContain('4:12');
    // Still-racing Bo shows distance, no medal.
    expect(rows[1].textContent).toContain('600');
    expect(rows[1].textContent).not.toContain('🥇');
  });
});
