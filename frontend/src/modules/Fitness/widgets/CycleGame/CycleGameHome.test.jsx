import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import CycleGameHome from './CycleGameHome.jsx';

const bikes = [
  { id: 'cycle_ace', name: 'CycleAce', rider: 'milo' },
  { id: 'tricycle', name: 'Tricycle', rider: null }
];
const people = [
  { id: 'milo', name: 'Milo', avatarSrc: '/api/v1/static/img/users/milo', heartRate: 130, zoneId: 'hot', zoneColor: 'orange', hasHR: true },
  { id: 'felix', name: 'Felix', avatarSrc: '/api/v1/static/img/users/felix', heartRate: null, zoneId: null, zoneColor: null, hasHR: false }
];

describe('CycleGameHome', () => {
  it('renders the distance/time race-type dichotomy (no custom tile)', () => {
    const { getByTestId, queryByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} />
    );
    expect(getByTestId('course-distance')).toBeTruthy();
    expect(getByTestId('course-time')).toBeTruthy();
    expect(queryByTestId('course-custom')).toBeNull();
  });

  it('fires onSelectRaceType when a type tile is chosen', () => {
    const onSelectRaceType = vi.fn();
    const { getByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} onSelectRaceType={onSelectRaceType} />
    );
    fireEvent.click(getByTestId('course-distance'));
    expect(onSelectRaceType).toHaveBeenCalledWith('distance');
    fireEvent.click(getByTestId('course-time'));
    expect(onSelectRaceType).toHaveBeenCalledWith('time');
  });

  it('reveals a value step only after a type is chosen', () => {
    const { queryByTestId, rerender } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} raceType={null} />
    );
    expect(queryByTestId('cgh-value')).toBeNull();
    rerender(<CycleGameHome bikes={bikes} people={people} records={[]} raceType="distance" />);
    expect(queryByTestId('cgh-value')).toBeTruthy();
  });

  it('renders a starting grid slot per bike with its assigned rider', () => {
    const { getByTestId, getByText } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} />
    );
    expect(getByTestId('bike-cycle_ace')).toBeTruthy();
    expect(getByTestId('bike-tricycle')).toBeTruthy();
    // assigned rider shows name + remove affordance
    expect(getByText(/Milo · remove/)).toBeTruthy();
    // empty slot prompts assignment
    expect(getByText('tap to assign')).toBeTruthy();
  });

  it('opens the rider picker and assigns a rider on-screen', () => {
    const onAssign = vi.fn();
    const { getByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} onAssign={onAssign} />
    );
    // open picker for the empty tricycle slot
    fireEvent.click(getByTestId('bike-tricycle').querySelector('.cgh-slot__main'));
    expect(getByTestId('rider-picker')).toBeTruthy();
    fireEvent.click(getByTestId('assign-felix'));
    expect(onAssign).toHaveBeenCalledWith('tricycle', 'felix');
  });

  it('fires onUnassign from a filled slot', () => {
    const onUnassign = vi.fn();
    const { getByText } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} onUnassign={onUnassign} />
    );
    fireEvent.click(getByText(/Milo · remove/));
    expect(onUnassign).toHaveBeenCalledWith('cycle_ace');
  });

  it('disables Start until canStart, then fires onStart', () => {
    const onStart = vi.fn();
    const { getByTestId, rerender } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} onStart={onStart} canStart={false} />
    );
    const start = getByTestId('cycle-game-start');
    expect(start.disabled).toBe(true);
    fireEvent.click(start);
    expect(onStart).not.toHaveBeenCalled();
    rerender(<CycleGameHome bikes={bikes} people={people} records={[]} onStart={onStart} canStart />);
    fireEvent.click(getByTestId('cycle-game-start'));
    expect(onStart).toHaveBeenCalled();
  });

  it('does NOT render a cancel control on the home screen', () => {
    const { queryByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} />
    );
    expect(queryByTestId('cycle-game-cancel')).toBeNull();
  });

  it('shows "No races yet" when records are empty, and rows when present', () => {
    const { getByText, rerender } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} />
    );
    expect(getByText('No races yet')).toBeTruthy();
    rerender(
      <CycleGameHome
        bikes={bikes}
        people={people}
        records={[{ courseId: 'distance', userId: 'milo', label: 'Milo — 4:12' }]}
      />
    );
    expect(getByText('Milo — 4:12')).toBeTruthy();
  });
});
