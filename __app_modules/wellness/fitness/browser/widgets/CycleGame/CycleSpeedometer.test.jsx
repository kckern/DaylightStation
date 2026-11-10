import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import CycleSpeedometer from "./CycleSpeedometer.jsx";

const BANDS = [
  { id: 'warmup',   name: 'Warm-up',  min: 0,  color: '#5b6470' },
  { id: 'cruising', name: 'Cruising', min: 40, color: '#2ecc71' },
  { id: 'pushing',  name: 'Pushing',  min: 70, color: '#f1c40f' },
  { id: 'sprint',   name: 'Sprint',   min: 90, color: '#e74c3c' }
];
const baseProps = {
  rpm: 92, cadenceBands: BANDS, distanceMeters: 2340,
  avatar: { name: 'User_3', heartRate: 168, zoneId: 'hot', zoneColor: '#e67e22', progress: 0.5 }
};

describe('CycleSpeedometer', () => {
  it('renders the RPM value and the formatted odometer', () => {
    const { getByTestId } = render(<CycleSpeedometer {...baseProps} />);
    expect(getByTestId('cycle-speedometer-rpm').textContent).toContain('92');
    expect(getByTestId('cycle-speedometer-odometer').textContent).toBe('2.34 km');
  });
  it('renders the effective km/h hero readout as a whole number', () => {
    const { getByTestId } = render(<CycleSpeedometer {...baseProps} speedKmh={28.43} />);
    expect(getByTestId('cycle-speedometer-speed').textContent).toContain('28');
    expect(getByTestId('cycle-speedometer-speed').textContent).not.toContain('28.4');
    expect(getByTestId('cycle-speedometer-speed').textContent).toContain('km/h');
  });
  it('renders one band arc per cadence band', () => {
    const { container } = render(<CycleSpeedometer {...baseProps} />);
    expect(container.querySelectorAll('.cycle-speedometer__band').length).toBe(4);
  });
  it('falls back to the default colour bands when none are supplied', () => {
    const { container } = render(<CycleSpeedometer {...baseProps} cadenceBands={[]} />);
    // The 5 system-default zones (grey/green/yellow/orange/red) still render.
    expect(container.querySelectorAll('.cycle-speedometer__band').length).toBe(5);
  });
  it('lights up the band the current RPM falls in and dims the rest', () => {
    // rpm 92 with BANDS → the 'sprint' band (min 90) is active.
    const { container, getByTestId } = render(<CycleSpeedometer {...baseProps} rpm={92} />);
    expect(container.querySelectorAll('.cycle-speedometer__band--active').length).toBe(1);
    expect(container.querySelectorAll('.cycle-speedometer__band--dim').length).toBe(3);
    expect(getByTestId('cycle-speedometer-band-active').getAttribute('stroke')).toBe('#e74c3c');
  });
  it('moves the lit band as the RPM changes zones', () => {
    const { getByTestId, rerender } = render(<CycleSpeedometer {...baseProps} rpm={50} />);
    expect(getByTestId('cycle-speedometer-band-active').getAttribute('stroke')).toBe('#2ecc71'); // cruising
    rerender(<CycleSpeedometer {...baseProps} rpm={75} />);
    expect(getByTestId('cycle-speedometer-band-active').getAttribute('stroke')).toBe('#f1c40f'); // pushing
  });
  // ── Boost meter (replaces the multiplier badge) ──────────────────────────
  // The heart-rate zone multiplies distance. The gauge says so in words under
  // the readout, outside the dial, so it can never cover a tick label.
  const WARM = { hasStrap: true, label: 'Warm', mult: 1.2, progress: 0.4, next: { label: 'Hot', mult: 1.4 } };
  it('the boost row names the zone and its multiplier, fills a bar to the progress, and shows the next step', () => {
    const { getByTestId } = render(<CycleSpeedometer {...baseProps} boost={WARM} />);
    const row = getByTestId('cycle-speedometer-boost');
    expect(getByTestId('cycle-speedometer-boost-chip').textContent).toBe('Warm ×1.2');
    expect(getByTestId('cycle-speedometer-boost-fill').style.width).toBe('40%');
    expect(getByTestId('cycle-speedometer-boost-next').textContent).toBe('Hot ×1.4');
    expect(row.className).not.toContain('no-strap');
  });
  it('no strap: the handicap multiplier and no bar or next step', () => {
    const { getByTestId, queryByTestId } = render(
      <CycleSpeedometer {...baseProps} boost={{ hasStrap: false, label: 'No heart-rate strap', mult: 0.8, progress: null, next: null }} />
    );
    expect(getByTestId('cycle-speedometer-boost-chip').textContent).toBe('No heart-rate strap ×0.8');
    expect(queryByTestId('cycle-speedometer-boost-bar')).toBeNull();
    expect(queryByTestId('cycle-speedometer-boost-next')).toBeNull();
  });
  it('hides the bar when progress is unknown, and the next step at the top zone', () => {
    const { queryByTestId } = render(
      <CycleSpeedometer {...baseProps} boost={{ hasStrap: true, label: 'Fire', mult: 1.6, progress: null, next: null }} />
    );
    expect(queryByTestId('cycle-speedometer-boost-chip').textContent).toBe('Fire ×1.6');
    expect(queryByTestId('cycle-speedometer-boost-bar')).toBeNull();
    expect(queryByTestId('cycle-speedometer-boost-next')).toBeNull();
  });
  it('prints multipliers with at most one decimal and no trailing .0', () => {
    const { getByTestId } = render(
      <CycleSpeedometer {...baseProps} boost={{ hasStrap: true, label: 'Active', mult: 1, progress: 0.25, next: { label: 'Warm', mult: 1.25 } }} />
    );
    expect(getByTestId('cycle-speedometer-boost-chip').textContent).toBe('Active ×1');
    expect(getByTestId('cycle-speedometer-boost-next').textContent).toBe('Warm ×1.3');
  });
  it('the old multiplier badge is gone, whatever the multiplier', () => {
    const { queryByTestId } = render(<CycleSpeedometer {...baseProps} multiplier={2} boost={WARM} />);
    expect(queryByTestId('cycle-speedometer-multiplier')).toBeNull();
  });
  it('every dial label renders, and the boost row sits outside the dial', () => {
    // The default dial (120 max) labels 0 · 30 · 60 · 90 · 120; the old badge
    // covered the 120.
    const { container, getByTestId } = render(<CycleSpeedometer {...baseProps} boost={WARM} />);
    const labels = [...container.querySelectorAll('.cycle-speedometer__tick-label')].map((t) => t.textContent);
    expect(labels).toEqual(['0', '30', '60', '90', '120']);
    const row = getByTestId('cycle-speedometer-boost');
    expect(container.querySelector('svg.cycle-speedometer__svg').contains(row)).toBe(false);
    expect(container.querySelector('.cycle-speedometer__gauge').contains(row)).toBe(false);
  });
  it('a 180 dial shows all its labels with the boost row on', () => {
    const { container } = render(<CycleSpeedometer {...baseProps} maxRpm={180} boost={WARM} />);
    const labels = [...container.querySelectorAll('.cycle-speedometer__tick-label')].map((t) => t.textContent);
    expect(labels[0]).toBe('0');
    expect(labels[labels.length - 1]).toBe('180');
  });
  it('no boost given (recap): no boost row', () => {
    const { queryByTestId } = render(<CycleSpeedometer {...baseProps} />);
    expect(queryByTestId('cycle-speedometer-boost')).toBeNull();
  });
  // The rider controls rpm, so rpm is the big number; km/h is the small one.
  it('rpm is the large readout and speed the small one', () => {
    const { getByTestId } = render(<CycleSpeedometer {...baseProps} speedKmh={20} />);
    const rpm = getByTestId('cycle-speedometer-rpm');
    const speed = getByTestId('cycle-speedometer-speed');
    expect(rpm.className).toContain('cycle-speedometer__readout--hero');
    expect(speed.className).toContain('cycle-speedometer__readout--sub');
    // rpm reads first (on top).
    expect(rpm.compareDocumentPosition(speed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('renders the HR value via the embedded avatar', () => {
    const { container } = render(<CycleSpeedometer {...baseProps} />);
    expect(container.querySelector('.hr-value')?.textContent).toBe('168');
  });
  it('shows a FINISHED state with placement when finished', () => {
    const { getByTestId, container } = render(
      <CycleSpeedometer {...baseProps} finished placement={1} />
    );
    const badge = getByTestId('cycle-speedometer-finished');
    expect(badge.textContent).toContain('1st');
    expect(container.querySelector('.cycle-speedometer--finished')).not.toBeNull();
  });
  // Solo layout: no placement is passed. The overlay says Finished once,
  // with no ordinal.
  it('a finish with no placement reads "Finished" once, with no ordinal', () => {
    const { getByTestId } = render(<CycleSpeedometer {...baseProps} finished placement={null} />);
    const badge = getByTestId('cycle-speedometer-finished');
    expect(badge.textContent.match(/Finished/g)).toHaveLength(1);
    expect(badge.textContent).not.toMatch(/\d(st|nd|rd|th)/);
  });
  it('does not show the FINISHED badge while still racing', () => {
    const { queryByTestId } = render(<CycleSpeedometer {...baseProps} />);
    expect(queryByTestId('cycle-speedometer-finished')).toBeNull();
  });
  // Parked: idle past the park window. Shown in the FINISHED overlay's slot,
  // calm wording, gone the moment the prop clears (the tick they pedal).
  it('shows a PARKED overlay with "Pedal to rejoin" when parked, and clears it when not', () => {
    const { getByTestId, queryByTestId, container, rerender } = render(<CycleSpeedometer {...baseProps} parked />);
    const overlay = getByTestId('cycle-speedometer-parked');
    expect(overlay.textContent).toContain('PARKED');
    expect(overlay.textContent).toContain('Pedal to rejoin');
    expect(overlay.textContent).not.toMatch(/DNF/);
    expect(container.querySelector('.cycle-speedometer--parked')).not.toBeNull();
    rerender(<CycleSpeedometer {...baseProps} parked={false} />);
    expect(queryByTestId('cycle-speedometer-parked')).toBeNull();
    expect(container.querySelector('.cycle-speedometer--parked')).toBeNull();
  });
  it('words a no-sensor rider as NO SIGNAL / Check the sensor, not parked', () => {
    const { getByTestId } = render(<CycleSpeedometer {...baseProps} parked noSensor />);
    const overlay = getByTestId('cycle-speedometer-parked');
    expect(overlay.textContent).toContain('NO SIGNAL');
    expect(overlay.textContent).toContain('Check the sensor');
    expect(overlay.textContent).not.toContain('PARKED');
    expect(overlay.textContent).not.toContain('Pedal to rejoin');
  });
  it('a parked rider whose sensor has dropped is told about the sensor, not told to pedal', () => {
    const { getByTestId } = render(<CycleSpeedometer {...baseProps} parked sensorLost />);
    const overlay = getByTestId('cycle-speedometer-parked');
    expect(overlay.textContent).toContain('NO SIGNAL');
    expect(overlay.textContent).not.toContain('Pedal to rejoin');
  });
  it('shows no parked overlay for a finished rider', () => {
    const { queryByTestId } = render(<CycleSpeedometer {...baseProps} finished placement={1} parked />);
    expect(queryByTestId('cycle-speedometer-parked')).toBeNull();
  });
  it('renders the leader medal in the odometer only when isLeader is true', () => {
    const { queryByTestId, rerender } = render(<CycleSpeedometer {...baseProps} isLeader={false} />);
    expect(queryByTestId('cycle-speedometer-leader-medal')).toBeNull();
    rerender(<CycleSpeedometer {...baseProps} isLeader={true} />);
    expect(queryByTestId('cycle-speedometer-leader-medal')).not.toBeNull();
  });

  it('suppresses the leader medal once the rider has finished (the finished overlay marks the winner)', () => {
    const { queryByTestId } = render(<CycleSpeedometer {...baseProps} isLeader={true} finished={true} placement={1} />);
    expect(queryByTestId('cycle-speedometer-leader-medal')).toBeNull();
  });

  // audit game-design #6 — a dead sensor must be visibly flagged, not silently
  // hold a frozen RPM forever.
  it('shows a SENSOR chip in place of the rpm digits when sensorLost is true', () => {
    const { getByTestId, queryByText, container } = render(<CycleSpeedometer {...baseProps} sensorLost />);
    const rpmSlot = getByTestId('cycle-speedometer-rpm');
    expect(rpmSlot.textContent).toContain('SENSOR');
    expect(rpmSlot.textContent).not.toContain('92'); // the real (frozen/decaying) rpm digits are replaced, not appended
    expect(queryByText('92')).toBeNull();
    expect(container.querySelector('.cycle-speedometer--sensor-lost')).not.toBeNull();
  });

  it('does not show the SENSOR chip while the sensor is connected', () => {
    const { queryByTestId, getByTestId, container } = render(<CycleSpeedometer {...baseProps} sensorLost={false} />);
    expect(queryByTestId('cycle-speedometer-sensor-lost')).toBeNull();
    expect(getByTestId('cycle-speedometer-rpm').textContent).toContain('92');
    expect(container.querySelector('.cycle-speedometer--sensor-lost')).toBeNull();
  });
});
