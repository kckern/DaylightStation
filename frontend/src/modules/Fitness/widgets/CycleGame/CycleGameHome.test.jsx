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

  it('renders a starting grid slot per bike, equipment hero + assigned rider avatar', () => {
    const { getByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} />
    );
    expect(getByTestId('bike-cycle_ace')).toBeTruthy();
    expect(getByTestId('bike-tricycle')).toBeTruthy();
    // a filled slot keeps the equipment hero AND shows the rider's avatar
    // (no name label on the slot — names live in the picker)
    const filled = getByTestId('bike-cycle_ace');
    expect(filled.querySelector('.cgh-slot__device')).toBeTruthy();
    expect(filled.querySelector('.cgh-slot__rider-avatar')).toBeTruthy();
    expect(filled.querySelector('.cgh-slot__rider-name')).toBeNull();
    // an empty slot has no rider avatar, still has the equipment hero
    const empty = getByTestId('bike-tricycle');
    expect(empty.querySelector('.cgh-slot__rider-avatar')).toBeNull();
    expect(empty.querySelector('.cgh-slot__device')).toBeTruthy();
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

  it('clears an assigned rider via the picker Clear tile', () => {
    const onUnassign = vi.fn();
    const { getByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} onUnassign={onUnassign} />
    );
    // clicking a filled slot reopens the picker, which offers Clear
    fireEvent.click(getByTestId('bike-cycle_ace').querySelector('.cgh-slot__main'));
    expect(getByTestId('rider-picker')).toBeTruthy();
    fireEvent.click(getByTestId('rider-clear'));
    expect(onUnassign).toHaveBeenCalledWith('cycle_ace');
  });

  it('separates guests behind a tab; household shows on the main tab', () => {
    const mixed = [
      { id: 'milo', name: 'Milo', hasHR: false, isGuest: false },
      { id: 'lila', name: 'Lila', hasHR: false, isGuest: true }
    ];
    const { getByTestId, queryByTestId, getByRole } = render(
      <CycleGameHome bikes={bikes} people={mixed} records={[]} />
    );
    fireEvent.click(getByTestId('bike-tricycle').querySelector('.cgh-slot__main'));
    // household tab is default: Milo present, Lila (guest) hidden
    expect(getByTestId('assign-milo')).toBeTruthy();
    expect(queryByTestId('assign-lila')).toBeNull();
    // switch to Guests tab → Lila appears
    fireEvent.click(getByRole('tab', { name: 'Guests' }));
    expect(getByTestId('assign-lila')).toBeTruthy();
  });

  it('ghost picker: first tap focuses a card, second tap selects it (two-stage)', () => {
    const onSelectGhost = vi.fn();
    const candidates = [{
      raceId: '20260602150118', day: '2026-06-02', timeOfDay: '3:01 pm',
      participants: [{ id: 'milo', displayName: 'Milo', avatarSrc: '/x' }],
      winnerName: 'Milo', goalKind: 'distance', goalLabel: '3 km', scoreKind: 'time', scoreLabel: '4:12'
    }];
    const { getByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} ghostCandidates={candidates} onSelectGhost={onSelectGhost} />
    );
    fireEvent.click(getByTestId('course-ghost')); // open the ghost picker
    const card = getByTestId('ghost-20260602150118');
    fireEvent.click(card); // first tap → focus only
    expect(onSelectGhost).not.toHaveBeenCalled();
    fireEvent.click(card); // second tap → commit
    expect(onSelectGhost).toHaveBeenCalled();
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
        records={[{
          raceId: '20260602150118',
          avatars: [{ id: 'milo', src: '/api/v1/static/img/users/milo', name: 'Milo' }],
          goalKind: 'distance', goalLabel: '3 km',
          scoreKind: 'time', scoreLabel: '4:12'
        }]}
      />
    );
    // goal chip + winner score both render
    expect(getByText(/3 km/)).toBeTruthy();
    expect(getByText('4:12')).toBeTruthy();
  });
});
