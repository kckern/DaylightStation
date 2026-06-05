import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RaceLayoutManager from './RaceLayoutManager.jsx';

const panels = {
  distanceChart: () => <div data-testid="p-chart" />,
  splitsChart:   () => <div data-testid="p-splits" />,
  povGrid:       () => <div data-testid="p-pov" />,
  ovalTrack:     () => <div data-testid="p-oval" />,
  speedoRow:     () => <div data-testid="p-speedo" />
};

describe('RaceLayoutManager', () => {
  it('sidebar mode (≤3): chart, splits, pov, oval, speedo all present', () => {
    const { getByTestId } = render(<RaceLayoutManager panels={panels} fieldSize={2} />);
    ['p-chart','p-splits','p-pov','p-oval','p-speedo'].forEach((t) => expect(getByTestId(t)).toBeInTheDocument());
    expect(getByTestId('race-layout').dataset.mode).toBe('sidebar');
  });
  it('wide mode (≥4): no oval; chart, splits, pov, speedo present', () => {
    const { getByTestId, queryByTestId } = render(<RaceLayoutManager panels={panels} fieldSize={4} />);
    ['p-chart','p-splits','p-pov','p-speedo'].forEach((t) => expect(getByTestId(t)).toBeInTheDocument());
    expect(queryByTestId('p-oval')).toBeNull();
    expect(getByTestId('race-layout').dataset.mode).toBe('wide');
  });
});
