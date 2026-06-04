import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

// Capture the props each panel actually receives through the REAL chain:
// CycleRaceScreen builds a `panels` map → RaceLayoutManager renders each through
// PanelSlot → PanelSlot.cloneElement injects { zoneBox } → the panel leaf.
// The zero-arg factory wrappers in the panels map were dropping that injected
// zoneBox, so the leaf panels (SpeedoRow, DistanceChart) never got a measured
// box — SpeedoRow then fell back to the 96px gauge floor.
let speedoProps;
let chartProps;
vi.mock('./panels/SpeedoRow.jsx', () => ({
  default: (props) => { speedoProps = props; return null; }
}));
vi.mock('./panels/DistanceChart.jsx', () => ({
  default: (props) => { chartProps = props; return null; }
}));

// Imported after the mocks so CycleRaceScreen binds to the mocked panels.
import CycleRaceScreen from './CycleRaceScreen.jsx';

const solo = {
  winCondition: 'time', timeCapS: 120, elapsedS: 1, goalM: undefined,
  riders: { kc: { userId: 'kc', displayName: 'User_1', cumulativeDistanceM: 0, distanceSeries: [0] } },
  riderLive: { kc: { rpm: 0 } },
  cadenceBands: []
};

describe('CycleRaceScreen — layout zoneBox reaches the panels', () => {
  beforeEach(() => { speedoProps = undefined; chartProps = undefined; });

  it('forwards the PanelSlot-injected zoneBox to SpeedoRow', () => {
    render(<CycleRaceScreen {...solo} />);
    expect(speedoProps).toBeTruthy();
    // A measured box ({width,height}) — not undefined. jsdom has no layout so the
    // values are 0, but the OBJECT must be present (that's what gaugeRowSize needs
    // to size off the band instead of returning the 96px floor).
    expect(speedoProps.zoneBox).toBeDefined();
    expect(speedoProps.zoneBox).toHaveProperty('width');
    expect(speedoProps.zoneBox).toHaveProperty('height');
  });

  it('forwards the PanelSlot-injected zoneBox to DistanceChart', () => {
    render(<CycleRaceScreen {...solo} />);
    expect(chartProps).toBeTruthy();
    expect(chartProps.zoneBox).toBeDefined();
    expect(chartProps.zoneBox).toHaveProperty('width');
  });
});
