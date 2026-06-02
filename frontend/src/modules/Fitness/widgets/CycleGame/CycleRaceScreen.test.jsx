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
});
