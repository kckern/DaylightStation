import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import CycleSpeedometer from './CycleSpeedometer.jsx';

const BANDS = [
  { id: 'warmup',   name: 'Warm-up',  min: 0,  color: '#5b6470' },
  { id: 'cruising', name: 'Cruising', min: 40, color: '#2ecc71' },
  { id: 'pushing',  name: 'Pushing',  min: 70, color: '#f1c40f' },
  { id: 'sprint',   name: 'Sprint',   min: 90, color: '#e74c3c' }
];
const baseProps = {
  rpm: 92, cadenceBands: BANDS, distanceMeters: 2340,
  avatar: { name: 'Milo', heartRate: 168, zoneId: 'hot', zoneColor: '#e67e22', progress: 0.5 }
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
  it('shows the multiplier badge dot + readout text only when multiplier > 1', () => {
    const { queryByTestId, rerender } = render(<CycleSpeedometer {...baseProps} multiplier={2} />);
    // The dot itself is color-only (T10's 30%-of-avatar cap leaves no room for
    // floor-legible text); the number lives in the lower readout beside rpm.
    expect(queryByTestId('cycle-speedometer-multiplier')).not.toBeNull();
    expect(queryByTestId('cycle-speedometer-multiplier-text').textContent).toContain('×2');
    rerender(<CycleSpeedometer {...baseProps} multiplier={1} />);
    expect(queryByTestId('cycle-speedometer-multiplier')).toBeNull();
    expect(queryByTestId('cycle-speedometer-multiplier-text')).toBeNull();
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
  it('does not show the FINISHED badge while still racing', () => {
    const { queryByTestId } = render(<CycleSpeedometer {...baseProps} />);
    expect(queryByTestId('cycle-speedometer-finished')).toBeNull();
  });
  it('shows a FALSE START penalty overlay when penalized', () => {
    const { getByTestId, container } = render(<CycleSpeedometer {...baseProps} penalized />);
    expect(getByTestId('cycle-speedometer-penalty').textContent.toUpperCase()).toContain('FALSE START');
    expect(container.querySelector('.cycle-speedometer--penalized')).not.toBeNull();
  });
  it('does not show the penalty overlay when not penalized', () => {
    const { queryByTestId } = render(<CycleSpeedometer {...baseProps} />);
    expect(queryByTestId('cycle-speedometer-penalty')).toBeNull();
  });
  it('shows a draining countdown bar with seconds remaining while serving the timer', () => {
    const { getByTestId } = render(
      <CycleSpeedometer {...baseProps} penalized penaltyRemainingS={6} penaltyTotalS={10} penaltyAwaitingStop={false} />
    );
    const bar = getByTestId('cycle-speedometer-penalty-bar');
    // fill reflects remaining/total (6/10 = 60%)
    expect(bar.querySelector('.cycle-speedometer__penalty-fill').style.width).toBe('60%');
    expect(getByTestId('cycle-speedometer-penalty').textContent).toContain('6');
  });
  it('swaps to a STOP PEDALING cue once the timer is served but the rider is still pedalling', () => {
    const { getByTestId, queryByTestId } = render(
      <CycleSpeedometer {...baseProps} penalized penaltyRemainingS={0} penaltyTotalS={10} penaltyAwaitingStop />
    );
    expect(queryByTestId('cycle-speedometer-penalty-bar')).toBeNull();
    expect(getByTestId('cycle-speedometer-penalty').textContent.toUpperCase()).toContain('STOP PEDALING');
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
