import { describe, it, expect, vi } from 'vitest';
import { render, within, fireEvent, screen } from '@testing-library/react';
import RaceResults from './RaceResults.jsx';

const standings = [
  { userId: 'milo', placement: 1, finishTimeS: 252, distanceM: 3000 },
  { userId: 'felix', placement: 2, finishTimeS: null, distanceM: 2710 }
];
const riders = {
  milo: { displayName: 'Milo' },
  felix: { displayName: 'Felix' }
};

describe('RaceResults', () => {
  it('renders a row per standing in placement order with names', () => {
    const { getAllByTestId } = render(<RaceResults standings={standings} riders={riders} winCondition="distance" dnf={[]} animate={false} />);
    const rows = getAllByTestId('result-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Milo');
    expect(rows[0].textContent).toContain('1');
  });
  it('marks DNF riders and shows a DNF legend', () => {
    const { getByTestId } = render(<RaceResults standings={standings} riders={riders} winCondition="distance" dnf={['felix']} />);
    expect(getByTestId('result-row-felix').textContent).toContain('DNF');
    expect(getByTestId('race-results-legend').textContent).toContain('Did Not Finish');
  });
  it('flags penalized riders with a badge and a false-start legend', () => {
    const { getByTestId } = render(
      <RaceResults standings={standings} riders={riders} winCondition="distance" dnf={[]} penalized={['felix']} />
    );
    expect(getByTestId('result-row-felix').textContent).toContain('⏱️');
    expect(getByTestId('race-results-legend').textContent).toContain('False start');
  });
  it('renders no legend when there are no DNF or penalty events', () => {
    const { queryByTestId } = render(<RaceResults standings={standings} riders={riders} winCondition="distance" dnf={[]} />);
    expect(queryByTestId('race-results-legend')).toBeNull();
  });
  it('shows time for distance races and distance for time races', () => {
    const dist = render(<RaceResults standings={standings} riders={riders} winCondition="distance" dnf={[]} animate={false} />);
    expect(within(dist.container).getByTestId('result-row-milo').textContent).toContain('4:12'); // 252s
    const time = render(<RaceResults standings={standings} riders={riders} winCondition="time" dnf={[]} animate={false} />);
    expect(within(time.container).getByTestId('result-row-milo').textContent).toContain('3.00 km'); // 3000 m
  });
  it('renders an exit button that calls onExit', () => {
    const onExit = vi.fn();
    const { getByTestId } = render(
      <RaceResults standings={standings} riders={riders} winCondition="distance" dnf={[]} animate={false} onExit={onExit} />
    );
    fireEvent.click(getByTestId('race-results-exit'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
  it('renders ladder notes when provided, nothing otherwise', () => {
    const { rerender } = render(<RaceResults standings={[]} riders={{}}
      ladderNotes={['Milo: 2nd this week — 0:04 behind Dad', 'Dad: Ladder lead this week!']} />);
    const box = screen.getByTestId('race-results-ladder');
    expect(box.textContent).toContain('Milo: 2nd this week');
    expect(box.textContent).toContain('Ladder lead');
    rerender(<RaceResults standings={[]} riders={{}} ladderNotes={[]} />);
    expect(screen.queryByTestId('race-results-ladder')).toBeNull();
  });
});
