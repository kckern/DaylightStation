import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import SpeedoRow from './SpeedoRow.jsx';

describe('SpeedoRow panel', () => {
  it('renders one speedometer per rider inside the speedos row', () => {
    const { container } = render(<SpeedoRow
      riderIds={['a', 'b']}
      riders={{ a: { displayName: 'A', cumulativeDistanceM: 10 }, b: { displayName: 'B', cumulativeDistanceM: 20 } }}
      riderLive={{ a: {}, b: {} }}
      cadenceBands={[]}
    />);
    expect(container.querySelector('.cycle-race-screen__speedos')).not.toBeNull();
    expect(container.querySelectorAll('.cycle-speedometer').length).toBe(2);
  });

  it('sizes gauges from the provided zoneBox (no self-measuring)', () => {
    const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 0 } };
    const { container } = render(
      <SpeedoRow riderIds={['a']} riders={riders} riderLive={{ a: { rpm: 0 } }} cadenceBands={[]}
        zoneBox={{ width: 900, height: 400 }} />
    );
    // 1 gauge in a 900-wide / 400-tall band → clamped to the 280 max; gauge width follows.
    const gauge = container.querySelector('.cycle-speedometer');
    expect(gauge).toBeTruthy();
    expect(gauge.style.width).toBe('280px');
  });

  it('raises the gauge cap when maxGauge is larger (solo hero gauge)', () => {
    const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 0 } };
    const { container } = render(
      <SpeedoRow riderIds={['a']} riders={riders} riderLive={{ a: { rpm: 0 } }} cadenceBands={[]}
        zoneBox={{ width: 900, height: 600 }} maxGauge={420} />
    );
    // byHeight = 600-68 (honest chrome budget) = 532, byWidth = 900 → raw 532, clamped to the raised 420 cap.
    const gauge = container.querySelector('.cycle-speedometer');
    expect(gauge.style.width).toBe('420px');
  });

  it('passes sensorLost through to the rider\'s speedometer (audit game-design #6)', () => {
    const riders = { a: { displayName: 'A', cumulativeDistanceM: 0 }, b: { displayName: 'B', cumulativeDistanceM: 0 } };
    const { container, getAllByTestId } = render(
      <SpeedoRow riderIds={['a', 'b']} riders={riders}
        riderLive={{ a: { rpm: 0, sensorLost: true }, b: { rpm: 0, sensorLost: false } }} cadenceBands={[]} />
    );
    const chips = getAllByTestId('cycle-speedometer-sensor-lost');
    expect(chips.length).toBe(1);
    expect(container.querySelectorAll('.cycle-speedometer').length).toBe(2);
  });

  it('never shrinks the gauge below minGauge, even before the zone is measured', () => {
    const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 0 } };
    // zoneBox {0,0} = the pre-measurement transient; the gauge must still honour the
    // minimum radius (the solo hero floor), never collapse to the 96px default.
    const { container } = render(
      <SpeedoRow riderIds={['a']} riders={riders} riderLive={{ a: { rpm: 0 } }} cadenceBands={[]}
        zoneBox={{ width: 0, height: 0 }} minGauge={320} maxGauge={520} />
    );
    expect(container.querySelector('.cycle-speedometer').style.width).toBe('320px');
  });
});
