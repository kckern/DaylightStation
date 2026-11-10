import { describe, it, expect, vi } from 'vitest';
import { render, within, fireEvent, screen } from '@testing-library/react';
import RaceResults from "./RaceResults.jsx";

const standings = [
  { userId: 'user_3', placement: 1, finishTimeS: 252, distanceM: 3000 },
  { userId: 'user_2', placement: 2, finishTimeS: null, distanceM: 2710 }
];
const riders = {
  user_3: { displayName: 'User_3' },
  user_2: { displayName: 'User_2' }
};

describe('RaceResults', () => {
  it('renders a row per standing in placement order with names', () => {
    const { getAllByTestId } = render(<RaceResults standings={standings} riders={riders} winCondition="distance" animate={false} />);
    const rows = getAllByTestId('result-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('User_3');
    expect(rows[0].textContent).toContain('1');
  });
  it('shows a stopped rider with the distance they rode, never DNF', () => {
    const { getByTestId, queryByText } = render(
      <RaceResults animate={false} winCondition="time" stopped={['b']}
        standings={[{ userId: 'a', placement: 1, distanceM: 900 }, { userId: 'b', placement: 2, distanceM: 412 }]}
        riders={{ a: { displayName: 'A' }, b: { displayName: 'B' } }} />
    );
    expect(queryByText('DNF')).toBeNull();
    expect(getByTestId('result-row-b').textContent).toContain('Stopped at 412 m');
    expect(getByTestId('race-results').textContent).not.toMatch(/DNF|Did Not Finish|False start/);
  });
  it('shows an overtime rider their REAL distance plus an OT tag, and an OT legend — never DNF', () => {
    const { getByTestId } = render(
      <RaceResults standings={standings} riders={riders} winCondition="distance" overtime={['user_2']} animate={false} />
    );
    const row = getByTestId('result-row-user_2');
    expect(row.textContent).toContain('2.71 km'); // real distance (2710 m), not masked
    expect(row.textContent).not.toContain('DNF');
    expect(row.textContent).toContain('OT');
    expect(getByTestId('race-results-legend').textContent).toContain('Still riding when the race closed');
  });
  it('stopped wins over overtime if a rider is somehow flagged both (defensive): Stopped at, no OT tag', () => {
    const { getByTestId } = render(
      <RaceResults standings={standings} riders={riders} winCondition="distance" stopped={['user_2']} overtime={['user_2']} animate={false} />
    );
    const row = getByTestId('result-row-user_2');
    expect(row.textContent).toContain('Stopped at 2.71 km');
    expect(row.querySelector('.race-results__ot-tag')).toBeNull();
  });
  it('renders no legend when there are no overtime riders', () => {
    const { queryByTestId } = render(<RaceResults standings={standings} riders={riders} winCondition="distance" />);
    expect(queryByTestId('race-results-legend')).toBeNull();
  });
  it('shows time for distance races and distance for time races', () => {
    const dist = render(<RaceResults standings={standings} riders={riders} winCondition="distance" animate={false} />);
    expect(within(dist.container).getByTestId('result-row-user_3').textContent).toContain('4:12'); // 252s
    const time = render(<RaceResults standings={standings} riders={riders} winCondition="time" animate={false} />);
    expect(within(time.container).getByTestId('result-row-user_3').textContent).toContain('3.00 km'); // 3000 m
  });
  it('crowns the time-race winner even though time races never stamp finishTimeS', () => {
    // Realistic time-race standings: NOBODY has a finishTimeS (the cap ends the race).
    const timeStandings = [
      { userId: 'user_3', placement: 1, finishTimeS: null, distanceM: 3000 },
      { userId: 'user_2', placement: 2, finishTimeS: null, distanceM: 2710 }
    ];
    const { container } = render(
      <RaceResults standings={timeStandings} riders={riders} winCondition="time" animate={false} />
    );
    const row = within(container).getByTestId('result-row-user_3').closest('li');
    expect(row.className).toContain('is-winner');
    expect(row.textContent).toContain('👑');
  });
  it('renders an exit button that calls onExit', () => {
    const onExit = vi.fn();
    const { getByTestId } = render(
      <RaceResults standings={standings} riders={riders} winCondition="distance" animate={false} onExit={onExit} />
    );
    fireEvent.click(getByTestId('race-results-exit'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
  it('renders ladder notes when provided, nothing otherwise', () => {
    const { rerender } = render(<RaceResults standings={[]} riders={{}}
      ladderNotes={['User_3: 2nd this week — 0:04 behind Dad', 'Dad: Ladder lead this week!']} />);
    const box = screen.getByTestId('race-results-ladder');
    expect(box.textContent).toContain('User_3: 2nd this week');
    expect(box.textContent).toContain('Ladder lead');
    rerender(<RaceResults standings={[]} riders={{}} ladderNotes={[]} />);
    expect(screen.queryByTestId('race-results-ladder')).toBeNull();
  });
  it('shows the not-saved banner only when saveFailed', () => {
    const { rerender } = render(<RaceResults standings={[]} riders={{}} saveFailed />);
    expect(screen.getByTestId('race-results-save-failed').textContent).toContain('could not be saved');
    rerender(<RaceResults standings={[]} riders={{}} saveFailed={false} />);
    expect(screen.queryByTestId('race-results-save-failed')).toBeNull();
  });
});
