import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RaceLayoutManager from './RaceLayoutManager.jsx';

const panels = {
  distanceChart: () => <div data-testid="p-chart" />,
  povGrid:       () => <div data-testid="p-pov" />,
  ovalTrack:     () => <div data-testid="p-oval" />,
  speedoRow:     () => <div data-testid="p-speedo" />
};

describe('RaceLayoutManager', () => {
  it('sidebar mode (≤3): chart, pov, oval, speedo all present', () => {
    const { getByTestId } = render(<RaceLayoutManager panels={panels} fieldSize={2} />);
    ['p-chart','p-pov','p-oval','p-speedo'].forEach((t) => expect(getByTestId(t)).toBeInTheDocument());
    expect(getByTestId('race-layout').dataset.mode).toBe('sidebar');
  });
  it('wide mode (≥4): no oval; chart, pov, speedo present', () => {
    const { getByTestId, queryByTestId } = render(<RaceLayoutManager panels={panels} fieldSize={4} />);
    ['p-chart','p-pov','p-speedo'].forEach((t) => expect(getByTestId(t)).toBeInTheDocument());
    expect(queryByTestId('p-oval')).toBeNull();
    expect(getByTestId('race-layout').dataset.mode).toBe('wide');
  });
  it('puts the chart before the POV grid in sidebar mode', () => {
    const { getByTestId } = render(<RaceLayoutManager panels={panels} fieldSize={2} />);
    const root = getByTestId('race-layout');
    const zones = [...root.querySelectorAll('[data-testid^="zone-"]')].map((z) => z.dataset.testid);
    expect(zones.indexOf('zone-chart')).toBeLessThan(zones.indexOf('zone-pov'));
  });
  it('puts the chart before the POV grid in wide mode', () => {
    const { getByTestId } = render(<RaceLayoutManager panels={panels} fieldSize={4} />);
    const root = getByTestId('race-layout');
    const zones = [...root.querySelectorAll('[data-testid^="zone-"]')].map((z) => z.dataset.testid);
    expect(zones.indexOf('zone-chart')).toBeLessThan(zones.indexOf('zone-pov'));
  });

  // Recap/playback feeds no speedoRow panel — the layout must NOT render (or
  // reserve a grid track for) a speedo zone, else the chart row is starved and a
  // dead band fills the rest. See RaceRecap (showSpeedos=false).
  const noSpeedo = { ...panels };
  delete noSpeedo.speedoRow;
  it('sidebar without a speedo panel: omits the speedo zone + flags --no-speedo', () => {
    const { getByTestId, queryByTestId } = render(<RaceLayoutManager panels={noSpeedo} fieldSize={2} />);
    expect(queryByTestId('zone-speedo')).toBeNull();
    expect(queryByTestId('p-speedo')).toBeNull();
    ['p-chart', 'p-pov', 'p-oval'].forEach((t) => expect(getByTestId(t)).toBeInTheDocument());
    expect(getByTestId('race-layout').className).toContain('race-layout--no-speedo');
    expect(getByTestId('race-layout').querySelector('.race-layout__main--no-speedo')).toBeTruthy();
  });
  it('wide without a speedo panel: omits the speedo zone + flags --no-speedo', () => {
    const { getByTestId, queryByTestId } = render(<RaceLayoutManager panels={noSpeedo} fieldSize={5} />);
    expect(queryByTestId('zone-speedo')).toBeNull();
    expect(getByTestId('race-layout').className).toContain('race-layout--no-speedo');
  });
});
