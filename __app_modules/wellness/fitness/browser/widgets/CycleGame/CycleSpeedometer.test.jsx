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
  it('shows a legible multiplier pill (with its number) only when multiplier > 1', () => {
    // 2026-07-02 feedback: the prior circular badge shrank to an unreadable
    // dot with the number moved to tiny inline text elsewhere. The pill must
    // show the number directly, legibly (≥1.1rem via CSS, asserted in
    // speedometerOverlayLayout.test.js's box-size math).
    const { queryByTestId, rerender } = render(<CycleSpeedometer {...baseProps} multiplier={2} />);
    const pill = queryByTestId('cycle-speedometer-multiplier');
    expect(pill).not.toBeNull();
    expect(pill.textContent).toContain('×2');
    rerender(<CycleSpeedometer {...baseProps} multiplier={1.4} />);
    expect(queryByTestId('cycle-speedometer-multiplier').textContent).toContain('×1.4');
    rerender(<CycleSpeedometer {...baseProps} multiplier={1} />);
    expect(queryByTestId('cycle-speedometer-multiplier')).toBeNull();
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
