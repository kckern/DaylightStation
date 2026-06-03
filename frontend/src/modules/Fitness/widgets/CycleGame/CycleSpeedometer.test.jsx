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
  it('renders one band arc per cadence band', () => {
    const { container } = render(<CycleSpeedometer {...baseProps} />);
    expect(container.querySelectorAll('.cycle-speedometer__band').length).toBe(4);
  });
  it('shows the multiplier badge only when multiplier > 1', () => {
    const { queryByTestId, rerender } = render(<CycleSpeedometer {...baseProps} multiplier={2} />);
    expect(queryByTestId('cycle-speedometer-multiplier').textContent).toContain('2');
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
});
